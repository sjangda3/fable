import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { DocumentSnapshot } from "../../../packages/contracts/index.ts";
import { NotebookAddPage } from "./NotebookAddPage.tsx";
import { IconButton } from "./components.tsx";
import { api } from "./api.ts";
import {
  PageEditor,
  type EditorHandle,
  type PageEditorHandle,
} from "./Editor.tsx";
import { snapshotDisposition } from "./editor-sync.ts";
import {
  joinNotebook,
  newNotebookPage,
  notebookMatches,
  splitNotebook,
  ensureNotebookBoundaries,
  type NotebookPage,
} from "./notebook.ts";
import type { EditorCommand, EditorFormatting } from "./editor-commands.ts";

type Page = NotebookPage & { key: string };
const readPages = (raw: string): Page[] =>
  splitNotebook(raw).map((page) => ({ ...page, key: crypto.randomUUID() }));

export const MarkdownEditor = forwardRef<
  EditorHandle,
  {
    document: DocumentSnapshot;
    missing?: boolean;
    source: boolean;
    preview?: boolean;
    firstPageHeader?: ReactNode;
    onStatus(status: string): void;
    onError(message: string): void;
    onConflictCopy(raw: string): void;
    onFormattingChange?(formatting: EditorFormatting): void;
  }
>(function NotebookEditor(
  {
    document: doc,
    missing,
    source,
    preview = false,
    firstPageHeader,
    onStatus,
    onError,
    onConflictCopy,
    onFormattingChange,
  },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState(() => readPages(doc.raw));
  const pagesRef = useRef(pages);
  const editors = useRef(new Map<string, PageEditorHandle>());
  const active = useRef(pages[0].key);
  const [activeKey, setActiveKey] = useState(active.current);
  const pendingFocus = useRef<string | null>(null);
  const [overlayHost, setOverlayHost] = useState<Element | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => notebookMatches(pages, query), [pages, query]);
  const callbacks = useRef({ onStatus, onError, onFormattingChange });
  callbacks.current = { onStatus, onError, onFormattingChange };
  const acknowledged = useRef(doc);
  const acknowledgedRevisions = useRef(new Set([doc.revision]));
  const base = useRef(doc.revision),
    saved = useRef(doc.raw),
    latest = useRef(doc.raw);
  const inflight = useRef<{ raw: string; promise: Promise<boolean> } | null>(
    null,
  );
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const conflicted = useRef(false);
  const [conflict, setConflict] = useState(false);

  const persist = async (): Promise<boolean> => {
    clearTimeout(timer.current);
    if (conflicted.current) return false;
    if (inflight.current) {
      if (!(await inflight.current.promise) || conflicted.current) return false;
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
        acknowledged.current = result;
        acknowledgedRevisions.current.add(result.revision);
        base.current = result.revision;
        saved.current = result.raw;
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
  const updatePages = (next: Page[], dirty = true) => {
    next = ensureNotebookBoundaries(next);
    pagesRef.current = next;
    latest.current = joinNotebook(next);
    setPages(next);
    if (dirty) {
      callbacks.current.onStatus("Unsaved changes");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void persistRef.current(), 300);
    }
  };
  const activate = (key: string) => {
    active.current = key;
    setActiveKey(key);
  };
  const addPage = () => {
    if (conflicted.current) return;
    const page = {
      ...newNotebookPage(latest.current),
      key: crypto.randomUUID(),
    };
    pendingFocus.current = page.key;
    activate(page.key);
    updatePages([...pagesRef.current, page]);
  };
  const revealMatch = (index: number) => {
    if (!matches.length) return;
    const next = (index + matches.length) % matches.length;
    const match = matches[next],
      page = pages[match.page];
    setMatchIndex(next);
    activate(page.key);
    if (preview)
      host.current
        ?.querySelectorAll(".notebook-sheet")
        [match.page]?.scrollIntoView({ block: "center" });
    else editors.current.get(page.key)?.reveal(match.from, match.to);
  };
  const closeSearch = () => {
    setSearchOpen(false);
    editors.current.get(active.current)?.focus();
  };
  const run = (command: EditorCommand) => {
    if (command === "search") {
      setSearchOpen(true);
      searchInput.current?.focus();
      return;
    }
    editors.current.get(active.current)?.command(command);
  };
  useImperativeHandle(ref, () => ({
    flush: () => persistRef.current(),
    getPages: () => pagesRef.current.map((page) => page.raw),
    acceptPreservedDraft() {
      saved.current = latest.current;
      conflicted.current = false;
      setConflict(false);
    },
    command: run,
    addPage,
    insert: (text) => editors.current.get(active.current)?.insert(text),
    insertBlock: (text) =>
      editors.current.get(active.current)?.insertBlock(text),
    focusTask(line) {
      const raw = latest.current;
      const position =
        raw
          .split("\n")
          .slice(0, line - 1)
          .join("\n").length + (line > 1 ? 1 : 0);
      let offset = 0;
      for (const page of pagesRef.current) {
        offset += page.before.length;
        if (position <= offset + page.raw.length) {
          activate(page.key);
          editors.current
            .get(page.key)
            ?.focusTask(
              page.raw.slice(0, Math.max(0, position - offset)).split("\n")
                .length,
            );
          break;
        }
        offset += page.raw.length;
      }
    },
  }));
  useLayoutEffect(() => {
    setOverlayHost(host.current?.closest(".document-layout") ?? null);
  }, []);
  useEffect(() => {
    if (!pendingFocus.current) return;
    const editor = editors.current.get(pendingFocus.current);
    if (editor) {
      editor.focus(true);
      pendingFocus.current = null;
    }
  }, [pages.length]);
  useEffect(() => {
    if (!searchOpen) return;
    searchInput.current?.focus();
    searchInput.current?.select();
  }, [searchOpen, overlayHost]);
  useEffect(() => {
    for (const editor of editors.current.values())
      editor.highlight(searchOpen ? query : "", false);
  }, [searchOpen, query, pages.length]);
  useEffect(() => {
    setMatchIndex(0);
    if (searchOpen && matches.length) revealMatch(0);
  }, [query]);
  useEffect(() => {
    if (!searchOpen) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeSearch();
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [searchOpen]);
  useEffect(() => {
    const find = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        !(event.metaKey || event.ctrlKey) ||
        event.shiftKey ||
        event.altKey ||
        event.key.toLowerCase() !== "f"
      )
        return;
      if (
        event.target instanceof Element &&
        event.target.closest('[role="dialog"]')
      )
        return;
      event.preventDefault();
      setSearchOpen(true);
      searchInput.current?.focus();
    };
    window.addEventListener("keydown", find);
    return () => window.removeEventListener("keydown", find);
  }, []);
  useEffect(() => {
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
    };
  }, []);
  useEffect(() => {
    if (missing) {
      conflicted.current = true;
      setConflict(true);
      callbacks.current.onStatus("The file moved or was removed");
    }
  }, [missing]);
  const useFile = () => {
    acknowledged.current = doc;
    acknowledgedRevisions.current.add(doc.revision);
    base.current = doc.revision;
    saved.current = doc.raw;
    const next = splitNotebook(doc.raw).map((page, i) => ({
      ...page,
      key: pagesRef.current[i]?.key ?? crypto.randomUUID(),
    }));
    if (!next.some((page) => page.key === active.current))
      activate(next[0].key);
    updatePages(next, false);
  };
  useEffect(() => {
    const disposition = snapshotDisposition(
      acknowledged.current,
      doc,
      inflight.current?.raw,
      acknowledgedRevisions.current,
    );
    if (disposition === "ignore") return;
    if (disposition === "acknowledge") {
      acknowledged.current = doc;
      acknowledgedRevisions.current.add(doc.revision);
      base.current = doc.revision;
      saved.current = doc.raw;
      return;
    }
    if (latest.current !== saved.current) {
      conflicted.current = true;
      setConflict(true);
      callbacks.current.onStatus("External changes need review");
      return;
    }
    useFile();
  }, [doc.revision, doc.modifiedAt]);

  return (
    <div className="notebook" ref={host} aria-label={`${doc.title} notebook`}>
      {conflict &&
        overlayHost &&
        createPortal(
          <div className="editor-conflict notebook-conflict" role="status">
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
                useFile();
                callbacks.current.onStatus("Saved");
              }}
            >
              Use file version
            </button>
          </div>,
          overlayHost,
        )}
      {pages.map((page, index) => (
        <section
          className={`notebook-sheet ${activeKey === page.key ? "is-active" : ""}`}
          key={page.key}
          aria-label={`Page ${index + 1}`}
        >
          {pages.length > 1 && (
            <header className="notebook-page-label">
              <span>
                {index + 1} of {pages.length}
              </span>
            </header>
          )}
          <div
            className="document-paper"
            onFocusCapture={() => activate(page.key)}
          >
            {index === 0 && firstPageHeader}
            <PageEditor
              ref={(handle) => {
                if (handle) editors.current.set(page.key, handle);
                else editors.current.delete(page.key);
              }}
              raw={page.raw}
              path={doc.path}
              title={`${doc.title}, page ${index + 1}`}
              source={source}
              preview={preview}
              onChange={(raw) =>
                updatePages(
                  pagesRef.current.map((p) =>
                    p.key === page.key ? { ...p, raw } : p,
                  ),
                )
              }
              onFocus={() => activate(page.key)}
              onFlush={() => void persistRef.current()}
              onSearch={() => setSearchOpen(true)}
              onError={onError}
              onFormattingChange={(format) => {
                if (active.current === page.key)
                  callbacks.current.onFormattingChange?.(format);
              }}
            />
          </div>
        </section>
      ))}
      {!preview && (
        <NotebookAddPage
          onAdd={addPage}
          disabled={conflict}
          pageCount={pages.length}
        />
      )}
      {searchOpen &&
        overlayHost &&
        createPortal(
          <section
            className="notebook-search"
            aria-label="Find in notebook"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                closeSearch();
              } else if (
                event.key === "Enter" &&
                !(event.target instanceof HTMLButtonElement)
              ) {
                event.preventDefault();
                revealMatch(matchIndex + (event.shiftKey ? -1 : 1));
              }
            }}
          >
            <div className="notebook-search-row">
              <input
                ref={searchInput}
                aria-label="Find in notebook"
                placeholder="Find in notebook…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <output aria-live="polite">
                {query
                  ? matches.length
                    ? `${Math.min(matchIndex + 1, matches.length)} of ${matches.length}`
                    : "No results"
                  : ""}
              </output>
              <IconButton
                icon="up"
                label="Previous match"
                disabled={!matches.length}
                onClick={() => revealMatch(matchIndex - 1)}
              />
              <IconButton
                icon="down"
                label="Next match"
                disabled={!matches.length}
                onClick={() => revealMatch(matchIndex + 1)}
              />
              <IconButton
                icon="close"
                label="Close search"
                onClick={closeSearch}
              />
            </div>
          </section>,
          overlayHost,
        )}
    </div>
  );
});
