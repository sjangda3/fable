import { describe, it, expect } from "vitest";
import { parseMarkdown, patchMetadata } from "../packages/markdown/index.ts";
import {
  areaFor,
  documentsInArea,
  projectFor,
  pagesFor,
  validateHierarchy,
  UNASSIGNED_AREA,
} from "../packages/domain/index.ts";
const document = (id: string, kind: string, parent?: string) =>
  parseMarkdown(
    `${id}.md`,
    patchMetadata(`# ${id}\n`, {
      schema: 1,
      id,
      kind,
      ...(parent ? { parent } : {}),
    }),
  );
describe("area ownership", () => {
  it("collects project pages through nested note relationships while excluding conversations and other projects", () => {
    const area = document("area", "area"),
      project = document("project", "project", area.id),
      other = document("other", "project", area.id),
      page = document("page", "note", project.id),
      child = document("child", "note", page.id),
      conversation = document("chat", "conversation", project.id),
      foreign = document("foreign", "note", other.id),
      all = [area, project, other, page, child, conversation, foreign];
    expect(pagesFor(project.id, all).map((page) => page.id)).toEqual([
      "page",
      "child",
    ]);
    expect(pagesFor(other.id, all).map((page) => page.id)).toEqual(["foreign"]);
  });
  it("keeps notes and projects scoped to their own area through stable relationships", () => {
    const personal = document("personal", "area"),
      work = document("work", "area"),
      project = document("project", "project", personal.id),
      note = document("note", "note", project.id),
      nested = document("nested", "note", note.id),
      other = document("other", "note", work.id),
      orphan = document("orphan", "note", "missing");
    const all = [personal, work, project, note, nested, other, orphan];
    expect(() => validateHierarchy(all)).not.toThrow();
    expect(areaFor(nested, all)?.id).toBe(personal.id);
    expect(projectFor(nested, new Map(all.map((d) => [d.id, d])))?.id).toBe(
      project.id,
    );
    expect(documentsInArea(all, personal.id).map((d) => d.id)).toEqual([
      "personal",
      "project",
      "note",
      "nested",
    ]);
    expect(documentsInArea(all, work.id).map((d) => d.id)).toEqual([
      "work",
      "other",
    ]);
    expect(documentsInArea(all, UNASSIGNED_AREA).map((d) => d.id)).toEqual([
      "orphan",
    ]);
  });
  it("reads older goal-to-area relationships without rewriting the original documents", () => {
    const area = document("area", "area"),
      goal = document("goal", "goal", area.id),
      project = document("project", "project", goal.id),
      note = document("note", "note", project.id),
      all = [area, goal, project, note],
      before = all.map((d) => d.raw);
    expect(areaFor(note, all)?.id).toBe(area.id);
    expect(documentsInArea(all, area.id)).toHaveLength(4);
    expect(all.map((d) => d.raw)).toEqual(before);
    const cyclic = document("cycle", "note", "cycle");
    expect(areaFor(cyclic, [cyclic])).toBeUndefined();
  });
});
