/**
 * Project Context Loader
 * Reads project files and builds structured context for injection into LLM system prompts.
 */

import { readFile, readdir, stat } from "fs/promises";
import { join, relative, resolve } from "path";

export interface ProjectContextOptions {
  projectRoot: string;
  files: string[];
  includePatterns: string[];
  excludePatterns: string[];
  respectGitignore: boolean;
  maxTokens: number;
  outputFormat: string;
}

// Rough token estimation: ~4 chars per token on average
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Default directories to always exclude
const DEFAULT_EXCLUDES = new Set([
  "node_modules", ".git", "dist", "build", "__pycache__",
  ".venv", "venv", "target", ".next", ".DS_Store", "Thumbs.db",
  ".archon",
]);

/**
 * Parse .gitignore file into an array of patterns.
 * Returns empty array if file doesn't exist.
 */
async function loadGitignorePatterns(projectRoot: string): Promise<string[]> {
  try {
    const content = await readFile(join(projectRoot, ".gitignore"), "utf-8");
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
  } catch {
    return [];
  }
}

/**
 * Simple glob pattern matching.
 * Supports ** (any path), * (any name segment), and ? (single char).
 */
function matchesPattern(filePath: string, pattern: string): boolean {
  // Normalize path separators
  const normalizedPath = filePath.replace(/\\/g, "/");
  const normalizedPattern = pattern.replace(/\\/g, "/");

  // Convert glob to regex
  const regexStr = normalizedPattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "___DOUBLESTAR___")
    .replace(/\*/g, "[^/]*")
    .replace(/___DOUBLESTAR___/g, ".*")
    .replace(/\?/g, ".");

  try {
    const regex = new RegExp(`^${regexStr}$`);
    return regex.test(normalizedPath);
  } catch {
    return false;
  }
}

function matchesAnyPattern(filePath: string, patterns: string[]): boolean {
  return patterns.some((p) => matchesPattern(filePath, p));
}

/**
 * Recursively walk a directory and collect file paths.
 */
async function walkDirectory(
  dir: string,
  projectRoot: string,
  excludePatterns: string[],
  gitignorePatterns: string[],
): Promise<string[]> {
  const files: string[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      // Skip default excluded directories
      if (DEFAULT_EXCLUDES.has(entry.name)) continue;
      if (entry.name.startsWith(".") && entry.name !== ".archon") continue;

      const fullPath = join(dir, entry.name);
      const relativePath = relative(projectRoot, fullPath).replace(/\\/g, "/");

      // Check exclude patterns
      if (matchesAnyPattern(relativePath, excludePatterns)) continue;

      // Check gitignore patterns
      if (matchesAnyPattern(relativePath, gitignorePatterns)) continue;

      if (entry.isDirectory()) {
        const subFiles = await walkDirectory(fullPath, projectRoot, excludePatterns, gitignorePatterns);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  } catch (err) {
    console.warn(`[context-loader] Failed to read directory ${dir}:`, err);
  }

  return files;
}

/**
 * Build a tree representation of file paths.
 */
function buildTree(filePaths: string[], projectRoot: string): string {
  const relativePaths = filePaths
    .map((f) => relative(projectRoot, f).replace(/\\/g, "/"))
    .sort();

  // Build tree structure
  const tree: Record<string, boolean> = {};
  for (const p of relativePaths) {
    const parts = p.split("/");
    let current = "";
    for (let i = 0; i < parts.length; i++) {
      current = current ? `${current}/${parts[i]}` : parts[i];
      tree[current] = i === parts.length - 1; // true = file, false = directory
    }
  }

  const lines: string[] = [];
  const sorted = Object.keys(tree).sort();
  for (const path of sorted) {
    const depth = path.split("/").length - 1;
    const name = path.split("/").pop() ?? path;
    const indent = "  ".repeat(depth);
    const suffix = tree[path] ? "" : "/";
    lines.push(`${indent}${name}${suffix}`);
  }

  return lines.join("\n");
}

/**
 * Load project context based on configuration.
 * Returns formatted context string for injection into LLM system prompt.
 */
export async function loadProjectContext(options: ProjectContextOptions): Promise<string> {
  const {
    projectRoot,
    files: explicitFiles,
    includePatterns,
    excludePatterns,
    respectGitignore,
    maxTokens,
    outputFormat,
  } = options;

  const resolvedRoot = resolve(projectRoot);

  // Load gitignore patterns if enabled
  const gitignorePatterns = respectGitignore ? await loadGitignorePatterns(resolvedRoot) : [];

  // Collect files: explicit files first, then pattern-matched files
  const allFiles: string[] = [];
  const seenPaths = new Set<string>();

  // Add explicit files first (they get priority in token budget)
  for (const f of explicitFiles) {
    const fullPath = resolve(resolvedRoot, f);
    if (!seenPaths.has(fullPath)) {
      seenPaths.add(fullPath);
      allFiles.push(fullPath);
    }
  }

  // If include patterns are specified, walk the directory and match
  if (includePatterns.length > 0) {
    const walked = await walkDirectory(resolvedRoot, resolvedRoot, excludePatterns, gitignorePatterns);
    for (const f of walked) {
      if (seenPaths.has(f)) continue;
      const relativePath = relative(resolvedRoot, f).replace(/\\/g, "/");
      if (matchesAnyPattern(relativePath, includePatterns)) {
        seenPaths.add(f);
        allFiles.push(f);
      }
    }
  }

  // Read files within token budget
  const loadedFiles: Array<{ path: string; content: string; tokens: number }> = [];
  const skippedFiles: Array<{ path: string; estimatedTokens: number }> = [];
  let totalTokens = 0;

  for (const filePath of allFiles) {
    try {
      const fileStat = await stat(filePath);
      // Skip binary or very large files
      if (fileStat.size > 512 * 1024) {
        skippedFiles.push({ path: filePath, estimatedTokens: Math.ceil(fileStat.size / 4) });
        continue;
      }

      const content = await readFile(filePath, "utf-8");
      const tokens = estimateTokens(content);

      if (totalTokens + tokens > maxTokens) {
        skippedFiles.push({ path: filePath, estimatedTokens: tokens });
        continue;
      }

      loadedFiles.push({ path: filePath, content, tokens });
      totalTokens += tokens;
    } catch (err) {
      const relativePath = relative(resolvedRoot, filePath);
      console.warn(`[context-loader] [WARNING: ${relativePath} not found, skipped]`);
    }
  }

  // Format output
  const allFilePaths = [...loadedFiles.map((f) => f.path), ...skippedFiles.map((f) => f.path)];

  const parts: string[] = [];

  if (outputFormat === "tree-only" || outputFormat === "tree-and-contents") {
    parts.push("## Project Structure");
    parts.push(buildTree(allFilePaths, resolvedRoot));
    parts.push("");
  }

  if (outputFormat === "contents-only" || outputFormat === "tree-and-contents") {
    parts.push("## File Contents");
    parts.push("");
    for (const file of loadedFiles) {
      const relativePath = relative(resolvedRoot, file.path).replace(/\\/g, "/");
      parts.push(`### ${relativePath}`);
      parts.push("```");
      parts.push(file.content);
      parts.push("```");
      parts.push("");
    }
  }

  if (skippedFiles.length > 0) {
    parts.push("## Skipped (token limit reached)");
    for (const file of skippedFiles) {
      const relativePath = relative(resolvedRoot, file.path).replace(/\\/g, "/");
      parts.push(`- ${relativePath} (estimated ${file.estimatedTokens.toLocaleString()} tokens)`);
    }
  }

  return parts.join("\n");
}
