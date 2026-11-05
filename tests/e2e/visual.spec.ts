import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("FE-10/12/13/14/15: viewport, themes, screenshots, accessibility", async ({
  page,
}) => {
  test.setTimeout(180000);
  const sizes = [
    [320, 740],
    [375, 812],
    [768, 1024],
    [1024, 768],
    [1440, 900],
  ];
  for (const [width, height] of sizes)
    for (const theme of ["light", "dark"] as const) {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      for (const [name, url] of [
        ["home", "/"],
        ["article", "/posts/fixture-1/"],
        ["category", "/categories/engineering/"],
      ]) {
        await page.goto(url);
        await page.getByLabel("顏色主題").selectOption(theme);
        await expect(page.locator("h1")).toHaveCount(1);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `${name} ${width} ${theme}: overflow`,
        ).toBe(true);
        for (const image of await page.locator("img").all()) {
          await expect(image).toHaveAttribute("alt", /.+/);
          await expect(image).toHaveAttribute("width", /\d+/);
          await expect(image).toHaveAttribute("height", /\d+/);
        }
        await page.screenshot({
          path: `apps/blog/tests/visual/candidate/${name}-${width}-${theme}.png`,
          fullPage: true,
          animations: "disabled",
        });
        await expect(page).toHaveScreenshot(`${name}-${width}-${theme}.png`, {
          fullPage: true,
          animations: "disabled",
          maxDiffPixelRatio: 0.002,
        });
        if (width === 375 || width === 1440) {
          const result = await new AxeBuilder({ page }).analyze();
          expect(
            result.violations.filter(
              (v) => v.impact === "critical" || v.impact === "serious",
            ),
            `${name} ${width} ${theme}: axe`,
          ).toEqual([]);
        }
      }
    }
  await page.goto("/404.html");
  expect(
    (await new AxeBuilder({ page }).analyze()).violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    ),
  ).toEqual([]);
});
