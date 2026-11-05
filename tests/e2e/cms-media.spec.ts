import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
test.use({ extraHTTPHeaders: { Origin: "http://127.0.0.1:3000" } });
test("private media validates bytes, MIME and size and requires authorization", async ({
  page,
}) => {
  const request = page.request,
    base = "http://127.0.0.1:3000";
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
  const upload = await request.post(base + "/api/media", {
    multipart: {
      _payload: JSON.stringify({ alt: "本機圖片驗收 fixture" }),
      file: { name: "fixture.png", mimeType: "image/png", buffer: png },
    },
  });
  expect(upload.ok(), await upload.text()).toBeTruthy();
  const { doc } = (await upload.json()) as {
    doc: { id: string; url: string; width: number; height: number };
  };
  try {
    expect(doc.width).toBe(64);
    expect(doc.height).toBe(32);
    expect((await request.get(doc.url)).ok()).toBeTruthy();
    const anonymous = await page.context().browser()!.newContext();
    try {
      expect([401, 403, 404]).toContain(
        (await anonymous.request.get(doc.url)).status(),
      );
    } finally {
      await anonymous.close();
    }
    for (const file of [
      {
        name: "fake.png",
        mimeType: "image/png",
        buffer: Buffer.from("<script>fake image</script>"),
      },
      {
        name: "oversized.png",
        mimeType: "image/png",
        buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
      },
      {
        name: "unsupported.svg",
        mimeType: "image/svg+xml",
        buffer: Buffer.from("<svg/>"),
      },
    ]) {
      const rejected = await request.post(base + "/api/media", {
        multipart: {
          _payload: JSON.stringify({ alt: "must be rejected" }),
          file,
        },
      });
      expect([400, 413, 422]).toContain(rejected.status());
    }
  } finally {
    expect(
      (await request.delete(base + "/api/media/" + doc.id)).ok(),
    ).toBeTruthy();
  }
});
