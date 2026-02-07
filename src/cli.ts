#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { resolve, basename, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { parseMarkdown, extractBlocks } from "./parse.js";
import { diffBlocks } from "./diff.js";
import { renderDiffPairs } from "./render.js";
import { generateHtml, generateMultiFileHtml, type FileDiff } from "./ui/template.js";
import type { ThemeName } from "./ui/themes.js";

function usage(): never {
  console.error(`Usage: md-diff <left.md> <right.md> [--out <output.html>]

  Compare two markdown files and show a side-by-side rich diff in the browser.

  Options:
    --out <file>       Write HTML to file instead of opening in browser
    --out -            Write HTML to stdout
    --theme <name>     Theme: dark (default) or solar
    --no-open          Don't auto-open in browser
    --debug            Enable debug output for diff algorithm
    -h, --help         Show this help

  Git mode:
    md-diff --git <ref1> <ref2> [file]    Compare a file between two git refs
    md-diff --git HEAD~1 HEAD file.md     Compare last commit's version

  Working directory mode:
    md-diff --compare <branch> [file]     Compare working directory to a branch
    md-diff --compare main                Compare all changed .md files to main
    md-diff --compare origin/main foo.md  Compare foo.md to origin/main`);
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    usage();
  }

  let leftPath: string;
  let rightPath: string;
  let leftTitle: string;
  let rightTitle: string;
  let outFile: string | null = null;
  let noOpen = false;
  let theme: ThemeName = "dark";

  // Parse flags
  const flagIdx = args.indexOf("--out");
  if (flagIdx !== -1) {
    outFile = args[flagIdx + 1];
    args.splice(flagIdx, 2);
  }
  const themeIdx = args.indexOf("--theme");
  if (themeIdx !== -1) {
    const val = args[themeIdx + 1] as ThemeName;
    if (val !== "dark" && val !== "solar") {
      console.error(`Unknown theme "${val}". Use: dark, solar`);
      process.exit(1);
    }
    theme = val;
    args.splice(themeIdx, 2);
  }
  const noOpenIdx = args.indexOf("--no-open");
  if (noOpenIdx !== -1) {
    noOpen = true;
    args.splice(noOpenIdx, 1);
  }
  const debugIdx = args.indexOf("--debug");
  if (debugIdx !== -1) {
    (globalThis as any).__MD_DIFF_DEBUG__ = true;
    args.splice(debugIdx, 1);
  }

  if (args[0] === "--git") {
    const ref1 = args[1];
    const ref2 = args[2];

    if (!ref1 || !ref2) {
      console.error("Git mode requires: --git <ref1> <ref2> [file]");
      process.exit(1);
    }

    const file = args[3]; // optional — if omitted, diff all changed .md files

    if (file) {
      // Single file mode
      let leftContent: string;
      let rightContent: string;

      try {
        leftContent = execFileSync("git", ["show", `${ref1}:${file}`], { encoding: "utf-8" });
      } catch {
        console.error(`Failed to get ${file} at ref ${ref1}`);
        process.exit(1);
      }

      try {
        rightContent = execFileSync("git", ["show", `${ref2}:${file}`], { encoding: "utf-8" });
      } catch {
        console.error(`Failed to get ${file} at ref ${ref2}`);
        process.exit(1);
      }

      leftTitle = ref1;
      rightTitle = ref2;

      return run(leftContent, rightContent, leftTitle, rightTitle, outFile, noOpen, theme);
    } else {
      // Multi-file mode: diff all changed .md files between refs
      return runMultiGit(ref1, ref2, outFile, noOpen, theme);
    }
  }

  if (args[0] === "--compare") {
    const branch = args[1];

    if (!branch) {
      console.error("Compare mode requires: --compare <branch> [file]");
      process.exit(1);
    }

    const file = args[2]; // optional — if omitted, diff all changed .md files

    if (file) {
      // Single file mode: compare working directory file to branch version
      let leftContent: string;
      let rightContent: string;

      try {
        leftContent = execFileSync("git", ["show", `${branch}:${file}`], { encoding: "utf-8" });
      } catch {
        console.error(`Failed to get ${file} at ref ${branch}`);
        process.exit(1);
      }

      try {
        rightContent = readFileSync(resolve(file), "utf-8");
      } catch {
        console.error(`Failed to read ${file} from working directory`);
        process.exit(1);
      }

      leftTitle = branch;
      rightTitle = "working directory";

      return run(leftContent, rightContent, leftTitle, rightTitle, outFile, noOpen, theme);
    } else {
      // Multi-file mode: diff all changed .md files between branch and working dir
      return runCompareWorkingDir(branch, outFile, noOpen, theme);
    }
  }

  // File mode
  if (args.length < 2) usage();

  leftPath = resolve(args[0]);
  rightPath = resolve(args[1]);
  leftTitle = basename(leftPath);
  rightTitle = basename(rightPath);

  const leftContent = readFileSync(leftPath, "utf-8");
  const rightContent = readFileSync(rightPath, "utf-8");

  run(leftContent, rightContent, leftTitle, rightTitle, outFile, noOpen, theme);
}

function run(
  leftContent: string,
  rightContent: string,
  leftTitle: string,
  rightTitle: string,
  outFile: string | null,
  noOpen: boolean,
  theme: ThemeName
) {
  // Parse
  const leftTree = parseMarkdown(leftContent);
  const rightTree = parseMarkdown(rightContent);

  // Extract blocks
  const leftBlocks = extractBlocks(leftTree);
  const rightBlocks = extractBlocks(rightTree);

  // Diff
  const pairs = diffBlocks(leftBlocks, rightBlocks);

  // Render
  const rows = renderDiffPairs(pairs);

  // Generate HTML
  const html = generateHtml(rows, leftTitle, rightTitle, theme);

  // Output
  if (outFile === "-") {
    process.stdout.write(html);
    return;
  }

  const outputPath = outFile || join(mkdtempSync(join(tmpdir(), "md-diff-")), "diff.html");
  writeFileSync(outputPath, html, "utf-8");

  console.log(`Written to: ${outputPath}`);

  if (!noOpen) {
    import("open").then((mod) => mod.default(outputPath));
  }
}

function runMultiGit(
  ref1: string,
  ref2: string,
  outFile: string | null,
  noOpen: boolean,
  theme: ThemeName
) {
  // Get list of changed .md files between refs
  let changedFiles: string[];
  try {
    const raw = execFileSync(
      "git",
      ["diff", "--name-only", "--diff-filter=ACMR", `${ref1}...${ref2}`, "--", "*.md"],
      { encoding: "utf-8" }
    ).trim();
    changedFiles = raw ? raw.split("\n").filter(Boolean) : [];
  } catch {
    console.error(`Failed to list changed files between ${ref1} and ${ref2}`);
    process.exit(1);
  }

  if (changedFiles.length === 0) {
    console.error("No changed .md files found between the refs.");
    process.exit(0);
  }

  if (outFile !== "-") {
    console.log(`Found ${changedFiles.length} changed .md file(s):`);
    changedFiles.forEach((f) => console.log(`  ${f}`));
  }

  const fileDiffs: FileDiff[] = [];

  for (const file of changedFiles) {
    let leftContent = "";
    let rightContent = "";

    try {
      leftContent = execFileSync("git", ["show", `${ref1}:${file}`], { encoding: "utf-8" });
    } catch {
      // File might not exist in ref1 (newly added)
    }

    try {
      rightContent = execFileSync("git", ["show", `${ref2}:${file}`], { encoding: "utf-8" });
    } catch {
      // File might not exist in ref2 (deleted)
    }

    const leftTree = parseMarkdown(leftContent);
    const rightTree = parseMarkdown(rightContent);
    const leftBlocks = extractBlocks(leftTree);
    const rightBlocks = extractBlocks(rightTree);
    const pairs = diffBlocks(leftBlocks, rightBlocks);
    const rows = renderDiffPairs(pairs);

    fileDiffs.push({ path: file, rows });
  }

  const html = generateMultiFileHtml(fileDiffs, ref1, ref2, theme);

  if (outFile === "-") {
    process.stdout.write(html);
    return;
  }

  const outputPath = outFile || join(mkdtempSync(join(tmpdir(), "md-diff-")), "diff.html");
  writeFileSync(outputPath, html, "utf-8");

  console.log(`Written to: ${outputPath}`);

  if (!noOpen) {
    import("open").then((mod) => mod.default(outputPath));
  }
}

function runCompareWorkingDir(
  branch: string,
  outFile: string | null,
  noOpen: boolean,
  theme: ThemeName
) {
  // Get list of changed .md files between branch and working directory
  let changedFiles: string[];
  try {
    const raw = execFileSync(
      "git",
      ["diff", "--name-only", "--diff-filter=ACMR", branch, "--", "*.md"],
      { encoding: "utf-8" }
    ).trim();
    changedFiles = raw ? raw.split("\n").filter(Boolean) : [];
  } catch {
    console.error(`Failed to list changed files compared to ${branch}`);
    process.exit(1);
  }

  if (changedFiles.length === 0) {
    console.error(`No changed .md files found compared to ${branch}.`);
    process.exit(0);
  }

  if (outFile !== "-") {
    console.log(`Found ${changedFiles.length} changed .md file(s):`);
    changedFiles.forEach((f) => console.log(`  ${f}`));
  }

  const fileDiffs: FileDiff[] = [];

  for (const file of changedFiles) {
    let leftContent = "";
    let rightContent = "";

    try {
      leftContent = execFileSync("git", ["show", `${branch}:${file}`], { encoding: "utf-8" });
    } catch {
      // File might not exist in branch (newly added)
    }

    try {
      rightContent = readFileSync(resolve(file), "utf-8");
    } catch {
      // File might not exist in working directory (deleted)
    }

    const leftTree = parseMarkdown(leftContent);
    const rightTree = parseMarkdown(rightContent);
    const leftBlocks = extractBlocks(leftTree);
    const rightBlocks = extractBlocks(rightTree);
    const pairs = diffBlocks(leftBlocks, rightBlocks);
    const rows = renderDiffPairs(pairs);

    fileDiffs.push({ path: file, rows });
  }

  const html = generateMultiFileHtml(fileDiffs, branch, "working directory", theme);

  if (outFile === "-") {
    process.stdout.write(html);
    return;
  }

  const outputPath = outFile || join(mkdtempSync(join(tmpdir(), "md-diff-")), "diff.html");
  writeFileSync(outputPath, html, "utf-8");

  console.log(`Written to: ${outputPath}`);

  if (!noOpen) {
    import("open").then((mod) => mod.default(outputPath));
  }
}

main();
