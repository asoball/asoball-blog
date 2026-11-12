import { it, expect } from "vitest";
import {
  submitBuildCandidate,
  promoteFirebaseVersion,
  type CloudPlan,
  waitForCloudBuild,
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
it("polls the regional Build resource, verifies inputs and rejects failed/stale builds", async () => {
  const operation = {
    name: "operations/build/test-project/encoded",
    metadata: { build: { id: "build-id" } },
  };
  let status = "WORKING",
    calls = 0;
  const substitutions = {
    _SOURCE_SHA: plan.commitSha,
    _RELEASE_ID: plan.releaseId,
    _SNAPSHOT_SHA256: plan.snapshotDigest,
  };
  const transport = {
    request: async ({ url }: { url: string }) => {
      expect(url).toBe(
        "https://cloudbuild.googleapis.com/v1/projects/test-project/locations/asia-east1/builds/build-id",
      );
      calls++;
      return { data: { id: "build-id", status, substitutions } };
    },
  };
  expect(
    (
      await waitForCloudBuild(plan, operation, transport, {
        ownsLease: async () => true,
        sleep: async () => {
          status = "SUCCESS";
        },
      })
    ).id,
  ).toBe("build-id");
  expect(calls).toBe(2);
  status = "FAILURE";
  await expect(
    waitForCloudBuild(plan, operation, transport, {
      ownsLease: async () => true,
    }),
  ).rejects.toThrow("did not succeed");
  status = "SUCCESS";
  substitutions._SOURCE_SHA = "c".repeat(40);
  await expect(
    waitForCloudBuild(plan, operation, transport, {
      ownsLease: async () => true,
    }),
  ).rejects.toThrow("input mismatch");
  await expect(
    waitForCloudBuild(plan, operation, transport, {
      ownsLease: async () => false,
    }),
  ).rejects.toThrow("lease lost");
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
