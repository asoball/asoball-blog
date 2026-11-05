export interface ImmutableCloudFile {
  save(
    data: Buffer,
    options: {
      resumable: false;
      preconditionOpts: { ifGenerationMatch: 0 };
      metadata: { contentType: string };
    },
  ): Promise<unknown>;
}
export async function writeCloudSnapshot(
  file: ImmutableCloudFile,
  data: Buffer,
) {
  // Generation 0 means create-only. A collision fails rather than overwriting a release.
  await file.save(data, {
    resumable: false,
    preconditionOpts: { ifGenerationMatch: 0 },
    metadata: { contentType: "application/json" },
  });
}
export type CloudPlan = {
  projectId: string;
  region: string;
  triggerId: string;
  commitSha: string;
  releaseId: string;
  snapshotUri: string;
  snapshotDigest: string;
  candidateBucket: string;
  siteUrl: string;
  seq: number;
  fence: number;
};
export interface CloudTransport {
  request(options: {
    url: string;
    method: "GET" | "POST";
    data?: unknown;
  }): Promise<{ data: unknown }>;
}
export function validateCloudPlan(plan: CloudPlan) {
  if (
    !/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(plan.candidateBucket) ||
    !/^https:\/\/[^/?#]+\/?$/.test(plan.siteUrl)
  )
    throw new Error("Invalid candidate bucket or public site URL.");
  if (
    !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(plan.projectId) ||
    !/^[-a-z0-9]+$/.test(plan.region) ||
    !/^[-a-zA-Z0-9]+$/.test(plan.triggerId) ||
    !/^[a-f0-9]{40}$/.test(plan.commitSha) ||
    !/^release-\d{10}-f\d+$/.test(plan.releaseId) ||
    !/^[a-f0-9]{64}$/.test(plan.snapshotDigest) ||
    !/^gs:\/\/[a-z0-9._-]+\/[-a-zA-Z0-9_/]+\/snapshot\.json$/.test(
      plan.snapshotUri,
    ) ||
    !Number.isSafeInteger(plan.seq) ||
    !Number.isSafeInteger(plan.fence) ||
    plan.seq < 1 ||
    plan.fence < 1
  )
    throw new Error("Invalid immutable cloud build plan.");
  return plan;
}
export async function submitBuildCandidate(
  plan: CloudPlan,
  transport: CloudTransport,
  options: { enabled: boolean; ownsLease: () => Promise<boolean> },
) {
  validateCloudPlan(plan);
  if (!options.enabled || !(await options.ownsLease()))
    throw new Error(
      "Cloud build is disabled or the publishing lease was lost.",
    );
  return (
    await transport.request({
      url: `https://cloudbuild.googleapis.com/v1/projects/${plan.projectId}/locations/${plan.region}/triggers/${plan.triggerId}:run`,
      method: "POST",
      data: {
        source: {
          commitSha: plan.commitSha,
          substitutions: {
            _SOURCE_SHA: plan.commitSha,
            _RELEASE_ID: plan.releaseId,
            _SNAPSHOT_URI: plan.snapshotUri,
            _SNAPSHOT_SHA256: plan.snapshotDigest,
            _CANDIDATE_BUCKET: plan.candidateBucket,
            _SITE_URL: plan.siteUrl,
          },
        },
      },
    })
  ).data;
}
export interface DurableActivationPermit {
  begin: () => Promise<boolean>;
  complete: (remoteRelease: unknown) => Promise<void>;
}
export async function promoteFirebaseVersion(
  input: {
    site: string;
    version: string;
    seq: number;
    fence: number;
    enabled: boolean;
  },
  transport: CloudTransport,
  permit: DurableActivationPermit,
) {
  if (
    !input.enabled ||
    !/^[-a-z0-9]+$/.test(input.site) ||
    !new RegExp(`^sites/${input.site}/versions/[a-zA-Z0-9-]+$`).test(
      input.version,
    ) ||
    input.seq < 1 ||
    input.fence < 1
  )
    throw new Error("Invalid or disabled cloud activation.");
  // begin() must durably block all successor publishers until the remote outcome is known.
  if (!(await permit.begin()))
    throw new Error("Cloud activation permit denied.");
  const result = await transport.request({
    url: `https://firebasehosting.googleapis.com/v1beta1/sites/${input.site}/releases?versionName=${encodeURIComponent(input.version)}`,
    method: "POST",
    data: { message: `seq=${input.seq};fence=${input.fence}` },
  });
  // A network error intentionally leaves the durable permit pending; never blindly retry activation.
  await permit.complete(result.data);
  return result.data;
}
