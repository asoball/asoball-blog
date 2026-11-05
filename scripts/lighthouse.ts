import { chromium } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const cli = require.resolve("@lhci/cli/src/cli.js");
const result = spawnSync(
  process.execPath,
  [cli, "autorun", "--config=lighthouserc.cjs"],
  {
    stdio: "inherit",
    env: { ...process.env, CHROME_PATH: chromium.executablePath() },
  },
);
process.exitCode = result.status ?? 1;
