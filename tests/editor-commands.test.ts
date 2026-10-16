import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  blockInsertion,
  editorFormatting,
  formattingTransaction,
  markdownTable,
  type EditorCommand,
} from "../apps/desktop/renderer/editor-commands.ts";
import { protectFrontmatter } from "../apps/desktop/renderer/editor-state.ts";

const header = "---\nfable:\n  id: stable\n  kind: note\n---\n";
const make = (body: string, from = 0, to = from) =>
  EditorState.create({
    doc: header + body,
    selection: { anchor: header.length + from, head: header.length + to },
    extensions: [protectFrontmatter, markdown({ base: markdownLanguage })],
  });
const apply = (state: EditorState, command: EditorCommand) =>
  state.update(formattingTransaction(state, command)!).state;

describe("document toolbar commands", () => {
  it.each([
    ["bold", "**"],
    ["italic", "*"],
    ["strike", "~~"],
    ["code", "`"],
  ] as const)(
    "toggles %s without losing selected text or metadata",
    (command, mark) => {
      const state = make("A quiet place to think", 2, 13),
        formatted = apply(state, command);
      expect(formatted.doc.toString()).toBe(
        header + `A ${mark}quiet place${mark} to think`,
      );
      expect(
        formatted.sliceDoc(
          formatted.selection.main.from,
          formatted.selection.main.to,
        ),
      ).toBe("quiet place");
      expect(editorFormatting(formatted)[command]).toBe(true);
      expect(apply(formatted, command).doc.toString()).toBe(
        state.doc.toString(),
      );
    },
  );
  it("converts all selected lines and excludes the next unselected line", () => {
    const state = make("First\nSecond\nThird", 0, 13);
    const result = apply(state, "numberedList");
    expect(result.doc.toString()).toBe(header + "1. First\n2. Second\nThird");
    expect(apply(result, "numberedList").doc.toString()).toBe(
      state.doc.toString(),
    );
  });
  it("changes heading level and returns to normal text without stacking markers", () => {
    let state = make("# Title", 3);
    state = apply(state, "heading2");
    expect(state.doc.toString()).toBe(header + "## Title");
    expect(editorFormatting(state).block).toBe("heading2");
    expect(apply(state, "paragraph").doc.toString()).toBe(header + "Title");
  });
  it("preserves task text when converting list types", () => {
    const state = make("- [x] First\n- [ ] Second", 0, 23);
    expect(apply(state, "bulletList").doc.toString()).toBe(
      header + "- First\n- Second",
    );
  });
  it("selects the URL for a new link", () => {
    const state = apply(make("Open the brief", 9, 14), "link");
    expect(state.doc.toString()).toBe(header + "Open the [brief](https://)");
    expect(
      state.sliceDoc(state.selection.main.from, state.selection.main.to),
    ).toBe("https://");
  });
  it("inserts blocks after the current line and keeps existing content", () => {
    const state = make("# Title\n\nExisting paragraph", 4);
    expect(
      state
        .update(blockInsertion(state, "- [ ] New task"))
        .state.doc.toString(),
    ).toBe(header + "# Title\n\n- [ ] New task\n\nExisting paragraph");
  });
  it("inserts into an empty body without changing frontmatter", () => {
    const state = make("");
    expect(
      state.update(blockInsertion(state, "Text")).state.doc.toString(),
    ).toBe(header + "Text\n");
  });
  it("creates a GFM table with the chosen dimensions", () => {
    const table = markdownTable(3, 4);
    expect(table.split("\n")).toHaveLength(5);
    expect(
      table.split("\n").every((line) => line.split("|").length === 6),
    ).toBe(true);
  });
  it("keeps a table intact when inserting from one of its cells", () => {
    const table = markdownTable(2, 3);
    const state = make(table + "\n\nFollowing paragraph", 5);
    const result = state.update(blockInsertion(state, "> A quote")).state;
    expect(result.doc.toString()).toBe(
      header + table + "\n\n> A quote\n\nFollowing paragraph",
    );
  });
});
