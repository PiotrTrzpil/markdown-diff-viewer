/**
 * Git operations for the CLI.
 */

import { execFileSync } from "node:child_process";

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] });
}

function gitLines(args: string[]): string[] {
  const raw = git(args).trim();
  return raw ? raw.split("\n").filter(Boolean) : [];
}

export function isGitRepo(): boolean {
  try {
    execFileSync("git", ["rev-parse", "--git-dir"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function getGitFileContent(ref: string, file: string): string {
  try {
    return git(["show", `${ref}:${file}`]);
  } catch {
    return "";
  }
}

export function getStagedContent(file: string): string {
  try {
    return git(["show", `:${file}`]);
  } catch {
    return "";
  }
}

/**
 * Information about a changed file, including rename detection.
 */
export interface ChangedFile {
  /** Current/new path of the file */
  path: string;
  /** Original path if file was renamed, undefined otherwise */
  oldPath?: string;
  /** Change status: A=added, M=modified, R=renamed, C=copied, D=deleted */
  status: string;
  /** Lines added (from git numstat) */
  linesAdded?: number;
  /** Lines removed (from git numstat) */
  linesRemoved?: number;
}

/**
 * Extract the new path from a git rename format.
 * Handles: "old.md => new.md" and "prefix/{old => new}/suffix.md"
 */
function extractNewPathFromRename(filePath: string): string {
  // Format 1: "prefix/{old => new}/suffix" - braces in middle of path
  const braceMatch = filePath.match(/^(.*)?\{[^}]*? => ([^}]*)\}(.*)$/);
  if (braceMatch) {
    const prefix = braceMatch[1] || "";
    const newPart = braceMatch[2];
    const suffix = braceMatch[3] || "";
    return prefix + newPart + suffix;
  }
  // Format 2: "old.md => new.md" - simple rename
  const simpleMatch = filePath.match(/.* => (.+)/);
  if (simpleMatch) {
    return simpleMatch[1];
  }
  return filePath;
}

/**
 * Get line stats (added/removed) for files from git numstat.
 */
function getNumstat(ref1: string, ref2: string, isWorkingDir = false): Map<string, { added: number; removed: number }> {
  try {
    const args = isWorkingDir
      ? ["diff", "-M", "--numstat", ref1, "--", "*.md"]
      : ["diff", "-M", "--numstat", `${ref1}...${ref2}`, "--", "*.md"];
    const lines = gitLines(args);
    const stats = new Map<string, { added: number; removed: number }>();

    for (const line of lines) {
      // Format: "3\t2\tfile.md" or "3\t2\told.md => new.md" for renames
      const parts = line.split("\t");
      const added = parseInt(parts[0], 10) || 0;
      const removed = parseInt(parts[1], 10) || 0;
      let filePath = parts[2];

      // Handle rename format: "old.md => new.md" or "prefix/{old => new}/suffix.md"
      if (filePath.includes(" => ")) {
        filePath = extractNewPathFromRename(filePath);
      }

      stats.set(filePath, { added, removed });
    }

    return stats;
  } catch {
    return new Map();
  }
}

/**
 * Get changed markdown files with rename detection.
 * Uses git's -M flag to detect renames.
 */
export function getChangedMdFilesWithRenames(ref1: string, ref2: string, isWorkingDir = false): ChangedFile[] {
  try {
    // Use --name-status to get status codes, -M to detect renames
    const args = isWorkingDir
      ? ["diff", "-M", "--name-status", "--diff-filter=ACMRD", ref1, "--", "*.md"]
      : ["diff", "-M", "--name-status", "--diff-filter=ACMRD", `${ref1}...${ref2}`, "--", "*.md"];
    const lines = gitLines(args);

    // Get line stats
    const numstats = getNumstat(ref1, ref2, isWorkingDir);

    return lines.map(line => {
      // Format: "M\tfile.md" or "R100\told.md\tnew.md"
      const parts = line.split("\t");
      const status = parts[0];

      if (status.startsWith("R") || status.startsWith("C")) {
        // Renamed or copied: status\told\tnew
        const newPath = parts[2];
        const stats = numstats.get(newPath);
        return {
          path: newPath,
          oldPath: parts[1],
          status: status[0], // Just R or C without percentage
          linesAdded: stats?.added,
          linesRemoved: stats?.removed,
        };
      } else {
        // Added, Modified, Deleted: status\tfile
        const filePath = parts[1];
        const stats = numstats.get(filePath);
        return {
          path: filePath,
          status,
          linesAdded: stats?.added,
          linesRemoved: stats?.removed,
        };
      }
    });
  } catch {
    return [];
  }
}

/**
 * Get changed markdown files (simple list, no rename info).
 * @deprecated Use getChangedMdFilesWithRenames for rename-aware diffing
 */
export function getChangedMdFiles(ref1: string, ref2: string, isWorkingDir = false): string[] {
  try {
    const args = isWorkingDir
      ? ["diff", "--name-only", "--diff-filter=ACMR", ref1, "--", "*.md"]
      : ["diff", "--name-only", "--diff-filter=ACMR", `${ref1}...${ref2}`, "--", "*.md"];
    return gitLines(args);
  } catch {
    return [];
  }
}

/**
 * Get line stats for staged files.
 */
function getStagedNumstat(): Map<string, { added: number; removed: number }> {
  try {
    const lines = gitLines(["diff", "-M", "--cached", "--numstat", "--", "*.md"]);
    const stats = new Map<string, { added: number; removed: number }>();

    for (const line of lines) {
      const parts = line.split("\t");
      const added = parseInt(parts[0], 10) || 0;
      const removed = parseInt(parts[1], 10) || 0;
      let filePath = parts[2];

      if (filePath.includes(" => ")) {
        filePath = extractNewPathFromRename(filePath);
      }

      stats.set(filePath, { added, removed });
    }

    return stats;
  } catch {
    return new Map();
  }
}

/**
 * Get staged markdown files with rename detection.
 */
export function getStagedMdFilesWithRenames(): ChangedFile[] {
  try {
    const lines = gitLines(["diff", "-M", "--cached", "--name-status", "--diff-filter=ACMRD", "--", "*.md"]);
    const numstats = getStagedNumstat();

    return lines.map(line => {
      const parts = line.split("\t");
      const status = parts[0];

      if (status.startsWith("R") || status.startsWith("C")) {
        const newPath = parts[2];
        const stats = numstats.get(newPath);
        return {
          path: newPath,
          oldPath: parts[1],
          status: status[0],
          linesAdded: stats?.added,
          linesRemoved: stats?.removed,
        };
      } else {
        const filePath = parts[1];
        const stats = numstats.get(filePath);
        return {
          path: filePath,
          status,
          linesAdded: stats?.added,
          linesRemoved: stats?.removed,
        };
      }
    });
  } catch {
    return [];
  }
}

/**
 * Get staged markdown files (simple list, no rename info).
 * @deprecated Use getStagedMdFilesWithRenames for rename-aware diffing
 */
export function getStagedMdFiles(): string[] {
  try {
    return gitLines(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "--", "*.md"]);
  } catch {
    return [];
  }
}

export interface PrInfo {
  baseRef: string;
  headRef: string;
}

export function getPrInfo(prNumber: string): PrInfo | null {
  try {
    execFileSync("gh", ["--version"], { stdio: "ignore" });
  } catch {
    return null;
  }

  try {
    const raw = execFileSync("gh", ["pr", "view", prNumber, "--json", "baseRefName,headRefName"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    });
    const pr = JSON.parse(raw);
    return { baseRef: pr.baseRefName, headRef: pr.headRefName };
  } catch {
    return null;
  }
}

export function fetchRefs(refs: string[]): void {
  try {
    execFileSync("git", ["fetch", "origin", ...refs], { stdio: "ignore" });
  } catch {
    // Ignore fetch errors
  }
}

/**
 * Expand git shortcuts like @~1, @main, @~3..@~1
 */
/**
 * Find the old path for a file if it was renamed between two refs.
 * Returns the old path if renamed, or undefined if not renamed.
 */
export function findOldPath(ref1: string, ref2: string, newPath: string, isWorkingDir = false): string | undefined {
  try {
    // Use git diff with -M to detect renames, filter for the specific file
    const args = isWorkingDir
      ? ["diff", "-M", "--name-status", "--diff-filter=R", ref1, "--", newPath]
      : ["diff", "-M", "--name-status", "--diff-filter=R", `${ref1}...${ref2}`, "--", newPath];
    const lines = gitLines(args);

    for (const line of lines) {
      // Format: "R100\told.md\tnew.md"
      const parts = line.split("\t");
      if (parts[0].startsWith("R") && parts[2] === newPath) {
        return parts[1];
      }
    }

    // If not found by filtering for newPath, search all renames
    // (git may not match when filtering by new path in some cases)
    const allArgs = isWorkingDir
      ? ["diff", "-M", "--name-status", "--diff-filter=R", ref1]
      : ["diff", "-M", "--name-status", "--diff-filter=R", `${ref1}...${ref2}`];
    const allLines = gitLines(allArgs);

    for (const line of allLines) {
      const parts = line.split("\t");
      if (parts[0].startsWith("R") && parts[2] === newPath) {
        return parts[1];
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
}

export function expandGitShortcut(arg: string): { mode: "git" | "compare"; ref1: string; ref2?: string } | null {
  if (!arg.startsWith("@")) return null;

  const shortcut = arg.slice(1);

  // @~1 or @~3 -> compare HEAD~N to HEAD
  if (/^~\d+$/.test(shortcut)) {
    return { mode: "git", ref1: `HEAD${shortcut}`, ref2: "HEAD" };
  }

  // @~3..@~1 -> compare range
  const rangeMatch = shortcut.match(/^(~\d+)\.\.(~\d+)$/);
  if (rangeMatch) {
    return { mode: "git", ref1: `HEAD${rangeMatch[1]}`, ref2: `HEAD${rangeMatch[2]}` };
  }

  // @main or @origin/main -> compare working dir to branch
  if (shortcut.length > 0) {
    return { mode: "compare", ref1: shortcut };
  }

  return null;
}
