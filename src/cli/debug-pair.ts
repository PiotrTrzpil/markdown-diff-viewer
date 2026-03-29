/**
 * Debug-pair mode — inline diff diagnostics for testing diff hypotheses.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import type { DiffPair } from "../core/diff.js";
import type { InlinePart } from "../core/inline-diff.js";
import { blockToText } from "../text/parse.js";
import { c } from "./colors.js";
import { RENDER_CONFIG } from "../config.js";

function resolveArg(arg: string): { content: string; label: string } {
  if (existsSync(arg)) {
    return { content: readFileSync(resolve(arg), "utf-8"), label: basename(arg) };
  }
  return { content: arg, label: "inline" };
}

function truncate(s: string, max = 80): string {
  const oneLine = s.replace(/\n/g, "\\n");
  return oneLine.length <= max ? oneLine : oneLine.slice(0, max - 1) + "\u2026";
}

function printInlineParts(parts: InlinePart[]): void {
  for (const part of parts) {
    const typeColor = part.type === "equal" ? c.dim : part.type === "removed" ? c.red : c.green;
    const flags: string[] = [];
    if (part.minor) flags.push("minor");
    if (part.absorbLevel) flags.push(`absorb:${part.absorbLevel}`);
    if (part.children) flags.push(`children:${part.children.length}`);
    const flagStr = flags.length > 0 ? ` ${c.yellow}[${flags.join(", ")}]${c.reset}` : "";
    console.log(`    ${typeColor}${part.type.padEnd(7)}${c.reset} ${JSON.stringify(part.value)}${flagStr}`);
  }
}

function printMetricsAndLayout(sharedWords: number, totalWords: number, pair: DiffPair): void {
  const ratio = totalWords > 0 ? sharedWords / totalWords : 0;
  let sideBySide = false;
  if (pair.status === "equal" || pair.status === "split") {
    sideBySide = true;
  } else if (pair.status === "modified") {
    sideBySide =
      sharedWords > 0 &&
      (totalWords < RENDER_CONFIG.LONG_PARAGRAPH_WORDS ||
        (sharedWords >= RENDER_CONFIG.MIN_SHARED_WORDS_FOR_SIDE_BY_SIDE &&
          sharedWords / totalWords >= RENDER_CONFIG.MIN_SHARED_RATIO_FOR_SIDE_BY_SIDE));
  }

  console.log(`  ${c.bold}Metrics:${c.reset} shared=${sharedWords} total=${totalWords} ratio=${ratio.toFixed(3)}`);
  console.log(
    `  ${c.bold}Layout:${c.reset}  ${sideBySide ? `${c.green}side-by-side${c.reset}` : `${c.yellow}stacked${c.reset}`}`,
  );
  if (totalWords >= RENDER_CONFIG.LONG_PARAGRAPH_WORDS) {
    console.log(`  ${c.dim}(long: ${totalWords} words >= ${RENDER_CONFIG.LONG_PARAGRAPH_WORDS})${c.reset}`);
    const minShared = RENDER_CONFIG.MIN_SHARED_WORDS_FOR_SIDE_BY_SIDE;
    const minRatio = RENDER_CONFIG.MIN_SHARED_RATIO_FOR_SIDE_BY_SIDE;
    console.log(
      `  ${c.dim}  shared ${sharedWords} ${sharedWords >= minShared ? ">=" : "<"} ${minShared} min${c.reset}`,
    );
    console.log(`  ${c.dim}  ratio ${ratio.toFixed(3)} ${ratio >= minRatio ? ">=" : "<"} ${minRatio} min${c.reset}`);
  }
}

export function runDebugPair(
  leftArg: string,
  rightArg: string,
  getPairs: (left: string, right: string) => DiffPair[],
): void {
  const left = resolveArg(leftArg);
  const right = resolveArg(rightArg);

  console.log(`${c.bold}Left:${c.reset}  ${c.dim}${left.label}${c.reset}`);
  console.log(`${c.bold}Right:${c.reset} ${c.dim}${right.label}${c.reset}`);
  console.log();

  const pairs = getPairs(left.content, right.content);

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    const header = pairs.length > 1 ? `${c.bold}Pair ${i + 1}/${pairs.length}${c.reset} ` : "";

    switch (pair.status) {
      case "equal":
        console.log(`${header}${c.dim}equal${c.reset}   ${c.dim}${truncate(blockToText(pair.left))}${c.reset}`);
        break;
      case "removed":
        console.log(`${header}${c.red}removed${c.reset} ${truncate(blockToText(pair.left))}`);
        break;
      case "added":
        console.log(
          `${header}${c.green}added${c.reset}   ${truncate(blockToText(pair.right))}${pair.moved ? ` ${c.yellow}[moved]${c.reset}` : ""}`,
        );
        break;
      case "modified":
        console.log(`${header}${c.cyan}modified${c.reset}`);
        console.log(`  ${c.red}-${c.reset} ${truncate(blockToText(pair.left))}`);
        console.log(`  ${c.green}+${c.reset} ${truncate(blockToText(pair.right))}`);
        console.log(`  ${c.bold}Parts:${c.reset}`);
        printInlineParts(pair.inlineDiff);
        printMetricsAndLayout(pair.metrics.sharedWords, pair.metrics.totalWords, pair);
        break;
      case "split":
        console.log(`${header}${c.yellow}split${c.reset}   ${truncate(blockToText(pair.original))}`);
        console.log(`  ${c.dim}at char ${pair.splitPoint}${c.reset}`);
        break;
    }

    if (i < pairs.length - 1) console.log();
  }

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
        ]
          .filter(Boolean)
          .join(", "),
    );
  }
}
