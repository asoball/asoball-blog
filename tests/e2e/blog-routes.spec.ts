import { test, expect } from "@playwright/test";
test("static lists paginate and taxonomy pages expose empty states", async ({
  page,
}) => {
  await page.goto("/posts/");
  await expect(page.locator(".article-card")).toHaveCount(9);
  await page.getByRole("link", { name: "下一頁", exact: true }).click();
  await expect(page).toHaveURL(/\/posts\/page\/2\//);
  await expect(page.locator(".article-card")).toHaveCount(3);
  for (const path of [
    "/categories/",
    "/categories/engineering/",
    "/tags/typescript/",
    "/about/",
  ]) {
    expect((await page.goto(path))?.status()).toBe(200);
    await expect(page.locator("h1")).toHaveCount(1);
  }
  await page.goto("/categories/empty/");
  await expect(page.getByText("目前沒有文章")).toBeVisible();
  await page.goto("/posts/fixture-1/");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator(".prose")).toBeVisible();
});
