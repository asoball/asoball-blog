import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Storage } from "@google-cloud/storage";
import { z } from "zod";

export const sha256 = (data: Buffer) =>
  createHash("sha256").update(data).digest("hex");
const filePath = z
  .string()
  .max(500)
  .refine((value) =>
    value
      .split("/")
      .every(
        (part) =>
          /^[a-zA-Z0-9_@.-]+$/.test(part) &&
          part !== "." &&
          part !== ".." &&
          !part.startsWith("."),
      ),
  );
export const candidateSchema = z
  .object({
    releaseId: z.string().regex(/^release-\d{10}-f\d+$/),
    commit: z.string().regex(/^[a-f0-9]{40}$/),
    sourceSnapshotDigest: z.string().regex(/^[a-f0-9]{64}$/),
    files: z
      .array(
        z.object({
          path: filePath,
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
          size: z
            .number()
            .int()
            .min(0)
            .max(50 * 1024 * 1024),
        }),
      )
      .min(1)
      .max(20000),
  })
  .superRefine((value, ctx) => {
    if (
      !value.files.some((file) => file.path === "index.html") ||
      new Set(value.files.map((file) => file.path)).size !==
        value.files.length ||
      value.files.reduce((size, file) => size + file.size, 0) >
        300 * 1024 * 1024
    )
      ctx.addIssue({ code: "custom", message: "Invalid candidate files." });
  });
export type Candidate = z.infer<typeof candidateSchema>;
export async function listFiles(
  directory: string,
  prefix = "",
): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(path.join(directory, prefix), {
    withFileTypes: true,
  })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    filePath.parse(name);
    if (entry.isDirectory()) files.push(...(await listFiles(directory, name)));
    else if (entry.isFile()) files.push(name);
    else throw new Error("Symlinks and special files are forbidden.");
  }
  return files.sort();
}
export async function uploadDirectory(
  storage: Storage,
  bucket: string,
  prefix: string,
  directory: string,
) {
  for (const name of await listFiles(directory)) {
    await storage
      .bucket(bucket)
      .file(`${prefix}/${name}`)
      .save(await readFile(path.join(directory, name)), {
        resumable: false,
        preconditionOpts: { ifGenerationMatch: 0 },
      });
  }
}
export async function makeCandidate(
  directory: string,
  metadata: Omit<Candidate, "files">,
): Promise<Candidate> {
  const files = [];
  for (const name of await listFiles(directory)) {
    const data = await readFile(path.join(directory, name));
    files.push({ path: name, sha256: sha256(data), size: data.length });
  }
  return candidateSchema.parse({ ...metadata, files });
}
export async function downloadCandidate(
  storage: Storage,
  bucket: string,
  expected: Omit<Candidate, "files">,
  directory: string,
) {
  const prefix = `candidates/${expected.releaseId}`;
  const [bytes] = await storage
    .bucket(bucket)
    .file(`${prefix}/candidate.json`)
    .download();
  const candidate = candidateSchema.parse(JSON.parse(bytes.toString("utf8")));
  if (
    candidate.commit !== expected.commit ||
    candidate.releaseId !== expected.releaseId ||
    candidate.sourceSnapshotDigest !== expected.sourceSnapshotDigest
  )
    throw new Error("Candidate does not match the immutable build plan.");
  for (const file of candidate.files) {
    const [data] = await storage
      .bucket(bucket)
      .file(`${prefix}/site/${file.path}`)
      .download();
    if (data.length !== file.size || sha256(data) !== file.sha256)
      throw new Error("Candidate checksum mismatch.");
    const target = path.join(directory, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data, { flag: "wx" });
  }
  return candidate;
}
