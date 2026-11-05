import { test, expect } from "@playwright/test";
test("article TOC anchors, code copy and clipboard fallback", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/posts/fixture-1/");
  await expect(page.locator(".toc")).not.toHaveAttribute("open");
  await page.locator(".toc summary").click();
  const anchors = page.locator(".toc a");
  expect(await anchors.count()).toBe(3);
  await anchors.last().click();
  await page.waitForTimeout(100);
  const position = await page
    .locator("h2[id]")
    .last()
    .evaluate((el) => el.getBoundingClientRect().top);
  expect(position).toBeGreaterThanOrEqual(64);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "複製程式碼" }).click();
  await expect(page.getByRole("status")).toHaveText("已複製");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "const snapshot",
  );
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
  });
  await page.getByRole("button", { name: "複製程式碼" }).click();
  await expect(page.getByRole("status")).toContainText("已選取");
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(".toc")).toHaveAttribute("open", "");
  await page.goto("/posts/fixture-12/");
  await expect(page.locator(".toc")).toHaveCount(0);
});
test("article content and highlighted code remain readable without JavaScript", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:4322/posts/fixture-1/");
    await expect(page.locator("pre")).toContainText("const snapshot");
    await expect(page.locator(".copy-code")).toBeHidden();
    await expect(page.locator("h1")).toBeVisible();
  } finally {
    await context.close();
  }
});
