import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("shared components support keyboard, theme persistence and axe", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  const menu = page.locator("#mobile-nav summary");
  await menu.focus();
  await page.keyboard.press("Enter");
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeFocused();
  await page.getByLabel("顏色主題").selectOption("dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    ),
  ).toEqual([]);
  await page.getByLabel("顏色主題").selectOption("light");
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    ),
  ).toEqual([]);
});
test("without JavaScript the theme follows the system and native navigation remains usable", async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    colorScheme: "dark",
    viewport: { width: 375, height: 812 },
  });
  try {
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:4322/");
    expect(
      await page.locator("body").evaluate((el) => getComputedStyle(el).color),
    ).toBe("rgb(241, 245, 249)");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.locator("#mobile-nav summary").click();
    await expect(
      page.getByRole("navigation", { name: "手機導覽" }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
