import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { VaultService } from "../packages/vault/index.ts";
import {
  createVaultKey,
  encryptPayload,
  decryptPayload,
} from "../packages/sync/crypto.ts";
import {
  SyncEngine,
  mergeText,
  type RemoteRevision,
  type RemoteStore,
} from "../packages/sync/index.ts";

class MemoryRemote implements RemoteStore {
  revisions: RemoteRevision[] = [];
  heads = new Map<string, string>();
  fail = false;
  async push(r: RemoteRevision, expected: string | null) {
    if (this.fail) throw new Error("Network offline");
    if (this.revisions.some((v) => v.revisionId === r.revisionId)) return;
    if ((this.heads.get(r.objectId) ?? null) !== expected)
      throw new Error("Head mismatch");
    this.revisions.push({ ...r, sequence: this.revisions.length + 1 });
    this.heads.set(r.objectId, r.revisionId);
  }
  async pull(after: number) {
    if (this.fail) throw new Error("Network offline");
    return {
      revisions: this.revisions
        .filter((r) => r.sequence! > after)
        .slice(0, 100),
      cursor: Math.min(after + 100, this.revisions.length),
    };
  }
  async acknowledge(_cursor: number) {}
}
const secrets = {
  async get(_k: string) {
    return undefined;
  },
  async set(_k: string, _v: string | undefined) {},
};
let directory: string,
  a: VaultService,
  b: VaultService,
  sa: SyncEngine,
  sb: SyncEngine,
  remote: MemoryRemote;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "fable-sync-"));
  a = new VaultService(path.join(directory, "ca"));
  b = new VaultService(path.join(directory, "cb"));
  await a.open(path.join(directory, "a"), false);
  await b.open(path.join(directory, "b"), false);
  sa = new SyncEngine(a, secrets);
  sb = new SyncEngine(b, secrets);
  remote = new MemoryRemote();
  const key = await createVaultKey(),
    id = randomUUID();
  await sa.attach(remote, key, id);
  await sb.attach(remote, key, id);
});
afterEach(async () => {
  await sa.close();
  await sb.close();
  await a.close();
  await b.close();
  await fs.rm(directory, { recursive: true, force: true });
});
describe("encrypted revision sync between independent clients", () => {
  it("does not mistake an interrupted attachment scan for deleted files", async () => {
    await fs.mkdir(path.join(a.root, "Images"));
    await fs.writeFile(path.join(a.root, "Images/a.png"), Buffer.from([1]));
    await fs.writeFile(path.join(a.root, "Images/b.png"), Buffer.from([2]));
    await sa.run();
    await sb.run();
    const count = remote.revisions.length;
    const stat = fs.stat.bind(fs),
      interrupted = vi.spyOn(fs, "stat").mockImplementation(((
        file: any,
        ...options: any[]
      ) => {
        if (String(file) === path.join(a.root, "Images/a.png"))
          return Promise.reject(
            Object.assign(new Error("File changed during scan"), {
              code: "ENOENT",
            }),
          );
        return (stat as any)(file, ...options);
      }) as typeof fs.stat);
    try {
      expect((await sa.run()).state).toBe("error");
      expect(remote.revisions).toHaveLength(count);
    } finally {
      interrupted.mockRestore();
    }
    expect((await sa.run()).state).toBe("ready");
    await sb.run();
    expect(await fs.readFile(path.join(b.root, "Images/b.png"))).toEqual(
      Buffer.from([2]),
    );
  });
  it("checkpoints each downloaded file so an interrupted batch resumes without reloading accepted payloads", async () => {
    const first = await a.create("First download", "note"),
      second = await a.create("Second download", "note");
    await sa.run();
    const key = (sa as any).key,
      vaultId = (sa as any).checkpoint.vaultId;
    await sb.close();
    const loaded: string[] = [];
    let interrupt = true;
    const lazy: RemoteStore = {
      push: (r, head) => remote.push(r, head),
      acknowledge: (cursor) => remote.acknowledge(cursor),
      pull: async (after) => {
        const batch = await remote.pull(after);
        return {
          ...batch,
          revisions: batch.revisions.map(({ payload, ...identity }) => ({
            ...identity,
            loadPayload: async () => {
              loaded.push(identity.revisionId);
              if (identity.sequence === 2 && interrupt) {
                interrupt = false;
                throw new Error("Network offline during download");
              }
              return payload;
            },
          })),
        };
      },
    };
    await sb.attach(lazy, key, vaultId);
    expect((await sb.run()).state).toBe("offline");
    expect(await fs.readFile(path.join(b.root, first.path), "utf8")).toBe(
      first.raw,
    );
    expect((sb as any).checkpoint.cursor).toBe(1);
    expect((await sb.run()).state).toBe("ready");
    expect(b.document(second.id).raw).toBe(second.raw);
    expect(
      loaded.filter((id) => id === remote.revisions[0].revisionId),
    ).toHaveLength(1);
  });
  it("refuses duplicate document identities instead of dropping a copied file from sync", async () => {
    const doc = await a.create("Original", "note");
    await fs.writeFile(path.join(a.root, "Notes", "Copy.md"), doc.raw);
    await a.scan();
    expect((await sa.run()).state).toBe("error");
    expect(remote.revisions).toHaveLength(0);
    expect(
      await fs.readFile(path.join(a.root, "Notes", "Copy.md"), "utf8"),
    ).toBe(doc.raw);
  });
  it("uses independent opaque server identities for the same Markdown in separately keyed vaults", async () => {
    const doc = await a.create("Private filename", "note");
    await sa.run();
    await sb.close();
    await fs.mkdir(path.join(b.root, "Notes"), { recursive: true });
    await fs.writeFile(path.join(b.root, doc.path), doc.raw);
    await b.scan();
    const other = new MemoryRemote();
    await sb.attach(other, await createVaultKey(), randomUUID());
    await sb.run();
    expect(remote.revisions[0].objectId).not.toBe(doc.id);
    expect(remote.revisions[0].objectId).not.toBe(other.revisions[0].objectId);
    expect(JSON.stringify(remote.revisions)).not.toContain(doc.id);
    expect(JSON.stringify(remote.revisions)).not.toContain("Private filename");
  });
  it("does not carry a previous vault connection into another folder", async () => {
    const doc = await a.create("Private A", "note");
    await sa.run();
    const count = remote.revisions.length;
    await sa.close();
    await a.open(path.join(directory, "other-vault"), false);
    await a.create("Private B", "note");
    expect((await sa.run()).state).toBe("local");
    expect(remote.revisions.length).toBe(count);
  });
  it("synchronizes portable Markdown preferences and assets outside the default directory", async () => {
    const d = await a.create("Bookmark", "note");
    const sidebarOrder = {
      '["projects","area",""]': ["project-b", "project-a"],
    };
    await a.saveViews({
      ...(await a.views()),
      bookmarks: [d.id],
      sidebarOrder,
    });
    await fs.mkdir(path.join(a.root, "My images"));
    await fs.writeFile(
      path.join(a.root, "My images", "tiny.png"),
      Buffer.from([1, 2, 3]),
    );
    await sa.run();
    await sb.run();
    expect((await b.views()).bookmarks).toEqual([d.id]);
    expect((await b.views()).sidebarOrder).toEqual(sidebarOrder);
    expect(await fs.readFile(path.join(b.root, "My images/tiny.png"))).toEqual(
      Buffer.from([1, 2, 3]),
    );
  });
  it("preserves both files when a remote rename collides with a local filename", async () => {
    const d = await a.create("Original", "note");
    await sa.run();
    await sb.run();
    const occupied = await b.create("Occupied", "note");
    await a.rename(d.id, d.revision, occupied.path);
    await sa.run();
    expect((await sb.run()).state).toBe("conflict");
    expect(b.document(occupied.id).raw).toBe(occupied.raw);
    expect(b.document(d.id).path).toBe(d.path);
    expect(b.documents.some((d) => d.path.startsWith("Conflicts/"))).toBe(true);
  });
  it("authenticates ciphertext and identity, with fresh nonces", async () => {
    const key = await createVaultKey(),
      one = await encryptPayload(key, { secret: "private note" }, "identity"),
      two = await encryptPayload(key, { secret: "private note" }, "identity");
    expect(one).not.toEqual(two);
    expect(JSON.stringify(one)).not.toContain("private note");
    expect(await decryptPayload(key, one, "identity")).toEqual({
      secret: "private note",
    });
    await expect(decryptPayload(key, one, "other identity")).rejects.toThrow();
    await expect(
      decryptPayload(await createVaultKey(), one, "identity"),
    ).rejects.toThrow();
  });
  it("merges non-overlapping edits and identifies overlapping edits", () => {
    expect(mergeText("a\nb\nc\n", "A\nb\nc\n", "a\nb\nC\n")).toEqual({
      text: "A\nb\nC\n",
      conflict: false,
    });
    expect(mergeText("one\n", "mine\n", "theirs\n").conflict).toBe(true);
  });
  it("converges after concurrent non-overlapping edits and rename", async () => {
    const d = await a.create(
      "Shared",
      "note",
      undefined,
      "first\nmiddle\nlast\n",
    );
    await sa.run();
    await sb.run();
    const other = b.document(d.id);
    await a.save(d.id, d.revision, d.raw.replace("first", "FIRST"));
    await b.save(other.id, other.revision, other.raw.replace("last", "LAST"));
    await sa.run();
    expect((await sb.run()).state).toBe("ready");
    await sa.run();
    expect(a.document(d.id).raw).toBe(b.document(d.id).raw);
    expect(a.document(d.id).raw).toContain("FIRST\nmiddle\nLAST");
    await a.rename(d.id, a.document(d.id).revision, "Notes/Renamed.md");
    await sa.run();
    await sb.run();
    expect(b.document(d.id).path).toBe("Notes/Renamed.md");
    expect(JSON.stringify(remote.revisions)).not.toContain("Shared");
    expect(JSON.stringify(remote.revisions)).not.toContain("Renamed");
  });
  it("preserves both overlapping edits as ordinary Markdown", async () => {
    const d = await a.create("Conflict", "note", undefined, "original\n");
    await sa.run();
    await sb.run();
    const other = b.document(d.id);
    await a.save(d.id, d.revision, d.raw.replace("original", "from A"));
    await b.save(
      other.id,
      other.revision,
      other.raw.replace("original", "from B"),
    );
    await sa.run();
    expect((await sb.run()).state).toBe("conflict");
    expect(b.document(d.id).raw).toContain("from B");
    expect(
      b.documents.find((d) => d.path.startsWith("Conflicts/"))?.raw,
    ).toContain("from A");
    await sa.run();
    expect(a.documents.some((d) => d.raw.includes("from A"))).toBe(true);
    expect(a.document(d.id).raw).toContain("from B");
  });
  it("keeps edited content after delete-versus-edit and handles ordinary deletion", async () => {
    const d = await a.create("Keep", "note", undefined, "original");
    await sa.run();
    await sb.run();
    const other = b.document(d.id);
    await a.apply({
      id: randomUUID(),
      summary: "Delete",
      changes: [{ type: "trash", documentId: d.id, baseRevision: d.revision }],
    });
    await b.save(other.id, other.revision, other.raw + "edited");
    await sa.run();
    await sb.run();
    expect(b.document(d.id).raw).toContain("edited");
    await sa.run();
    expect(a.document(d.id).raw).toContain("edited");
    await a.apply({
      id: randomUUID(),
      summary: "Delete",
      changes: [
        {
          type: "trash",
          documentId: d.id,
          baseRevision: a.document(d.id).revision,
        },
      ],
    });
    await sa.run();
    await sb.run();
    expect(b.documents.some((v) => v.id === d.id)).toBe(false);
  });
  it("queues offline work, retries idempotently, and syncs binary attachments", async () => {
    remote.fail = true;
    const d = await a.create("Offline", "note");
    expect((await sa.run()).state).toBe("offline");
    expect(a.document(d.id)).toBeTruthy();
    remote.fail = false;
    await a.addAttachment("photo.png", new Uint8Array([1, 2, 3, 4]));
    await sa.run();
    await sb.run();
    expect(b.document(d.id).raw).toBe(d.raw);
    const attachments = await fs.readdir(path.join(b.root, "Attachments"));
    expect(
      await fs.readFile(path.join(b.root, "Attachments", attachments[0])),
    ).toEqual(Buffer.from([1, 2, 3, 4]));
    const count = remote.revisions.length;
    await sa.run();
    await sb.run();
    expect(remote.revisions).toHaveLength(count);
  });
  it("reconstructs deleted checkpoints and rejects a tampered remote payload", async () => {
    const d = await a.create("Recover", "note");
    await sa.run();
    await sb.run();
    await sb.close();
    await fs.rm(path.join(b.root, ".fable/sync.md"));
    // A fresh device can unlock and reconstruct from encrypted history.
    const key = (sa as any).key,
      id = (sa as any).checkpoint.vaultId;
    sb = new SyncEngine(b, secrets);
    await sb.attach(remote, key, id);
    await sb.run();
    expect(b.document(d.id).raw).toBe(d.raw);
    const broken = {
      ...remote.revisions[0],
      revisionId: randomUUID(),
      sequence: remote.revisions.length + 1,
    };
    remote.revisions.push(broken);
    expect((await sb.run()).state).toBe("error");
    expect(b.document(d.id).raw).toBe(d.raw);
  });
});
