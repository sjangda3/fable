import { afterEach, beforeEach, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { VaultService } from "../packages/vault/index.ts";
import { parseMarkdown, setDocumentTitle } from "../packages/markdown/index.ts";
import {
  projectFiles,
  projectSourceFolders,
  searchProjectFolders,
} from "../packages/domain/project-settings.ts";
import { AppService } from "../apps/desktop/main/service.ts";

let directory: string, vault: VaultService;
beforeEach(async () => {
  directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "fable-project-settings-"),
  );
  vault = new VaultService(path.join(directory, "cache"));
  await vault.open(path.join(directory, "vault"), false);
});
afterEach(async () => {
  await vault.close();
  await fs.rm(directory, { recursive: true, force: true });
});
it("creates a configured project in one operation and can undo it without changing linked sources", async () => {
  const area = await vault.create("Personal", "area"),
    source = await vault.create("Reference", "project", area.id);
  await vault.createFolder(source.id, "Research");
  const sourceFolder = source.path.replace(/\.md$/, "") + "/Research",
    uploaded = await vault.addAttachment("brief.txt", Buffer.from("Brief"));
  const previous = new Set((await vault.history()).map((entry) => entry.id));
  const project = await vault.createProject(area.id, {
    title: "Website [new]",
    sourceFolders: [sourceFolder],
    files: [{ name: "brief.txt", path: uploaded, size: 5 }],
  });
  expect(project.title).toBe("Website [new]");
  expect(project.metadata.parent).toBe(area.id);
  expect(projectSourceFolders(project)).toEqual([sourceFolder]);
  expect(projectFiles(project)[0].path).toBe(uploaded);
  const created = (await vault.history()).filter(
    (entry) => !previous.has(entry.id),
  );
  expect(created).toHaveLength(1);
  await vault.undo(created[0].id);
  expect(vault.documents.some((doc) => doc.id === project.id)).toBe(false);
  expect(vault.document(source.id).raw).toBe(source.raw);
  expect(
    (await fs.stat(path.join(vault.root, sourceFolder))).isDirectory(),
  ).toBe(true);
});
it("validates new project sources and ownership before creating any document", async () => {
  const area = await vault.create("Personal", "area"),
    note = await vault.create("Note", "note", area.id),
    count = vault.documents.length;
  const input = { title: "New project", sourceFolders: [], files: [] };
  await expect(vault.createProject(note.id, input)).rejects.toMatchObject({
    code: "VALIDATION",
  });
  await expect(
    vault.createProject(area.id, { ...input, sourceFolders: ["../outside"] }),
  ).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(
    vault.createProject(area.id, {
      ...input,
      files: [
        { name: "missing.txt", path: "Attachments/missing.txt", size: 1 },
      ],
    }),
  ).rejects.toMatchObject({ code: "VALIDATION" });
  expect(vault.documents).toHaveLength(count);
  const project = await vault.createProject(area.id, input);
  expect(projectSourceFolders(project)).toEqual([]);
});
it("finds source folders by name, relative path, and pasted workspace path", () => {
  const folders = [
    "Projects/Website/Research",
    "Projects/Website/Images",
    "Notes/Reading",
  ];
  expect(searchProjectFolders(folders, "research")).toEqual([folders[0]]);
  expect(searchProjectFolders(folders, "./Projects/Website/")).toEqual(
    folders.slice(0, 2),
  );
  expect(
    searchProjectFolders(
      folders,
      "/Users/sameer/Vault/Projects/Website/Research/",
      "/Users/sameer/Vault",
    ),
  ).toEqual([folders[0]]);
  expect(
    searchProjectFolders(
      folders,
      "C:\\Vault\\Projects\\Website\\Images",
      "C:\\Vault",
    ),
  ).toEqual([folders[1]]);
  expect(
    searchProjectFolders(folders, "/some/other/folder", "/Users/sameer/Vault"),
  ).toEqual([]);
});

it("saves the project name, linked workspace folders, and files together and retains pages", async () => {
  const area = await vault.create("Personal", "area"),
    project = await vault.create(
      "Website",
      "project",
      area.id,
      "Keep this description.\n",
    ),
    page = await vault.createPage(project.id, "Brief");
  await vault.createFolder(project.id, "References");
  const root = project.path.replace(/\.md$/, ""),
    folder = root + "/References";
  const uploaded = await vault.addAttachment(
    "brief.txt",
    Buffer.from("Project brief"),
  );
  const values = {
    title: "Website [2026]",
    sourceFolders: [root, folder, folder],
    files: [{ name: "brief.txt", path: uploaded, size: 13 }],
  };
  const result = await vault.updateProject(
    project.id,
    project.revision,
    values,
  );
  expect(result.title).toBe(values.title);
  expect(result.path).toBe(project.path);
  expect(result.metadata.parent).toBe(area.id);
  expect(result.body).toContain("Keep this description.");
  expect(projectSourceFolders(result)).toEqual([root, folder]);
  expect(projectFiles(result)).toEqual(values.files);
  expect(vault.document(page.id).metadata.parent).toBe(project.id);
  const vaultRoot = vault.root;
  await vault.close();
  await vault.open(vaultRoot, false);
  expect(projectFiles(vault.document(project.id))).toEqual(values.files);
  expect(projectSourceFolders(vault.document(project.id))).toEqual([
    root,
    folder,
  ]);
});
it("unlinks sources and files without deleting local content, and supports undo", async () => {
  const project = await vault.create("Website", "project"),
    root = project.path.replace(/\.md$/, ""),
    uploaded = await vault.addAttachment("keep.txt", Buffer.from("Keep"));
  await vault.createFolder(project.id, "Research");
  const saved = await vault.updateProject(project.id, project.revision, {
    title: "Website",
    sourceFolders: [root],
    files: [{ name: "keep.txt", path: uploaded, size: 4 }],
  });
  const removed = await vault.updateProject(project.id, saved.revision, {
    title: "Updated website",
    sourceFolders: [],
    files: [],
  });
  expect(projectFiles(removed)).toEqual([]);
  expect(projectSourceFolders(removed)).toEqual([]);
  expect(await fs.readFile(path.join(vault.root, uploaded), "utf8")).toBe(
    "Keep",
  );
  expect(
    (await fs.stat(path.join(vault.root, root, "Research"))).isDirectory(),
  ).toBe(true);
  await vault.undo((await vault.history())[0].id);
  expect(vault.document(project.id).title).toBe("Website");
  expect(projectFiles(vault.document(project.id))).toHaveLength(1);
});
it("rejects stale edits before changing the project", async () => {
  const project = await vault.create("Website", "project"),
    newer = await vault.save(
      project.id,
      project.revision,
      project.raw + "New work\n",
    );
  await expect(
    vault.updateProject(project.id, project.revision, {
      title: "Old change",
      sourceFolders: [],
      files: [],
    }),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  expect(vault.document(project.id).raw).toBe(newer.raw);
});
it("validates workspace folders and attachment paths before committing", async () => {
  const project = await vault.create("Website", "project"),
    values = { title: "Updated", sourceFolders: [], files: [] };
  await expect(
    vault.updateProject(project.id, project.revision, {
      ...values,
      sourceFolders: ["../outside"],
    }),
  ).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(
    vault.updateProject(project.id, project.revision, {
      ...values,
      sourceFolders: ["Missing"],
    }),
  ).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(
    vault.updateProject(project.id, project.revision, {
      ...values,
      files: [{ name: "Missing", path: "Attachments/missing.txt", size: 3 }],
    }),
  ).rejects.toMatchObject({ code: "VALIDATION" });
  expect(vault.document(project.id).raw).toBe(project.raw);
});
it("updates a real title while preserving frontmatter, code, and CRLF", () => {
  const raw =
    "---\r\nauthor: mine\r\n---\r\n\r\n```md\r\n# Example\r\n```\r\n\r\nOriginal title\r\n==============\r\n\r\nBody\r\n";
  const updated = setDocumentTitle(raw, "New *project*");
  expect(updated).toContain("---\r\nauthor: mine\r\n---\r\n");
  expect(updated).toContain("```md\r\n# Example\r\n```");
  expect(updated).toContain("# New \\*project\\*\r\n\r\nBody\r\n");
  expect(parseMarkdown("project.md", updated).title).toBe("New *project*");
});
it("keeps punctuation literal in a project name", () => {
  const title = "Website ~~draft~~ &copy; ###";
  expect(
    parseMarkdown("project.md", setDocumentTitle("# Old name\n\nBody", title))
      .title,
  ).toBe(title);
});
it("accepts an empty text upload through the same API as the modal", async () => {
  const app = new AppService(
    path.join(directory, "app"),
    {
      get: async () => undefined,
      set: async () => {},
    },
    undefined,
    path.join(directory, "upload-vault"),
  );
  try {
    await app.initialize();
    const project = await app.request("documents.create", {
      title: "Files",
      kind: "project",
    });
    const uploaded = await app.request("attachments.add", {
      name: "empty.txt",
      data: "",
    });
    expect(uploaded).toMatch(/^Attachments\/empty-/);
    const updated = await app.request("projects.update", {
      id: project.id,
      baseRevision: project.revision,
      title: "Files",
      sourceFolders: [],
      files: [{ name: "empty.txt", path: uploaded!, size: 0 }],
    });
    expect(projectFiles(updated)[0].size).toBe(0);
  } finally {
    await app.close();
  }
});
