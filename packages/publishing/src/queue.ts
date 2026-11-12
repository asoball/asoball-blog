import {
  MongoClient,
  ObjectId,
  type Db,
  type ClientSession,
  type Document,
} from "mongodb";
import { randomUUID } from "node:crypto";
import type { Actor } from "./snapshot";
export type ActiveRelease = {
  releaseId: string;
  seq: number;
  sourceDigest: string;
  snapshotDigest: string;
  siteDigest?: string;
  activatedAt: string;
};
export type PublishState = {
  _id: string;
  desired: number;
  fence: number;
  mutation?: number;
  active?: ActiveRelease;
  cloudPending?: {
    owner: string;
    fence: number;
    seq: number;
    site?: string;
    version?: string;
    message?: string;
    active?: ActiveRelease;
  };
  lock?: { owner: string; expiresAt: Date } | null;
};
export type PublishJob = Document & {
  _id: ObjectId;
  seq: number;
  key: string;
  actor: Actor;
  reason: string;
  state: "queued" | "running" | "succeeded" | "failed" | "superseded";
  attempts: number;
  availableAt: Date;
  createdAt: Date;
  errorCode?: string;
  releaseId?: string;
};
export const states = (db: Db) => db.collection<PublishState>("publish_state");
export const jobs = (db: Db) => db.collection<PublishJob>("publish_jobs");
export async function preparePublisherDb(db: Db) {
  await jobs(db).createIndex({ key: 1 }, { unique: true });
  await jobs(db).createIndex({ seq: 1 }, { unique: true });
  await jobs(db).createIndex({ state: 1, availableAt: 1, seq: -1 });
  await states(db).updateOne(
    { _id: "state" },
    { $setOnInsert: { desired: 0, fence: 0, lock: null } },
    { upsert: true },
  );
}
export async function enqueueInTransaction(
  db: Db,
  session: ClientSession,
  actor: Actor,
  key: string,
  reason: string,
) {
  if (
    actor.role !== "admin" ||
    !ObjectId.isValid(actor.id) ||
    !(await db
      .collection("users")
      .findOne(
        { _id: new ObjectId(actor.id), role: "admin" },
        { session, projection: { _id: 1 } },
      ))
  )
    throw new Error("Publishing administrator required.");
  const existing = await jobs(db).findOne({ key }, { session });
  if (existing) return existing;
  const state = await states(db).findOneAndUpdate(
    { _id: "state" },
    { $inc: { desired: 1 } },
    { session, returnDocument: "after" },
  );
  if (!state) throw new Error("Publisher is not initialized.");
  const job: PublishJob = {
    _id: new ObjectId(),
    seq: state.desired,
    key,
    actor,
    reason,
    state: "queued",
    attempts: 0,
    availableAt: new Date(),
    createdAt: new Date(),
  };
  await jobs(db).insertOne(job, { session });
  return job;
}
export class PublisherQueue {
  readonly owner = randomUUID();
  readonly client: MongoClient;
  readonly db: Db;
  leaseMs = 30000;
  constructor(uri: string) {
    this.client = new MongoClient(uri, { maxPoolSize: 3 });
    this.db = this.client.db();
  }
  async open() {
    await this.client.connect();
    await preparePublisherDb(this.db);
    return this;
  }
  async close() {
    await this.client.close();
  }
  async request(actor: Actor, key: string, reason = "manual") {
    const session = this.client.startSession();
    try {
      return await session.withTransaction(() =>
        enqueueInTransaction(this.db, session, actor, key, reason),
      );
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        const duplicate = await jobs(this.db).findOne({ key });
        if (duplicate) return duplicate;
      }
      throw error;
    } finally {
      await session.endSession();
    }
  }
  async acquire() {
    return states(this.db).findOneAndUpdate(
      {
        _id: "state",
        cloudPending: { $exists: false },
        $or: [{ lock: null }, { "lock.expiresAt": { $lte: new Date() } }],
      },
      {
        $inc: { fence: 1 },
        $set: {
          lock: {
            owner: this.owner,
            expiresAt: new Date(Date.now() + this.leaseMs),
          },
        },
      },
      { returnDocument: "after" },
    );
  }
  cloudPermit(seq: number, fence: number) {
    return {
      begin: async () => {
        const result = await states(this.db).updateOne(
          {
            _id: "state",
            desired: seq,
            fence,
            "lock.owner": this.owner,
            "lock.expiresAt": { $gt: new Date() },
            cloudPending: { $exists: false },
          },
          { $set: { cloudPending: { owner: this.owner, seq, fence } } },
        );
        return result.matchedCount === 1;
      },
      complete: async (remoteRelease: unknown) => {
        const result = await states(this.db).updateOne(
          {
            _id: "state",
            "cloudPending.owner": this.owner,
            "cloudPending.seq": seq,
            "cloudPending.fence": fence,
          },
          { $unset: { cloudPending: "" }, $set: { remoteRelease } },
        );
        if (!result.matchedCount)
          throw new Error("Remote activation requires reconciliation.");
      },
    };
  }
  async heartbeat(fence: number) {
    const result = await states(this.db).updateOne(
      {
        _id: "state",
        fence,
        "lock.owner": this.owner,
        "lock.expiresAt": { $gt: new Date() },
      },
      { $set: { "lock.expiresAt": new Date(Date.now() + this.leaseMs) } },
    );
    return result.matchedCount === 1;
  }
  async release(fence: number) {
    await states(this.db).updateOne(
      { _id: "state", fence, "lock.owner": this.owner },
      { $set: { lock: null } },
    );
  }
  async owned(fence: number) {
    return Boolean(
      await states(this.db).findOne({
        _id: "state",
        fence,
        "lock.owner": this.owner,
        "lock.expiresAt": { $gt: new Date() },
      }),
    );
  }
  async claim(fence: number) {
    const session = this.client.startSession();
    try {
      return await session.withTransaction(async () => {
        const state = await states(this.db).findOneAndUpdate(
          {
            _id: "state",
            fence,
            "lock.owner": this.owner,
            "lock.expiresAt": { $gt: new Date() },
          },
          { $set: { "lock.expiresAt": new Date(Date.now() + this.leaseMs) } },
          { session, returnDocument: "after" },
        );
        if (!state) return null;
        await jobs(this.db).updateMany(
          {
            seq: state.desired,
            state: { $in: ["queued", "running"] },
            attempts: { $gte: 3 },
          },
          { $set: { state: "failed", errorCode: "RETRY_LIMIT_EXHAUSTED" } },
          { session },
        );
        await jobs(this.db).updateMany(
          {
            seq: { $lt: state.desired },
            state: { $in: ["queued", "running"] },
          },
          { $set: { state: "superseded" } },
          { session },
        );
        return jobs(this.db).findOneAndUpdate(
          {
            seq: state.desired,
            state: { $in: ["queued", "running"] },
            availableAt: { $lte: new Date() },
            attempts: { $lt: 3 },
          },
          {
            $set: { state: "running", runningFence: fence },
            $inc: { attempts: 1 },
          },
          { session, returnDocument: "after" },
        );
      });
    } finally {
      await session.endSession();
    }
  }
  async fail(job: PublishJob, fence: number) {
    if (!(await this.owned(fence))) return;
    await jobs(this.db).updateOne(
      { _id: job._id, state: "running", runningFence: fence },
      {
        $set: {
          state: job.attempts < 3 ? "queued" : "failed",
          errorCode: "BUILD_OR_EXPORT_FAILED",
          availableAt: new Date(
            Date.now() + Math.min(30000, 1000 * 2 ** job.attempts),
          ),
        },
      },
    );
  }
  async activate(release: ActiveRelease, fence: number) {
    const result = await states(this.db).updateOne(
      {
        _id: "state",
        desired: release.seq,
        fence,
        "lock.owner": this.owner,
        "lock.expiresAt": { $gt: new Date() },
      },
      { $set: { active: release } },
    );
    return result.matchedCount === 1;
  }
}
