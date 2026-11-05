import sitemap from "@astrojs/sitemap";
import { snapshot, posts } from "./src/lib/content.ts";
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  output: "static",
  outDir: process.env.BLOG_OUT_DIR || "./dist",
  cacheDir: process.env.BLOG_CACHE_DIR || "./node_modules/.astro",
  integrations: [
    sitemap({
      filter: (url) =>
        !snapshot.categories.some(
          (c) =>
            !posts.some((p) => p.category?.slug === c.slug) &&
            new URL(url).pathname === `/categories/${c.slug}/`,
        ) &&
        !snapshot.tags.some(
          (t) =>
            !posts.some((p) => p.tags.some((tag) => tag.slug === t.slug)) &&
            new URL(url).pathname === `/tags/${t.slug}/`,
        ),
    }),
  ],
  site: process.env.SITE_URL || "http://localhost:4321",
  trailingSlash: "always",
  vite: {
    plugins: [tailwindcss()],
    ...(process.env.BLOG_CACHE_DIR
      ? { cacheDir: process.env.BLOG_CACHE_DIR + "/vite" }
      : {}),
  },
  devToolbar: { enabled: false },
});
