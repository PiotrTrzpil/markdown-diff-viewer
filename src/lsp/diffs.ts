/**
 * Which rich diffs make sense for one Markdown file, from its git state: the working copy
 * against HEAD, the staged changes, the file against the default branch, and the last
 * commit that changed it. Each is the `md-diff` command line that shows it.
 * @module
 */

import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { dirname, relative } from "node:path";

export interface RichDiff {
  /** Code action title, e.g. "Rich diff vs main". */
  title: string;
  /** Shorter code lens title. */
  lensTitle: string;
  /** Repository root, where `md-diff` runs. */
  cwd: string;
  /** `md-diff` arguments, with the file relative to `cwd`. */
  args: string[];
}

interface GitResult {
  ok: boolean;
  stdout: string;
}

const SUBJECT_MAX = 50;

function git(cwd: string, args: string[]): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd }, (error, stdout) => {
      resolve({ ok: error === null, stdout: stdout.trimEnd() });
    });
  });
}

/** `origin/HEAD`'s branch, else a local `main` or `master`; null when there is none. */
async function defaultBranch(root: string): Promise<string | null> {
  const remote = await git(root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (remote.ok) return remote.stdout.replace(/^origin\//, "");
  for (const name of ["main", "master"]) {
    if ((await git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`])).ok) return name;
  }
  return null;
}

function clip(text: string): string {
  return text.length <= SUBJECT_MAX ? text : `${text.slice(0, SUBJECT_MAX - 1)}…`;
}

/** The diffs worth showing for `file`, an absolute path; none outside a git repository. */
export async function availableDiffs(file: string): Promise<RichDiff[]> {
  const top = await git(dirname(file), ["rev-parse", "--show-toplevel"]);
  if (!top.ok) return [];
  const root = top.stdout;
  // Resolve both, so /tmp and /private/tmp (and other symlinks) agree.
  const path = relative(await realpath(root), await realpath(file));
  const diffs: RichDiff[] = [];

  const status = await git(root, ["status", "--porcelain=v1", "--", path]);
  const [index, worktree] = [status.stdout[0] ?? " ", status.stdout[1] ?? " "];
  if (index === "?") return []; // untracked: nothing to compare against
  if (status.stdout !== "") {
    diffs.push({ title: "Rich diff vs HEAD", lensTitle: "Diff vs HEAD", cwd: root, args: ["--compare", "HEAD", path] });
  }
  if (index !== " " && worktree !== "?") {
    diffs.push({ title: "Rich diff of staged changes", lensTitle: "Staged", cwd: root, args: ["--staged", path] });
  }

  const branch = await defaultBranch(root);
  const current = await git(root, ["branch", "--show-current"]);
  if (branch !== null && current.stdout !== branch) {
    const differs = !(await git(root, ["diff", "--quiet", branch, "--", path])).ok;
    if (differs) {
      diffs.push({ title: `Rich diff vs ${branch}`, lensTitle: `vs ${branch}`, cwd: root, args: ["--compare", branch, path] });
    }
  }

  const last = await git(root, ["log", "-n", "1", "--format=%h%x00%s", "--", path]);
  if (last.ok && last.stdout !== "") {
    const [sha, subject] = last.stdout.split("\0");
    if ((await git(root, ["rev-parse", "--verify", "--quiet", `${sha}~1`])).ok) {
      diffs.push({
        title: `Rich diff of last commit (${sha} ${clip(subject)})`,
        lensTitle: `Last commit ${sha}`,
        cwd: root,
        args: ["--git", `${sha}~1`, sha, path],
      });
    }
  }
  return diffs;
}
