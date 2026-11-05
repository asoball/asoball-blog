import { it, expect } from "vitest";
import {
  submitBuildCandidate,
  promoteFirebaseVersion,
  type CloudPlan,
} from "../../packages/publishing/src/cloud";
const plan: CloudPlan = {
  projectId: "test-project",
  region: "asia-east1",
  triggerId: "test-trigger",
  commitSha: "a".repeat(40),
  releaseId: "release-0000000001-f1",
  snapshotUri: "gs://test-bucket/release-0000000001-f1/snapshot.json",
  snapshotDigest: "b".repeat(64),
  candidateBucket: "test-candidates",
  siteUrl: "https://test.example",
  seq: 1,
  fence: 1,
};
it("cloud candidate requires immutable inputs and an active lease", async () => {
  const requests: unknown[] = [];
  const transport = {
    request: async (options: unknown) => {
      requests.push(options);
      return { data: { name: "build-operation" } };
    },
  };
  await expect(
    submitBuildCandidate(plan, transport, {
      enabled: false,
      ownsLease: async () => true,
    }),
  ).rejects.toThrow();
  await expect(
    submitBuildCandidate({ ...plan, commitSha: "main" }, transport, {
      enabled: true,
      ownsLease: async () => true,
    }),
  ).rejects.toThrow();
  await expect(
    submitBuildCandidate(plan, transport, {
      enabled: true,
      ownsLease: async () => false,
    }),
  ).rejects.toThrow();
  expect(requests).toHaveLength(0);
  await submitBuildCandidate(plan, transport, {
    enabled: true,
    ownsLease: async () => true,
  });
  expect(requests).toHaveLength(1);
});
it("unknown remote activation outcomes leave the durable permit pending", async () => {
  let completed = false;
  await expect(
    promoteFirebaseVersion(
      {
        site: "test-site",
        version: "sites/test-site/versions/test-version",
        seq: 1,
        fence: 1,
        enabled: true,
      },
      {
        request: async () => {
          throw new Error("connection lost");
        },
      },
      {
        begin: async () => true,
        complete: async () => {
          completed = true;
        },
      },
    ),
  ).rejects.toThrow("connection lost");
  expect(completed).toBe(false);
});
