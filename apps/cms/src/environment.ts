import { z } from "zod";
const localDatabases = new Set([
  "asoball_blog_dev",
  "asoball_blog_test",
  "asoball_blog_restore",
  "asoball_blog_docker",
]);
export function readEnvironment(input: Record<string, unknown>) {
  const mode =
    input.DEPLOYMENT_ENV ??
    (input.K_SERVICE ||
    String(input.DATABASE_URI || "").startsWith("mongodb+srv:")
      ? "cloud"
      : "local");
  const result = z
    .object({
      DEPLOYMENT_ENV: z.enum(["local", "cloud"]),
      DATABASE_URI: z.string(),
      DATABASE_NAME: z
        .string()
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/)
        .optional(),
      PAYLOAD_SECRET: z
        .string()
        .min(32)
        .refine((value) => !value.includes("<")),
      CMS_URL: z.string().optional(),
      SITE_URL: z.string().optional(),
      MEDIA_STORAGE: z
        .enum(["local", "gcs"])
        .default(mode === "cloud" ? "gcs" : "local"),
      GCS_BUCKET: z
        .string()
        .regex(/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/)
        .optional(),
    })
    .superRefine((env, ctx) => {
      const invalid = (field: string) =>
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: "Invalid configuration.",
        });
      try {
        const uri = new URL(env.DATABASE_URI),
          database = uri.pathname.slice(1);
        if (
          !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/.test(database) ||
          ["admin", "config", "local"].includes(database) ||
          (env.DATABASE_NAME && database !== env.DATABASE_NAME)
        )
          invalid("DATABASE_URI");
        for (const [key, value] of uri.searchParams) {
          const name = key.toLowerCase(),
            setting = value.toLowerCase();
          if (
            (["tls", "ssl"].includes(name) &&
              ["false", "0"].includes(setting)) ||
            ([
              "tlsinsecure",
              "tlsallowinvalidcertificates",
              "tlsallowinvalidhostnames",
            ].includes(name) &&
              ["true", "1"].includes(setting))
          )
            invalid("DATABASE_URI");
        }
        if (env.DEPLOYMENT_ENV === "local") {
          if (
            uri.protocol !== "mongodb:" ||
            !["127.0.0.1", "localhost", "mongodb", "[::1]"].includes(
              uri.hostname,
            ) ||
            !localDatabases.has(database)
          )
            invalid("DATABASE_URI");
        } else if (
          uri.protocol !== "mongodb+srv:" ||
          !uri.username ||
          !uri.password ||
          !uri.hostname.endsWith(".mongodb.net") ||
          uri.searchParams.get("directConnection") === "true"
        )
          invalid("DATABASE_URI");
      } catch {
        invalid("DATABASE_URI");
      }
      for (const key of ["CMS_URL", "SITE_URL"] as const) {
        if (!env[key]) continue;
        try {
          const url = new URL(env[key]);
          if (
            !["http:", "https:"].includes(url.protocol) ||
            url.username ||
            url.password ||
            url.search ||
            url.hash ||
            !["", "/"].includes(url.pathname) ||
            (env.DEPLOYMENT_ENV === "cloud" &&
              (url.protocol !== "https:" ||
                ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
          )
            invalid(key);
        } catch {
          invalid(key);
        }
      }
      if (env.MEDIA_STORAGE === "gcs" && !env.GCS_BUCKET) invalid("GCS_BUCKET");
      if (env.DEPLOYMENT_ENV === "cloud" && env.MEDIA_STORAGE !== "gcs")
        invalid("MEDIA_STORAGE");
      if (
        env.DEPLOYMENT_ENV === "cloud" &&
        env.PAYLOAD_SECRET.includes("build-placeholder")
      )
        invalid("PAYLOAD_SECRET");
    })
    .safeParse({ ...input, DEPLOYMENT_ENV: mode });
  if (!result.success)
    throw new Error(
      "Configure DATABASE_URI, PAYLOAD_SECRET and local/cloud storage settings. Cloud requires Atlas SRV with TLS, private GCS and HTTPS public URLs.",
    );
  return {
    ...result.data,
    CMS_URL:
      result.data.CMS_URL ??
      (mode === "local" ? "http://127.0.0.1:3000" : undefined),
  };
}
