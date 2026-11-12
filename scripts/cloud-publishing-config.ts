import { z } from "zod";
import { readEnvironment } from "../apps/cms/src/environment";
export function cloudPublishingConfig(
  input: Record<string, string | undefined>,
) {
  // Job never initializes Payload and never needs its signing secret.
  const media = readEnvironment({
    ...input,
    DEPLOYMENT_ENV: "cloud",
    PAYLOAD_SECRET: "publisher-job-validates-uri-without-payload-secret",
  });
  const result = z
    .object({
      CLOUD_PROJECT_ID: z.string().regex(/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/),
      CLOUD_REGION: z.string().regex(/^[a-z]+-[a-z]+\d$/),
      CLOUD_BUILD_TRIGGER: z.string().regex(/^[a-zA-Z0-9-]+$/),
      CLOUD_SOURCE_SHA: z.string().regex(/^[a-f0-9]{40}$/),
      CLOUD_SNAPSHOT_BUCKET: z
        .string()
        .regex(/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/),
      CLOUD_CANDIDATE_BUCKET: z
        .string()
        .regex(/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/),
      FIREBASE_SITE_ID: z.string().regex(/^[-a-z0-9]+$/),
      SITE_URL: z.string().url(),
      CLOUD_PUBLISH_ENABLED: z.enum(["false", "true"]).default("false"),
    })
    .safeParse(input);
  if (!result.success)
    throw new Error(
      "Invalid cloud publisher settings; check the documented variable names.",
    );
  const config = result.data;
  if (config.SITE_URL !== `https://${config.FIREBASE_SITE_ID}.web.app`)
    throw new Error("Publisher URL must match the default Hosting site.");
  if (
    config.CLOUD_SNAPSHOT_BUCKET === config.CLOUD_CANDIDATE_BUCKET ||
    [config.CLOUD_SNAPSHOT_BUCKET, config.CLOUD_CANDIDATE_BUCKET].includes(
      media.GCS_BUCKET!,
    )
  )
    throw new Error("Use separate media, snapshot and candidate buckets.");
  return {
    ...config,
    DATABASE_URI: media.DATABASE_URI,
    GCS_BUCKET: media.GCS_BUCKET!,
  };
}
