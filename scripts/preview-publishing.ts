import { spawn } from "node:child_process";
const cli = process.env.npm_execpath;
if (!cli) throw new Error("Run through pnpm.");
const children = ["publishing:worker", "preview:release"].map((script) =>
  spawn(process.execPath, [cli, script], {
    stdio: "inherit",
    env: process.env,
  }),
);
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children) {
  child.on("error", () => {
    process.exitCode = 1;
    stop();
  });
  child.on("exit", (code) => {
    if (!stopping) {
      process.exitCode = code || 1;
      stop();
    }
  });
}
