import { describe, expect, it } from "vitest";
import {
  applyEdits,
  frontmatter,
  parseMarkdown,
  patchMetadata,
  toggleTask,
  moveTask,
} from "../packages/markdown/index.ts";
import { validateHierarchy } from "../packages/domain/index.ts";

describe("Markdown is the authoritative document", () => {
  it("hides annotations from task titles even when more text follows them", () => {
    const doc = parseMarkdown(
      "a.md",
      '- [ ] Idea <!-- fable:task {"id":"a"} --> continues',
    );
    expect(doc.tasks[0].title).toBe("Idea  continues");
  });
  it("preserves unsupported task properties while ignoring invalid display values", () => {
    const raw =
      '- [ ] Task <!-- fable:task {"id":"a","due":{"unknown":true},"completed_at":42} -->';
    const doc = parseMarkdown("a.md", raw);
    expect(doc.raw).toBe(raw);
    expect(doc.tasks[0].due).toBeUndefined();
    expect(doc.tasks[0].completedAt).toBeUndefined();
  });
  it("targets the selected task after an annotation was duplicated by copy and paste", () => {
    const raw =
      '# Note\n\n- [ ] Original <!-- fable:task {"id":"copied"} -->\n- [ ] Copy <!-- fable:task {"id":"copied"} -->\n';
    const doc = parseMarkdown("a.md", raw);
    expect(doc.raw).toBe(raw);
    expect(doc.tasks[0].id).not.toBe(doc.tasks[1].id);
    const next = parseMarkdown("a.md", toggleTask(doc, doc.tasks[1].id, true));
    expect(next.tasks.map((t) => t.done)).toEqual([false, true]);
    expect(next.raw).toContain(
      '- [ ] Original <!-- fable:task {"id":"copied"} -->',
    );
    expect(next.tasks[1].id).not.toBe("copied");
  });
  it("keeps suggested checkboxes in saved conversations out of the task list", () => {
    const raw = patchMetadata(
      "# Conversation\n\n## Assistant\n\n- [ ] An unapproved suggestion\n",
      { schema: 1, id: "chat", kind: "conversation" },
    );
    expect(parseMarkdown("Conversations/chat.md", raw).tasks).toHaveLength(0);
    expect(raw).toContain("- [ ] An unapproved suggestion");
  });
  it("adopts empty frontmatter and patches flow mappings without corrupting YAML", () => {
    const empty = patchMetadata("---\n---\n# Empty\n", {
      schema: 1,
      id: "empty",
      kind: "note",
    });
    expect(parseMarkdown("e.md", empty).managed).toBe(true);
    const flow = patchMetadata(
      '---\nauthor: "mine" # keep\nfable: {id: one, kind: project, status: todo}\n---\n# Flow\n',
      { status: "doing", due: "2026-10-16" },
    );
    expect(parseMarkdown("f.md", flow).metadata.status).toBe("doing");
    expect(parseMarkdown("f.md", flow).metadata.due).toBe("2026-10-16");
    expect(flow).toContain('author: "mine" # keep');
    expect(() =>
      patchMetadata("---\nbroken: yes\n# Missing delimiter", { id: "x" }),
    ).toThrow(/frontmatter/);
  });
  it("reorders the full task block, including nested content and annotations", () => {
    const raw =
      '# List\r\n\r\n- [ ] A <!-- fable:task {"id":"a"} -->\r\n  supporting text\r\n  - [ ] Child\r\n- [ ] B <!-- fable:task {"id":"b"} -->\r\n';
    const doc = parseMarkdown("a.md", raw),
      next = moveTask(doc, "a", "b");
    expect(next).toBe(raw); // A is already immediately before B.
    const reversed = moveTask(doc, "b", "a");
    expect(reversed.indexOf("- [ ] B")).toBeLessThan(
      reversed.indexOf("- [ ] A"),
    );
    expect(reversed).toContain("  supporting text\r\n  - [ ] Child\r\n");
  });
  it("does not change a byte merely by opening a note", () => {
    const raw =
      '\uFEFF---\r\naliases: ["Café", 漢字] # keep this\r\ncustom: |\r\n  untouched\r\n---\r\n# My *note*\r\n\r\n- [ ] One\r\n';
    const d = parseMarkdown("自由.md", raw);
    expect(d.raw).toBe(raw);
    expect(d.title).toBe("My note");
    expect(d.managed).toBe(false);
    expect(d.tasks[0].title).toBe("One");
  });
  it("patches only the selected property and preserves comments, quoting and CRLF", () => {
    const raw =
      '---\r\nauthor: "Sameer" # mine\r\nfable:\r\n  schema: 1\r\n  id: "project-1"\r\n  kind: project\r\n  status: todo # status comment\r\nother: \'untouched\'\r\n---\r\n# Title\r\n';
    const next = patchMetadata(raw, { status: "doing", due: "2026-10-15" });
    expect(next).toContain('status: "doing" # status comment\r\n');
    expect(next).toContain("other: 'untouched'\r\n");
    expect(next).toContain('author: "Sameer" # mine\r\n');
    expect(parseMarkdown("p.md", next).metadata.due).toBe("2026-10-15");
    expect(next.endsWith("# Title\r\n")).toBe(true);
  });
  it("adds metadata without reserializing unrelated YAML", () => {
    const original =
      "---\ntags: [one, two] # important\n---\n# Title\n\nText **exactly** as written.\n";
    const next = patchMetadata(original, { schema: 1, id: "a", kind: "note" });
    expect(next).toContain("tags: [one, two] # important\n");
    expect(parseMarkdown("a.md", next).id).toBe("a");
    expect(next.slice(next.indexOf("# Title"))).toBe(
      original.slice(original.indexOf("# Title")),
    );
  });
  it("rejects property edits to malformed YAML without producing new content", () => {
    const raw = "---\nfable: [broken\n---\n# Preserved\n";
    expect(parseMarkdown("a.md", raw).diagnostics.length).toBeGreaterThan(0);
    expect(() => patchMetadata(raw, { status: "done" })).toThrow(/YAML/);
  });
  it("completes the correct duplicate task and preserves nested content", () => {
    const raw =
      '# Tasks\r\n\r\n- [ ] Duplicate\r\n  detail stays here\r\n  - [ ] Child <!-- fable:task {"id":"child"} -->\r\n- [ ] Duplicate\r\n';
    const doc = parseMarkdown("tasks.md", raw);
    expect(doc.tasks.map((t) => t.title)).toEqual([
      "Duplicate",
      "Child",
      "Duplicate",
    ]);
    expect(doc.tasks[0].id).not.toBe("child");
    const next = toggleTask(doc, doc.tasks[2].id, true),
      parsed = parseMarkdown("tasks.md", next);
    expect(parsed.tasks.map((t) => t.done)).toEqual([false, false, true]);
    expect(parsed.tasks[2].completedAt).toBeTruthy();
    expect(next.slice(0, raw.lastIndexOf("- [ ] Duplicate"))).toBe(
      raw.slice(0, raw.lastIndexOf("- [ ] Duplicate")),
    );
    expect(
      parseMarkdown("tasks.md", toggleTask(parsed, parsed.tasks[2].id, false))
        .tasks[2].completedAt,
    ).toBeUndefined();
  });
  it("ignores checkboxes in code fences and keeps task source positions", () => {
    const raw =
      '---\nfable:\n  id: abc\n---\n# Note\n\n```md\n- [ ] example\n```\n\n## Work\n\n- [ ] Real <!-- fable:task {"id":"real"} -->\n';
    const doc = parseMarkdown("note.md", raw);
    expect(doc.tasks).toHaveLength(1);
    expect(doc.tasks[0].context).toBe("Work");
    expect(raw.slice(doc.tasks[0].checkFrom, doc.tasks[0].checkTo)).toBe(" ");
  });
  it("detects overlapping or invalid patches before application", () => {
    expect(() =>
      applyEdits("abcdef", [
        { from: 1, to: 4, insert: "" },
        { from: 3, to: 5, insert: "x" },
      ]),
    ).toThrow(/overlap/);
    expect(() =>
      applyEdits("abc", [{ from: 3, to: 4, insert: "x" }]),
    ).toThrow();
  });
  it("rejects parent cycles and duplicate identities, while allowing missing parents", () => {
    const doc = (id: string, parent?: string) =>
      parseMarkdown(
        `${id}.md`,
        patchMetadata(`# ${id}`, { schema: 1, id, kind: "goal", parent }),
      );
    expect(() => validateHierarchy([doc("a", "b"), doc("b", "a")])).toThrow(
      /ancestor/i,
    );
    expect(() => validateHierarchy([doc("a"), doc("a")])).toThrow(
      /identity|duplicate/i,
    );
    expect(() => validateHierarchy([doc("a", "missing")])).not.toThrow();
  });
});
