import { describe, expect, it } from "vitest";
import {
  notebookExportPages,
  pdfFilename,
  selectedExportPages,
} from "../apps/desktop/renderer/notebook-export.ts";

describe("notebook PDF selection", () => {
  it("keeps notebook order even when pages are selected in a different order", () => {
    const pages = notebookExportPages(["First", "Second", "Third"]);
    expect(
      selectedExportPages(pages, new Set([3, 1])).map((page) => page.raw),
    ).toEqual(["First", "Third"]);
  });
  it("strips file metadata without dropping an empty page or a Markdown divider", () => {
    const pages = notebookExportPages([
      "---\nid: private-id\ntitle: Notebook\n---\n\n# Hello",
      "",
      "---\nA divider",
    ]);
    expect(pages).toEqual([
      { number: 1, raw: "\n# Hello" },
      { number: 2, raw: "" },
      { number: 3, raw: "---\nA divider" },
    ]);
  });
  it("supports selecting no pages and does not mutate the original content", () => {
    const input = ["First\r\n", "Second\n"];
    const pages = notebookExportPages(input);
    expect(selectedExportPages(pages, new Set())).toEqual([]);
    expect(input).toEqual(["First\r\n", "Second\n"]);
  });
  it.each([
    ["Project brief", "Project brief.pdf"],
    ["Résumé / notes: 2026?", "Résumé notes 2026.pdf"],
    ["Notebook.pdf", "Notebook.pdf"],
    ["../..", "Notebook.pdf"],
    ["CON", "Notebook CON.pdf"],
    ["  ", "Notebook.pdf"],
  ])("makes a usable filename for %j", (title, expected) => {
    expect(pdfFilename(title)).toBe(expected);
  });
});
