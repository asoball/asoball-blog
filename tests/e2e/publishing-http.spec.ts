import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
test.use({ extraHTTPHeaders: { Origin: "http://127.0.0.1:3000" } });
test("HTTP publish/unpublish reaches the database-independent release server", async ({
  page,
}) => {
  test.setTimeout(180000);
  const request = page.request,
    base = "http://127.0.0.1:3000",
    site = "http://127.0.0.1:4330";
  const credentials = JSON.parse(
    await readFile(".local/admin.json", "utf8"),
  ) as { email: string; password: string };
  expect(
    (await request.post(base + "/api/users/login", { data: credentials })).ok(),
  ).toBeTruthy();
  const slug = "http-pipeline-" + randomUUID(),
    title = "HTTP pipeline acceptance fixture";
  const content = {
    root: {
      type: "root",
      version: 1,
      direction: null,
      format: "",
      indent: 0,
      children: [
        {
          type: "block",
          version: 2,
          format: "",
          fields: {
            blockType: "code",
            language: "typescript",
            code: "const HTTPAcceptance = true;",
          },
        },
      ],
    },
  };
  const created = await request.post(base + "/api/posts", {
    data: {
      title,
      slug,
      content,
      excerpt: "Local HTTP end-to-end test.",
      _status: "draft",
    },
  });
  expect(created.ok()).toBeTruthy();
  const { doc } = (await created.json()) as { doc: { id: string } };
  let deleted = false;
  try {
    expect(
      (
        await request.patch(base + "/api/posts/" + doc.id, {
          data: { _status: "published" },
        })
      ).ok(),
    ).toBeTruthy();
    await expect
      .poll(
        async () => {
          const response = await request.get(site + "/posts/" + slug + "/");
          return (
            response.status() === 200 &&
            (await response.text()).includes("HTTPAcceptance")
          );
        },
        { timeout: 90000, intervals: [500, 1000, 2000] },
      )
      .toBe(true);
    const key = "http-dedupe-" + randomUUID();
    const first = await request.post(base + "/api/publishing/request", {
      data: { key },
    });
    const second = await request.post(base + "/api/publishing/request", {
      data: { key },
    });
    expect(first.status()).toBe(202);
    expect(second.status()).toBe(202);
    expect((await second.json()).releaseId).toBe(
      (await first.json()).releaseId,
    );
    const status = await request.get(base + "/api/publishing/latest");
    expect(status.ok()).toBeTruthy();
    expect((await status.json()).job).toBeTruthy();
    expect(
      (
        await request.patch(base + "/api/posts/" + doc.id, {
          data: { _status: "draft" },
        })
      ).ok(),
    ).toBeTruthy();
    await expect
      .poll(
        async () => (await request.get(site + "/posts/" + slug + "/")).status(),
        { timeout: 90000, intervals: [500, 1000, 2000] },
      )
      .toBe(404);
    expect(await (await request.get(site + "/rss.xml")).text()).not.toContain(
      "/posts/" + slug + "/",
    );
    expect(
      (await request.delete(base + "/api/posts/" + doc.id)).ok(),
    ).toBeTruthy();
    deleted = true;
    const anonymous = await page.context().browser()!.newContext();
    try {
      expect([401, 403]).toContain(
        (
          await anonymous.request.post(base + "/api/publishing/request", {
            data: {},
          })
        ).status(),
      );
      expect([401, 403]).toContain(
        (await anonymous.request.get(base + "/api/publishing/latest")).status(),
      );
    } finally {
      await anonymous.close();
    }
  } finally {
    if (!deleted) await request.delete(base + "/api/posts/" + doc.id);
  }
});
