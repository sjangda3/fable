import { frontmatterBoundary } from "./editor-state.ts";

export interface NotebookExportPage {
  number: number;
  raw: string;
}

export function notebookExportPages(pages: string[]): NotebookExportPage[] {
  return pages.map((raw, index) => ({
    number: index + 1,
    raw: index === 0 ? raw.slice(frontmatterBoundary(raw)) : raw,
  }));
}

export function selectedExportPages(
  pages: NotebookExportPage[],
  selected: ReadonlySet<number>,
) {
  return pages.filter((page) => selected.has(page.number));
}

export function pdfFilename(title: string) {
  let name = title
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  name = name
    .replace(/\.pdf$/i, "")
    .slice(0, 120)
    .replace(/[. ]+$/, "");
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(name))
    name = `Notebook ${name}`;
  return `${name || "Notebook"}.pdf`;
}
