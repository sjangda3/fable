import { z } from "zod";

export const kinds = [
  "note",
  "area",
  "goal",
  "project",
  "insight",
  "conversation",
] as const;
export const statuses = ["todo", "waiting", "ready", "doing", "done"] as const;
export type DocumentKind = (typeof kinds)[number];
export type WorkStatus = (typeof statuses)[number];
export const projectFileSchema = z.object({
  name: z.string().trim().min(1).max(255),
  path: z.string().regex(/^Attachments\/[^/\\]+$/),
  size: z
    .number()
    .int()
    .min(0)
    .max(50 * 1024 * 1024),
});
export type ProjectFile = z.infer<typeof projectFileSchema>;
export const projectSettingsSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[^\r\n\u0000-\u001f]+$/),
  sourceFolders: z.array(z.string().min(1).max(1000)).max(100),
  files: z.array(projectFileSchema).max(100),
});
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;
export type ViewId =
  "areas" | "goals" | "tasks" | "insights" | "completed" | "notes";
export const metadataSchema = z
  .object({
    schema: z.literal(1).default(1),
    id: z.string().min(1),
    kind: z.enum(kinds).default("note"),
    parent: z.string().nullable().optional(),
    status: z.enum(statuses).default("todo"),
    rank: z.string().default("a0"),
    start: z
      .string()
      .nullish()
      .transform((v) => v ?? undefined),
    due: z
      .string()
      .nullish()
      .transform((v) => v ?? undefined),
    depends_on: z.array(z.string()).default([]),
    completed_at: z
      .string()
      .nullish()
      .transform((v) => v ?? undefined),
  })
  .passthrough();
export type DocumentMetadata = z.infer<typeof metadataSchema>;
export interface TaskRef {
  id: string;
  documentId: string;
  title: string;
  done: boolean;
  from: number;
  to: number;
  checkFrom: number;
  checkTo: number;
  line: number;
  depth: number;
  context?: string;
  due?: string;
  status: WorkStatus;
  /** Undefined inherits the source project; null explicitly removes assignment. */
  projectId?: string | null;
  completedAt?: string;
  baseRevision: string;
}
export interface DocumentSnapshot {
  id: string;
  path: string;
  title: string;
  kind: DocumentKind;
  raw: string;
  body: string;
  revision: string;
  metadata: DocumentMetadata;
  tasks: TaskRef[];
  modifiedAt: string;
  diagnostics: string[];
  managed: boolean;
}
export interface VaultState {
  name: string;
  path: string;
  documents: DocumentSnapshot[];
  directories?: string[];
  indexStatus: "ready" | "indexing";
}
export const textEditSchema = z.object({
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
  insert: z.string(),
});
export type TextEdit = z.infer<typeof textEditSchema>;
export const changeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("patch"),
    documentId: z.string(),
    baseRevision: z.string(),
    edits: z.array(textEditSchema).min(1),
  }),
  z.object({ type: z.literal("create"), path: z.string(), raw: z.string() }),
  z.object({
    type: z.literal("move"),
    documentId: z.string(),
    baseRevision: z.string(),
    path: z.string(),
    edits: z.array(textEditSchema).optional(),
  }),
  z.object({
    type: z.literal("trash"),
    documentId: z.string(),
    baseRevision: z.string(),
  }),
]);
export const changeSetSchema = z.object({
  id: z.string(),
  summary: z.string(),
  changes: z.array(changeSchema).min(1).max(100),
});
export type ChangeSet = z.infer<typeof changeSetSchema>;
export type Change = z.infer<typeof changeSchema>;
export type ProviderId = "codex" | "claude";
export interface ProviderModel {
  id: string;
  name: string;
  isDefault?: boolean;
}
export interface ProviderHealth {
  id: ProviderId;
  name: string;
  installed: boolean;
  path?: string;
  version?: string;
  authenticated: boolean;
  authMode: "subscription" | "api" | "unknown";
  message: string;
  verified?: boolean;
  models: ProviderModel[];
}
export interface AIRequest {
  provider: ProviderId;
  model?: string;
  prompt: string;
  documentIds: string[];
  conversationId?: string;
}
export interface AIResult {
  id: string;
  text: string;
  changeSet?: ChangeSet;
  conversationId: string;
}
export interface SyncSettings {
  url: string;
  publishableKey: string;
  vaultId?: string;
  recoveryKey?: string;
}
export interface SyncStatus {
  state: "local" | "syncing" | "ready" | "offline" | "conflict" | "error";
  message: string;
  pending: number;
  lastSynced?: string;
  conflicts: string[];
}
export interface HistoryEntry {
  id: string;
  summary: string;
  createdAt: string;
  paths: string[];
}
export interface ViewSettings {
  bookmarks: string[];
  hiddenColumns: WorkStatus[];
  revision: string | null;
  selectedAreaId?: string | null;
  sidebarOrder?: Record<string, string[]>;
}
export const sidebarReorderSchema = z.object({
  kind: z.enum(["projects", "folders", "pages"]),
  parentId: z.string().min(1).max(500),
  directory: z.string().min(1).max(1000).optional(),
  source: z.string().min(1).max(1000),
  target: z.string().min(1).max(1000),
  position: z.enum(["before", "after"]),
  revision: z.string().nullable(),
});
export type SidebarReorder = z.infer<typeof sidebarReorderSchema>;
export type AppEvent =
  | { type: "vault"; state: VaultState }
  | { type: "error"; message: string }
  | {
      type: "ai";
      id: string;
      text: string;
      state: "streaming" | "complete" | "error";
      message?: string;
    }
  | { type: "sync"; status: SyncStatus };
export interface SearchResult {
  documentId: string;
  title: string;
  path: string;
  excerpt: string;
}
export interface Operations {
  "vault.state": { input: undefined; output: VaultState | null };
  "vault.open": { input: { sample?: boolean }; output: VaultState | null };
  "views.read": { input: undefined; output: ViewSettings };
  "views.save": { input: ViewSettings; output: ViewSettings };
  "documents.create": {
    input: {
      title: string;
      kind: DocumentKind;
      parent?: string;
      body?: string;
      directory?: string;
    };
    output: DocumentSnapshot;
  };
  "projects.update": {
    input: ProjectSettings & { id: string; baseRevision: string };
    output: DocumentSnapshot;
  };
  "projects.create": {
    input: ProjectSettings & { parent: string };
    output: DocumentSnapshot;
  };
  "folders.create": {
    input: { parentId: string; name: string; directory?: string };
    output: VaultState;
  };
  "folders.delete": {
    input: { parentId: string; directory: string; baseRevision: string };
    output: VaultState;
  };
  "pages.create": {
    input: { projectId: string; title: string; directory?: string };
    output: DocumentSnapshot;
  };
  "pages.move": {
    input: {
      id: string;
      baseRevision: string;
      parentId: string;
      directory: string;
    };
    output: VaultState;
  };
  "sidebar.reorder": { input: SidebarReorder; output: ViewSettings };
  "documents.preserveDraft": {
    input: { title: string; raw: string };
    output: DocumentSnapshot;
  };
  "documents.save": {
    input: { id: string; baseRevision: string; raw: string };
    output: DocumentSnapshot;
  };
  "documents.metadata": {
    input: {
      id: string;
      baseRevision: string;
      values: Record<string, unknown>;
    };
    output: DocumentSnapshot;
  };
  "documents.rename": {
    input: { id: string; baseRevision: string; path: string };
    output: VaultState;
  };
  "documents.trash": {
    input: { id: string; baseRevision: string };
    output: VaultState;
  };
  "documents.reveal": { input: { id?: string; path?: string }; output: void };
  "attachments.add": {
    input: { name?: string; data?: string };
    output: string | null;
  };
  "attachments.open": { input: { path: string }; output: void };
  "tasks.toggle": {
    input: {
      documentId: string;
      taskId: string;
      baseRevision: string;
      done: boolean;
    };
    output: DocumentSnapshot;
  };
  "tasks.create": {
    input: {
      title: string;
      documentId?: string;
      areaId?: string;
      status?: WorkStatus;
    };
    output: DocumentSnapshot;
  };
  "tasks.update": {
    input: {
      documentId: string;
      taskId: string;
      baseRevision: string;
      status?: WorkStatus;
      projectId?: string | null;
    };
    output: DocumentSnapshot;
  };
  "tasks.move": {
    input: {
      documentId: string;
      taskId: string;
      beforeTaskId: string;
      baseRevision: string;
    };
    output: DocumentSnapshot;
  };
  search: { input: { query: string }; output: SearchResult[] };
  "changes.apply": { input: ChangeSet; output: VaultState };
  "history.list": { input: undefined; output: HistoryEntry[] };
  "history.undo": { input: { id: string }; output: VaultState };
  "providers.list": { input: undefined; output: ProviderHealth[] };
  "providers.configure": {
    input: { provider: ProviderId; path: string };
    output: ProviderHealth;
  };
  "providers.connect": {
    input: { provider: ProviderId };
    output: { message: string; url?: string };
  };
  "providers.test": { input: { provider: ProviderId }; output: ProviderHealth };
  "ai.start": { input: AIRequest; output: AIResult };
  "ai.cancel": { input: undefined; output: void };
  "sync.status": { input: undefined; output: SyncStatus };
  "sync.settings": {
    input: undefined;
    output: Omit<SyncSettings, "recoveryKey"> | null;
  };
  "sync.adopt": { input: undefined; output: void };
  "sync.configure": {
    input: SyncSettings;
    output: { recoveryKey?: string; vaultId?: string; message: string };
  };
  "sync.sendCode": { input: { email: string }; output: void };
  "sync.verifyCode": {
    input: { email: string; code: string };
    output: { recoveryKey?: string; vaultId?: string; message: string };
  };
  "sync.run": { input: undefined; output: SyncStatus };
  "sync.disconnect": { input: undefined; output: SyncStatus };
  "sync.devices": {
    input: undefined;
    output: { id: string; name: string; current: boolean; revoked: boolean }[];
  };
  "sync.revoke": { input: { id: string }; output: void };
}
export type Operation = keyof Operations;
export interface FableAPI {
  request<K extends Operation>(
    operation: K,
    args: Operations[K]["input"],
  ): Promise<Operations[K]["output"]>;
  subscribe(listener: (event: AppEvent) => void): () => void;
  beforeClose?(save: () => Promise<boolean>): () => void;
  openExternal?(url: string): Promise<void>;
  copyText?(text: string): Promise<void>;
  platform: string;
}
export class FableError extends Error {
  constructor(
    public code:
      | "STALE_REVISION"
      | "INVALID_METADATA"
      | "FILESYSTEM"
      | "AUTH"
      | "QUOTA"
      | "UNSUPPORTED"
      | "CONFLICT"
      | "VALIDATION",
    message: string,
  ) {
    super(message);
    this.name = "FableError";
  }
}
