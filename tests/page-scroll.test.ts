import { describe, expect, it } from "vitest";
import {
  advancePageScroll,
  emptyPageScroll,
  PAGE_SCROLL_DISTANCE,
  PAGE_SCROLL_IDLE,
  releasePageScroll,
} from "../apps/desktop/renderer/page-scroll.ts";

describe("scroll to add notebook pages", () => {
  it("waits until the notebook reaches its end", () => {
    const result = advancePageScroll(emptyPageScroll, 800, false, 100);
    expect(result.progress).toBe(0);
    expect(result.add).toBe(false);
  });
  it("shows partial progress and adds one page at the threshold", () => {
    const first = advancePageScroll(emptyPageScroll, 120, true, 100);
    expect(first.progress).toBeCloseTo(1 / 3);
    expect(first.add).toBe(false);
    const second = advancePageScroll(first.state, 120, true, 200);
    expect(second.progress).toBeCloseTo(2 / 3);
    expect(advancePageScroll(second.state, 120, true, 300).add).toBe(true);
  });
  it("cancels progress when scrolling up or leaving the bottom", () => {
    const partial = advancePageScroll(emptyPageScroll, 200, true, 100);
    expect(advancePageScroll(partial.state, -10, true, 200).progress).toBe(0);
    expect(advancePageScroll(partial.state, 10, false, 200).progress).toBe(0);
  });
  it("starts over after a pause", () => {
    const partial = advancePageScroll(emptyPageScroll, 300, true, 100);
    const result = advancePageScroll(
      partial.state,
      120,
      true,
      101 + PAGE_SCROLL_IDLE,
    );
    expect(result.add).toBe(false);
    expect(result.progress).toBeCloseTo(1 / 3);
  });
  it("clears unfinished progress and rebounds when scrolling stops", () => {
    const partial = advancePageScroll(emptyPageScroll, 180, true, 100);
    const released = releasePageScroll(partial.state, 100 + PAGE_SCROLL_IDLE);
    expect(released.state.distance).toBe(0);
    expect(released.rebound).toBe(48);
    expect(advancePageScroll(released.state, 90, true, 400).progress).toBe(
      0.25,
    );
  });
  it("does not rebound or create a page after a completed gesture", () => {
    const added = advancePageScroll(
      emptyPageScroll,
      PAGE_SCROLL_DISTANCE,
      true,
      100,
    );
    const released = releasePageScroll(added.state, 100 + PAGE_SCROLL_IDLE);
    expect(released.rebound).toBe(0);
    expect(released.state.cooldownUntil).toBe(added.state.cooldownUntil);
    expect(advancePageScroll(released.state, 120, true, 500).add).toBe(false);
  });
  it("ignores trailing momentum after creating a sheet", () => {
    const added = advancePageScroll(
      emptyPageScroll,
      PAGE_SCROLL_DISTANCE,
      true,
      100,
    );
    const momentum = advancePageScroll(added.state, 1200, true, 200);
    expect(momentum.add).toBe(false);
    expect(momentum.progress).toBe(0);
    expect(
      advancePageScroll(momentum.state, PAGE_SCROLL_DISTANCE, true, 1100).add,
    ).toBe(true);
  });
});
