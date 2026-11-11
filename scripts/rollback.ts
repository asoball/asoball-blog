import path from "node:path";
import { PublisherQueue } from "@asoball/publishing/queue";
import {
  rollback,
  recoverDeadActivationLock,
} from "../packages/publishing/src/rollback";
import { loadCmsEnvironment } from "../apps/cms/src/environment-file";
import { readEnvironment } from "../apps/cms/src/environment";
loadCmsEnvironment();
const env = readEnvironment(process.env);
if (env.DEPLOYMENT_ENV === "cloud")
  throw new Error(
    "Local rollback cannot roll back Cloud Run or Firebase. Use the cloud revision/release history.",
  );
const queue = await new PublisherQueue(env.DATABASE_URI).open();
try {
  const dataDir = path.resolve(process.env.LOCAL_DATA_DIR || ".local");
  if (process.argv[2] === "--recover-dead-lock") {
    await recoverDeadActivationLock(queue, dataDir);
    console.log("Recovered verified dead activation lock.");
  } else {
    const admin = await queue.db.collection("users").findOne({ role: "admin" });
    if (!admin) throw new Error("Administrator required.");
    const active = await rollback(queue, dataDir, process.argv[2] || "", {
      id: String(admin._id),
      role: "admin",
    });
    console.log(JSON.stringify(active));
  }
} finally {
  await queue.close();
}
