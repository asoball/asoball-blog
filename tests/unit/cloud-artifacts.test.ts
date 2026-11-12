import { it, expect } from "vitest";
import { mkdtemp, rmdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { Storage } from "@google-cloud/storage";
import {
  downloadCandidate,
  sha256,
} from "../../packages/publishing/src/cloud-artifacts";

it("rejects a wrong source or tampered candidate before accepting its content", async () => {
  const expected = {
    releaseId: "release-0000000001-f1",
    commit: "a".repeat(40),
    sourceSnapshotDigest: "b".repeat(64),
  };
  const content = Buffer.from("published");
  let manifest = {
    ...expected,
    commit: "c".repeat(40),
    files: [
      { path: "index.html", sha256: sha256(content), size: content.length },
    ],
  };
  let downloads = 0;
  const storage = {
    bucket: () => ({
      file: (name: string) => ({
        download: async () => {
          downloads++;
          return [
            name.endsWith("candidate.json")
              ? Buffer.from(JSON.stringify(manifest))
              : Buffer.from("tampered"),
          ];
        },
      }),
    }),
  } as unknown as Storage;
  const directory = await mkdtemp(path.join(os.tmpdir(), "candidate-check-"));
  try {
    await expect(
      downloadCandidate(storage, "private-candidates", expected, directory),
    ).rejects.toThrow("immutable build plan");
    expect(downloads).toBe(1);
    manifest = { ...manifest, commit: expected.commit };
    await expect(
      downloadCandidate(storage, "private-candidates", expected, directory),
    ).rejects.toThrow("checksum");
  } finally {
    await rmdir(directory);
  }
});
