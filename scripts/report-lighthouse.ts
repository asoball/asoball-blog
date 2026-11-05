import { readdir, readFile } from "node:fs/promises";
const rows = [];
for (const file of await readdir(".local/lighthouse")) {
  if (!file.endsWith(".json")) continue;
  const report = JSON.parse(
    await readFile(".local/lighthouse/" + file, "utf8"),
  );
  if (!report.categories) continue;
  rows.push({
    url: report.finalUrl,
    performance: report.categories.performance.score,
    accessibility: report.categories.accessibility.score,
    bestPractices: report.categories["best-practices"].score,
    seo: report.categories.seo.score,
    LCPms: Math.round(report.audits["largest-contentful-paint"].numericValue),
    CLS: report.audits["cumulative-layout-shift"].numericValue,
  });
}
console.table(rows);
