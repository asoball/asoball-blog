import { randomBytes } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { loadCmsEnvironment } from "../apps/cms/src/environment-file";
import { readEnvironment } from "../apps/cms/src/environment";
loadCmsEnvironment();
const env = readEnvironment(process.env);
const credentialsFile =
  process.env.BOOTSTRAP_CREDENTIAL_FILE ||
  (env.DEPLOYMENT_ENV === "cloud"
    ? ".local/cloud-admin.json"
    : ".local/admin.json");
const email = z
  .email()
  .safeParse(
    process.env.BOOTSTRAP_EMAIL ||
      (env.DEPLOYMENT_ENV === "local" ? "admin@localhost.invalid" : undefined),
  );
if (!email.success)
  throw new Error(
    "Set BOOTSTRAP_EMAIL to the administrator email before cloud initialization.",
  );
const { getPayload } = await import("payload");
const { default: config } = await import("../apps/cms/src/payload.config");
const payload = await getPayload({ config });
try {
  const existing = await payload.find({
    collection: "users",
    limit: 1,
    overrideAccess: true,
    context: { bootstrap: true },
  });
  if (existing.totalDocs === 0) {
    const password = randomBytes(24).toString("base64url");
    await mkdir(path.dirname(credentialsFile), { recursive: true });
    // Reserve/write the credential file before creating the account; never overwrite it.
    const file = await open(credentialsFile, "wx", 0o600);
    try {
      await file.writeFile(
        JSON.stringify({ email: email.data, password }, null, 2),
      );
    } finally {
      await file.close();
    }
    // Trusted local CLI is the sole bootstrap path; HTTP registration is disabled.
    await payload.create({
      collection: "users",
      overrideAccess: true,
      context: { bootstrap: true },
      data: { email: email.data, password, role: "admin" },
    });
    console.log(
      `Administrator created. Credentials are in ignored ${credentialsFile}.`,
    );
  } else
    console.log(
      "Administrator already exists; no account or password changed.",
    );
} finally {
  await payload.destroy();
}
process.exit(0);
