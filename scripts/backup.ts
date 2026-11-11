import path from "node:path";
import { backupKey, backupLocal, restoreLocal } from "./backup-lib";
import { loadCmsEnvironment } from "../apps/cms/src/environment-file";
loadCmsEnvironment();
if (
  process.env.DEPLOYMENT_ENV === "cloud" ||
  process.env.K_SERVICE ||
  process.env.DATABASE_URI?.startsWith("mongodb+srv:")
)
  throw new Error(
    "This backup command supports local Docker only; it does not back up Atlas or GCS.",
  );
const [action, databaseOrFolder] = process.argv.slice(2),
  key = await backupKey();
if (action === "create") {
  const folder = await backupLocal({
    database: databaseOrFolder || "asoball_blog_dev",
    dataDir: path.resolve(process.env.LOCAL_DATA_DIR || ".local"),
    offline: process.argv.includes("--offline"),
    key,
  });
  console.log(`Encrypted backup: ${folder}`);
} else if (action === "restore") {
  if (!databaseOrFolder) throw new Error("Backup folder is required.");
  const result = await restoreLocal({
    folder: databaseOrFolder,
    destination: path.resolve(".local/restored", `restore-${Date.now()}`),
    key,
  });
  console.log(JSON.stringify(result));
} else
  throw new Error(
    "Use create <database> --offline or restore <backup-folder>.",
  );
