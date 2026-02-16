/**
 * Inline diff pipeline - character and word-level diffing within blocks.
 */
import { diffChars } from "diff";
import { type WordToken, tokenize, joinTokens, isPurePunctuation } from "../text/tokens.js";
import { isOnlyStopWords } from "../text/stopwords.js";
import { longestCommonRunNormalized, findAnchors } from "./lcs.js";
import { WORD_CONFIG } from "../config.js";
import { protectMarkdown } from "../text/html.js";
import { debug } from "../debug.js";
import { markAbsorbableParts } from "./rewrite-rules.js";
import { optimizeBoundaries } from "./boundary-optimize.js";

export interface InlinePart {
  value: string;
  type: "equal" | "added" | "removed";
  /** Character-level sub-diff within a changed word/phrase */
  children?: InlinePart[];
  /**
   * True if the change is minor (case-only, punctuation-only).
   * Set during diff computation when normalized words match.
   * Can also be computed at render time via isMinorChange().
   */
  minor?: boolean;
  /**
   * Indicates this part should be absorbed at a given merge level.
   * - "stopword": Absorbed in conservative mode (stop words between changes)
   * - "single": Absorbed only in aggressive mode (single words between large changes)
   */
  absorbLevel?: "stopword" | "single";
}

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

      if (isMinorChange(removed, added)) {
        result.push(...buildMinorPair(removed, added));
      } else {
        result.push(...refinePair(removed, added));
      }
      i += 2;
    } else {
      result.push(raw[i]);
      i++;
    }
  }

  // Mark absorbable parts (for CSS-based runtime control), then optimize boundaries, then mark punctuation as minor
  result = markAbsorbableParts(result);
  result = optimizeBoundaries(result);
  return markPunctMinor(result);
}

/**
 * Custom word diff requiring contiguous runs of MIN_RUN+ words to match.
 * Eliminates scattered coincidental single-word matches from diffWords.
 */
function diffWordsContiguous(left: string, right: string): InlinePart[] {
  const a = tokenize(left);
  const b = tokenize(right);
  const anchors = findAnchors(a, b, 0, a.length, 0, b.length, MIN_RUN);

  debug("diffWordsContiguous:");
  debug("  left:", JSON.stringify(left.substring(0, 60)));
  debug("  right:", JSON.stringify(right.substring(0, 60)));
  debug("  anchors:", anchors.map(an => ({ ai: an.ai, bi: an.bi, len: an.len, text: a.slice(an.ai, an.ai + an.len).map(t => t.word).join(" ") })));

  const parts: InlinePart[] = [];
  let ai = 0, bi = 0;

  for (const anchor of anchors) {
    if (ai < anchor.ai) {
      parts.push({ value: joinTokens(a.slice(ai, anchor.ai)), type: "removed" });
    }
    if (bi < anchor.bi) {
      parts.push({ value: joinTokens(b.slice(bi, anchor.bi)), type: "added" });
    }
    parts.push({ value: joinTokens(a.slice(anchor.ai, anchor.ai + anchor.len)), type: "equal" });
    ai = anchor.ai + anchor.len;
    bi = anchor.bi + anchor.len;
  }

  if (ai < a.length) {
    parts.push({ value: joinTokens(a.slice(ai)), type: "removed" });
  }
  if (bi < b.length) {
    parts.push({ value: joinTokens(b.slice(bi)), type: "added" });
  }

  debug("  raw parts:", parts.map(p => ({ type: p.type, value: p.value.substring(0, 30) })));

  // Post-process: extract common prefix/suffix from adjacent removed+added pairs
  const result = extractCommonWords(parts);
  debug("  after extractCommonWords:", result.map(p => ({ type: p.type, minor: p.minor, value: p.value.substring(0, 30) })));
  return result;
}

/**
 * Extract common words from adjacent removed+added pairs using recursive LCS.
 * Finds common prefix, suffix, AND internal common word runs.
 */
function extractCommonWords(parts: InlinePart[]): InlinePart[] {
  const result: InlinePart[] = [];
  let i = 0;

  while (i < parts.length) {
    // Look for adjacent removed+added pairs
    if (
      parts[i].type === "removed" &&
      i + 1 < parts.length &&
      parts[i + 1].type === "added"
    ) {
      const removedTokens = tokenize(parts[i].value);
      const addedTokens = tokenize(parts[i + 1].value);

      debug("extractCommonWords: processing pair");
      debug("  removed:", parts[i].value.substring(0, 40));
      debug("  added:", parts[i + 1].value.substring(0, 40));
      debug("  removed tokens:", removedTokens.map(t => t.word));
      debug("  added tokens:", addedTokens.map(t => t.word));

      // Use recursive LCS to find all common word runs
      const diffParts = diffTokensRecursive(removedTokens, addedTokens, 0, removedTokens.length, 0, addedTokens.length);
      result.push(...diffParts);

      i += 2;
    } else {
      result.push(parts[i]);
      i++;
    }
  }

  return result;
}

/**
 * Recursively diff two token arrays using LCS to find common runs.
 * Uses MIN_INTERNAL_RUN (1 word) for internal matching to catch isolated common words.
 */
function diffTokensRecursive(
  a: WordToken[], b: WordToken[],
  aS: number, aE: number,
  bS: number, bE: number,
  depth: number = 0,
): InlinePart[] {
  const MIN_INTERNAL_RUN = 1; // Match single words internally

  if (aS >= aE && bS >= bE) return [];
  if (aS >= aE) {
    return [{ value: joinTokens(b.slice(bS, bE)), type: "added" }];
  }
  if (bS >= bE) {
    return [{ value: joinTokens(a.slice(aS, aE)), type: "removed" }];
  }

  // Find longest common run using normalized comparison
  const run = longestCommonRunNormalized(a, b, aS, aE, bS, bE, MIN_INTERNAL_RUN);

  if (!run) {
    // No common run found - emit as removed+added
    const result: InlinePart[] = [];
    result.push({ value: joinTokens(a.slice(aS, aE)), type: "removed" });
    result.push({ value: joinTokens(b.slice(bS, bE)), type: "added" });
    return result;
  }

  debug("  ".repeat(depth) + "diffTokensRecursive: found run", run.len, "words:", a.slice(run.ai, run.ai + run.len).map(t => t.word).join(" "));

  // Recursively process before the match
  const result = diffTokensRecursive(a, b, aS, run.ai, bS, run.bi, depth + 1);

  // Add the matching run
  const remMatch = joinTokens(a.slice(run.ai, run.ai + run.len));
  const addMatch = joinTokens(b.slice(run.bi, run.bi + run.len));
  if (remMatch === addMatch) {
    result.push({ value: remMatch, type: "equal" });
  } else {
    // Words match when normalized but differ in punctuation/case
    result.push({ value: remMatch, type: "removed", minor: true });
    result.push({ value: addMatch, type: "added", minor: true });
  }

  // Recursively process after the match
  result.push(...diffTokensRecursive(a, b, run.ai + run.len, aE, run.bi + run.len, bE, depth + 1));

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

/**
 * Build a minor (case-only / punctuation-only) removed+added pair with char children.
 * Sets minor flag for stop-word absorption and render styling.
 */
function buildMinorPair(removed: string, added: string): InlinePart[] {
  const charDiff = diffChars(removed, added);
  const removedChildren: InlinePart[] = [];
  const addedChildren: InlinePart[] = [];

  for (const part of charDiff) {
    if (!part.added && !part.removed) {
      removedChildren.push({ value: part.value, type: "equal" });
      addedChildren.push({ value: part.value, type: "equal" });
    } else if (part.removed) {
      removedChildren.push({ value: part.value, type: "removed", minor: true });
    } else if (part.added) {
      addedChildren.push({ value: part.value, type: "added", minor: true });
    }
  }

  return [
    { value: removed, type: "removed", children: removedChildren, minor: true },
    { value: added, type: "added", children: addedChildren, minor: true },
  ];
}

/**
 * For a non-minor removed/added pair, use contiguous word diff (min run 1)
 * to find sub-segments that are case-only changes vs truly removed/added.
 */
function refinePair(removed: string, added: string): InlinePart[] {
  const remTokens = tokenize(removed);
  const addTokens = tokenize(added);
  const a = tokenize(removed.toLowerCase());
  const b = tokenize(added.toLowerCase());
  // Use min run of 1 to catch single-word case changes
  const rawAnchors = findAnchors(a, b, 0, a.length, 0, b.length, 1);

  // Filter out anchors that are ONLY stop words - we don't want to split on them
  const anchors = rawAnchors.filter((anchor) => {
    const words = a.slice(anchor.ai, anchor.ai + anchor.len).map((t) => t.word);
    return !words.every((w) => isOnlyStopWords(w));
  });

  if (anchors.length === 0) {
    // No shared runs — just emit as-is
    return [
      { value: removed, type: "removed" },
      { value: added, type: "added" },
    ];
  }

  const parts: InlinePart[] = [];
  let remPos = 0, addPos = 0;

  for (const anchor of anchors) {
    // Removed text before this anchor
    const remBeforeTokens = anchor.ai - remPos;
    if (remBeforeTokens > 0) {
      const remSlice = remTokens.slice(remPos, anchor.ai);
      const text = joinTokens(remSlice);
      if (text) parts.push({ value: text, type: "removed" });
    }
    // Added text before this anchor
    const addBeforeTokens = anchor.bi - addPos;
    if (addBeforeTokens > 0) {
      const addSlice = addTokens.slice(addPos, anchor.bi);
      const text = joinTokens(addSlice);
      if (text) parts.push({ value: text, type: "added" });
    }

    // Equal segment — compare original case
    const remSlice = joinTokens(remTokens.slice(anchor.ai, anchor.ai + anchor.len));
    const addSlice = joinTokens(addTokens.slice(anchor.bi, anchor.bi + anchor.len));

    if (remSlice === addSlice) {
      parts.push({ value: remSlice, type: "equal" });
    } else {
      // Case-only or punctuation-only change
      parts.push(...buildMinorPair(remSlice, addSlice));
    }

    remPos = anchor.ai + anchor.len;
    addPos = anchor.bi + anchor.len;
  }

  // Remaining
  const remRemaining = joinTokens(remTokens.slice(remPos));
  const addRemaining = joinTokens(addTokens.slice(addPos));
  if (remRemaining) parts.push({ value: remRemaining, type: "removed" });
  if (addRemaining) parts.push({ value: addRemaining, type: "added" });

  // Mark absorbable parts within the refined parts
  return markAbsorbableParts(parts);
}

/** Detect if a change is minor: case-only, punctuation-only, or pure-punctuation swap */
function isMinorChange(a: string, b: string): boolean {
  if (a.toLowerCase() === b.toLowerCase()) return true;
  // Strip punctuation and normalize whitespace
  const strip = (s: string) => s.replace(/[^a-zA-Z0-9\s]/g, "").replace(/\s+/g, " ").trim();
  if (strip(a) === strip(b)) return true;
  if (strip(a).toLowerCase() === strip(b).toLowerCase()) return true;
  if (isPurePunctuation(a) && isPurePunctuation(b)) return true;
  return false;
}

