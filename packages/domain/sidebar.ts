import type { DocumentSnapshot, SidebarReorder } from "../contracts/index.ts";
import { documentFolder, sidebarPageDirectory } from "./index.ts";

export function sidebarOrderKey(
  kind: SidebarReorder["kind"],
  parentId: string,
  directory?: string,
) {
  return JSON.stringify([kind, parentId, directory ?? ""]);
}

/** Saved entries sort first; new items retain the caller's default order. */
export function orderedSidebarIds(ids: string[], saved: string[] = []) {
  const available = new Set(ids),
    result = [...new Set(saved)].filter((id) => available.has(id)),
    placed = new Set(result);
  return [...result, ...ids.filter((id) => !placed.has(id))];
}

export function reorderSidebarIds(
  ids: string[],
  source: string,
  target: string,
  position: "before" | "after",
) {
  if (source === target) return ids;
  const result = ids.filter((id) => id !== source),
    index = result.indexOf(target);
  if (!ids.includes(source) || index < 0)
    throw new Error("Choose two items in the same folder.");
  result.splice(index + (position === "after" ? 1 : 0), 0, source);
  return result;
}

/** Apply sibling order before limiting a project's visible pages. */
export function orderedSidebarPages(
  notes: DocumentSnapshot[],
  owner: DocumentSnapshot,
  order: Record<string, string[]> = {},
) {
  const base = documentFolder(owner),
    groups = new Map<string, DocumentSnapshot[]>(),
    folders = new Set<string>();
  for (const note of notes) {
    const directory = sidebarPageDirectory(note, owner);
    const pages = groups.get(directory) ?? [];
    pages.push(note);
    groups.set(directory, pages);
    if (directory === base) continue;
    const parts = directory.slice(base.length + 1).split("/");
    for (let depth = 1; depth <= parts.length; depth++)
      folders.add(`${base}/${parts.slice(0, depth).join("/")}`);
  }
  const childFolders = new Map<string, string[]>();
  for (const folder of [...folders].sort()) {
    const parent = folder.slice(0, folder.lastIndexOf("/")),
      children = childFolders.get(parent) ?? [];
    children.push(folder);
    childFolders.set(parent, children);
  }
  const result: DocumentSnapshot[] = [];
  const visit = (directory: string) => {
    for (const folder of orderedSidebarIds(
      childFolders.get(directory) ?? [],
      order[sidebarOrderKey("folders", owner.id, directory)],
    ))
      visit(folder);
    const pages = groups.get(directory) ?? [],
      lookup = new Map(pages.map((page) => [page.id, page]));
    for (const id of orderedSidebarIds(
      pages.map((page) => page.id),
      order[sidebarOrderKey("pages", owner.id, directory)],
    ))
      result.push(lookup.get(id)!);
  };
  visit(base);
  return result;
}
