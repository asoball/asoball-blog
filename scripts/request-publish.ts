import { randomUUID } from "node:crypto";
import { PublisherQueue } from "@asoball/publishing/queue";
import { loadCmsEnvironment } from "../apps/cms/src/environment-file";
import { readEnvironment } from "../apps/cms/src/environment";
loadCmsEnvironment();
const env = readEnvironment(process.env);
const queue = await new PublisherQueue(env.DATABASE_URI).open();
try {
  const user = await queue.db.collection("users").findOne({ role: "admin" });
  if (!user) throw new Error("Administrator required.");
  const job = await queue.request(
    { id: String(user._id), role: "admin" },
    `manual:${randomUUID()}`,
  );
  console.log(`Queued release ${job!.seq}.`);
} finally {
  await queue.close();
}
