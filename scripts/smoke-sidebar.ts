import { build } from "esbuild";
import { spawn } from "node:child_process";
import electron from "electron";

await build({
  entryPoints: ["tests/integration/sidebar-smoke.ts"],
  outfile: ".vite/build/sidebar-smoke.cjs",
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
});
const child = spawn(String(electron), [".vite/build/sidebar-smoke.cjs"], {
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "",
  errors = "";
child.stdout.on("data", (chunk) => {
  output += chunk;
  process.stdout.write(chunk);
});
child.stderr.on("data", (chunk) => {
  errors = (errors + chunk).slice(-6000);
});
const timer = setTimeout(() => child.kill(), 40000);
const code = await new Promise<number | null>((resolve, reject) => {
  child.on("error", reject);
  child.on("close", resolve);
});
clearTimeout(timer);
if (code !== 0 || !output.includes("FABLE_SIDEBAR_SMOKE PASS"))
  throw new Error(`Sidebar smoke failed. ${errors}`);
