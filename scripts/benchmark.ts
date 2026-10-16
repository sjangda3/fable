import { promises as fs } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { VaultService } from "../packages/vault/index.ts";
import { patchMetadata } from "../packages/markdown/index.ts";
import { taskGroups } from "../packages/domain/index.ts";
const root = path.resolve(".fable-dev/benchmark/vault"),
  cache = path.resolve(".fable-dev/benchmark/cache");
await fs.mkdir(root, { recursive: true });
if (
  (await fs.readdir(root)).filter((p) => p.endsWith(".md")).length !== 10000
) {
  for (let offset = 0; offset < 10000; offset += 100)
    await Promise.all(
      Array.from({ length: 100 }, async (_, i) => {
        const n = offset + i,
          id = randomUUID(),
          body = `# Research note ${n}\n\nA useful reference about design, writing, and offline productivity.\n\n${Array.from({ length: 5 }, (_, t) => `- [ ] Task ${t + 1}: investigate topic ${n} <!-- fable:task {"id":"${randomUUID()}"} -->`).join("\n")}\n`;
        await fs.writeFile(
          path.join(root, `Note ${n}.md`),
          patchMetadata(body, { schema: 1, id, kind: "note" }),
        );
      }),
    );
}
const vault = new VaultService(cache);
let now = performance.now();
await vault.open(root, false);
const first = performance.now() - now;
await vault.close();
now = performance.now();
await vault.open(root, false);
const warm = performance.now() - now;
const samples: number[] = [];
for (let i = 0; i < 200; i++) {
  now = performance.now();
  await vault.search(i % 10 === 0 ? "productivity" : `topic ${i * 47}`);
  samples.push(performance.now() - now);
}
samples.sort((a, b) => a - b);
now = performance.now();
const groups = taskGroups(vault.documents);
const grouping = performance.now() - now;
const result = {
  notes: vault.documents.length,
  tasks: groups.reduce((n, g) => n + g.tasks.length, 0),
  firstOpenMs: Math.round(first),
  warmOpenMs: Math.round(warm),
  searchP95Ms: +samples[189].toFixed(2),
  taskGroupingMs: +grouping.toFixed(2),
  platform: process.platform,
  arch: process.arch,
  node: process.version,
};
console.log(JSON.stringify(result, null, 2));
await fs.mkdir("artifacts", { recursive: true });
await fs.writeFile("artifacts/benchmark.json", JSON.stringify(result, null, 2));
await vault.close();
