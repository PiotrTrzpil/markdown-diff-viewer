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

    return lines.map(line => {
      // Format: "M\tfile.md" or "R100\told.md\tnew.md"
      const parts = line.split("\t");
      const status = parts[0];

      if (status.startsWith("R") || status.startsWith("C")) {
        // Renamed or copied: status\told\tnew
        return {
          path: parts[2],
          oldPath: parts[1],
          status: status[0], // Just R or C without percentage
        };
      } else {
        // Added, Modified, Deleted: status\tfile
        return {
          path: parts[1],
          status,
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
 * Get staged markdown files with rename detection.
 */
export function getStagedMdFilesWithRenames(): ChangedFile[] {
  try {
    const lines = gitLines(["diff", "-M", "--cached", "--name-status", "--diff-filter=ACMRD", "--", "*.md"]);

    return lines.map(line => {
      const parts = line.split("\t");
      const status = parts[0];

      if (status.startsWith("R") || status.startsWith("C")) {
        return {
          path: parts[2],
          oldPath: parts[1],
          status: status[0],
        };
      } else {
        return {
          path: parts[1],
          status,
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
