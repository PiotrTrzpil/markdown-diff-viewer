/**
 * Git operations for the CLI.
 */

import { execFileSync } from "node:child_process";

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
    return execFileSync("git", ["show", `${ref}:${file}`], { encoding: "utf-8" });
  } catch {
    return "";
  }
}

export function getStagedContent(file: string): string {
  try {
    return execFileSync("git", ["show", `:${file}`], { encoding: "utf-8" });
  } catch {
    return "";
  }
}

export function getChangedMdFiles(ref1: string, ref2: string, isWorkingDir = false): string[] {
  try {
    const args = isWorkingDir
      ? ["diff", "--name-only", "--diff-filter=ACMR", ref1, "--", "*.md"]
      : ["diff", "--name-only", "--diff-filter=ACMR", `${ref1}...${ref2}`, "--", "*.md"];

    const raw = execFileSync("git", args, { encoding: "utf-8" }).trim();
    return raw ? raw.split("\n").filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function getStagedMdFiles(): string[] {
  try {
    const raw = execFileSync(
      "git",
      ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "--", "*.md"],
      { encoding: "utf-8" },
    ).trim();
    return raw ? raw.split("\n").filter(Boolean) : [];
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
    const prInfo = execFileSync(
      "gh",
      ["pr", "view", prNumber, "--json", "baseRefName,headRefName"],
      { encoding: "utf-8" },
    );
    const pr = JSON.parse(prInfo);
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
