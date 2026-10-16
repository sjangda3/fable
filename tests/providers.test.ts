import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
const mock = vi.hoisted(() => ({
  mode: "proposal",
  sent: [] as any[],
  children: [] as any[],
  environments: [] as any[],
}));
vi.mock("node:child_process", () => ({
  execFile(_binary: string, _args: string[], _options: any, done: any) {
    done(null, "codex-cli 0.162.1");
  },
  spawn(_binary: string, _args: string[], options: any) {
    const child = new EventEmitter() as any;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    mock.children.push(child);
    mock.environments.push(options.env);
    const emit = (message: any) =>
      child.stdout.write(JSON.stringify(message) + "\n");
    child.stdin = new Writable({
      write(chunk, _encoding, done) {
        const message = JSON.parse(String(chunk));
        mock.sent.push(message);
        if (message.method === "initialize")
          emit({ id: message.id, result: {} });
        if (message.method === "account/read")
          emit({
            id: message.id,
            result: {
              account: { type: mock.mode === "api" ? "apiKey" : "chatgpt" },
            },
          });
        if (message.method === "model/list")
          emit({
            id: message.id,
            result: {
              data: [{ id: "test", model: "test", displayName: "Test" }],
            },
          });
        if (message.method === "thread/start")
          emit({ id: message.id, result: { thread: { id: "thread" } } });
        if (message.method === "turn/start") {
          emit({ id: message.id, result: { turn: { id: "turn" } } });
          const prompt = message.params.input[0].text,
            documents = JSON.parse(
              /SELECTED DOCUMENTS:\n([\s\S]*?)\n\nUSER REQUEST:/.exec(
                prompt,
              )![1],
            );
          setImmediate(() => {
            if (mock.mode === "wait") return;
            if (mock.mode === "quota") {
              emit({
                method: "turn/completed",
                params: {
                  threadId: "thread",
                  turn: {
                    status: "failed",
                    error: { message: "Usage limit reached" },
                  },
                },
              });
              return;
            }
            const doc = documents[0],
              proposals =
                mock.mode === "malformed"
                  ? [
                      {
                        documentId: "unselected",
                        baseRevision: doc.baseRevision,
                        content: "changed",
                      },
                    ]
                  : [
                      {
                        documentId: doc.documentId,
                        baseRevision: doc.baseRevision,
                        content: doc.content + "\nProposed addition\n",
                      },
                    ];
            emit({
              id: 900,
              method: "item/commandExecution/requestApproval",
              params: { command: "disallowed" },
            });
            emit({
              method: "item/agentMessage/delta",
              params: {
                threadId: "thread",
                delta: JSON.stringify({
                  message: "A proposed edit.",
                  proposals,
                }),
              },
            });
            emit({
              method: "turn/completed",
              params: { threadId: "thread", turn: { status: "completed" } },
            });
          });
        }
        done();
      },
    });
    child.kill = () => {
      setImmediate(() => child.emit("exit", 0));
      return true;
    };
    return child;
  },
}));
import { ProviderService } from "../packages/providers/index.ts";
import { VaultService } from "../packages/vault/index.ts";
let directory: string, vault: VaultService, providers: ProviderService;
beforeEach(async () => {
  mock.mode = "proposal";
  mock.sent = [];
  mock.children = [];
  mock.environments = [];
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "fable-provider-"));
  vault = new VaultService(path.join(directory, "cache"));
  await vault.open(path.join(directory, "vault"), false);
  providers = new ProviderService(vault, directory);
  await providers.configure("codex", process.execPath);
});
afterEach(async () => {
  providers.cancel();
  await vault.close();
  await fs.rm(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
describe("provider proposals stay behind the review boundary", () => {
  it("saves a proposal as Markdown without changing the selected note or allowing tools", async () => {
    vi.stubEnv("OPENAI_API_KEY", "must-not-reach-child");
    const area = await vault.create("Personal", "area"),
      project = await vault.create("Research", "project", area.id);
    const d = await vault.create(
      "Selected",
      "note",
      project.id,
      "Original text",
    );
    const result = await providers.start({
      provider: "codex",
      prompt: "Suggest one addition",
      documentIds: [d.id],
    });
    expect(vault.document(d.id).raw).toBe(d.raw);
    expect(result.changeSet?.changes).toHaveLength(1);
    expect(vault.document(result.conversationId).kind).toBe("conversation");
    expect(vault.document(result.conversationId).metadata.parent).toBe(
      project.id,
    );
    expect(mock.environments.at(-1).OPENAI_API_KEY).toBeUndefined();
    expect(mock.sent.find((m) => m.id === 900).error).toBeTruthy();
    await vault.apply(result.changeSet!);
    expect(vault.document(d.id).raw).toContain("Proposed addition");
    await vault.undo(result.changeSet!.id);
    expect(vault.document(d.id).raw).toBe(d.raw);
  });
  it("rejects a proposal outside the explicitly selected documents", async () => {
    mock.mode = "malformed";
    const d = await vault.create("Selected", "note");
    await expect(
      providers.start({
        provider: "codex",
        prompt: "Edit",
        documentIds: [d.id],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(vault.document(d.id).raw).toBe(d.raw);
    expect(
      vault.documents.find((d) => d.kind === "conversation")?.raw,
    ).toContain("Connection error");
  });
  it("does not silently use API-key authentication", async () => {
    mock.mode = "api";
    const d = await vault.create("Selected", "note");
    await expect(
      providers.start({
        provider: "codex",
        prompt: "Edit",
        documentIds: [d.id],
      }),
    ).rejects.toMatchObject({ code: "AUTH" });
    expect(mock.sent.some((m) => m.method === "turn/start")).toBe(false);
  });
  it("distinguishes quota failures and preserves the prompt", async () => {
    mock.mode = "quota";
    const d = await vault.create("Selected", "note");
    await expect(
      providers.start({
        provider: "codex",
        prompt: "A prompt to preserve",
        documentIds: [d.id],
      }),
    ).rejects.toMatchObject({ code: "QUOTA" });
    expect(
      vault.documents.find((d) => d.kind === "conversation")?.raw,
    ).toContain("A prompt to preserve");
  });
  it("cancels an interrupted stream without leaving a source edit", async () => {
    mock.mode = "wait";
    const d = await vault.create("Selected", "note");
    const running = providers.start({
      provider: "codex",
      prompt: "Stop this",
      documentIds: [d.id],
    });
    await vi.waitFor(() =>
      expect(mock.sent.some((m) => m.method === "turn/start")).toBe(true),
    );
    providers.cancel();
    await expect(running).rejects.toThrow(/stopp/i);
    expect(vault.document(d.id).raw).toBe(d.raw);
    expect(
      vault.documents.find((d) => d.kind === "conversation")?.raw,
    ).toContain("## Stopped");
  });
});
