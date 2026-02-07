/**
 * Text similarity functions for block matching.
 */

import { tokenize } from "./tokens.js";
import { longestCommonRun } from "./lcs.js";

/**
 * Compute text similarity (0-1) using bigram overlap (Dice coefficient).
 * Used for determining if two blocks should be matched.
 */
export function similarity(a: string, b: string): number {
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
 * Score how many contiguous words are shared between two texts.
 * Returns the length of the longest common contiguous word run.
 */
export function sharedWordRunScore(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  const run = longestCommonRun(
    tokensA,
    tokensB,
    0,
    tokensA.length,
    0,
    tokensB.length,
    1,
  );
  return run ? run.len : 0;
}
