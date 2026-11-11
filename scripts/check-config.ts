import { loadCmsEnvironment } from "../apps/cms/src/environment-file";
import { readEnvironment } from "../apps/cms/src/environment";
loadCmsEnvironment();
const env = readEnvironment(process.env);
if (env.DEPLOYMENT_ENV === "cloud" && !env.CMS_URL)
  throw new Error("Set CMS_URL before enabling the public CMS login.");
console.log(
  JSON.stringify({
    valid: true,
    environment: env.DEPLOYMENT_ENV,
    mediaStorage: env.MEDIA_STORAGE,
    cmsUrlConfigured: Boolean(env.CMS_URL),
    siteUrlConfigured: Boolean(env.SITE_URL),
  }),
);
