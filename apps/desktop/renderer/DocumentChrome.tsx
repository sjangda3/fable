import { useEffect, useRef, useState, type RefObject } from "react";
import { Icon, type IconName } from "../../../packages/ui/icons.tsx";
import type { DocumentSnapshot } from "../../../packages/contracts/index.ts";
import type { EditorHandle } from "./Editor.tsx";
import {
  emptyFormatting,
  markdownTable,
  type EditorCommand,
  type EditorFormatting,
} from "./editor-commands.ts";
import { relativeVaultHref } from "./links.ts";
import { IconButton } from "./components.tsx";

export function FormatButton({
  command,
  label,
  active,
  disabled,
  run,
}: {
  command: EditorCommand;
  label: string;
  active?: boolean;
  disabled?: boolean;
  run: (command: EditorCommand) => void;
}) {
  return (
    <button
      type="button"
      className={`format-button ${active ? "is-active" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => run(command)}
    >
      <Icon
        name={
          command === "taskList"
            ? "tasks"
            : command === "codeBlock"
              ? "code"
              : command === "outdent"
                ? "indent"
                : (command as IconName)
        }
        size={17}
        className={command === "outdent" ? "flip-icon" : ""}
      />
    </button>
  );
}

export function DocumentToolbar({
  navigation,
  editor,
  formatting = emptyFormatting,
  source,
  onSource,
  insertOpen,
  onInsert,
  children,
}: {
  navigation?: React.ReactNode;
  editor: RefObject<EditorHandle | null>;
  formatting?: EditorFormatting;
  source: boolean;
  onSource: () => void;
  insertOpen: boolean;
  onInsert: () => void;
  children: React.ReactNode;
}) {
  const run = (command: EditorCommand) => editor.current?.command(command);
  return (
    <div
      className="document-formatbar"
      role="toolbar"
      aria-label="Document formatting"
    >
      {navigation && <div className="document-navigation">{navigation}</div>}
      <div className="formatbar-scroll">
        <div className="format-group">
          <FormatButton
            command="undo"
            label="Undo (⌘ Z)"
            disabled={!formatting.canUndo}
            run={run}
          />
          <FormatButton
            command="redo"
            label="Redo (⌘ ⇧ Z)"
            disabled={!formatting.canRedo}
            run={run}
          />
        </div>
        <div className="format-group">
          <button
            className="format-button"
            aria-label="Toggle insert panel"
            aria-expanded={insertOpen}
            title="Insert"
            onClick={onInsert}
          >
            <Icon name="add" size={18} />
          </button>
        </div>
        <div className="format-group">
          <select
            className="format-style"
            aria-label="Text style"
            value={formatting.block}
            onChange={(e) => run(e.target.value as EditorCommand)}
          >
            <option value="paragraph">Normal text</option>
            <option value="heading1">Title</option>
            <option value="heading2">Heading 1</option>
            <option value="heading3">Heading 2</option>
          </select>
          <FormatButton
            command="bold"
            label="Bold (⌘ B)"
            active={formatting.bold}
            run={run}
          />
          <FormatButton
            command="italic"
            label="Italic (⌘ I)"
            active={formatting.italic}
            run={run}
          />
          <FormatButton
            command="strike"
            label="Strikethrough"
            active={formatting.strike}
            run={run}
          />
          <FormatButton
            command="code"
            label="Inline code"
            active={formatting.code}
            run={run}
          />
        </div>
        <div className="format-group">
          <FormatButton command="bulletList" label="Bulleted list" run={run} />
          <FormatButton
            command="numberedList"
            label="Numbered list"
            run={run}
          />
          <FormatButton command="taskList" label="Task list" run={run} />
          <FormatButton command="outdent" label="Decrease indent" run={run} />
          <FormatButton command="indent" label="Increase indent" run={run} />
        </div>
        <div className="format-group">
          <FormatButton command="quote" label="Block quote" run={run} />
          <FormatButton command="link" label="Insert link" run={run} />
          <FormatButton command="search" label="Find in page (⌘ F)" run={run} />
        </div>
      </div>
      <div className="document-actions">
        {children}
        <IconButton
          icon={source ? "view" : "code"}
          label={source ? "Live preview" : "Markdown source"}
          className={source ? "mode-selected" : ""}
          onClick={onSource}
        />
        <IconButton
          icon="panel"
          label={insertOpen ? "Hide insert panel" : "Show insert panel"}
          className={insertOpen ? "mode-selected" : ""}
          onClick={onInsert}
        />
      </div>
    </div>
  );
}

const insertItems: {
  id: string;
  label: string;
  icon: IconName;
  value?: string;
}[] = [
  { id: "text", label: "Text", icon: "text", value: "Write something…" },
  { id: "page", label: "Page", icon: "page" },
  { id: "task", label: "Task list", icon: "tasks", value: "- [ ] New task" },
  { id: "attachment", label: "File attachment", icon: "attachment" },
  { id: "image", label: "Image", icon: "image" },
  {
    id: "code",
    label: "Code block",
    icon: "code",
    value: "```\nYour code here\n```",
  },
  { id: "quote", label: "Quote", icon: "quote", value: "> Add a quote" },
  {
    id: "bullet",
    label: "Bulleted list",
    icon: "bulletList",
    value: "- List item",
  },
  {
    id: "number",
    label: "Numbered list",
    icon: "numberedList",
    value: "1. List item",
  },
];
export const documentDropType = "application/x-fable-block";

export function DocumentInsertPanel({
  editor,
  document: doc,
  documents,
  onAttach,
}: {
  editor: RefObject<EditorHandle | null>;
  document: DocumentSnapshot;
  documents: DocumentSnapshot[];
  onAttach: (imageOnly?: boolean) => void;
}) {
  const [table, setTable] = useState({ rows: 0, columns: 0 });
  const [pages, setPages] = useState(false),
    [query, setQuery] = useState("");
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    setPages(false);
    setQuery("");
  }, [doc.id]);
  const insert = (text: string) => editor.current?.insertBlock(text);
  const choose = (item: (typeof insertItems)[number]) => {
    if (item.id === "page") setPages(!pages);
    else if (item.id === "attachment" || item.id === "image")
      onAttach(item.id === "image");
    else if (item.value) insert(item.value);
  };
  return (
    <aside
      className="document-insert-panel"
      aria-label="Insert content"
      ref={panel}
    >
      <section className="insert-blocks">
        <h2>Insert</h2>
        <p>Drag and drop any item to the document</p>
        <div className="insert-items">
          {insertItems.map((item) => (
            <div className="insert-item-wrap" key={item.id}>
              <button
                className="insert-item"
                type="button"
                draggable={!!item.value}
                aria-expanded={item.id === "page" ? pages : undefined}
                onDragStart={(e) => {
                  if (item.value) {
                    e.dataTransfer.setData(documentDropType, item.value);
                    e.dataTransfer.effectAllowed = "copy";
                  }
                }}
                onClick={() => choose(item)}
              >
                <Icon name={item.icon} size={17} />
                <span>{item.label}</span>
                <Icon
                  name={
                    item.value ? "drag" : item.id === "page" ? "down" : "add"
                  }
                  size={13}
                />
              </button>
              {item.id === "page" && pages && (
                <div className="insert-page-picker">
                  <input
                    autoFocus
                    placeholder="Find a page…"
                    aria-label="Find a page to insert"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setPages(false);
                    }}
                  />
                  <div>
                    {documents
                      .filter(
                        (d) =>
                          d.id !== doc.id &&
                          d.title.toLowerCase().includes(query.toLowerCase()),
                      )
                      .slice(0, 15)
                      .map((page) => (
                        <button
                          key={page.id}
                          onClick={() => {
                            insert(
                              `[${page.title.replace(/[\[\]\\]/g, "\\$&")}](${relativeVaultHref(doc.path, page.path)})`,
                            );
                            setPages(false);
                          }}
                        >
                          <Icon name="page" size={15} />
                          <span>{page.title}</span>
                        </button>
                      ))}
                    {!documents.some(
                      (d) =>
                        d.id !== doc.id &&
                        d.title.toLowerCase().includes(query.toLowerCase()),
                    ) && <p>No matching pages.</p>}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
      <section className="insert-lines">
        <h2>Insert line</h2>
        <div className="insert-line-grid">
          {[
            { name: "Dotted", value: "***", style: "dotted" },
            { name: "Dashed", value: "- - -", style: "dashed" },
            { name: "Thin", value: "---", style: "thin" },
            { name: "Thick", value: "___", style: "thick" },
          ].map((line) => (
            <button
              type="button"
              className="insert-line"
              aria-label={`Insert ${line.name.toLowerCase()} divider`}
              title={`${line.name} divider`}
              key={line.name}
              draggable
              onDragStart={(e) =>
                e.dataTransfer.setData(documentDropType, line.value)
              }
              onClick={() => insert(line.value)}
            >
              <span className={`line-sample line-${line.style}`} />
              <Icon name="drag" size={13} />
            </button>
          ))}
        </div>
      </section>
      <section className="insert-table">
        <div className="insert-table-heading">
          <h2>Insert table</h2>
          {table.rows > 0 && (
            <output>
              {table.columns} × {table.rows}
            </output>
          )}
        </div>
        <p>Insert a table with the highlighted rows and columns.</p>
        <div
          className="table-size-grid"
          onMouseLeave={() => setTable({ rows: 0, columns: 0 })}
        >
          {Array.from({ length: 56 }, (_, i) => {
            const rows = Math.floor(i / 8) + 1,
              columns = (i % 8) + 1;
            return (
              <button
                key={i}
                type="button"
                aria-label={`Insert table with ${rows} ${rows === 1 ? "row" : "rows"} and ${columns} ${columns === 1 ? "column" : "columns"}`}
                className={
                  rows <= table.rows && columns <= table.columns
                    ? "is-selected"
                    : ""
                }
                onMouseEnter={() => setTable({ rows, columns })}
                onFocus={() => setTable({ rows, columns })}
                onClick={() => {
                  insert(markdownTable(rows, columns));
                  setTable({ rows: 0, columns: 0 });
                }}
              />
            );
          })}
        </div>
      </section>
    </aside>
  );
}
