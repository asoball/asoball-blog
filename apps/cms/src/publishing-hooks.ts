import {
  APIError,
  type Payload,
  type PayloadRequest,
  type CollectionAfterChangeHook,
  type CollectionAfterDeleteHook,
  type CollectionBeforeOperationHook,
} from "payload";
import {
  enqueueInTransaction,
  preparePublisherDb,
  jobs,
  states,
} from "@asoball/publishing/queue";
import type { Db, ClientSession, MongoClient } from "mongodb";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { isAdmin } from "./access";
import { referencesMedia } from "./media";
export const publisherDb = (payload: Payload) =>
  payload.db.connection.db as unknown as Db;
export async function initializePublisher(payload: Payload) {
  if (process.env.PUBLISHING_ENABLED !== "false")
    await preparePublisherDb(publisherDb(payload));
}
export const captureDraft: CollectionBeforeOperationHook = async ({
  operation,
  args,
  req,
}) => {
  if (
    process.env.PUBLISHING_ENABLED !== "false" &&
    ["create", "update", "delete"].includes(operation) &&
    "disableTransaction" in args &&
    args.disableTransaction === true
  )
    throw new APIError(
      "Publishing mutations require a database transaction.",
      503,
    );
  if (operation === "create" || operation === "update")
    req.context.savingDraft = "draft" in args && args.draft === true;
  if (
    process.env.PUBLISHING_ENABLED !== "false" &&
    isAdmin({ req }) &&
    ["create", "update", "delete"].includes(operation)
  ) {
    const tx = await req.transactionID;
    const session = tx
      ? (req.payload.db.sessions[tx] as unknown as ClientSession)
      : undefined;
    if (!session?.inTransaction())
      throw new APIError(
        "Publishing mutations require a database transaction.",
        503,
      );
    // Take the shared state write lock BEFORE content reads establish a snapshot.
    // Otherwise a concurrent worker heartbeat can make the later outbox append abort.
    await states(publisherDb(req.payload)).updateOne(
      { _id: "state" },
      { $inc: { mutation: 1 } },
      { session },
    );
  }
};
async function appendEvent(req: PayloadRequest, key: string, reason: string) {
  if (process.env.PUBLISHING_ENABLED === "false") return;
  if (!isAdmin({ req }))
    throw new APIError("Only an administrator may request publishing.", 403);
  const tx = await req.transactionID;
  const session = tx
    ? (req.payload.db.sessions[tx] as unknown as ClientSession)
    : undefined;
  if (!session?.inTransaction())
    throw new APIError(
      "Publishing mutations require a database transaction.",
      503,
    );
  await enqueueInTransaction(
    publisherDb(req.payload),
    session,
    { id: String(req.user!.id), role: "admin" },
    createHash("sha256").update(key).digest("hex"),
    reason,
  );
}
export const postChanged: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  req,
}) => {
  if (
    req.context.savingDraft ||
    !(doc._status === "published" || previousDoc?._status === "published")
  )
    return doc;
  await appendEvent(
    req,
    `post:${doc.id}:${doc.updatedAt}:${doc._status}`,
    "post-change",
  );
  return doc;
};
export const postDeleted: CollectionAfterDeleteHook = async ({ doc, req }) => {
  if (doc._status === "published")
    await appendEvent(req, `delete:${doc.id}:${doc.updatedAt}`, "post-delete");
  return doc;
};
export const taxonomyChanged: CollectionAfterChangeHook = async ({
  doc,
  req,
  collection,
}) => {
  await appendEvent(
    req,
    `${collection.slug}:${doc.id}:${doc.updatedAt}`,
    "taxonomy-change",
  );
  return doc;
};
export const taxonomyDeleted: CollectionAfterDeleteHook = async ({
  doc,
  req,
  collection,
}) => {
  await appendEvent(
    req,
    `delete:${collection.slug}:${doc.id}:${doc.updatedAt}`,
    "taxonomy-delete",
  );
  return doc;
};
export const mediaChanged: CollectionAfterChangeHook = async ({ doc, req }) => {
  if (process.env.PUBLISHING_ENABLED === "false") return doc;
  let page = 1;
  do {
    const found = await req.payload.find({
      collection: "posts",
      req,
      overrideAccess: true,
      where: { _status: { equals: "published" } },
      limit: 100,
      page,
      depth: 0,
    });
    if (
      found.docs.some(
        (post) =>
          String(
            typeof post.coverImage === "object"
              ? post.coverImage?.id
              : post.coverImage,
          ) === String(doc.id) || referencesMedia(post.content, doc.id),
      )
    ) {
      await appendEvent(
        req,
        `media:${doc.id}:${doc.updatedAt}`,
        "media-change",
      );
      break;
    }
    if (!found.hasNextPage) break;
    page++;
  } while (true);
  return doc;
};
export async function requestPublishing(req: PayloadRequest) {
  if (!isAdmin({ req })) throw new APIError("Administrator required.", 403);
  const origin = req.headers.get("origin"),
    expected = new URL(process.env.CMS_URL || "http://127.0.0.1:3000").origin;
  if (
    (origin && origin !== expected) ||
    (req.headers.has("cookie") &&
      !req.headers.has("authorization") &&
      origin !== expected)
  )
    throw new APIError("Same-origin request required.", 403);
  const body = z
    .object({ key: z.string().min(1).max(160).optional() })
    .safeParse(await req.json?.().catch(() => null));
  if (!body.success) throw new APIError("Invalid publishing request.", 400);
  const client =
    req.payload.db.connection.getClient() as unknown as MongoClient;
  const session = client.startSession();
  try {
    const job = await session.withTransaction(() =>
      enqueueInTransaction(
        publisherDb(req.payload),
        session,
        { id: String(req.user!.id), role: "admin" },
        body.data.key || `manual:${randomUUID()}`,
        "manual",
      ),
    );
    return Response.json(
      { releaseId: String(job!.seq), state: job!.state },
      { status: 202 },
    );
  } finally {
    await session.endSession();
  }
}
export async function publishingStatus(req: PayloadRequest) {
  if (!isAdmin({ req })) throw new APIError("Administrator required.", 403);
  const release = String(req.routeParams?.releaseId || "latest");
  const job =
    release === "latest"
      ? await jobs(publisherDb(req.payload)).findOne({}, { sort: { seq: -1 } })
      : await jobs(publisherDb(req.payload)).findOne({ seq: Number(release) });
  const state = await states(publisherDb(req.payload)).findOne({
    _id: "state",
  });
  return Response.json(
    {
      job: job
        ? {
            seq: job.seq,
            state: job.state,
            attempts: job.attempts,
            errorCode: job.errorCode,
            releaseId: job.releaseId,
          }
        : null,
      active: state?.active ?? null,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
