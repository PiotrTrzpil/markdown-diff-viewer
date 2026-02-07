/**
 * Output handlers for different formats (HTML, JSON, preview, clipboard).
 */

import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import type { DiffPair } from "../diff.js";
import type { RenderedRow } from "../render.js";
import { generateHtml, generateMultiFileHtml, type FileDiff } from "../ui/template.js";
import type { ThemeName } from "../ui/themes.js";
import { c, logSuccess, logError } from "./colors.js";
import { computeStats, formatStats, type DiffStats } from "./stats.js";

export interface OutputOptions {
  outFile: string | null;
  theme: ThemeName;
  quiet: boolean;
  noOpen: boolean;
  json: boolean;
  preview: boolean;
  copy: boolean;
}

// ─── Terminal Preview ───────────────────────────────────────────────────────

function extractTextFromNode(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as Record<string, unknown>;
  if (typeof n["value"] === "string") return n["value"];
  if (Array.isArray(n["children"])) {
    return n["children"].map(extractTextFromNode).join(" ");
  }
  return "";
}

export function renderPreview(pairs: DiffPair[]): string {
  const lines: string[] = [];

  for (const pair of pairs) {
    switch (pair.status) {
      case "equal": {
        if (pair.left) {
          const text = extractTextFromNode(pair.left).substring(0, 80);
          lines.push(`${c.dim}  ${text}${text.length >= 80 ? "..." : ""}${c.reset}`);
        }
        break;
      }
      case "removed": {
        if (pair.left) {
          const text = extractTextFromNode(pair.left).substring(0, 80);
          lines.push(`${c.red}- ${text}${text.length >= 80 ? "..." : ""}${c.reset}`);
        }
        break;
      }
      case "added": {
        if (pair.right) {
          const text = extractTextFromNode(pair.right).substring(0, 80);
          lines.push(`${c.green}+ ${text}${text.length >= 80 ? "..." : ""}${c.reset}`);
        }
        break;
      }
      case "modified": {
        if (pair.inlineDiff) {
          let leftLine = "";
          let rightLine = "";
          for (const part of pair.inlineDiff) {
            if (part.type === "equal") {
              leftLine += part.value;
              rightLine += part.value;
            } else if (part.type === "removed") {
              leftLine += `${c.red}${c.bold}${part.value}${c.reset}`;
            } else if (part.type === "added") {
              rightLine += `${c.green}${c.bold}${part.value}${c.reset}`;
            }
          }
          lines.push(`${c.red}- ${leftLine.substring(0, 100)}${leftLine.length >= 100 ? "..." : ""}${c.reset}`);
          lines.push(`${c.green}+ ${rightLine.substring(0, 100)}${rightLine.length >= 100 ? "..." : ""}${c.reset}`);
        }
        break;
      }
    }
  }

  return lines.join("\n");
}

// ─── JSON Output ────────────────────────────────────────────────────────────

export function generateJson(
  pairs: DiffPair[],
  leftTitle: string,
  rightTitle: string,
  version: string,
): string {
  const stats = computeStats(pairs);
  return JSON.stringify({ version, leftTitle, rightTitle, stats, pairs }, null, 2);
}

export function generateMultiFileJson(
  files: Array<{ path: string; pairs: DiffPair[] }>,
  leftTitle: string,
  rightTitle: string,
  version: string,
  stats: DiffStats,
): string {
  return JSON.stringify({ version, leftTitle, rightTitle, stats, files }, null, 2);
}

// ─── Clipboard ──────────────────────────────────────────────────────────────

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    const platform = process.platform;
    if (platform === "darwin") {
      execSync("pbcopy", { input: text });
    } else if (platform === "linux") {
      execSync("xclip -selection clipboard", { input: text });
    } else if (platform === "win32") {
      execSync("clip", { input: text });
    } else {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ─── Output Handlers ────────────────────────────────────────────────────────

function log(msg: string, quiet: boolean): void {
  if (!quiet) console.log(msg);
}

export async function outputSingleFile(
  pairs: DiffPair[],
  rows: RenderedRow[],
  leftTitle: string,
  rightTitle: string,
  opts: OutputOptions,
  version: string,
): Promise<string | undefined> {
  const stats = computeStats(pairs);

  // Preview mode
  if (opts.preview) {
    console.log(`\n${c.bold}${leftTitle}${c.reset} ${c.dim}→${c.reset} ${c.bold}${rightTitle}${c.reset}\n`);
    console.log(renderPreview(pairs));
    console.log(`\n${formatStats(stats)}\n`);
    return;
  }

  // JSON mode
  if (opts.json) {
    const json = generateJson(pairs, leftTitle, rightTitle, version);
    if (opts.outFile === "-") {
      process.stdout.write(json);
    } else if (opts.outFile) {
      writeFileSync(opts.outFile, json, "utf-8");
      logSuccess(`JSON written to: ${opts.outFile}`);
    } else {
      console.log(json);
    }
    return;
  }

  const html = generateHtml(rows, leftTitle, rightTitle, opts.theme);

  // Copy mode
  if (opts.copy) {
    const success = await copyToClipboard(html);
    if (success) {
      logSuccess("HTML copied to clipboard");
      log(formatStats(stats), opts.quiet);
    } else {
      logError("Failed to copy to clipboard", "Install xclip (Linux) or use a supported platform");
    }
    return;
  }

  // Stdout mode
  if (opts.outFile === "-") {
    process.stdout.write(html);
    return;
  }

  // File output
  const outputPath = opts.outFile || join(mkdtempSync(join(tmpdir(), "md-diff-")), "diff.html");
  writeFileSync(outputPath, html, "utf-8");

  log(`${c.dim}Written to:${c.reset} ${outputPath}`, opts.quiet);
  log(formatStats(stats), opts.quiet);

  return outputPath;
}

export async function outputMultiFile(
  fileDiffs: FileDiff[],
  filesPairs: Array<{ path: string; pairs: DiffPair[] }>,
  leftTitle: string,
  rightTitle: string,
  opts: OutputOptions,
  version: string,
  stats: DiffStats,
): Promise<string | undefined> {
  // Preview mode
  if (opts.preview) {
    for (const { path, pairs } of filesPairs) {
      console.log(`\n${c.bold}${path}${c.reset}`);
      console.log(renderPreview(pairs));
    }
    console.log(`\n${formatStats(stats)}\n`);
    return;
  }

  // JSON mode
  if (opts.json) {
    const json = generateMultiFileJson(filesPairs, leftTitle, rightTitle, version, stats);
    if (opts.outFile === "-") {
      process.stdout.write(json);
    } else if (opts.outFile) {
      writeFileSync(opts.outFile, json, "utf-8");
      logSuccess(`JSON written to: ${opts.outFile}`);
    } else {
      console.log(json);
    }
    return;
  }

  const html = generateMultiFileHtml(fileDiffs, leftTitle, rightTitle, opts.theme);

  // Copy mode
  if (opts.copy) {
    const success = await copyToClipboard(html);
    if (success) {
      logSuccess("HTML copied to clipboard");
      log(formatStats(stats), opts.quiet);
    } else {
      logError("Failed to copy to clipboard");
    }
    return;
  }

  // Stdout mode
  if (opts.outFile === "-") {
    process.stdout.write(html);
    return;
  }

  // File output
  const outputPath = opts.outFile || join(mkdtempSync(join(tmpdir(), "md-diff-")), "diff.html");
  writeFileSync(outputPath, html, "utf-8");

  log(`${c.dim}Written to:${c.reset} ${outputPath}`, opts.quiet);
  log(formatStats(stats), opts.quiet);

  return outputPath;
}

export async function openInBrowser(path: string): Promise<void> {
  const mod = await import("open");
  await mod.default(path);
}
