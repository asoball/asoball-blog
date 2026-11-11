import { spawnSync } from "node:child_process";
import { it, expect } from "vitest";
function run(script: string) {
  return spawnSync(process.execPath, ["--import", "tsx", script], {
    encoding: "utf8",
    timeout: 15000,
    env: {
      ...process.env,
      CMS_ENV_FILE: "",
      DEPLOYMENT_ENV: "cloud",
      DATABASE_URI:
        "mongodb+srv://fixture:private-password@offline.mongodb.net/blog_production?tls=true",
      PAYLOAD_SECRET: "offline-fixture-secret-12345678901234567890",
      MEDIA_STORAGE: "gcs",
      GCS_BUCKET: "offline-fixture-media",
      CMS_URL: "https://cms.example.com",
      BOOTSTRAP_EMAIL: "",
    },
  });
}
it("checks cloud settings offline without printing credentials", () => {
  const result = run("scripts/check-config.ts");
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    valid: true,
    environment: "cloud",
    mediaStorage: "gcs",
  });
  expect(result.stdout).not.toContain("private-password");
  expect(result.stdout).not.toContain("mongodb");
});
it("requires an explicit cloud administrator email before connecting", () => {
  const result = run("scripts/bootstrap.ts");
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("BOOTSTRAP_EMAIL");
  expect(result.stderr).not.toContain("private-password");
});
it.each(["scripts/publisher.ts", "scripts/rollback.ts", "scripts/backup.ts"])(
  "blocks local-only maintenance against cloud configuration: %s",
  (script) => {
    const result = run(script);
    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toContain("private-password");
    expect(result.stderr).toMatch(
      /local-only|Local rollback|local Docker only/,
    );
  },
);
