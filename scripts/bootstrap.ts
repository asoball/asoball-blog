import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
const credentialsFile =
  process.env.BOOTSTRAP_CREDENTIAL_FILE || ".local/admin.json";
process.loadEnvFile("apps/cms/.env");
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
    const email = "admin@localhost.invalid";
    const password = randomBytes(24).toString("base64url");
    // Trusted local CLI is the sole bootstrap path; HTTP registration is disabled.
    await payload.create({
      collection: "users",
      overrideAccess: true,
      context: { bootstrap: true },
      data: { email, password, role: "admin" },
    });
    await writeFile(
      credentialsFile,
      JSON.stringify({ email, password }, null, 2),
      { flag: "wx" },
    );
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
