#!/usr/bin/env node
/**
 * Quality + regression checks for markdown-diff-viewer.
 *
 * Walks markdown pairs through the built engine and looks for pairing and
 * inline bugs that unit tests miss: unlike paragraphs glued into one modified
 * block, HTML comments zipped onto prose, bibliography lines with different
 * cite keys treated as one edit, reconstructed sides that drop source text,
 * and leaked protect-markdown markers.
 *
 *   node scripts/check-corpus.mjs
 *   node scripts/check-corpus.mjs left.md right.md
 *   node scripts/check-corpus.mjs --fixtures
 *   node scripts/check-corpus.mjs --git <repo> [rev] [glob]
 *   node scripts/check-corpus.mjs --against old/dist/index.js --git <repo> HEAD~1
 *
 * Exit 1 if the current engine reports quality findings. `--against` also
 * prints pairing / reconstructed-side diffs versus another build; those
 * diffs do not fail the process (a pairing change can be the fix).
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_DIST = join(ROOT, "dist/index.js");
const FIXTURES = join(ROOT, "test/fixtures");

const WORD_JOIN = "\x00";
const BOLD_OPEN = "\x02";
const BOLD_CLOSE = "\x03";
const ITALIC_OPEN = "\x04";
const ITALIC_CLOSE = "\x05";
const PROTECT_RE = /[\x00\x02-\x05]/;

/** Shared-word ratio below this, with unlike openings, is a mash not a rewrite. */
const MASH_RATIO = 0.2;
const MASH_OPENING_CHARS = 40;
const UNLIKE_SIDE_CHARS = 80;

export function unprotect(text) {
  return text
    .replaceAll(WORD_JOIN, " ")
    .replace(new RegExp(`${BOLD_OPEN}([^${BOLD_CLOSE}]*)${BOLD_CLOSE}`, "g"), "**$1**")
    .replace(new RegExp(`${ITALIC_OPEN}([^${ITALIC_CLOSE}]*)${ITALIC_CLOSE}`, "g"), "*$1*");
}

function hasNestedChildren(parts) {
  return parts.some((p) => p.children?.length);
}

/**
 * Reconstruct left (equal+removed) and right (equal+added) from an inline stream.
 * The current engine is a flat part list. Older builds nested character diffs
 * under a removed/added pair; both shapes have to round-trip to source text.
 */
export function sidesFromParts(parts) {
  if (!parts?.length) return { left: "", right: "" };
  if (hasNestedChildren(parts)) return sidesFromNested(parts);
  let left = "";
  let right = "";
  for (const part of parts) {
    if (part.type !== "added") left += part.value;
    if (part.type !== "removed") right += part.value;
  }
  return { left: unprotect(left), right: unprotect(right) };
}

function sidesFromNested(parts) {
  let left = "";
  let right = "";
  let i = 0;
  while (i < parts.length) {
    const p = parts[i];
    const n = parts[i + 1];
    if (p.type === "equal") {
      left += p.value;
      right += p.value;
      i += 1;
      continue;
    }
    if (p.type === "removed" && n?.type === "added" && (p.children || n.children)) {
      for (const c of p.children ?? [{ type: p.type, value: p.value }]) {
        if (c.type !== "added") left += c.value;
      }
      for (const c of n.children ?? [{ type: n.type, value: n.value }]) {
        if (c.type !== "removed") right += c.value;
      }
      i += 2;
      continue;
    }
    if (p.children?.length) {
      for (const c of p.children) {
        if (c.type !== "added") left += c.value;
        if (c.type !== "removed") right += c.value;
      }
    } else if (p.type === "removed") {
      left += p.value;
    } else if (p.type === "added") {
      right += p.value;
    } else {
      left += p.value;
      right += p.value;
    }
    i += 1;
  }
  return { left: unprotect(left), right: unprotect(right) };
}

export function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      return { index: i, left: a.slice(i, i + 40), right: b.slice(i, i + 40) };
    }
  }
  if (a.length !== b.length) {
    return { index: n, left: a.slice(n, n + 40), right: b.slice(n, n + 40) };
  }
  return null;
}

function norm(s) {
  return unprotect(s).replace(/\s+/g, " ").trim();
}

function citeKey(text) {
  const m = text.trim().match(/^\[cite:([^\]]+)\]/);
  return m ? m[1] : null;
}

function isHtmlComment(text) {
  return text.trimStart().startsWith("<!--");
}

function openingWords(text, n = 8) {
  return text
    .replace(/^#+\s+/, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, n)
    .map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);
}

function sharedOpeningCount(left, right) {
  const bw = new Set(openingWords(right));
  return openingWords(left).filter((w) => bw.has(w)).length;
}

/** Long rem immediately followed by long add — two openings glued into one sentence. */
export function mashOpening(parts) {
  if (!parts?.length) return null;
  const a = parts[0];
  const b = parts[1];
  if (a?.type !== "removed" || b?.type !== "added") return null;
  if (a.value.length < MASH_OPENING_CHARS || b.value.length < MASH_OPENING_CHARS) return null;
  return `${a.value.slice(0, 56).replace(/\s+/g, " ")} | ${b.value.slice(0, 56).replace(/\s+/g, " ")}`;
}

function mashFromSides(left, right, ratio) {
  if (ratio !== null && ratio >= MASH_RATIO) return null;
  if (left.length < UNLIKE_SIDE_CHARS || right.length < UNLIKE_SIDE_CHARS) return null;
  if (sharedOpeningCount(left, right) >= 2) return null;
  return `${left.slice(0, 56).replace(/\s+/g, " ")} | ${right.slice(0, 56).replace(/\s+/g, " ")}`;
}

function imageSrc(markdown) {
  const m = markdown.trim().match(/^!\[[^\]]*]\(([^)]+)\)/);
  return m ? m[1] : null;
}

function sameImage(left, right) {
  const a = imageSrc(left);
  return a !== null && a === imageSrc(right);
}

/** Longest contiguous shared word run. Used so a rewrite that keeps a clause is not a mash. */
function longestSharedRun(left, right) {
  const a = left.split(/\s+/).filter(Boolean);
  const b = right.split(/\s+/).filter(Boolean);
  if (a.length === 0 || b.length === 0) return 0;
  let best = 0;
  const prev = new Uint16Array(b.length);
  const curr = new Uint16Array(b.length);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (a[i] === b[j]) {
        curr[j] = j > 0 ? prev[j - 1] + 1 : 1;
        if (curr[j] > best) best = curr[j];
      } else {
        curr[j] = 0;
      }
    }
    prev.set(curr);
    curr.fill(0);
  }
  return best;
}

const REWRITE_SHARED_RUN = 8;

function isSkippableSide(side) {
  if (!side) return true;
  if (side.kind === "code" || side.kind === "thematicBreak") return true;
  if (side.wrapTag === "pre") return true;
  if (side.markdown.trimStart().startsWith("```")) return true;
  return false;
}

function innerMarkdown(side) {
  return side.markdown.replace(/^#+\s+/, "");
}

function preview(text, n = 60) {
  return text.slice(0, n).replace(/\n/g, " ");
}

function leftMarkdown(block) {
  return block.left?.markdown ?? block.original?.markdown ?? "";
}

function rightMarkdown(block) {
  return block.right?.markdown ?? "";
}

function sharedRatio(block) {
  if (block.metrics == null) return null;
  return block.metrics.sharedWords / Math.max(1, block.metrics.totalWords);
}

export function inspectDocument(document) {
  const findings = [];
  for (const [i, block] of document.blocks.entries()) {
    const L = leftMarkdown(block);
    const R = rightMarkdown(block);
    const ratio = sharedRatio(block);
    const parts = block.inline;

    if (block.status === "modified" && parts) {
      const rewriteNotMash = sameImage(L, R) || longestSharedRun(L, R) >= REWRITE_SHARED_RUN;
      const mash = rewriteNotMash ? null : mashOpening(parts);
      if (mash && (ratio === null || ratio < MASH_RATIO)) {
        findings.push({ kind: "mash", block: i, ratio, detail: mash });
      } else if (!rewriteNotMash) {
        const unlike = mashFromSides(L, R, ratio);
        if (unlike) findings.push({ kind: "mash", block: i, ratio, detail: unlike });
      }
      if (isHtmlComment(L) !== isHtmlComment(R)) {
        findings.push({
          kind: "html-comment-zip",
          block: i,
          ratio,
          detail: `${preview(L)} || ${preview(R)}`,
        });
      }
      const ckL = citeKey(L);
      const ckR = citeKey(R);
      if (ckL !== null && ckR !== null && ckL !== ckR) {
        findings.push({ kind: "cite-zip", block: i, ratio, detail: `${ckL} || ${ckR}` });
      }
    }

    if (!parts?.length) continue;
    const sides = sidesFromParts(parts);
    // Char-diff may split \x02...\x03 across parts; that's fine if they still
    // pair once the side is concatenated. A leak is a marker with no match
    // on that reconstructed side.
    if (PROTECT_RE.test(sides.left) || PROTECT_RE.test(sides.right)) {
      const sample = PROTECT_RE.test(sides.left) ? sides.left : sides.right;
      findings.push({
        kind: "protect-leak",
        block: i,
        ratio,
        detail: JSON.stringify(sample.slice(0, 80)),
      });
    }
    if (block.left && !isSkippableSide(block.left)) {
      const src = norm(innerMarkdown(block.left));
      const got = norm(sides.left);
      const diff = firstDiff(src, got);
      if (src.length > 20 && diff) {
        findings.push({
          kind: "inline-misses-left",
          block: i,
          ratio,
          detail: `@${diff.index} src ${JSON.stringify(diff.left)} stream ${JSON.stringify(diff.right)}`,
        });
      }
    }
    if (block.right && !isSkippableSide(block.right)) {
      const src = norm(innerMarkdown(block.right));
      const got = norm(sides.right);
      const diff = firstDiff(src, got);
      if (src.length > 20 && diff) {
        findings.push({
          kind: "inline-misses-right",
          block: i,
          ratio,
          detail: `@${diff.index} src ${JSON.stringify(diff.left)} stream ${JSON.stringify(diff.right)}`,
        });
      }
    }
  }
  return findings;
}

function blockId(block) {
  return `${block.status}|${leftMarkdown(block)}|${rightMarkdown(block)}`;
}

function blockPreview(block) {
  return preview(leftMarkdown(block) || rightMarkdown(block), 85);
}

export function compareDocuments(oldDoc, newDoc) {
  const oldMap = new Map(oldDoc.blocks.map((b) => [blockId(b), b]));
  const newMap = new Map(newDoc.blocks.map((b) => [blockId(b), b]));
  const oldOnly = oldDoc.blocks.filter((b) => !newMap.has(blockId(b))).map((b) => ({
    status: b.status,
    moved: !!b.moved,
    preview: blockPreview(b),
  }));
  const newOnly = newDoc.blocks.filter((b) => !oldMap.has(blockId(b))).map((b) => ({
    status: b.status,
    moved: !!b.moved,
    preview: blockPreview(b),
  }));
  const sideText = [];
  for (const neu of newDoc.blocks) {
    const old = oldMap.get(blockId(neu));
    if (!old?.inline || !neu.inline) continue;
    const a = sidesFromParts(old.inline);
    const b = sidesFromParts(neu.inline);
    if (a.left !== b.left || a.right !== b.right) {
      const dL = firstDiff(a.left, b.left);
      const dR = firstDiff(a.right, b.right);
      sideText.push({
        preview: preview(leftMarkdown(neu), 70),
        oldLeft: dL ? dL.left : a.left.slice(0, 90),
        newLeft: dL ? dL.right : b.left.slice(0, 90),
        oldRight: dR ? dR.left : a.right.slice(0, 90),
        newRight: dR ? dR.right : b.right.slice(0, 90),
        leftIndex: dL?.index ?? null,
        rightIndex: dR?.index ?? null,
      });
    }
  }
  return { oldOnly, newOnly, sideText };
}

export function looksLikeRev(s) {
  return /^(HEAD|@|origin\/)/.test(s) || /[~^]/.test(s) || /^[0-9a-f]{7,40}$/.test(s);
}

export function parseArgs(argv) {
  const args = {
    match: ["normal", "loose", "inline"],
    files: [],
    git: null,
    rev: null,
    glob: null,
    against: null,
    fixtures: false,
    json: false,
    help: false,
    noWorktree: false,
    toWorktree: false,
    mergeBase: null,
  };
  const take = (flag, i, argv) => {
    const v = argv[i + 1];
    if (!v || v.startsWith("-")) {
      throw new Error(`${flag} needs a value`);
    }
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--match") {
      args.match = take(a, i, argv).split(",");
      i += 1;
    } else if (a === "--against") {
      args.against = take(a, i, argv);
      i += 1;
    } else if (a === "--git") {
      args.git = take(a, i, argv);
      i += 1;
    } else if (a === "--rev") {
      args.rev = take(a, i, argv);
      i += 1;
    } else if (a === "--glob") {
      args.glob = take(a, i, argv);
      i += 1;
    } else if (a === "--merge-base") {
      args.mergeBase = take(a, i, argv);
      i += 1;
    } else if (a === "--fixtures") {
      args.fixtures = true;
    } else if (a === "--json") {
      args.json = true;
    } else if (a === "--no-worktree") {
      args.noWorktree = true;
    } else if (a === "--to-worktree") {
      args.toWorktree = true;
    } else if (a === "--help" || a === "-h") {
      args.help = true;
    } else if (a.startsWith("-")) {
      throw new Error(`Unknown flag ${a}`);
    } else {
      args.files.push(a);
    }
  }
  if (args.git) {
    const rest = args.files.slice();
    args.files = [];
    if (!args.rev && rest[0] && looksLikeRev(rest[0])) args.rev = rest.shift();
    if (!args.glob && rest[0]) args.glob = rest.shift();
    args.files = rest;
  }
  args.rev = args.rev ?? "HEAD";
  args.glob = args.glob ?? "**/*.md";
  if (args.toWorktree && args.noWorktree) {
    throw new Error("use --to-worktree or --no-worktree, not both");
  }
  return args;
}

const HELP = `Usage:
  node scripts/check-corpus.mjs [<left.md> <right.md>]
  node scripts/check-corpus.mjs --fixtures
  node scripts/check-corpus.mjs --git <repo> [--rev HEAD~1] [--glob src/guilds/chapters]
  node scripts/check-corpus.mjs --git <repo> HEAD~1 src/guilds/chapters
  node scripts/check-corpus.mjs --git <repo> --merge-base main --to-worktree src/guilds/chapters
  node scripts/check-corpus.mjs --against <old/dist/index.js> --git <repo> HEAD~1

With no files and no --git, runs --fixtures.

Options:
  --match normal,loose,inline   Match levels to run (default: those three)
  --against <dist/index.js>     Compare pairing and reconstructed sides to another build
  --fixtures                    Paired files under test/fixtures
  --merge-base <ref>            With --git, use merge-base(HEAD, ref) as the left rev
  --to-worktree                 With --git, compare that rev to the working tree
  --no-worktree                 With --git, skip HEAD vs working-tree pairs
  --json                        Machine-readable report
  -h, --help

Exit 1 if the current engine has quality findings.`;

function git(repo, ...gitArgs) {
  return execFileSync("git", ["-C", repo, ...gitArgs], { encoding: "utf8" });
}

function gitShow(repo, rev, path) {
  try {
    return git(repo, "show", `${rev}:${path}`);
  } catch {
    return "";
  }
}

function readWorktree(repo, path) {
  const full = join(repo, path);
  if (!existsSync(full)) return "";
  return readFileSync(full, "utf8");
}

function mdPaths(repo, rangeArgs, glob) {
  return git(repo, "diff", "--name-only", ...rangeArgs, "--", glob)
    .trim()
    .split("\n")
    .filter((p) => p.endsWith(".md"));
}

function walkMd(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === "dist") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkMd(p, acc);
    else if (name.endsWith(".md")) acc.push(p);
  }
  return acc;
}

const FIXTURE_PAIRS = [
  ["before.md", "after.md"],
  ["diverse-before.md", "diverse-after.md"],
  ["minor-before.md", "minor-after.md"],
  ["structural-before.md", "structural-after.md"],
  ["enclaves-old.md", "enclaves-new.md"],
];

function fixtureJobs() {
  return FIXTURE_PAIRS.map(([a, b]) => ({
    label: `fixtures ${a} -> ${b}`,
    left: readFileSync(join(FIXTURES, a), "utf8"),
    right: readFileSync(join(FIXTURES, b), "utf8"),
  }));
}

export function jobsFromArgs(args) {
  const jobs = [];
  if (args.fixtures) jobs.push(...fixtureJobs());
  if (args.git) {
    const repo = args.git;
    const glob = args.glob;
    const rev = args.mergeBase
      ? git(repo, "merge-base", "HEAD", args.mergeBase).trim()
      : args.rev;
    const revLabel = git(repo, "rev-parse", "--short", rev).trim();
    if (args.toWorktree) {
      for (const path of mdPaths(repo, [rev], glob)) {
        jobs.push({
          label: `${revLabel}..WT ${path}`,
          left: gitShow(repo, rev, path),
          right: readWorktree(repo, path),
        });
      }
    } else {
      for (const path of mdPaths(repo, [rev, "HEAD"], glob)) {
        jobs.push({
          label: `${revLabel}..HEAD ${path}`,
          left: gitShow(repo, rev, path),
          right: gitShow(repo, "HEAD", path),
        });
      }
      if (!args.noWorktree) {
        for (const path of mdPaths(repo, ["HEAD"], glob)) {
          jobs.push({
            label: `HEAD..WT ${path}`,
            left: gitShow(repo, "HEAD", path),
            right: readWorktree(repo, path),
          });
        }
      }
    }
  }
  if (args.files.length === 2 && args.files[0].endsWith(".md") && args.files[1].endsWith(".md")) {
    jobs.push({
      label: `${args.files[0]} -> ${args.files[1]}`,
      left: readFileSync(args.files[0], "utf8"),
      right: readFileSync(args.files[1], "utf8"),
    });
  } else if (args.files.length === 1) {
    const root = args.files[0];
    const st = statSync(root);
    if (st.isDirectory()) {
      for (const p of walkMd(root)) {
        const text = readFileSync(p, "utf8");
        jobs.push({ label: relative(root, p), left: text, right: text });
      }
    }
  }
  return jobs.filter((j) => j.left !== j.right);
}

function printFinding(f) {
  const ratio = f.ratio != null ? ` ratio=${f.ratio.toFixed(3)}` : "";
  console.log(`  [${f.kind}] b${f.block}${ratio}  ${f.detail}`);
}

async function loadEngine(distPath) {
  if (!existsSync(distPath)) {
    throw new Error(`Engine build not found at ${distPath}. Run pnpm run build first.`);
  }
  return import(pathToFileURL(distPath).href);
}

async function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(err.message);
    console.error(HELP);
    return 2;
  }
  if (args.help) {
    console.log(HELP);
    return 0;
  }
  if (!args.fixtures && !args.git && args.files.length === 0) {
    args.fixtures = true;
  }

  const current = await loadEngine(DEFAULT_DIST);
  const against = args.against ? await loadEngine(args.against) : null;
  const jobs = jobsFromArgs(args);
  if (jobs.length === 0) {
    console.log("No differing markdown pairs.");
    return 0;
  }

  const reports = [];
  let qualityNew = 0;
  let qualityOld = 0;
  let pairingOld = 0;
  let pairingNew = 0;
  let sideTextN = 0;

  for (const job of jobs) {
    for (const level of args.match) {
      const neu = current.diffMarkdown(job.left, job.right, { matchLevel: level });
      const quality = inspectDocument(neu.document);
      let oldQuality = [];
      let cmp = null;
      if (against) {
        const old = against.diffMarkdown(job.left, job.right, { matchLevel: level });
        oldQuality = inspectDocument(old.document);
        cmp = compareDocuments(old.document, neu.document);
      }
      qualityNew += quality.length;
      qualityOld += oldQuality.length;
      if (cmp) {
        pairingOld += cmp.oldOnly.length;
        pairingNew += cmp.newOnly.length;
        sideTextN += cmp.sideText.length;
      }
      const hasCmp = cmp && (cmp.oldOnly.length || cmp.newOnly.length || cmp.sideText.length);
      if (!quality.length && !oldQuality.length && !hasCmp) continue;
      reports.push({
        label: job.label,
        level,
        quality,
        oldQuality,
        compare: hasCmp ? cmp : null,
      });
    }
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          jobs: jobs.length,
          levels: args.match,
          quality: qualityNew,
          qualityOld: against ? qualityOld : null,
          pairingOldOnly: against ? pairingOld : null,
          pairingNewOnly: against ? pairingNew : null,
          sideText: against ? sideTextN : null,
          reports,
        },
        null,
        2,
      ),
    );
  } else {
    for (const report of reports) {
      console.log(`\n## ${report.label}  match=${report.level}`);
      if (report.oldQuality.length) {
        console.log(`quality old (${report.oldQuality.length})`);
        for (const f of report.oldQuality) printFinding(f);
      }
      if (report.quality.length) {
        console.log(`quality new (${report.quality.length})`);
        for (const f of report.quality) printFinding(f);
      }
      if (report.compare) {
        const { oldOnly, newOnly, sideText } = report.compare;
        if (oldOnly.length || newOnly.length) {
          console.log(`pairing  old-only=${oldOnly.length} new-only=${newOnly.length}`);
          for (const b of oldOnly.slice(0, 12)) {
            console.log(`  OLD ${b.status}${b.moved ? "/moved" : ""}  ${b.preview}`);
          }
          for (const b of newOnly.slice(0, 12)) {
            console.log(`  NEW ${b.status}${b.moved ? "/moved" : ""}  ${b.preview}`);
          }
        }
        if (sideText.length) {
          console.log(`inline reconstructed sides changed (${sideText.length})`);
          for (const s of sideText.slice(0, 6)) {
            console.log(`  ${s.preview}`);
            if (s.leftIndex != null) {
              console.log(`    L@${s.leftIndex} ${JSON.stringify(s.oldLeft)} -> ${JSON.stringify(s.newLeft)}`);
            }
            if (s.rightIndex != null) {
              console.log(`    R@${s.rightIndex} ${JSON.stringify(s.oldRight)} -> ${JSON.stringify(s.newRight)}`);
            }
          }
        }
      }
    }
    const againstLine = against
      ? ` quality_old=${qualityOld} pairing old/new-only=${pairingOld}/${pairingNew} side-text=${sideTextN}`
      : "";
    console.log(
      `\n${jobs.length} file-pairs × ${args.match.length} levels. quality findings: ${qualityNew}${againstLine}`,
    );
  }

  return qualityNew > 0 ? 1 : 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().then((code) => process.exit(code));
}
