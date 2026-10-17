import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  EditorState,
  StateField,
  Compartment,
  Transaction,
} from "@codemirror/state";
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
  undo,
  redo,
  indentMore,
  indentLess,
} from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  syntaxHighlighting,
  HighlightStyle,
  syntaxTree,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import {
  search,
  SearchQuery,
  setSearchQuery,
  getSearchQuery,
  highlightSelectionMatches,
} from "@codemirror/search";
import { imageURL } from "./links.ts";
import {
  external,
  protectFrontmatter,
  initialEditorPosition,
  frontmatterBoundary,
} from "./editor-state.ts";
import {
  blockInsertion,
  editorFormatting,
  formattingTransaction,
  type EditorCommand,
  type EditorFormatting,
} from "./editor-commands.ts";
import {
  documentDropType,
  FormatButton,
  TextStyleMenu,
} from "./DocumentChrome.tsx";
import { DocumentPreview } from "./DocumentPreview.tsx";

class MarkerWidget extends WidgetType {
  constructor(
    private text: string,
    private className: string,
  ) {
    super();
  }
  eq(other: MarkerWidget) {
    return this.text === other.text && this.className === other.className;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = this.className;
    span.textContent = this.text;
    return span;
  }
}
class TableWidget extends WidgetType {
  constructor(
    private raw: string,
    private at: number,
  ) {
    super();
  }
  eq(other: TableWidget) {
    return this.raw === other.raw && this.at === other.at;
  }
  toDOM(view: EditorView) {
    const root = document.createElement("div");
    root.className = "cm-table-preview";
    const table = document.createElement("table");
    const rows = this.raw
      .trim()
      .split("\n")
      .map((line) =>
        line
          .trim()
          .replace(/^\||\|$/g, "")
          .split(/(?<!\\)\|/)
          .map((cell) => cell.trim()),
      );
    const head = document.createElement("thead"),
      body = document.createElement("tbody");
    rows.forEach((cells, i) => {
      if (i === 1) return;
      const tr = document.createElement("tr");
      cells.forEach((cell) => {
        const td = document.createElement(i === 0 ? "th" : "td");
        td.textContent = cell;
        tr.append(td);
      });
      (i === 0 ? head : body).append(tr);
    });
    table.append(head, body);
    root.append(table);
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Edit table";
    edit.onclick = () => {
      view.dispatch({ selection: { anchor: this.at } });
      view.focus();
    };
    root.append(edit);
    return root;
  }
  ignoreEvent() {
    return true;
  }
}

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
    ranges.push(
      // Keep the final newline outside the fold so the first body's line styles apply.
      Decoration.replace({ block: true, inclusiveEnd: false }).range(
        0,
        fm[0].length - (fm[0].endsWith("\n") ? 1 : 0),
      ),
    );
  const offset = fm?.[0].length ?? 0;
  const tables: { from: number; to: number }[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === "Table" && (cursor < node.from || cursor > node.to)) {
        tables.push({ from: node.from, to: node.to });
        ranges.push(
          Decoration.replace({
            block: true,
            widget: new TableWidget(
              state.sliceDoc(node.from, node.to),
              node.from,
            ),
          }).range(node.from, node.to),
        );
      }
    },
  });
  for (let number = 1; number <= state.doc.lines; number++) {
    const line = state.doc.line(number);
    if (line.from < offset) continue;
    if (
      !line.text &&
      number > 1 &&
      /^#{2,6}\s/.test(state.doc.line(number - 1).text)
    )
      ranges.push(
        Decoration.line({ class: "cm-heading-gap" }).range(line.from),
      );
    if (tables.some((table) => line.from >= table.from && line.from < table.to))
      continue;
    let code = false;
    for (
      let node = syntaxTree(state).resolveInner(line.from, 1);
      node;
      node = node.parent!
    )
      if (["FencedCode", "CodeBlock"].includes(node.name)) code = true;
    if (code) {
      ranges.push(Decoration.line({ class: "cm-code-line" }).range(line.from));
      if (/^\s*(```|~~~)/.test(line.text))
        ranges.push(
          Decoration.line({ class: "cm-code-fence" }).range(line.from),
        );
      continue;
    }
    const heading = /^(#{1,6})\s+/.exec(line.text);
    if (heading) {
      ranges.push(
        Decoration.line({
          class: `cm-heading cm-heading-${heading[1].length}`,
        }).range(line.from),
      );
      ranges.push(
        Decoration.replace({}).range(line.from, line.from + heading[0].length),
      );
    }
    const rule = /^\s*(?:-{3,}|\*{3,}|_{3,}|- - -(?: -)*)\s*$/.test(line.text);
    if (rule) {
      const style = line.text.includes("*")
        ? "dotted"
        : line.text.includes(" ")
          ? "dashed"
          : line.text.includes("_")
            ? "thick"
            : "thin";
      ranges.push(Decoration.line({ class: "cm-rule-line" }).range(line.from));
      ranges.push(
        Decoration.replace({
          widget: new MarkerWidget("", `cm-divider line-${style}`),
        }).range(line.from, line.to),
      );
      continue;
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
    const list = /^(\s*)([-+*]|\d+[.)])\s+/.exec(line.text);
    if (list) {
      ranges.push(Decoration.line({ class: "cm-list-line" }).range(line.from));
      if (!task)
        ranges.push(
          Decoration.replace({
            widget: new MarkerWidget(
              /^\d/.test(list[2]) ? list[2] : "•",
              "cm-list-marker",
            ),
          }).range(line.from + list[1].length, line.from + list[0].length),
        );
    }
    const quote = /^>\s?/.exec(line.text);
    if (quote) {
      ranges.push(Decoration.line({ class: "cm-quote-line" }).range(line.from));
      ranges.push(
        Decoration.replace({}).range(line.from, line.from + quote[0].length),
      );
    }
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
      if (
        tables.some((table) => node.from >= table.from && node.from < table.to)
      )
        return;
      if (["EmphasisMark", "CodeMark", "StrikethroughMark"].includes(node.name))
        ranges.push(Decoration.replace({}).range(node.from, node.to));
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
const searchHighlights = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    if (
      !transaction.docChanged &&
      !transaction.selection &&
      !transaction.effects.some((effect) => effect.is(setSearchQuery))
    )
      return value;
    const state = transaction.state,
      query = getSearchQuery(state);
    if (!query.valid) return Decoration.none;
    const cursor = query.getCursor(
      state.doc,
      frontmatterBoundary(state.doc.toString()),
    );
    const ranges = [];
    for (let result = cursor.next(); !result.done; result = cursor.next()) {
      const { from, to } = result.value;
      const selected =
        state.selection.main.from === from && state.selection.main.to === to;
      ranges.push(
        Decoration.mark({
          class: selected
            ? "cm-notebook-match is-current"
            : "cm-notebook-match",
        }).range(from, to),
      );
    }
    return Decoration.set(ranges);
  },
  provide: (field) => EditorView.decorations.from(field),
});
export interface EditorHandle {
  flush(): Promise<boolean>;
  getPages(): string[];
  focusTask(line: number): void;
  insert(text: string): void;
  acceptPreservedDraft(): void;
  command(command: EditorCommand): void;
  insertBlock(text: string): void;
  addPage(): void;
}
export interface PageEditorHandle {
  command(command: EditorCommand): void;
  insert(text: string): void;
  insertBlock(text: string): void;
  focusTask(line: number): void;
  focus(scroll?: boolean): void;
  reveal(from: number, to: number): void;
  highlight(query: string, caseSensitive: boolean): void;
  replace(changes: { from: number; to: number; insert: string }[]): void;
}
export const PageEditor = forwardRef<
  PageEditorHandle,
  {
    raw: string;
    path: string;
    title: string;
    source: boolean;
    preview: boolean;
    onChange(raw: string): void;
    onFocus(): void;
    onFlush(): void;
    onSearch(): void;
    onFormattingChange?(formatting: EditorFormatting): void;
    onError(message: string): void;
  }
>(function PageEditor(
  {
    raw,
    path,
    title,
    source,
    preview,
    onChange,
    onFocus,
    onFlush,
    onSearch,
    onFormattingChange,
    onError,
  },
  ref,
) {
  const host = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null),
    compartment = useRef(new Compartment()),
    editability = useRef(new Compartment());
  const callbacks = useRef({ onChange, onFocus, onFlush, onSearch });
  callbacks.current = { onChange, onFocus, onFlush, onSearch };
  const previewRef = useRef(preview);
  previewRef.current = preview;
  const [bubble, setBubble] = useState<{
    left: number;
    top: number;
    below: boolean;
    format: EditorFormatting;
  } | null>(null);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const formattingCallback = useRef(onFormattingChange);
  const selectionFrame = useRef<number | undefined>(undefined);
  formattingCallback.current = onFormattingChange;
  const reportSelection = (v: EditorView) => {
    if (selectionFrame.current !== undefined)
      cancelAnimationFrame(selectionFrame.current);
    const format = editorFormatting(v.state);
    formattingCallback.current?.(format);
    const range = v.state.selection.main;
    if (range.empty || sourceRef.current || previewRef.current || !v.hasFocus) {
      setBubble(null);
      return;
    }
    selectionFrame.current = requestAnimationFrame(() => {
      if (view.current !== v) return;
      const start = v.coordsAtPos(range.from),
        end = v.coordsAtPos(range.to);
      const canvas = host.current
        ?.closest(".document-canvas")
        ?.getBoundingClientRect();
      if (
        !start ||
        !end ||
        !canvas ||
        end.bottom < canvas.top ||
        start.top > canvas.bottom
      ) {
        setBubble(null);
        return;
      }
      const below = start.top < canvas.top + 48;
      setBubble({
        left: Math.max(
          canvas.left + 160,
          Math.min(canvas.right - 160, (start.left + end.right) / 2),
        ),
        top: below
          ? Math.min(
              canvas.bottom - 48,
              Math.max(canvas.top + 8, end.bottom + 8),
            )
          : start.top - 8,
        below,
        format,
      });
    });
  };
  const run = (command: EditorCommand) => {
    const v = view.current;
    if (!v || previewRef.current) return;
    if (command === "undo") undo(v);
    else if (command === "redo") redo(v);
    else if (command === "indent") indentMore(v);
    else if (command === "outdent") indentLess(v);
    else if (command === "search") {
      setBubble(null);
      callbacks.current.onSearch();
      return;
    } else {
      const transaction = formattingTransaction(v.state, command);
      if (transaction) v.dispatch({ ...transaction, scrollIntoView: true });
    }
    v.focus();
    reportSelection(v);
  };
  useImperativeHandle(ref, () => ({
    command: run,
    focus(scroll = false) {
      view.current?.focus();
      if (scroll && view.current)
        view.current.dispatch({
          effects: EditorView.scrollIntoView(
            view.current.state.selection.main.head,
            { y: "start", yMargin: 120 },
          ),
        });
    },
    reveal(from, to) {
      view.current?.dispatch({
        selection: { anchor: from, head: to },
        effects: EditorView.scrollIntoView(from, { y: "center" }),
      });
    },
    highlight(query, caseSensitive) {
      view.current?.dispatch({
        effects: setSearchQuery.of(
          new SearchQuery({
            search: query,
            caseSensitive,
            literal: true,
            test: (_match, state, from) =>
              from >= frontmatterBoundary(state.doc.toString()),
          }),
        ),
      });
    },
    replace(changes) {
      view.current?.dispatch({ changes, userEvent: "input.replace" });
    },
    insertBlock(text) {
      const v = view.current;
      if (v && !previewRef.current) {
        v.dispatch(blockInsertion(v.state, text));
        v.focus();
      }
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
      if (v && !previewRef.current) {
        v.dispatch(v.state.replaceSelection(text));
        v.focus();
      }
    },
  }));
  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: raw,
        selection: { anchor: initialEditorPosition(raw) },
        extensions: [
          EditorState.lineSeparator.of(raw.includes("\r\n") ? "\r\n" : "\n"),
          history(),
          editability.current.of([
            EditorView.editable.of(!preview),
            EditorState.readOnly.of(preview),
          ]),
          drawSelection(),
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(highlight),
          highlightSelectionMatches(),
          search(),
          searchHighlights,
          EditorView.lineWrapping,
          keymap.of([
            {
              key: "Mod-b",
              run: () => {
                run("bold");
                return true;
              },
            },
            {
              key: "Mod-i",
              run: () => {
                run("italic");
                return true;
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
            {
              key: "Mod-f",
              run: () => {
                callbacks.current.onSearch();
                return true;
              },
            },
            indentWithTab,
          ]),
          EditorView.contentAttributes.of({
            "aria-label": `Edit ${title}`,
            spellcheck: "true",
          }),
          compartment.current.of(
            source ? [] : [livePreview(path), protectFrontmatter],
          ),
          EditorView.updateListener.of((update) => {
            if (update.selectionSet || update.docChanged)
              reportSelection(update.view);
            if (
              update.docChanged &&
              !update.transactions.some((t) => t.annotation(external))
            ) {
              callbacks.current.onChange(update.state.sliceDoc());
            }
          }),
          EditorView.theme({
            ".cm-scroller": {
              fontFamily: "var(--fable-editor-font, inherit)",
            },
          }),
          EditorView.domEventHandlers({
            drop: (event, v) => {
              const text = event.dataTransfer?.getData(documentDropType);
              if (!text) return false;
              event.preventDefault();
              v.dispatch(
                blockInsertion(
                  v.state,
                  text,
                  v.posAtCoords({ x: event.clientX, y: event.clientY }) ??
                    undefined,
                ),
              );
              v.focus();
              return true;
            },
            dragover: (event) => {
              if (event.dataTransfer?.types.includes(documentDropType)) {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
                return true;
              }
              return false;
            },
            focus: () => {
              callbacks.current.onFocus();
              reportSelection(view.current!);
            },
            blur: () => {
              callbacks.current.onFlush();
            },
          }),
        ],
      }),
    });
    view.current = editor;
    reportSelection(editor);
    const hideBubble = () => setBubble(null);
    const dismissOutside = (event: Event) => {
      const target = event.target;
      if (
        target instanceof Element &&
        (host.current?.contains(target) ||
          target.closest(".selection-toolbar, .dropdown-root"))
      )
        return;
      hideBubble();
    };
    window.document.addEventListener("pointerdown", dismissOutside);
    const canvas = host.current?.closest(".document-canvas");
    const repositionBubble = () => {
      if (
        editor.hasFocus ||
        window.document.activeElement?.closest(".selection-toolbar")
      )
        reportSelection(editor);
      else hideBubble();
    };
    canvas?.addEventListener("scroll", repositionBubble, { passive: true });
    window.addEventListener("resize", repositionBubble);
    return () => {
      if (selectionFrame.current !== undefined)
        cancelAnimationFrame(selectionFrame.current);
      canvas?.removeEventListener("scroll", repositionBubble);
      window.removeEventListener("resize", repositionBubble);
      window.document.removeEventListener("pointerdown", dismissOutside);
      editor.destroy();
      view.current = null;
    };
  }, []);
  useEffect(() => {
    setBubble(null);
    view.current?.dispatch({
      effects: compartment.current.reconfigure(
        source ? [] : [livePreview(path), protectFrontmatter],
      ),
    });
  }, [source, path]);
  useEffect(() => {
    setBubble(null);
    const editor = view.current;
    editor?.dispatch({
      effects: editability.current.reconfigure([
        EditorView.editable.of(!preview),
        EditorState.readOnly.of(preview),
      ]),
    });
    if (!preview) editor?.requestMeasure();
  }, [preview]);
  useEffect(() => {
    view.current?.contentDOM.setAttribute("aria-label", `Edit ${title}`);
  }, [title]);
  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.sliceDoc() === raw) return;
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: raw },
      selection: {
        anchor: Math.min(
          editor.state.selection.main.head,
          raw.replace(/\r\n/g, "\n").length,
        ),
      },
      annotations: [external.of(true), Transaction.addToHistory.of(false)],
    });
  }, [raw]);
  return (
    <>
      {preview && <DocumentPreview raw={raw} path={path} title={title} />}
      <div
        hidden={preview}
        className={`markdown-editor ${source ? "source-mode" : ""}`}
        ref={host}
      />
      {bubble &&
        createPortal(
          <div
            className={`selection-toolbar ${bubble.below ? "is-below" : ""}`}
            role="toolbar"
            aria-label="Selection formatting"
            style={{ left: bubble.left, top: bubble.top }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <TextStyleMenu
              label="Selection text style"
              block={bubble.format.block}
              run={run}
              onError={onError}
            />
            <FormatButton
              command="bold"
              label="Bold selection"
              active={bubble.format.bold}
              run={run}
            />
            <FormatButton
              command="italic"
              label="Italic selection"
              active={bubble.format.italic}
              run={run}
            />
            <FormatButton
              command="strike"
              label="Strikethrough selection"
              active={bubble.format.strike}
              run={run}
            />
            <span className="selection-toolbar-divider" />
            <FormatButton
              command="code"
              label="Code selection"
              active={bubble.format.code}
              run={run}
            />
            <FormatButton command="link" label="Link selection" run={run} />
            <FormatButton command="quote" label="Quote selection" run={run} />
            <FormatButton
              command="taskList"
              label="Make selection a task"
              run={run}
            />
          </div>,
          window.document.body,
        )}
    </>
  );
});
