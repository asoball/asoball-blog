import { mongooseAdapter } from "@payloadcms/db-mongodb";
import {
  lexicalEditor,
  HeadingFeature,
  BlocksFeature,
} from "@payloadcms/richtext-lexical";
import { buildConfig, type SharpDependency } from "payload";
import sharp from "sharp";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readEnvironment } from "./environment";
import {
  Users,
  Posts,
  Categories,
  Tags,
  Media,
  Deployments,
} from "./collections";
import {
  initializePublisher,
  requestPublishing,
  publishingStatus,
} from "./publishing-hooks";
import path from "node:path";
import { mediaStoragePlugin } from "./storage";
const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(sourceDir, "../.env");
if (existsSync(envPath)) process.loadEnvFile(envPath);
const env = readEnvironment(process.env);
// Sharp 0.35 accepts byte buffers; adapt Payload's older ArrayBuffer/view contract.
const payloadSharp: SharpDependency = (input, options) => {
  const bytes =
    input instanceof ArrayBuffer
      ? Buffer.from(input)
      : ArrayBuffer.isView(input)
        ? Buffer.from(input.buffer, input.byteOffset, input.byteLength)
        : input;
  return sharp(bytes, options);
};
export default buildConfig({
  secret: env.PAYLOAD_SECRET,
  sharp: payloadSharp,
  serverURL: process.env.CMS_URL || "http://127.0.0.1:3000",
  admin: { user: "users", importMap: { baseDir: sourceDir } },
  collections: [Users, Posts, Categories, Tags, Media, Deployments],
  onInit: initializePublisher,
  plugins: mediaStoragePlugin(
    process.env.MEDIA_STORAGE || "local",
    process.env.GCS_BUCKET,
  ),
  editor: lexicalEditor({
    features: ({ defaultFeatures }) => [
      ...defaultFeatures.filter((feature) => feature.key !== "heading"),
      HeadingFeature({ enabledHeadingSizes: ["h2", "h3"] }),
      BlocksFeature({
        blocks: [
          {
            slug: "code",
            fields: [
              {
                name: "language",
                type: "select",
                options: [
                  "typescript",
                  "javascript",
                  "json",
                  "bash",
                  "css",
                  "html",
                  "text",
                ],
                defaultValue: "typescript",
                required: true,
              },
              { name: "code", type: "textarea", required: true },
            ],
          },
        ],
      }),
    ],
  }),
  upload: { limits: { fileSize: 5 * 1024 * 1024 }, abortOnLimit: true },
  db: mongooseAdapter({
    url: env.DATABASE_URI,
    ensureIndexes: true,
    connectOptions: {
      maxPoolSize: 5,
      minPoolSize: 0,
      serverSelectionTimeoutMS: 10000,
    },
  }),
  typescript: { outputFile: path.join(sourceDir, "payload-types.ts") },
  endpoints: [
    { path: "/publishing/request", method: "post", handler: requestPublishing },
    {
      path: "/publishing/:releaseId",
      method: "get",
      handler: publishingStatus,
    },
    {
      path: "/health",
      method: "get",
      handler: () => Response.json({ status: "ok" }),
    },
  ],
});
