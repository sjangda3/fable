import { build } from "esbuild";
await build({
  entryPoints: ["apps/desktop/main/index.ts"],
  outfile: ".vite/build/main.cjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  external: [
    "electron",
    "better-sqlite3",
    "@parcel/watcher",
    "@anthropic-ai/claude-agent-sdk",
    "libsodium-wrappers-sumo",
  ],
  sourcemap: true,
});
await build({
  entryPoints: ["apps/desktop/preload/index.ts"],
  outfile: ".vite/build/preload.cjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  external: ["electron"],
  sourcemap: true,
});
await import("./build-workers.ts");
