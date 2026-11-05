import path from "node:path";
import { fileURLToPath } from "node:url";
export const sourceDir = path.dirname(fileURLToPath(import.meta.url));
export const localDataDir = path.resolve(
  process.env.LOCAL_DATA_DIR || path.resolve(sourceDir, "../../../.local"),
);
