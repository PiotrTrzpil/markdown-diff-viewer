/**
 * Output handlers for different formats (HTML, JSON, preview, clipboard).
 */

import { writeFileSync, mkdtempSync } from "node:fs";
import { join, dirname as pathDirname } from "node:path";
import { homedir, tmpdir } from "node:os";
import { execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import type { DiffPair } from "../core/diff.js";
import { c, logSuccess, logError } from "./colors.js";
import { computeStats, aggregateStats, formatStats, extractTextFromNode } from "./stats.js";
import { serializeDiffData } from "../serialize/serialize.js";
import { generateCanvasHtml } from "../canvas/shell.js";

import type { UISettings } from "./index.js";

export type ThemeName = "dark" | "solar";

export interface OutputOptions {
  outFile: string | null;
  theme: ThemeName;
  quiet: boolean;
  noOpen: boolean;
  json: boolean;
  preview: boolean;
  copy: boolean;
  inspect: boolean;
  projectRoot?: string;
  uiSettings?: UISettings;
  command?: string;
}

// ─── Terminal Preview ───────────────────────────────────────────────────────

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

// ─── Canvas Bundle ──────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = pathDirname(__filename);

let _cachedBundle: string | null = null;

/** Bundle canvas client modules on-demand via esbuild. In-memory cache per process. */
function getBundledClientJs(): string {
  if (_cachedBundle) return _cachedBundle;

  const entryPoint = join(__dirname, "..", "..", "src", "canvas", "app.ts");
  const result = buildSync({
    entryPoints: [entryPoint],
    bundle: true,
    format: "iife",
    globalName: "__canvasApp",
    platform: "browser",
    target: ["es2022"],
    minify: false,
    write: false,
    loader: { ".ts": "ts" },
  });

  _cachedBundle = result.outputFiles[0]!.text + "\n__canvasApp.boot();\n";
  return _cachedBundle;
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
  leftTitle: string,
  rightTitle: string,
  opts: OutputOptions,
  version: string,
): Promise<string | undefined> {
  const stats = computeStats(pairs);

  if (opts.preview) {
    console.log(`\n${c.bold}${leftTitle}${c.reset} ${c.dim}→${c.reset} ${c.bold}${rightTitle}${c.reset}\n`);
    console.log(renderPreview(pairs));
    console.log(`\n${formatStats(stats)}\n`);
    return;
  }

  const diffData = serializeDiffData(
    [{ path: leftTitle, pairs }],
    { ...(opts.uiSettings ?? {}), theme: opts.theme },
    { leftTitle, rightTitle, projectRoot: opts.projectRoot, command: opts.command, version },
  );

  if (opts.json) {
    const json = JSON.stringify(diffData, null, 2);
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

  const html = generateCanvasHtml(diffData, getBundledClientJs());

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

  if (opts.outFile === "-") {
    process.stdout.write(html);
    return;
  }

  const outputPath = opts.outFile || join(mkdtempSync(join(tmpdir(), "md-diff-")), "diff.html");
  writeFileSync(outputPath, html, "utf-8");

  log(`${c.dim}Written to:${c.reset} ${outputPath}`, opts.quiet);
  log(formatStats(stats), opts.quiet);

  return outputPath;
}

export async function outputMultiFile(
  filesPairs: Array<{ path: string; pairs: DiffPair[]; added?: number; removed?: number }>,
  leftTitle: string,
  rightTitle: string,
  opts: OutputOptions,
  version: string,
): Promise<string | undefined> {
  const stats = aggregateStats(filesPairs.map((f) => computeStats(f.pairs)));

  if (opts.preview) {
    for (const { path, pairs } of filesPairs) {
      console.log(`\n${c.bold}${path}${c.reset}`);
      console.log(renderPreview(pairs));
    }
    console.log(`\n${formatStats(stats)}\n`);
    return;
  }

  const diffData = serializeDiffData(
    filesPairs,
    { ...(opts.uiSettings ?? {}), theme: opts.theme },
    { leftTitle, rightTitle, projectRoot: opts.projectRoot, command: opts.command, version },
  );

  if (opts.json) {
    const json = JSON.stringify(diffData, null, 2);
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

  const html = generateCanvasHtml(diffData, getBundledClientJs());

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

  if (opts.outFile === "-") {
    process.stdout.write(html);
    return;
  }

  const outputPath = opts.outFile || join(mkdtempSync(join(tmpdir(), "md-diff-")), "diff.html");
  writeFileSync(outputPath, html, "utf-8");

  log(`${c.dim}Written to:${c.reset} ${outputPath}`, opts.quiet);
  log(formatStats(stats), opts.quiet);

  return outputPath;
}

export async function openInBrowser(path: string, inspect = false): Promise<void> {
  if (inspect) {
    await openInChromeDebug(path);
  } else {
    const mod = await import("open");
    await mod.default(path);
  }
}

const CHROME_PATHS: Record<string, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ],
  linux: ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ],
};

function findChrome(): string | null {
  const candidates = CHROME_PATHS[process.platform] ?? [];
  for (const candidate of candidates) {
    try {
      execSync(`"${candidate}" --version`, { stdio: "ignore" });
      return candidate;
    } catch {
      /* not found, try next */
    }
  }
  return null;
}

async function openInChromeDebug(path: string, port = 9222): Promise<void> {
  const chrome = findChrome();
  if (!chrome) {
    logError("Chrome not found", "Install Google Chrome to use --inspect");
    process.exit(1);
  }

  const userDataDir = join(homedir(), ".md-diff-chrome-profile");
  const url = path.startsWith("http") ? path : `file://${path}`;
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    url,
  ];

  const child = spawn(chrome, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  logSuccess(`Chrome opened with remote debugging on port ${port}`);
  console.log(`  ${c.dim}Connect with:${c.reset} ./browse.sh`);
}
