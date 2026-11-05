import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(process.env.STATIC_ROOT || "apps/blog/dist");
const port = Number(process.env.PORT || 4322);
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".xml": "application/xml",
  ".txt": "text/plain",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
};
createServer(async (req, res) => {
  try {
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
    const body = await readFile(file);
    res.setHeader(
      "Content-Type",
      types[path.extname(file)] || "application/octet-stream",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end("Not found");
  }
}).listen(port, "127.0.0.1", () =>
  console.log(`Static preview http://127.0.0.1:${port}`),
);
