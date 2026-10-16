import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { VaultService, portableName } from "../packages/vault/index.ts";
import { patchMetadata } from "../packages/markdown/index.ts";
import Database from "better-sqlite3";
import { pagesFor, areaFor } from "../packages/domain/index.ts";
let directory: string, vault: VaultService;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "fable-test-"));
  vault = new VaultService(path.join(directory, "cache"));
  await vault.open(path.join(directory, "vault"), false);
});
afterEach(async () => {
  await vault.close();
  await fs.rm(directory, { recursive: true, force: true });
});
describe("guarded local storage and recovery", () => {
  it("creates portable project pages and refuses a page without a project or in a different project folder", async () => {
    const area = await vault.create("Writing", "area"),
      project = await vault.create("Book", "project", area.id),
      other = await vault.create("Other", "project", area.id);
    const page = await vault.createPage(project.id, "Outline");
    await vault.createFolder(project.id, "Research");
    const nested = await vault.createPage(
      project.id,
      "References",
      project.path.replace(/\.md$/, "") + "/Research",
    );
    expect(page.kind).toBe("note");
    expect(page.metadata.parent).toBe(project.id);
    expect(areaFor(page, vault.documents)?.id).toBe(area.id);
    expect(await fs.readFile(path.join(vault.root, page.path), "utf8")).toBe(
      page.raw,
    );
    expect(nested.path).toContain("/Research/References.md");
    await expect(vault.createPage(area.id, "Invalid")).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(
      vault.createPage(project.id, "Foreign", other.path.replace(/\.md$/, "")),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    const root = vault.root;
    await vault.close();
    await vault.open(root, false);
    expect(
      pagesFor(project.id, vault.documents)
        .map((page) => page.title)
        .sort(),
    ).toEqual(["Outline", "References"]);
  });
  it("creates area-bound projects, nested folders and Markdown notes without sharing them across areas", async () => {
    const personal = await vault.create("Personal", "area"),
      work = await vault.create("Work", "area");
    const a = await vault.create("Website", "project", personal.id),
      b = await vault.create("Website", "project", work.id);
    expect(a.path).not.toBe(b.path);
    expect(a.metadata.parent).toBe(personal.id);
    expect(b.metadata.parent).toBe(work.id);
    const directory = a.path.replace(/\.md$/, "") + "/References";
    await vault.createFolder(a.id, "References");
    expect(vault.state.directories).toContain(directory);
    const note = await vault.create(
      "Typography",
      "note",
      a.id,
      "- [ ] Choose a font\n",
      directory,
    );
    expect(note.path).toBe(directory + "/Typography.md");
    expect(note.metadata.parent).toBe(a.id);
    await expect(
      vault.createFolder(a.id, "Foreign", b.path.replace(/\.md$/, "")),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      vault.create("Outside", "note", a.id, "", "../outside"),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    const views = await vault.saveViews({
      ...(await vault.views()),
      selectedAreaId: personal.id,
    });
    expect(views.selectedAreaId).toBe(personal.id);
    const root = vault.root;
    await vault.close();
    await vault.open(root, false);
    expect(vault.state.directories).toContain(directory);
    expect(vault.document(note.id).raw).toContain("Choose a font");
  });
  it("rebuilds legacy parsed snapshots without rewriting source Markdown", async () => {
    const doc = await vault.create(
        "Legacy",
        "note",
        undefined,
        '- [ ] One <!-- fable:task {"id":"copied"} -->\n- [ ] Two <!-- fable:task {"id":"copied"} -->\n',
      ),
      root = vault.root;
    await vault.close();
    const name = (await fs.readdir(path.join(directory, "cache"))).find(
        (name) => name.endsWith(".sqlite"),
      )!,
      db = new Database(path.join(directory, "cache", name));
    const row = db.prepare("SELECT snapshot FROM snapshots").get() as {
        snapshot: string;
      },
      legacy = JSON.parse(row.snapshot);
    legacy.tasks.forEach((task: any) => {
      task.id = "copied";
    });
    db.prepare("UPDATE snapshots SET snapshot=?").run(JSON.stringify(legacy));
    db.pragma("user_version=0");
    db.close();
    await vault.open(root, false);
    const reopened = vault.document(doc.id);
    expect(reopened.tasks[0].id).not.toBe(reopened.tasks[1].id);
    expect(await fs.readFile(path.join(root, doc.path), "utf8")).toBe(doc.raw);
  });
  it("renames actual link destinations and rebases moved notes without changing code examples", async () => {
    const target = await vault.create(
        "Target",
        "note",
        undefined,
        "[Other](Other.md)\n",
      ),
      other = await vault.create(
        "Other",
        "note",
        undefined,
        "[Target](Target.md#section)\n\n`[Example](Target.md)`\n\n```md\n[Example](Target.md)\n```\n",
      );
    await vault.rename(target.id, target.revision, "Archive/Renamed.md");
    expect(vault.document(target.id).raw).toContain(
      "[Other](../Notes/Other.md)",
    );
    const incoming = vault.document(other.id).raw;
    expect(incoming).toContain("[Target](../Archive/Renamed.md#section)");
    expect(incoming).toContain("`[Example](Target.md)`");
    expect(incoming).toContain("```md\n[Example](Target.md)\n```");
  });
  it("refuses an unindexed rename collision before moving the original file", async () => {
    const d = await vault.create("Original", "note");
    await fs.writeFile(path.join(vault.root, "occupied.md"), "# External");
    await expect(
      vault.rename(d.id, d.revision, "occupied.md"),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await fs.readFile(path.join(vault.root, d.path), "utf8")).toBe(
      d.raw,
    );
  });
  it("retains recovery information after a disk failure during a multi-file save", async () => {
    const a = await vault.create("A", "note"),
      b = await vault.create("B", "note");
    const atomic = vault.atomic.bind(vault);
    const spy = vi
      .spyOn(vault, "atomic")
      .mockImplementation(async (relative, raw, internal) => {
        if (relative === b.path)
          throw Object.assign(new Error("Disk full"), { code: "ENOSPC" });
        return atomic(relative, raw, internal);
      });
    await expect(
      vault.apply({
        id: randomUUID(),
        summary: "Recover this save",
        changes: [a, b].map((d) => ({
          type: "patch",
          documentId: d.id,
          baseRevision: d.revision,
          edits: [
            {
              from: d.raw.length,
              to: d.raw.length,
              insert: "\nSaved change\n",
            },
          ],
        })),
      }),
    ).rejects.toThrow("Disk full");
    expect(
      (await fs.readdir(path.join(vault.root, ".fable/journal"))).length,
    ).toBe(1);
    spy.mockRestore();
    await vault.open(vault.root, false);
    expect(vault.document(a.id).raw).toContain("Saved change");
    expect(vault.document(b.id).raw).toContain("Saved change");
  });
  it("preserves a draft, including unknown frontmatter, after its source is removed", async () => {
    const raw = patchMetadata(
      '---\nauthor: "mine" # keep\n---\n# Source\n\nUnsaved text\n',
      { schema: 1, id: "source", kind: "note" },
    );
    const copy = await vault.preserveDraft("Source (draft)", raw);
    expect(copy.id).not.toBe("source");
    expect(copy.raw).toContain('author: "mine" # keep');
    expect(copy.raw).toContain("Unsaved text");
    const malformed = "---\nfable: [broken\n---\n# Draft\n";
    const other = await vault.preserveDraft("Malformed draft", malformed);
    expect(other.raw).toBe(malformed);
  });
  it("stores portable view preferences as Markdown with a revision guard", async () => {
    const first = await vault.views();
    expect(first.revision).toBeNull();
    const saved = await vault.saveViews({
      ...first,
      bookmarks: ["note-a"],
      hiddenColumns: ["done"],
    });
    expect(saved.bookmarks).toEqual(["note-a"]);
    expect(
      await fs.readFile(path.join(vault.root, ".fable/views.md"), "utf8"),
    ).toContain("# Fable views");
    await expect(
      vault.saveViews({ ...first, bookmarks: ["note-b"] }),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
  });
  it("opens existing Markdown without adopting or rewriting it", async () => {
    const raw = "# Existing\r\n\r\n- [ ] Keep my file\r\n";
    await fs.writeFile(path.join(vault.root, "Existing.md"), raw);
    await vault.scan();
    expect(vault.documents[0].managed).toBe(false);
    expect(
      await fs.readFile(path.join(vault.root, "Existing.md"), "utf8"),
    ).toBe(raw);
  });
  it("saves, searches, toggles the original checkbox, and reopens offline", async () => {
    const note = await vault.create(
      "Café notes",
      "note",
      undefined,
      "- [ ] Buy coffee\n",
    );
    await vault.toggle(note.id, note.tasks[0].id, note.revision, true);
    expect(
      await fs.readFile(path.join(vault.root, note.path), "utf8"),
    ).toContain("- [x] Buy coffee");
    expect((await vault.search("coffee"))[0].documentId).toBe(note.id);
    const root = vault.root;
    await vault.open(root, false);
    expect(vault.document(note.id).tasks[0].done).toBe(true);
  });
  it("preserves external edits and rejects a stale editor save", async () => {
    const note = await vault.create("Shared", "note", undefined, "Original\n");
    const external = note.raw + "\nWritten in another editor\n";
    await fs.writeFile(path.join(vault.root, note.path), external);
    await expect(
      vault.save(note.id, note.revision, note.raw + "My draft"),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
    expect(await fs.readFile(path.join(vault.root, note.path), "utf8")).toBe(
      external,
    );
  });
  it("applies reviewed changes idempotently and supports guarded undo", async () => {
    const a = await vault.create("A", "note"),
      b = await vault.create("B", "note");
    const id = randomUUID(),
      set = {
        id,
        summary: "An AI proposal",
        changes: [a, b].map((d) => ({
          type: "patch" as const,
          documentId: d.id,
          baseRevision: d.revision,
          edits: [
            {
              from: d.raw.length,
              to: d.raw.length,
              insert: "\nReviewed text\n",
            },
          ],
        })),
      };
    await vault.apply(set);
    await vault.apply(set);
    expect(vault.document(a.id).raw.match(/Reviewed text/g)).toHaveLength(1);
    await vault.undo(id);
    expect(vault.document(a.id).raw).toBe(a.raw);
    expect(vault.document(b.id).raw).toBe(b.raw);
    await vault.save(a.id, vault.document(a.id).revision, a.raw + "Later");
    await expect(vault.undo(id)).rejects.toMatchObject({
      code: "STALE_REVISION",
    });
  });
  it("does not partially apply a proposal containing a stale base", async () => {
    const a = await vault.create("A", "note"),
      b = await vault.create("B", "note");
    await vault.save(b.id, b.revision, b.raw + "Updated");
    await expect(
      vault.apply({
        id: randomUUID(),
        summary: "Stale",
        changes: [a, b].map((d) => ({
          type: "patch",
          documentId: d.id,
          baseRevision: d.revision,
          edits: [{ from: 0, to: 0, insert: "New" }],
        })),
      }),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
    expect(vault.document(a.id).raw).toBe(a.raw);
  });
  it("recovers an interrupted multi-file operation without losing an external edit", async () => {
    const a = await vault.create("A", "note"),
      b = await vault.create("B", "note"),
      id = randomUUID();
    const journal = {
      id,
      summary: "Interrupted",
      createdAt: new Date().toISOString(),
      state: "prepared",
      before: [
        { path: a.path, raw: a.raw },
        { path: b.path, raw: b.raw },
      ],
      after: [
        { path: a.path, raw: a.raw + "after" },
        { path: b.path, raw: b.raw + "after" },
      ],
    };
    await fs.writeFile(path.join(vault.root, a.path), a.raw + "after");
    await fs.writeFile(path.join(vault.root, b.path), b.raw + "external");
    await fs.writeFile(
      path.join(vault.root, ".fable/journal", `${id}.md`),
      "```json\n" + JSON.stringify(journal) + "\n```\n",
    );
    await vault.open(vault.root, false);
    expect(vault.document(a.id).raw).toBe(a.raw + "after");
    expect(vault.document(b.id).raw).toBe(b.raw + "external");
    expect(
      vault.documents.some(
        (d) => d.path.startsWith("Conflicts/") && d.raw.includes("after"),
      ),
    ).toBe(true);
  });
  it("rebuilds its entire disposable search cache", async () => {
    const doc = await vault.create(
      "Searchable",
      "note",
      undefined,
      "unique_rebuild_word",
    );
    const root = vault.root;
    await vault.close();
    await fs.rm(path.join(directory, "cache"), { recursive: true });
    await vault.open(root, false);
    expect((await vault.search("unique_rebuild_word"))[0].documentId).toBe(
      doc.id,
    );
  });
  it("refuses traversal, symlinks, and filename collisions", async () => {
    await expect(vault.safePath("../outside.md")).rejects.toThrow();
    await expect(vault.safePath(".fable/secrets.md")).rejects.toThrow();
    await fs.symlink(directory, path.join(vault.root, "linked"), "dir");
    await expect(vault.safePath("linked/outside.md")).rejects.toThrow(
      /Symbolic/,
    );
    const first = await vault.create("CON", "note");
    expect(first.path).toBe("Notes/_CON.md");
    const second = await vault.create("con", "note");
    expect(second.path.toLowerCase()).not.toBe(first.path.toLowerCase());
    expect(portableName("a:b?")).toBe("a b");
  });
  it("can undo a deletion without overwriting a newly created file", async () => {
    const d = await vault.create("A", "note"),
      id = randomUUID();
    await vault.apply({
      id,
      summary: "Trash",
      changes: [{ type: "trash", documentId: d.id, baseRevision: d.revision }],
    });
    await fs.writeFile(path.join(vault.root, d.path), "# A different note");
    await vault.scan();
    await expect(vault.undo(id)).rejects.toThrow();
    expect(await fs.readFile(path.join(vault.root, d.path), "utf8")).toBe(
      "# A different note",
    );
  });
});
