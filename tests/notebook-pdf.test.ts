import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  notebookExportPages,
  selectedExportPages,
} from "../apps/desktop/renderer/notebook-export.ts";

vi.mock("../apps/desktop/renderer/assets/pdf/Geist-Regular.ttf?url", () => ({
  default:
    "data:font/ttf;base64," +
    readFileSync(
      new URL(
        "../apps/desktop/renderer/assets/pdf/Geist-Regular.ttf",
        import.meta.url,
      ),
    ).toString("base64"),
}));
vi.mock("../apps/desktop/renderer/assets/pdf/Geist-SemiBold.ttf?url", () => ({
  default:
    "data:font/ttf;base64," +
    readFileSync(
      new URL(
        "../apps/desktop/renderer/assets/pdf/Geist-SemiBold.ttf",
        import.meta.url,
      ),
    ).toString("base64"),
}));
vi.mock("../apps/desktop/renderer/assets/pdf/Geist-Italic.ttf?url", () => ({
  default:
    "data:font/ttf;base64," +
    readFileSync(
      new URL(
        "../apps/desktop/renderer/assets/pdf/Geist-Italic.ttf",
        import.meta.url,
      ),
    ).toString("base64"),
}));
vi.mock(
  "../apps/desktop/renderer/assets/pdf/Geist-SemiBoldItalic.ttf?url",
  () => ({
    default:
      "data:font/ttf;base64," +
      readFileSync(
        new URL(
          "../apps/desktop/renderer/assets/pdf/Geist-SemiBoldItalic.ttf",
          import.meta.url,
        ),
      ).toString("base64"),
  }),
);

import { createNotebookPDF } from "../apps/desktop/renderer/NotebookPDF.tsx";

const pageCount = (bytes: Buffer) =>
  [...bytes.toString("latin1").matchAll(/\/Type \/Page\b/g)].length;

describe("notebook PDF generation", () => {
  it("exports the selected sheets including an intentionally blank page", async () => {
    const pages = notebookExportPages([
      "# Café résumé\n\n**Bold** and *italic* and ~~removed~~.\n\n- [x] Done\n- [ ] Next\n\n| Item | Value |\n| --- | --- |\n| Alpha | 12 |\n\n```js\nconst value = 12;\n```",
      "Omitted sheet",
      "# Third sheet\n\n[External link](https://example.com)",
      "",
    ]);
    const blob = await createNotebookPDF({
      title: "Test notebook",
      path: "test.md",
      pages: selectedExportPages(pages, new Set([4, 3, 1])),
    });
    const bytes = Buffer.from(await blob.arrayBuffer());
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    expect(blob.type).toBe("application/pdf");
    expect(pageCount(bytes)).toBe(3);
  });
  it("continues long text onto additional sheets", async () => {
    const blob = await createNotebookPDF({
      title: "Long page",
      path: "test.md",
      pages: notebookExportPages([
        "# Long page\n\n" +
          "A paragraph with enough words to wrap across a full sheet. ".repeat(
            300,
          ),
      ]),
    });
    expect(pageCount(Buffer.from(await blob.arrayBuffer()))).toBeGreaterThan(1);
  });
  it("rejects an empty selection", async () => {
    await expect(
      createNotebookPDF({ title: "Empty", path: "test.md", pages: [] }),
    ).rejects.toThrow("Pick at least one page");
  });
});
