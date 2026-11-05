import { z } from "zod";

export function readEnvironment(input: Record<string, unknown>) {
  const result = z
    .object({
      DATABASE_URI: z.string().refine((value) => {
        try {
          const uri = new URL(value);
          return (
            ["mongodb:", "mongodb+srv:"].includes(uri.protocol) &&
            /^\/asoball_blog_(dev|test|restore|docker)$/.test(uri.pathname) &&
            !["false", "0"].includes(uri.searchParams.get("tls") ?? "") &&
            !["false", "0"].includes(uri.searchParams.get("ssl") ?? "")
          );
        } catch {
          return false;
        }
      }),
      PAYLOAD_SECRET: z
        .string()
        .min(32)
        .refine((value) => !value.includes("<")),
    })
    .safeParse(input);
  // Never include Zod input or connection strings in an error or log.
  if (!result.success)
    throw new Error(
      "Configure DATABASE_URI (dedicated PoC DB, TLS enabled) and PAYLOAD_SECRET (32+ characters).",
    );
  return result.data;
}
