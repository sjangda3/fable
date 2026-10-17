import { useEffect, useId, useRef, useState, type RefObject } from "react";
import {
  AnimatePresence,
  motion,
  useIsPresent,
  useReducedMotion,
} from "framer-motion";
import { DropdownMenu } from "./DropdownMenu.tsx";
import { Icon, type IconName } from "../../../packages/ui/icons.tsx";
import type { DocumentSnapshot } from "../../../packages/contracts/index.ts";
import type { EditorHandle } from "./Editor.tsx";
import {
  emptyFormatting,
  markdownTable,
  type EditorCommand,
  type EditorFormatting,
  type EditorMode,
} from "./editor-commands.ts";
import { relativeVaultHref } from "./links.ts";
import { IconButton } from "./components.tsx";
import { NotebookExportDialog } from "./NotebookExportDialog.tsx";
import {
  notebookExportPages,
  type NotebookExportPage,
} from "./notebook-export.ts";

const textStyles: { command: EditorCommand; label: string }[] = [
  { command: "paragraph", label: "Normal text" },
  { command: "heading1", label: "Heading 1" },
  { command: "heading2", label: "Heading 2" },
  { command: "heading3", label: "Heading 3" },
];

export function TextStyleMenu({
  block,
  run,
  onError,
  label = "Text style",
}: {
  block: string;
  run: (command: EditorCommand) => void;
  onError: (message: string) => void;
  label?: string;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const selectedLabel =
    textStyles.find((style) => style.command === block)?.label ?? "Normal text";
  const [anchor, setAnchor] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);
  const open = () => {
    const bounds = trigger.current?.getBoundingClientRect();
    if (bounds)
      setAnchor({ left: bounds.left, top: bounds.bottom + 4, width: 128 });
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="format-style"
        aria-label={label}
        title={selectedLabel}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => (anchor ? setAnchor(null) : open())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            open();
          }
        }}
      >
        <span>{selectedLabel}</span>
        <Icon name="down" size={12} />
      </button>
      <AnimatePresence>
        {anchor && (
          <DropdownMenu
            label={label}
            showIcons={false}
            anchor={anchor}
            returnFocus={trigger.current}
            onClose={() => setAnchor(null)}
            onError={onError}
            items={textStyles.map((style) => ({
              id: style.command,
              label: style.label,
              icon: "text",
              checked: block === style.command,
              onSelect: () => run(style.command),
            }))}
          />
        )}
      </AnimatePresence>
    </>
  );
}

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
        size={16}
        className={command === "outdent" ? "flip-icon" : ""}
      />
    </button>
  );
}

export function DocumentToolbar({
  document,
  editor,
  formatting = emptyFormatting,
  mode,
  onModeChange,
  onError,
  insertOpen,
  onInsert,
  children,
}: {
  document: DocumentSnapshot;
  editor: RefObject<EditorHandle | null>;
  formatting?: EditorFormatting;
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  onError: (message: string) => void;
  insertOpen: boolean;
  onInsert: () => void;
  children: React.ReactNode;
}) {
  const run = (command: EditorCommand) => editor.current?.command(command);
  const reducedMotion = useReducedMotion();
  const preview = mode === "preview";
  const [exportPages, setExportPages] = useState<NotebookExportPage[] | null>(
    null,
  );
  return (
    <>
      <div
        className="document-formatbar"
        role="toolbar"
        aria-label="Document formatting"
      >
        {!preview && (
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
              <TextStyleMenu
                block={formatting.block}
                run={run}
                onError={onError}
              />
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
            </div>
            <div className="format-group">
              <FormatButton
                command="bulletList"
                label="Bulleted list"
                active={formatting.list === "bulletList"}
                run={run}
              />
              <FormatButton
                command="taskList"
                label="Task list"
                active={formatting.list === "taskList"}
                run={run}
              />
            </div>
            <div className="format-group">
              <FormatButton command="link" label="Insert link" run={run} />
            </div>
          </div>
        )}
        <div className="document-actions">
          <div
            className="editor-mode-switch"
            role="group"
            aria-label="Editor view"
          >
            {(
              [
                { value: "live", label: "Live editor", icon: "edit" },
                { value: "preview", label: "Preview", icon: "view" },
              ] as const
            ).map((item) => (
              <motion.button
                type="button"
                key={item.value}
                aria-label={item.label}
                title={item.label}
                aria-pressed={mode === item.value}
                onClick={() => onModeChange(item.value)}
                animate={{ opacity: mode === item.value ? 1 : 0.55 }}
                whileHover={{ opacity: 1 }}
                whileTap={{ opacity: 0.8 }}
                transition={{
                  duration: reducedMotion ? 0 : 0.2,
                  ease: [0.32, 0.72, 0, 1],
                }}
              >
                <Icon name={item.icon} size={14} />
                <span className="editor-mode-label">{item.label}</span>
              </motion.button>
            ))}
          </div>
          <IconButton
            icon="search"
            label="Find in notebook (⌘ F)"
            onClick={() => run("search")}
          />
          {!preview && (
            <IconButton
              icon="fileAdd"
              label="Add notebook page"
              onClick={() => editor.current?.addPage()}
            />
          )}
          <IconButton
            icon="download"
            label="Download PDF"
            aria-haspopup="dialog"
            onClick={() => {
              const pages = editor.current?.getPages();
              if (pages) setExportPages(notebookExportPages(pages));
            }}
          />
          {children}
          {!preview && (
            <IconButton
              icon="panel"
              label={insertOpen ? "Hide insert panel" : "Show insert panel"}
              className={insertOpen ? "mode-selected" : ""}
              onClick={onInsert}
            />
          )}
        </div>
      </div>
      {exportPages && (
        <NotebookExportDialog
          key={document.id}
          title={document.title}
          path={document.path}
          pages={exportPages}
          onClose={() => setExportPages(null)}
        />
      )}
    </>
  );
}

type InsertPicker = "page" | "divider" | "table";
type InsertItem = {
  id: string;
  label: string;
  icon: IconName;
  value?: string;
  picker?: InsertPicker;
};
const insertGroups: { label: string; items: InsertItem[] }[] = [
  {
    label: "Insert",
    items: [
      { id: "text", label: "Text", icon: "text", value: "Write something…" },
      { id: "newPage", label: "New notebook page", icon: "fileAdd" },
      { id: "page", label: "Link to page", icon: "page", picker: "page" },
      { id: "image", label: "Image", icon: "image" },
      { id: "attachment", label: "File attachment", icon: "attachment" },
    ],
  },
  {
    label: "Lists",
    items: [
      {
        id: "task",
        label: "Task list",
        icon: "tasks",
        value: "- [ ] New task",
      },
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
    ],
  },
  {
    label: "Layout",
    items: [
      { id: "quote", label: "Quote", icon: "quote", value: "> Add a quote" },
      { id: "divider", label: "Divider", icon: "divider", picker: "divider" },
      { id: "table", label: "Table", icon: "table", picker: "table" },
    ],
  },
];
const dividerItems = [
  { name: "Dotted", value: "***", style: "dotted" },
  { name: "Dashed", value: "- - -", style: "dashed" },
  { name: "Thin", value: "---", style: "thin" },
  { name: "Thick", value: "___", style: "thick" },
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
  const [expanded, setExpanded] = useState<InsertPicker | null>(null);
  const [query, setQuery] = useState("");
  const panel = useRef<HTMLElement>(null);
  const panelId = useId();
  const reducedMotion = useReducedMotion();
  const present = useIsPresent();
  useEffect(() => {
    setExpanded(null);
    setQuery("");
    setTable({ rows: 0, columns: 0 });
  }, [doc.id]);
  const insert = (text: string) => editor.current?.insertBlock(text);
  const matchingPages = documents.filter(
    (page) =>
      page.id !== doc.id &&
      page.title.toLowerCase().includes(query.toLowerCase()),
  );
  const choose = (item: InsertItem) => {
    if (item.picker) {
      setExpanded(expanded === item.picker ? null : item.picker);
      setTable({ rows: 0, columns: 0 });
    } else if (item.id === "newPage") {
      editor.current?.addPage();
    } else if (item.id === "attachment" || item.id === "image") {
      onAttach(item.id === "image");
    } else if (item.value) insert(item.value);
  };
  return (
    <motion.aside
      className="document-insert-panel"
      aria-label="Insert content"
      inert={!present}
      aria-hidden={!present}
      initial={{ opacity: 0, x: reducedMotion ? 0 : 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: reducedMotion ? 0 : 16 }}
      transition={{
        duration: reducedMotion ? 0 : 0.24,
        ease: [0.32, 0.72, 0, 1],
      }}
      ref={panel}
      onKeyDown={(event) => {
        if (event.key === "Escape" && expanded) {
          event.stopPropagation();
          panel.current
            ?.querySelector<HTMLButtonElement>('[aria-expanded="true"]')
            ?.focus();
          setExpanded(null);
        }
      }}
    >
      {insertGroups.map((group, index) => (
        <section
          className="insert-section"
          key={group.label}
          aria-labelledby={`${panelId}-group-${index}`}
        >
          <header className="insert-section-heading">
            <h2 id={`${panelId}-group-${index}`}>{group.label}</h2>
          </header>
          <div className="insert-items">
            {group.items.map((item) => (
              <div className="insert-item-wrap" key={item.id}>
                <button
                  className="insert-item"
                  type="button"
                  draggable={!!item.value}
                  aria-expanded={
                    item.picker ? expanded === item.picker : undefined
                  }
                  aria-controls={
                    item.picker ? `${panelId}-${item.picker}` : undefined
                  }
                  title={
                    item.value
                      ? "Click to insert or drag into your page"
                      : undefined
                  }
                  onDragStart={(event) => {
                    if (item.value) {
                      event.dataTransfer.setData(documentDropType, item.value);
                      event.dataTransfer.effectAllowed = "copy";
                    }
                  }}
                  onClick={() => choose(item)}
                >
                  <Icon name={item.icon} size={16} />
                  <span>{item.label}</span>
                  {item.picker === "table" &&
                    expanded === "table" &&
                    table.rows > 0 && (
                      <output className="insert-table-size" aria-live="polite">
                        {table.columns} × {table.rows}
                      </output>
                    )}
                  {item.picker ? (
                    <Icon name="down" size={14} className="insert-chevron" />
                  ) : item.value ? (
                    <Icon
                      name="drag"
                      size={14}
                      className="insert-drag-handle"
                    />
                  ) : null}
                </button>
                {item.picker === "page" && expanded === "page" && (
                  <div className="insert-page-picker" id={`${panelId}-page`}>
                    <input
                      autoFocus
                      placeholder="Find a page…"
                      aria-label="Find a page to insert"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                    <div>
                      {matchingPages.slice(0, 15).map((page) => (
                        <button
                          type="button"
                          key={page.id}
                          onClick={() => {
                            insert(
                              `[${page.title.replace(/[\[\]\\]/g, "\\$&")}](${relativeVaultHref(doc.path, page.path)})`,
                            );
                            setExpanded(null);
                          }}
                        >
                          <Icon name="page" size={16} />
                          <span>{page.title}</span>
                        </button>
                      ))}
                      {!matchingPages.length && <p>No matching pages.</p>}
                    </div>
                  </div>
                )}
                {item.picker === "divider" && expanded === "divider" && (
                  <div className="insert-line-grid" id={`${panelId}-divider`}>
                    {dividerItems.map((line) => (
                      <button
                        type="button"
                        className="insert-line"
                        aria-label={`Insert ${line.name.toLowerCase()} divider`}
                        key={line.name}
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.setData(
                            documentDropType,
                            line.value,
                          );
                          event.dataTransfer.effectAllowed = "copy";
                        }}
                        onClick={() => {
                          insert(line.value);
                          setExpanded(null);
                        }}
                      >
                        <span>{line.name}</span>
                        <span className={`line-sample line-${line.style}`} />
                      </button>
                    ))}
                  </div>
                )}
                {item.picker === "table" && expanded === "table" && (
                  <div className="insert-table-picker" id={`${panelId}-table`}>
                    <p>Choose rows and columns</p>
                    <div
                      className="table-size-grid"
                      onMouseLeave={() => setTable({ rows: 0, columns: 0 })}
                      onBlur={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget))
                          setTable({ rows: 0, columns: 0 });
                      }}
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
                              setExpanded(null);
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </motion.aside>
  );
}
