import type {
  DocumentSnapshot,
  TaskRef,
  WorkStatus,
} from "../contracts/index.ts";
export const UNASSIGNED_AREA = "__unassigned__";
/** Area ownership follows stable parent IDs, including older goal hierarchies. */
export function areaFor(
  document: DocumentSnapshot,
  documents: DocumentSnapshot[] | Map<string, DocumentSnapshot>,
) {
  const byId =
    documents instanceof Map
      ? documents
      : new Map(documents.map((d) => [d.id, d]));
  const seen = new Set<string>();
  let current: DocumentSnapshot | undefined = document;
  while (current && !seen.has(current.id)) {
    if (current.kind === "area") return current;
    seen.add(current.id);
    current = current.metadata.parent
      ? byId.get(current.metadata.parent)
      : undefined;
  }
}
export function documentsInArea(documents: DocumentSnapshot[], areaId: string) {
  const byId = new Map(documents.map((d) => [d.id, d]));
  return documents.filter(
    (doc) => (areaFor(doc, byId)?.id ?? UNASSIGNED_AREA) === areaId,
  );
}
export function documentFolder(document: DocumentSnapshot) {
  return document.kind === "area"
    ? `Notes/${document.path.split("/").at(-1)!.replace(/\.md$/i, "")}`
    : document.path.replace(/\.md$/i, "");
}
/** Legacy pages outside a project's physical folder appear at its root. */
export function sidebarPageDirectory(
  document: DocumentSnapshot,
  owner: DocumentSnapshot,
) {
  const base = documentFolder(owner);
  return document.path.startsWith(base + "/")
    ? document.path.slice(0, document.path.lastIndexOf("/"))
    : base;
}
export function projectFor(
  document: DocumentSnapshot,
  documents: DocumentSnapshot[] | Map<string, DocumentSnapshot>,
): DocumentSnapshot | undefined {
  const byId =
      documents instanceof Map
        ? documents
        : new Map(documents.map((d) => [d.id, d])),
    seen = new Set<string>();
  let current: DocumentSnapshot | undefined = document;
  while (current && !seen.has(current.id)) {
    if (current.kind === "project") return current;
    seen.add(current.id);
    current = current.metadata.parent
      ? byId.get(current.metadata.parent)
      : undefined;
  }
}
/** A project's pages are Markdown notes; conversations keep their own identity. */
export function pagesFor(projectId: string, documents: DocumentSnapshot[]) {
  const lookup = new Map(documents.map((document) => [document.id, document]));
  return documents.filter(
    (document) =>
      document.kind === "note" &&
      projectFor(document, lookup)?.id === projectId,
  );
}
export function taskProjectFor(
  task: TaskRef,
  document: DocumentSnapshot,
  documents: DocumentSnapshot[] | Map<string, DocumentSnapshot>,
) {
  if (task.projectId === undefined) return projectFor(document, documents);
  if (task.projectId === null) return undefined;
  const project =
    documents instanceof Map
      ? documents.get(task.projectId)
      : documents.find((d) => d.id === task.projectId);
  return project?.kind === "project" ? project : undefined;
}
export function taskGroups(documents: DocumentSnapshot[], completed = false) {
  const groups = new Map<
    string,
    { id: string; title: string; tasks: TaskRef[] }
  >();
  const byId = new Map(documents.map((d) => [d.id, d])),
    order = new Map(documents.map((d, i) => [d.id, i]));
  for (const document of documents) {
    for (const task of document.tasks) {
      if (task.done !== completed) continue;
      const project = taskProjectFor(task, document, byId);
      const id = project?.id ?? "unassigned";
      if (!groups.has(id))
        groups.set(id, {
          id,
          title: project?.title ?? "No project",
          tasks: [],
        });
      groups.get(id)!.tasks.push(task);
    }
  }
  return [...groups.values()].sort((a, b) => {
    if (a.id === "unassigned") return 1;
    if (b.id === "unassigned") return -1;
    return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
  });
}
export function validateHierarchy(documents: DocumentSnapshot[]) {
  const byId = new Map(documents.map((d) => [d.id, d]));
  if (byId.size !== documents.length)
    throw new Error(
      "Duplicate Fable ID. Give the copy a new ID before applying this change.",
    );
  for (const document of documents) {
    let current: DocumentSnapshot | undefined = document;
    const seen = new Set<string>();
    while (current) {
      if (seen.has(current.id))
        throw new Error("A document cannot be its own ancestor.");
      seen.add(current.id);
      current = current.metadata.parent
        ? byId.get(current.metadata.parent)
        : undefined;
    }
    if (document.metadata.parent) {
      const parent = byId.get(document.metadata.parent);
      const allowed: Record<string, string[]> = {
        area: [],
        goal: ["area", "goal"],
        project: ["area", "goal"],
        note: ["area", "goal", "project", "note"],
        insight: ["area", "goal", "project"],
        conversation: ["area", "goal", "project", "note"],
      };
      if (parent && !allowed[document.kind].includes(parent.kind))
        throw new Error(
          `A ${document.kind} cannot be placed under a ${parent.kind}.`,
        );
    }
  }
}
export const statusLabels: Record<WorkStatus, string> = {
  todo: "Todo",
  waiting: "Waiting",
  ready: "Ready",
  doing: "Doing",
  done: "Done",
};
export function formatDate(value?: string) {
  if (!value) return "";
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(date);
}
