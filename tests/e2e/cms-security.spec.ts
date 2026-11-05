import { test, expect } from "@playwright/test";
test("anonymous HTTP requests cannot register or access private collections", async ({
  request,
}) => {
  const base = "http://127.0.0.1:3000";
  for (const path of ["/api/users", "/api/media", "/api/posts/versions"]) {
    const response = await request.get(base + path);
    expect([401, 403, 404]).toContain(response.status());
  }
  for (const path of ["/api/users", "/api/users/first-register"]) {
    const response = await request.post(base + path, {
      data: {
        email: "forbidden@example.invalid",
        password: "must-not-create-a-real-account",
        role: "admin",
      },
    });
    expect([401, 403]).toContain(response.status());
  }
  const write = await request.post(base + "/api/posts", {
    data: { title: "Denied", slug: "anonymous-denied" },
  });
  expect([401, 403]).toContain(write.status());
  const health = await request.get(base + "/api/health");
  expect(await health.json()).toEqual({ status: "ok" });
});
