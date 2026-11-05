import { randomUUID } from "node:crypto";
import { PublisherQueue } from "@asoball/publishing/queue";
process.loadEnvFile("apps/cms/.env");
const queue = await new PublisherQueue(process.env.DATABASE_URI!).open();
try {
  const user = await queue.db.collection("users").findOne({ role: "admin" });
  if (!user) throw new Error("Administrator required.");
  const job = await queue.request(
    { id: String(user._id), role: "admin" },
    `manual:${randomUUID()}`,
  );
  console.log(`Queued local release ${job!.seq}.`);
} finally {
  await queue.close();
}
