import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { z } from "zod";
import { VaultService } from "../../../packages/vault/index.ts";
import { seedVault } from "../../../packages/vault/seed.ts";
import { ProviderService } from "../../../packages/providers/index.ts";
import { SyncEngine, type SecretStore } from "../../../packages/sync/index.ts";
import {
  changeSetSchema,
  sidebarReorderSchema,
  kinds,
  type AppEvent,
  type Operation,
  type Operations,
  FableError,
} from "../../../packages/contracts/index.ts";

export interface NativeHooks {
  chooseFolder(): Promise<string | null>;
  chooseAttachment(): Promise<{ name: string; bytes: Uint8Array } | null>;
  reveal(file: string): Promise<void>;
  openURL(url: string): Promise<void>;
  openFile?(file: string): Promise<void>;
}
export class FileSecrets implements SecretStore {
  private data: Record<string, string> = {};
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private file: string,
    private encrypt: (s: string) => string,
    private decrypt: (s: string) => string,
  ) {}
  async load() {
    try {
      this.data = JSON.parse(await fs.readFile(this.file, "utf8"));
    } catch {}
  }
  async get(key: string) {
    const value = this.data[key];
    return value ? this.decrypt(value) : undefined;
  }
  async set(key: string, value: string | undefined) {
    const work = this.queue.then(async () => {
      if (value === undefined) delete this.data[key];
      else this.data[key] = this.encrypt(value);
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.${randomUUID()}.tmp`;
      await fs.writeFile(temp, JSON.stringify(this.data), { mode: 0o600 });
      await fs.rename(temp, this.file);
    });
    this.queue = work.catch(() => {});
    await work;
  }
}
export class AppService extends EventEmitter {
  vault: VaultService;
  providers: ProviderService;
  sync: SyncEngine;
  private opened = false;
  private syncTimer?: ReturnType<typeof setTimeout>;
  constructor(
    private dataDirectory: string,
    private secrets: SecretStore,
    private hooks?: NativeHooks,
    private devVault?: string,
  ) {
    super();
    this.vault = new VaultService(path.join(dataDirectory, "cache"));
    this.providers = new ProviderService(this.vault, dataDirectory);
    this.sync = new SyncEngine(this.vault, secrets);
    this.vault.on("change", (state) => {
      this.event({ type: "vault", state });
      clearTimeout(this.syncTimer);
      this.syncTimer = setTimeout(() => {
        void this.sync.run();
      }, 900);
    });
    this.vault.on("attachment", () => {
      clearTimeout(this.syncTimer);
      this.syncTimer = setTimeout(() => {
        void this.sync.run();
      }, 900);
    });
    this.vault.on("failure", (e) =>
      this.event({ type: "error", message: e.message }),
    );
    this.providers.on("delta", (event) => this.event({ type: "ai", ...event }));
    this.sync.on("status", (status) => this.event({ type: "sync", status }));
  }
  private event(event: AppEvent) {
    this.emit("event", event);
  }
  async initialize() {
    await fs.mkdir(this.dataDirectory, { recursive: true });
    await this.providers.load();
    if (this.devVault) {
      await seedVault(this.devVault);
      await this.open(this.devVault);
    } else {
      try {
        const root = await fs.readFile(
          path.join(this.dataDirectory, "last-vault"),
          "utf8",
        );
        await fs.access(root);
        await this.open(root);
      } catch {}
    }
  }
  private async open(root: string) {
    await this.providers.shutdown();
    await this.sync.close();
    const state = await this.vault.open(root);
    this.opened = true;
    await fs.writeFile(path.join(this.dataDirectory, "last-vault"), root, {
      mode: 0o600,
    });
    void this.sync
      .restore()
      .catch((e: any) => this.event({ type: "error", message: e.message }));
    return state;
  }
  async request<K extends Operation>(
    operation: K,
    input: Operations[K]["input"],
  ): Promise<Operations[K]["output"]> {
    const result = await this.dispatch(operation, input);
    return result as Operations[K]["output"];
  }
  private async dispatch(
    operation: Operation,
    input: unknown,
  ): Promise<unknown> {
    const idSchema = z.string().min(1).max(500),
      base = z.object({ id: idSchema, baseRevision: z.string().length(64) });
    if (operation === "vault.state")
      return this.opened ? this.vault.state : null;
    if (operation === "vault.open") {
      const { sample } = z
        .object({ sample: z.boolean().optional() })
        .parse(input);
      if (sample) {
        const root = path.join(this.dataDirectory, "Example vault");
        await seedVault(root);
        return this.open(root);
      }
      if (!this.hooks)
        throw new FableError(
          "UNSUPPORTED",
          "Folder selection is available in the desktop app. The development preview uses its example folder.",
        );
      const folder = await this.hooks?.chooseFolder();
      return folder ? this.open(folder) : this.opened ? this.vault.state : null;
    }
    if (operation === "providers.list") return this.providers.list();
    if (operation === "providers.configure") {
      const a = z
        .object({ provider: z.enum(["codex", "claude"]), path: z.string() })
        .parse(input);
      return this.providers.configure(a.provider, a.path);
    }
    if (operation === "providers.connect") {
      const a = z
        .object({ provider: z.enum(["codex", "claude"]) })
        .parse(input);
      const result = await this.providers.connect(a.provider);
      if (result.url) await this.hooks?.openURL(result.url);
      return result;
    }
    if (operation === "providers.test") {
      const a = z
        .object({ provider: z.enum(["codex", "claude"]) })
        .parse(input);
      if (!this.opened)
        throw new FableError(
          "FILESYSTEM",
          "Open a folder to save the connection check.",
        );
      return this.providers.test(a.provider);
    }
    if (!this.opened)
      throw new FableError("FILESYSTEM", "Open a folder to start working.");
    switch (operation) {
      case "views.read":
        return this.vault.views();
      case "views.save":
        return this.vault.saveViews(
          z
            .object({
              bookmarks: z.array(z.string()).max(10000),
              hiddenColumns: z
                .array(z.enum(["todo", "waiting", "ready", "doing", "done"]))
                .max(5),
              revision: z.string().nullable(),
              selectedAreaId: z.string().nullable().optional(),
              sidebarOrder: z
                .record(
                  z.string().max(3000),
                  z.array(z.string().max(1000)).max(20000),
                )
                .optional(),
            })
            .parse(input),
        );
      case "documents.create": {
        const a = z
          .object({
            title: z.string().trim().min(1).max(200),
            kind: z.enum(kinds),
            parent: idSchema.optional(),
            body: z.string().optional(),
            directory: z.string().min(1).max(1000).optional(),
          })
          .parse(input);
        return this.vault.create(
          a.title,
          a.kind,
          a.parent,
          a.body,
          a.directory,
        );
      }
      case "pages.create": {
        const a = z
          .object({
            projectId: idSchema,
            title: z.string().trim().min(1).max(200),
            directory: z.string().min(1).max(1000).optional(),
          })
          .parse(input);
        return this.vault.createPage(a.projectId, a.title, a.directory);
      }
      case "pages.move": {
        const a = base
          .extend({
            parentId: idSchema,
            directory: z.string().min(1).max(1000),
          })
          .parse(input);
        return this.vault.movePage(
          a.id,
          a.baseRevision,
          a.parentId,
          a.directory,
        );
      }
      case "sidebar.reorder":
        return this.vault.reorderSidebar(sidebarReorderSchema.parse(input));
      case "folders.create": {
        const a = z
          .object({
            parentId: idSchema,
            name: z.string().trim().min(1).max(200),
            directory: z.string().min(1).max(1000).optional(),
          })
          .parse(input);
        return this.vault.createFolder(a.parentId, a.name, a.directory);
      }
      case "documents.preserveDraft": {
        const a = z
          .object({
            title: z.string().min(1).max(200),
            raw: z.string().max(10 * 1024 * 1024),
          })
          .parse(input);
        return this.vault.preserveDraft(a.title, a.raw);
      }
      case "documents.save": {
        const a = base
          .extend({ raw: z.string().max(10 * 1024 * 1024) })
          .parse(input);
        return this.vault.save(a.id, a.baseRevision, a.raw);
      }
      case "documents.metadata": {
        const a = base
          .extend({ values: z.record(z.string(), z.unknown()) })
          .parse(input);
        const allowed = [
          "kind",
          "parent",
          "status",
          "rank",
          "start",
          "due",
          "depends_on",
          "completed_at",
        ];
        if (Object.keys(a.values).some((k) => !allowed.includes(k)))
          throw new FableError(
            "VALIDATION",
            "This property cannot be edited through the properties panel.",
          );
        return this.vault.metadata(a.id, a.baseRevision, a.values);
      }
      case "documents.rename": {
        const a = base
          .extend({ path: z.string().min(1).max(500) })
          .parse(input);
        return this.vault.rename(a.id, a.baseRevision, a.path);
      }
      case "documents.trash": {
        const a = base.parse(input);
        return this.vault.apply({
          id: randomUUID(),
          summary: `Move ${this.vault.document(a.id).title} to history`,
          changes: [
            { type: "trash", documentId: a.id, baseRevision: a.baseRevision },
          ],
        });
      }
      case "documents.reveal": {
        const a = z.object({ id: idSchema.optional() }).parse(input);
        const file = a.id
          ? await this.vault.safePath(this.vault.document(a.id).path)
          : this.vault.root;
        await this.hooks?.reveal(file);
        return;
      }
      case "attachments.add": {
        const a = z
          .object({
            name: z.string().optional(),
            data: z
              .string()
              .max(70 * 1024 * 1024)
              .optional(),
          })
          .parse(input ?? {});
        const attachment =
          a.data && a.name
            ? { name: a.name, bytes: Buffer.from(a.data, "base64") }
            : await this.hooks?.chooseAttachment();
        if (!attachment) return null;
        return this.vault.addAttachment(attachment.name, attachment.bytes);
      }
      case "attachments.open": {
        const a = z.object({ path: z.string().min(1).max(1000) }).parse(input);
        if (!/\.(pdf|png|jpe?g|webp|gif|avif|txt|csv)$/i.test(a.path))
          throw new FableError(
            "VALIDATION",
            "Open this file from your vault folder.",
          );
        const file = await this.vault.safePath(a.path);
        if (!this.hooks?.openFile)
          throw new FableError(
            "UNSUPPORTED",
            "Open attachments from the desktop app.",
          );
        await this.hooks.openFile(file);
        return;
      }
      case "tasks.toggle": {
        const a = z
          .object({
            documentId: idSchema,
            taskId: idSchema,
            baseRevision: z.string().length(64),
            done: z.boolean(),
          })
          .parse(input);
        return this.vault.toggle(
          a.documentId,
          a.taskId,
          a.baseRevision,
          a.done,
        );
      }
      case "tasks.create": {
        const a = z
          .object({
            title: z.string().trim().min(1).max(2000),
            documentId: idSchema.optional(),
          })
          .parse(input);
        return this.vault.addTask(a.title, a.documentId);
      }
      case "tasks.move": {
        const a = z
          .object({
            documentId: idSchema,
            taskId: idSchema,
            beforeTaskId: idSchema,
            baseRevision: z.string().length(64),
          })
          .parse(input);
        return this.vault.moveTask(
          a.documentId,
          a.taskId,
          a.beforeTaskId,
          a.baseRevision,
        );
      }
      case "search":
        return this.vault.search(
          z.object({ query: z.string().max(500) }).parse(input).query,
        );
      case "changes.apply":
        return this.vault.apply(changeSetSchema.parse(input));
      case "history.list":
        return this.vault.history();
      case "history.undo":
        return this.vault.undo(z.object({ id: idSchema }).parse(input).id);
      case "ai.start": {
        const a = z
          .object({
            provider: z.enum(["codex", "claude"]),
            model: z.string().optional(),
            prompt: z.string().trim().min(1).max(20000),
            documentIds: z.array(idSchema).min(1).max(100),
            conversationId: idSchema.optional(),
          })
          .parse(input);
        return this.providers.start(a);
      }
      case "ai.cancel":
        return this.providers.cancel();
      case "sync.status":
        return this.sync.status;
      case "sync.settings":
        return this.sync.publicSettings();
      case "sync.adopt":
        return this.sync.adopt();
      case "sync.configure": {
        const a = z
          .object({
            url: z.string().url(),
            publishableKey: z.string().min(1),
            vaultId: z.string().uuid().optional(),
            recoveryKey: z.string().optional(),
          })
          .parse(input);
        await this.sync.adopt();
        return this.sync.configure(a);
      }
      case "sync.sendCode":
        return this.sync.sendCode(
          z.object({ email: z.email() }).parse(input).email,
        );
      case "sync.verifyCode": {
        const a = z
          .object({ email: z.email(), code: z.string().regex(/^\d{6,10}$/) })
          .parse(input);
        return this.sync.verifyCode(a.email, a.code);
      }
      case "sync.run":
        return this.sync.run();
      case "sync.disconnect":
        return this.sync.disconnect();
      case "sync.devices":
        return this.sync.devices();
      case "sync.revoke":
        return this.sync.revoke(
          z.object({ id: z.string().uuid() }).parse(input).id,
        );
    }
    throw new FableError("VALIDATION", "Unknown application operation.");
  }
  async close() {
    clearTimeout(this.syncTimer);
    await this.providers.shutdown();
    await this.sync.close();
    await this.vault.close();
  }
}
