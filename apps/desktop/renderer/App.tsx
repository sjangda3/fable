import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api.ts";
import { resolveVaultLink, relativeVaultHref } from "./links.ts";
import { Icon, type IconName } from "../../../packages/ui/icons.tsx";
import {
  statusLabels,
  areaFor,
  projectFor,
  documentsInArea,
  UNASSIGNED_AREA,
} from "../../../packages/domain/index.ts";
import { AreaSidebar } from "./AreaSidebar.tsx";
import { ProjectPages } from "./ProjectPages.tsx";
import {
  kinds,
  statuses,
  type ChangeSet,
  type DocumentKind,
  type DocumentSnapshot,
  type TaskRef,
  type VaultState,
  type ViewId,
  type WorkStatus,
  type SyncStatus,
  type SidebarReorder,
} from "../../../packages/contracts/index.ts";
import { IconButton, Modal, StatusIcon, EmptyState } from "./components.tsx";
import {
  ProjectsView,
  TasksView,
  GoalsView,
  NotesView,
  InsightsView,
  CompletedView,
} from "./Views.tsx";
import { MarkdownEditor, type EditorHandle } from "./Editor.tsx";
import {
  AIPanel,
  ChangeReview,
  Settings,
  type SettingsTab,
} from "./Panels.tsx";

interface Tab {
  id: string;
  title: string;
  view?: ViewId;
  documentId?: string;
  path?: string;
}
const navigation: [ViewId, string, IconName][] = [
  ["areas", "Areas", "areas"],
  ["goals", "Goals", "goals"],
  ["projects", "Projects", "projects"],
  ["tasks", "Tasks", "tasks"],
  ["insights", "Insights", "insights"],
  ["completed", "Completed", "completed"],
];
const viewTitle = (id: ViewId) =>
  navigation.find((v) => v[0] === id)?.[1] ?? "Notes";
const initialView = () => {
  const value = new URLSearchParams(window.location.search).get("view");
  return [
    "areas",
    "goals",
    "projects",
    "tasks",
    "insights",
    "completed",
    "notes",
  ].includes(value ?? "")
    ? (value as ViewId)
    : "projects";
};

export function App() {
  const [vault, setVault] = useState<VaultState | null>(null),
    [loading, setLoading] = useState(true),
    [tabs, setTabs] = useState<Tab[]>([]),
    [active, setActive] = useState("view:projects"),
    [folders, setFolders] = useState(false),
    [bookmarks, setBookmarks] = useState(false),
    [pinned, setPinned] = useState<string[]>([]),
    [hiddenColumns, setHiddenColumns] = useState<WorkStatus[]>(["done"]);
  const [sidebarWidth, setSidebarWidth] = useState(240),
    [sidebarHidden, setSidebarHidden] = useState(false),
    [aiOpen, setAiOpen] = useState(false),
    [source, setSource] = useState(false),
    [properties, setProperties] = useState(false),
    [saveStatus, setSaveStatus] = useState("Saved");
  const [palette, setPalette] = useState(false),
    [paletteQuery, setPaletteQuery] = useState(""),
    [create, setCreate] = useState<{
      kind: DocumentKind | "task";
      parent?: string;
      status?: WorkStatus;
      directory?: string;
      projectId?: string;
    } | null>(null),
    [settings, setSettings] = useState<SettingsTab | null>(null),
    [help, setHelp] = useState(false),
    [workspaceMenu, setWorkspaceMenu] = useState(false),
    [more, setMore] = useState(false),
    [rename, setRename] = useState<{ id: string; path: string } | null>(null),
    [message, setMessage] = useState(""),
    [undoAvailable, setUndoAvailable] = useState(false);
  const [selectedAreaId, setSelectedAreaId] = useState<string | null>(null),
    [newFolder, setNewFolder] = useState<{
      parentId: string;
      directory?: string;
    } | null>(null);
  const [sidebarOrder, setSidebarOrder] = useState<Record<string, string[]>>(
    {},
  );
  const sidebarOrderRef = useRef(sidebarOrder);
  const areas = useMemo(
    () => vault?.documents.filter((d) => d.kind === "area") ?? [],
    [vault?.documents],
  );
  const areaId =
    selectedAreaId === UNASSIGNED_AREA ||
    areas.some((a) => a.id === selectedAreaId)
      ? selectedAreaId!
      : (areas[0]?.id ?? UNASSIGNED_AREA);
  const areaIdRef = useRef(areaId);
  areaIdRef.current = areaId;
  const areaDocuments = useMemo(
    () => documentsInArea(vault?.documents ?? [], areaId),
    [vault?.documents, areaId],
  );
  const [review, setReview] = useState<{
      set: ChangeSet;
      resolve: (applied: boolean) => void;
    } | null>(null),
    [syncStatus, setSyncStatus] = useState<SyncStatus>({
      state: "local",
      message: "Stored on this device",
      pending: 0,
      conflicts: [],
    });
  const editor = useRef<EditorHandle>(null),
    vaultRef = useRef(vault),
    pendingLine = useRef<number | undefined>(undefined),
    history = useRef<Tab[]>([]),
    position = useRef(-1),
    toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback((value: string, undoable = false) => {
    setMessage(value);
    setUndoAvailable(undoable);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setMessage(""), 6500);
  }, []);
  const viewsRevision = useRef<string | null>(null);
  const loadViews = async () => {
    try {
      const settings = await api.request("views.read", undefined);
      viewsRevision.current = settings.revision;
      sidebarOrderRef.current = settings.sidebarOrder ?? {};
      setSidebarOrder(sidebarOrderRef.current);
      setPinned(settings.bookmarks);
      setHiddenColumns(settings.hiddenColumns);
      setSelectedAreaId(
        (previous) => previous ?? settings.selectedAreaId ?? null,
      );
    } catch (e: any) {
      notify(e.message);
    }
  };
  const saveViews = async (
    bookmarks: string[],
    columns: WorkStatus[],
    selectedAreaId = areaIdRef.current,
  ) => {
    try {
      const settings = await api.request("views.save", {
        bookmarks,
        hiddenColumns: columns,
        revision: viewsRevision.current,
        selectedAreaId,
        sidebarOrder: sidebarOrderRef.current,
      });
      viewsRevision.current = settings.revision;
      setPinned(settings.bookmarks);
      setHiddenColumns(settings.hiddenColumns);
    } catch (e: any) {
      notify(e.message);
      void loadViews();
    }
  };
  const receive = useCallback((state: VaultState) => {
    vaultRef.current = state;
    setVault(state);
  }, []);
  useEffect(
    () =>
      api.beforeClose?.(async () =>
        editor.current ? editor.current.flush() : true,
      ),
    [],
  );
  useEffect(() => {
    let alive = true;
    api
      .request("vault.state", undefined)
      .then((state) => {
        if (!alive) return;
        if (state) {
          receive(state);
          void loadViews();
          const id = initialView(),
            start: Tab = { id: `view:${id}`, title: viewTitle(id), view: id };
          setTabs([start]);
          setActive(start.id);
          history.current = [start];
          position.current = 0;
        }
        setLoading(false);
      })
      .catch((e) => {
        notify(e.message);
        setLoading(false);
      });
    void api.request("sync.status", undefined).then((s) => {
      if (alive) setSyncStatus(s);
    });
    const unsubscribe = api.subscribe((event) => {
      if (event.type === "vault") receive(event.state);
      if (event.type === "error") notify(event.message);
      if (event.type === "sync") {
        setSyncStatus(event.status);
        if (event.status.state === "ready" || event.status.state === "conflict")
          void loadViews();
      }
    });
    return () => {
      alive = false;
      unsubscribe();
      clearTimeout(toastTimer.current);
    };
  }, []);
  const previousDocument = useRef<DocumentSnapshot | undefined>(undefined);
  const current = tabs.find((t) => t.id === active),
    currentDocument = current?.documentId
      ? (vault?.documents.find((d) => d.id === current.documentId) ??
        vault?.documents.find((d) => d.path === current.path))
      : undefined;
  if (currentDocument) previousDocument.current = currentDocument;
  const document =
    currentDocument ??
    (current?.documentId === previousDocument.current?.id &&
    saveStatus !== "Saved"
      ? previousDocument.current
      : undefined);
  const docRef = useRef(document);
  docRef.current = document;
  useEffect(() => {
    if (current && currentDocument)
      setTabs((previous) =>
        previous.map((tab) =>
          tab.id === current.id
            ? {
                ...tab,
                documentId: currentDocument.id,
                path: currentDocument.path,
                title: currentDocument.title,
              }
            : tab,
        ),
      );
  }, [currentDocument?.id, currentDocument?.path, currentDocument?.title]);
  const navigate = async (tab: Tab, record = true) => {
    if (editor.current && !(await editor.current.flush())) return;
    if (tab.documentId) {
      const existing = tabs.find(
        (t) =>
          t.documentId === tab.documentId ||
          (!!tab.path && t.path === tab.path),
      );
      if (existing) tab = { ...tab, id: existing.id };
    }
    setTabs((previous) =>
      previous.some((t) => t.id === tab.id)
        ? previous.map((t) => (t.id === tab.id ? tab : t))
        : [...previous, tab],
    );
    setActive(tab.id);
    setProperties(false);
    setMore(false);
    setSaveStatus("Saved");
    if (record && history.current[position.current]?.id !== tab.id) {
      history.current = history.current.slice(0, position.current + 1);
      history.current.push(tab);
      position.current = history.current.length - 1;
    }
  };
  const openDocument = async (id: string, line?: number) => {
    const d = vaultRef.current?.documents.find((d) => d.id === id);
    if (d) {
      if (editor.current && !(await editor.current.flush())) return false;
      const target =
        areaFor(d, vaultRef.current!.documents)?.id ?? UNASSIGNED_AREA;
      if (target !== areaIdRef.current && !(await selectArea(target)))
        return false;
      pendingLine.current = line;
      await navigate({
        id: `doc:${id}`,
        title: d.title,
        documentId: id,
        path: d.path,
      });
      return true;
    }
  };
  useEffect(() => {
    const open = (event: Event) => {
      const href = (event as CustomEvent<string>).detail;
      if (!href) return;
      if (/^https?:/i.test(href)) {
        if (api.openExternal)
          void api.openExternal(href).catch((e) => notify(e.message));
        else window.open(href, "_blank", "noopener,noreferrer");
        return;
      }
      const wiki = href.startsWith("wiki:"),
        target = wiki
          ? href.slice(5)
          : resolveVaultLink(docRef.current?.path ?? "", href);
      const candidates =
        vaultRef.current?.documents.filter((d) =>
          wiki
            ? d.title === target || d.path.replace(/\.md$/i, "") === target
            : d.path === target,
        ) ?? [];
      if (candidates.length === 1) openDocument(candidates[0].id);
      else if (candidates.length > 1) {
        setPaletteQuery(target ?? "");
        setPalette(true);
      } else if (
        target &&
        /\.(pdf|png|jpe?g|webp|gif|avif|txt|csv)$/i.test(target)
      ) {
        if (window.fable)
          void api
            .request("attachments.open", { path: target })
            .catch((e) => notify(e.message));
        else
          window.open(
            `/api/asset?path=${encodeURIComponent(target)}`,
            "_blank",
            "noopener,noreferrer",
          );
      } else
        notify(
          "This link does not point to a note in your vault. Open the folder to locate or repair it.",
        );
    };
    window.addEventListener("fable:open-link", open);
    return () => window.removeEventListener("fable:open-link", open);
  }, [tabs, active]);
  useEffect(() => {
    if (document && pendingLine.current) {
      const line = pendingLine.current;
      pendingLine.current = undefined;
      setTimeout(() => editor.current?.focusTask(line), 50);
    }
  }, [document?.id]);
  const navigateView = (view: ViewId) => {
    if (view === "notes") setFolders(true);
    void navigate({ id: `view:${view}`, title: viewTitle(view), view });
  };
  const selectArea = async (id: string) => {
    if (editor.current && !(await editor.current.flush())) return false;
    if (aiOpen) {
      void api.request("ai.cancel", undefined);
      setAiOpen(false);
    }
    setSelectedAreaId(id);
    areaIdRef.current = id;
    setProperties(false);
    setMore(false);
    setBookmarks(false);
    const tab: Tab = {
      id: "view:projects",
      title: "Projects",
      view: "projects",
    };
    setTabs([tab]);
    setActive(tab.id);
    history.current = [tab];
    position.current = 0;
    void saveViews(pinned, hiddenColumns, id);
    return true;
  };
  const goHistory = async (direction: number) => {
    const next = position.current + direction;
    if (next < 0 || next >= history.current.length) return;
    const tab = history.current[next];
    if (editor.current && !(await editor.current.flush())) return;
    position.current = next;
    void navigate(tab, false);
  };
  const closeTab = async (id: string) => {
    if (id === active && editor.current && !(await editor.current.flush()))
      return;
    setTabs((previous) => {
      const index = previous.findIndex((t) => t.id === id),
        next = previous.filter((t) => t.id !== id);
      if (!next.length) {
        const tab = {
          id: "view:notes",
          title: "Notes",
          view: "notes" as ViewId,
        };
        setActive(tab.id);
        return [tab];
      }
      if (id === active) setActive(next[Math.max(0, index - 1)].id);
      return next;
    });
  };
  const openFolder = async (sample = false) => {
    if (editor.current && !(await editor.current.flush())) return;
    try {
      const state = await api.request("vault.open", { sample });
      if (state) {
        receive(state);
        setSelectedAreaId(null);
        void loadViews();
        setSettings(null);
        setAiOpen(false);
        const tab: Tab = { id: "view:notes", view: "notes", title: "Notes" };
        setTabs([tab]);
        setActive(tab.id);
        history.current = [tab];
        position.current = 0;
      }
    } catch (e: any) {
      notify(e.message);
    }
  };
  const updateMetadata = async (
    id: string,
    values: Record<string, unknown>,
  ) => {
    if (editor.current && !(await editor.current.flush())) return false;
    const latest = await api.request("vault.state", undefined);
    const doc = latest?.documents.find((d) => d.id === id);
    if (doc) {
      await api.request("documents.metadata", {
        id,
        baseRevision: doc.revision,
        values,
      });
      return true;
    }
    return false;
  };
  const reorderSidebar = async (request: Omit<SidebarReorder, "revision">) => {
    try {
      const settings = await api.request("sidebar.reorder", {
        ...request,
        revision: viewsRevision.current,
      });
      viewsRevision.current = settings.revision;
      sidebarOrderRef.current = settings.sidebarOrder ?? {};
      setSidebarOrder(sidebarOrderRef.current);
      notify("Order saved");
    } catch (error) {
      await loadViews();
      throw error;
    }
  };
  const movePage = async (id: string, parentId: string, directory: string) => {
    if (editor.current && !(await editor.current.flush()))
      throw new Error(
        "Save or preserve the current draft before moving a page.",
      );
    const latest = await api.request("vault.state", undefined),
      page = latest?.documents.find((doc) => doc.id === id);
    if (!page) throw new Error("This page is no longer available.");
    receive(
      await api.request("pages.move", {
        id,
        baseRevision: page.revision,
        parentId,
        directory,
      }),
    );
    notify("Page moved", true);
  };
  const toggle = async (task: TaskRef) => {
    try {
      await api.request("tasks.toggle", {
        documentId: task.documentId,
        taskId: task.id,
        baseRevision: task.baseRevision,
        done: !task.done,
      });
      notify(task.done ? "Task reopened" : "Task completed", true);
    } catch (e: any) {
      notify(e.message);
    }
  };
  const undo = async () => {
    try {
      if (editor.current && !(await editor.current.flush())) return;
      const items = await api.request("history.list", undefined);
      if (items[0]) {
        receive(await api.request("history.undo", { id: items[0].id }));
        notify("Change undone");
      } else notify("There are no changes to undo yet.");
    } catch (e: any) {
      notify(e.message);
    }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === "k" || k === "o") {
        e.preventDefault();
        setPalette(true);
      } else if (k === "n") {
        e.preventDefault();
        const project = docRef.current
          ? projectFor(docRef.current, vaultRef.current?.documents ?? [])
          : undefined;
        setCreate(
          e.shiftKey
            ? { kind: "task" }
            : { kind: "note", parent: project?.id, projectId: project?.id },
        );
      } else if (k === "j") {
        e.preventDefault();
        setAiOpen((v) => !v);
      } else if (k === "\\") {
        e.preventDefault();
        setSidebarHidden((v) => !v);
      } else if (k === "s") {
        e.preventDefault();
        void editor.current?.flush();
      } else if (k === "w") {
        e.preventDefault();
        void closeTab(active);
      } else if (e.shiftKey && k === "f") {
        e.preventDefault();
        setPalette(true);
      } else if (k === "tab") {
        e.preventDefault();
        const i = tabs.findIndex((t) => t.id === active);
        const next =
          tabs[(i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length];
        if (next) void navigate(next);
      }
    };
    const task = (e: Event) =>
      setCreate({ kind: "task", parent: (e as CustomEvent).detail });
    window.addEventListener("keydown", key);
    window.addEventListener("fable:add-task", task);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("fable:add-task", task);
    };
  }, [active, tabs]);
  const createAction = (
    kind: DocumentKind,
    parent?: string,
    status?: WorkStatus,
  ) => setCreate({ kind, parent, status });
  const shared = {
    documents: areaDocuments,
    open: openDocument,
    create: createAction,
    error: notify,
  };
  const activeView = current?.view;
  const currentProject = document
    ? projectFor(document, vault?.documents ?? [])
    : undefined;
  const isProjectPage = document?.kind === "note" && !!currentProject;
  const title = document?.title ?? current?.title ?? "Fable";
  const isNativeMac = !!window.fable && api.platform === "darwin";
  let content: ReactNode;
  if (document)
    content = (
      <section className="document-page">
        <div className="document-tools">
          <button
            className={`properties-toggle ${properties ? "selected" : ""}`}
            onClick={() => setProperties(!properties)}
          >
            <Icon
              name={
                document.kind === "note"
                  ? isProjectPage
                    ? "page"
                    : "note"
                  : document.kind === "conversation"
                    ? "ai"
                    : (document.kind as IconName)
              }
              size={15}
            />
            <span>
              {isProjectPage
                ? "Page"
                : document.kind.charAt(0).toUpperCase() +
                  document.kind.slice(1)}
            </span>
            <Icon name="down" size={12} />
          </button>
          <span className="save-status" role="status">
            {saveStatus}
          </span>
          <IconButton
            icon="bookmark"
            label={
              pinned.includes(document.id)
                ? "Remove bookmark"
                : isProjectPage
                  ? "Bookmark page"
                  : "Bookmark note"
            }
            className={pinned.includes(document.id) ? "is-pinned" : ""}
            onClick={() =>
              saveViews(
                pinned.includes(document.id)
                  ? pinned.filter((id) => id !== document.id)
                  : [...pinned, document.id],
                hiddenColumns,
              )
            }
          />
          <IconButton
            icon={source ? "view" : "code"}
            label={source ? "Live preview" : "Markdown source"}
            onClick={() => setSource(!source)}
          />
          <IconButton
            icon="attachment"
            label="Attach a file"
            onClick={async () => {
              try {
                if (!window.fable) {
                  const input = window.document.createElement("input");
                  input.type = "file";
                  input.accept = "image/*,.pdf,.txt,.csv";
                  input.onchange = async () => {
                    const file = input.files?.[0];
                    if (!file) return;
                    try {
                      if (file.size > 50 * 1024 * 1024)
                        throw new Error(
                          "Attachments must be 50 MB or smaller.",
                        );
                      const data = await new Promise<string>(
                        (resolve, reject) => {
                          const reader = new FileReader();
                          reader.onload = () =>
                            resolve(String(reader.result).split(",")[1]);
                          reader.onerror = () =>
                            reject(
                              new Error("The attachment could not be read."),
                            );
                          reader.readAsDataURL(file);
                        },
                      );
                      const relative = await api.request("attachments.add", {
                        name: file.name,
                        data,
                      });
                      if (relative && docRef.current?.id === document.id)
                        editor.current?.insert(
                          `\n${file.type.startsWith("image/") ? "!" : ""}[${file.name.replace(/[\[\]\\]/g, "\\$&")}](${relativeVaultHref(document.path, relative)})\n`,
                        );
                    } catch (e: any) {
                      notify(e.message);
                    }
                  };
                  input.click();
                } else {
                  const relative = await api.request("attachments.add", {});
                  if (relative && docRef.current?.id === document.id)
                    editor.current?.insert(
                      `\n${/\.(png|jpe?g|gif|webp|avif|svg)$/i.test(relative) ? "!" : ""}[${relative
                        .split("/")
                        .at(-1)!
                        .replace(
                          /[\[\]\\]/g,
                          "\\$&",
                        )}](${relativeVaultHref(document.path, relative)})\n`,
                    );
                }
              } catch (e: any) {
                notify(e.message);
              }
            }}
          />
        </div>
        {properties && (
          <div className="properties-panel">
            <label>
              Type
              <select
                value={document.kind}
                onChange={(e) =>
                  updateMetadata(document.id, { kind: e.target.value }).catch(
                    (e) => notify(e.message),
                  )
                }
              >
                {kinds
                  .filter((k) => k !== "conversation")
                  .map((kind) => (
                    <option key={kind} value={kind}>
                      {kind === "note" && isProjectPage
                        ? "Page"
                        : kind.charAt(0).toUpperCase() + kind.slice(1)}
                    </option>
                  ))}
              </select>
            </label>
            {["goal", "project"].includes(document.kind) && (
              <label>
                Status
                <select
                  value={document.metadata.status}
                  onChange={(e) =>
                    updateMetadata(document.id, {
                      status: e.target.value,
                      ...(e.target.value === "done"
                        ? { completed_at: new Date().toISOString() }
                        : { completed_at: null }),
                    }).catch((e) => notify(e.message))
                  }
                >
                  {statuses.map((s) => (
                    <option value={s} key={s}>
                      {statusLabels[s]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              {document.kind === "project" ? "Area" : "Parent"}
              <select
                value={
                  document.kind === "project"
                    ? (areaFor(document, vault?.documents ?? [])?.id ?? "")
                    : (document.metadata.parent ?? "")
                }
                onChange={async (e) => {
                  const parent = e.target.value || null;
                  try {
                    if (await updateMetadata(document.id, { parent })) {
                      const state = await api.request("vault.state", undefined);
                      if (state) receive(state);
                      await openDocument(document.id);
                      setProperties(true);
                    }
                  } catch (error: any) {
                    notify(error.message);
                  }
                }}
              >
                <option value="" disabled={document.kind === "project"}>
                  {document.kind === "project" ? "Choose an area" : "No parent"}
                </option>
                {vault?.documents
                  .filter(
                    (d) =>
                      d.id !== document.id &&
                      (document.kind === "project"
                        ? d.kind === "area"
                        : document.kind === "goal"
                          ? ["area", "goal"].includes(d.kind)
                          : ["area", "goal", "project", "note"].includes(
                              d.kind,
                            )),
                  )
                  .map((d) => (
                    <option value={d.id} key={d.id}>
                      {d.title}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Due
              <input
                type="date"
                value={document.metadata.due ?? ""}
                onChange={(e) =>
                  updateMetadata(document.id, {
                    due: e.target.value || null,
                  }).catch((e) => notify(e.message))
                }
              />
            </label>
            <code>{document.path}</code>
            <button
              className="text-button"
              onClick={() =>
                setRename({ id: document.id, path: document.path })
              }
            >
              Rename file
            </button>
            {document.diagnostics.map((d, i) => (
              <p className="form-error" key={i}>
                {d}
              </p>
            ))}
          </div>
        )}
        {document.kind === "project" && (
          <ProjectPages
            project={document}
            documents={areaDocuments}
            onOpen={openDocument}
            onCreate={() =>
              setCreate({
                kind: "note",
                parent: document.id,
                projectId: document.id,
              })
            }
          />
        )}
        <MarkdownEditor
          key={current!.id}
          ref={editor}
          document={document}
          missing={!currentDocument}
          source={source}
          onStatus={setSaveStatus}
          onError={notify}
          onConflictCopy={async (raw) => {
            try {
              const title = `${document.title.slice(0, 175)} (preserved draft)`;
              const copy = await api.request("documents.preserveDraft", {
                title,
                raw,
              });
              editor.current?.acceptPreservedDraft();
              receive((await api.request("vault.state", undefined))!);
              await navigate({
                id: `doc:${copy.id}`,
                title: copy.title,
                documentId: copy.id,
                path: copy.path,
              });
              notify(`Draft saved in ${copy.path}`);
            } catch (e: any) {
              notify(e.message);
            }
          }}
        />
      </section>
    );
  else if (current?.documentId)
    content = (
      <EmptyState icon="note" title="This file has moved">
        Use search to find it, or open another note.
      </EmptyState>
    );
  else if (activeView === "projects")
    content = (
      <ProjectsView
        {...shared}
        hiddenColumns={hiddenColumns}
        onColumns={(columns) => saveViews(pinned, columns)}
        move={async (id, status, parent) => {
          await updateMetadata(id, {
            status,
            parent: parent ?? (areaId === UNASSIGNED_AREA ? null : areaId),
          });
          notify(`Project moved to ${statusLabels[status]}`, true);
        }}
      />
    );
  else if (activeView === "tasks")
    content = <TasksView {...shared} toggle={toggle} />;
  else if (activeView === "goals") content = <GoalsView {...shared} />;
  else if (activeView === "areas") content = <NotesView {...shared} areas />;
  else if (activeView === "insights") content = <InsightsView {...shared} />;
  else if (activeView === "completed")
    content = (
      <CompletedView
        {...shared}
        toggle={toggle}
        restore={async (doc) => {
          try {
            await updateMetadata(doc.id, {
              status: "todo",
              completed_at: null,
            });
          } catch (e: any) {
            notify(e.message);
          }
        }}
      />
    );
  else content = <NotesView {...shared} />;

  if (loading)
    return (
      <div className="app-loading">
        <div className="loading-sidebar" />
        <div className="loading-content">
          <i />
          <i />
          <i />
        </div>
      </div>
    );
  if (!vault)
    return (
      <div className="onboarding">
        <span className="fable-mark">f.</span>
        <h1>A little room to think.</h1>
        <p>
          Your notes, projects, and tasks.
          <br />
          In a folder that belongs to you.
        </p>
        <div className="onboarding-actions">
          <button className="button primary" onClick={() => openFolder()}>
            <Icon name="folder" size={16} />
            Open a folder
          </button>
          <button className="button" onClick={() => openFolder(true)}>
            Explore the example workspace
          </button>
        </div>
        <div className="onboarding-foot">
          <span>
            <Icon name="note" size={14} />
            Plain Markdown
          </span>
          <span>
            <Icon name="computer" size={14} />
            Works offline
          </span>
          <span>
            <Icon name="lock" size={14} />
            Yours to keep
          </span>
        </div>
        {message && (
          <div className="toast" role="status">
            {message}
          </div>
        )}
      </div>
    );
  return (
    <div
      className={`app-shell ${sidebarHidden ? "sidebar-hidden" : ""} ${api.platform === "darwin" ? "platform-mac" : "platform-windows"}`}
      style={
        {
          "--sidebar-width": `${sidebarHidden ? 0 : sidebarWidth}px`,
        } as React.CSSProperties
      }
    >
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="app-titlebar">
        <div className="sidebar-toolbar">
          {isNativeMac ? (
            <div className="native-control-space" />
          ) : window.fable ? null : (
            <div className="window-lights" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
          )}
          <div className="toolbar-modes">
            <IconButton
              icon="folder"
              label="Files"
              className={folders && !bookmarks ? "mode-selected" : ""}
              onClick={() => {
                setFolders(!folders);
                setBookmarks(false);
              }}
            />
            <IconButton
              icon="search"
              label="Search notes (⌘ K)"
              onClick={() => setPalette(true)}
            />
            <IconButton
              icon="bookmark"
              label="Bookmarks"
              className={bookmarks ? "mode-selected" : ""}
              onClick={() => {
                setBookmarks(!bookmarks);
                setFolders(true);
              }}
            />
          </div>
          <IconButton
            icon="sidebar"
            label="Toggle sidebar (⌘ \)"
            onClick={() => setSidebarHidden(!sidebarHidden)}
          />
        </div>
        <div className="tab-strip" role="tablist" aria-label="Open pages">
          {tabs.map((tab) => (
            <div
              className={`tab ${active === tab.id ? "active" : ""}`}
              key={tab.id}
            >
              <button
                role="tab"
                aria-selected={active === tab.id}
                onClick={() => navigate(tab)}
              >
                {tab.view && (
                  <Icon
                    name={
                      tab.view === "notes" ? "note" : (tab.view as IconName)
                    }
                    size={14}
                  />
                )}
                <span>
                  {tab.documentId
                    ? (vault.documents.find((d) => d.id === tab.documentId)
                        ?.title ?? tab.title)
                    : tab.title}
                </span>
              </button>
              <IconButton
                icon="close"
                label={`Close ${tab.title} tab`}
                size={14}
                onClick={() => closeTab(tab.id)}
              />
            </div>
          ))}
          <IconButton
            icon="add"
            label="New tab"
            onClick={() => setPalette(true)}
          />
          <div className="titlebar-drag-space" />
          <IconButton
            icon="down"
            label="All open pages"
            size={13}
            onClick={() => setPalette(true)}
          />
          <IconButton
            icon="panel"
            label="Toggle AI assistant (⌘ J)"
            className={aiOpen ? "mode-selected" : ""}
            onClick={() => setAiOpen(!aiOpen)}
          />
        </div>
      </header>
      <aside className="sidebar" aria-label="Workspace sidebar">
        <div
          className="sidebar-scroll"
          onScroll={() =>
            window.dispatchEvent(new Event("fable:sidebar-scroll"))
          }
        >
          <AreaSidebar
            areas={areas}
            areaId={areaId}
            documents={areaDocuments}
            directories={vault.directories ?? []}
            activeId={document?.id}
            pinned={pinned}
            sidebarOrder={sidebarOrder}
            onReorder={reorderSidebar}
            onMovePage={movePage}
            mode={bookmarks ? "bookmarks" : folders ? "files" : "projects"}
            onArea={(id) => void selectArea(id)}
            onOpen={openDocument}
            onProjects={() => navigateView("projects")}
            onNewArea={() => setCreate({ kind: "area" })}
            onNewProject={() =>
              setCreate({
                kind: "project",
                parent: areaId === UNASSIGNED_AREA ? undefined : areaId,
              })
            }
            onNewNote={(parent, directory) =>
              setCreate({ kind: "note", parent, directory })
            }
            onNewPage={(projectId, directory) =>
              setCreate({
                kind: "note",
                parent: projectId,
                projectId,
                directory,
              })
            }
            onNewFolder={(parentId, directory) =>
              setNewFolder({ parentId, directory })
            }
            onEdit={async (id) => {
              if (await openDocument(id)) setProperties(true);
            }}
            onPin={(id) =>
              void saveViews(
                pinned.includes(id)
                  ? pinned.filter((p) => p !== id)
                  : [...pinned, id],
                hiddenColumns,
              )
            }
          />
        </div>
        <footer className="workspace-footer">
          <div className="workspace-menu-anchor">
            <button
              className="workspace-switch"
              aria-expanded={workspaceMenu}
              onClick={() => setWorkspaceMenu(!workspaceMenu)}
            >
              <span className="workspace-chevrons">
                <Icon name="up" size={10} />
                <Icon name="down" size={10} />
              </span>
              <strong>{vault.name}</strong>
            </button>
            {workspaceMenu && (
              <div className="workspace-popover">
                <small>{vault.path}</small>
                <button
                  onClick={() => {
                    setWorkspaceMenu(false);
                    void openFolder();
                  }}
                >
                  <Icon name="folder" size={15} />
                  Open another folder
                </button>
                <button
                  onClick={() => {
                    setWorkspaceMenu(false);
                    void openFolder(true);
                  }}
                >
                  <Icon name="note" size={15} />
                  Example workspace
                </button>
                <button
                  onClick={() => {
                    setWorkspaceMenu(false);
                    setSettings("sync");
                  }}
                >
                  <Icon name="cloud" size={15} />
                  Sync settings
                </button>
              </div>
            )}
          </div>
          <IconButton
            icon={syncStatus.state === "local" ? "help" : "cloud"}
            label={
              syncStatus.state === "local"
                ? "Help and keyboard shortcuts"
                : syncStatus.message
            }
            size={17}
            onClick={() =>
              syncStatus.state === "local" ? setHelp(true) : setSettings("sync")
            }
          />
          <IconButton
            icon="settings"
            label="Settings"
            size={17}
            onClick={() => setSettings("general")}
          />
        </footer>
      </aside>
      <div
        className="sidebar-resize"
        role="separator"
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft")
            setSidebarWidth((w) => Math.max(240, w - 8));
          if (e.key === "ArrowRight")
            setSidebarWidth((w) => Math.min(400, w + 8));
        }}
        onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
        onPointerMove={(e) => {
          if (e.buttons === 1)
            setSidebarWidth(Math.max(240, Math.min(400, e.clientX)));
        }}
      />
      <div className="main-and-panel">
        <div className="main-workspace">
          <div className="view-toolbar">
            <div className="history-controls">
              {sidebarHidden && (
                <IconButton
                  icon="sidebar"
                  label="Show sidebar"
                  onClick={() => setSidebarHidden(false)}
                />
              )}
              <IconButton
                icon="left"
                label="Back"
                disabled={position.current <= 0}
                size={17}
                onClick={() => goHistory(-1)}
              />
              <IconButton
                icon="right"
                label="Forward"
                disabled={position.current >= history.current.length - 1}
                size={17}
                onClick={() => goHistory(1)}
              />
            </div>
            <span className="toolbar-title">{title}</span>
            <div className="overflow-anchor">
              <IconButton
                icon="more"
                label="Page options"
                size={18}
                onClick={() => setMore(!more)}
              />
              {more && (
                <div className="overflow-menu">
                  <button
                    onClick={() => {
                      setMore(false);
                      setCreate(
                        currentProject
                          ? {
                              kind: "note",
                              parent: currentProject.id,
                              projectId: currentProject.id,
                            }
                          : { kind: document?.kind ?? "note" },
                      );
                    }}
                  >
                    <Icon name="add" size={15} />
                    New {currentProject ? "page" : (document?.kind ?? "note")}
                  </button>
                  <button
                    onClick={() => {
                      setMore(false);
                      setAiOpen(true);
                    }}
                  >
                    <Icon name="ai" size={15} />
                    Ask your assistant
                  </button>
                  {document && (
                    <>
                      <button
                        onClick={() => {
                          setMore(false);
                          setSource(!source);
                        }}
                      >
                        <Icon name="code" size={15} />
                        Toggle Markdown source
                      </button>
                      <button
                        onClick={async () => {
                          setMore(false);
                          try {
                            if (!(await editor.current?.flush())) return;
                            await api.request("documents.trash", {
                              id: document.id,
                              baseRevision: document.revision,
                            });
                            await closeTab(active);
                            notify("File moved to local history", true);
                          } catch (e: any) {
                            notify(e.message);
                          }
                        }}
                      >
                        <Icon name="trash" size={15} />
                        Move to history
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => {
                      setMore(false);
                      setSettings("history");
                    }}
                  >
                    <Icon name="waiting" size={15} />
                    Local history
                  </button>
                </div>
              )}
            </div>
          </div>
          <main
            id="main-content"
            className={`main-content ${activeView === "projects" ? "board-main" : ""}`}
            key={current?.id}
          >
            {content}
          </main>
        </div>
        {aiOpen && (
          <AIPanel
            key={areaId}
            documents={areaDocuments}
            activeId={document?.id}
            onClose={() => {
              void api.request("ai.cancel", undefined);
              setAiOpen(false);
            }}
            onSettings={() => setSettings("connections")}
            onError={notify}
            beforeSend={async () =>
              editor.current ? editor.current.flush() : true
            }
            onApply={(set) =>
              new Promise<boolean>((resolve) => {
                void api
                  .request("vault.state", undefined)
                  .then((state) => {
                    if (state) receive(state);
                    setReview({ set, resolve });
                  })
                  .catch((e) => {
                    notify(e.message);
                    resolve(false);
                  });
              })
            }
          />
        )}
      </div>
      {message && (
        <div className="toast" role="status">
          <span>{message}</span>
          {undoAvailable && <button onClick={() => undo()}>Undo</button>}
          <IconButton
            icon="close"
            label="Dismiss message"
            size={13}
            onClick={() => setMessage("")}
          />
        </div>
      )}
      {palette && (
        <CommandPalette
          createLabel={currentProject ? "New page" : "New note"}
          initialQuery={paletteQuery}
          documents={areaDocuments}
          onClose={() => {
            setPalette(false);
            setPaletteQuery("");
          }}
          onOpen={(id) => {
            setPalette(false);
            openDocument(id);
          }}
          onView={(view) => {
            setPalette(false);
            navigateView(view);
          }}
          onCreate={() => {
            setPalette(false);
            setCreate({
              kind: "note",
              parent: currentProject?.id,
              projectId: currentProject?.id,
            });
          }}
        />
      )}
      {create && (
        <CreateDialog
          {...create}
          asPage={!!create.projectId}
          parent={
            create.parent ??
            (create.kind === "area"
              ? undefined
              : areaId === UNASSIGNED_AREA
                ? undefined
                : areaId)
          }
          documents={
            create.kind === "area" || create.kind === "project"
              ? vault.documents
              : areaDocuments
          }
          onClose={() => setCreate(null)}
          onCreate={async (title, parent) => {
            if (editor.current && !(await editor.current.flush()))
              throw new Error("Save or preserve the current draft first.");
            let doc: DocumentSnapshot;
            if (create.kind === "task") {
              doc = await api.request("tasks.create", {
                title,
                documentId: parent || undefined,
              });
              notify("Task added", true);
            } else {
              doc = create.projectId
                ? await api.request("pages.create", {
                    projectId: create.projectId,
                    title,
                    directory: create.directory,
                  })
                : await api.request("documents.create", {
                    title,
                    kind: create.kind,
                    parent: parent || undefined,
                    directory: create.directory,
                  });
              if (create.status && create.status !== "todo")
                doc = await api.request("documents.metadata", {
                  id: doc.id,
                  baseRevision: doc.revision,
                  values: { status: create.status },
                });
              receive((await api.request("vault.state", undefined))!);
              if (create.kind === "area") {
                await selectArea(doc.id);
                setCreate(null);
                return;
              }
              const targetArea =
                areaFor(doc, vaultRef.current?.documents ?? [])?.id ??
                UNASSIGNED_AREA;
              if (targetArea !== areaIdRef.current)
                await selectArea(targetArea);
              await navigate({
                id: `doc:${doc.id}`,
                title: doc.title,
                documentId: doc.id,
                path: doc.path,
              });
            }
            setCreate(null);
          }}
        />
      )}
      {newFolder && (
        <FolderDialog
          onClose={() => setNewFolder(null)}
          onCreate={async (name) => {
            receive(
              await api.request("folders.create", { ...newFolder, name }),
            );
            setNewFolder(null);
            notify("Folder created");
          }}
        />
      )}
      {rename && (
        <Modal title="Rename file" onClose={() => setRename(null)}>
          <form
            className="create-form"
            onSubmit={(e) => {
              e.preventDefault();
              void (async () => {
                if (editor.current && !(await editor.current.flush())) return;
                const latest = await api.request("vault.state", undefined),
                  doc = latest?.documents.find((d) => d.id === rename.id);
                if (!doc) throw new Error("This file is no longer available.");
                await api.request("documents.rename", {
                  id: doc.id,
                  baseRevision: doc.revision,
                  path: rename.path,
                });
                setRename(null);
                notify("File renamed and relative links updated", true);
              })().catch((e) => notify(e.message));
            }}
          >
            <label className="field-label">
              Path within your vault
              <input
                autoFocus
                required
                value={rename.path}
                onChange={(e) => setRename({ ...rename, path: e.target.value })}
              />
            </label>
            <p className="field-hint">
              Use a .md filename. Relative links update with the move.
            </p>
            <footer className="modal-footer">
              <button
                type="button"
                className="button"
                onClick={() => setRename(null)}
              >
                Cancel
              </button>
              <button className="button primary">Rename file</button>
            </footer>
          </form>
        </Modal>
      )}
      {settings && (
        <Settings
          initialTab={settings}
          vault={vault}
          syncStatus={syncStatus}
          onClose={() => setSettings(null)}
          onError={notify}
          onOpenFolder={() => openFolder()}
          onDocument={(id) => {
            setSettings(null);
            openDocument(id);
          }}
        />
      )}
      {review && (
        <ChangeReview
          changeSet={review.set}
          documents={vault.documents}
          onClose={() => {
            review.resolve(false);
            setReview(null);
          }}
          onApply={async () => {
            receive(await api.request("changes.apply", review.set));
            review.resolve(true);
            notify(
              "Changes applied. Your previous files are in local history.",
              true,
            );
          }}
        />
      )}
      {help && (
        <Modal title="A few useful shortcuts" onClose={() => setHelp(false)}>
          <div className="help-content">
            <p>A quiet place for the things you’re working on.</p>
            {[
              ["New note", "⌘ N"],
              ["Capture a task", "⌘ ⇧ N"],
              ["Find a note or command", "⌘ K"],
              ["Open your assistant", "⌘ J"],
              ["Toggle the sidebar", "⌘ \\"],
              ["Save the current note", "⌘ S"],
              ["Reorder a sidebar item", "Alt ↑ / ↓"],
              ["Move the focused page", "Alt M"],
            ].map(([label, shortcut]) => (
              <div className="shortcut-row" key={label}>
                <span>{label}</span>
                <kbd>
                  {api.platform === "darwin"
                    ? shortcut
                    : shortcut.replace("⌘", "Ctrl").replace("⇧", "Shift")}
                </kbd>
              </div>
            ))}
            <p className="quiet-note">
              Everything you write is saved in your own Markdown folder.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CreateDialog({
  kind,
  parent,
  status,
  directory,
  asPage = false,
  documents,
  onClose,
  onCreate,
}: {
  kind: DocumentKind | "task";
  parent?: string;
  status?: WorkStatus;
  directory?: string;
  asPage?: boolean;
  documents: DocumentSnapshot[];
  onClose: () => void;
  onCreate: (title: string, parent?: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(""),
    [selectedParent, setSelectedParent] = useState(parent ?? ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const candidates = documents.filter((d) =>
    kind === "task"
      ? ["project", "note"].includes(d.kind)
      : kind === "project"
        ? d.kind === "area"
        : kind === "goal"
          ? ["area", "goal"].includes(d.kind)
          : kind === "area"
            ? false
            : ["area", "project", "note"].includes(d.kind),
  );
  return (
    <Modal
      title={
        asPage ? "New page" : kind === "task" ? "Capture a task" : `New ${kind}`
      }
      onClose={onClose}
    >
      <form
        className="create-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim()) return;
          setBusy(true);
          try {
            await onCreate(title.trim(), selectedParent || undefined);
          } catch (e: any) {
            setError(e.message);
            setBusy(false);
          }
        }}
      >
        <label className="field-label">
          {kind === "task" ? "What’s the next step?" : "Name"}
          <input
            autoFocus
            required
            placeholder={
              kind === "note"
                ? asPage
                  ? "Page title"
                  : "An idea, a thought, a beginning…"
                : kind === "task"
                  ? "Something you can do…"
                  : `Give your ${kind} a name…`
            }
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        {asPage && (
          <p className="page-project-hint">
            <Icon name="folder" size={15} />
            {documents.find((project) => project.id === parent)?.title}
          </p>
        )}
        {!asPage && candidates.length > 0 && (
          <label className="field-label">
            {kind === "task"
              ? "Save in"
              : kind === "project"
                ? "Area"
                : "Parent"}
            <select
              value={selectedParent}
              required={kind === "project"}
              disabled={!!directory}
              onChange={(e) => setSelectedParent(e.target.value)}
            >
              <option value="" disabled={kind === "project"}>
                {kind === "task" ? "Inbox" : "No parent"}
              </option>
              {candidates.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </label>
        )}
        {directory && <p className="field-hint">Save in {directory}</p>}
        {kind === "project" && !candidates.length && (
          <p className="field-hint">
            Create an area first to give this project a home.
          </p>
        )}
        {status && (
          <p className="field-hint">Starts in {statusLabels[status]}.</p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <footer className="modal-footer">
          <button className="button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            type="submit"
            disabled={
              busy || !title.trim() || (kind === "project" && !selectedParent)
            }
          >
            {busy
              ? "Creating…"
              : kind === "task"
                ? "Add task"
                : asPage
                  ? "Create page"
                  : `Create ${kind}`}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
function FolderDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title="New folder" onClose={onClose}>
      <form
        className="create-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!name.trim()) return;
          setBusy(true);
          try {
            await onCreate(name.trim());
          } catch (error: any) {
            setError(error.message);
            setBusy(false);
          }
        }}
      >
        <label className="field-label">
          Name
          <input
            autoFocus
            required
            value={name}
            placeholder="Folder name"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <footer className="modal-footer">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy || !name.trim()}>
            {busy ? "Creating…" : "Create folder"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
function CommandPalette({
  documents,
  onClose,
  onOpen,
  onView,
  onCreate,
  initialQuery = "",
  createLabel = "New note",
}: {
  initialQuery?: string;
  createLabel?: string;
  documents: DocumentSnapshot[];
  onClose: () => void;
  onOpen: (id: string) => void;
  onView: (view: ViewId) => void;
  onCreate: () => void;
}) {
  const [query, setQuery] = useState(initialQuery),
    [results, setResults] = useState<string[]>([]),
    [index, setIndex] = useState(0);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      if (query.trim())
        void api.request("search", { query }).then((rows) => {
          if (active) setResults(rows.map((r) => r.documentId));
        });
      else setResults([]);
    }, 100);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);
  const matching = documents
    .filter((d) =>
      query
        ? results.includes(d.id) ||
          d.title.toLowerCase().includes(query.toLowerCase())
        : true,
    )
    .slice(0, query ? 30 : 6);
  const commands = [
    { label: createLabel, icon: "fileAdd" as IconName, action: onCreate },
    ...navigation.map(([view, label, icon]) => ({
      label,
      icon,
      action: () => onView(view),
    })),
  ].filter(
    (c) => !query || c.label.toLowerCase().includes(query.toLowerCase()),
  );
  const options = [
    ...commands,
    ...matching.map((d) => ({
      label: d.title,
      icon: (d.kind === "note"
        ? "note"
        : d.kind === "conversation"
          ? "ai"
          : d.kind) as IconName,
      action: () => onOpen(d.id),
      path: d.path,
    })),
  ];
  return (
    <Modal title="Find a note or a command" onClose={onClose}>
      <div className="command-search">
        <Icon name="search" size={19} />
        <input
          autoFocus
          aria-label="Search notes and commands"
          placeholder="Find a note or a command…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => (i + 1) % Math.max(1, options.length));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex(
                (i) => (i - 1 + options.length) % Math.max(1, options.length),
              );
            }
            if (e.key === "Enter") {
              e.preventDefault();
              options[index]?.action();
            }
          }}
        />
        <kbd>esc</kbd>
      </div>
      <div
        className="command-results"
        role="listbox"
        aria-label="Search results"
      >
        {options.map((option, i) => (
          <button
            key={`${option.label}:${i}`}
            className={index === i ? "selected" : ""}
            role="option"
            aria-selected={index === i}
            onMouseEnter={() => setIndex(i)}
            onClick={option.action}
          >
            <Icon name={option.icon} size={17} />
            <span>
              {option.label}
              {"path" in option && <small>{String(option.path)}</small>}
            </span>
            {index === i && <kbd>↵</kbd>}
          </button>
        ))}
        {!options.length && (
          <div className="search-empty">
            No matching notes.{" "}
            <button className="text-button" onClick={onCreate}>
              Create a note
            </button>
          </div>
        )}
      </div>
      <div className="command-footer">
        <span>↑ ↓ to move</span>
        <span>↵ to open</span>
        <span>Search stays on this device</span>
      </div>
    </Modal>
  );
}
