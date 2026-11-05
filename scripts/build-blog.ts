import { spawn } from "node:child_process";
import { cp } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { BuildOptions } from "@asoball/publishing/worker";
import { checkArtifacts } from "./seo-check";
export async function buildBlog({ snapshotFile, siteDir }: BuildOptions) {
  const cli = process.env.npm_execpath;
  if (!cli) throw new Error("Start the publisher through pnpm.");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [cli, "--filter", "blog", "build"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CONTENT_SNAPSHOT: snapshotFile,
        BLOG_OUT_DIR: siteDir,
        BLOG_CACHE_DIR: path.resolve(
          ".local/astro-cache",
          createHash("sha256").update(siteDir).digest("hex"),
        ),
        SITE_URL: process.env.SITE_URL || "http://127.0.0.1:4330",
        ASTRO_TELEMETRY_DISABLED: "1",
      },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("Astro build failed.")),
    );
  });
  await cp(
    path.join(path.dirname(snapshotFile), "media"),
    path.join(siteDir, "media"),
    { recursive: true },
  );
  await checkArtifacts(siteDir);
}
