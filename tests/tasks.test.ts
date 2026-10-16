import { afterEach, beforeEach, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { VaultService } from "../packages/vault/index.ts";
import {
  areaFor,
  taskGroups,
  taskProjectFor,
} from "../packages/domain/index.ts";
import { parseMarkdown, updateTask } from "../packages/markdown/index.ts";

let directory: string, vault: VaultService;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "fable-tasks-"));
  vault = new VaultService(path.join(directory, "cache"));
  await vault.open(path.join(directory, "vault"), false);
});
afterEach(async () => {
  await vault.close();
  await fs.rm(directory, { recursive: true, force: true });
});

it("creates area-scoped tasks with and without a project and keeps them after reopening", async () => {
  const area = await vault.create("Work", "area");
  const project = await vault.create("Launch", "project", area.id);
  const assigned = await vault.addTask("Prepare launch", project.id, {
    areaId: area.id,
    status: "doing",
  });
  expect(taskProjectFor(assigned.tasks[0], assigned, vault.documents)?.id).toBe(
    project.id,
  );
  expect(assigned.tasks[0].status).toBe("doing");
  let inbox = await vault.addTask("Unassigned step", undefined, {
    areaId: area.id,
    status: "ready",
  });
  expect(areaFor(inbox, vault.documents)?.id).toBe(area.id);
  expect(inbox.tasks[0].status).toBe("ready");
  const second = await vault.addTask("Another step", undefined, {
    areaId: area.id,
  });
  expect(second.id).toBe(inbox.id);
  inbox = await vault.updateTask(
    second.id,
    second.tasks[0].id,
    second.revision,
    { projectId: project.id },
  );
  const root = vault.root;
  await vault.close();
  await vault.open(root, false);
  const reopened = vault.document(inbox.id);
  expect(reopened.tasks).toHaveLength(2);
  expect(reopened.tasks[0].projectId).toBe(project.id);
  expect(
    taskGroups(vault.documents)
      .find((group) => group.id === project.id)
      ?.tasks.map((task) => task.title),
  ).toEqual(expect.arrayContaining(["Prepare launch", "Unassigned step"]));
});

it("reassigns individual note tasks without moving the note and synchronizes completion", async () => {
  const area = await vault.create("Work", "area");
  const a = await vault.create("Alpha", "project", area.id);
  const b = await vault.create("Beta", "project", area.id);
  let note = await vault.create(
    "Notes",
    "note",
    a.id,
    '- [ ] First <!-- fable:task {"id":"first","custom":true} -->\n  Supporting text\n  - [ ] Child\n- [ ] Second\n',
  );
  const originalPath = note.path;
  const child = note.tasks[1];
  note = await vault.updateTask(note.id, "first", note.revision, {
    projectId: b.id,
    status: "waiting",
  });
  expect(note.path).toBe(originalPath);
  expect(note.metadata.parent).toBe(a.id);
  expect(note.raw).toContain('"custom":true');
  expect(note.raw).toContain(
    "  Supporting text\n  - [ ] Child\n- [ ] Second\n",
  );
  expect(taskProjectFor(note.tasks[0], note, vault.documents)?.id).toBe(b.id);
  expect(taskProjectFor(child, note, vault.documents)?.id).toBe(a.id);
  note = await vault.updateTask(note.id, "first", note.revision, {
    status: "done",
  });
  const completedAt = note.tasks[0].completedAt;
  expect(note.tasks[0].done).toBe(true);
  expect(completedAt).toBeTruthy();
  note = await vault.updateTask(note.id, "first", note.revision, {
    projectId: null,
  });
  expect(note.tasks[0].completedAt).toBe(completedAt);
  expect(taskGroups(vault.documents, true)[0].title).toBe("No project");
  note = await vault.updateTask(note.id, "first", note.revision, {
    status: "doing",
  });
  expect(note.tasks[0].done).toBe(false);
  expect(note.tasks[0].completedAt).toBeUndefined();
  expect(note.tasks[0].projectId).toBeNull();
});

it("rejects stale edits and assignments to another area without changing source files", async () => {
  const a = await vault.create("Work", "area");
  const b = await vault.create("Home", "area");
  const project = await vault.create("Repairs", "project", b.id);
  const before = await vault.addTask("Focus", undefined, { areaId: a.id });
  const after = await vault.updateTask(
    before.id,
    before.tasks[0].id,
    before.revision,
    { status: "doing" },
  );
  await expect(
    vault.updateTask(before.id, before.tasks[0].id, before.revision, {
      status: "done",
    }),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  await expect(
    vault.updateTask(after.id, after.tasks[0].id, after.revision, {
      projectId: project.id,
    }),
  ).rejects.toMatchObject({ code: "VALIDATION" });
  expect(await fs.readFile(path.join(vault.root, after.path), "utf8")).toBe(
    after.raw,
  );
});

it("updates a plain CRLF checkbox without changing nested text or surrounding content", () => {
  const raw =
    "# Tasks\r\n\r\n- [ ] First\r\n  More text\r\n  - [ ] Nested\r\n- [ ] Last\r\n";
  const doc = parseMarkdown("Tasks.md", raw);
  const result = updateTask(doc, doc.tasks[0].id, {
    status: "ready",
    projectId: "project",
  });
  const next = parseMarkdown("Tasks.md", result);
  expect(next.tasks[0]).toMatchObject({
    status: "ready",
    projectId: "project",
    done: false,
  });
  expect(result).toContain(
    " -->\r\n  More text\r\n  - [ ] Nested\r\n- [ ] Last\r\n",
  );
  expect(result.replaceAll("\r\n", "")).not.toContain("\n");
});
