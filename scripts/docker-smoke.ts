import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import sharp from "sharp";
const base = "http://127.0.0.1:3001",
  credentials = JSON.parse(await readFile(".local/docker-admin.json", "utf8"));
const login = await fetch(base + "/api/users/login", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: base },
  body: JSON.stringify(credentials),
});
assert.equal(login.status, 200);
const token = ((await login.json()) as { token: string }).token;
const headers = { Authorization: `JWT ${token}`, Origin: base };
if (process.argv.includes("--after-restart")) {
  const probe = JSON.parse(
    await readFile(".local/docker-probe.json", "utf8"),
  ) as { id: string; url: string; sha: string };
  const file = await fetch(probe.url, { headers });
  assert.equal(file.status, 200);
  assert.equal(
    createHash("sha256")
      .update(Buffer.from(await file.arrayBuffer()))
      .digest("hex"),
    probe.sha,
  );
  assert.ok(
    (
      await fetch(base + "/api/media/" + probe.id, {
        method: "DELETE",
        headers,
      })
    ).ok,
  );
  console.log(
    "PASS Docker CMS: login, media persisted across restart, authorized cleanup.",
  );
} else {
  const bytes = await sharp({
    create: { width: 64, height: 32, channels: 3, background: "#1D4ED8" },
  })
    .png()
    .toBuffer();
  const form = new FormData();
  form.set("_payload", JSON.stringify({ alt: "Docker restart fixture" }));
  form.set(
    "file",
    new Blob([new Uint8Array(bytes)], { type: "image/png" }),
    "restart.png",
  );
  const upload = await fetch(base + "/api/media", {
    method: "POST",
    headers,
    body: form,
  });
  assert.ok(upload.ok);
  const { doc } = (await upload.json()) as { doc: { id: string; url: string } };
  const file = await fetch(doc.url, { headers });
  assert.equal(file.status, 200);
  const sha = createHash("sha256")
    .update(Buffer.from(await file.arrayBuffer()))
    .digest("hex");
  await writeFile(
    ".local/docker-probe.json",
    JSON.stringify({ id: doc.id, url: doc.url, sha }),
  );
  const scan = `const fs=require('fs'),assert=require('assert');let secret='';process.stdin.on('data',c=>secret+=c);process.stdin.on('end',()=>{assert(!process.env.PAYLOAD_SECRET);function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=dir+'/'+item.name;if(item.isDirectory())walk(file);else if(item.isFile()){assert(!/^\\.env(?:\\.|$)/.test(item.name));if(/\\.(js|json|ts)$/.test(item.name))assert(!fs.readFileSync(file).includes(Buffer.from(secret)));}}}walk('/app');console.log('PASS runtime image: no .env or local secret; runtime credentials require injection.');});`;
  process.loadEnvFile("apps/cms/.env");
  const checked = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "-i",
      "--entrypoint",
      "node",
      "asoball-blog-cms:local",
      "-e",
      scan,
    ],
    { input: process.env.PAYLOAD_SECRET, encoding: "utf8", maxBuffer: 100000 },
  );
  assert.equal(checked.status, 0, checked.stderr);
  console.log(checked.stdout.trim());
  console.log(
    "Docker media probe saved; restart the CMS then run --after-restart.",
  );
}
