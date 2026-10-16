import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { VaultService } from "../packages/vault/index.ts";
import { documentFolder, projectFor } from "../packages/domain/index.ts";
import {
  sidebarOrderKey,
  orderedSidebarIds,
  orderedSidebarPages,
} from "../packages/domain/sidebar.ts";
import {
  planSidebarDrop,
  type SidebarItem,
} from "../apps/desktop/renderer/sidebar-drag.ts";

let directory: string, vault: VaultService;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "fable-sidebar-"));
  vault = new VaultService(path.join(directory, "cache"));
  await vault.open(path.join(directory, "vault"), false);
});
afterEach(async () => {
  await vault.close();
  await fs.rm(directory, { recursive: true, force: true });
});

describe("persistent sidebar organization", () => {
  it("keeps a page moved from beyond the preview limit visible after reordering", async () => {
    const area = await vault.create("Area", "area"),
      project = await vault.create("Project", "project", area.id),
      pages = [];
    for (let n = 0; n < 7; n++)
      pages.push(await vault.createPage(project.id, `Page ${n}`));
    const settings = await vault.reorderSidebar({
      kind: "pages",
      parentId: project.id,
      source: pages[6].id,
      target: pages[0].id,
      position: "before",
      revision: null,
    });
    expect(
      orderedSidebarPages(pages, project, settings.sidebarOrder)
        .slice(0, 5)
        .map((page) => page.id),
    ).toEqual([pages[6].id, ...pages.slice(0, 4).map((page) => page.id)]);
  });
  it("reorders projects, sibling folders and pages without rewriting notes, and retains order when reopened", async () => {
    const area = await vault.create("Writing", "area"),
      a = await vault.create("Book", "project", area.id),
      b = await vault.create("Journal", "project", area.id),
      base = documentFolder(a);
    await vault.createFolder(a.id, "Alpha");
    await vault.createFolder(a.id, "Beta");
    const first = await vault.createPage(a.id, "First"),
      second = await vault.createPage(a.id, "Second");
    let settings = await vault.reorderSidebar({
      kind: "projects",
      parentId: area.id,
      source: b.id,
      target: a.id,
      position: "before",
      revision: null,
    });
    settings = await vault.reorderSidebar({
      kind: "folders",
      parentId: a.id,
      directory: base,
      source: `${base}/Beta`,
      target: `${base}/Alpha`,
      position: "before",
      revision: settings.revision,
    });
    settings = await vault.reorderSidebar({
      kind: "pages",
      parentId: a.id,
      directory: base,
      source: second.id,
      target: first.id,
      position: "before",
      revision: settings.revision,
    });
    // Older clients saving other preferences must not erase the new order.
    await vault.saveViews({
      bookmarks: [a.id],
      hiddenColumns: [],
      revision: settings.revision,
    });
    const root = vault.root;
    await vault.close();
    await vault.open(root, false);
    const saved = await vault.views();
    expect(saved.sidebarOrder?.[sidebarOrderKey("projects", area.id)]).toEqual([
      b.id,
      a.id,
    ]);
    expect(
      saved.sidebarOrder?.[sidebarOrderKey("folders", a.id, base)],
    ).toEqual([`${base}/Beta`, `${base}/Alpha`]);
    expect(saved.sidebarOrder?.[sidebarOrderKey("pages", a.id, base)]).toEqual([
      second.id,
      first.id,
    ]);
    expect(vault.document(first.id).raw).toBe(first.raw);
    expect(vault.document(second.id).raw).toBe(second.raw);
    expect(
      orderedSidebarIds(["a", "b", "new"], ["deleted", "b", "b", "a"]),
    ).toEqual(["b", "a", "new"]);
  });

  it("rejects stale ordering and targets from a different parent", async () => {
    const area = await vault.create("Area", "area"),
      a = await vault.create("A", "project", area.id),
      b = await vault.create("B", "project", area.id);
    const settings = await vault.saveViews({
      ...(await vault.views()),
      bookmarks: [a.id],
    });
    await expect(
      vault.reorderSidebar({
        kind: "projects",
        parentId: area.id,
        source: b.id,
        target: a.id,
        position: "before",
        revision: null,
      }),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
    await vault.createFolder(a.id, "One");
    await vault.createFolder(b.id, "Other");
    await expect(
      vault.reorderSidebar({
        kind: "folders",
        parentId: a.id,
        source: `${documentFolder(a)}/One`,
        target: `${documentFolder(b)}/Other`,
        position: "after",
        revision: settings.revision,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await vault.views()).revision).toBe(settings.revision);
  });

  it("moves a page across projects, repairs incoming and outgoing relative links, preserves its identity and supports undo", async () => {
    const area = await vault.create("Writing", "area"),
      a = await vault.create("Book", "project", area.id),
      b = await vault.create("Journal", "project", area.id),
      reference = await vault.createPage(a.id, "Reference");
    await vault.createFolder(b.id, "Drafts");
    let page = await vault.createPage(a.id, "Chapter");
    page = await vault.save(
      page.id,
      page.revision,
      page.raw +
        `[Reference](Reference.md)\n\n- [ ] Write <!-- untouched -->\n`,
    );
    const incoming = await vault.create(
      "Index",
      "note",
      area.id,
      `[Chapter](${path.posix.relative("Notes/Writing", page.path)})\n`,
    );
    await vault.movePage(
      page.id,
      page.revision,
      b.id,
      `${documentFolder(b)}/Drafts`,
    );
    const moved = vault.document(page.id),
      history = await vault.history();
    expect(moved.path).toBe(`${documentFolder(b)}/Drafts/Chapter.md`);
    expect(moved.metadata.parent).toBe(b.id);
    expect(projectFor(moved, vault.documents)?.id).toBe(b.id);
    expect(moved.raw).toContain(
      `[Reference](${path.posix.relative(path.posix.dirname(moved.path), reference.path)})`,
    );
    expect(moved.raw).toContain("- [ ] Write <!-- untouched -->");
    expect(vault.document(incoming.id).raw).toContain(
      encodeURI(
        path.posix.relative(path.posix.dirname(incoming.path), moved.path),
      ),
    );
    await expect(
      fs.access(path.join(vault.root, page.path)),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await vault.undo(history[0].id);
    expect(vault.document(page.id).raw).toBe(page.raw);
    expect(vault.document(page.id).path).toBe(page.path);
    expect(vault.document(incoming.id).raw).toBe(incoming.raw);
  });

  it("keeps both pages intact on filename collisions, external edits and invalid destinations", async () => {
    const area = await vault.create("Area", "area"),
      a = await vault.create("A", "project", area.id),
      b = await vault.create("B", "project", area.id),
      page = await vault.createPage(a.id, "Same"),
      other = await vault.createPage(b.id, "Same");
    await expect(
      vault.movePage(page.id, page.revision, b.id, documentFolder(b)),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(vault.document(page.id).raw).toBe(page.raw);
    expect(vault.document(other.id).raw).toBe(other.raw);
    await expect(
      vault.movePage(page.id, page.revision, b.id, `${documentFolder(b)}/../A`),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await fs.writeFile(
      path.join(vault.root, page.path),
      page.raw + "External change\n",
    );
    await expect(
      vault.movePage(page.id, page.revision, a.id, documentFolder(a)),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
    expect(vault.document(page.id).raw).toContain("External change");
  });
});

describe("sidebar drop intentions", () => {
  const page: SidebarItem = {
    kind: "page",
    id: "page",
    parentId: "project",
    directory: "Projects/Book",
    title: "Page",
  };
  const folder: SidebarItem = {
    kind: "folder",
    id: "Projects/Book/Research",
    parentId: "project",
    directory: "Projects/Book",
    title: "Research",
  };
  it("moves pages into folders, other projects, and area notes", () => {
    expect(planSidebarDrop(page, folder, "before")).toEqual({
      kind: "move",
      pageId: "page",
      parentId: "project",
      directory: folder.id,
    });
    expect(
      planSidebarDrop(
        page,
        {
          kind: "project",
          id: "other",
          parentId: "area",
          directory: "Projects/Other",
          title: "Other",
        },
        "after",
      ),
    ).toMatchObject({
      kind: "move",
      parentId: "other",
      directory: "Projects/Other",
    });
    expect(
      planSidebarDrop(
        page,
        {
          kind: "root",
          id: "root",
          parentId: "area",
          directory: "Notes/Area",
          title: "Notes",
        },
        "before",
      ),
    ).toMatchObject({ kind: "move", parentId: "area" });
  });
  it("reorders only siblings and ignores self, cross-parent and already-current-folder drops", () => {
    const sibling = { ...folder, id: "Projects/Book/Drafts", title: "Drafts" };
    expect(planSidebarDrop(folder, sibling, "after")).toMatchObject({
      kind: "reorder",
      request: {
        kind: "folders",
        source: folder.id,
        target: sibling.id,
        position: "after",
      },
    });
    expect(
      planSidebarDrop(
        folder,
        { ...sibling, directory: "Projects/Book/Research" },
        "before",
      ),
    ).toBeNull();
    expect(
      planSidebarDrop(
        page,
        { ...page, id: "other", parentId: "elsewhere" },
        "before",
      ),
    ).toBeNull();
    expect(planSidebarDrop(page, page, "before")).toBeNull();
    expect(
      planSidebarDrop(
        page,
        {
          kind: "project",
          id: "project",
          parentId: "area",
          directory: page.directory,
          title: "Book",
        },
        "after",
      ),
    ).toBeNull();
  });
});
