import path from "node:path";
import { fileURLToPath } from "node:url";
import { withPayload } from "@payloadcms/next/withPayload";
export default withPayload({
  output: process.env.CMS_STANDALONE === "true" ? "standalone" : undefined,
  outputFileTracingRoot: path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  ),
  transpilePackages: ["@asoball/content-contract", "@asoball/publishing"],
  async headers() {
    return [
      {
        source: "/preview/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
});
