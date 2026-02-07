/**
 * Longest Common Subsequence (LCS) algorithms for word matching.
 * These are pure functions used by the diff algorithm to find
 * contiguous word runs shared between two texts.
 */

import { type WordToken, normalizeWord } from "./tokens.js";

/**
 * Represents a contiguous run of matching words between two token arrays.
 */
export interface WordRun {
  /** Start index in the first (left) token array */
  ai: number;
  /** Start index in the second (right) token array */
  bi: number;
  /** Number of matching words in the run */
  len: number;
}

/**
 * Find the longest contiguous common run of words between a[aS..aE) and b[bS..bE).
 * Uses exact word matching.
 * @returns null if no run of minLen+ words found
 */
export function longestCommonRun(
  a: WordToken[],
  b: WordToken[],
  aS: number,
  aE: number,
  bS: number,
  bE: number,
  minLen: number,
): WordRun | null {
  const rows = aE - aS;
  const cols = bE - bS;
  if (rows === 0 || cols === 0) return null;

  let bestLen = 0,
    bestAi = 0,
    bestBi = 0;
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
 * Find the longest contiguous common run using normalized word comparison.
 * Normalizes words (lowercase, strip punctuation) before comparing.
 * @returns null if no run of minLen+ words found
 */
export function longestCommonRunNormalized(
  a: WordToken[],
  b: WordToken[],
  aS: number,
  aE: number,
  bS: number,
  bE: number,
  minLen: number,
): WordRun | null {
  const rows = aE - aS;
  const cols = bE - bS;
  if (rows === 0 || cols === 0) return null;

  // dp[i][j] = length of common run ending at a[aS+i-1], b[bS+j-1]
  const dp: number[][] = Array.from({ length: rows + 1 }, () =>
    new Array(cols + 1).fill(0),
  );

  let bestLen = 0;
  let bestAi = 0;
  let bestBi = 0;

  for (let i = 1; i <= rows; i++) {
    for (let j = 1; j <= cols; j++) {
      if (
        normalizeWord(a[aS + i - 1].word) === normalizeWord(b[bS + j - 1].word)
      ) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
        if (dp[i][j] > bestLen) {
          bestLen = dp[i][j];
          bestAi = aS + i - dp[i][j];
          bestBi = bS + j - dp[i][j];
        }
      }
    }
  }

  if (bestLen >= minLen) {
    return { ai: bestAi, bi: bestBi, len: bestLen };
  }
  return null;
}

/**
 * Recursively find all non-overlapping contiguous matching runs (longest first).
 * Returns anchors in left-to-right order.
 */
export function findAnchors(
  a: WordToken[],
  b: WordToken[],
  aS: number,
  aE: number,
  bS: number,
  bE: number,
  minLen: number,
): WordRun[] {
  const best = longestCommonRun(a, b, aS, aE, bS, bE, minLen);
  if (!best) return [];

  const left = findAnchors(a, b, aS, best.ai, bS, best.bi, minLen);
  const right = findAnchors(
    a,
    b,
    best.ai + best.len,
    aE,
    best.bi + best.len,
    bE,
    minLen,
  );

  return [...left, best, ...right];
}
