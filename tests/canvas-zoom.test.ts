import { describe, expect, it } from "vitest";
import {
  clampZoom,
  captureCanvasAnchor,
  restoreCanvasAnchor,
} from "../apps/desktop/renderer/canvas-zoom.ts";

describe("playground zoom", () => {
  it("keeps zoom between 25% and 200%", () => {
    expect(clampZoom(10)).toBe(25);
    expect(clampZoom(250)).toBe(200);
    expect(clampZoom(125)).toBe(125);
    expect(clampZoom(Number.NaN)).toBe(100);
  });
  it("keeps the viewport center over the same page point", () => {
    const viewport = { left: 0, top: 0 };
    const anchor = captureCanvasAnchor(
      viewport,
      { left: 144, top: 96 },
      { x: 504, y: 380 },
      1,
    );
    expect(anchor.page).toEqual({ x: 360, y: 284 });
    expect(
      restoreCanvasAnchor(
        anchor,
        viewport,
        { left: 54, top: 96 },
        { left: 256, top: 0 },
        1.25,
      ),
    ).toEqual({ left: 256, top: 71 });
  });
  it.each([0.25, 0.75, 1.5, 2])(
    "keeps the point under the pointer fixed when zooming to %s",
    (scale) => {
      const viewport = { left: 272, top: 40 };
      const point = { x: 520, y: 260 };
      const anchor = captureCanvasAnchor(
        viewport,
        { left: 304, top: 136 },
        point,
        1,
      );
      const scroll = { left: 350, top: 180 };
      const nextPaper = { left: 200, top: 110 };
      const nextScroll = restoreCanvasAnchor(
        anchor,
        viewport,
        nextPaper,
        scroll,
        scale,
      );
      expect(
        nextPaper.left -
          (nextScroll.left - scroll.left) +
          anchor.page.x * scale,
      ).toBeCloseTo(point.x);
      expect(
        nextPaper.top - (nextScroll.top - scroll.top) + anchor.page.y * scale,
      ).toBeCloseTo(point.y);
    },
  );
});
