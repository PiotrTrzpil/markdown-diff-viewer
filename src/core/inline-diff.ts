/**
 * Inline diff pipeline - character and word-level diffing within blocks.
 */
import { diffChars } from "diff";
import { type WordToken, tokenize, joinTokens, isPurePunctuation } from "../text/tokens.js";
import { longestCommonRunNormalized, findAnchors } from "./lcs.js";
import { WORD_CONFIG } from "../config.js";
import { protectMarkdown } from "../text/html.js";
import { debug } from "../debug.js";
import { absorbStopWordsDeclarative } from "./rewrite-rules.js";
import { optimizeBoundaries } from "./boundary-optimize.js";

export interface InlinePart {
  value: string;
  type: "equal" | "added" | "removed";
  /**
   * Character-level sub-diff within a changed word/phrase.
   * When present, `value` is the concatenated text (for metrics on the whole chunk)
   * and `children` contains the char-level breakdown (for rendering).
   * Consumers MUST use walkLeafParts/flattenParts rather than iterating directly.
   */
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

/**
 * Visit leaf parts of an inline diff. When a part has children,
 * visits each child (the leaves); otherwise visits the part itself.
 * This is the correct way to iterate for metrics — never hand-roll traversal.
 */
export function walkLeafParts(
  parts: InlinePart[],
  fn: (part: InlinePart, parentType?: "removed" | "added") => void,
): void {
  for (const part of parts) {
    if (part.children) {
      for (const child of part.children) {
        fn(child, part.type as "removed" | "added");
      }
    } else {
      fn(part);
    }
  }
}

/**
 * Flatten an InlinePart[] by inlining children into the top level.
 * Each flattened child inherits the parent's `minor` flag if not already set.
 * Useful for serialization or simple iteration where tree structure isn't needed.
 */
export function flattenParts(parts: InlinePart[]): InlinePart[] {
  const result: InlinePart[] = [];
  for (const part of parts) {
    if (part.children) {
      for (const child of part.children) {
        result.push(child.minor !== undefined ? child : { ...child, minor: part.minor });
      }
    } else {
      result.push(part);
    }
  }
  return result;
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

      if (isWhitespaceOnly(removed, added)) {
        result.push(...buildCharDiffPair(removed, added));
      } else if (isMinorChange(removed, added)) {
        result.push(...buildMinorPair(removed, added));
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
    parts.push({ value: joinTokens(a.slice(anchor.ai, anchor.ai + anchor.len)), type: "equal" });
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
  if (remText === addText) {
    result.push({ value: remText, type: "equal" });
  } else {
    result.push({ value: remText, type: "removed", minor: true });
    result.push({ value: addText, type: "added", minor: true });
  }

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

/** Detect if the only difference is whitespace (space added/removed between tokens) */
function isWhitespaceOnly(a: string, b: string): boolean {
  return a.replace(/\s+/g, "") === b.replace(/\s+/g, "");
}

/**
 * Build a removed+added pair with character-level children (no minor flag).
 * Used for whitespace-only changes where the diff is real but token-level can't see it.
 */
function buildCharDiffPair(removed: string, added: string): InlinePart[] {
  const charDiff = diffChars(removed, added);
  const removedChildren: InlinePart[] = [];
  const addedChildren: InlinePart[] = [];

  for (const part of charDiff) {
    if (!part.added && !part.removed) {
      removedChildren.push({ value: part.value, type: "equal" });
      addedChildren.push({ value: part.value, type: "equal" });
    } else if (part.removed) {
      removedChildren.push({ value: part.value, type: "removed" });
    } else if (part.added) {
      addedChildren.push({ value: part.value, type: "added" });
    }
  }

  return [
    { value: removed, type: "removed", children: removedChildren },
    { value: added, type: "added", children: addedChildren },
  ];
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

