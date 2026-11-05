import { gcsStorage } from "@payloadcms/storage-gcs";
export function mediaStoragePlugin(driver: string, bucket?: string) {
  if (driver === "local") return [];
  if (driver !== "gcs" || !bucket)
    throw new Error("GCS storage requires MEDIA_STORAGE=gcs and GCS_BUCKET.");
  return [
    gcsStorage({
      bucket,
      options: {},
      acl: "Private",
      alwaysInsertFields: true,
      collections: { media: true },
    }),
  ];
}
