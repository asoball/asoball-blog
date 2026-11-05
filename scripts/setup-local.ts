import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
await mkdir(".local", { recursive: true });
if (!existsSync(".local/backup.key"))
  await writeFile(".local/backup.key", randomBytes(32).toString("hex"), {
    flag: "wx",
    mode: 0o600,
  });
if (!existsSync("apps/cms/.env")) {
  await writeFile(
    "apps/cms/.env",
    `DATABASE_URI=mongodb://127.0.0.1:27017/asoball_blog_dev?replicaSet=rs0&directConnection=true\nPAYLOAD_SECRET=${randomBytes(48).toString("hex")}\nCMS_URL=http://127.0.0.1:3000\n`,
    { flag: "wx" },
  );
}
console.log(
  "Local environment ready. Secrets stored only in ignored apps/cms/.env.",
);
