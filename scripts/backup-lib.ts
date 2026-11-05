import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
  createHash,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  stat,
  open,
  unlink,
  copyFile,
} from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import path from "node:path";
import { MongoClient } from "mongodb";
import { z } from "zod";
const MAGIC = Buffer.from("ASOB01");
const databaseSchema = z.enum([
  "asoball_blog_dev",
  "asoball_blog_test",
  "asoball_blog_docker",
]);
const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceDatabase: databaseSchema,
    createdAt: z.iso.datetime(),
    media: z.array(
      z.object({
        filename: z.string().regex(/^[a-zA-Z0-9_-]+\.(png|jpe?g|webp|avif)$/),
        blob: z.string().regex(/^[a-f0-9]{64}\.enc$/),
      }),
    ),
  })
  .strict();
export async function backupKey() {
  const key = Buffer.from(
    (
      process.env.BACKUP_KEY || (await readFile(".local/backup.key", "utf8"))
    ).trim(),
    "hex",
  );
  if (key.length !== 32) throw new Error("A 32-byte backup key is required.");
  return key;
}
async function encrypt(input: Readable, target: string, key: Buffer) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv),
    output = createWriteStream(target, { flags: "wx", mode: 0o600 });
  output.write(Buffer.concat([MAGIC, iv]));
  await pipeline(input, cipher, output);
  await writeFile(target, cipher.getAuthTag(), { flag: "a" });
}
export async function decryptVerified(
  source: string,
  target: string,
  key: Buffer,
) {
  const info = await stat(source);
  if (info.size < 35) throw new Error("Invalid encrypted backup.");
  const handle = await open(source, "r");
  const header = Buffer.alloc(18),
    tag = Buffer.alloc(16);
  try {
    await handle.read(header, 0, 18, 0);
    await handle.read(tag, 0, 16, info.size - 16);
  } finally {
    await handle.close();
  }
  if (!header.subarray(0, 6).equals(MAGIC))
    throw new Error("Invalid backup format.");
  const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(6));
  decipher.setAuthTag(tag);
  const output = createWriteStream(target, { flags: "wx", mode: 0o600 });
  let created = false;
  output.once("open", () => {
    created = true;
  });
  try {
    await pipeline(
      createReadStream(source, { start: 18, end: info.size - 17 }),
      decipher,
      output,
    );
  } catch (error) {
    if (created) await unlink(target).catch(() => {});
    throw error;
  }
}
function dump(database: string) {
  const child = spawn(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "mongodb",
      "mongodump",
      `--db=${database}`,
      "--archive",
      "--gzip",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stderr.resume();
  const exit = new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("mongodump failed.")),
    );
  });
  return { child, exit };
}
export async function backupLocal(options: {
  database: string;
  dataDir: string;
  offline: boolean;
  key: Buffer;
}) {
  if (!options.offline)
    throw new Error(
      "Stop the source CMS and publisher, then confirm --offline.",
    );
  const database = databaseSchema.parse(options.database),
    folder = path.resolve(
      ".local/backups",
      `backup-${Date.now()}-${randomUUID()}`,
    );
  await mkdir(folder, { recursive: true });
  const { child, exit } = dump(database);
  try {
    await Promise.all([
      encrypt(child.stdout, path.join(folder, "database.enc"), options.key),
      exit,
    ]);
  } catch (error) {
    child.kill();
    throw error;
  }
  const media: { filename: string; blob: string }[] = [];
  const source = path.join(options.dataDir, "media");
  let files: string[] = [];
  try {
    files = await readdir(source);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (const filename of files) {
    const blob = createHash("sha256").update(filename).digest("hex") + ".enc";
    manifestSchema.shape.media.element.parse({ filename, blob });
    await encrypt(
      createReadStream(path.join(source, filename)),
      path.join(folder, blob),
      options.key,
    );
    media.push({ filename, blob });
  }
  const manifest = manifestSchema.parse({
    schemaVersion: 1,
    sourceDatabase: database,
    createdAt: new Date().toISOString(),
    media,
  });
  await encrypt(
    Readable.from([JSON.stringify(manifest)]),
    path.join(folder, "manifest.enc"),
    options.key,
  );
  return folder;
}
export async function restoreLocal(options: {
  folder: string;
  destination: string;
  key: Buffer;
}) {
  const folder = path.resolve(options.folder),
    allowed = path.resolve(".local/backups") + path.sep;
  if (!folder.startsWith(allowed))
    throw new Error("Restore source must be a local backup folder.");
  const destination = path.resolve(options.destination);
  if (!destination.startsWith(path.resolve(".local") + path.sep))
    throw new Error("Restore files must stay in .local.");
  const client = new MongoClient(
    "mongodb://127.0.0.1:27017/asoball_blog_restore?replicaSet=rs0&directConnection=true",
    { maxPoolSize: 3 },
  );
  await client.connect();
  const staging = path.resolve(".local/restore-staging", randomUUID());
  await mkdir(staging, { recursive: true });
  const temporaries: string[] = [];
  try {
    for (const collection of await client
      .db()
      .listCollections({}, { nameOnly: true })
      .toArray())
      if (await client.db().collection(collection.name).findOne({}))
        throw new Error(
          "Restore database is not empty; refusing to overwrite data.",
        );
    const manifestFile = path.join(staging, "manifest.json");
    temporaries.push(manifestFile);
    await decryptVerified(
      path.join(folder, "manifest.enc"),
      manifestFile,
      options.key,
    );
    const manifest = manifestSchema.parse(
      JSON.parse(await readFile(manifestFile, "utf8")),
    );
    const archive = path.join(staging, "database.archive");
    temporaries.push(archive);
    await decryptVerified(
      path.join(folder, "database.enc"),
      archive,
      options.key,
    );
    for (const item of manifest.media) {
      const file = path.join(staging, item.filename);
      temporaries.push(file);
      await decryptVerified(path.join(folder, item.blob), file, options.key);
    }
    const mediaDir = path.join(destination, "media");
    await mkdir(destination, { recursive: true });
    await mkdir(mediaDir);
    const child = spawn(
      "docker",
      [
        "compose",
        "exec",
        "-T",
        "mongodb",
        "mongorestore",
        "--archive",
        "--gzip",
        `--nsFrom=${manifest.sourceDatabase}.*`,
        "--nsTo=asoball_blog_restore.*",
      ],
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    child.stderr.resume();
    const exit = new Promise<void>((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error("mongorestore failed.")),
      );
    });
    await Promise.all([pipeline(createReadStream(archive), child.stdin), exit]);
    for (const item of manifest.media)
      await copyFile(
        path.join(staging, item.filename),
        path.join(mediaDir, item.filename),
      );
    return {
      database: "asoball_blog_restore",
      destination,
      mediaFiles: manifest.media.length,
    };
  } finally {
    await client.close();
    for (const file of temporaries) await unlink(file).catch(() => {});
  }
}
