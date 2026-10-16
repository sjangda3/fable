import { spawn } from "node:child_process";
import electron from "electron";
const binary = process.argv[2] || String(electron),
  args = process.argv[2] ? [] : ["."];
const child = spawn(binary, args, {
  env: { ...process.env, FABLE_SMOKE: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "",
  errors = "";
child.stdout.on("data", (chunk) => {
  output += chunk;
  process.stdout.write(chunk);
});
child.stderr.on("data", (chunk) => {
  errors = (errors + chunk).slice(-5000);
});
const timer = setTimeout(() => {
  child.kill();
}, 30000);
const code = await new Promise<number | null>((resolve, reject) => {
  child.on("error", reject);
  child.on("close", resolve);
});
clearTimeout(timer);
const match = /FABLE_DESKTOP_SMOKE (.+)/.exec(output);
if (!match) throw new Error(`Desktop smoke check did not finish. ${errors}`);
const result = JSON.parse(match[1]);
if (
  code !== 0 ||
  !result.heading ||
  !result.bridge ||
  !result.state ||
  !result.sandbox ||
  !result.encryption
)
  throw new Error(
    `Desktop smoke check failed: ${JSON.stringify(result)} ${errors}`,
  );
console.log(
  "PASS: rendered desktop, isolated bridge, vault worker, and encryption",
);
