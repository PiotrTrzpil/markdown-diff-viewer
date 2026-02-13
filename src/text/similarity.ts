/**
 * Unified text similarity metrics.
 * Consolidates various similarity measures into a single module.
 */

import { tokenize, normalizeWord, type WordToken } from "./tokens.js";
import { longestCommonRun } from "../core/lcs.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Complete similarity metrics between two texts.
 * Callers can pick the metric(s) they need from a single computation.
 */
export interface TextSimilarity {
  /** Bigram Dice coefficient (0-1). Higher = more similar at character level. */
  dice: number;
  /** Length of longest contiguous matching word run. */
  sharedWordRun: number;
  /** Number of unique words shared between both texts. */
  sharedWordCount: number;
  /** Total unique words in first text. */
  totalWordsA: number;
  /** Total unique words in second text. */
  totalWordsB: number;
}

// ─── Main API ───────────────────────────────────────────────────────────────

/**
 * Compute all similarity metrics between two texts in one call.
 * More efficient when multiple metrics are needed.
 */
export function computeTextSimilarity(a: string, b: string): TextSimilarity {
  // Tokenize once for word-based metrics
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);

  // Bigram Dice coefficient
  const dice = computeDice(a, b);

  // Longest common word run
  const run = longestCommonRun(tokensA, tokensB, 0, tokensA.length, 0, tokensB.length, 1);
  const sharedWordRun = run ? run.len : 0;

  // Shared word count (set intersection)
  const { sharedCount, totalA, totalB } = computeSharedWordCount(tokensA, tokensB);

  return {
    dice,
    sharedWordRun,
    sharedWordCount: sharedCount,
    totalWordsA: totalA,
    totalWordsB: totalB,
  };
}

// ─── Individual Metrics (for backward compatibility) ────────────────────────

/**
 * Compute text similarity (0-1) using bigram overlap (Dice coefficient).
 * Used for determining if two blocks should be matched.
 */
export function similarity(a: string, b: string): number {
  return computeDice(a, b);
}

/**
 * Score how many contiguous words are shared between two texts.
 * Returns the length of the longest common contiguous word run.
 */
export function sharedWordRunScore(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  const run = longestCommonRun(tokensA, tokensB, 0, tokensA.length, 0, tokensB.length, 1);
  return run ? run.len : 0;
}

/**
 * Count unique words shared between two texts.
 * Uses normalized comparison (lowercase, stripped punctuation).
 */
export function sharedUniqueWordCount(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  const { sharedCount } = computeSharedWordCount(tokensA, tokensB);
  return sharedCount;
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Compute bigram Dice coefficient between two strings.
 * Returns 0-1 where 1 means identical.
 */
function computeDice(a: string, b: string): number {
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

/**
 * Compute shared word count using set intersection.
 * Uses normalized words for comparison.
 */
function computeSharedWordCount(
  tokensA: WordToken[],
  tokensB: WordToken[],
): { sharedCount: number; totalA: number; totalB: number } {
  const setA = new Set<string>();
  const setB = new Set<string>();

  for (const t of tokensA) {
    setA.add(normalizeWord(t.word));
  }
  for (const t of tokensB) {
    setB.add(normalizeWord(t.word));
  }

  let sharedCount = 0;
  for (const word of setA) {
    if (setB.has(word)) sharedCount++;
  }

  return {
    sharedCount,
    totalA: setA.size,
    totalB: setB.size,
  };
}
