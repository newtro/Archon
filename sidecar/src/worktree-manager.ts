/**
 * Git worktree isolation manager.
 *
 * Creates, lists, and removes git worktrees so each agent task
 * can operate in an isolated branch without polluting the main working tree.
 */

import { execSync } from "node:child_process";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { randomUUID } from "node:crypto";

// ── Types ────────────────────────────────────────────────────

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
  bare: boolean;
}

// ── WorktreeManager ──────────────────────────────────────────

export class WorktreeManager {
  private readonly worktreeBase: string;

  constructor() {
    this.worktreeBase = path.join(os.tmpdir(), "archon-worktrees");
    if (!fs.existsSync(this.worktreeBase)) {
      fs.mkdirSync(this.worktreeBase, { recursive: true });
    }
  }

  /**
   * Create a new git worktree for an agent task.
   *
   * @param repoPath - Path to the main git repository
   * @param branchName - Optional branch name; defaults to `archon-agent-<uuid>`
   * @returns The path to the new worktree directory
   */
  createWorktree(repoPath: string, branchName?: string): string {
    const resolvedRepo = path.resolve(repoPath);
    const branch = branchName ?? `archon-agent-${randomUUID().slice(0, 8)}`;
    const worktreePath = path.join(this.worktreeBase, branch);

    // Create a new branch + worktree in one command
    // -b creates the branch, the path is where the worktree goes
    try {
      execSync(`git worktree add -b "${branch}" "${worktreePath}"`, {
        cwd: resolvedRepo,
        stdio: "pipe",
        encoding: "utf-8",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to create worktree: ${msg}`);
    }

    console.log(`[worktree] Created worktree at ${worktreePath} on branch ${branch}`);
    return worktreePath;
  }

  /**
   * Remove a worktree and optionally delete its branch.
   *
   * @param worktreePath - The worktree directory path to remove
   * @param deleteBranch - Whether to also delete the branch (default true)
   */
  removeWorktree(worktreePath: string, deleteBranch = true): void {
    const resolvedPath = path.resolve(worktreePath);

    // Determine the branch name before removing
    let branchName: string | null = null;
    if (deleteBranch) {
      try {
        branchName = execSync("git rev-parse --abbrev-ref HEAD", {
          cwd: resolvedPath,
          stdio: "pipe",
          encoding: "utf-8",
        }).trim();
      } catch {
        // Worktree might already be gone; that's fine
      }
    }

    // Find the main repo by looking at the worktree's common dir
    let mainRepoPath: string | null = null;
    try {
      const gitCommonDir = execSync("git rev-parse --git-common-dir", {
        cwd: resolvedPath,
        stdio: "pipe",
        encoding: "utf-8",
      }).trim();
      // git-common-dir returns the .git dir of the main repo
      mainRepoPath = path.dirname(path.resolve(resolvedPath, gitCommonDir));
    } catch {
      // Fall through
    }

    // Remove the worktree
    try {
      if (mainRepoPath) {
        execSync(`git worktree remove "${resolvedPath}" --force`, {
          cwd: mainRepoPath,
          stdio: "pipe",
          encoding: "utf-8",
        });
      }
    } catch (err) {
      // If git worktree remove fails, try manual cleanup
      console.warn(`[worktree] git worktree remove failed, cleaning up manually:`, err);
      if (fs.existsSync(resolvedPath)) {
        fs.rmSync(resolvedPath, { recursive: true, force: true });
      }
      // Prune stale worktrees
      if (mainRepoPath) {
        try {
          execSync("git worktree prune", {
            cwd: mainRepoPath,
            stdio: "pipe",
            encoding: "utf-8",
          });
        } catch {
          // Best effort
        }
      }
    }

    // Delete the branch if requested
    if (deleteBranch && branchName && mainRepoPath) {
      try {
        execSync(`git branch -D "${branchName}"`, {
          cwd: mainRepoPath,
          stdio: "pipe",
          encoding: "utf-8",
        });
      } catch {
        // Branch might not exist or might be the current branch
      }
    }

    console.log(`[worktree] Removed worktree at ${resolvedPath}`);
  }

  /**
   * List all worktrees for a given repository.
   */
  listWorktrees(repoPath: string): WorktreeInfo[] {
    const resolvedRepo = path.resolve(repoPath);

    let output: string;
    try {
      output = execSync("git worktree list --porcelain", {
        cwd: resolvedRepo,
        stdio: "pipe",
        encoding: "utf-8",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to list worktrees: ${msg}`);
    }

    const worktrees: WorktreeInfo[] = [];
    const entries = output.split("\n\n").filter((block) => block.trim());

    for (const entry of entries) {
      const lines = entry.split("\n");
      let wtPath = "";
      let head = "";
      let branch = "";
      let bare = false;

      for (const line of lines) {
        if (line.startsWith("worktree ")) {
          wtPath = line.slice("worktree ".length);
        } else if (line.startsWith("HEAD ")) {
          head = line.slice("HEAD ".length);
        } else if (line.startsWith("branch ")) {
          // branch refs/heads/main -> main
          const ref = line.slice("branch ".length);
          branch = ref.replace("refs/heads/", "");
        } else if (line === "bare") {
          bare = true;
        }
      }

      if (wtPath) {
        worktrees.push({ path: wtPath, branch, head, bare });
      }
    }

    return worktrees;
  }
}
