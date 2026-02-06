import { diffChars } from "diff";
import type { RootContent } from "mdast";
import { blockToText } from "./parse.js";

export type DiffStatus = "equal" | "added" | "removed" | "modified";

export interface DiffPair {
  status: DiffStatus;
  left: RootContent | null;
  right: RootContent | null;
  /** For modified blocks, multi-level inline diff */
  inlineDiff?: InlinePart[];
}

export interface InlinePart {
  value: string;
  type: "equal" | "added" | "removed";
  /** Character-level sub-diff within a changed word/phrase */
  children?: InlinePart[];
  /** True if the change is minor (case-only, punctuation-only) */
  minor?: boolean;
}

/**
 * LCS-based block diff.
 * Matches blocks by content similarity, then aligns with spacers.
 */
export function diffBlocks(
  leftBlocks: RootContent[],
  rightBlocks: RootContent[]
): DiffPair[] {
  const leftTexts = leftBlocks.map(blockToText);
  const rightTexts = rightBlocks.map(blockToText);

  // Build similarity matrix and find LCS of matching/similar blocks
  const matches = findBlockMatches(leftTexts, rightTexts);
  const result: DiffPair[] = [];

  let li = 0;
  let ri = 0;

  for (const match of matches) {
    // Emit removed blocks before this match
    while (li < match.leftIdx) {
      result.push({ status: "removed", left: leftBlocks[li], right: null });
      li++;
    }
    // Emit added blocks before this match
    while (ri < match.rightIdx) {
      result.push({ status: "added", left: null, right: rightBlocks[ri] });
      ri++;
    }

    if (match.exact) {
      result.push({
        status: "equal",
        left: leftBlocks[li],
        right: rightBlocks[ri],
      });
    } else {
      const inlineDiff = computeInlineDiff(leftTexts[li], rightTexts[ri]);
      result.push({
        status: "modified",
        left: leftBlocks[li],
        right: rightBlocks[ri],
        inlineDiff,
      });
    }
    li++;
    ri++;
  }

  // Remaining blocks
  while (li < leftBlocks.length) {
    result.push({ status: "removed", left: leftBlocks[li], right: null });
    li++;
  }
  while (ri < rightBlocks.length) {
    result.push({ status: "added", left: null, right: rightBlocks[ri] });
    ri++;
  }

  return result;
}

interface BlockMatch {
  leftIdx: number;
  rightIdx: number;
  exact: boolean;
}

/**
 * Find best block matches using LCS with similarity threshold.
 * Blocks with >40% text overlap are considered "similar" (modified).
 * Blocks with 100% match are "exact".
 */
function findBlockMatches(
  leftTexts: string[],
  rightTexts: string[]
): BlockMatch[] {
  const m = leftTexts.length;
  const n = rightTexts.length;

  // Precompute similarity scores
  const sim: number[][] = Array.from({ length: m }, () => new Array(n).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      sim[i][j] = similarity(leftTexts[i], rightTexts[j]);
    }
  }

  const THRESHOLD = 0.4;

  // LCS DP where a "match" is any pair with similarity > threshold
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
  );

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (sim[i][j] >= THRESHOLD) {
        dp[i][j] = dp[i + 1][j + 1] + 1 + sim[i][j]; // Weight by similarity
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // Trace back
  const matches: BlockMatch[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (sim[i][j] >= THRESHOLD && dp[i][j] === dp[i + 1][j + 1] + 1 + sim[i][j]) {
      matches.push({
        leftIdx: i,
        rightIdx: j,
        exact: sim[i][j] > 0.99,
      });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }

  return matches;
}

/** Compute text similarity (0-1) using bigram overlap (Dice coefficient) */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigramsA = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bigram = a.substring(i, i + 2);
    bigramsA.set(bigram, (bigramsA.get(bigram) || 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bigram = b.substring(i, i + 2);
    const count = bigramsA.get(bigram);
    if (count && count > 0) {
      bigramsA.set(bigram, count - 1);
      intersection++;
    }
  }

  return (2 * intersection) / (a.length - 1 + (b.length - 1));
}

// ─── Custom contiguous word diff ────────────────────────────────────────────

const MIN_RUN = 3; // minimum contiguous matching words to anchor

interface WordToken {
  word: string; // for comparison
  raw: string;  // original text including trailing whitespace
}

function tokenize(text: string): WordToken[] {
  const tokens: WordToken[] = [];
  const re = /(\S+)(\s*)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    tokens.push({ word: m[1], raw: m[0] });
  }
  return tokens;
}

/**
 * Find the longest contiguous common run of words between a[aS..aE) and b[bS..bE).
 * Returns null if no run of minLen+ words found.
 */
function longestCommonRun(
  a: WordToken[], b: WordToken[],
  aS: number, aE: number,
  bS: number, bE: number,
  minLen: number
): { ai: number; bi: number; len: number } | null {
  const rows = aE - aS;
  const cols = bE - bS;
  if (rows === 0 || cols === 0) return null;

  let bestLen = 0, bestAi = 0, bestBi = 0;
  let prev = new Uint16Array(cols);
  let curr = new Uint16Array(cols);

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (a[aS + i].word === b[bS + j].word) {
        curr[j] = j > 0 ? prev[j - 1] + 1 : 1;
        if (curr[j] > bestLen) {
          bestLen = curr[j];
          bestAi = aS + i - bestLen + 1;
          bestBi = bS + j - bestLen + 1;
        }
      } else {
        curr[j] = 0;
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }

  if (bestLen < minLen) return null;
  return { ai: bestAi, bi: bestBi, len: bestLen };
}

/**
 * Recursively find all non-overlapping contiguous matching runs (longest first).
 * Returns anchors in left-to-right order.
 */
function findAnchors(
  a: WordToken[], b: WordToken[],
  aS: number, aE: number,
  bS: number, bE: number,
  minLen: number
): { ai: number; bi: number; len: number }[] {
  const best = longestCommonRun(a, b, aS, aE, bS, bE, minLen);
  if (!best) return [];

  const left = findAnchors(a, b, aS, best.ai, bS, best.bi, minLen);
  const right = findAnchors(a, b, best.ai + best.len, aE, best.bi + best.len, bE, minLen);

  return [...left, best, ...right];
}

/** Join token raw text, but trim trailing whitespace from the last token */
function joinTokens(tokens: WordToken[]): string {
  if (tokens.length === 0) return "";
  return tokens.map(t => t.raw).join("");
}

/**
 * Custom word diff requiring contiguous runs of MIN_RUN+ words to match.
 * Eliminates scattered coincidental single-word matches from diffWords.
 */
function diffWordsContiguous(left: string, right: string): InlinePart[] {
  const a = tokenize(left);
  const b = tokenize(right);
  const anchors = findAnchors(a, b, 0, a.length, 0, b.length, MIN_RUN);

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

  return parts;
}

// ─── Inline diff pipeline ───────────────────────────────────────────────────

// Stop words that should be absorbed when isolated between changes
const STOP_WORDS = new Set([
  // Articles & determiners
  "a", "an", "the", "some", "any", "each", "every", "all", "most", "both",
  "few", "many", "much", "other", "another", "such", "same",
  // Pronouns
  "i", "me", "my", "mine", "myself",
  "you", "your", "yours", "yourself",
  "he", "him", "his", "himself",
  "she", "her", "hers", "herself",
  "it", "its", "itself",
  "we", "us", "our", "ours", "ourselves",
  "they", "them", "their", "theirs", "themselves",
  "who", "whom", "whose", "which", "what", "that", "this", "these", "those",
  // Be verbs
  "am", "is", "are", "was", "were", "be", "been", "being",
  // Have verbs
  "has", "have", "had", "having",
  // Do verbs
  "do", "does", "did", "doing", "done",
  // Modal verbs
  "can", "could", "will", "would", "shall", "should", "may", "might", "must",
  // Common verbs
  "get", "got", "gets", "getting",
  "make", "made", "makes", "making",
  "go", "goes", "went", "gone", "going",
  "come", "comes", "came", "coming",
  "take", "takes", "took", "taken", "taking",
  "give", "gives", "gave", "given", "giving",
  "say", "says", "said", "saying",
  "see", "sees", "saw", "seen", "seeing",
  "know", "knows", "knew", "known", "knowing",
  "think", "thinks", "thought", "thinking",
  "become", "becomes", "became", "becoming",
  "seem", "seems", "seemed", "seeming",
  // Prepositions
  "to", "of", "in", "for", "on", "at", "by", "with", "from", "as",
  "into", "onto", "about", "through", "during", "before", "after",
  "above", "below", "between", "under", "over", "against", "among",
  "within", "without", "until", "since", "toward", "towards", "upon",
  // Conjunctions
  "and", "or", "but", "not", "no", "nor", "so", "yet",
  "if", "then", "than", "because", "although", "though", "while",
  "when", "where", "whether", "either", "neither",
  // Adverbs
  "very", "also", "just", "only", "even", "still", "already",
  "always", "never", "often", "sometimes", "usually", "rarely",
  "here", "there", "now", "then", "thus", "hence",
  "how", "why", "however", "therefore", "moreover", "furthermore",
  // Other common words
  "like", "more", "less", "well", "too", "being", "been",
]);

/** Check if text contains only stop words (and punctuation/whitespace) */
function isOnlyStopWords(s: string): boolean {
  const tokens = s.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true; // pure whitespace
  return tokens.every((t) => {
    const letters = t.toLowerCase().replace(/[^a-z]/g, "");
    return letters.length === 0 || STOP_WORDS.has(letters);
  });
}

/** Count words in a string */
function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** Check if an equal part should be absorbed into surrounding changes */
function shouldAbsorbEqual(equalPart: InlinePart, prevPart: InlinePart | undefined, nextPart: InlinePart | undefined): boolean {
  const equalWords = countWords(equalPart.value);

  // Always absorb stop-word-only equal parts adjacent to changes
  if (isOnlyStopWords(equalPart.value)) {
    const prevIsChange = prevPart && (prevPart.type === "removed" || prevPart.type === "added");
    const nextIsChange = nextPart && (nextPart.type === "removed" || nextPart.type === "added");
    return !!(prevIsChange || nextIsChange);
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

/** Absorb equal/minor segments that are only stop words into adjacent changes */
function absorbStopWords(parts: InlinePart[]): InlinePart[] {
  const result: InlinePart[] = [];

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];

    // Check if this equal segment should be absorbed
    if (p.type === "equal" && shouldAbsorbEqual(p, result[result.length - 1], parts[i + 1])) {
      const prev1 = result[result.length - 1];
      const prev2 = result[result.length - 2];
      const next1 = parts[i + 1];
      const next2 = parts[i + 2];

      // Find which types are present in prev and next
      const prevRemoved = prev1?.type === "removed" ? prev1 : prev2?.type === "removed" ? prev2 : null;
      const prevAdded = prev1?.type === "added" ? prev1 : prev2?.type === "added" ? prev2 : null;
      const nextRemoved = next1?.type === "removed" ? next1 : next2?.type === "removed" ? next2 : null;
      const nextAdded = next1?.type === "added" ? next1 : next2?.type === "added" ? next2 : null;

      // Add to exactly one removed part (for left side rendering)
      // Prefer previous for text flow
      if (prevRemoved) {
        prevRemoved.value += p.value;
      } else if (nextRemoved) {
        nextRemoved.value = p.value + nextRemoved.value;
      }

      // Add to exactly one added part (for right side rendering)
      // Prefer previous for text flow
      if (prevAdded) {
        prevAdded.value += p.value;
      } else if (nextAdded) {
        nextAdded.value = p.value + nextAdded.value;
      }

      continue; // Skip adding this equal part
    }

    // Check if this is a minor removed/added pair that's only stop words - absorb it
    if (p.minor && (p.type === "removed" || p.type === "added") && isOnlyStopWords(p.value)) {
      const pairPart = parts[i + 1];
      // Check if this is part of a minor pair (removed followed by added, both stop-word-only)
      if (pairPart && pairPart.minor && pairPart.type !== p.type && isOnlyStopWords(pairPart.value)) {
        const removedVal = p.type === "removed" ? p.value : pairPart.value;
        const addedVal = p.type === "added" ? p.value : pairPart.value;

        const prev1 = result[result.length - 1];
        const prev2 = result[result.length - 2];
        const next1 = parts[i + 2];
        const next2 = parts[i + 3];

        // Find prev removed and added
        const prevRemoved = prev1?.type === "removed" ? prev1 : prev2?.type === "removed" ? prev2 : null;
        const prevAdded = prev1?.type === "added" ? prev1 : prev2?.type === "added" ? prev2 : null;
        // Find next removed and added
        const nextRemoved = next1?.type === "removed" ? next1 : next2?.type === "removed" ? next2 : null;
        const nextAdded = next1?.type === "added" ? next1 : next2?.type === "added" ? next2 : null;

        const hasAdjacentChange = prevRemoved || prevAdded || nextRemoved || nextAdded;

        if (hasAdjacentChange) {
          // Absorb into adjacent changes of same type
          if (prevRemoved) prevRemoved.value += removedVal;
          if (prevAdded) prevAdded.value += addedVal;
          if (nextRemoved) nextRemoved.value = removedVal + nextRemoved.value;
          if (nextAdded) nextAdded.value = addedVal + nextAdded.value;
          i++; // Skip the paired element too
          continue;
        }
      }
    }

    result.push(p);
  }

  return result;
}

/**
 * Multi-level inline diff:
 * 1. Contiguous word diff (3+ word runs only)
 * 2. For adjacent removed/added pairs, character-level diff for minor changes
 * 3. Absorb stop words isolated between changes
 */
export function computeInlineDiff(a: string, b: string): InlinePart[] {
  const raw = diffWordsContiguous(a, b);

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
