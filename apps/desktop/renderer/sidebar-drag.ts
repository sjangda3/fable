import type { SidebarReorder } from "../../../packages/contracts/index.ts";

export interface SidebarItem {
  kind: "project" | "folder" | "page" | "root";
  id: string;
  title: string;
  parentId: string;
  /** Folder containing a page/folder; project/root rows use their content folder. */
  directory: string;
}
export type SidebarDrop =
  | { kind: "reorder"; request: Omit<SidebarReorder, "revision"> }
  | { kind: "move"; pageId: string; parentId: string; directory: string };

export function planSidebarDrop(
  source: SidebarItem,
  target: SidebarItem,
  position: "before" | "after",
): SidebarDrop | null {
  if (
    source.kind === "root" ||
    (source.kind === target.kind && source.id === target.id)
  )
    return null;
  if (
    source.kind === "page" &&
    ["folder", "project", "root"].includes(target.kind)
  ) {
    const parentId = target.kind === "project" ? target.id : target.parentId,
      directory = target.kind === "folder" ? target.id : target.directory;
    return source.parentId === parentId && source.directory === directory
      ? null
      : { kind: "move", pageId: source.id, parentId, directory };
  }
  if (source.kind !== target.kind || source.parentId !== target.parentId)
    return null;
  if (source.kind !== "project" && source.directory !== target.directory)
    return null;
  return {
    kind: "reorder",
    request: {
      kind:
        source.kind === "project"
          ? "projects"
          : source.kind === "folder"
            ? "folders"
            : "pages",
      parentId: source.parentId,
      directory: source.kind === "project" ? undefined : source.directory,
      source: source.id,
      target: target.id,
      position,
    },
  };
}
