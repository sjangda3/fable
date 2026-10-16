import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { subscribe, type AsyncSubscription } from "@parcel/watcher";
import {
  changeSetSchema,
  FableError,
  projectSettingsSchema,
  type ProjectSettings,
  type ChangeSet,
  type DocumentSnapshot,
  type DocumentKind,
  type VaultState,
  type HistoryEntry,
  type ViewSettings,
  type SidebarReorder,
  type WorkStatus,
} from "../contracts/index.ts";
import {
  parseMarkdown,
  revisionOf,
  patchMetadata,
  setDocumentTitle,
  toggleTask,
  updateTask,
  moveTask,
  applyEdits,
  relativeLinkEdits,
} from "../markdown/index.ts";
import {
  validateHierarchy,
  documentFolder,
  areaFor,
  projectFor,
  sidebarPageDirectory,
  UNASSIGNED_AREA,
} from "../domain/index.ts";
import {
  sidebarOrderKey,
  orderedSidebarIds,
  reorderSidebarIds,
} from "../domain/sidebar.ts";
import { Indexer } from "./indexer.ts";

interface FileVersion {
  path: string;
  raw: string | null;
}
interface DirectoryVersion {
  path: string;
  exists: boolean;
}
interface Journal {
  id: string;
  summary: string;
  createdAt: string;
  before: FileVersion[];
  after: FileVersion[];
  beforeDirectories?: DirectoryVersion[];
  afterDirectories?: DirectoryVersion[];
  state: "prepared" | "committed";
}
export const portableName = (name: string) => {
  let value = name
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
    .replace(/[. ]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 120);
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(value))
    value = `_${value}`;
  return value || "Untitled";
};
const encodeJournal = (j: Journal) =>
  `# ${j.summary.replace(/[\r\n`]+/g, " ")}\n\n${j.createdAt}\n\n\`\`\`json\n${JSON.stringify(j, null, 2)}\n\`\`\`\n`;
function decodeJournal(raw: string): Journal {
  const payload = /```json\n([\s\S]*?)\n```/.exec(raw)?.[1];
  if (!payload) throw new Error("Invalid recovery record.");
  return JSON.parse(payload);
}

export class VaultService extends EventEmitter {
  root = "";
  documents: DocumentSnapshot[] = [];
  directories: string[] = [];
  private index?: Indexer;
  private watcher?: AsyncSubscription;
  private serial: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private cachePath: string) {
    super();
  }
  get state(): VaultState {
    return {
      name: path.basename(this.root),
      path: this.root,
      documents: this.documents,
      directories: this.directories,
      indexStatus: "ready",
    };
  }
  async open(root: string, watch = true) {
    await this.close();
    await fs.mkdir(root, { recursive: true });
    this.root = await fs.realpath(root);
    await fs.mkdir(this.cachePath, { recursive: true });
    this.index = new Indexer(
      path.join(this.cachePath, `${revisionOf(this.root).slice(0, 16)}.sqlite`),
    );
    await fs.mkdir(path.join(this.root, ".fable/history"), { recursive: true });
    await fs.mkdir(path.join(this.root, ".fable/journal"), { recursive: true });
    await this.recover();
    await this.scan();
    if (watch)
      this.watcher = await subscribe(
        this.root,
        (_error, events) => {
          if (
            !events?.some(
              (e) =>
                !path
                  .relative(this.root, e.path)
                  .split(path.sep)
                  .some((p) => p.startsWith(".")),
            )
          )
            return;
          clearTimeout(this.timer);
          this.timer = setTimeout(() => {
            void this.lock(() => this.scan()).catch((e) =>
              this.emit("failure", e),
            );
          }, 140);
        },
        {
          ignore: [
            path.join(this.root, ".fable"),
            path.join(this.root, ".git"),
            path.join(this.root, "node_modules"),
          ],
        },
      );
    return this.state;
  }
  private lock<T>(work: () => Promise<T>): Promise<T> {
    const result = this.serial.then(work);
    this.serial = result.catch(() => undefined);
    return result;
  }
  withWriteLock<T>(work: () => Promise<T>) {
    return this.lock(work);
  }
  async guardFile(
    relative: string,
    expected: Uint8Array | null,
    internal = false,
  ) {
    let current: Buffer | null = null;
    try {
      current = await fs.readFile(await this.safePath(relative, internal));
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
    if (
      expected === null
        ? current !== null
        : current === null || !current.equals(Buffer.from(expected))
    )
      throw new FableError(
        "STALE_REVISION",
        "This file changed during sync. Both versions are preserved for the next attempt.",
      );
  }
  async safePath(relative: string, internal = false) {
    if (!this.root) throw new FableError("FILESYSTEM", "Open a folder first.");
    if (
      !relative ||
      relative.includes("\0") ||
      relative.includes("\\") ||
      path.isAbsolute(relative) ||
      relative.split("/").some((p) => p === ".." || p === "." || !p)
    )
      throw new FableError("VALIDATION", "Choose a path inside the vault.");
    if (!internal && relative.split("/").some((p) => p.startsWith(".")))
      throw new FableError(
        "VALIDATION",
        "Hidden application files cannot be changed through this action.",
      );
    const absolute = path.resolve(this.root, relative);
    if (!absolute.startsWith(this.root + path.sep))
      throw new FableError("VALIDATION", "The file must be inside this vault.");
    let cursor = this.root;
    for (const part of relative.split("/")) {
      cursor = path.join(cursor, part);
      try {
        if ((await fs.lstat(cursor)).isSymbolicLink())
          throw new FableError(
            "VALIDATION",
            "Symbolic links are not followed by the vault.",
          );
      } catch (e: any) {
        if (e.code !== "ENOENT") throw e;
      }
    }
    return absolute;
  }
  private async walk(
    directory = this.root,
    directories: string[] = [],
  ): Promise<string[]> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const result: string[] = [];
    for (const entry of entries) {
      if (
        entry.name.startsWith(".") ||
        entry.name === "node_modules" ||
        entry.isSymbolicLink()
      )
        continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        directories.push(
          path.relative(this.root, absolute).split(path.sep).join("/"),
        );
        result.push(...(await this.walk(absolute, directories)));
      } else if (entry.isFile() && /\.md$/i.test(entry.name))
        result.push(absolute);
    }
    return result.sort();
  }
  async scan() {
    const directories: string[] = [];
    const files = await this.walk(this.root, directories),
      documents: DocumentSnapshot[] = [],
      previousByPath = new Map(this.documents.map((d) => [d.path, d]));
    for (let i = 0; i < files.length; i += 32) {
      const batch = await Promise.all(
        files.slice(i, i + 32).map(async (file) => {
          try {
            const [raw, stat] = await Promise.all([
              fs.readFile(file, "utf8"),
              fs.stat(file),
            ]);
            const relative = path
              .relative(this.root, file)
              .split(path.sep)
              .join("/");
            const previous = previousByPath.get(relative);
            return previous?.revision === revisionOf(raw)
              ? previous
              : { path: relative, raw, modifiedAt: stat.mtime.toISOString() };
          } catch (e: any) {
            if (e.code === "ENOENT") return null;
            throw e;
          }
        }),
      );
      const present = batch.filter((d) => !!d);
      const cached = present.filter(
        (d): d is DocumentSnapshot => "revision" in d,
      );
      const uncached = present.filter((d) => !("revision" in d));
      documents.push(
        ...cached,
        ...(uncached.length ? await this.index!.parse(uncached) : []),
      );
    }
    documents.sort(
      (a, b) =>
        a.metadata.rank.localeCompare(b.metadata.rank) ||
        a.path.localeCompare(b.path),
    );
    const changed =
      documents.length !== this.documents.length ||
      documents.some(
        (d, i) =>
          d.path !== this.documents[i]?.path ||
          d.revision !== this.documents[i]?.revision,
      );
    this.documents = documents;
    directories.sort();
    const directoriesChanged =
      JSON.stringify(directories) !== JSON.stringify(this.directories);
    this.directories = directories;
    if (changed) await this.index?.replace(documents);
    if (changed || directoriesChanged) this.emit("change", this.state);
    return this.state;
  }
  document(id: string) {
    const d = this.documents.find((d) => d.id === id);
    if (!d)
      throw new FableError(
        "FILESYSTEM",
        "This document is no longer in the vault.",
      );
    return d;
  }
  async assertRevision(document: DocumentSnapshot, expected: string) {
    const raw = await fs.readFile(await this.safePath(document.path), "utf8");
    if (revisionOf(raw) !== expected) {
      await this.scan();
      throw new FableError(
        "STALE_REVISION",
        "This file changed elsewhere. Your draft is preserved; review the latest version before saving.",
      );
    }
  }
  async create(
    title: string,
    kind: DocumentKind,
    parent?: string,
    body = "",
    directory?: string,
  ) {
    const folders: Record<DocumentKind, string> = {
      note: "Notes",
      area: "Areas",
      goal: "Goals",
      project: "Projects",
      insight: "Insights",
      conversation: "Conversations",
    };
    const owner = parent ? this.document(parent) : undefined;
    const folder =
      directory ??
      (kind === "note" && owner
        ? documentFolder(owner)
        : kind === "project" && owner?.kind === "area"
          ? `Projects/${portableName(owner.title)}`
          : folders[kind]);
    await this.safePath(folder);
    let relative = `${folder}/${portableName(title)}.md`,
      suffix = 2;
    while (
      this.documents.some(
        (d) => d.path.toLocaleLowerCase() === relative.toLocaleLowerCase(),
      )
    )
      relative = `${folder}/${portableName(title)} ${suffix++}.md`;
    const raw = patchMetadata(`# ${title.trim() || "Untitled"}\n\n${body}`, {
      schema: 1,
      id: randomUUID(),
      kind,
      status: "todo",
      rank: Date.now().toString(),
      ...(parent ? { parent } : {}),
    });
    await this.apply({
      id: randomUUID(),
      summary: `Create ${title || "Untitled"}`,
      changes: [{ type: "create", path: relative, raw }],
    });
    return this.documents.find((d) => d.path === relative)!;
  }
  async createPage(projectId: string, title: string, directory?: string) {
    const project = this.document(projectId);
    if (project.kind !== "project")
      throw new FableError("VALIDATION", "Choose a project for this page.");
    const base = documentFolder(project),
      folder = directory ?? base;
    if (folder !== base && !folder.startsWith(base + "/"))
      throw new FableError(
        "VALIDATION",
        "Choose a folder inside this project.",
      );
    return this.create(title, "note", project.id, "", folder);
  }
  async createFolder(parentId: string, name: string, directory?: string) {
    return this.withWriteLock(async () => {
      const parent = this.document(parentId);
      if (!["area", "project"].includes(parent.kind))
        throw new FableError(
          "VALIDATION",
          "Choose an area or project for this folder.",
        );
      const base = documentFolder(parent),
        container = directory ?? base;
      if (container !== base && !container.startsWith(base + "/"))
        throw new FableError(
          "VALIDATION",
          "Choose a folder inside this project.",
        );
      const target = await this.safePath(`${container}/${portableName(name)}`);
      await fs.mkdir(path.dirname(target), { recursive: true });
      try {
        await fs.mkdir(target);
      } catch (error: any) {
        if (error.code === "EEXIST")
          throw new FableError(
            "CONFLICT",
            "A file or folder with that name already exists.",
          );
        throw error;
      }
      await this.scan();
      return this.state;
    });
  }
  private descendants(ids: Set<string>) {
    let size: number;
    do {
      size = ids.size;
      for (const doc of this.documents)
        if (doc.metadata.parent && ids.has(doc.metadata.parent))
          ids.add(doc.id);
    } while (ids.size !== size);
    return this.documents.filter((doc) => ids.has(doc.id));
  }
  private async folderDeletion(
    directory: string,
    documents: DocumentSnapshot[],
  ) {
    const absolute = await this.safePath(directory);
    try {
      await fs.access(absolute);
    } catch (error: any) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const paths = new Set(documents.map((doc) => doc.path));
    const directories: DirectoryVersion[] = [];
    const visit = async (relative: string) => {
      const absolute = await this.safePath(relative);
      for (const entry of await fs.readdir(absolute, { withFileTypes: true })) {
        const child = `${relative}/${entry.name}`;
        await this.safePath(child);
        if (entry.isDirectory()) await visit(child);
        else if (!entry.isFile() || !paths.has(child))
          throw new FableError(
            "VALIDATION",
            "This folder contains files outside this selection. Move them out before deleting it.",
          );
      }
      directories.push({ path: relative, exists: false });
    };
    await visit(directory);
    return directories;
  }
  async deleteDocument(id: string, baseRevision: string) {
    return this.lock(async () => {
      const doc = this.document(id);
      await this.assertRevision(doc, baseRevision);
      const documents = this.descendants(new Set([id]));
      const directories = ["project", "area"].includes(doc.kind)
        ? await this.folderDeletion(documentFolder(doc), documents)
        : [];
      return this.applyUnlocked(
        {
          id: randomUUID(),
          summary: `Delete ${doc.title}`,
          changes: documents.map((item) => ({
            type: "trash",
            documentId: item.id,
            baseRevision: item.revision,
          })),
        },
        directories,
      );
    });
  }
  async deleteFolder(
    parentId: string,
    directory: string,
    baseRevision: string,
  ) {
    return this.lock(async () => {
      const parent = this.document(parentId),
        base = documentFolder(parent);
      if (
        !["project", "area"].includes(parent.kind) ||
        !directory.startsWith(base + "/")
      )
        throw new FableError(
          "VALIDATION",
          "Choose a subfolder inside this project or area.",
        );
      await this.safePath(directory);
      await this.assertRevision(parent, baseRevision);
      if (!(await fs.stat(await this.safePath(directory))).isDirectory())
        throw new FableError("VALIDATION", "Choose a folder to delete.");
      const documents = this.descendants(
        new Set(
          this.documents
            .filter((doc) => doc.path.startsWith(directory + "/"))
            .map((doc) => doc.id),
        ),
      );
      if (
        documents.some(
          (doc) =>
            (projectFor(doc, this.documents) ?? areaFor(doc, this.documents))
              ?.id !== parentId,
        )
      )
        throw new FableError(
          "VALIDATION",
          "This folder contains pages from another project or area.",
        );
      const directories = await this.folderDeletion(directory, documents);
      return this.applyUnlocked(
        {
          id: randomUUID(),
          summary: `Delete folder ${path.posix.basename(directory)}`,
          changes: documents.map((doc) => ({
            type: "trash",
            documentId: doc.id,
            baseRevision: doc.revision,
          })),
        },
        directories,
      );
    });
  }
  async save(id: string, baseRevision: string, raw: string) {
    const doc = this.document(id);
    await this.apply({
      id: randomUUID(),
      summary: `Edit ${doc.title}`,
      changes: [
        {
          type: "patch",
          documentId: id,
          baseRevision,
          edits: [{ from: 0, to: doc.raw.length, insert: raw }],
        },
      ],
    });
    return this.documents.find((d) => d.path === doc.path)!;
  }
  private async validateProjectSettings(
    input: ProjectSettings,
    implicitFolder?: string,
  ) {
    const values = projectSettingsSchema.parse(input);
    const sourceFolders = [...new Set(values.sourceFolders)];
    for (const folder of sourceFolders) {
      const absolute = await this.safePath(folder);
      if (folder === implicitFolder) continue;
      if (
        folder.startsWith(".fable") ||
        folder === "Attachments" ||
        folder.startsWith("Attachments/")
      )
        throw new FableError(
          "VALIDATION",
          "Choose a project folder in this workspace.",
        );
      const exists = await fs.stat(absolute).catch(() => null);
      if (!exists?.isDirectory())
        throw new FableError(
          "VALIDATION",
          `The folder “${folder}” is no longer available.`,
        );
    }
    const files = [
      ...new Map(values.files.map((file) => [file.path, file])).values(),
    ];
    for (const file of files) {
      const info = await fs
        .stat(await this.safePath(file.path))
        .catch(() => null);
      if (!info?.isFile())
        throw new FableError(
          "VALIDATION",
          `The file “${file.name}” is no longer available.`,
        );
      if (info.size !== file.size)
        throw new FableError(
          "VALIDATION",
          `The file “${file.name}” changed. Upload it again.`,
        );
    }

    return { ...values, sourceFolders, files };
  }
  async createProject(parentId: string, input: ProjectSettings) {
    return this.lock(async () => {
      const owner = this.document(parentId);
      if (owner.kind !== "area")
        throw new FableError("VALIDATION", "Choose an area for this project.");
      const values = await this.validateProjectSettings(input);
      const folder = `Projects/${portableName(owner.title)}`;
      await this.safePath(folder);
      let relative = `${folder}/${portableName(values.title)}.md`,
        suffix = 2;
      while (
        this.documents.some(
          (doc) =>
            doc.path.toLocaleLowerCase() === relative.toLocaleLowerCase(),
        )
      )
        relative = `${folder}/${portableName(values.title)} ${suffix++}.md`;
      const id = randomUUID();
      const raw = patchMetadata(setDocumentTitle("", values.title), {
        schema: 1,
        id,
        kind: "project",
        status: "todo",
        rank: Date.now().toString(),
        parent: parentId,
        source_folders: values.sourceFolders,
        project_files: values.files,
      });
      await this.applyUnlocked({
        id: randomUUID(),
        summary: `Create project ${values.title}`,
        changes: [{ type: "create", path: relative, raw }],
      });
      return this.document(id);
    });
  }
  async updateProject(
    id: string,
    baseRevision: string,
    input: ProjectSettings,
  ) {
    return this.lock(async () => {
      const project = this.document(id);
      if (project.kind !== "project")
        throw new FableError("VALIDATION", "Choose a project to edit.");
      await this.assertRevision(project, baseRevision);
      const { title, sourceFolders, files } =
        await this.validateProjectSettings(input, documentFolder(project));
      const raw = patchMetadata(setDocumentTitle(project.raw, title), {
        source_folders: sourceFolders,
        project_files: files,
      });
      await this.applyUnlocked({
        id: randomUUID(),
        summary: `Edit project ${title}`,
        changes: [
          {
            type: "patch",
            documentId: id,
            baseRevision,
            edits: [{ from: 0, to: project.raw.length, insert: raw }],
          },
        ],
      });
      return this.document(id);
    });
  }
  async preserveDraft(title: string, raw: string) {
    const relative = `Conflicts/${portableName(title)} ${randomUUID().slice(0, 8)}.md`,
      parsed = parseMarkdown(relative, raw);
    const preserved = parsed.managed
      ? patchMetadata(raw, { id: randomUUID(), kind: "note", parent: null })
      : raw;
    await this.apply({
      id: randomUUID(),
      summary: `Preserve draft of ${title}`,
      changes: [{ type: "create", path: relative, raw: preserved }],
    });
    return this.documents.find((d) => d.path === relative)!;
  }
  async metadata(
    id: string,
    baseRevision: string,
    values: Record<string, unknown>,
  ) {
    const doc = this.document(id);
    const raw = patchMetadata(doc.raw, {
      ...(!doc.managed ? { schema: 1, id: randomUUID(), kind: doc.kind } : {}),
      ...values,
    });
    return this.save(id, baseRevision, raw);
  }
  async toggle(
    documentId: string,
    taskId: string,
    baseRevision: string,
    done: boolean,
  ) {
    const doc = this.document(documentId);
    return this.save(doc.id, baseRevision, toggleTask(doc, taskId, done));
  }
  async moveTask(
    documentId: string,
    taskId: string,
    beforeTaskId: string,
    baseRevision: string,
  ) {
    const doc = this.document(documentId);
    return this.save(doc.id, baseRevision, moveTask(doc, taskId, beforeTaskId));
  }
  async updateTask(
    documentId: string,
    taskId: string,
    baseRevision: string,
    values: { status?: WorkStatus; projectId?: string | null },
  ) {
    const doc = this.document(documentId);
    if (values.projectId) {
      const project = this.document(values.projectId);
      if (
        project.kind !== "project" ||
        areaFor(project, this.documents)?.id !==
          areaFor(doc, this.documents)?.id
      )
        throw new FableError("VALIDATION", "Choose a project in this area.");
    }
    return this.save(doc.id, baseRevision, updateTask(doc, taskId, values));
  }
  async addTask(
    title: string,
    documentId?: string,
    options: { status?: WorkStatus; areaId?: string } = {},
  ) {
    const area = options.areaId ? this.document(options.areaId) : undefined;
    if (area && area.kind !== "area")
      throw new FableError("VALIDATION", "Choose an area for this task.");
    let doc = documentId
      ? this.document(documentId)
      : this.documents.find((d) =>
          area
            ? d.kind === "note" &&
              d.metadata.parent === area.id &&
              d.title === "Tasks"
            : d.path === "Notes/Inbox.md",
        );
    if (!doc)
      doc = await this.create(area ? "Tasks" : "Inbox", "note", area?.id);
    if (
      doc.kind === "conversation" ||
      (area && areaFor(doc, this.documents)?.id !== area.id)
    )
      throw new FableError(
        "VALIDATION",
        "Choose a task destination in this area.",
      );
    const status = options.status ?? "todo";
    const eol = doc.raw.includes("\r\n") ? "\r\n" : "\n";
    return this.save(
      doc.id,
      doc.revision,
      doc.raw.replace(/\s*$/, "") +
        `${eol}${eol}- [${status === "done" ? "x" : " "}] ${title.replace(/[\r\n]+/g, " ").trim()} <!-- fable:task ${JSON.stringify({ id: randomUUID(), status, ...(status === "done" ? { completed_at: new Date().toISOString() } : {}) })} -->${eol}`,
    );
  }
  async movePage(
    id: string,
    baseRevision: string,
    parentId: string,
    directory: string,
  ) {
    return this.lock(async () => {
      const doc = this.document(id),
        parent = this.document(parentId);
      if (doc.kind !== "note" || !["project", "area"].includes(parent.kind))
        throw new FableError(
          "VALIDATION",
          "Choose a page and a destination project or area.",
        );
      const base = documentFolder(parent);
      if (directory !== base && !directory.startsWith(base + "/"))
        throw new FableError(
          "VALIDATION",
          "Choose a folder inside the destination project or area.",
        );
      await this.safePath(directory);
      await this.assertRevision(doc, baseRevision);
      const previousOwner =
        projectFor(doc, this.documents) ?? areaFor(doc, this.documents);
      if (
        previousOwner?.id !== parentId &&
        this.documents.some((child) => child.metadata.parent === doc.id)
      )
        throw new FableError(
          "VALIDATION",
          "Move this page’s child notes before moving it to another project or area.",
        );
      const nextPath = `${directory}/${doc.path.split("/").at(-1)!}`,
        moved = { from: doc.path, to: nextPath };
      let raw = applyEdits(doc.raw, relativeLinkEdits(doc, nextPath, moved));
      if (previousOwner?.id !== parentId || !doc.managed)
        raw = patchMetadata(raw, {
          schema: 1,
          id: doc.id,
          kind: "note",
          parent: parentId,
        });
      if (nextPath === doc.path && raw === doc.raw) return this.state;
      const edits = [{ from: 0, to: doc.raw.length, insert: raw }],
        changes: ChangeSet["changes"] = [
          nextPath === doc.path
            ? { type: "patch", documentId: doc.id, baseRevision, edits }
            : {
                type: "move",
                documentId: doc.id,
                baseRevision,
                path: nextPath,
                edits,
              },
        ];
      if (nextPath !== doc.path)
        for (const source of this.documents) {
          if (source.id === doc.id) continue;
          const edits = relativeLinkEdits(source, source.path, moved);
          if (edits.length)
            changes.push({
              type: "patch",
              documentId: source.id,
              baseRevision: source.revision,
              edits,
            });
        }
      return this.applyUnlocked(
        changeSetSchema.parse({
          id: randomUUID(),
          summary: `Move ${doc.title} to ${parent.title}`,
          changes,
        }),
      );
    });
  }
  async reorderSidebar(input: SidebarReorder) {
    return this.lock(async () => {
      const settings = await this.views();
      if (input.revision !== settings.revision)
        throw new FableError(
          "STALE_REVISION",
          "The sidebar changed. Refresh and try the move again.",
        );
      let ids: string[], directory: string | undefined;
      if (input.kind === "projects") {
        ids = this.documents
          .filter(
            (doc) =>
              doc.kind === "project" &&
              (areaFor(doc, this.documents)?.id ?? UNASSIGNED_AREA) ===
                input.parentId,
          )
          .sort(
            (a, b) =>
              Number(settings.bookmarks.includes(b.id)) -
                Number(settings.bookmarks.includes(a.id)) ||
              a.metadata.rank.localeCompare(b.metadata.rank) ||
              a.title.localeCompare(b.title),
          )
          .map((doc) => doc.id);
      } else {
        const parent = this.document(input.parentId),
          base = documentFolder(parent);
        if (!["project", "area"].includes(parent.kind))
          throw new FableError(
            "VALIDATION",
            "Choose a project or area for this order.",
          );
        directory = input.directory ?? base;
        if (directory !== base && !directory.startsWith(base + "/"))
          throw new FableError(
            "VALIDATION",
            "Choose a folder inside this project or area.",
          );
        await this.safePath(directory);
        ids =
          input.kind === "folders"
            ? this.directories
                .filter((dir) => path.posix.dirname(dir) === directory)
                .sort()
            : this.documents
                .filter(
                  (doc) =>
                    doc.kind === "note" &&
                    sidebarPageDirectory(doc, parent) === directory &&
                    (
                      projectFor(doc, this.documents) ??
                      areaFor(doc, this.documents)
                    )?.id === parent.id,
                )
                .map((doc) => doc.id);
      }
      if (!ids.includes(input.source) || !ids.includes(input.target))
        throw new FableError(
          "VALIDATION",
          "Only items in the same folder can be reordered.",
        );
      const key = sidebarOrderKey(input.kind, input.parentId, directory),
        order = orderedSidebarIds(ids, settings.sidebarOrder?.[key]);
      return this.saveViewsUnlocked({
        ...settings,
        sidebarOrder: {
          ...settings.sidebarOrder,
          [key]: reorderSidebarIds(
            order,
            input.source,
            input.target,
            input.position,
          ),
        },
      });
    });
  }
  async rename(id: string, baseRevision: string, nextPath: string) {
    const doc = this.document(id);
    if (doc.path === nextPath) return this.state;
    const moved = { from: doc.path, to: nextPath },
      changes: ChangeSet["changes"] = [
        {
          type: "move",
          documentId: id,
          baseRevision,
          path: nextPath,
          edits: relativeLinkEdits(doc, nextPath, moved),
        },
      ];
    for (const source of this.documents) {
      const edits = relativeLinkEdits(source, source.path, moved);
      if (edits.length && source.id !== id)
        changes.push({
          type: "patch",
          documentId: source.id,
          baseRevision: source.revision,
          edits,
        });
    }
    return this.apply({
      id: randomUUID(),
      summary: `Rename ${doc.title}`,
      changes,
    });
  }
  async apply(input: ChangeSet) {
    return this.lock(() => this.applyUnlocked(changeSetSchema.parse(input)));
  }
  private async applyUnlocked(
    set: ChangeSet,
    directories: DirectoryVersion[] = [],
  ) {
    const completed = path.join(this.root, ".fable/history", `${set.id}.md`);
    try {
      await fs.access(completed);
      return this.state;
    } catch {
      /* a new operation */
    }
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(set.id))
      throw new FableError("VALIDATION", "Invalid operation ID.");
    const staged = new Map<string, string | null>(),
      before = new Map<string, string | null>();
    for (const change of set.changes) {
      if (change.type === "create") {
        await this.safePath(change.path);
        if (!change.path.endsWith(".md"))
          throw new FableError(
            "VALIDATION",
            "Written documents must be Markdown files.",
          );
        try {
          await fs.access(path.join(this.root, change.path));
          throw new FableError("CONFLICT", "A file already uses this name.");
        } catch (e: any) {
          if (e.code !== "ENOENT") throw e;
        }
        if (staged.has(change.path))
          throw new FableError("CONFLICT", "Two changes create the same file.");
        before.set(change.path, null);
        staged.set(change.path, change.raw);
        continue;
      }
      const doc = this.document(change.documentId);
      await this.assertRevision(doc, change.baseRevision);
      if (staged.has(doc.path))
        throw new FableError(
          "VALIDATION",
          "Combine changes to the same document before applying them.",
        );
      before.set(doc.path, doc.raw);
      if (change.type === "patch")
        staged.set(doc.path, applyEdits(doc.raw, change.edits));
      else if (change.type === "trash") staged.set(doc.path, null);
      else {
        await this.safePath(change.path);
        try {
          const destination = await fs.realpath(
              path.join(this.root, change.path),
            ),
            original = await fs.realpath(path.join(this.root, doc.path));
          if (destination !== original)
            throw new FableError("CONFLICT", "A file already uses this name.");
        } catch (e: any) {
          if (e.code !== "ENOENT") throw e;
        }
        if (!/\.md$/i.test(change.path))
          throw new FableError(
            "VALIDATION",
            "A document must keep its .md extension.",
          );
        if (
          this.documents.some(
            (d) =>
              d.id !== doc.id &&
              d.path.toLocaleLowerCase() === change.path.toLocaleLowerCase(),
          )
        )
          throw new FableError("CONFLICT", "A file already uses this name.");
        before.set(change.path, null);
        staged.set(doc.path, null);
        staged.set(change.path, applyEdits(doc.raw, change.edits ?? []));
      }
    }
    const next = this.documents.filter((d) => !staged.has(d.path));
    for (const [p, raw] of staged)
      if (raw !== null) next.push(parseMarkdown(p, raw));
    validateHierarchy(next);
    const beforeDirectories: DirectoryVersion[] = [];
    for (const directory of directories) {
      let exists = false;
      try {
        const stat = await fs.stat(await this.safePath(directory.path));
        if (!stat.isDirectory())
          throw new FableError("CONFLICT", "A file uses this folder path.");
        exists = true;
      } catch (error: any) {
        if (error.code !== "ENOENT") throw error;
      }
      if (exists === directory.exists)
        throw new FableError(
          "STALE_REVISION",
          "This folder changed. Refresh before trying again.",
        );
      beforeDirectories.push({ path: directory.path, exists });
    }
    const journal: Journal = {
      id: set.id,
      summary: set.summary,
      createdAt: new Date().toISOString(),
      before: [...before].map(([p, raw]) => ({ path: p, raw })),
      after: [...staged].map(([p, raw]) => ({ path: p, raw })),
      beforeDirectories,
      afterDirectories: directories,
      state: "prepared",
    };
    const journalFile = `.fable/journal/${set.id}.md`;
    await this.atomic(journalFile, encodeJournal(journal), true);
    await this.writeDirectories(directories, true);
    for (const after of journal.after) {
      const expected = before.get(after.path);
      const absolute = await this.safePath(after.path);
      let current: string | null = null;
      try {
        current = await fs.readFile(absolute, "utf8");
      } catch (e: any) {
        if (e.code !== "ENOENT") throw e;
      }
      if (current !== expected)
        throw new FableError(
          "STALE_REVISION",
          "A file changed while the operation was being saved. Recovery history has been retained.",
        );
      if (after.raw === null) await fs.rm(absolute, { force: true });
      else await this.atomic(after.path, after.raw);
    }
    await this.writeDirectories(directories, false);
    journal.state = "committed";
    await this.atomic(
      `.fable/history/${set.id}.md`,
      encodeJournal(journal),
      true,
    );
    await fs.rm(path.join(this.root, journalFile), { force: true });
    await this.scan();
    return this.state;
  }
  private async writeDirectories(
    directories: DirectoryVersion[],
    exists: boolean,
    recovering = false,
  ) {
    const ordered = directories
      .filter((directory) => directory.exists === exists)
      .sort((a, b) =>
        exists ? a.path.length - b.path.length : b.path.length - a.path.length,
      );
    for (const directory of ordered) {
      const absolute = await this.safePath(directory.path);
      if (exists) await fs.mkdir(absolute, { recursive: true });
      else {
        try {
          await fs.rmdir(absolute);
        } catch (error: any) {
          if (
            recovering &&
            ["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)
          )
            continue;
          throw error;
        }
      }
    }
  }
  async atomic(relative: string, raw: string | Uint8Array, internal = false) {
    const absolute = await this.safePath(relative, internal);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    const temporary = path.join(
      path.dirname(absolute),
      `.${path.basename(absolute)}.${randomUUID()}.tmp`,
    );
    const handle = await fs.open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(raw);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.rename(temporary, absolute);
    } catch (e) {
      await fs.rm(temporary, { force: true });
      throw e;
    }
    try {
      const parent = await fs.open(path.dirname(absolute), "r");
      try {
        await parent.sync();
      } finally {
        await parent.close();
      }
    } catch {
      /* Windows may not allow directory fsync. */
    }
  }
  async history(): Promise<HistoryEntry[]> {
    const directory = path.join(this.root, ".fable/history"),
      files = await fs.readdir(directory);
    const entries = await Promise.all(
      files
        .filter((f) => f.endsWith(".md"))
        .map(async (f) => {
          const j = decodeJournal(
            await fs.readFile(path.join(directory, f), "utf8"),
          );
          return {
            id: j.id,
            summary: j.summary,
            createdAt: j.createdAt,
            paths: [
              ...j.after.map((v) => v.path),
              ...(j.afterDirectories ?? []).map((v) => v.path),
            ],
          };
        }),
    );
    return entries
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 100);
  }
  async undo(id: string) {
    return this.lock(async () => {
      if (!/^[\w-]+$/.test(id))
        throw new FableError("VALIDATION", "Invalid history ID.");
      const j = decodeJournal(
        await fs.readFile(
          path.join(this.root, ".fable/history", `${id}.md`),
          "utf8",
        ),
      );
      const changes: ChangeSet["changes"] = [];
      for (const after of j.after) {
        const before = j.before.find((v) => v.path === after.path)?.raw ?? null;
        const doc = this.documents.find((d) => d.path === after.path);
        if (after.raw === null && doc)
          throw new FableError(
            "STALE_REVISION",
            "A new file uses this path. Restore the old content to a different filename.",
          );
        if (
          after.raw !== null &&
          (!doc || doc.revision !== revisionOf(after.raw))
        )
          throw new FableError(
            "STALE_REVISION",
            "This file has newer edits. Restore its content manually from history.",
          );
        if (before === null && doc)
          changes.push({
            type: "trash",
            documentId: doc.id,
            baseRevision: doc.revision,
          });
        else if (before !== null && doc)
          changes.push({
            type: "patch",
            documentId: doc.id,
            baseRevision: doc.revision,
            edits: [{ from: 0, to: doc.raw.length, insert: before }],
          });
        else if (before !== null)
          changes.push({ type: "create", path: after.path, raw: before });
      }
      for (const directory of j.afterDirectories ?? []) {
        let exists = false;
        try {
          exists = (
            await fs.stat(await this.safePath(directory.path))
          ).isDirectory();
        } catch (error: any) {
          if (error.code !== "ENOENT") throw error;
        }
        if (exists !== directory.exists)
          throw new FableError(
            "STALE_REVISION",
            "This folder has newer changes. Restore its contents manually from history.",
          );
      }
      return changes.length || j.beforeDirectories?.length
        ? this.applyUnlocked(
            { id: randomUUID(), summary: `Undo: ${j.summary}`, changes },
            j.beforeDirectories,
          )
        : this.state;
    });
  }
  async recover() {
    const dir = path.join(this.root, ".fable/journal");
    for (const file of await fs.readdir(dir)) {
      if (!file.endsWith(".md")) continue;
      const j = decodeJournal(await fs.readFile(path.join(dir, file), "utf8"));
      await this.writeDirectories(j.afterDirectories ?? [], true, true);
      for (const after of j.after) {
        const absolute = await this.safePath(after.path);
        let current: string | null = null;
        try {
          current = await fs.readFile(absolute, "utf8");
        } catch (e: any) {
          if (e.code !== "ENOENT") throw e;
        }
        const before = j.before.find((b) => b.path === after.path)?.raw ?? null;
        if (current === after.raw) continue;
        if (current !== before) {
          if (after.raw !== null)
            await this.atomic(
              `Conflicts/Recovered ${portableName(path.basename(after.path, ".md"))} ${j.id.slice(0, 8)}.md`,
              patchMetadata(after.raw, { id: randomUUID() }),
            );
          continue;
        }
        if (after.raw === null) await fs.rm(absolute, { force: true });
        else await this.atomic(after.path, after.raw);
      }
      await this.writeDirectories(j.afterDirectories ?? [], false, true);
      j.state = "committed";
      await this.atomic(`.fable/history/${j.id}.md`, encodeJournal(j), true);
      await fs.rm(path.join(dir, file));
    }
  }
  async addAttachment(name: string, bytes: Uint8Array) {
    const extension = path.extname(name).toLowerCase();
    if (
      ![
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".webp",
        ".avif",
        ".svg",
        ".pdf",
        ".txt",
        ".csv",
      ].includes(extension)
    )
      throw new FableError(
        "VALIDATION",
        "Choose an image, PDF, text, or CSV file.",
      );
    if (bytes.length > 50 * 1024 * 1024)
      throw new FableError("QUOTA", "Attachments can be up to 50 MB.");
    const relative = `Attachments/${portableName(path.basename(name, extension))}-${randomUUID().slice(0, 8)}${extension}`;
    await this.atomic(relative, bytes);
    this.emit("attachment", relative);
    return relative;
  }
  async views(): Promise<ViewSettings> {
    try {
      const raw = await fs.readFile(
          await this.safePath(".fable/views.md", true),
          "utf8",
        ),
        json = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(raw)![1]);
      return {
        bookmarks: Array.isArray(json.bookmarks)
          ? json.bookmarks.filter((v: unknown) => typeof v === "string")
          : [],
        hiddenColumns: Array.isArray(json.hiddenColumns)
          ? json.hiddenColumns
          : ["done"],
        selectedAreaId:
          typeof json.selectedAreaId === "string" ? json.selectedAreaId : null,
        sidebarOrder:
          json.sidebarOrder &&
          typeof json.sidebarOrder === "object" &&
          !Array.isArray(json.sidebarOrder)
            ? (Object.fromEntries(
                Object.entries(json.sidebarOrder).filter(
                  ([, value]) =>
                    Array.isArray(value) &&
                    value.every((id) => typeof id === "string"),
                ),
              ) as Record<string, string[]>)
            : {},
        revision: revisionOf(raw),
      };
    } catch (e: any) {
      if (e.code !== "ENOENT")
        throw new FableError(
          "INVALID_METADATA",
          "The view settings file could not be read. Your notes are safe.",
        );
      return { bookmarks: [], hiddenColumns: ["done"], revision: null };
    }
  }
  async saveViews(settings: ViewSettings) {
    return this.lock(() => this.saveViewsUnlocked(settings));
  }
  private async saveViewsUnlocked(settings: ViewSettings) {
    const current = await this.views();
    if (settings.revision !== current.revision)
      throw new FableError(
        "STALE_REVISION",
        "View settings changed on another device. Refresh before changing them.",
      );
    let existing = "";
    try {
      existing = await fs.readFile(
        await this.safePath(".fable/views.md", true),
        "utf8",
      );
    } catch {}
    const id = existing
      ? parseMarkdown(".fable/views.md", existing).id
      : randomUUID();
    const raw = patchMetadata(
      "# Fable views\n\nPortable bookmarks and board preferences.\n\n```json\n" +
        JSON.stringify(
          {
            bookmarks: settings.bookmarks,
            hiddenColumns: settings.hiddenColumns,
            selectedAreaId: settings.selectedAreaId ?? null,
            sidebarOrder: settings.sidebarOrder ?? current.sidebarOrder ?? {},
          },
          null,
          2,
        ) +
        "\n```\n",
      { schema: 1, id, kind: "note" },
    );
    await this.guardFile(
      ".fable/views.md",
      existing ? Buffer.from(existing) : null,
      true,
    );
    await this.atomic(".fable/views.md", raw, true);
    this.emit("attachment", ".fable/views.md");
    return this.views();
  }
  async search(query: string) {
    return (await this.index?.query(query)) ?? [];
  }
  async close() {
    clearTimeout(this.timer);
    await this.watcher?.unsubscribe();
    this.watcher = undefined;
    await this.serial;
    await this.index?.close();
    this.index = undefined;
    this.documents = [];
    this.directories = [];
  }
}
