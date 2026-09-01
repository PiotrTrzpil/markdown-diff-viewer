/**
 * Inline diff pipeline - character and word-level diffing within blocks.
 */
import { diffChars } from "diff";
import { type WordToken, tokenize, joinTokens, isPurePunctuation, isMinorTextChange } from "../text/tokens.js";
import type { InlinePart } from "./inline-part.js";
import { longestCommonRunNormalized, findAnchors } from "./lcs.js";
import { WORD_CONFIG } from "../config.js";
import { protectMarkdown } from "../text/protect.js";
import { debug } from "../debug.js";
import { absorbStopWordsDeclarative } from "./rewrite-rules.js";
import { optimizeBoundaries } from "./boundary-optimize.js";

// Re-export so existing consumers keep a single import site
export type { InlinePart } from "./inline-part.js";
export { walkLeafParts, flattenParts } from "./inline-part.js";

const MIN_RUN = WORD_CONFIG.MIN_ANCHOR_RUN;

/**
 * Multi-level inline diff:
 * 1. Contiguous word diff (3+ word runs only)
 * 2. For adjacent removed/added pairs, character-level diff for minor changes
 * 3. Absorb stop words isolated between changes
 */
export function computeInlineDiff(a: string, b: string): InlinePart[] {
  // Protect markdown formatting so **bold** stays atomic during diffing
  const protectedA = protectMarkdown(a);
  const protectedB = protectMarkdown(b);
  const raw = diffWordsContiguous(protectedA, protectedB);

  // Pair up adjacent removed/added — drill into char-level for minor changes
  let result: InlinePart[] = [];
  let i = 0;
  while (i < raw.length) {
    if (
      raw[i].type === "removed" &&
      i + 1 < raw.length &&
      raw[i + 1].type === "added"
    ) {
      const removed = raw[i].value;
      const added = raw[i + 1].value;

      if (isWhitespaceOnly(removed, added)) {
        result.push(...buildCharDiffPair(removed, added, false));
      } else if (isMinorTextChange(removed, added)) {
        result.push(...buildCharDiffPair(removed, added, true));
      } else {
        result.push(raw[i], raw[i + 1]);
      }
      i += 2;
    } else {
      result.push(raw[i]);
      i++;
    }
  }

  // Absorb stop words into adjacent changes, then optimize boundaries, then mark punctuation as minor
  result = absorbStopWordsDeclarative(result);
  result = optimizeBoundaries(result);
  return markPunctMinor(result);
}

/**
 * Two-phase word diff:
 * Phase 1: Find big anchors (exact match, MIN_RUN+ words)
 * Phase 2: For gaps between anchors, find smaller matches (normalized, 1+ word)
 *
 * Works on token arrays throughout — no string round-tripping.
 */
function diffWordsContiguous(left: string, right: string): InlinePart[] {
  const a = tokenize(left);
  const b = tokenize(right);
  const anchors = findAnchors(a, b, 0, a.length, 0, b.length, MIN_RUN);

  debug("diffWordsContiguous:");
  debug("  left:", JSON.stringify(left.substring(0, 60)));
  debug("  right:", JSON.stringify(right.substring(0, 60)));
  debug("  anchors:", anchors.map(an => ({ ai: an.ai, bi: an.bi, len: an.len, text: a.slice(an.ai, an.ai + an.len).map(t => t.word).join(" ") })));

  // Walk anchors, processing gaps with normalized sub-matching
  const parts: InlinePart[] = [];
  let ai = 0, bi = 0;

  for (const anchor of anchors) {
    if (ai < anchor.ai || bi < anchor.bi) {
      parts.push(...diffGap(a, b, ai, anchor.ai, bi, anchor.bi));
    }
    // Exact word match can still differ in trailing whitespace (the left
    // paragraph ended here; the right continues after a space). Taking only
    // the left raw would drop that space from the reconstructed right.
    const leftText = joinTokens(a.slice(anchor.ai, anchor.ai + anchor.len));
    const rightText = joinTokens(b.slice(anchor.bi, anchor.bi + anchor.len));
    parts.push(...emitSharedRun(leftText, rightText, false));
    ai = anchor.ai + anchor.len;
    bi = anchor.bi + anchor.len;
  }

  if (ai < a.length || bi < b.length) {
    parts.push(...diffGap(a, b, ai, a.length, bi, b.length));
  }

  debug("  parts:", parts.map(p => ({ type: p.type, minor: p.minor, value: p.value.substring(0, 30) })));
  return parts;
}

/**
 * Recursively diff a gap between anchors using normalized word matching.
 * Operates directly on token array ranges — no re-tokenization needed.
 */
function diffGap(
  a: WordToken[], b: WordToken[],
  aS: number, aE: number,
  bS: number, bE: number,
  depth: number = 0,
): InlinePart[] {
  if (aS >= aE && bS >= bE) return [];
  if (aS >= aE) return [{ value: joinTokens(b.slice(bS, bE)), type: "added" }];
  if (bS >= bE) return [{ value: joinTokens(a.slice(aS, aE)), type: "removed" }];

  const run = longestCommonRunNormalized(a, b, aS, aE, bS, bE, 1);

  if (!run) {
    return [
      { value: joinTokens(a.slice(aS, aE)), type: "removed" },
      { value: joinTokens(b.slice(bS, bE)), type: "added" },
    ];
  }

  debug("  ".repeat(depth) + "diffGap: found run", run.len, "words:", a.slice(run.ai, run.ai + run.len).map(t => t.word).join(" "));

  const result = diffGap(a, b, aS, run.ai, bS, run.bi, depth + 1);

  const remText = joinTokens(a.slice(run.ai, run.ai + run.len));
  const addText = joinTokens(b.slice(run.bi, run.bi + run.len));
  result.push(...emitSharedRun(remText, addText, true));

  result.push(...diffGap(a, b, run.ai + run.len, aE, run.bi + run.len, bE, depth + 1));
  return result;
}

// ─── Minor change handling ──────────────────────────────────────────────────

/** Mark standalone (unpaired) punctuation-only removed/added parts as minor */
function markPunctMinor(parts: InlinePart[]): InlinePart[] {
  return parts.map((p) => {
    if ((p.type === "removed" || p.type === "added") && !p.minor && isPurePunctuation(p.value)) {
      return { ...p, minor: true };
    }
    return p;
  });
}

/** Detect if the only difference is whitespace (space added/removed between tokens) */
function isWhitespaceOnly(a: string, b: string): boolean {
  return a.replace(/\s+/g, "") === b.replace(/\s+/g, "");
}

/**
 * A shared word run: one equal part when the raw text matches, otherwise a
 * character-level stream so trailing spaces (and minor spelling) survive on
 * both reconstructed sides.
 */
function emitSharedRun(leftText: string, rightText: string, minorWhenDifferent: boolean): InlinePart[] {
  if (leftText === rightText) return [{ value: leftText, type: "equal" }];
  const minor = minorWhenDifferent && !isWhitespaceOnly(leftText, rightText);
  return buildCharDiffPair(leftText, rightText, minor);
}

/**
 * Character-level stream: shared text once, deleted then added at each site.
 * Used for minor changes (case/punctuation, `minor: true`) and whitespace-only
 * changes (`minor: false` — the diff is real but token-level comparison can't see it).
 */
function buildCharDiffPair(removed: string, added: string, minor: boolean): InlinePart[] {
  const flag = minor ? { minor: true as const } : {};
  const leaves: InlinePart[] = [];
  for (const part of diffChars(removed, added)) {
    if (part.removed) {
      leaves.push({ value: part.value, type: "removed", ...flag });
    } else if (part.added) {
      leaves.push({ value: part.value, type: "added", ...flag });
    } else {
      leaves.push({ value: part.value, type: "equal" });
    }
  }
  return leaves;
}

