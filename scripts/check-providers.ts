import { promises as fs } from "node:fs";
import path from "node:path";
import { VaultService } from "../packages/vault/index.ts";
import { ProviderService } from "../packages/providers/index.ts";
const data = path.resolve(".fable-dev/provider-check"),
  vault = new VaultService(path.join(data, "cache"));
await vault.open(path.join(data, "vault"), false);
const providers = new ProviderService(vault, data);
await providers.load();
const health = await providers.list();
console.log(
  JSON.stringify(
    health.map((p) => ({
      provider: p.id,
      installed: p.installed,
      version: p.version,
      authenticated: p.authenticated,
      authMode: p.authMode,
      models: p.models.length,
      message: p.message,
    })),
    null,
    2,
  ),
);
if (process.argv.includes("--inference")) {
  const note = await vault.create(
    "Connection check",
    "note",
    undefined,
    "A harmless connection check.",
  );
  for (const p of health.filter(
    (p) => p.authenticated && p.authMode === "subscription",
  )) {
    try {
      const result = await providers.start({
        provider: p.id,
        prompt:
          "Connection check: respond with the word Connected and an empty proposals array. Do not suggest or change any files.",
        documentIds: [note.id],
      });
      console.log(
        JSON.stringify({
          provider: p.id,
          inference: result.text,
          proposedChanges: result.changeSet?.changes.length ?? 0,
          transcriptSaved: !!result.conversationId,
        }),
      );
    } catch (e: any) {
      console.log(
        JSON.stringify({
          provider: p.id,
          inference: "failed",
          message: e.message,
        }),
      );
      process.exitCode = 1;
    }
  }
}
await vault.close();
