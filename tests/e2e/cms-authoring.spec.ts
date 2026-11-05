import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
test.use({ extraHTTPHeaders: { Origin: "http://127.0.0.1:3000" } });
test("authenticated editor stores a Lexical code block and previews a private draft", async ({
  page,
}) => {
  const request = page.request;
  const base = "http://127.0.0.1:3000";
  const credentials = JSON.parse(
    await readFile(".local/admin.json", "utf8"),
  ) as { email: string; password: string };
  expect(
    (await request.post(base + "/api/users/login", { data: credentials })).ok(),
  ).toBeTruthy();
  const png = await sharp({
    create: { width: 64, height: 32, channels: 3, background: "#1D4ED8" },
  })
    .png()
    .toBuffer();
  const uploaded = await request.post(base + "/api/media", {
    multipart: {
      _payload: JSON.stringify({ alt: "Private preview image" }),
      file: { name: "preview.png", mimeType: "image/png", buffer: png },
    },
  });
  expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
  const media = ((await uploaded.json()) as { doc: { id: string } }).doc;
  const content = {
    root: {
      type: "root",
      version: 1,
      direction: null,
      format: "",
      indent: 0,
      children: [
        { type: "upload", version: 3, relationTo: "media", value: media.id },
        {
          type: "block",
          version: 2,
          format: "",
          fields: {
            blockType: "code",
            language: "typescript",
            code: "const privatePreview = true;",
          },
        },
      ],
    },
  };
  const created = await request.post(base + "/api/posts", {
    data: {
      title: "PRIVATE_PREVIEW_FIXTURE",
      slug: "preview-" + randomUUID(),
      content,
      _status: "draft",
      seoTitle: "Private SEO fixture",
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { doc } = (await created.json()) as { doc: { id: string } };
  try {
    await page.goto(base + "/admin/collections/posts/" + doc.id);
    await page.locator("#field-title").fill("PRIVATE_PREVIEW_FIXTURE_EDITED");
    await page.getByRole("button", { name: /save draft/i }).click();
    await expect
      .poll(
        async () =>
          (
            (await (
              await request.get(base + "/api/posts/" + doc.id + "?draft=true")
            ).json()) as { title: string }
          ).title,
        { timeout: 15000 },
      )
      .toBe("PRIVATE_PREVIEW_FIXTURE_EDITED");
    const anonymous = await page.context().browser()!.newContext();
    try {
      const response = await anonymous.request.get(
        base + "/preview/" + doc.id,
        { maxRedirects: 0 },
      );
      expect([302, 303, 307]).toContain(response.status());
    } finally {
      await anonymous.close();
    }
    await page.goto(base + "/preview/" + doc.id);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "PRIVATE_PREVIEW_FIXTURE_EDITED",
    );
    await expect(page.locator("pre")).toContainText("privatePreview");
    await expect(
      page.getByRole("img", { name: "Private preview image" }),
    ).toBeVisible();
    expect(
      await page
        .getByRole("img", { name: "Private preview image" })
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    ).toBe(64);
    const published = await request.get(
      base + "/api/posts?where[id][equals]=" + doc.id,
    );
    expect(published.ok()).toBeTruthy();
  } finally {
    expect(
      (await request.delete(base + "/api/posts/" + doc.id)).ok(),
    ).toBeTruthy();
    expect(
      (await request.delete(base + "/api/media/" + media.id)).ok(),
    ).toBeTruthy();
  }
});
