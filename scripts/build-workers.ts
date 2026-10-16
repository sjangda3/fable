import { build } from "esbuild";
await build({
  entryPoints: ["packages/vault/index-worker.ts"],
  outfile: ".vite/build/index-worker.cjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  external: ["better-sqlite3"],
  sourcemap: true,
});
