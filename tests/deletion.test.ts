import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { VaultService } from "../packages/vault/index.ts";
import { documentFolder } from "../packages/domain/index.ts";

let directory: string, vault: VaultService;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "fable-delete-"));
  vault = new VaultService(path.join(directory, "cache"));
  await vault.open(path.join(directory, "vault"), false);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await vault.close();
  await fs.rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const area = await vault.create("Work", "area"),
    project = await vault.create("Book", "project", area.id);
  const base = documentFolder(project),
    folder = `${base}/Research`;
  await vault.createFolder(project.id, "Research");
  await vault.createFolder(project.id, "Empty", folder);
  const page = await vault.createPage(project.id, "References", folder);
  const sibling = await vault.createPage(project.id, "Outline");
  return { area, project, base, folder, page, sibling };
}
async function latest(summary: string) {
  return (await vault.history()).find((entry) => entry.summary === summary)!;
}

it("deletes only the selected file, preserves its folder and siblings, and supports undo", async () => {
  const { project, folder, page, sibling } = await fixture();
  await vault.deleteDocument(page.id, page.revision);
  expect(vault.documents.some((doc) => doc.id === page.id)).toBe(false);
  expect(vault.document(project.id)).toBeTruthy();
  expect(vault.document(sibling.id)).toBeTruthy();
  expect(vault.directories).toContain(folder);
  await expect(
    fs.access(path.join(vault.root, page.path)),
  ).rejects.toMatchObject({ code: "ENOENT" });
  await vault.undo((await latest("Delete References")).id);
  expect(vault.document(page.id).raw).toBe(page.raw);
});

it("deletes a folder and restores its pages and empty subfolders with their original IDs", async () => {
  const { project, folder, page, sibling } = await fixture();
  await vault.deleteFolder(project.id, folder, project.revision);
  expect(vault.directories).not.toContain(folder);
  expect(vault.documents.some((doc) => doc.id === page.id)).toBe(false);
  expect(vault.document(sibling.id)).toBeTruthy();
  const deletion = await latest("Delete folder Research");
  expect(deletion.paths).toContain(`${folder}/Empty`);
  const root = vault.root;
  await vault.close();
  await vault.open(root, false);
  await vault.undo(deletion.id);
  expect(vault.document(page.id).raw).toBe(page.raw);
  expect(vault.directories).toEqual(
    expect.arrayContaining([folder, `${folder}/Empty`]),
  );
});

it("keeps a separate folder that shares the deleted file's name", async () => {
  const { project, base, sibling } = await fixture();
  await vault.createFolder(project.id, "Outline");
  const child = await vault.createPage(
    project.id,
    "Independent page",
    `${base}/Outline`,
  );
  await vault.deleteDocument(sibling.id, sibling.revision);
  expect(vault.directories).toContain(`${base}/Outline`);
  expect(vault.document(child.id).raw).toBe(child.raw);
});

it("deletes a project with nested pages and legacy notes while preserving other projects", async () => {
  const { area, project, base, page, sibling, folder } = await fixture();
  const legacy = await vault.create(
    "Legacy page",
    "note",
    project.id,
    "Keep this content",
    "Notes",
  );
  const other = await vault.create("Other", "project", area.id);
  await vault.deleteDocument(project.id, project.revision);
  for (const doc of [project, page, sibling, legacy])
    expect(vault.documents.some((item) => item.id === doc.id)).toBe(false);
  expect(vault.document(other.id)).toBeTruthy();
  expect(
    vault.directories.some((dir) => dir === base || dir.startsWith(base + "/")),
  ).toBe(false);
  await vault.undo((await latest("Delete Book")).id);
  for (const doc of [project, page, sibling, legacy])
    expect(vault.document(doc.id).raw).toBe(doc.raw);
  expect(vault.directories).toContain(`${folder}/Empty`);
});

it("supports empty-folder deletion and refuses undo over a newly created folder", async () => {
  const { project, folder } = await fixture();
  const empty = `${folder}/Empty`;
  await vault.deleteFolder(project.id, empty, project.revision);
  const deletion = await latest("Delete folder Empty");
  await vault.undo(deletion.id);
  expect(vault.directories).toContain(empty);
  await vault.deleteFolder(project.id, empty, project.revision);
  const second = await latest("Delete folder Empty");
  await fs.mkdir(path.join(vault.root, empty));
  await fs.writeFile(
    path.join(vault.root, empty, "outside.txt"),
    "New external content",
  );
  await expect(vault.undo(second.id)).rejects.toMatchObject({
    code: "STALE_REVISION",
  });
  expect(
    await fs.readFile(path.join(vault.root, empty, "outside.txt"), "utf8"),
  ).toBe("New external content");
});

it("guards stale files, foreign paths and untracked contents before deleting anything", async () => {
  const { project, folder, page } = await fixture();
  const absolute = path.join(vault.root, page.path);
  await fs.writeFile(absolute, page.raw + "\nExternal edit\n");
  await expect(
    vault.deleteFolder(project.id, folder, project.revision),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  expect(await fs.readFile(absolute, "utf8")).toContain("External edit");
  await fs.writeFile(
    path.join(vault.root, folder, "outside.txt"),
    "Do not lose this",
  );
  await expect(
    vault.deleteFolder(project.id, folder, project.revision),
  ).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(
    vault.deleteFolder(project.id, documentFolder(project), project.revision),
  ).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(
    vault.deleteFolder(
      project.id,
      folder + "/../../Elsewhere",
      project.revision,
    ),
  ).rejects.toMatchObject({ code: "VALIDATION" });
  expect(vault.document(project.id)).toBeTruthy();
  expect(
    await fs.readFile(path.join(vault.root, folder, "outside.txt"), "utf8"),
  ).toBe("Do not lose this");
});

it("recovers an interrupted folder deletion and keeps the whole deletion undoable", async () => {
  const { project, folder, page } = await fixture();
  const remove = vi
    .spyOn(fs, "rmdir")
    .mockRejectedValueOnce(
      Object.assign(new Error("Disk unavailable"), { code: "EIO" }),
    );
  await expect(
    vault.deleteFolder(project.id, folder, project.revision),
  ).rejects.toThrow("Disk unavailable");
  remove.mockRestore();
  const root = vault.root;
  await vault.close();
  await vault.open(root, false);
  expect(vault.directories).not.toContain(folder);
  expect(vault.documents.some((doc) => doc.id === page.id)).toBe(false);
  await vault.undo((await latest("Delete folder Research")).id);
  expect(vault.document(page.id).raw).toBe(page.raw);
  expect(vault.directories).toContain(`${folder}/Empty`);
});
