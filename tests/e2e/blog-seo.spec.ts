import { test, expect } from "@playwright/test";
test("SEO outputs and custom 404 are served from production artifacts", async ({
  page,
  request,
}) => {
  await page.goto("/posts/fixture-1/");
  await expect(page.locator("link[rel=canonical]")).toHaveAttribute(
    "href",
    /\/posts\/fixture-1\/$/,
  );
  for (const path of [
    "/rss.xml",
    "/sitemap-index.xml",
    "/sitemap-0.xml",
    "/robots.txt",
    "/og.png",
  ])
    expect((await request.get(path)).status()).toBe(200);
  expect((await page.goto("/missing-fixture-url/"))?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "找不到這個頁面",
  );
});
