import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
test("official Payload Admin authenticates the local administrator", async ({
  page,
}) => {
  const credentials = JSON.parse(
    await readFile(".local/admin.json", "utf8"),
  ) as { email: string; password: string };
  await page.goto("http://127.0.0.1:3000/admin/login");
  await page.getByLabel("Email").fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Login", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/?$/);
  await expect(
    page.getByRole("link", { name: "Posts", exact: true }).first(),
  ).toBeVisible();
});
