import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  AnimatePresence,
  LayoutGroup,
  MotionConfig,
  motion,
  useIsPresent,
  useReducedMotion,
} from "framer-motion";
import type {
  DocumentSnapshot,
  SidebarReorder,
} from "../../../packages/contracts/index.ts";
import {
  documentFolder,
  areaFor,
  projectFor,
  sidebarPageDirectory,
  UNASSIGNED_AREA,
} from "../../../packages/domain/index.ts";
import { Icon } from "../../../packages/ui/icons.tsx";
import { IconButton } from "./components.tsx";
import {
  orderedSidebarIds,
  orderedSidebarPages,
  sidebarOrderKey,
} from "../../../packages/domain/sidebar.ts";
import { useSidebarDrag } from "./useSidebarDrag.tsx";
import type { SidebarItem } from "./sidebar-drag.ts";
import { MovePageDialog } from "./MovePageDialog.tsx";
import { DropdownMenu, type DropdownEntry } from "./DropdownMenu.tsx";

type Props = {
  areas: DocumentSnapshot[];
  areaId: string;
  documents: DocumentSnapshot[];
  directories: string[];
  activeId?: string;
  pinned: string[];
  sidebarOrder: Record<string, string[]>;
  onReorder: (request: Omit<SidebarReorder, "revision">) => Promise<void>;
  onMovePage: (
    id: string,
    parentId: string,
    directory: string,
  ) => Promise<void>;
  mode: "projects" | "files" | "bookmarks";
  onArea: (id: string) => void;
  onOpen: (id: string) => void;
  onBrowse: () => void;
  tasksActive: boolean;
  onTasks: () => void;
  onNewTask: () => void;
  onNewArea: () => void;
  onNewProject: () => void;
  onNewNote: (parentId: string, directory?: string) => void;
  onNewPage: (projectId: string, directory?: string) => void;
  onNewFolder: (parentId: string, directory?: string) => void;
  onEdit: (id: string) => void;
  onPin: (id: string) => void;
  onCopyPath: (path: string) => Promise<void>;
  onReveal: (target: { id?: string; path?: string }) => Promise<void>;
  canReveal: boolean;
  onMoveProject: (id: string, areaId: string) => Promise<void>;
  onDeleteDocument: (id: string) => Promise<void>;
  onDeleteFolder: (parentId: string, directory: string) => Promise<void>;
  onError: (message: string) => void;
};
type Hover = { project: DocumentSnapshot; top: number; left: number };
type ItemMenuTarget =
  | { kind: "file"; document: DocumentSnapshot }
  | {
      kind: "folder";
      parentId: string;
      directory: string;
      title: string;
      toggleKey: string;
      expanded: boolean;
    };
const notesOnly = (d: DocumentSnapshot) =>
  ["note", "conversation", "insight"].includes(d.kind);

function FolderContents({
  id,
  children,
  className = "",
}: {
  id: string;
  children: ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion(),
    present = useIsPresent();
  const transition = {
    duration: reduced ? 0 : 0.2,
    ease: [0.32, 0.72, 0, 1] as [number, number, number, number],
  };
  return (
    <motion.div
      id={id}
      role="group"
      className="folder-contents"
      inert={!present}
      aria-hidden={!present}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={transition}
      style={{ overflow: "hidden", pointerEvents: present ? "auto" : "none" }}
    >
      <motion.div
        className={className}
        initial={{ y: reduced ? 0 : -4 }}
        animate={{ y: 0 }}
        exit={{ y: reduced ? 0 : -4 }}
        transition={transition}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

export function AreaSidebar(props: Props) {
  const {
    areas,
    areaId,
    documents,
    directories,
    activeId,
    pinned,
    sidebarOrder,
    onReorder,
    onMovePage,
    mode,
    onArea,
    onOpen,
    onBrowse,
    tasksActive,
    onTasks,
    onNewTask,
    onNewArea,
    onNewProject,
    onNewNote,
    onNewPage,
    onNewFolder,
    onEdit,
    onPin,
    onCopyPath,
    onReveal,
    canReveal,
    onMoveProject,
    onDeleteDocument,
    onDeleteFolder,
    onError,
  } = props;
  const reduced = useReducedMotion(),
    id = useId(),
    transition = {
      duration: reduced ? 0 : 0.2,
      ease: [0.32, 0.72, 0, 1] as [number, number, number, number],
    };
  const [menu, setMenu] = useState<{
      left: number;
      top: number;
      width: number;
    } | null>(null),
    [hover, setHover] = useState<Hover | null>(null),
    [closed, setClosed] = useState<Set<string>>(() => {
      const lookup = new Map(documents.map((doc) => [doc.id, doc]));
      const projectsWithPages = new Set(
        documents
          .filter((doc) => doc.kind === "note")
          .map((page) => projectFor(page, lookup)?.id),
      );
      return new Set(
        documents
          .filter(
            (doc) => doc.kind === "project" && !projectsWithPages.has(doc.id),
          )
          .map((project) => project.id),
      );
    }),
    [allNotes, setAllNotes] = useState<Set<string>>(new Set());
  const [movingPage, setMovingPage] = useState<DocumentSnapshot | null>(null);
  const [projectMenu, setProjectMenu] = useState<{
    project: DocumentSnapshot;
    left: number;
    top: number;
    trigger: HTMLElement;
  } | null>(null);
  const [itemMenu, setItemMenu] = useState<{
    target: ItemMenuTarget;
    left: number;
    top: number;
    trigger: HTMLElement;
  } | null>(null);
  const drag = useSidebarDrag({
    onReorder,
    onMovePage,
    onExpand: (key) =>
      setClosed((previous) => {
        if (!previous.has(key)) return previous;
        const next = new Set(previous);
        next.delete(key);
        return next;
      }),
  });
  const switcher = useRef<HTMLButtonElement>(null),
    revealedNote = useRef<string | undefined>(undefined),
    hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const area = areas.find((a) => a.id === areaId),
    areaName = area?.title ?? "Unassigned";
  const grouped = useMemo(() => {
    const lookup = new Map(documents.map((d) => [d.id, d])),
      byProject = new Map<string, DocumentSnapshot[]>(),
      loose: DocumentSnapshot[] = [];
    for (const note of documents.filter(notesOnly)) {
      const parent = projectFor(note, lookup);
      if (parent) {
        const list = byProject.get(parent.id) ?? [];
        list.push(note);
        byProject.set(parent.id, list);
      } else loose.push(note);
    }
    const projects = documents
      .filter((d) => d.kind === "project")
      .sort(
        (a, b) =>
          Number(pinned.includes(b.id)) - Number(pinned.includes(a.id)) ||
          a.metadata.rank.localeCompare(b.metadata.rank) ||
          a.title.localeCompare(b.title),
      );
    const projectLookup = new Map(
      projects.map((project) => [project.id, project]),
    );
    return {
      projects: orderedSidebarIds(
        projects.map((project) => project.id),
        sidebarOrder[sidebarOrderKey("projects", areaId)],
      ).map((id) => projectLookup.get(id)!),
      byProject,
      loose,
      lookup,
    };
  }, [documents, pinned, sidebarOrder, areaId]);
  const closeHover = () => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHover(null), 140);
  };
  const showHover = (project: DocumentSnapshot, element: HTMLElement) => {
    if (drag.active || drag.busy || menu || projectMenu || itemMenu) return;
    clearTimeout(hoverTimer.current);
    const rect = element.getBoundingClientRect();
    hoverTimer.current = setTimeout(
      () =>
        setHover({
          project,
          left: Math.min(rect.right + 12, window.innerWidth - 340),
          top: Math.max(8, Math.min(rect.top, window.innerHeight - 220)),
        }),
      450,
    );
  };
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  useEffect(() => {
    setHover(null);
    setMenu(null);
    setProjectMenu(null);
    setItemMenu(null);
    drag.reset();
    setMovingPage(null);
  }, [areaId, mode]);
  useEffect(() => {
    if (!drag.active) return;
    clearTimeout(hoverTimer.current);
    setHover(null);
    setProjectMenu(null);
    setItemMenu(null);
    setAllNotes(new Set(grouped.projects.map((project) => project.id)));
  }, [drag.active]);
  useEffect(() => {
    if (!activeId) {
      revealedNote.current = undefined;
      return;
    }
    const project = grouped.projects.find(
      (p) =>
        p.id === activeId ||
        grouped.byProject.get(p.id)?.some((n) => n.id === activeId),
    );
    const activeNote = project
      ? grouped.byProject.get(project.id)?.find((note) => note.id === activeId)
      : undefined;
    const revealKey = `${areaId}:${activeId}:${project?.id ?? ""}:${activeNote?.path ?? ""}`;
    if (revealedNote.current === revealKey) return;
    revealedNote.current = revealKey;
    if (project) {
      setClosed((previous) => {
        const next = new Set(previous);
        next.delete(project.id);
        const base = documentFolder(project);
        if (activeNote?.path.startsWith(base + "/")) {
          const parts = activeNote.path
            .slice(base.length + 1)
            .split("/")
            .slice(0, -1);
          for (let depth = 1; depth <= parts.length; depth++)
            next.delete(`${project.id}:${parts.slice(0, depth).join("/")}`);
        }
        return next;
      });
      if (
        orderedSidebarPages(
          grouped.byProject.get(project.id) ?? [],
          project,
          sidebarOrder,
        ).findIndex((note) => note.id === activeId) >= 5
      )
        setAllNotes((previous) => new Set([...previous, project.id]));
    }
  }, [activeId, grouped, areaId]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setHover(null);
        clearTimeout(hoverTimer.current);
      }
    };
    const moved = () => {
      setHover(null);
      clearTimeout(hoverTimer.current);
    };
    document.addEventListener("keydown", key);
    window.addEventListener("resize", moved);
    window.addEventListener("fable:sidebar-scroll", moved);
    return () => {
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", moved);
      window.removeEventListener("fable:sidebar-scroll", moved);
    };
  }, []);
  const openProjectMenu = (
    project: DocumentSnapshot,
    trigger: HTMLElement,
    left: number,
    top: number,
  ) => {
    clearTimeout(hoverTimer.current);
    setHover(null);
    setMenu(null);
    setItemMenu(null);
    setProjectMenu({ project, trigger, left, top });
  };
  const openItemMenu = (
    target: ItemMenuTarget,
    trigger: HTMLElement,
    left: number,
    top: number,
  ) => {
    clearTimeout(hoverTimer.current);
    setHover(null);
    setMenu(null);
    setProjectMenu(null);
    setItemMenu({ target, trigger, left, top });
  };
  const projectMenuItems = (project: DocumentSnapshot): DropdownEntry[] => [
    {
      id: "open",
      label: "Open project",
      icon: "folderOpen",
      onSelect: () => onOpen(project.id),
    },
    {
      id: "finder",
      label: "Show in Finder",
      icon: "folder",
      disabled: !canReveal,
      hint: canReveal ? undefined : "Available in the desktop app",
      onSelect: () => onReveal({ id: project.id }),
    },
    {
      id: "copy",
      label: "Copy path",
      icon: "copy",
      onSelect: () => onCopyPath(project.path),
    },
    { separator: true },
    {
      id: "page",
      label: "New page",
      icon: "fileAdd",
      onSelect: () => onNewPage(project.id),
    },
    {
      id: "folder",
      label: "New folder",
      icon: "folderAdd",
      onSelect: () => onNewFolder(project.id),
    },
    { separator: true },
    {
      id: "move",
      label: "Move to area",
      icon: "areas",
      children: [
        ...areas.map((option) => ({
          id: option.id,
          label: option.title,
          icon: "areas" as const,
          checked: areaId === option.id,
          onSelect: () =>
            option.id === areaId
              ? undefined
              : onMoveProject(project.id, option.id),
        })),
        { separator: true },
        {
          id: "new-area",
          label: "New area…",
          icon: "add",
          onSelect: onNewArea,
        },
      ],
    },
    {
      id: "edit",
      label: "Edit project",
      icon: "edit",
      onSelect: () => onEdit(project.id),
    },
    {
      id: "pin",
      label: pinned.includes(project.id) ? "Unpin project" : "Pin project",
      icon: "pin",
      onSelect: () => onPin(project.id),
    },
    { separator: true },
    {
      id: "delete",
      label: "Delete",
      icon: "trash",
      onSelect: () => onDeleteDocument(project.id),
    },
  ];
  const toggle = (key: string) => {
    clearTimeout(hoverTimer.current);
    setHover(null);
    setClosed((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const itemMenuItems = (target: ItemMenuTarget): DropdownEntry[] => {
    const relative =
      target.kind === "file" ? target.document.path : target.directory;
    const common: DropdownEntry[] = [
      {
        id: "finder",
        label: "Show in Finder",
        icon: "folder",
        disabled: !canReveal,
        hint: canReveal ? undefined : "Available in the desktop app",
        onSelect: () => onReveal({ path: relative }),
      },
      {
        id: "copy",
        label: "Copy path",
        icon: "copy",
        onSelect: () => onCopyPath(relative),
      },
    ];
    if (target.kind === "folder")
      return [
        {
          id: "toggle",
          label: target.expanded ? "Collapse folder" : "Expand folder",
          icon: target.expanded ? "folder" : "folderOpen",
          onSelect: () => toggle(target.toggleKey),
        },
        ...common,
        { separator: true },
        {
          id: "page",
          label: grouped.projects.some((p) => p.id === target.parentId)
            ? "New page"
            : "New note",
          icon: "fileAdd",
          onSelect: () =>
            grouped.projects.some((p) => p.id === target.parentId)
              ? onNewPage(target.parentId, target.directory)
              : onNewNote(target.parentId, target.directory),
        },
        {
          id: "folder",
          label: "New folder",
          icon: "folderAdd",
          onSelect: () => onNewFolder(target.parentId, target.directory),
        },
        { separator: true },
        {
          id: "delete",
          label: "Delete",
          icon: "trash",
          onSelect: () => onDeleteFolder(target.parentId, target.directory),
        },
      ];
    const file = target.document;
    return [
      {
        id: "open",
        label: "Open file",
        icon: "page",
        onSelect: () => onOpen(file.id),
      },
      ...common,
      { separator: true },
      ...(file.kind === "note"
        ? [
            {
              id: "move",
              label: "Move to…",
              icon: "folderOpen" as const,
              onSelect: () => setMovingPage(file),
            },
          ]
        : []),
      {
        id: "edit",
        label: "Edit properties",
        icon: "edit",
        onSelect: () => onEdit(file.id),
      },
      {
        id: "pin",
        label: pinned.includes(file.id) ? "Unpin file" : "Pin file",
        icon: "pin",
        onSelect: () => onPin(file.id),
      },
      { separator: true },
      {
        id: "delete",
        label: "Delete",
        icon: "trash",
        onSelect: () => onDeleteDocument(file.id),
      },
    ];
  };
  const selection = (key: string) =>
    activeId === key && (
      <motion.span
        layoutId={`${id}-selection`}
        className="area-row-selection"
        transition={transition}
      />
    );
  const sortItems = <T,>(
    items: T[],
    kind: SidebarReorder["kind"],
    parentId: string,
    directory: string | undefined,
    getId: (item: T) => string,
  ) => {
    const lookup = new Map(items.map((item) => [getId(item), item]));
    return orderedSidebarIds(
      items.map(getId),
      sidebarOrder[sidebarOrderKey(kind, parentId, directory)],
    ).map((id) => lookup.get(id)!);
  };
  const pageItem = (note: DocumentSnapshot): SidebarItem => {
    const owner =
      projectFor(note, grouped.lookup) ?? areaFor(note, grouped.lookup);
    return {
      kind: "page",
      id: note.id,
      title: note.title,
      parentId: owner?.id ?? UNASSIGNED_AREA,
      directory: owner
        ? sidebarPageDirectory(note, owner)
        : note.path.slice(0, note.path.lastIndexOf("/")),
    };
  };
  const projectItem = (project: DocumentSnapshot): SidebarItem => ({
    kind: "project",
    id: project.id,
    title: project.title,
    parentId: areaId,
    directory: documentFolder(project),
  });
  const noteRow = (
    note: DocumentSnapshot,
    depth = 0,
    siblings: DocumentSnapshot[] = [],
  ) => {
    const item = pageItem(note),
      draggable = note.kind === "note";
    return (
      <motion.div
        layout="position"
        transition={transition}
        animate={{
          opacity: drag.active === `page:${note.id}` ? 0.4 : 1,
          scale: drag.active === `page:${note.id}` && !reduced ? 0.98 : 1,
        }}
        className={`area-note-row ${note.id === activeId ? "is-active" : ""}`}
        key={note.id}
        style={{ "--note-depth": depth } as React.CSSProperties}
      >
        {selection(note.id)}
        <div
          className="area-note-content"
          {...(draggable ? drag.bind(item) : {})}
        >
          {drag.indicator(item)}
          <button
            onClick={() => onOpen(note.id)}
            title={note.title}
            aria-describedby={draggable ? `${id}-drag-help` : undefined}
            onKeyDown={(event) => {
              if (
                event.key === "ContextMenu" ||
                (event.shiftKey && event.key === "F10")
              ) {
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                openItemMenu(
                  { kind: "file", document: note },
                  event.currentTarget,
                  rect.left + 24,
                  rect.bottom + 4,
                );
                return;
              }
              if (!draggable) return;
              if (event.altKey && event.key.toLowerCase() === "m") {
                event.preventDefault();
                setMovingPage(note);
              } else
                drag.keyboard(
                  event,
                  item,
                  siblings.filter((n) => n.kind === "note").map(pageItem),
                );
            }}
            aria-keyshortcuts="Shift+F10"
            onContextMenu={(event) => {
              event.preventDefault();
              openItemMenu(
                { kind: "file", document: note },
                event.currentTarget,
                event.clientX,
                event.clientY,
              );
            }}
          >
            <Icon
              name={
                note.kind === "conversation"
                  ? "ai"
                  : note.kind === "note" && projectFor(note, grouped.lookup)
                    ? "page"
                    : "note"
              }
              size={16}
            />
            <span>{note.title}</span>
          </button>
          {draggable && (
            <span className="area-row-actions">
              <IconButton
                variant="plain"
                icon="more"
                size={15}
                label={`Actions for ${note.title}`}
                disabled={drag.busy}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  openItemMenu(
                    { kind: "file", document: note },
                    event.currentTarget,
                    rect.left,
                    rect.bottom + 4,
                  );
                }}
              />
            </span>
          )}
        </div>
      </motion.div>
    );
  };
  const tree = (
    notes: DocumentSnapshot[],
    base: string,
    parentId: string,
  ): ReactNode => {
    const children = new Map<string, DocumentSnapshot[]>(),
      root: DocumentSnapshot[] = [];
    for (const note of notes) {
      const relative = note.path.startsWith(base + "/")
        ? note.path.slice(base.length + 1)
        : note.path.split("/").at(-1)!;
      const folder = relative.includes("/")
        ? relative.slice(0, relative.lastIndexOf("/"))
        : "";
      if (folder) {
        const list = children.get(folder) ?? [];
        list.push(note);
        children.set(folder, list);
      } else root.push(note);
    }
    const folders = new Set<string>();
    for (const full of [
      ...(parentId === UNASSIGNED_AREA ? [] : directories)
        .filter((dir) => dir.startsWith(base + "/"))
        .map((dir) => dir.slice(base.length + 1)),
      ...children.keys(),
    ]) {
      const parts = full.split("/");
      for (let n = 1; n <= parts.length; n++)
        folders.add(parts.slice(0, n).join("/"));
    }
    const branch = (prefix = "", depth = 0): ReactNode => {
      const container = prefix ? `${base}/${prefix}` : base;
      const siblingFolders = sortItems(
        [...folders]
          .filter((folder) => {
            const index = folder.lastIndexOf("/");
            return (index < 0 ? "" : folder.slice(0, index)) === prefix;
          })
          .sort(),
        "folders",
        parentId,
        container,
        (folder) => `${base}/${folder}`,
      );
      const folderItem = (folder: string): SidebarItem => ({
        kind: "folder",
        id: `${base}/${folder}`,
        title: folder.split("/").at(-1)!,
        parentId,
        directory: container,
      });
      const siblingNotes = sortItems(
        prefix ? (children.get(prefix) ?? []) : root,
        "pages",
        parentId,
        container,
        (note) => note.id,
      );
      return (
        <>
          {siblingFolders.map((folder) => {
            const key = `${parentId}:${folder}`,
              expanded = !closed.has(key),
              contentsId = `${id}-folder-${encodeURIComponent(key)}`,
              directory = `${base}/${folder}`,
              item = folderItem(folder);
            return (
              <motion.div
                layout="position"
                transition={transition}
                key={key}
                className="area-folder-group"
              >
                <motion.div
                  animate={{
                    opacity: drag.active === `folder:${directory}` ? 0.4 : 1,
                    scale:
                      drag.active === `folder:${directory}` && !reduced
                        ? 0.98
                        : 1,
                  }}
                  transition={transition}
                >
                  <div
                    className="area-folder-row"
                    style={{ "--note-depth": depth } as React.CSSProperties}
                    {...drag.bind(item, key)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      openItemMenu(
                        {
                          kind: "folder",
                          parentId,
                          directory,
                          title: item.title,
                          toggleKey: key,
                          expanded,
                        },
                        event.currentTarget.querySelector<HTMLButtonElement>(
                          "button",
                        )!,
                        event.clientX,
                        event.clientY,
                      );
                    }}
                  >
                    {drag.indicator(item)}
                    <button
                      aria-label={`${expanded ? "Collapse" : "Expand"} ${item.title}`}
                      aria-expanded={expanded}
                      aria-controls={contentsId}
                      aria-describedby={`${id}-drag-help`}
                      onClick={() => toggle(key)}
                      aria-keyshortcuts="Shift+F10"
                      onKeyDown={(event) => {
                        if (
                          event.key === "ContextMenu" ||
                          (event.shiftKey && event.key === "F10")
                        ) {
                          event.preventDefault();
                          const rect =
                            event.currentTarget.getBoundingClientRect();
                          openItemMenu(
                            {
                              kind: "folder",
                              parentId,
                              directory,
                              title: item.title,
                              toggleKey: key,
                              expanded,
                            },
                            event.currentTarget,
                            rect.left + 24,
                            rect.bottom + 4,
                          );
                        } else
                          drag.keyboard(
                            event,
                            item,
                            siblingFolders.map(folderItem),
                          );
                      }}
                    >
                      <motion.span
                        animate={{ rotate: expanded ? 90 : 0 }}
                        transition={transition}
                      >
                        <Icon name="right" size={12} />
                      </motion.span>
                      <Icon
                        name={expanded ? "folderOpen" : "folder"}
                        size={16}
                      />
                      <span>{item.title}</span>
                    </button>
                    <span className="area-row-actions">
                      <IconButton
                        variant="plain"
                        icon="fileAdd"
                        size={15}
                        label={`New ${grouped.projects.some((p) => p.id === parentId) ? "page" : "note"} in ${folder}`}
                        onClick={() =>
                          grouped.projects.some((p) => p.id === parentId)
                            ? onNewPage(parentId, directory)
                            : onNewNote(parentId, directory)
                        }
                      />
                      <IconButton
                        variant="plain"
                        icon="folderAdd"
                        size={15}
                        label={`New folder in ${folder}`}
                        onClick={() => onNewFolder(parentId, directory)}
                      />
                    </span>
                  </div>
                </motion.div>
                <AnimatePresence initial={false}>
                  {expanded && (
                    <FolderContents key="children" id={contentsId}>
                      {branch(folder, depth + 1)}
                    </FolderContents>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
          {siblingNotes.map((note) => noteRow(note, depth, siblingNotes))}
        </>
      );
    };
    return branch();
  };
  const projects =
    mode === "bookmarks"
      ? grouped.projects.filter(
          (project) =>
            pinned.includes(project.id) ||
            grouped.byProject
              .get(project.id)
              ?.some((n) => pinned.includes(n.id)),
        )
      : grouped.projects;
  const hoveredPageCount = hover
    ? (grouped.byProject
        .get(hover.project.id)
        ?.filter((page) => page.kind === "note").length ?? 0)
    : 0;
  return (
    <MotionConfig reducedMotion="user">
      <LayoutGroup id={id}>
        <div
          className={`area-sidebar-content ${drag.active ? "is-dragging" : ""}`}
          aria-busy={drag.busy}
        >
          <span className="visually-hidden" id={`${id}-drag-help`}>
            Drag to reorder. Alt and arrow up or down reorders with the
            keyboard. On a page, Alt and M opens Move page.
          </span>
          <span className="visually-hidden" role="status" aria-live="polite">
            {drag.announcement}
          </span>
          <button
            ref={switcher}
            className={`area-switcher ${menu ? "is-open" : ""}`}
            aria-label={`Switch area, current area ${areaName}`}
            aria-haspopup="menu"
            aria-expanded={!!menu}
            onClick={() => {
              clearTimeout(hoverTimer.current);
              setHover(null);
              setProjectMenu(null);
              setItemMenu(null);
              if (menu) setMenu(null);
              else {
                const rect = switcher.current!.getBoundingClientRect();
                setMenu({
                  left: rect.left,
                  top: rect.bottom + 8,
                  width: rect.width,
                });
              }
            }}
          >
            <Icon name="areas" size={16} className="area-switcher-icon" />
            <span className="area-switcher-name">{areaName}</span>
            <motion.span
              animate={{ rotate: menu ? 180 : 0 }}
              transition={transition}
            >
              <Icon name="down" size={14} />
            </motion.span>
          </button>
          <nav className="area-navigation" aria-label="Area navigation">
            <div className="area-navigation-row">
              <button
                onClick={onTasks}
                aria-current={tasksActive ? "page" : undefined}
              >
                <Icon name="tasks" size={18} />
                <span>Tasks</span>
                <span className="area-task-count">
                  {documents.reduce(
                    (n, doc) =>
                      n + doc.tasks.filter((task) => !task.done).length,
                    0,
                  )}
                </span>
              </button>
              <IconButton
                variant="plain"
                icon="add"
                size={16}
                label="New task"
                onClick={onNewTask}
              />
            </div>
          </nav>
          <div className="area-section-heading">
            <span className="area-projects-label">
              {mode === "bookmarks" ? "Bookmarks" : "Projects"}
            </span>
            <IconButton
              variant="plain"
              icon="add"
              size={16}
              label="New project"
              onClick={onNewProject}
            />
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.nav
              key={`${areaId}:${mode}`}
              aria-label={`${areaName} projects`}
              initial={{ opacity: 0, x: reduced ? 0 : -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: reduced ? 0 : 6 }}
              transition={transition}
              className="area-projects"
            >
              {projects.map((project) => {
                const notes = (grouped.byProject.get(project.id) ?? []).filter(
                  (n) =>
                    (mode !== "projects" || n.kind === "note") &&
                    (mode !== "bookmarks" ||
                      pinned.includes(project.id) ||
                      pinned.includes(n.id)),
                );
                const expanded = !closed.has(project.id),
                  contentsId = `${id}-project-${encodeURIComponent(project.id)}`,
                  item = projectItem(project),
                  orderedNotes = orderedSidebarPages(
                    notes,
                    project,
                    sidebarOrder,
                  ),
                  visible = allNotes.has(project.id)
                    ? orderedNotes
                    : orderedNotes.slice(0, 5);
                return (
                  <motion.section
                    layout="position"
                    transition={transition}
                    className="area-project"
                    animate={{
                      opacity:
                        drag.active === `project:${project.id}` ? 0.4 : 1,
                      scale:
                        drag.active === `project:${project.id}` && !reduced
                          ? 0.98
                          : 1,
                    }}
                    key={project.id}
                  >
                    <div
                      className={`area-project-row ${project.id === activeId ? "is-active" : ""}`}
                      {...drag.bind(item, project.id)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        openProjectMenu(
                          project,
                          event.currentTarget.querySelector<HTMLButtonElement>(
                            ".area-project-open",
                          )!,
                          event.clientX,
                          event.clientY,
                        );
                      }}
                      onMouseEnter={(e) => showHover(project, e.currentTarget)}
                      onMouseLeave={closeHover}
                      onFocus={(e) => {
                        if (
                          e.target ===
                          e.currentTarget.querySelector(".area-project-open")
                        )
                          showHover(project, e.currentTarget);
                      }}
                      onBlur={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node))
                          closeHover();
                      }}
                    >
                      {selection(project.id)}
                      {drag.indicator(item)}
                      <button
                        className="area-project-open"
                        onClick={() => {
                          toggle(project.id);
                        }}
                        aria-label={`${expanded ? "Collapse" : "Expand"} folder ${project.title}`}
                        aria-expanded={expanded}
                        aria-controls={contentsId}
                        aria-describedby={`${id}-drag-help`}
                        aria-keyshortcuts="Shift+F10"
                        onKeyDown={(event) => {
                          if (
                            event.key === "ContextMenu" ||
                            (event.shiftKey && event.key === "F10")
                          ) {
                            event.preventDefault();
                            const rect =
                              event.currentTarget.getBoundingClientRect();
                            openProjectMenu(
                              project,
                              event.currentTarget,
                              rect.left + 24,
                              rect.bottom + 4,
                            );
                          } else
                            drag.keyboard(
                              event,
                              item,
                              projects.map(projectItem),
                            );
                        }}
                      >
                        <motion.span
                          className="area-project-chevron"
                          animate={{ rotate: expanded ? 90 : 0 }}
                          transition={transition}
                        >
                          <Icon name="right" size={12} />
                        </motion.span>
                        <Icon
                          name={expanded ? "folderOpen" : "folder"}
                          size={18}
                        />
                        <span>{project.title}</span>
                      </button>
                      <span className="area-row-actions">
                        <IconButton
                          variant="plain"
                          icon="fileAdd"
                          label={`New page in ${project.title}`}
                          size={16}
                          onClick={() => {
                            setHover(null);
                            clearTimeout(hoverTimer.current);
                            setClosed((previous) => {
                              const next = new Set(previous);
                              next.delete(project.id);
                              return next;
                            });
                            onNewPage(project.id);
                          }}
                        />
                        <IconButton
                          variant="plain"
                          icon="folderAdd"
                          label={`New folder in ${project.title}`}
                          size={16}
                          onClick={() => {
                            setHover(null);
                            clearTimeout(hoverTimer.current);
                            setClosed((previous) => {
                              const next = new Set(previous);
                              next.delete(project.id);
                              return next;
                            });
                            onNewFolder(project.id);
                          }}
                        />
                      </span>
                    </div>
                    <AnimatePresence initial={false}>
                      {expanded && (
                        <FolderContents
                          className="area-project-notes"
                          key="notes"
                          id={contentsId}
                        >
                          {tree(visible, documentFolder(project), project.id)}
                          {notes.length > 5 && (
                            <button
                              className="area-show-more"
                              onClick={() =>
                                setAllNotes((previous) => {
                                  const next = new Set(previous);
                                  if (next.has(project.id))
                                    next.delete(project.id);
                                  else next.add(project.id);
                                  return next;
                                })
                              }
                            >
                              {allNotes.has(project.id)
                                ? "Show less"
                                : `Show ${notes.length - 5} more`}
                            </button>
                          )}
                        </FolderContents>
                      )}
                    </AnimatePresence>
                  </motion.section>
                );
              })}
              {!projects.length && (
                <div className="area-sidebar-empty">
                  <p>
                    {mode === "bookmarks"
                      ? "Keep your important notes close."
                      : "A little room for your next idea."}
                  </p>
                  <button
                    onClick={mode === "bookmarks" ? onBrowse : onNewProject}
                  >
                    {mode === "bookmarks"
                      ? "Show all projects"
                      : "Create a project"}
                    <Icon name="add" size={14} />
                  </button>
                </div>
              )}
              {mode === "files" && (
                <section className="area-loose-notes">
                  <div
                    className="area-section-heading"
                    {...(area
                      ? drag.bind({
                          kind: "root",
                          id: `root:${area.id}`,
                          title: areaName,
                          parentId: area.id,
                          directory: documentFolder(area),
                        })
                      : {})}
                  >
                    {area &&
                      drag.indicator({
                        kind: "root",
                        id: `root:${area.id}`,
                        title: areaName,
                        parentId: area.id,
                        directory: documentFolder(area),
                      })}
                    <span>Notes</span>
                    {area && (
                      <IconButton
                        variant="plain"
                        icon="fileAdd"
                        size={16}
                        label={`New note in ${areaName}`}
                        onClick={() => onNewNote(area.id)}
                      />
                    )}
                  </div>
                  {tree(
                    grouped.loose,
                    area ? documentFolder(area) : "",
                    area?.id ?? UNASSIGNED_AREA,
                  )}
                  {!grouped.loose.length && (
                    <p className="sidebar-hint">
                      Notes for {areaName} live here.
                    </p>
                  )}
                </section>
              )}
              {mode === "bookmarks" &&
                grouped.loose
                  .filter((n) => pinned.includes(n.id))
                  .map((note) => noteRow(note))}
            </motion.nav>
          </AnimatePresence>
          {drag.error && (
            <p className="sidebar-drag-error" role="alert">
              {drag.error}
            </p>
          )}
          {movingPage && (
            <MovePageDialog
              page={movingPage}
              documents={documents}
              directories={directories}
              onClose={() => setMovingPage(null)}
              onMove={onMovePage}
            />
          )}
          <AnimatePresence>
            {menu && (
              <DropdownMenu
                key="area-menu"
                label="Choose an area"
                anchor={menu}
                returnFocus={switcher.current}
                onClose={() => setMenu(null)}
                onError={onError}
                items={[
                  ...[
                    ...areas.map((option) => ({
                      id: option.id,
                      title: option.title,
                    })),
                    { id: UNASSIGNED_AREA, title: "Unassigned" },
                  ].map((option) => ({
                    id: option.id,
                    label: option.title,
                    icon:
                      option.id === UNASSIGNED_AREA
                        ? ("folder" as const)
                        : ("areas" as const),
                    checked: areaId === option.id,
                    onSelect: () => onArea(option.id),
                  })),
                  { separator: true },
                  {
                    id: "new-area",
                    label: "New area…",
                    icon: "add",
                    onSelect: onNewArea,
                  },
                ]}
              />
            )}
            {projectMenu && (
              <DropdownMenu
                key={`project-menu-${projectMenu.project.id}`}
                label={`Actions for ${projectMenu.project.title}`}
                anchor={projectMenu}
                returnFocus={projectMenu.trigger}
                onClose={() => setProjectMenu(null)}
                onError={onError}
                items={projectMenuItems(projectMenu.project)}
              />
            )}
            {itemMenu && (
              <DropdownMenu
                key={`item-menu-${itemMenu.target.kind === "file" ? itemMenu.target.document.id : itemMenu.target.directory}`}
                label={`Actions for ${itemMenu.target.kind === "file" ? itemMenu.target.document.title : itemMenu.target.title}`}
                anchor={itemMenu}
                returnFocus={itemMenu.trigger}
                onClose={() => setItemMenu(null)}
                onError={onError}
                items={itemMenuItems(itemMenu.target)}
              />
            )}
          </AnimatePresence>
          {createPortal(
            <AnimatePresence>
              {hover && !menu && !projectMenu && !itemMenu && (
                <motion.aside
                  className="project-hover-card"
                  role="dialog"
                  aria-label={`${hover.project.title} details`}
                  style={{ left: hover.left, top: hover.top }}
                  initial={{
                    opacity: 0,
                    x: reduced ? 0 : -4,
                    scale: reduced ? 1 : 0.98,
                  }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{ opacity: 0, x: reduced ? 0 : -4 }}
                  transition={transition}
                  onMouseEnter={() => clearTimeout(hoverTimer.current)}
                  onMouseLeave={closeHover}
                  onFocus={() => clearTimeout(hoverTimer.current)}
                  onBlur={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node))
                      closeHover();
                  }}
                >
                  <div className="project-hover-heading">
                    <Icon name="folderOpen" size={19} />
                    <strong>{hover.project.title}</strong>
                    <IconButton
                      variant="plain"
                      icon="pin"
                      size={16}
                      label={
                        pinned.includes(hover.project.id)
                          ? "Unpin project"
                          : "Pin project"
                      }
                      className={
                        pinned.includes(hover.project.id) ? "is-pinned" : ""
                      }
                      onClick={() => onPin(hover.project.id)}
                    />
                  </div>
                  <div className="project-hover-count">
                    <Icon name="page" size={18} />
                    <span>
                      {hoveredPageCount}{" "}
                      {hoveredPageCount === 1 ? "page" : "pages"}
                    </span>
                  </div>
                  <div className="project-hover-path">
                    <Icon name="folder" size={18} />
                    <span title={hover.project.path}>{hover.project.path}</span>
                  </div>
                  <button
                    className="project-hover-edit"
                    onClick={() => {
                      const project = hover.project;
                      setHover(null);
                      onEdit(project.id);
                    }}
                  >
                    <Icon name="settings" size={18} />
                    <span>Edit project</span>
                    <Icon name="right" size={14} />
                  </button>
                </motion.aside>
              )}
            </AnimatePresence>,
            document.body,
          )}
        </div>
      </LayoutGroup>
    </MotionConfig>
  );
}
