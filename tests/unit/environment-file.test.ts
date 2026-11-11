import { it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, rmdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadCmsEnvironment } from "../../apps/cms/src/environment-file";
afterEach(() => vi.unstubAllEnvs());
it("does not fill injected cloud settings from a local env file", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "blog-env-test-"));
  try {
    const file = path.join(directory, "local.env");
    writeFileSync(file, "CMS_URL=http://localhost:3000\n");
    vi.stubEnv("CMS_ENV_FILE", undefined);
    vi.stubEnv("DATABASE_URI", "mongodb+srv://fixture");
    vi.stubEnv("CMS_URL", undefined);
    loadCmsEnvironment(file);
    expect(process.env.CMS_URL).toBeUndefined();
  } finally {
    rmSync(path.join(directory, "local.env"), { force: true });
    rmdirSync(directory);
  }
});
it("fails closed if an explicitly selected env file is missing", () => {
  vi.stubEnv(
    "CMS_ENV_FILE",
    path.join(os.tmpdir(), "missing-env-" + Date.now()),
  );
  expect(() => loadCmsEnvironment()).toThrow("CMS_ENV_FILE does not exist");
});
