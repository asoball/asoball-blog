import { gzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { sha256, listFiles } from "./cloud-artifacts";

export interface ApiTransport {
  request(options: {
    url: string;
    method: "GET" | "POST" | "PATCH";
    data?: unknown;
    headers?: Record<string, string>;
  }): Promise<{ data: unknown }>;
}
const api = "https://firebasehosting.googleapis.com/v1beta1/";
export function hostingApiConfig(input: unknown) {
  const hosting = z
    .object({
      headers: z.array(
        z.object({
          source: z.string(),
          headers: z.array(z.object({ key: z.string(), value: z.string() })),
        }),
      ),
    })
    .parse(input);
  return {
    headers: hosting.headers.map((entry) => ({
      glob: entry.source,
      headers: Object.fromEntries(
        entry.headers.map((header) => [header.key, header.value]),
      ),
    })),
  };
}
export const releaseSchema = z.object({
  name: z.string(),
  message: z.string().optional(),
  version: z.object({ name: z.string() }),
});
export async function latestFirebaseRelease(
  site: string,
  transport: ApiTransport,
) {
  const response = await transport.request({
    url: `${api}sites/${site}/releases?pageSize=1`,
    method: "GET",
  });
  return z
    .object({ releases: z.array(releaseSchema).optional() })
    .parse(response.data).releases?.[0];
}
export async function stageFirebaseVersion(
  site: string,
  directory: string,
  config: unknown,
  transport: ApiTransport,
) {
  if (!/^[-a-z0-9]+$/.test(site)) throw new Error("Invalid Hosting site.");
  const version = z
    .object({
      name: z
        .string()
        .regex(new RegExp(`^sites/${site}/versions/[a-zA-Z0-9-]+$`)),
    })
    .parse(
      (
        await transport.request({
          url: `${api}sites/${site}/versions`,
          method: "POST",
          data: { config },
        })
      ).data,
    );
  const compressed = new Map<string, Buffer>(),
    files: Record<string, string> = {};
  for (const file of await listFiles(directory)) {
    const data = gzipSync(await readFile(path.join(directory, file)));
    const hash = sha256(data);
    files[`/${file}`] = hash;
    compressed.set(hash, data);
  }
  // Firebase populateFiles accepts at most 1000 files per request.
  const entries = Object.entries(files);
  for (let start = 0; start < entries.length; start += 1000) {
    const populated = z
      .object({
        uploadUrl: z.string().url(),
        uploadRequiredHashes: z
          .array(z.string().regex(/^[a-f0-9]{64}$/))
          .optional(),
      })
      .parse(
        (
          await transport.request({
            url: `${api}${version.name}:populateFiles`,
            method: "POST",
            data: {
              files: Object.fromEntries(entries.slice(start, start + 1000)),
            },
          })
        ).data,
      );
    const expected = `https://upload-firebasehosting.googleapis.com/upload/${version.name}/files`;
    if (populated.uploadUrl !== expected)
      throw new Error("Unexpected Firebase upload endpoint.");
    for (const hash of populated.uploadRequiredHashes || []) {
      const data = compressed.get(hash);
      if (!data) throw new Error("Firebase requested an unknown file hash.");
      await transport.request({
        url: `${expected}/${hash}`,
        method: "POST",
        data,
        headers: { "Content-Type": "application/octet-stream" },
      });
    }
  }
  const finalized = z
    .object({ name: z.literal(version.name), status: z.literal("FINALIZED") })
    .parse(
      (
        await transport.request({
          url: `${api}${version.name}?updateMask=status`,
          method: "PATCH",
          data: { status: "FINALIZED" },
        })
      ).data,
    );
  return finalized.name;
}
export async function releaseFirebaseVersion(
  site: string,
  version: string,
  message: string,
  transport: ApiTransport,
) {
  const release = releaseSchema.parse(
    (
      await transport.request({
        url: `${api}sites/${site}/releases?versionName=${encodeURIComponent(version)}`,
        method: "POST",
        data: { message },
      })
    ).data,
  );
  if (
    release.version.name !== version ||
    release.message !== message ||
    !release.name.startsWith(`sites/${site}/releases/`)
  )
    throw new Error("Unexpected Firebase release response.");
  return release;
}
