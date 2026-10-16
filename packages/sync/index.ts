import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID, createHmac } from "node:crypto";
import { EventEmitter } from "node:events";
import diff3Merge from "diff3";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  FableError,
  type SyncStatus,
  type SyncSettings,
} from "../contracts/index.ts";
import { revisionOf, patchMetadata, parseMarkdown } from "../markdown/index.ts";
import { validateHierarchy } from "../domain/index.ts";
import { VaultService, portableName } from "../vault/index.ts";
import {
  createVaultKey,
  encryptPayload,
  decryptPayload,
  type EncryptedPayload,
} from "./crypto.ts";

export interface RevisionIdentity {
  vaultId: string;
  objectId: string;
  revisionId: string;
  parent: string | null;
  sequence?: number;
}
export interface RemoteRevision extends RevisionIdentity {
  payload: EncryptedPayload;
}
export interface RemoteRevisionReference extends RevisionIdentity {
  loadPayload(): Promise<EncryptedPayload>;
}
export interface SyncFile {
  path: string;
  content: string;
  binary: boolean;
  deleted: boolean;
}
export interface RemoteStore {
  push(revision: RemoteRevision, expectedHead: string | null): Promise<void>;
  pull(after: number): Promise<{
    revisions: (RemoteRevision | RemoteRevisionReference)[];
    cursor: number;
  }>;
  acknowledge(cursor: number): Promise<void>;
}
interface Checkpoint {
  vaultId: string;
  deviceId: string;
  cursor: number;
  objects: Record<
    string,
    {
      path: string;
      hash: string;
      head: string;
      binary: boolean;
      deleted?: boolean;
    }
  >;
  outbox?: Record<
    string,
    { revisionId: string; hash: string; parent: string | null }
  >;
}
export interface SecretStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string | undefined): Promise<void>;
}
const localStatus = (): SyncStatus => ({
  state: "local",
  message: "Stored on this device",
  pending: 0,
  conflicts: [],
});
const networkFailure = (error: unknown) =>
  /fetch|network|offline|ENOTFOUND|ECONN|failed to send|timed? ?out/i.test(
    error instanceof Error ? error.message : String(error),
  );

export function mergeText(
  base: string,
  local: string,
  remote: string,
): { text: string; conflict: boolean } {
  if (local === remote || base === remote)
    return { text: local, conflict: false };
  if (base === local) return { text: remote, conflict: false };
  const split = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const chunks = diff3Merge(split(local), split(base), split(remote));
  if (chunks.some((c: any) => c.conflict))
    return { text: local, conflict: true };
  return {
    text: chunks.flatMap((c: any) => c.ok ?? []).join(""),
    conflict: false,
  };
}

export class SupabaseRemote implements RemoteStore {
  constructor(
    private client: SupabaseClient,
    private vaultId: string,
    private deviceId: string,
  ) {}
  private async action(action: string, args: Record<string, unknown> = {}) {
    const { data, error } = await this.client.functions.invoke("sync", {
      body: {
        protocol: 1,
        action,
        vaultId: this.vaultId,
        deviceId: this.deviceId,
        ...args,
      },
    });
    if (error) {
      let detail: any;
      try {
        detail = await (error as any).context?.json();
      } catch {
        /* non-json failure */
      }
      throw new FableError(
        detail?.code === "HEAD_MISMATCH"
          ? "CONFLICT"
          : detail?.code === "QUOTA"
            ? "QUOTA"
            : detail?.code === "UNSUPPORTED"
              ? "UNSUPPORTED"
              : "AUTH",
        detail?.message ?? error.message,
      );
    }
    if (data?.error)
      throw new FableError(
        data.code === "HEAD_MISMATCH" ? "CONFLICT" : "AUTH",
        data.error,
      );
    return data;
  }
  async register(name: string) {
    return this.action("register", { name });
  }
  async push(revision: RemoteRevision, expectedHead: string | null) {
    const bytes = new TextEncoder().encode(JSON.stringify(revision.payload));
    const { uploadPath, token } = await this.action("prepare", {
      revisionId: revision.revisionId,
      bytes: bytes.length,
    });
    const { error } = await this.client.storage
      .from("encrypted-vaults")
      .uploadToSignedUrl(uploadPath, token, bytes, {
        contentType: "application/octet-stream",
      });
    if (error && !/already exists/i.test(error.message))
      throw new Error(error.message);
    await this.action("push", {
      objectId: revision.objectId,
      revisionId: revision.revisionId,
      parent: expectedHead,
      blobPath: uploadPath,
      bytes: bytes.length,
    });
  }
  async pull(after: number) {
    const data = await this.action("pull", { after });
    const revisions: RemoteRevisionReference[] = [];
    for (const r of data.revisions) {
      revisions.push({
        vaultId: this.vaultId,
        objectId: r.object_id,
        revisionId: r.revision_id,
        parent: r.parent_revision,
        sequence: Number(r.sequence),
        loadPayload: async () => {
          const { data: blob, error } = await this.client.storage
            .from("encrypted-vaults")
            .download(r.blob_path);
          if (error || !blob)
            throw new Error(
              error?.message ?? "The encrypted file is unavailable.",
            );
          return JSON.parse(await blob.text());
        },
      });
    }
    return { revisions, cursor: Number(data.cursor) };
  }
  async acknowledge(cursor: number) {
    await this.action("ack", { cursor });
  }
  async devices() {
    return (await this.action("devices")).devices as {
      id: string;
      name: string;
      current: boolean;
      revoked: boolean;
    }[];
  }
  async revoke(id: string) {
    await this.action("revoke", { id });
  }
}

export class SyncEngine extends EventEmitter {
  status: SyncStatus = localStatus();
  private key?: string;
  private identityKey?: Buffer;
  private remote?: RemoteStore;
  private checkpoint?: Checkpoint;
  private running?: Promise<SyncStatus>;
  private client?: SupabaseClient;
  private settings?: SyncSettings;
  private interval?: ReturnType<typeof setInterval>;
  private paused = false;
  private generation = 0;
  private stopRequested = false;
  private transportAbort?: AbortController;
  private reconnect?: ReturnType<typeof setTimeout>;
  constructor(
    private vault: VaultService,
    private secrets: SecretStore,
  ) {
    super();
  }
  private update(values: Partial<SyncStatus>) {
    this.status = { ...this.status, ...values };
    this.emit("status", this.status);
    return this.status;
  }
  private get secretPrefix() {
    return `sync:${revisionOf(this.vault.root).slice(0, 16)}`;
  }
  async publicSettings(): Promise<Omit<SyncSettings, "recoveryKey"> | null> {
    const saved = await this.secrets.get(`${this.secretPrefix}:settings`);
    if (!saved) return null;
    const { url, publishableKey, vaultId } = JSON.parse(saved);
    return { url, publishableKey, vaultId };
  }
  async restore() {
    const root = this.vault.root,
      initialGeneration = this.generation;
    const saved = await this.secrets.get(`${this.secretPrefix}:settings`);
    if (
      !saved ||
      this.vault.root !== root ||
      this.generation !== initialGeneration
    )
      return;
    const attempt = this.configure(JSON.parse(saved)),
      generation = this.generation;
    try {
      await attempt;
      if (this.remote) void this.run();
    } catch (error) {
      if (this.vault.root !== root || this.generation !== generation) return;
      this.update({
        state: networkFailure(error) ? "offline" : "error",
        message: networkFailure(error)
          ? "Offline. Local work is saved; sync will retry."
          : error instanceof Error
            ? error.message
            : "Sync needs attention.",
      });
      if (networkFailure(error)) {
        this.reconnect = setTimeout(() => {
          if (this.vault.root === root && this.generation === generation)
            void this.restore();
        }, 30000);
        this.reconnect.unref?.();
      }
    }
  }
  async configure(settings: SyncSettings) {
    const root = this.vault.root,
      generation = ++this.generation;
    await this.close(false);
    this.stopRequested = false;
    if (this.vault.root !== root || this.generation !== generation)
      throw new FableError(
        "CONFLICT",
        "The vault changed during sync setup. Open sync settings again.",
      );
    this.paused = false;
    const url = new URL(settings.url);
    if (
      url.protocol !== "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
      throw new FableError("VALIDATION", "Sync servers must use HTTPS.");
    this.settings = {
      url: settings.url.replace(/\/$/, ""),
      publishableKey: settings.publishableKey,
      vaultId: settings.vaultId,
    };
    const secretPrefix = this.secretPrefix;
    await this.secrets.set(
      `${secretPrefix}:settings`,
      JSON.stringify(this.settings),
    );
    if (settings.recoveryKey) {
      if (Buffer.from(settings.recoveryKey, "base64url").length !== 32)
        throw new FableError("VALIDATION", "Enter the complete recovery key.");
      await this.secrets.set(`${secretPrefix}:key`, settings.recoveryKey);
    }
    if (
      this.vault.root !== root ||
      !this.settings ||
      this.generation !== generation
    )
      throw new FableError("CONFLICT", "The vault changed during sync setup.");
    const connection = new AbortController();
    this.transportAbort = connection;
    this.client = createClient(this.settings.url, settings.publishableKey, {
      global: {
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            signal: AbortSignal.any([
              connection.signal,
              ...(init?.signal ? [init.signal] : []),
            ]),
          }),
      },
      auth: {
        storage: {
          getItem: async (k: string) =>
            (await this.secrets.get(`${secretPrefix}:auth:${k}`)) ?? null,
          setItem: async (k: string, value: string) =>
            this.secrets.set(`${secretPrefix}:auth:${k}`, value),
          removeItem: async (k: string) =>
            this.secrets.set(`${secretPrefix}:auth:${k}`, undefined),
        },
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
    const client = this.client;
    const { data, error } = await client.auth.getSession();
    if (
      this.client !== client ||
      this.vault.root !== root ||
      this.generation !== generation
    )
      throw new FableError("CONFLICT", "The vault changed during sync setup.");
    if (error) {
      if (networkFailure(error)) throw error;
      await client.auth.signOut({ scope: "local" });
    }
    if (data.session) {
      try {
        return await this.activate();
      } catch (e) {
        if (!(e instanceof FableError) || e.code !== "AUTH") throw e;
        await this.client.auth.signOut({ scope: "local" });
      }
    }
    this.update({
      state: "local",
      message: "Sign in to enable encrypted sync",
    });
    return { message: "Enter your email to receive a sign-in code." };
  }
  async sendCode(email: string) {
    if (!this.client) throw new Error("Configure your sync server first.");
    const { error } = await this.client.auth.signInWithOtp({ email });
    if (error) throw error;
  }
  async verifyCode(email: string, code: string) {
    if (!this.client) throw new Error("Configure your sync server first.");
    const client = this.client,
      root = this.vault.root;
    const { error } = await client.auth.verifyOtp({
      email,
      token: code,
      type: "email",
    });
    if (error) throw error;
    if (this.client !== client || this.vault.root !== root)
      throw new FableError("CONFLICT", "The vault changed during sync setup.");
    return this.activate();
  }
  private async activate() {
    if (!this.client || !this.settings)
      throw new Error("Configure a sync server first.");
    const root = this.vault.root,
      client = this.client,
      settings = this.settings,
      prefix = this.secretPrefix;
    const ensureCurrent = () => {
      if (
        this.vault.root !== root ||
        this.client !== client ||
        this.settings !== settings
      )
        throw new FableError(
          "CONFLICT",
          "The vault changed during sync setup. Open sync settings again.",
        );
    };
    let key = await this.secrets.get(`${prefix}:key`);
    if (!key) {
      if (this.settings.vaultId)
        throw new FableError(
          "AUTH",
          "Enter the recovery key for this existing vault.",
        );
      key = await createVaultKey();
      ensureCurrent();
      await this.secrets.set(`${prefix}:key`, key);
    }
    ensureCurrent();
    const vaultId = settings.vaultId ?? randomUUID();
    settings.vaultId = vaultId;
    await this.secrets.set(`${prefix}:settings`, JSON.stringify(settings));
    const checkpoint = await this.loadCheckpoint(vaultId);
    ensureCurrent();
    const remote = new SupabaseRemote(
      this.client,
      vaultId,
      checkpoint.deviceId,
    );
    try {
      await remote.register(
        `${process.platform === "darwin" ? "Mac" : "Windows"} · ${checkpoint.deviceId.slice(0, 8)}`,
      );
    } catch (e) {
      if (!(e instanceof FableError) || e.code !== "AUTH") throw e;
      checkpoint.deviceId = randomUUID();
      await new SupabaseRemote(
        this.client,
        vaultId,
        checkpoint.deviceId,
      ).register(
        `${process.platform === "darwin" ? "Mac" : "Windows"} · ${checkpoint.deviceId.slice(0, 8)}`,
      );
    }
    ensureCurrent();
    await this.attach(
      new SupabaseRemote(this.client, vaultId, checkpoint.deviceId),
      key,
      vaultId,
      checkpoint,
    );
    return {
      vaultId,
      recoveryKey: key,
      message:
        "Encrypted sync is ready. Keep your recovery key somewhere safe.",
    };
  }
  async attach(
    remote: RemoteStore,
    key: string,
    vaultId: string,
    checkpoint?: Checkpoint,
  ) {
    this.remote = remote;
    this.stopRequested = false;
    this.key = key;
    this.identityKey = createHmac("sha256", Buffer.from(key, "base64url"))
      .update("fable:opaque-identities:v1")
      .digest();
    this.checkpoint = checkpoint ?? (await this.loadCheckpoint(vaultId));
    clearInterval(this.interval);
    this.interval = setInterval(() => {
      void this.run();
    }, 30000);
    this.interval.unref?.();
    this.update({ state: "ready", message: "Encrypted sync connected" });
  }
  private async loadCheckpoint(vaultId: string): Promise<Checkpoint> {
    try {
      const raw = await fs.readFile(
        path.join(this.vault.root, ".fable/sync.md"),
        "utf8",
      );
      const data = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(raw)![1]);
      if (data.vaultId === vaultId) return data;
    } catch {
      /* Reconstructing a checkpoint preserves all local files. */
    }
    return { vaultId, deviceId: randomUUID(), cursor: 0, objects: {} };
  }
  private async saveCheckpoint() {
    await this.vault.atomic(
      ".fable/sync.md",
      `# Device sync checkpoint\n\nRebuildable state for this device. Credentials and keys are stored separately.\n\n\`\`\`json\n${JSON.stringify(this.checkpoint, null, 2)}\n\`\`\`\n`,
      true,
    );
  }
  private async *files(): AsyncGenerator<[string, SyncFile]> {
    validateHierarchy(this.vault.documents);
    if (this.vault.documents.some((doc) => !doc.managed))
      throw new FableError(
        "INVALID_METADATA",
        "Give unmanaged notes stable IDs before syncing. Review the affected files in sync settings.",
      );
    for (const doc of this.vault.documents) {
      yield [
        this.objectId("doc", doc.id),
        {
          path: doc.path,
          content: doc.raw,
          binary: false,
          deleted: false,
        },
      ];
    }
    const engine = this;
    const visit = async function* (
      dir: string,
    ): AsyncGenerator<[string, SyncFile]> {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (
          entry.isSymbolicLink() ||
          entry.name.startsWith(".") ||
          entry.name === "node_modules"
        )
          continue;
        const absolute = path.join(dir, entry.name);
        if (engine.stopRequested) return;
        if (entry.isDirectory()) yield* visit(absolute);
        else if (entry.isFile() && !/\.md$/i.test(entry.name)) {
          const relative = path
            .relative(engine.vault.root, absolute)
            .split(path.sep)
            .join("/");
          const safe = await engine.vault.safePath(relative);
          const stat = await fs.stat(safe);
          if (stat.size > 50 * 1024 * 1024)
            throw new FableError(
              "QUOTA",
              `The file ${relative} exceeds the 50 MB sync limit. Local work is saved.`,
            );
          const bytes = await fs.readFile(safe);
          yield [
            engine.objectId("asset", relative),
            {
              path: relative,
              content: bytes.toString("base64"),
              binary: true,
              deleted: false,
            },
          ];
        }
      }
    };
    yield* visit(this.vault.root);
    for (const relative of [".fable/views.md", ".fable/vault.md"]) {
      try {
        const raw = await fs.readFile(
          await this.vault.safePath(relative, true),
          "utf8",
        );
        yield [
          this.objectId("config", relative),
          {
            path: relative,
            content: raw,
            binary: false,
            deleted: false,
          },
        ];
      } catch (e: any) {
        if (e.code !== "ENOENT") throw e;
      }
    }
  }
  private objectId(kind: "doc" | "asset" | "config", value: string) {
    if (!this.identityKey)
      throw new FableError("AUTH", "Unlock this vault before syncing.");
    return `${kind}:${createHmac("sha256", this.identityKey).update(`${kind}\0${value}`).digest("hex")}`;
  }
  async adopt() {
    validateHierarchy(this.vault.documents);
    const unmanaged = this.vault.documents.filter((d) => !d.managed);
    for (let i = 0; i < unmanaged.length; i += 100)
      await this.vault.apply({
        id: randomUUID(),
        summary: "Add portable identities for encrypted sync",
        changes: unmanaged.slice(i, i + 100).map((d) => ({
          type: "patch" as const,
          documentId: d.id,
          baseRevision: d.revision,
          edits: [
            {
              from: 0,
              to: d.raw.length,
              insert: patchMetadata(d.raw, {
                schema: 1,
                id: randomUUID(),
                kind: d.kind,
              }),
            },
          ],
        })),
      });
  }
  run(): Promise<SyncStatus> {
    if (this.running) return this.running;
    if (!this.remote || !this.key || !this.checkpoint || this.paused)
      return Promise.resolve(this.status);
    this.running = this.perform()
      .catch((e: Error) => {
        if (e instanceof FableError && e.code === "UNSUPPORTED")
          this.paused = true;
        return this.update({
          state:
            e instanceof FableError && e.code === "CONFLICT"
              ? "conflict"
              : networkFailure(e)
                ? "offline"
                : "error",
          message: e.message,
        });
      })
      .finally(() => {
        this.running = undefined;
      });
    return this.running;
  }
  private async perform() {
    this.update({ state: "syncing", message: "Syncing encrypted files" });
    const remote = this.remote!,
      key = this.key!,
      cp = this.checkpoint!;
    const ensureRunning = () => {
      if (this.stopRequested)
        throw new Error("Sync stopped. Local work is saved.");
    };
    // Pull before pushing. A checkpoint advances only after durable local application.
    let more = true;
    while (more) {
      ensureRunning();
      const incoming = await remote.pull(cp.cursor);
      for (const revision of incoming.revisions) {
        ensureRunning();
        if (revision.vaultId !== cp.vaultId)
          throw new FableError(
            "VALIDATION",
            "A remote revision belongs to another vault.",
          );
        const identity = `${cp.vaultId}:${revision.objectId}:${revision.revisionId}`;
        const file = await decryptPayload<SyncFile>(
          key,
          "payload" in revision
            ? revision.payload
            : await revision.loadPayload(),
          identity,
        );
        ensureRunning();
        await this.vault.withWriteLock(() => this.accept(revision, file));
        cp.cursor = Math.max(cp.cursor, revision.sequence ?? cp.cursor);
        await this.saveCheckpoint();
      }
      cp.cursor = Math.max(cp.cursor, incoming.cursor);
      await this.saveCheckpoint();
      more = incoming.revisions.length === 100;
    }
    await this.vault.scan();
    const seen = new Set<string>();
    const pushFile = async (id: string, file: SyncFile) => {
      ensureRunning();
      const hash = revisionOf(JSON.stringify(file));
      if (hash === cp.objects[id]?.hash) return;
      this.update({ pending: 1 });
      const parent = cp.objects[id]?.head ?? null;
      cp.outbox ??= {};
      const pending = cp.outbox[id];
      const revisionId =
        pending?.hash === hash && pending.parent === parent
          ? pending.revisionId
          : randomUUID();
      cp.outbox[id] = { revisionId, hash, parent };
      await this.saveCheckpoint();
      const revision: RemoteRevision = {
        vaultId: cp.vaultId,
        objectId: id,
        revisionId,
        parent,
        payload: await encryptPayload(
          key,
          file,
          `${cp.vaultId}:${id}:${revisionId}`,
        ),
      };
      await remote.push(revision, parent);
      cp.objects[id] = {
        path: file.path,
        hash,
        head: revisionId,
        binary: file.binary,
        deleted: file.deleted,
      };
      delete cp.outbox[id];
      if (!file.deleted)
        await this.vault.atomic(
          `.fable/sync-bases/${revisionOf(id)}.${file.binary ? "bin" : "md"}`,
          file.binary ? Buffer.from(file.content, "base64") : file.content,
          true,
        );
      await this.saveCheckpoint();
      this.update({ pending: 0 });
    };
    for await (const [id, file] of this.files()) {
      seen.add(id);
      await pushFile(id, file);
    }
    ensureRunning();
    for (const [id, known] of Object.entries(cp.objects))
      if (!seen.has(id) && !known.deleted)
        await pushFile(id, {
          path: known.path,
          content: "",
          binary: known.binary,
          deleted: true,
        });
    await remote.acknowledge(cp.cursor);
    return this.update({
      state: this.status.conflicts.length ? "conflict" : "ready",
      message: this.status.conflicts.length
        ? "Review the preserved conflict copies"
        : "Everything is up to date",
      lastSynced: new Date().toISOString(),
      pending: 0,
    });
  }
  private async accept(revision: RevisionIdentity, file: SyncFile) {
    const cp = this.checkpoint!,
      known = cp.objects[revision.objectId];
    if (known?.head === revision.revisionId) return;
    if (
      typeof file.path !== "string" ||
      typeof file.content !== "string" ||
      typeof file.binary !== "boolean" ||
      typeof file.deleted !== "boolean"
    )
      throw new FableError(
        "VALIDATION",
        "The encrypted file has an invalid format.",
      );
    const internal = [".fable/views.md", ".fable/vault.md"].includes(file.path);
    if (!file.deleted) {
      const expected = internal
        ? this.objectId("config", file.path)
        : file.binary
          ? this.objectId("asset", file.path)
          : this.objectId("doc", parseMarkdown(file.path, file.content).id);
      if (expected !== revision.objectId)
        throw new FableError(
          "VALIDATION",
          "The encrypted document identity does not match its revision.",
        );
    }
    const absolute = await this.vault.safePath(file.path, internal);
    const currentPath = known?.path ?? file.path;
    const currentAbsolute = await this.vault.safePath(currentPath, internal);
    let bytes: Buffer | null = null;
    try {
      bytes = await fs.readFile(currentAbsolute);
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
    let accepted = file.content,
      conflict = false;
    if (currentPath !== file.path) {
      try {
        await fs.access(absolute);
        conflict = true;
      } catch (e: any) {
        if (e.code !== "ENOENT") throw e;
      }
    }
    if (bytes) {
      const currentContent = file.binary
        ? bytes.toString("base64")
        : bytes.toString("utf8");
      const current: SyncFile = {
        path: currentPath,
        content: currentContent,
        binary: file.binary,
        deleted: false,
      };
      const dirty = known
        ? revisionOf(JSON.stringify(current)) !== known.hash
        : currentContent !== file.content;
      if (dirty) {
        if (file.deleted || file.binary) conflict = true;
        else {
          let base = "";
          try {
            base = await fs.readFile(
              path.join(
                this.vault.root,
                `.fable/sync-bases/${revisionOf(revision.objectId)}.md`,
              ),
              "utf8",
            );
          } catch {}
          const merged = mergeText(base, currentContent, file.content);
          accepted = merged.text;
          conflict = conflict || merged.conflict;
        }
      }
    }
    await this.vault.guardFile(currentPath, bytes, internal);
    if (conflict) {
      if (!file.deleted) {
        const extension = path.extname(file.path),
          name = portableName(path.basename(file.path, extension));
        const conflictPath = `Conflicts/${name} (${revision.revisionId.slice(0, 8)})${extension}`;
        await this.vault.atomic(
          conflictPath,
          file.binary
            ? Buffer.from(file.content, "base64")
            : patchMetadata(file.content, { id: randomUUID() }),
        );
        this.update({
          conflicts: [...new Set([...this.status.conflicts, conflictPath])],
        });
      } else
        this.update({
          conflicts: [...new Set([...this.status.conflicts, currentPath])],
        });
    } else if (file.deleted) {
      if (bytes) await fs.rm(currentAbsolute);
    } else {
      if (!file.binary && !internal) {
        const incoming = parseMarkdown(file.path, accepted);
        validateHierarchy([
          ...this.vault.documents.filter(
            (d) => d.id !== incoming.id && d.path !== file.path,
          ),
          incoming,
        ]);
      }
      // A rename destination must never replace a different local file.
      if (currentPath !== file.path) {
        try {
          await fs.access(absolute);
          throw new FableError(
            "CONFLICT",
            `Rename collision at ${file.path}. Both files were kept.`,
          );
        } catch (e: any) {
          if (e.code !== "ENOENT") throw e;
        }
      }
      await this.vault.atomic(
        file.path,
        file.binary ? Buffer.from(accepted, "base64") : accepted,
        internal,
      );
      if (currentPath !== file.path && bytes) await fs.rm(currentAbsolute);
    }
    cp.objects[revision.objectId] = {
      path: conflict ? currentPath : file.path,
      hash: revisionOf(JSON.stringify(file)),
      head: revision.revisionId,
      binary: file.binary,
      deleted: file.deleted,
    };
    if (cp.outbox?.[revision.objectId]?.revisionId === revision.revisionId)
      delete cp.outbox[revision.objectId];
    if (!file.deleted)
      await this.vault.atomic(
        `.fable/sync-bases/${revisionOf(revision.objectId)}.${file.binary ? "bin" : "md"}`,
        file.binary ? Buffer.from(file.content, "base64") : file.content,
        true,
      );
  }
  async devices() {
    return this.remote instanceof SupabaseRemote ? this.remote.devices() : [];
  }
  async revoke(id: string) {
    if (this.remote instanceof SupabaseRemote) await this.remote.revoke(id);
  }
  async disconnect() {
    const client = this.client,
      prefix = this.secretPrefix;
    await this.close();
    await client?.auth.signOut({ scope: "local" }).catch(() => {});
    await this.secrets.set(`${prefix}:settings`, undefined);
    return this.update(localStatus());
  }
  async close(invalidate = true) {
    if (invalidate) this.generation++;
    this.stopRequested = true;
    clearTimeout(this.reconnect);
    clearInterval(this.interval);
    this.transportAbort?.abort();
    await this.running;
    this.client?.auth.stopAutoRefresh();
    this.client = undefined;
    this.remote = undefined;
    this.key = undefined;
    this.identityKey = undefined;
    this.checkpoint = undefined;
    this.settings = undefined;
    this.transportAbort = undefined;
    this.update(localStatus());
  }
}
