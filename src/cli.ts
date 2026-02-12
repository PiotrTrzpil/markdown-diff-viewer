#!/usr/bin/env node

/**
 * CLI entry point using commander.js.
 * Wires together modular components from src/cli/*.
 */

import { program } from "commander";
import { readFileSync, watchFile, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { createInterface } from "node:readline";
import { parseMarkdown, extractBlocks } from "./parse.js";
import { diffBlocks, type DiffPair } from "./diff.js";
import { renderDiffPairs } from "./render.js";
import type { FileDiff } from "./ui/template.js";
import type { ThemeName } from "./ui/themes.js";

import { c, logError, logInfo } from "./cli/colors.js";
import {
  isGitRepo,
  getGitFileContent,
  getStagedContent,
  getChangedMdFilesWithRenames,
  getStagedMdFilesWithRenames,
  getPrInfo,
  fetchRefs,
  expandGitShortcut,
  findOldPath,
  type ChangedFile,
} from "./cli/git.js";
import {
  outputSingleFile,
  outputMultiFile,
  openInBrowser,
  type OutputOptions,
} from "./cli/output.js";

// ─── Version ─────────────────────────────────────────────────────────────────

function getVersion(): string {
  try {
    const pkgPath = new URL("../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version || "unknown";
  } catch {
    return "unknown";
  }
}

const VERSION = getVersion();

// ─── Content Processing ─────────────────────────────────────────────────────

function getPairs(leftContent: string, rightContent: string): DiffPair[] {
  const leftTree = parseMarkdown(leftContent);
  const rightTree = parseMarkdown(rightContent);
  const leftBlocks = extractBlocks(leftTree);
  const rightBlocks = extractBlocks(rightTree);
  return diffBlocks(leftBlocks, rightBlocks);
}

// ─── Stdin ───────────────────────────────────────────────────────────────────

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  });
}

// ─── Interactive Mode ────────────────────────────────────────────────────────

function prompt(question: string, choices: string[]): Promise<number> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    console.log(`\n${c.bold}${question}${c.reset}`);
    choices.forEach((choice, i) => console.log(`  ${c.cyan}[${i + 1}]${c.reset} ${choice}`));
    rl.question(`\n${c.dim}Enter choice (1-${choices.length}):${c.reset} `, (answer) => {
      rl.close();
      const num = parseInt(answer, 10);
      resolve(num >= 1 && num <= choices.length ? num - 1 : 0);
    });
  });
}

// ─── Single File Mode ────────────────────────────────────────────────────────

interface SingleFileInput {
  left: { content: string; title: string; path?: string };
  right: { content: string; title: string; path?: string };
}

async function runSingleFile(input: SingleFileInput, outputOpts: OutputOptions, watch: boolean) {
  let { left, right } = input;

  const generateOutput = async () => {
    const pairs = getPairs(left.content, right.content);
    const rows = renderDiffPairs(pairs);
    return outputSingleFile(pairs, rows, left.title, right.title, outputOpts, VERSION);
  };

  const outputPath = await generateOutput();

  if (watch && left.path && right.path) {
    logInfo("Watching for changes... (Ctrl+C to stop)");
    const leftPath = left.path;
    const rightPath = right.path;

    const reloadFn = async () => {
      try {
        left = { ...left, content: readFileSync(leftPath, "utf-8") };
        right = { ...right, content: readFileSync(rightPath, "utf-8") };
        await generateOutput();
        logInfo(`[${new Date().toLocaleTimeString()}] Regenerated`);
      } catch (err) {
        logError(`Failed to reload: ${err}`);
      }
    };

    watchFile(leftPath, { interval: 500 }, reloadFn);
    watchFile(rightPath, { interval: 500 }, reloadFn);

    if (!outputOpts.noOpen && outputPath) {
      await openInBrowser(outputPath);
    }

    await new Promise(() => {}); // Keep alive
  } else if (!outputOpts.noOpen && outputPath && !outputOpts.preview && !outputOpts.json && !outputOpts.copy) {
    await openInBrowser(outputPath);
  }
}

// ─── Multi-File Mode ─────────────────────────────────────────────────────────

async function runMultiFile(
  files: Array<{ path: string; leftContent: string; rightContent: string; linesAdded?: number; linesRemoved?: number }>,
  leftTitle: string,
  rightTitle: string,
  outputOpts: OutputOptions,
) {
  const fileDiffs: FileDiff[] = [];
  const filesPairs: Array<{ path: string; pairs: DiffPair[] }> = [];

  for (const f of files) {
    const pairs = getPairs(f.leftContent, f.rightContent);
    const rows = renderDiffPairs(pairs);
    fileDiffs.push({ path: f.path, rows, added: f.linesAdded, removed: f.linesRemoved });
    filesPairs.push({ path: f.path, pairs });
  }

  const outputPath = await outputMultiFile(fileDiffs, filesPairs, leftTitle, rightTitle, outputOpts, VERSION);

  if (!outputOpts.noOpen && outputPath && !outputOpts.preview && !outputOpts.json && !outputOpts.copy) {
    await openInBrowser(outputPath);
  }
}

// ─── Git Mode ────────────────────────────────────────────────────────────────

async function runGitMode(ref1: string, ref2: string, file: string | undefined, outputOpts: OutputOptions) {
  if (file) {
    // Check if file was renamed between refs
    const oldPath = findOldPath(ref1, ref2, file);
    const leftPath = oldPath ?? file;

    const leftContent = getGitFileContent(ref1, leftPath);
    const rightContent = getGitFileContent(ref2, file);

    if (!leftContent && !rightContent) {
      logError(`File "${file}" not found in either ref`, `Check with: git show ${ref1}:${file}`);
      process.exit(1);
    }

    const leftTitle = oldPath ? `${ref1} (${oldPath})` : ref1;
    await runSingleFile({
      left: { content: leftContent, title: leftTitle },
      right: { content: rightContent, title: ref2 },
    }, outputOpts, false);
  } else {
    const changedFiles = getChangedMdFilesWithRenames(ref1, ref2);

    if (changedFiles.length === 0) {
      logInfo(`No changed .md files between ${ref1} and ${ref2}`);
      process.exit(0);
    }

    if (!outputOpts.quiet) {
      console.log(`Found ${c.bold}${changedFiles.length}${c.reset} changed .md file(s)`);
    }

    const files = changedFiles.map((f) => {
      // Use oldPath if file was renamed, otherwise use current path
      const leftPath = f.oldPath ?? f.path;
      const displayPath = f.oldPath ? `${f.oldPath} → ${f.path}` : f.path;
      return {
        path: displayPath,
        leftContent: getGitFileContent(ref1, leftPath),
        rightContent: getGitFileContent(ref2, f.path),
        linesAdded: f.linesAdded,
        linesRemoved: f.linesRemoved,
      };
    });

    await runMultiFile(files, ref1, ref2, outputOpts);
  }
}

// ─── Compare Mode ────────────────────────────────────────────────────────────

async function runCompareMode(branch: string, file: string | undefined, outputOpts: OutputOptions, watch: boolean) {
  if (file) {
    let rightContent: string;

    try {
      rightContent = readFileSync(resolve(file), "utf-8");
    } catch {
      logError(`File "${file}" not found in working directory`);
      process.exit(1);
    }

    // Check if file was renamed from branch
    const oldPath = findOldPath(branch, "", file, true);
    const leftPath = oldPath ?? file;
    const leftContent = getGitFileContent(branch, leftPath);

    if (!leftContent) {
      logError(`File "${file}" not found in branch "${branch}"`, `Check with: git show ${branch}:${file}`);
      process.exit(1);
    }

    const leftTitle = oldPath ? `${branch} (${oldPath})` : branch;
    await runSingleFile({
      left: { content: leftContent, title: leftTitle },
      right: { content: rightContent, title: "working directory", path: resolve(file) },
    }, outputOpts, watch);
  } else {
    const changedFiles = getChangedMdFilesWithRenames(branch, "", true);

    if (changedFiles.length === 0) {
      logInfo(`No changed .md files compared to ${branch}`);
      process.exit(0);
    }

    if (!outputOpts.quiet) {
      console.log(`Found ${c.bold}${changedFiles.length}${c.reset} changed .md file(s)`);
    }

    const files = changedFiles.map((f) => {
      let rightContent = "";
      try {
        rightContent = readFileSync(resolve(f.path), "utf-8");
      } catch {
        // File deleted
      }
      // Use oldPath if file was renamed, otherwise use current path
      const leftPath = f.oldPath ?? f.path;
      const displayPath = f.oldPath ? `${f.oldPath} → ${f.path}` : f.path;
      return {
        path: displayPath,
        leftContent: getGitFileContent(branch, leftPath),
        rightContent,
        linesAdded: f.linesAdded,
        linesRemoved: f.linesRemoved,
      };
    });

    await runMultiFile(files, branch, "working directory", outputOpts);
  }
}

// ─── Staged Mode ─────────────────────────────────────────────────────────────

async function runStagedMode(file: string | undefined, outputOpts: OutputOptions) {
  if (file) {
    const leftContent = getGitFileContent("HEAD", file);
    const rightContent = getStagedContent(file);

    if (!rightContent) {
      logError(`File "${file}" has no staged changes`, `Stage changes with: git add ${file}`);
      process.exit(1);
    }

    await runSingleFile({
      left: { content: leftContent, title: "HEAD" },
      right: { content: rightContent, title: "staged" },
    }, outputOpts, false);
  } else {
    const stagedFiles = getStagedMdFilesWithRenames();

    if (stagedFiles.length === 0) {
      logInfo("No staged .md files");
      process.exit(0);
    }

    if (!outputOpts.quiet) {
      console.log(`Found ${c.bold}${stagedFiles.length}${c.reset} staged .md file(s)`);
    }

    const files = stagedFiles.map((f) => {
      // Use oldPath if file was renamed, otherwise use current path
      const leftPath = f.oldPath ?? f.path;
      const displayPath = f.oldPath ? `${f.oldPath} → ${f.path}` : f.path;
      return {
        path: displayPath,
        leftContent: getGitFileContent("HEAD", leftPath),
        rightContent: getStagedContent(f.path),
        linesAdded: f.linesAdded,
        linesRemoved: f.linesRemoved,
      };
    });

    await runMultiFile(files, "HEAD", "staged", outputOpts);
  }
}

// ─── PR Mode ─────────────────────────────────────────────────────────────────

async function runPrMode(prNumber: string, outputOpts: OutputOptions) {
  const prInfo = getPrInfo(prNumber);

  if (!prInfo) {
    logError(`Failed to get PR #${prNumber}`, "Install GitHub CLI (gh) from: https://cli.github.com/");
    process.exit(1);
  }

  fetchRefs([prInfo.baseRef, prInfo.headRef]);

  if (!outputOpts.quiet) {
    console.log(`Comparing PR #${prNumber}: ${c.dim}${prInfo.baseRef}${c.reset} → ${c.bold}${prInfo.headRef}${c.reset}`);
  }

  await runGitMode(`origin/${prInfo.baseRef}`, `origin/${prInfo.headRef}`, undefined, outputOpts);
}

// ─── Interactive Mode ────────────────────────────────────────────────────────

async function runInteractiveMode(outputOpts: OutputOptions, watch: boolean) {
  if (!isGitRepo()) {
    logError("No files specified and not in a git repository", "Usage: md-diff <left.md> <right.md>");
    process.exit(1);
  }

  const choice = await prompt("No files specified. What would you like to compare?", [
    "Changed .md files vs HEAD",
    "Changed .md files vs main",
    "Changed .md files vs origin/main",
    "Staged .md files",
  ]);

  switch (choice) {
    case 0:
      await runCompareMode("HEAD", undefined, outputOpts, watch);
      break;
    case 1:
      await runCompareMode("main", undefined, outputOpts, watch);
      break;
    case 2:
      await runCompareMode("origin/main", undefined, outputOpts, watch);
      break;
    case 3:
      await runStagedMode(undefined, outputOpts);
      break;
  }
}

// ─── File Mode ───────────────────────────────────────────────────────────────

async function runFileMode(args: string[], outputOpts: OutputOptions, watch: boolean) {
  if (args.length < 2) {
    if (args[0] === "-") {
      logError("Stdin mode requires a second file", "Usage: md-diff - <right.md>");
    } else {
      logError("Two files required", "Usage: md-diff <left.md> <right.md>");
    }
    process.exit(1);
  }

  let leftContent: string;
  let rightContent: string;
  let leftTitle: string;
  let rightTitle: string;
  let leftPath: string | undefined;
  let rightPath: string | undefined;

  if (args[0] === "-") {
    leftContent = await readStdin();
    leftTitle = "stdin";
  } else {
    leftPath = resolve(args[0]);
    if (!existsSync(leftPath)) {
      logError(`File not found: ${args[0]}`);
      process.exit(1);
    }
    leftContent = readFileSync(leftPath, "utf-8");
    leftTitle = basename(leftPath);
  }

  if (args[1] === "-") {
    if (args[0] === "-") {
      logError("Cannot read both files from stdin");
      process.exit(1);
    }
    rightContent = await readStdin();
    rightTitle = "stdin";
  } else {
    rightPath = resolve(args[1]);
    if (!existsSync(rightPath)) {
      logError(`File not found: ${args[1]}`);
      process.exit(1);
    }
    rightContent = readFileSync(rightPath, "utf-8");
    rightTitle = basename(rightPath);
  }

  await runSingleFile({
    left: { content: leftContent, title: leftTitle, path: leftPath },
    right: { content: rightContent, title: rightTitle, path: rightPath },
  }, outputOpts, watch);
}

// ─── Command Setup ───────────────────────────────────────────────────────────

program
  .name("md-diff")
  .description("Side-by-side rich diff viewer for Markdown files")
  .version(VERSION, "-v, --version")
  .argument("[files...]", "Files to compare (left.md right.md)")
  .option("-o, --out <file>", "Write HTML to file (use - for stdout)")
  .option("-t, --theme <name>", "Theme: dark (default) or solar", "dark")
  .option("-q, --quiet", "Suppress non-essential output")
  .option("-w, --watch", "Watch files and regenerate on changes")
  .option("-p, --preview", "Show diff in terminal (no browser)")
  .option("-j, --json", "Output as JSON")
  .option("-c, --copy", "Copy HTML to clipboard")
  .option("--no-open", "Don't auto-open in browser")
  .option("--debug", "Enable debug output")
  .option("--git <refs...>", "Compare between git refs: --git <ref1> <ref2> [file]")
  .option("--compare <branch>", "Compare working dir to branch")
  .option("--staged", "Compare staged changes to HEAD")
  .option("--pr <number>", "Compare markdown files in a PR");

program.addHelpText(
  "after",
  `
${c.bold}Git Shortcuts${c.reset}
  md-diff @~1              Compare HEAD~1 to HEAD
  md-diff @~3..@~1         Compare commit range
  md-diff @main            Compare working dir to main
  md-diff @origin/main     Compare working dir to origin/main

${c.bold}Examples${c.reset}
  ${c.dim}# Compare two files${c.reset}
  md-diff old.md new.md

  ${c.dim}# Compare with previous commit${c.reset}
  md-diff @~1

  ${c.dim}# Compare working directory to main branch${c.reset}
  md-diff @main

  ${c.dim}# Watch mode with custom theme${c.reset}
  md-diff --watch --theme solar left.md right.md

  ${c.dim}# Quick terminal preview${c.reset}
  md-diff --preview draft.md final.md

  ${c.dim}# Pipe from stdin${c.reset}
  curl -s https://example.com/doc.md | md-diff - local.md
`,
);

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  program.parse();

  const options = program.opts();
  const args = program.args;

  // Debug mode
  if (options.debug) {
    (globalThis as Record<string, unknown>).__MD_DIFF_DEBUG__ = true;
  }

  // Validate theme
  const theme = options.theme as ThemeName;
  if (theme !== "dark" && theme !== "solar") {
    logError(`Unknown theme "${theme}"`, "Available themes: dark, solar");
    process.exit(1);
  }

  const outputOpts: OutputOptions = {
    outFile: options.out || null,
    theme,
    quiet: Boolean(options.quiet),
    noOpen: !options.open,
    json: Boolean(options.json),
    preview: Boolean(options.preview),
    copy: Boolean(options.copy),
  };

  const watch = Boolean(options.watch);

  // PR mode
  if (options.pr) {
    await runPrMode(options.pr, outputOpts);
    return;
  }

  // Staged mode
  if (options.staged) {
    await runStagedMode(args[0], outputOpts);
    return;
  }

  // Compare mode
  if (options.compare) {
    await runCompareMode(options.compare, args[0], outputOpts, watch);
    return;
  }

  // Git mode
  if (options.git) {
    const gitArgs = options.git as string[];
    if (gitArgs.length < 2) {
      logError("Git mode requires two refs", "Usage: md-diff --git <ref1> <ref2> [file]");
      process.exit(1);
    }
    await runGitMode(gitArgs[0], gitArgs[1], gitArgs[2], outputOpts);
    return;
  }

  // No arguments - interactive mode
  if (args.length === 0) {
    await runInteractiveMode(outputOpts, watch);
    return;
  }

  // Check for git shortcut (@~1, @main, etc.)
  const shortcut = expandGitShortcut(args[0]);
  if (shortcut) {
    if (shortcut.mode === "git" && shortcut.ref2) {
      await runGitMode(shortcut.ref1, shortcut.ref2, args[1], outputOpts);
    } else if (shortcut.mode === "compare") {
      await runCompareMode(shortcut.ref1, args[1], outputOpts, watch);
    }
    return;
  }

  // File mode
  await runFileMode(args, outputOpts, watch);
}

main().catch((err) => {
  logError(err.message || String(err));
  process.exit(1);
});
