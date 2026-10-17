import { describe, expect, it } from "vitest";
import {
  joinNotebook,
  splitNotebook,
  newNotebookPage,
  notebookMatches,
} from "../apps/desktop/renderer/notebook.ts";

describe("notebooks", () => {
  it.each([
    "",
    "Hello",
    "---\nid: one\n---\n\nHello\n",
    "First\n\n<!-- fable:page -->\n\nSecond",
    "First\r\n<!-- fable:page -->\r\nSecond",
    "First\n<!-- fable:page -->",
  ])("preserves every byte when reopening %j", (raw) => {
    expect(joinNotebook(splitNotebook(raw))).toBe(raw);
  });
  it("adds blank pages to the same document without changing existing content", () => {
    const original = "---\nid: one\n---\n\nFirst page";
    const combined = joinNotebook([
      ...splitNotebook(original),
      newNotebookPage(original),
    ]);
    expect(combined.startsWith(original)).toBe(true);
    expect(splitNotebook(combined)).toHaveLength(2);
  });
  it("does not interpret page markers inside frontmatter or fenced examples", () => {
    const raw =
      "---\nexample: |\n  <!-- fable:page -->\n---\n```html\n<!-- fable:page -->\n```\n~~~\n<!-- fable:page -->\n~~~\n<!-- fable:page -->\nReal second page";
    expect(splitNotebook(raw)).toHaveLength(2);
    expect(joinNotebook(splitNotebook(raw))).toBe(raw);
  });
  it("finds literal matches across pages, skipping hidden metadata", () => {
    const pages = splitNotebook(
      "---\ntitle: Hello\n---\nHello hello\n<!-- fable:page -->\nHello [x]",
    );
    expect(notebookMatches(pages, "hello").map((m) => m.page)).toEqual([
      0, 0, 1,
    ]);
    expect(notebookMatches(pages, "Hello", true)).toHaveLength(2);
    expect(notebookMatches(pages, "[x]")).toHaveLength(1);
    expect(notebookMatches(pages, "")).toEqual([]);
  });
  it("uses editor offsets for Windows line endings", () => {
    const pages = splitNotebook("---\r\ntitle: Apple\r\n---\r\nApple\r\napple");
    const normalized = pages[0].raw.replace(/\r\n/g, "\n");
    for (const match of notebookMatches(pages, "apple"))
      expect(normalized.slice(match.from, match.to).toLowerCase()).toBe(
        "apple",
      );
  });
  it("leaves indented page marker examples on the same page", () => {
    expect(
      splitNotebook("Example:\n\n    <!-- fable:page -->\n\nStill here"),
    ).toHaveLength(1);
  });
  it("keeps pages separate when their trailing newlines are replaced", () => {
    const pages = splitNotebook(
      "First\n<!-- fable:page -->\nSecond\n<!-- fable:page -->\nThird",
    );
    pages[0].raw = "Rewritten first";
    pages[1].raw = "Rewritten second";
    const reopened = splitNotebook(joinNotebook(pages));
    expect(reopened).toHaveLength(3);
    expect(reopened[2].raw).toBe("Third");
  });
});
