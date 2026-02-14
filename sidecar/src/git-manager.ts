import simpleGit, { type SimpleGit, type StatusResult, type LogResult, type BranchSummary } from "simple-git";
import { watch, type FSWatcher } from "chokidar";
import * as path from "path";
import { getGlobalProjectRoot } from "./agent.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface GitFileStatus {
  path: string;
  /** Status code: M=modified, A=added, D=deleted, ?=untracked, R=renamed, C=copied */
  status: string;
  /** Original path for renamed/copied files */
  from?: string;
}

export interface GitStatusData {
  isRepo: boolean;
  branch: string;
  tracking: string | null;
  ahead: number;
  behind: number;
  staged: GitFileStatus[];
  unstaged: GitFileStatus[];
  untracked: GitFileStatus[];
}

export interface GitLogEntry {
  hash: string;
  hashShort: string;
  author: string;
  date: string;
  message: string;
  refs: string;
}

export interface GitLogData {
  entries: GitLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export interface GitBranchInfo {
  name: string;
  current: boolean;
  commit: string;
  label: string;
}

export interface GitBranchData {
  current: string;
  local: GitBranchInfo[];
  remote: string[];
}

export interface GitRemoteInfo {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

// ── Git Manager ──────────────────────────────────────────────────────────────

type StatusCallback = (status: GitStatusData) => void;

let watcher: FSWatcher | null = null;
let headWatcher: FSWatcher | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let debounceMs = 500;
let statusCallback: StatusCallback | null = null;

function getGit(): SimpleGit {
  const root = getGlobalProjectRoot();
  if (!root) throw new Error("No project root set");
  return simpleGit(root);
}

// ── Status ───────────────────────────────────────────────────────────────────

export async function getStatus(): Promise<GitStatusData> {
  const git = getGit();

  try {
    const status: StatusResult = await git.status();

    const staged: GitFileStatus[] = [];
    const unstaged: GitFileStatus[] = [];
    const untracked: GitFileStatus[] = [];

    for (const file of status.files) {
      // Untracked
      if (file.index === "?" && file.working_dir === "?") {
        untracked.push({ path: file.path, status: "?" });
        continue;
      }

      // Staged changes (index has a status)
      if (file.index && file.index !== " " && file.index !== "?") {
        staged.push({
          path: file.path,
          status: file.index,
          ...(file.from ? { from: file.from } : {}),
        });
      }

      // Unstaged changes (working dir has a status)
      if (file.working_dir && file.working_dir !== " " && file.working_dir !== "?") {
        unstaged.push({
          path: file.path,
          status: file.working_dir,
        });
      }
    }

    return {
      isRepo: true,
      branch: status.current ?? "HEAD",
      tracking: status.tracking ?? null,
      ahead: status.ahead,
      behind: status.behind,
      staged,
      unstaged,
      untracked,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // If not a git repo, return a clean state
    if (msg.includes("not a git repository") || msg.includes("fatal")) {
      return {
        isRepo: false,
        branch: "",
        tracking: null,
        ahead: 0,
        behind: 0,
        staged: [],
        unstaged: [],
        untracked: [],
      };
    }
    throw err;
  }
}

// ── Diff ─────────────────────────────────────────────────────────────────────

export async function getDiff(file?: string): Promise<string> {
  const git = getGit();
  if (file) {
    return git.diff(["--", file]);
  }
  return git.diff();
}

export async function getDiffStaged(file?: string): Promise<string> {
  const git = getGit();
  if (file) {
    return git.diff(["--cached", "--", file]);
  }
  return git.diff(["--cached"]);
}

/** Get the diff for a specific commit (git show) */
export async function getCommitDiff(hash: string): Promise<string> {
  const git = getGit();
  return git.raw(["show", "--pretty=format:", "--no-color", hash]);
}

// ── Log ──────────────────────────────────────────────────────────────────────

export async function getLog(page: number = 0, pageSize: number = 20): Promise<GitLogData> {
  const git = getGit();
  const skip = page * pageSize;

  const log: LogResult = await git.log({
    maxCount: pageSize,
    "--skip": skip,
    "--decorate": "short" as unknown as undefined,
  });

  const entries: GitLogEntry[] = log.all.map((entry) => ({
    hash: entry.hash,
    hashShort: entry.hash.slice(0, 7),
    author: entry.author_name,
    date: entry.date,
    message: entry.message,
    refs: entry.refs,
  }));

  return {
    entries,
    total: log.total,
    page,
    pageSize,
  };
}

// ── Staging ──────────────────────────────────────────────────────────────────

export async function stage(files: string[]): Promise<void> {
  const git = getGit();
  await git.add(files);
}

export async function unstage(files: string[]): Promise<void> {
  const git = getGit();
  await git.reset(["HEAD", "--", ...files]);
}

// ── Commit ───────────────────────────────────────────────────────────────────

export async function commit(message: string): Promise<string> {
  const git = getGit();
  const result = await git.commit(message);
  return result.commit;
}

// ── Push / Pull ──────────────────────────────────────────────────────────────

export async function push(remote?: string, branch?: string): Promise<string> {
  const git = getGit();
  const args: string[] = [];
  if (remote) args.push(remote);
  if (branch) args.push(branch);
  const result = await git.push(args);
  return JSON.stringify(result);
}

export async function pull(remote?: string, branch?: string): Promise<string> {
  const git = getGit();
  const result = await git.pull(remote, branch);
  return `${result.summary.changes} changes, ${result.summary.insertions} insertions, ${result.summary.deletions} deletions`;
}

// ── Branches ─────────────────────────────────────────────────────────────────

export async function getBranches(): Promise<GitBranchData> {
  const git = getGit();
  const summary: BranchSummary = await git.branch(["-a", "--no-color"]);

  const local: GitBranchInfo[] = [];
  const remote: string[] = [];

  for (const [name, info] of Object.entries(summary.branches)) {
    if (name.startsWith("remotes/")) {
      remote.push(name.replace("remotes/", ""));
    } else {
      local.push({
        name,
        current: info.current,
        commit: info.commit,
        label: info.label,
      });
    }
  }

  return {
    current: summary.current,
    local,
    remote,
  };
}

export async function checkout(branch: string): Promise<void> {
  const git = getGit();
  await git.checkout(branch);
}

export async function createBranch(name: string, startPoint?: string): Promise<void> {
  const git = getGit();
  const args = [name];
  if (startPoint) args.push(startPoint);
  await git.checkoutLocalBranch(name);
}

// ── Remotes ──────────────────────────────────────────────────────────────────

export async function getRemotes(): Promise<GitRemoteInfo[]> {
  const git = getGit();
  const remotes = await git.getRemotes(true);
  return remotes.map((r) => ({
    name: r.name,
    fetchUrl: (r.refs as { fetch?: string }).fetch ?? "",
    pushUrl: (r.refs as { push?: string }).push ?? "",
  }));
}

export async function addRemote(name: string, url: string): Promise<void> {
  const git = getGit();
  await git.addRemote(name, url);
}

export async function removeRemote(name: string): Promise<void> {
  const git = getGit();
  await git.removeRemote(name);
}

// ── Init ─────────────────────────────────────────────────────────────────────

export async function init(): Promise<void> {
  const root = getGlobalProjectRoot();
  if (!root) throw new Error("No project root set");
  const git = simpleGit(root);
  await git.init();
}

// ── File Watcher ─────────────────────────────────────────────────────────────

const IGNORE_PATTERNS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/target/**",
  "**/.git/**",
  "**/__pycache__/**",
  "**/.next/**",
  "**/coverage/**",
];

export function startWatching(callback: StatusCallback): void {
  stopWatching();
  statusCallback = callback;

  const root = getGlobalProjectRoot();
  if (!root) return;

  watcher = watch(root, {
    ignored: IGNORE_PATTERNS,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 100,
    },
  });

  const scheduleRefresh = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      const start = Date.now();
      try {
        const status = await getStatus();
        const duration = Date.now() - start;

        // Smart debounce: adapt based on git status execution time
        if (duration > 1000) {
          debounceMs = 3000;
        } else {
          debounceMs = 500;
        }

        statusCallback?.(status);
      } catch (err) {
        console.error("[git-manager] Error refreshing status:", err);
      }
    }, debounceMs);
  };

  watcher.on("add", scheduleRefresh);
  watcher.on("change", scheduleRefresh);
  watcher.on("unlink", scheduleRefresh);

  // Also watch .git/HEAD and .git/index for branch switches and staging changes
  // (the main watcher ignores .git/**)
  const gitHead = path.join(root, ".git", "HEAD");
  const gitIndex = path.join(root, ".git", "index");
  headWatcher = watch([gitHead, gitIndex], {
    persistent: true,
    ignoreInitial: true,
  });
  headWatcher.on("change", scheduleRefresh);

  console.log(`[git-manager] Watching ${root} (debounce: ${debounceMs}ms)`);
}

export function stopWatching(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  if (headWatcher) {
    headWatcher.close();
    headWatcher = null;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  debounceMs = 500;
  statusCallback = null;
}
