import {
  projectFileSchema,
  type DocumentSnapshot,
  type ProjectFile,
} from "../contracts/index.ts";
import { documentFolder } from "./index.ts";

export function searchProjectFolders(
  folders: string[],
  query: string,
  workspacePath = "",
) {
  const root = workspacePath.replaceAll("\\", "/").replace(/\/$/, "");
  let search = query.trim().replaceAll("\\", "/").replace(/\/$/, "");
  if (root && search.toLowerCase().startsWith(root.toLowerCase() + "/"))
    search = search.slice(root.length + 1);
  search = search.replace(/^\.\//, "").toLowerCase();
  return folders.filter((folder) => folder.toLowerCase().includes(search));
}

export function projectSourceFolders(project: DocumentSnapshot): string[] {
  const folders = project.metadata.source_folders;
  return Array.isArray(folders)
    ? [
        ...new Set(
          folders.filter(
            (folder): folder is string =>
              typeof folder === "string" && !!folder,
          ),
        ),
      ]
    : [documentFolder(project)];
}
export function projectFiles(project: DocumentSnapshot): ProjectFile[] {
  const files = project.metadata.project_files;
  if (!Array.isArray(files)) return [];
  return files.flatMap((file) => {
    const parsed = projectFileSchema.safeParse(file);
    return parsed.success ? [parsed.data] : [];
  });
}
