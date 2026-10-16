import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", { platform: "MacIntel" });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

it("explains a stopped local service, does not replay folder creation, and allows a later retry", async () => {
  const state = { documents: [], directories: ["Projects/Book/Research"] },
    fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(Response.json({ result: state }));
  vi.stubGlobal("fetch", fetch);
  const { api } = await import("../apps/desktop/renderer/api.ts"),
    args = { parentId: "project", name: "Research" };

  await expect(api.request("folders.create", args)).rejects.toMatchObject({
    code: "FILESYSTEM",
    message: expect.stringContaining("Cannot reach Fable’s local file service"),
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  await expect(api.request("folders.create", args)).resolves.toEqual(state);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
    operation: "folders.create",
    args,
  });
});

it("preserves folder validation errors from a reachable service", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json(
          {
            error: "A file or folder with that name already exists.",
            code: "CONFLICT",
          },
          { status: 400 },
        ),
      ),
  );
  const { api } = await import("../apps/desktop/renderer/api.ts");
  await expect(
    api.request("folders.create", { parentId: "project", name: "Research" }),
  ).rejects.toMatchObject({
    code: "CONFLICT",
    message: "A file or folder with that name already exists.",
  });
});
