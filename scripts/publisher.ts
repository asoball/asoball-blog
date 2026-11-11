import path from "node:path";
import { PublisherQueue } from "@asoball/publishing/queue";
import { runOnce, reconcilePointer } from "@asoball/publishing/worker";
import { buildBlog } from "./build-blog";
import { loadCmsEnvironment } from "../apps/cms/src/environment-file";
import { readEnvironment } from "../apps/cms/src/environment";
loadCmsEnvironment();
const env = readEnvironment(process.env);
if (env.DEPLOYMENT_ENV === "cloud")
  throw new Error(
    "The release worker is local-only. Use the cloud snapshot export and Firebase publishing procedure.",
  );
const queue = await new PublisherQueue(env.DATABASE_URI).open(),
  dataDir = path.resolve(process.env.LOCAL_DATA_DIR || ".local");
let stopped = false,
  pointerReady = false;
process.on("SIGINT", () => {
  stopped = true;
});
process.on("SIGTERM", () => {
  stopped = true;
});
try {
  do {
    const reconciled: Awaited<ReturnType<typeof reconcilePointer>> =
      pointerReady
        ? { state: "reconciled" as const }
        : await reconcilePointer(queue, dataDir);
    pointerReady = reconciled.state === "reconciled";
    const result =
      reconciled.state === "busy"
        ? reconciled
        : await runOnce(queue, {
            uri: env.DATABASE_URI,
            dataDir,
            repoRoot: process.cwd(),
            build: buildBlog,
            mediaDriver: env.MEDIA_STORAGE,
            bucket: env.GCS_BUCKET,
          });
    console.log(JSON.stringify(result));
    if (process.argv.includes("--once")) {
      if (result.state === "failed") process.exitCode = 1;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } while (!stopped);
} finally {
  await queue.close();
}
