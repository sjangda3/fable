import { frontmatterBoundary } from "./editor-state.ts";
import { Text } from "@codemirror/state";
import { SearchQuery } from "@codemirror/search";

export interface NotebookPage {
  raw: string;
  before: string;
}

/** Page boundaries stay readable in Markdown and never split fenced code. */
export function splitNotebook(raw: string): NotebookPage[] {
  const pages: NotebookPage[] = [];
  const boundary = frontmatterBoundary(raw);
  let start = 0,
    before = "",
    fence: string | undefined;
  for (const line of raw.matchAll(/[^\n]*\n|[^\n]+$/g)) {
    if (line.index! < boundary) continue;
    const text = line[0].trimEnd();
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (
        marker[1][0] === fence[0] &&
        marker[1].length >= fence.length &&
        !marker[2].trim()
      )
        fence = undefined;
    }
    if (!fence && /^ {0,3}<!-- fable:page -->$/.test(text)) {
      pages.push({ raw: raw.slice(start, line.index), before });
      before = line[0];
      start = line.index! + line[0].length;
    }
  }
  pages.push({ raw: raw.slice(start), before });
  return pages;
}

/** Keep a boundary on its own line even after select-all replaces a page. */
export function ensureNotebookBoundaries<T extends NotebookPage>(
  pages: T[],
): T[] {
  let previous = "";
  return pages.map((page, index) => {
    const eol = page.before.includes("\r\n") ? "\r\n" : "\n";
    const before =
      index > 0 &&
      previous &&
      !previous.endsWith("\n") &&
      !/^\r?\n/.test(page.before)
        ? eol + page.before
        : page.before;
    previous += before + page.raw;
    return before === page.before ? page : { ...page, before };
  });
}
export const joinNotebook = (pages: NotebookPage[]) =>
  ensureNotebookBoundaries(pages)
    .map((page) => page.before + page.raw)
    .join("");

export function newNotebookPage(raw: string): NotebookPage {
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  return {
    raw: "",
    before: `${raw.endsWith("\n") ? "" : eol}${eol}<!-- fable:page -->${eol}${eol}`,
  };
}

export interface NotebookMatch {
  page: number;
  from: number;
  to: number;
}
export function notebookMatches(
  pages: NotebookPage[],
  query: string,
  caseSensitive = false,
): NotebookMatch[] {
  if (!query) return [];
  const search = new SearchQuery({
    search: query,
    caseSensitive,
    literal: true,
  });
  return pages.flatMap((page, index) => {
    const raw = page.raw.replace(/\r\n/g, "\n");
    const cursor = search.getCursor(
      Text.of(raw.split("\n")),
      index === 0 ? frontmatterBoundary(raw) : 0,
    );
    const matches: NotebookMatch[] = [];
    for (let result = cursor.next(); !result.done; result = cursor.next())
      matches.push({ page: index, ...result.value });
    return matches;
  });
}
