import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { validReleaseId } from "@asoball/publishing/worker";
const dataDir = path.resolve(process.env.LOCAL_DATA_DIR || ".local"),
  port = Number(process.env.PORT || 4330);
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".xml": "application/xml",
  ".txt": "text/plain",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".avif": "image/avif",
};
createServer(async (req, res) => {
  try {
    // Resolve the active release once per request; no MongoDB or CMS request-time access.
    const active = JSON.parse(
      await readFile(path.join(dataDir, "active.json"), "utf8"),
    ) as { releaseId: string };
    if (!validReleaseId(active.releaseId)) throw new Error("Invalid release.");
    const root = path.join(dataDir, "releases", active.releaseId, "site");
    const requested = decodeURIComponent(
      new URL(req.url || "/", `http://127.0.0.1:${port}`).pathname,
    );
    const candidate = path.resolve(root, "." + requested);
    if (candidate !== root && !candidate.startsWith(root + path.sep)) {
      res.writeHead(400);
      res.end();
      return;
    }
    let file = candidate;
    try {
      if ((await stat(file)).isDirectory())
        file = path.join(file, "index.html");
    } catch {
      file = path.join(root, "404.html");
      res.statusCode = 404;
    }
    res.setHeader(
      "Content-Type",
      types[path.extname(file)] || "application/octet-stream",
    );
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(await readFile(file));
  } catch {
    res.statusCode = 503;
    res.end("尚無可用的發布版本");
  }
}).listen(port, "127.0.0.1", () =>
  console.log(`Published release preview http://127.0.0.1:${port}`),
);
