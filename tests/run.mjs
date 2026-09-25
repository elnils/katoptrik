// Startet einen lokalen Server und fuehrt den End-to-End-Test aus.
import { spawn } from "node:child_process";

const server = spawn("npx", ["http-server", "-p", "8765", "-s", "-c-1", "."], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 1500));
const test = spawn("node", ["tests/smoke.mjs"], { stdio: "inherit" });
test.on("exit", (code) => { server.kill(); process.exit(code ?? 1); });
