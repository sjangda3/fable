import { describe, expect, it } from "vitest";
import { snapshotDisposition } from "../apps/desktop/renderer/editor-sync.ts";

const first = {
  raw: "First draft",
  revision: "r1",
  modifiedAt: "2026-10-17T16:00:00.000Z",
};
const saved = {
  raw: "New draft",
  revision: "r2",
  modifiedAt: "2026-10-17T16:00:01.000Z",
};

describe("editor save event ordering", () => {
  it("does not restore an older file event after a successful save", () => {
    expect(
      snapshotDisposition(saved, first, undefined, new Set([first.revision])),
    ).toBe("ignore");
  });
  it("acknowledges the in-flight draft when its file event arrives before the response", () => {
    expect(snapshotDisposition(first, saved, saved.raw)).toBe("acknowledge");
  });
  it("accepts an external revert even if that content appeared in an earlier revision", () => {
    expect(
      snapshotDisposition(saved, {
        ...first,
        modifiedAt: "2026-10-17T16:00:02.000Z",
      }),
    ).toBe("external");
  });
  it("does not mistake an unrelated external change for a pending save", () => {
    expect(
      snapshotDisposition(
        first,
        { ...saved, raw: "Edited in another app" },
        saved.raw,
      ),
    ).toBe("external");
  });
  it("accepts a previously unseen external file even if its timestamp is older", () => {
    expect(
      snapshotDisposition(
        saved,
        { ...first, revision: "external", raw: "Copied from another folder" },
        undefined,
        new Set([first.revision]),
      ),
    ).toBe("external");
  });
});
