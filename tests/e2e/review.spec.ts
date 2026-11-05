import { test, expect } from "@playwright/test";
test("first component review screenshots", async ({ page }) => {
  test.skip(
    !process.env.CAPTURE_FIRST_REVIEW,
    "First review is archived and human-approved.",
  );
  for (const width of [375, 1440])
    for (const theme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/");
      await page.getByLabel("顏色主題").selectOption(theme);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `apps/blog/tests/visual/first-review/${width}-${theme}.png`,
        fullPage: true,
      });
    }
});
