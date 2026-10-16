import { it, expect, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AppService } from "../apps/desktop/main/service.ts";

it("opens local work without waiting for an unreachable sync server", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "fable-offline-start-"));
  const app = new AppService(
    path.join(root, "app"),
    { get: async () => undefined, set: async () => {} },
    undefined,
    path.join(root, "vault"),
  );
  const restore = vi
    .spyOn(app.sync, "restore")
    .mockReturnValue(new Promise(() => {}));
  try {
    await app.initialize();
    expect(restore).toHaveBeenCalledOnce();
    expect(
      (await app.request("vault.state", undefined))?.documents.length,
    ).toBeGreaterThan(0);
    const note = await app.request("documents.create", {
      title: "Offline work",
      kind: "note",
    });
    expect(await fs.readFile(path.join(root, "vault", note.path), "utf8")).toBe(
      note.raw,
    );
  } finally {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
