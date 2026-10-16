import path from "node:path";
import { seedVault } from "../packages/vault/seed.ts";
const directory = path.resolve(process.argv[2] || ".fable-dev/personal");
await seedVault(directory);
console.log(`Example Markdown vault: ${directory}`);
