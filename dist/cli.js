#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { resolve, basename, join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { parseMarkdown, extractBlocks } from "./parse.js";
import { diffBlocks } from "./diff.js";
import { renderDiffPairs } from "./render.js";
import { generateHtml } from "./ui/template.js";
function usage() {
    console.error(`Usage: md-diff <left.md> <right.md> [--out <output.html>]

  Compare two markdown files and show a side-by-side rich diff in the browser.

  Options:
    --out <file>   Write HTML to file instead of opening in browser
    --no-open      Don't auto-open in browser
    -h, --help     Show this help

  Git mode:
    md-diff --git <ref1> <ref2> <file>    Compare a file between two git refs
    md-diff --git HEAD~1 HEAD file.md     Compare last commit's version`);
    process.exit(1);
}
function main() {
    const args = process.argv.slice(2);
    if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
        usage();
    }
    let leftPath;
    let rightPath;
    let leftTitle;
    let rightTitle;
    let outFile = null;
    let noOpen = false;
    // Parse flags
    const flagIdx = args.indexOf("--out");
    if (flagIdx !== -1) {
        outFile = args[flagIdx + 1];
        args.splice(flagIdx, 2);
    }
    const noOpenIdx = args.indexOf("--no-open");
    if (noOpenIdx !== -1) {
        noOpen = true;
        args.splice(noOpenIdx, 1);
    }
    if (args[0] === "--git") {
        // Git mode: md-diff --git <ref1> <ref2> <file>
        if (args.length < 4) {
            console.error("Git mode requires: --git <ref1> <ref2> <file>");
            process.exit(1);
        }
        const ref1 = args[1];
        const ref2 = args[2];
        const file = args[3];
        let leftContent;
        let rightContent;
        try {
            leftContent = execSync(`git show ${ref1}:${file}`, {
                encoding: "utf-8",
            });
        }
        catch {
            console.error(`Failed to get ${file} at ref ${ref1}`);
            process.exit(1);
        }
        try {
            rightContent = execSync(`git show ${ref2}:${file}`, {
                encoding: "utf-8",
            });
        }
        catch {
            console.error(`Failed to get ${file} at ref ${ref2}`);
            process.exit(1);
        }
        leftTitle = `${ref1}:${file}`;
        rightTitle = `${ref2}:${file}`;
        return run(leftContent, rightContent, leftTitle, rightTitle, outFile, noOpen);
    }
    // File mode
    if (args.length < 2)
        usage();
    leftPath = resolve(args[0]);
    rightPath = resolve(args[1]);
    leftTitle = basename(leftPath);
    rightTitle = basename(rightPath);
    const leftContent = readFileSync(leftPath, "utf-8");
    const rightContent = readFileSync(rightPath, "utf-8");
    run(leftContent, rightContent, leftTitle, rightTitle, outFile, noOpen);
}
function run(leftContent, rightContent, leftTitle, rightTitle, outFile, noOpen) {
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
    const html = generateHtml(rows, leftTitle, rightTitle);
    // Output
    const outputPath = outFile || join(mkdtempSync(join(tmpdir(), "md-diff-")), "diff.html");
    writeFileSync(outputPath, html, "utf-8");
    console.log(`Written to: ${outputPath}`);
    if (!noOpen) {
        import("open").then((mod) => mod.default(outputPath));
    }
}
main();
