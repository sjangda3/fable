import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import {
  resolveVaultLink,
  relativeVaultHref,
} from "../apps/desktop/renderer/links.ts";
import {
  protectFrontmatter,
  initialEditorPosition,
  frontmatterBoundary,
} from "../apps/desktop/renderer/editor-state.ts";
describe("editor file boundaries", () => {
  it("creates valid attachment links for root and deeply nested notes", () => {
    for (const source of ["Root.md", "Notes/A.md", "Notes/Deep/Nested.md"]) {
      const target = "Attachments/Café (1)#.png",
        href = relativeVaultHref(source, target);
      expect(resolveVaultLink(source, href)).toBe(target);
      expect(href).not.toContain("(");
    }
  });
  it("keeps keyboard selection out of hidden properties in live preview", () => {
    const header = "---\nfable:\n  id: stable\n---\n";
    const state = EditorState.create({
      doc: header + "Body",
      extensions: [protectFrontmatter],
    });
    const selected = state.update({
      selection: { anchor: 0, head: state.doc.length },
    }).state;
    expect(selected.selection.main.from).toBe(header.length);
  });
  it("keeps hidden metadata when replacing all visible text", () => {
    const header = "---\nfable:\n  id: stable\n---\n",
      raw = header + "# Old text\n";
    let state = EditorState.create({
      doc: raw,
      extensions: [protectFrontmatter],
    });
    state = state.update({
      changes: { from: 0, to: state.doc.length, insert: "New body" },
    }).state;
    expect(state.doc.toString()).toBe(header + "New body");
    expect(state.selection.main.head).toBe(state.doc.length);
    state = state.update({
      changes: { from: 0, to: state.doc.length, insert: "" },
    }).state;
    expect(state.doc.toString()).toBe(header);
    state = state.update({
      changes: { from: state.doc.length, insert: "Next" },
    }).state;
    expect(state.doc.toString()).toBe(header + "Next");
  });
  it("retains CRLF while editing through CodeMirror", () => {
    const raw = "# Title\r\n\r\nText\r\n";
    let state = EditorState.create({
      doc: raw,
      extensions: [EditorState.lineSeparator.of("\r\n")],
    });
    state = state.update({
      changes: { from: state.doc.length, to: state.doc.length, insert: "More" },
    }).state;
    expect(state.sliceDoc()).toBe(raw + "More");
  });
  it("resolves ordinary relative note and attachment links inside the vault", () => {
    expect(
      resolveVaultLink("Projects/Work.md", "../Notes/Caf%C3%A9.md#section"),
    ).toBe("Notes/Café.md");
    expect(resolveVaultLink("Notes/A.md", "../../private.md")).toBeUndefined();
    expect(resolveVaultLink("A.md", "https://example.com")).toBeUndefined();
  });
  it("starts formatting on the first visible content line", () => {
    const raw = "---\nfable:\n  id: stable\n---\n\n\n# Title";
    expect(initialEditorPosition(raw)).toBe(raw.indexOf("# Title"));
  });
  it("finds the visible body in CRLF files and normalizes the initial cursor offset", () => {
    const raw = "---\r\nfable:\r\n  id: stable\r\n---\r\n\r\nBody";
    expect(raw.slice(frontmatterBoundary(raw))).toBe("\r\nBody");
    expect(initialEditorPosition(raw)).toBe(
      raw.replaceAll("\r\n", "\n").indexOf("Body"),
    );
  });
});
