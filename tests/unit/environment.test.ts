import { it, expect, describe } from "vitest";
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
const cloud = {
  DEPLOYMENT_ENV: "cloud",
  DATABASE_URI:
    "mongodb+srv://user:encoded-secret@cluster.mongodb.net/blog_production?tls=true&authSource=admin",
  PAYLOAD_SECRET: "cloud-test-secret-".repeat(3),
  GCS_BUCKET: "test-private-media",
  CMS_URL: "https://cms.example.com",
  SITE_URL: "https://blog.example.com",
};
describe("cloud environment boundary", () => {
  it("accepts a custom Atlas DB with private GCS, and cross-checks an optional DB name", () => {
    expect(
      readEnvironment({ ...cloud, DATABASE_NAME: "blog_production" }),
    ).toMatchObject({ DEPLOYMENT_ENV: "cloud", MEDIA_STORAGE: "gcs" });
    expect(() =>
      readEnvironment({ ...cloud, DATABASE_NAME: "other_database" }),
    ).toThrow();
  });
  it("detects Cloud Run/SRV without requiring a manually set deployment mode", () => {
    expect(
      readEnvironment({ ...cloud, DEPLOYMENT_ENV: undefined, K_SERVICE: "cms" })
        .DEPLOYMENT_ENV,
    ).toBe("cloud");
    expect(
      readEnvironment({ ...cloud, DEPLOYMENT_ENV: undefined }).DEPLOYMENT_ENV,
    ).toBe("cloud");
  });
  it("rejects insecure TLS, reserved databases, local storage and localhost URLs", () => {
    for (const patch of [
      {
        DATABASE_URI: cloud.DATABASE_URI + "&tlsAllowInvalidCertificates=true",
      },
      { DATABASE_URI: cloud.DATABASE_URI.replace("tls=true", "TLS=false") },
      { DATABASE_URI: cloud.DATABASE_URI.replace("blog_production", "admin") },
      { DATABASE_URI: cloud.DATABASE_URI + "&directConnection=true" },
      { MEDIA_STORAGE: "local" },
      { GCS_BUCKET: undefined },
      { CMS_URL: "http://cms.example.com" },
      { CMS_URL: "https://localhost" },
      { SITE_URL: "http://blog.example.com" },
      { PAYLOAD_SECRET: "build-placeholder-not-a-runtime-secret-32-plus" },
    ])
      expect(() => readEnvironment({ ...cloud, ...patch })).toThrow();
  });
  it("does not synthesize a localhost public URL during initial private Run creation", () => {
    expect(
      readEnvironment({ ...cloud, CMS_URL: undefined }).CMS_URL,
    ).toBeUndefined();
  });
  it("keeps local Docker names isolated, and supports a local GCS adapter test setup", () => {
    const local = {
      DATABASE_URI: "mongodb://mongodb/asoball_blog_docker",
      PAYLOAD_SECRET: cloud.PAYLOAD_SECRET,
    };
    expect(readEnvironment(local)).toMatchObject({
      DEPLOYMENT_ENV: "local",
      MEDIA_STORAGE: "local",
    });
    expect(
      readEnvironment({
        ...local,
        MEDIA_STORAGE: "gcs",
        GCS_BUCKET: "test-private-media",
      }).MEDIA_STORAGE,
    ).toBe("gcs");
    expect(() =>
      readEnvironment({ ...cloud, DEPLOYMENT_ENV: "local" }),
    ).toThrow();
  });
});
