// Startet einen lokalen Server und fuehrt die Browser-Tests aus (Smoke-Test + Auswertung).
import { spawn } from "node:child_process";

const server = spawn("npx", ["http-server", "-p", "8765", "-s", "-c-1", "."], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 1500));
const run = (f) => new Promise((res) => spawn("node", [f], { stdio: "inherit" }).on("exit", (c) => res(c ?? 1)));
const only = process.argv[2];
let code = 0;
for (const f of only ? [only] : ["tests/smoke.mjs", "tests/eval.mjs"]) code ||= await run(f);
server.kill();
process.exit(code);
