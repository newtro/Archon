/**
 * Azure DevOps client wrapper for PR operations.
 * Uses the official azure-devops-node-api SDK.
 */

import * as azdev from "azure-devops-node-api";
import type { IGitApi } from "azure-devops-node-api/GitApi.js";
import type {
  GitPullRequest,
  GitPullRequestCommentThread,
  GitPullRequestIteration,
  GitCommitRef,
  GitPullRequestStatus,
  IdentityRefWithVote,
  Comment as AdoComment,
} from "azure-devops-node-api/interfaces/GitInterfaces.js";
import type { ResourceRef } from "azure-devops-node-api/interfaces/common/VSSInterfaces.js";

// ── Settings stored in memory, synced from frontend via WebSocket ──

let adoOrgUrl = "";
let adoPat = "";
let adoDefaultProject = "";

export function setAdoSettings(orgUrl: string, pat: string, defaultProject?: string): void {
  adoOrgUrl = orgUrl;
  adoPat = pat;
  if (defaultProject !== undefined) adoDefaultProject = defaultProject;
}

export function getAdoOrgUrl(): string { return adoOrgUrl; }
export function getAdoPat(): string { return adoPat; }
export function getAdoDefaultProject(): string { return adoDefaultProject; }

// ── Client creation ────────────────────────────────────────────────

let cachedConnection: azdev.WebApi | null = null;
let cachedOrgUrl = "";
let cachedPat = "";

function getConnection(): azdev.WebApi {
  if (!adoOrgUrl || !adoPat) {
    throw new Error("Azure DevOps not configured. Set Org URL and PAT in Settings.");
  }
  // Re-use connection if settings haven't changed
  if (cachedConnection && cachedOrgUrl === adoOrgUrl && cachedPat === adoPat) {
    return cachedConnection;
  }
  const authHandler = azdev.getPersonalAccessTokenHandler(adoPat);
  cachedConnection = new azdev.WebApi(adoOrgUrl, authHandler);
  cachedOrgUrl = adoOrgUrl;
  cachedPat = adoPat;
  return cachedConnection;
}

async function getGitApi(): Promise<IGitApi> {
  const connection = getConnection();
  return connection.getGitApi();
}

// Cache the authenticated user's ID (resolved once per connection)
let cachedUserId = "";

async function getAuthenticatedUserId(): Promise<string> {
  if (cachedUserId && cachedOrgUrl === adoOrgUrl && cachedPat === adoPat) {
    return cachedUserId;
  }
  const connection = getConnection();
  const connData = await connection.connect();
  const userId = connData.authenticatedUser?.id;
  if (!userId) {
    throw new Error("Could not determine authenticated user ID from Azure DevOps connection");
  }
  cachedUserId = userId;
  return userId;
}

// ── PR Read: Fetch all PR data ─────────────────────────────────────

export interface AdoPrData {
  pullRequest: {
    id: number;
    title: string;
    description: string;
    author: string;
    status: string;
    sourceBranch: string;
    targetBranch: string;
    createdDate: string;
    mergeStatus: string;
    isDraft: boolean;
    url: string;
  };
  iterations: Array<{
    id: number;
    description?: string;
    createdDate: string;
    sourceRefCommit: string;
    targetRefCommit: string;
    hasNewChanges: boolean;
  }>;
  changes: Array<{
    filePath: string;
    changeType: string;
    diff: string;
    originalFilePath?: string;
  }>;
  threads: Array<{
    id: number;
    status: string;
    filePath?: string;
    lineNumber?: number;
    comments: Array<{
      author: string;
      content: string;
      publishedDate: string;
    }>;
  }>;
  workItems: Array<{
    id: number;
    title: string;
    type: string;
    url: string;
  }>;
  commits: Array<{
    commitId: string;
    message: string;
    author: string;
    date: string;
  }>;
  buildStatus: Array<{
    context: string;
    state: string;
    description?: string;
    targetUrl?: string;
  }>;
  reviewers: Array<{
    displayName: string;
    vote: number;
    isRequired: boolean;
  }>;
}

export async function fetchPrData(
  projectName: string,
  repositoryName: string,
  pullRequestId: number,
  lastReviewedIteration?: number,
): Promise<{ data: AdoPrData; signal: string }> {
  const git = await getGitApi();

  // 1. PR metadata
  const pr: GitPullRequest = await git.getPullRequest(repositoryName, pullRequestId, projectName);

  // Determine signal based on PR state
  let signal = "success";
  if (pr.isDraft) signal = "draft";
  else if (pr.status === 3 /* completed/merged */) signal = "merged";

  const prData: AdoPrData["pullRequest"] = {
    id: pr.pullRequestId ?? pullRequestId,
    title: pr.title ?? "",
    description: pr.description ?? "",
    author: pr.createdBy?.displayName ?? "Unknown",
    status: mapPrStatus(pr.status),
    sourceBranch: pr.sourceRefName ?? "",
    targetBranch: pr.targetRefName ?? "",
    createdDate: pr.creationDate?.toISOString() ?? "",
    mergeStatus: mapMergeStatus(pr.mergeStatus),
    isDraft: pr.isDraft ?? false,
    url: pr.url ?? "",
  };

  // 2. Iterations
  let iterations: GitPullRequestIteration[] = [];
  try {
    iterations = await git.getPullRequestIterations(repositoryName, pullRequestId, projectName) ?? [];
  } catch (err) {
    console.warn("[ado-client] Failed to fetch iterations:", err);
  }

  const iterationData = iterations.map((iter) => ({
    id: iter.id ?? 0,
    description: iter.description,
    createdDate: iter.createdDate?.toISOString() ?? "",
    sourceRefCommit: (iter.sourceRefCommit as Record<string, unknown>)?.commitId as string ?? "",
    targetRefCommit: (iter.targetRefCommit as Record<string, unknown>)?.commitId as string ?? "",
    hasNewChanges: lastReviewedIteration != null ? (iter.id ?? 0) > lastReviewedIteration : true,
  }));

  // 3. Changes (diffs) — fetch from latest iteration or all iterations since last reviewed
  const changes: AdoPrData["changes"] = [];
  const iterationsToFetch = lastReviewedIteration != null
    ? iterations.filter((i) => (i.id ?? 0) > lastReviewedIteration)
    : iterations.length > 0 ? [iterations[iterations.length - 1]] : [];

  for (const iter of iterationsToFetch) {
    if (!iter.id) continue;
    try {
      const iterChanges = await git.getPullRequestIterationChanges(repositoryName, pullRequestId, iter.id, projectName);
      for (const change of iterChanges?.changeEntries ?? []) {
        const item = change.item as Record<string, unknown> | undefined;
        changes.push({
          filePath: (item?.path as string) ?? "",
          changeType: mapChangeType(change.changeType),
          diff: "", // Diffs are not directly available from this endpoint; we include the file path and change type
          originalFilePath: (change as Record<string, unknown>).originalPath as string | undefined,
        });
      }
    } catch (err) {
      console.warn(`[ado-client] Failed to fetch iteration ${iter.id} changes:`, err);
    }
  }

  // If no changes found via iterations, check if PR has no changes at all
  if (changes.length === 0 && signal === "success") {
    signal = "no-changes";
  }

  // 4. Threads (comments)
  let threads: GitPullRequestCommentThread[] = [];
  try {
    threads = await git.getThreads(repositoryName, pullRequestId, projectName) ?? [];
  } catch (err) {
    console.warn("[ado-client] Failed to fetch threads:", err);
  }

  const threadData = threads.map((t) => ({
    id: t.id ?? 0,
    status: mapThreadStatus(t.status),
    filePath: t.threadContext?.filePath,
    lineNumber: t.threadContext?.rightFileStart?.line,
    comments: (t.comments ?? []).map((c: AdoComment) => ({
      author: c.author?.displayName ?? "Unknown",
      content: c.content ?? "",
      publishedDate: c.publishedDate?.toISOString() ?? "",
    })),
  }));

  // 5. Work items
  let workItemRefs: ResourceRef[] = [];
  try {
    workItemRefs = await git.getPullRequestWorkItemRefs(repositoryName, pullRequestId, projectName) ?? [];
  } catch (err) {
    console.warn("[ado-client] Failed to fetch work items:", err);
  }

  const workItemData = workItemRefs.map((wi) => ({
    id: parseInt(wi.id ?? "0", 10),
    title: "", // Work item titles require a separate Work Item Tracking API call
    type: "",
    url: wi.url ?? "",
  }));

  // 6. Commits
  let commits: GitCommitRef[] = [];
  try {
    commits = await git.getPullRequestCommits(repositoryName, pullRequestId, projectName) ?? [];
  } catch (err) {
    console.warn("[ado-client] Failed to fetch commits:", err);
  }

  const commitData = commits.map((c) => ({
    commitId: c.commitId ?? "",
    message: c.comment ?? "",
    author: c.author?.name ?? "Unknown",
    date: c.author?.date?.toISOString() ?? "",
  }));

  // 7. Build/pipeline statuses
  let statuses: GitPullRequestStatus[] = [];
  try {
    statuses = await git.getPullRequestStatuses(repositoryName, pullRequestId, projectName) ?? [];
  } catch (err) {
    console.warn("[ado-client] Failed to fetch statuses:", err);
  }

  const buildStatusData = statuses.map((s) => ({
    context: s.context?.name ?? "",
    state: mapStatusState(s.state),
    description: s.description,
    targetUrl: s.targetUrl,
  }));

  // 8. Reviewers
  let reviewers: IdentityRefWithVote[] = [];
  try {
    reviewers = await git.getPullRequestReviewers(repositoryName, pullRequestId, projectName) ?? [];
  } catch (err) {
    console.warn("[ado-client] Failed to fetch reviewers:", err);
  }

  const reviewerData = reviewers.map((r) => ({
    displayName: r.displayName ?? "Unknown",
    vote: r.vote ?? 0,
    isRequired: r.isRequired ?? false,
  }));

  return {
    data: {
      pullRequest: prData,
      iterations: iterationData,
      changes,
      threads: threadData,
      workItems: workItemData,
      commits: commitData,
      buildStatus: buildStatusData,
      reviewers: reviewerData,
    },
    signal,
  };
}

// ── PR Write: Post comments and set vote ───────────────────────────

export interface AdoPrWriteInput {
  pullRequestId: number;
  summary?: string;
  vote?: "approve" | "approve-with-suggestions" | "wait-for-author" | "reject" | "no-vote";
  inlineComments?: Array<{
    filePath: string;
    lineStart: number;
    lineEnd?: number;
    content: string;
    severity?: "info" | "warning" | "critical";
  }>;
}

export interface AdoPrWriteResult {
  threadsCreated: number;
  voteSet: boolean;
  errors: string[];
}

const VOTE_MAP: Record<string, number> = {
  "approve": 10,
  "approve-with-suggestions": 5,
  "wait-for-author": -5,
  "reject": -10,
  "no-vote": 0,
};

const THREAD_STATUS_MAP: Record<string, number> = {
  "active": 1,
  "pending": 5,
  "fixed": 2,
  "closed": 4,
};

export async function writePrReview(
  projectName: string,
  repositoryName: string,
  input: AdoPrWriteInput,
  options: {
    postSummaryComment: boolean;
    postInlineComments: boolean;
    setVote: boolean;
    defaultVote: string;
    threadStatus: string;
  },
): Promise<{ result: AdoPrWriteResult; signal: string }> {
  const git = await getGitApi();
  const errors: string[] = [];
  let threadsCreated = 0;
  let voteSet = false;

  const threadStatusValue = THREAD_STATUS_MAP[options.threadStatus] ?? 1;

  // 1. Post summary comment
  if (options.postSummaryComment && input.summary) {
    try {
      await git.createThread(
        {
          comments: [{ parentCommentId: 0, content: input.summary, commentType: 1 }],
          status: threadStatusValue,
        } as GitPullRequestCommentThread,
        repositoryName,
        input.pullRequestId,
        projectName,
      );
      threadsCreated++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to post summary comment: ${errMsg}`);
    }
  }

  // 2. Post inline comments
  if (options.postInlineComments && input.inlineComments?.length) {
    for (const comment of input.inlineComments) {
      try {
        const severityPrefix = comment.severity === "critical" ? "[CRITICAL] "
          : comment.severity === "warning" ? "[WARNING] "
          : "";

        await git.createThread(
          {
            comments: [{ parentCommentId: 0, content: `${severityPrefix}${comment.content}`, commentType: 1 }],
            status: threadStatusValue,
            threadContext: {
              filePath: comment.filePath,
              rightFileStart: { line: comment.lineStart, offset: 1 },
              rightFileEnd: { line: comment.lineEnd ?? comment.lineStart, offset: 1 },
            },
          } as GitPullRequestCommentThread,
          repositoryName,
          input.pullRequestId,
          projectName,
        );
        threadsCreated++;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        errors.push(`Failed to post comment on ${comment.filePath}:${comment.lineStart}: ${errMsg}`);
      }
    }
  }

  // 3. Set vote
  if (options.setVote) {
    const voteValue = input.vote && input.vote !== "no-vote"
      ? VOTE_MAP[input.vote] ?? 0
      : options.defaultVote !== "from-input"
        ? VOTE_MAP[options.defaultVote] ?? 0
        : 0;

    if (voteValue !== 0) {
      try {
        const reviewerId = await getAuthenticatedUserId();
        await git.createPullRequestReviewer(
          { vote: voteValue } as IdentityRefWithVote,
          repositoryName,
          input.pullRequestId,
          reviewerId,
          projectName,
        );
        voteSet = true;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        errors.push(`Failed to set vote: ${errMsg}`);
      }
    }
  }

  // Determine signal
  let signal = "success";
  if (errors.length > 0 && threadsCreated === 0 && !voteSet) {
    signal = "error";
  } else if (errors.length > 0) {
    signal = "partial";
  }

  return {
    result: { threadsCreated, voteSet, errors },
    signal,
  };
}

// ── Helpers ────────────────────────────────────────────────────────

function mapPrStatus(status: number | undefined): string {
  switch (status) {
    case 1: return "active";
    case 2: return "abandoned";
    case 3: return "completed";
    default: return "unknown";
  }
}

function mapMergeStatus(status: number | undefined): string {
  switch (status) {
    case 1: return "succeeded";
    case 2: return "conflicts";
    case 3: return "rejectedByPolicy";
    case 4: return "failure";
    default: return "notSet";
  }
}

function mapChangeType(changeType: number | undefined): string {
  switch (changeType) {
    case 1: return "add";
    case 2: return "edit";
    case 16: return "delete";
    case 8: return "rename";
    default: return "unknown";
  }
}

function mapThreadStatus(status: number | undefined): string {
  switch (status) {
    case 1: return "active";
    case 2: return "fixed";
    case 3: return "wontFix";
    case 4: return "closed";
    case 5: return "pending";
    case 6: return "byDesign";
    default: return "unknown";
  }
}

function mapStatusState(state: number | undefined): string {
  switch (state) {
    case 1: return "pending";
    case 2: return "succeeded";
    case 3: return "failed";
    case 4: return "error";
    default: return "notSet";
  }
}
