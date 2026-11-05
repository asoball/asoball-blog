import path from "node:path";
import { PublisherQueue } from "@asoball/publishing/queue";
import {
  rollback,
  recoverDeadActivationLock,
} from "../packages/publishing/src/rollback";
process.loadEnvFile("apps/cms/.env");
const queue = await new PublisherQueue(process.env.DATABASE_URI!).open();
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
