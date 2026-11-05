import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
export async function checkArtifacts(directory = "apps/blog/dist") {
  const files: string[] = [];
  async function walk(folder: string) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files.push(full);
    }
  }
  await walk(directory);
  const htmlFiles = files.filter((file) => file.endsWith(".html"));
  for (const file of htmlFiles) {
    const html = await readFile(file, "utf8");
    assert.equal(
      (html.match(/<h1(?:\s|>)/g) || []).length,
      1,
      `${file}: one H1`,
    );
    assert.match(html, /<link rel="canonical" href="https?:/);
    assert.match(html, /<meta property="og:image"/);
    assert.doesNotMatch(
      html,
      /DRAFT_CANARY|PRIVATE_PREVIEW_FIXTURE|passwordHash|"users"|"versions"/,
    );
    for (const match of html.matchAll(/(?:href|src)="(\/[^"#?]*)/g)) {
      const target = decodeURIComponent(match[1]);
      const candidate = path.join(directory, target);
      try {
        const info = await stat(candidate);
        if (info.isDirectory()) await stat(path.join(candidate, "index.html"));
      } catch {
        throw new Error(`Broken local asset/link in ${file}: ${target}`);
      }
    }
  }
  for (const name of [
    "rss.xml",
    "robots.txt",
    "sitemap-index.xml",
    "sitemap-0.xml",
    "404.html",
    "og.png",
  ])
    await stat(path.join(directory, name));
  const sitemap = await readFile(path.join(directory, "sitemap-0.xml"), "utf8");
  assert.doesNotMatch(sitemap, /categories\/empty\//);
  console.log(
    `PASS artifact scan: ${htmlFiles.length} HTML pages, canonical/OG/internal links/feeds, no private canaries.`,
  );
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/seo-check.ts"))
  await checkArtifacts(process.argv[2]);
