import { it, expect } from "vitest";
import { readEnvironment } from "../../apps/cms/src/environment";
it("fails closed for absent secrets, unsafe database names and explicit TLS disablement without leaking inputs", () => {
  const secret = "sensitive-canary-".repeat(3);
  for (const input of [
    {},
    {
      DATABASE_URI: "mongodb://user:private-password@localhost/production",
      PAYLOAD_SECRET: secret,
    },
    {
      DATABASE_URI: "mongodb://localhost/asoball_blog_test?tls=false",
      PAYLOAD_SECRET: secret,
    },
  ]) {
    expect(() => readEnvironment(input)).toThrow("Configure DATABASE_URI");
    try {
      readEnvironment(input);
    } catch (error) {
      expect(String(error)).not.toContain(secret);
      expect(String(error)).not.toContain("private-password");
    }
  }
  expect(
    readEnvironment({
      DATABASE_URI: "mongodb://127.0.0.1/asoball_blog_dev",
      PAYLOAD_SECRET: secret,
    }).PAYLOAD_SECRET,
  ).toBe(secret);
});
