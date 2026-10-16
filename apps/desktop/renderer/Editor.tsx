import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { EditorState, StateField, Compartment } from "@codemirror/state";
import {
  EditorView,
  Decoration,
  WidgetType,
  keymap,
  drawSelection,
  type DecorationSet,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  syntaxHighlighting,
  HighlightStyle,
  syntaxTree,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { api } from "./api.ts";
import type { DocumentSnapshot } from "../../../packages/contracts/index.ts";
import { imageURL } from "./links.ts";
import { external, protectFrontmatter } from "./editor-state.ts";

class LinkWidget extends WidgetType {
  constructor(
    private label: string,
    private href: string,
    private image?: string,
  ) {
    super();
  }
  eq(other: LinkWidget) {
    return (
      this.label === other.label &&
      this.href === other.href &&
      this.image === other.image
    );
  }
  toDOM() {
    if (this.image) {
      const img = document.createElement("img");
      img.src = this.image;
      img.alt = this.label;
      img.className = "cm-inline-image";
      img.loading = "lazy";
      return img;
    }
    const link = document.createElement("a");
    link.textContent = this.label;
    link.href = "#";
    link.className = "cm-note-link";
    link.onclick = (e) => {
      e.preventDefault();
      window.dispatchEvent(
        new CustomEvent("fable:open-link", { detail: this.href }),
      );
    };
    return link;
  }
  ignoreEvent() {
    return true;
  }
}
class CheckboxWidget extends WidgetType {
  constructor(
    private checked: boolean,
    private at: number,
  ) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.at === this.at;
  }
  toDOM(view: EditorView) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `cm-checkbox ${this.checked ? "is-checked" : ""}`;
    button.setAttribute("role", "checkbox");
    button.setAttribute("aria-checked", String(this.checked));
    button.setAttribute(
      "aria-label",
      this.checked ? "Reopen task" : "Complete task",
    );
    button.textContent = this.checked ? "✓" : "";
    button.onclick = (e) => {
      e.preventDefault();
      view.dispatch({
        changes: {
          from: this.at,
          to: this.at + 1,
          insert: this.checked ? " " : "x",
        },
      });
    };
    return button;
  }
  ignoreEvent() {
    return false;
  }
}
function decorations(state: EditorState, sourcePath: string) {
  const ranges: any[] = [],
    text = state.doc.toString(),
    cursor = state.selection.main.head;
  const fm = /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text);
  if (fm)
    ranges.push(Decoration.replace({ block: true }).range(0, fm[0].length));
  const offset = fm?.[0].length ?? 0;
  for (let number = 1; number <= state.doc.lines; number++) {
    const line = state.doc.line(number);
    if (line.from < offset) continue;
    const heading = /^(#{1,6})\s+/.exec(line.text);
    if (heading) {
      ranges.push(
        Decoration.line({
          class: `cm-heading cm-heading-${heading[1].length}`,
        }).range(line.from),
      );
      if (cursor < line.from || cursor > line.to)
        ranges.push(
          Decoration.replace({}).range(
            line.from,
            line.from + heading[0].length,
          ),
        );
    }
    const task = /^(\s*(?:[-+*]|\d+[.)])\s+)\[([ xX])\]\s?/.exec(line.text);
    if (task)
      ranges.push(
        Decoration.replace({
          widget: new CheckboxWidget(
            task[2] !== " ",
            line.from + task[1].length + 1,
          ),
        }).range(line.from, line.from + task[0].length),
      );
    const annotation = /\s*<!--\s*fable:task\s+\{.*?\}\s*-->/.exec(line.text);
    if (annotation)
      ranges.push(
        Decoration.replace({}).range(
          line.from + annotation.index,
          line.from + annotation.index + annotation[0].length,
        ),
      );
    if (cursor < line.from || cursor > line.to) {
      const links =
        /!?\[([^\]\n]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)|\[\[([^\]\n]+)\]\]/g;
      for (const match of line.text.matchAll(links)) {
        const from = line.from + match.index!,
          to = from + match[0].length;
        let node = syntaxTree(state).resolveInner(from, 1),
          code = false;
        for (let n: typeof node | null = node; n; n = n.parent)
          if (/Code/.test(n.name)) code = true;
        if (code) continue;
        const href = match[3] ? `wiki:${match[3].split("|")[0]}` : match[2],
          label = match[3]
            ? (match[3].split("|")[1] ?? match[3].split("|")[0])
            : match[1];
        ranges.push(
          Decoration.replace({
            widget: new LinkWidget(
              label,
              href,
              match[0].startsWith("!") ? imageURL(sourcePath, href) : undefined,
            ),
          }).range(from, to),
        );
      }
    }
  }
  syntaxTree(state).iterate({
    enter(node) {
      if (node.from < offset) return;
      if (["EmphasisMark", "CodeMark"].includes(node.name)) {
        const line = state.doc.lineAt(node.from);
        if (cursor < line.from || cursor > line.to)
          ranges.push(Decoration.replace({}).range(node.from, node.to));
      }
    },
  });
  ranges.sort((a, b) => a.from - b.from || a.startSide - b.startSide);
  return Decoration.set(ranges, true);
}
const livePreview = (sourcePath: string) =>
  StateField.define<DecorationSet>({
    create: (state) => decorations(state, sourcePath),
    update(value, transaction) {
      return transaction.docChanged || transaction.selection
        ? decorations(transaction.state, sourcePath)
        : value;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
const highlight = HighlightStyle.define([
  { tag: tags.strong, fontWeight: "600" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.link, color: "#5f7183", textDecoration: "underline" },
  {
    tag: tags.monospace,
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
    fontSize: "0.9em",
  },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.quote, color: "#838383" },
  { tag: tags.processingInstruction, color: "#a0a0a0" },
]);
export interface EditorHandle {
  flush(): Promise<boolean>;
  focusTask(line: number): void;
  insert(text: string): void;
  acceptPreservedDraft(): void;
}
export const MarkdownEditor = forwardRef<
  EditorHandle,
  {
    document: DocumentSnapshot;
    missing?: boolean;
    source: boolean;
    onStatus: (status: string) => void;
    onError: (message: string) => void;
    onConflictCopy: (raw: string) => void;
  }
>(
  (
    { document: doc, missing, source, onStatus, onError, onConflictCopy },
    ref,
  ) => {
    const host = useRef<HTMLDivElement>(null),
      view = useRef<EditorView | null>(null),
      compartment = useRef(new Compartment());
    const base = useRef(doc.revision),
      saved = useRef(doc.raw),
      latest = useRef(doc.raw),
      inflight = useRef<{ raw: string; promise: Promise<boolean> } | null>(
        null,
      ),
      timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
      conflicted = useRef(false);
    const [conflict, setConflict] = useState(false);
    const callbacks = useRef({ onStatus, onError });
    callbacks.current = { onStatus, onError };
    const persist = async (): Promise<boolean> => {
      clearTimeout(timer.current);
      if (conflicted.current) return false;
      if (inflight.current) {
        if (!(await inflight.current.promise) || conflicted.current)
          return false;
        return latest.current !== saved.current ? persist() : true;
      }
      if (latest.current === saved.current) return true;
      const raw = latest.current;
      callbacks.current.onStatus("Saving…");
      const promise = (async () => {
        try {
          const result = await api.request("documents.save", {
            id: doc.id,
            baseRevision: base.current,
            raw,
          });
          base.current = result.revision;
          saved.current = raw;
          callbacks.current.onStatus(
            latest.current === raw ? "Saved" : "Unsaved changes",
          );
          return true;
        } catch (e: any) {
          callbacks.current.onStatus("Unsaved changes");
          if (e.code === "STALE_REVISION") {
            conflicted.current = true;
            setConflict(true);
          }
          callbacks.current.onError(e.message);
          return false;
        } finally {
          inflight.current = null;
        }
      })();
      inflight.current = { raw, promise };
      return promise;
    };
    const persistRef = useRef(persist);
    persistRef.current = persist;
    useImperativeHandle(ref, () => ({
      flush: () => persistRef.current(),
      acceptPreservedDraft() {
        saved.current = latest.current;
        conflicted.current = false;
        setConflict(false);
      },
      focusTask(line) {
        const v = view.current;
        if (v) {
          const target = v.state.doc.line(Math.min(line, v.state.doc.lines));
          v.dispatch({
            selection: { anchor: target.from },
            effects: EditorView.scrollIntoView(target.from, { y: "center" }),
          });
          v.focus();
        }
      },
      insert(text) {
        const v = view.current;
        if (v) {
          v.dispatch(v.state.replaceSelection(text));
          v.focus();
        }
      },
    }));
    useEffect(() => {
      const fm = /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(
        doc.raw,
      );
      const editor = new EditorView({
        parent: host.current!,
        state: EditorState.create({
          doc: doc.raw,
          selection: { anchor: fm?.[0].replace(/\r\n/g, "\n").length ?? 0 },
          extensions: [
            EditorState.lineSeparator.of(
              doc.raw.includes("\r\n") ? "\r\n" : "\n",
            ),
            history(),
            drawSelection(),
            markdown(),
            syntaxHighlighting(highlight),
            highlightSelectionMatches(),
            EditorView.lineWrapping,
            keymap.of([
              ...defaultKeymap,
              ...historyKeymap,
              ...searchKeymap,
              indentWithTab,
            ]),
            EditorView.contentAttributes.of({
              "aria-label": `Edit ${doc.title}`,
              spellcheck: "true",
            }),
            compartment.current.of(
              source ? [] : [livePreview(doc.path), protectFrontmatter],
            ),
            EditorView.updateListener.of((update) => {
              if (
                update.docChanged &&
                !update.transactions.some((t) => t.annotation(external))
              ) {
                latest.current = update.state.sliceDoc();
                callbacks.current.onStatus("Unsaved changes");
                clearTimeout(timer.current);
                timer.current = setTimeout(() => {
                  void persistRef.current();
                }, 300);
              }
            }),
            EditorView.theme({
              ".cm-scroller": {
                fontFamily: "var(--fable-editor-font, inherit)",
              },
            }),
            EditorView.domEventHandlers({
              blur: () => {
                void persistRef.current();
              },
            }),
          ],
        }),
      });
      view.current = editor;
      const interval = setInterval(() => {
        if (latest.current !== saved.current) void persistRef.current();
      }, 1500);
      const prevent = (event: BeforeUnloadEvent) => {
        if (latest.current !== saved.current) {
          event.preventDefault();
          event.returnValue = "";
          void persistRef.current();
        }
      };
      window.addEventListener("beforeunload", prevent);
      return () => {
        clearInterval(interval);
        clearTimeout(timer.current);
        window.removeEventListener("beforeunload", prevent);
        editor.destroy();
        view.current = null;
      };
    }, []);
    useEffect(() => {
      view.current?.dispatch({
        effects: compartment.current.reconfigure(
          source ? [] : [livePreview(doc.path), protectFrontmatter],
        ),
      });
    }, [source, doc.path]);
    useEffect(() => {
      view.current?.contentDOM.setAttribute("aria-label", `Edit ${doc.title}`);
    }, [doc.title]);
    useEffect(() => {
      if (missing) {
        conflicted.current = true;
        setConflict(true);
        callbacks.current.onStatus("The file moved or was removed");
      }
    }, [missing]);
    useEffect(() => {
      if (doc.revision === base.current) return;
      if (inflight.current?.raw === doc.raw) {
        base.current = doc.revision;
        return;
      }
      if (latest.current !== saved.current) {
        conflicted.current = true;
        setConflict(true);
        callbacks.current.onStatus("External changes need review");
        return;
      }
      base.current = doc.revision;
      saved.current = doc.raw;
      latest.current = doc.raw;
      const v = view.current;
      if (v)
        v.dispatch({
          changes: { from: 0, to: v.state.doc.length, insert: doc.raw },
          selection: {
            anchor: Math.min(v.state.selection.main.head, doc.raw.length),
          },
          annotations: external.of(true),
        });
    }, [doc.revision]);
    return (
      <>
        {conflict && (
          <div className="editor-conflict" role="status">
            <span>
              {missing
                ? "This file moved or was removed."
                : "This file changed elsewhere."}{" "}
              Your draft is safe in the editor.
            </span>
            <button onClick={() => onConflictCopy(latest.current)}>
              Keep draft as a copy
            </button>
            <button
              disabled={missing}
              onClick={() => {
                conflicted.current = false;
                setConflict(false);
                base.current = doc.revision;
                saved.current = doc.raw;
                latest.current = doc.raw;
                view.current?.dispatch({
                  changes: {
                    from: 0,
                    to: view.current.state.doc.length,
                    insert: doc.raw,
                  },
                  annotations: external.of(true),
                });
              }}
            >
              Use file version
            </button>
          </div>
        )}
        <div
          className={`markdown-editor ${source ? "source-mode" : ""}`}
          ref={host}
        />
      </>
    );
  },
);
