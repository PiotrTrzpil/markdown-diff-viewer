/**
 * Inline diff pipeline - character and word-level diffing within blocks.
 */
import { diffChars } from "diff";
import { type WordToken, tokenize, joinTokens, countWords } from "../text/tokens.js";
import { STOP_WORDS, isOnlyStopWords } from "../text/stopwords.js";
import { longestCommonRunNormalized, findAnchors } from "./lcs.js";
import { WORD_CONFIG } from "../config.js";
import { protectMarkdown } from "../text/html.js";
import { debug } from "../debug.js";

export interface InlinePart {
  value: string;
  type: "equal" | "added" | "removed";
  /** Character-level sub-diff within a changed word/phrase */
  children?: InlinePart[];
  /** True if the change is minor (case-only, punctuation-only) */
  minor?: boolean;
  /** True if this represents a paragraph split indicator */
  paragraphSplit?: boolean;
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

  // Absorb stop words, then mark remaining punctuation as minor
  result = absorbStopWords(result);
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

// ─── Stop word absorption ───────────────────────────────────────────────────

/** Check if a part contains meaningful (non-stop-word) content */
function hasNonStopWords(part: InlinePart): boolean {
  const tokens = part.value.trim().split(/\s+/).filter(Boolean);
  return tokens.some((t) => {
    const letters = t.toLowerCase().replace(/[^a-z]/g, "");
    return letters.length > 0 && !STOP_WORDS.has(letters);
  });
}

/** Check if an equal part should be absorbed into surrounding changes */
function shouldAbsorbEqual(
  equalPart: InlinePart,
  prevPart: InlinePart | undefined,
  nextPart: InlinePart | undefined,
  allParts: InlinePart[],
  currentIdx: number,
): boolean {
  const equalWords = countWords(equalPart.value);

  // Only absorb stop-word-only equal parts
  if (isOnlyStopWords(equalPart.value)) {
    const prevIsChange = prevPart && (prevPart.type === "removed" || prevPart.type === "added");
    const nextIsChange = nextPart && (nextPart.type === "removed" || nextPart.type === "added");

    // Must be between changes
    if (!(prevIsChange && nextIsChange)) return false;

    // Don't absorb if there's a meaningful equal nearby with only a single change between
    // This preserves "was" before "diagnosed" (single change "comprehensively" between)
    // But absorbs "of" between "copy/collection" and "reality/images" (multiple changes)

    // Look forward: check if the next equal (after skipping changes) is meaningful
    // and if there's only a single-word change before it
    let changesAfter = 0;
    let nextEqualHasMeaning = false;
    for (let j = currentIdx + 1; j < allParts.length; j++) {
      const part = allParts[j];
      if (part.type === "removed" || part.type === "added") {
        changesAfter++;
      } else if (part.type === "equal") {
        nextEqualHasMeaning = hasNonStopWords(part);
        break;
      }
    }

    // If there's a meaningful equal with only 1 change before it, don't absorb
    // This keeps "was" when followed by single removed "comprehensively" then "diagnosed"
    // But absorbs "of" when followed by removed+added pair then another equal
    if (nextEqualHasMeaning && changesAfter === 1) {
      return false;
    }

    // Otherwise absorb
    return true;
  }

  // Absorb single words surrounded by large changes on both sides
  if (equalWords === 1) {
    const prevIsChange = prevPart && (prevPart.type === "removed" || prevPart.type === "added");
    const nextIsChange = nextPart && (nextPart.type === "removed" || nextPart.type === "added");

    if (prevIsChange && nextIsChange) {
      const prevWords = countWords(prevPart.value);
      const nextWords = countWords(nextPart.value);
      // Absorb if surrounding changes are at least 3 words each
      if (prevWords >= 3 && nextWords >= 3) {
        return true;
      }
    }
  }

  return false;
}

/** Find an adjacent part of a specific type from a list of candidates */
function findByType(type: "removed" | "added", ...candidates: (InlinePart | undefined)[]): InlinePart | null {
  for (const c of candidates) {
    if (c?.type === type) return c;
  }
  return null;
}

/** Absorb a value into adjacent removed/added parts */
function absorbIntoAdjacent(
  value: string,
  prevRemoved: InlinePart | null,
  prevAdded: InlinePart | null,
  nextRemoved: InlinePart | null,
  nextAdded: InlinePart | null,
  removedVal = value,
  addedVal = value,
): void {
  if (prevRemoved) prevRemoved.value += removedVal;
  else if (nextRemoved) nextRemoved.value = removedVal + nextRemoved.value;

  if (prevAdded) prevAdded.value += addedVal;
  else if (nextAdded) nextAdded.value = addedVal + nextAdded.value;
}

/** Absorb equal/minor segments that are only stop words into adjacent changes */
function absorbStopWords(parts: InlinePart[]): InlinePart[] {
  const result: InlinePart[] = [];

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const prev1 = result[result.length - 1];
    const prev2 = result[result.length - 2];

    // Check if this equal segment should be absorbed
    if (p.type === "equal" && shouldAbsorbEqual(p, prev1, parts[i + 1], parts, i)) {
      const prevRemoved = findByType("removed", prev1, prev2);
      const prevAdded = findByType("added", prev1, prev2);
      const nextRemoved = findByType("removed", parts[i + 1], parts[i + 2]);
      const nextAdded = findByType("added", parts[i + 1], parts[i + 2]);

      absorbIntoAdjacent(p.value, prevRemoved, prevAdded, nextRemoved, nextAdded);
      continue;
    }

    // Check if this is a minor removed/added pair that's only stop words - absorb it
    if (p.minor && (p.type === "removed" || p.type === "added") && isOnlyStopWords(p.value)) {
      const pairPart = parts[i + 1];
      if (pairPart?.minor && pairPart.type !== p.type && isOnlyStopWords(pairPart.value)) {
        const removedVal = p.type === "removed" ? p.value : pairPart.value;
        const addedVal = p.type === "added" ? p.value : pairPart.value;

        const prevRemoved = findByType("removed", prev1, prev2);
        const prevAdded = findByType("added", prev1, prev2);
        const nextRemoved = findByType("removed", parts[i + 2], parts[i + 3]);
        const nextAdded = findByType("added", parts[i + 2], parts[i + 3]);

        // Only absorb if we can place BOTH the removed and added values
        // Otherwise we lose text (e.g., emoji changes where one side has no target)
        const canAbsorbRemoved = prevRemoved || nextRemoved;
        const canAbsorbAdded = prevAdded || nextAdded;

        // Don't absorb punctuation into other punctuation-only parts
        // This prevents "— " + "— " → "— — " when there are multiple em-dash changes
        const targetRemoved = prevRemoved || nextRemoved;
        const targetAdded = prevAdded || nextAdded;
        const wouldConcatPunctuation =
          (targetRemoved && isPurePunctuation(targetRemoved.value) && isPurePunctuation(removedVal)) ||
          (targetAdded && isPurePunctuation(targetAdded.value) && isPurePunctuation(addedVal));

        if (canAbsorbRemoved && canAbsorbAdded && !wouldConcatPunctuation) {
          absorbIntoAdjacent("", prevRemoved, prevAdded, nextRemoved, nextAdded, removedVal, addedVal);
          i++; // Skip the paired element
          continue;
        }
      }
    }

    result.push(p);
  }

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

/** Build a minor (case-only / punctuation-only) removed+added pair with char children */
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

  // Apply stop word absorption within the refined parts
  return absorbStopWords(parts);
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

/** Check if text contains no letters or digits (only punctuation, symbols, whitespace) */
function isPurePunctuation(s: string): boolean {
  return s.replace(/[^a-zA-Z0-9]/g, "").length === 0;
}
