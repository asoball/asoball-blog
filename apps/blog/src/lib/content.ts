import { readFileSync } from "node:fs";
import { fixtureSnapshot } from "@asoball/content-contract/fixture";
import { snapshotSchema, sortedPosts } from "@asoball/content-contract";
export const snapshot = process.env.CONTENT_SNAPSHOT
  ? snapshotSchema.parse(
      JSON.parse(readFileSync(process.env.CONTENT_SNAPSHOT, "utf8")),
    )
  : fixtureSnapshot();
export const posts = sortedPosts(snapshot.posts);
