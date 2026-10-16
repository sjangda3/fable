import {
  EditorSelection,
  type EditorState,
  type TransactionSpec,
} from "@codemirror/state";
import { undoDepth, redoDepth } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { frontmatterBoundary } from "./editor-state.ts";

export type EditorCommand =
  | "undo"
  | "redo"
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "link"
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bulletList"
  | "numberedList"
  | "taskList"
  | "quote"
  | "codeBlock"
  | "indent"
  | "outdent"
  | "search";

export interface EditorFormatting {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
  block: string;
  canUndo: boolean;
  canRedo: boolean;
}
export const emptyFormatting: EditorFormatting = {
  bold: false,
  italic: false,
  strike: false,
  code: false,
  block: "paragraph",
  canUndo: false,
  canRedo: false,
};

export function editorFormatting(state: EditorState): EditorFormatting {
  const selection = state.selection.main;
  const line = state.doc.lineAt(selection.head).text;
  const heading = /^(#{1,3})\s/.exec(line);
  const names: string[] = [];
  for (
    let node = syntaxTree(state).resolveInner(
      Math.min(selection.from + 1, state.doc.length),
      1,
    );
    node;
    node = node.parent!
  )
    names.push(node.name);
  return {
    bold: names.includes("StrongEmphasis"),
    italic: names.includes("Emphasis"),
    strike: names.includes("Strikethrough"),
    code: names.includes("InlineCode"),
    block: heading ? `heading${heading[1].length}` : "paragraph",
    canUndo: undoDepth(state) > 0,
    canRedo: redoDepth(state) > 0,
  };
}

/** Formatting changes only visible Markdown; frontmatter is never part of a command. */
export function formattingTransaction(
  state: EditorState,
  command: EditorCommand,
): TransactionSpec | undefined {
  const boundary = frontmatterBoundary(state.doc.toString());
  const range = state.selection.main;
  const from = Math.max(boundary, range.from),
    to = Math.max(from, range.to);
  const selected = state.sliceDoc(from, to);
  const mark = (
    { bold: "**", italic: "*", strike: "~~", code: "`" } as Record<
      string,
      string
    >
  )[command];
  if (mark) {
    const before = state.sliceDoc(Math.max(boundary, from - mark.length), from);
    const after = state.sliceDoc(to, to + mark.length);
    if (before === mark && after === mark) {
      return {
        changes: [
          { from: from - mark.length, to: from, insert: "" },
          { from: to, to: to + mark.length, insert: "" },
        ],
        selection: EditorSelection.range(from - mark.length, to - mark.length),
        userEvent: "input.format",
      };
    }
    if (
      selected.length > mark.length * 2 &&
      selected.startsWith(mark) &&
      selected.endsWith(mark)
    ) {
      return {
        changes: {
          from,
          to,
          insert: selected.slice(mark.length, -mark.length),
        },
        selection: EditorSelection.range(from, to - mark.length * 2),
        userEvent: "input.format",
      };
    }
    const text =
      selected ||
      (
        {
          bold: "bold text",
          italic: "italic text",
          strike: "text",
          code: "code",
        } as Record<string, string>
      )[command];
    return {
      changes: { from, to, insert: `${mark}${text}${mark}` },
      selection: EditorSelection.range(
        from + mark.length,
        from + mark.length + text.length,
      ),
      userEvent: "input.format",
    };
  }
  if (command === "link") {
    const label = selected || "Link text";
    const insert = `[${label}](https://)`;
    return {
      changes: { from, to, insert },
      selection: EditorSelection.range(
        from + label.length + 3,
        from + insert.length - 1,
      ),
      userEvent: "input.format",
    };
  }
  if (command === "codeBlock") {
    const insert = `\n\n\`\`\`\n${selected || "Your code here"}\n\`\`\`\n`;
    return {
      changes: { from, to, insert },
      selection: EditorSelection.range(
        from + 6,
        from + 6 + (selected || "Your code here").length,
      ),
      userEvent: "input.format",
    };
  }
  if (
    [
      "paragraph",
      "heading1",
      "heading2",
      "heading3",
      "bulletList",
      "numberedList",
      "taskList",
      "quote",
    ].includes(command)
  ) {
    const first = state.doc.lineAt(from),
      last = state.doc.lineAt(
        to > from && state.doc.lineAt(to).from === to ? to - 1 : to,
      );
    const lines = Array.from(
      { length: last.number - first.number + 1 },
      (_, i) => state.doc.line(first.number + i),
    );
    const prefix = (i: number) =>
      command.startsWith("heading")
        ? `${"#".repeat(Number(command.at(-1)))} `
        : (
            {
              paragraph: "",
              bulletList: "- ",
              numberedList: `${i + 1}. `,
              taskList: "- [ ] ",
              quote: "> ",
            } as Record<string, string>
          )[command];
    const existing = /^(?:#{1,6}\s+|>\s?|[-+*]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)/;
    const toggled =
      command !== "paragraph" &&
      lines.every((line, i) =>
        command === "bulletList"
          ? /^[-+*]\s+(?!\[[ xX]\])/.test(line.text)
          : command === "taskList"
            ? /^[-+*]\s+\[[ xX]\]/.test(line.text)
            : command === "numberedList"
              ? /^\d+[.)]\s+/.test(line.text)
              : line.text.startsWith(prefix(i)),
      );
    const changes = state.changes(
      lines.map((line, i) => ({
        from: Math.max(boundary, line.from),
        to: line.from + (existing.exec(line.text)?.[0].length ?? 0),
        insert: toggled ? "" : prefix(i),
      })),
    );
    return {
      changes,
      selection: EditorSelection.range(
        changes.mapPos(from, 1),
        changes.mapPos(to, 1),
      ),
      userEvent: "input.format",
    };
  }
}

export function blockInsertion(
  state: EditorState,
  text: string,
  at?: number,
): TransactionSpec {
  const boundary = frontmatterBoundary(state.doc.toString());
  let position = Math.max(
    boundary,
    Math.min(state.doc.length, at ?? state.selection.main.to),
  );
  // Insert alongside compound blocks rather than breaking their Markdown structure.
  for (
    let node = syntaxTree(state).resolveInner(position, 1);
    node;
    node = node.parent!
  )
    if (["Table", "FencedCode", "CodeBlock"].includes(node.name))
      position = node.to;
  const line = state.doc.lineAt(position);
  const from = Math.max(boundary, line.to);
  const lead = state.sliceDoc(boundary, from).trim() ? "\n\n" : "";
  const following = state.sliceDoc(from, Math.min(state.doc.length, from + 2));
  const trailing = following.startsWith("\n\n") ? "" : "\n";
  return {
    changes: { from, insert: `${lead}${text}${trailing}` },
    selection: { anchor: from + lead.length + text.length + 1 },
    scrollIntoView: true,
    userEvent: "input.paste",
  };
}

export const markdownTable = (rows: number, columns: number) => {
  const row = (header = false) =>
    `| ${Array.from({ length: columns }, (_, i) => (header ? `Column ${i + 1}` : " ")).join(" | ")} |`;
  return [
    row(true),
    `| ${Array(columns).fill("---").join(" | ")} |`,
    ...Array.from({ length: rows }, () => row()),
  ].join("\n");
};
