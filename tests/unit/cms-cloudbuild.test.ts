import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
const require = createRequire(import.meta.url);
const { parse } = require("yaml") as {
  parse: (source: string) => {
    steps: { id: string; name: string; args: string[] }[];
    substitutions: Record<string, string>;
  };
};
const config = parse(
  readFileSync("infrastructure/cloudbuild/cms.yaml", "utf8"),
);
const image = "asia-east1-docker.pkg.dev/test-project/test-cms/cms";
function execute(id: string, env: Record<string, string>) {
  const script = config.steps
    .find((step) => step.id === id)!
    .args.at(-1)!
    .replaceAll("$$", "$");
  const mock = `gcloud() { case "$1 $2 $3 $4" in
    'artifacts docker images describe') printf '%s\\n' "$MOCK_DIGEST" ;;
    'run services describe '*) return 0 ;;
    'run services update '*) printf 'MOCK_UPDATE %s\\n' "$*" ;;
    *) return 99 ;;
  esac; }\n`;
  return spawnSync(
    process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash",
    ["-ceu", mock + script],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        SOURCE_SHA: "a".repeat(40),
        DEPLOY_CMS: "false",
        DEPLOY_PROJECT: "test-project",
        DEPLOY_REGION: "asia-east1",
        DEPLOY_SERVICE: "test-cms",
        IMAGE_PATH: image,
        IMAGE_TAG: image + ":" + "a".repeat(40),
        MOCK_DIGEST: image + "@sha256:" + "b".repeat(64),
        ...env,
      },
    },
  );
}
describe("CMS Cloud Build contract (offline, gcloud is mocked)", () => {
  it("pins builders, builds from repo root, and defaults to image-only", () => {
    expect(config.substitutions._DEPLOY_CMS).toBe("false");
    for (const step of config.steps)
      expect(step.name).toMatch(/@sha256:[a-f0-9]{64}$/);
    expect(
      config.steps.find((step) => step.id === "build-cms")!.args.at(-1),
    ).toBe(".");
  });
  it("rejects missing commits and invalid deployment modes", () => {
    expect(
      execute("validate-trigger-input", { SOURCE_SHA: "" }).status,
    ).not.toBe(0);
    expect(
      execute("validate-trigger-input", { DEPLOY_CMS: "yes" }).status,
    ).not.toBe(0);
    expect(execute("validate-trigger-input", {}).status).toBe(0);
  });
  it("image-only mode does not update Cloud Run", () => {
    const result = execute("stage-cms-revision", {});
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toContain("MOCK_UPDATE");
  });
  it("updates an existing service by digest without routing live traffic", () => {
    const result = execute("stage-cms-revision", { DEPLOY_CMS: "true" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("MOCK_UPDATE");
    expect(result.stdout).toContain("--no-traffic");
    expect(result.stdout).toContain("--image=" + image + "@sha256:");
  });
  it("rejects an invalid or foreign image digest before updating", () => {
    for (const digest of [
      image + ":latest",
      "foreign/image@sha256:" + "b".repeat(64),
    ]) {
      const result = execute("stage-cms-revision", {
        DEPLOY_CMS: "true",
        MOCK_DIGEST: digest,
      });
      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain("MOCK_UPDATE");
    }
  });
});
