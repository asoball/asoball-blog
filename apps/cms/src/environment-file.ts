import { existsSync } from "node:fs";
import path from "node:path";
export function loadCmsEnvironment(
  defaultFile = path.resolve("apps/cms/.env"),
) {
  const explicit = process.env.CMS_ENV_FILE;
  if (explicit) {
    if (!existsSync(explicit)) throw new Error("CMS_ENV_FILE does not exist.");
    process.loadEnvFile(explicit);
    return;
  }
  // Runtime-injected/--env-file settings must never be filled with local credentials.
  if (
    process.env.DATABASE_URI ||
    process.env.K_SERVICE ||
    process.env.DEPLOYMENT_ENV === "cloud"
  )
    return;
  if (existsSync(defaultFile)) process.loadEnvFile(defaultFile);
}
