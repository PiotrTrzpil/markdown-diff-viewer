/**
 * `--debug-pair` mode: inline diff diagnostics for a pair of texts or files.
 * Runs the full pipeline and prints per-pair parts, metrics, and layout decisions.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import type { DiffPair } from "../core/diff.js";
import type { InlinePart } from "../core/inline-part.js";
import { blockToText } from "../text/parse.js";
import { isSideBySide } from "../render/layout.js";
import { RENDER_CONFIG } from "../config.js";
import { c } from "./colors.js";
import { getPairs } from "./pairs.js";

/** Resolve a debug-pair argument: if it's a file path, read it; otherwise treat as inline text */
function resolveDebugArg(arg: string): { content: string; label: string } {
  if (existsSync(arg)) {
    return { content: readFileSync(resolve(arg), "utf-8"), label: basename(arg) };
  }
  return { content: arg, label: "inline" };
}

/** Truncate text for display, adding ellipsis if needed */
function truncate(s: string, max: number = 80): string {
  const oneLine = s.replace(/\n/g, "\\n");
  return oneLine.length <= max ? oneLine : oneLine.slice(0, max - 1) + "…";
}

/** Print inline diff parts for a single pair */
function printInlineParts(parts: InlinePart[]): void {
  for (const part of parts) {
    const typeColor = part.type === "equal" ? c.dim
      : part.type === "removed" ? c.red
        : c.green;
    const flags: string[] = [];
    if (part.minor) flags.push("minor");
    if (part.absorbLevel) flags.push(`absorb:${part.absorbLevel}`);
    if (part.children) flags.push(`children:${part.children.length}`);
    const flagStr = flags.length > 0 ? ` ${c.yellow}[${flags.join(", ")}]${c.reset}` : "";
    console.log(`    ${typeColor}${part.type.padEnd(7)}${c.reset} ${JSON.stringify(part.value)}${flagStr}`);
  }
}

/** Print metrics and layout decision for a modified pair */
function printMetricsAndLayout(sharedWords: number, totalWords: number, pair: DiffPair): void {
  const ratio = totalWords > 0 ? sharedWords / totalWords : 0;
  const sideBySide = isSideBySide(pair);

  console.log(`  ${c.bold}Metrics:${c.reset} shared=${sharedWords} total=${totalWords} ratio=${ratio.toFixed(3)}`);
  console.log(`  ${c.bold}Layout:${c.reset}  ${sideBySide ? `${c.green}side-by-side${c.reset}` : `${c.yellow}stacked${c.reset}`}`);
  if (totalWords >= RENDER_CONFIG.LONG_PARAGRAPH_WORDS) {
    console.log(`  ${c.dim}(long: ${totalWords} words >= ${RENDER_CONFIG.LONG_PARAGRAPH_WORDS})${c.reset}`);
    console.log(`  ${c.dim}  shared ${sharedWords} ${sharedWords >= RENDER_CONFIG.MIN_SHARED_WORDS_FOR_SIDE_BY_SIDE ? ">=" : "<"} ${RENDER_CONFIG.MIN_SHARED_WORDS_FOR_SIDE_BY_SIDE} min${c.reset}`);
    console.log(`  ${c.dim}  ratio ${ratio.toFixed(3)} ${ratio >= RENDER_CONFIG.MIN_SHARED_RATIO_FOR_SIDE_BY_SIDE ? ">=" : "<"} ${RENDER_CONFIG.MIN_SHARED_RATIO_FOR_SIDE_BY_SIDE} min${c.reset}`);
  }
}

export function runDebugPair(leftArg: string, rightArg: string): void {
  const left = resolveDebugArg(leftArg);
  const right = resolveDebugArg(rightArg);

  console.log(`${c.bold}Left:${c.reset}  ${c.dim}${left.label}${c.reset}`);
  console.log(`${c.bold}Right:${c.reset} ${c.dim}${right.label}${c.reset}`);
  console.log();

  // Run full pipeline to get all pairs
  const pairs = getPairs(left.content, right.content);

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    const header = pairs.length > 1 ? `${c.bold}Pair ${i + 1}/${pairs.length}${c.reset} ` : "";

    switch (pair.status) {
      case "equal": {
        const text = blockToText(pair.left);
        console.log(`${header}${c.dim}equal${c.reset}   ${c.dim}${truncate(text)}${c.reset}`);
        break;
      }
      case "removed": {
        const text = blockToText(pair.left);
        console.log(`${header}${c.red}removed${c.reset} ${truncate(text)}`);
        break;
      }
      case "added": {
        const text = blockToText(pair.right);
        console.log(`${header}${c.green}added${c.reset}   ${truncate(text)}${pair.moved ? ` ${c.yellow}[moved]${c.reset}` : ""}`);
        break;
      }
      case "modified": {
        const leftText = blockToText(pair.left);
        const rightText = blockToText(pair.right);
        console.log(`${header}${c.cyan}modified${c.reset}`);
        console.log(`  ${c.red}-${c.reset} ${truncate(leftText)}`);
        console.log(`  ${c.green}+${c.reset} ${truncate(rightText)}`);
        console.log(`  ${c.bold}Parts:${c.reset}`);
        printInlineParts(pair.inlineDiff);
        printMetricsAndLayout(pair.metrics.sharedWords, pair.metrics.totalWords, pair);
        break;
      }
      case "split": {
        const text = blockToText(pair.original);
        console.log(`${header}${c.yellow}split${c.reset}   ${truncate(text)}`);
        console.log(`  ${c.dim}at char ${pair.splitPoint}${c.reset}`);
        break;
      }
    }

    if (i < pairs.length - 1) console.log();
  }

  // Summary for multi-pair output
  if (pairs.length > 1) {
    const counts = { equal: 0, removed: 0, added: 0, modified: 0, split: 0 };
    for (const p of pairs) counts[p.status]++;
    console.log();
    console.log(
      `${c.bold}Summary:${c.reset} ${pairs.length} pairs — ` +
      [
        counts.equal && `${counts.equal} equal`,
        counts.modified && `${c.cyan}${counts.modified} modified${c.reset}`,
        counts.removed && `${c.red}${counts.removed} removed${c.reset}`,
        counts.added && `${c.green}${counts.added} added${c.reset}`,
        counts.split && `${c.yellow}${counts.split} split${c.reset}`,
      ].filter(Boolean).join(", "),
    );
  }
}
