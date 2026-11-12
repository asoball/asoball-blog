import { it, expect } from "vitest";
import { mkdtemp, writeFile, rm, rmdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import {
  candidateSchema,
  sha256,
} from "../../packages/publishing/src/cloud-artifacts";
import {
  hostingApiConfig,
  stageFirebaseVersion,
  releaseFirebaseVersion,
  type ApiTransport,
} from "../../packages/publishing/src/firebase";
import { cloudPublishingConfig } from "../../scripts/cloud-publishing-config";

it("stages gzip hashes, preserves Hosting headers, finalizes without releasing", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "firebase-stage-"));
  try {
    await writeFile(
      path.join(directory, "index.html"),
      "<h1>Published only</h1>",
    );
    const calls: string[] = [],
      uploads: Buffer[] = [];
    const version = "sites/test-site/versions/v1";
    const transport: ApiTransport = {
      request: async (request) => {
        calls.push(request.url);
        if (request.url.endsWith("/versions"))
          return { data: { name: version } };
        if (request.url.endsWith(":populateFiles")) {
          const files = (request.data as { files: Record<string, string> })
            .files;
          expect(Object.keys(files)).toEqual(["/index.html"]);
          return {
            data: {
              uploadUrl: `https://upload-firebasehosting.googleapis.com/upload/${version}/files`,
              uploadRequiredHashes: Object.values(files),
            },
          };
        }
        if (request.url.includes("upload-firebasehosting")) {
          const data = request.data as Buffer;
          expect(request.url.endsWith(sha256(data))).toBe(true);
          uploads.push(data);
          return { data: {} };
        }
        return { data: { name: version, status: "FINALIZED" } };
      },
    };
    expect(
      await stageFirebaseVersion("test-site", directory, {}, transport),
    ).toBe(version);
    expect(gunzipSync(uploads[0]).toString()).toContain("Published only");
    expect(calls.some((url) => url.includes("/releases"))).toBe(false);
    expect(
      hostingApiConfig({
        headers: [
          {
            source: "**",
            headers: [{ key: "X-Content-Type-Options", value: "nosniff" }],
          },
        ],
      }),
    ).toEqual({
      headers: [
        { glob: "**", headers: { "X-Content-Type-Options": "nosniff" } },
      ],
    });
  } finally {
    await rm(path.join(directory, "index.html"));
    await rmdir(directory);
  }
});
it("rejects traversal, duplicate paths, missing homepage and oversized candidate", () => {
  const valid = {
    releaseId: "release-0000000001-f1",
    commit: "a".repeat(40),
    sourceSnapshotDigest: "b".repeat(64),
    files: [{ path: "index.html", sha256: "c".repeat(64), size: 1 }],
  };
  expect(candidateSchema.safeParse(valid).success).toBe(true);
  for (const name of [
    "../secret",
    "/index.html",
    "a/../../secret",
    ".env",
    "a\\secret",
  ])
    expect(
      candidateSchema.safeParse({
        ...valid,
        files: [{ ...valid.files[0], path: name }],
      }).success,
    ).toBe(false);
  expect(
    candidateSchema.safeParse({
      ...valid,
      files: [...valid.files, ...valid.files],
    }).success,
  ).toBe(false);
  expect(
    candidateSchema.safeParse({
      ...valid,
      files: [{ ...valid.files[0], size: 60 * 1024 * 1024 }],
    }).success,
  ).toBe(false);
});
it("rejects untrusted upload destinations without sending content", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "firebase-host-"));
  try {
    await writeFile(path.join(directory, "index.html"), "safe");
    let requests = 0;
    await expect(
      stageFirebaseVersion(
        "test-site",
        directory,
        {},
        {
          request: async () => {
            requests++;
            return {
              data:
                requests === 1
                  ? { name: "sites/test-site/versions/v1" }
                  : {
                      uploadUrl: "https://evil.example/upload",
                      uploadRequiredHashes: [],
                    },
            };
          },
        },
      ),
    ).rejects.toThrow("Unexpected Firebase upload");
    expect(requests).toBe(2);
  } finally {
    await rm(path.join(directory, "index.html"));
    await rmdir(directory);
  }
});
it("does not retry an ambiguous activation POST", async () => {
  let requests = 0;
  await expect(
    releaseFirebaseVersion(
      "test-site",
      "sites/test-site/versions/v1",
      "seq=1",
      {
        request: async () => {
          requests++;
          throw new Error("timeout");
        },
      },
    ),
  ).rejects.toThrow("timeout");
  expect(requests).toBe(1);
});
it("cloud publisher defaults disabled, rejects mismatched site and shared buckets", () => {
  const env = {
    DATABASE_URI:
      "mongodb+srv://user:password@cluster.mongodb.net/blog?tls=true",
    MEDIA_STORAGE: "gcs",
    GCS_BUCKET: "private-media",
    CLOUD_PROJECT_ID: "asoball",
    CLOUD_REGION: "asia-east1",
    CLOUD_BUILD_TRIGGER: "trigger",
    CLOUD_SOURCE_SHA: "a".repeat(40),
    CLOUD_SNAPSHOT_BUCKET: "private-snapshots",
    CLOUD_CANDIDATE_BUCKET: "private-candidates",
    FIREBASE_SITE_ID: "asoball",
    SITE_URL: "https://asoball.web.app",
  };
  expect(cloudPublishingConfig(env).CLOUD_PUBLISH_ENABLED).toBe("false");
  expect(() =>
    cloudPublishingConfig({ ...env, SITE_URL: "https://other.web.app" }),
  ).toThrow();
  expect(() =>
    cloudPublishingConfig({ ...env, CLOUD_CANDIDATE_BUCKET: env.GCS_BUCKET }),
  ).toThrow();
  expect(() =>
    cloudPublishingConfig({ ...env, CLOUD_SOURCE_SHA: "main" }),
  ).toThrow();
});
