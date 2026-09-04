/**
 * Block-level matching and re-pairing logic.
 * Matches markdown blocks by content similarity using LCS.
 */
import type { RootContent } from "mdast";
import { blockToText, blockInnerText, getWrapTag } from "../text/parse.js";
import { sharedWordRunScore, buildBigramCache, computeDiceCached } from "../text/similarity.js";
import { computeInlineDiff, type InlinePart } from "./inline-diff.js";
import { countTotalWords, countSharedWords } from "../text/text-metrics.js";
import { getDiffContext, type DiffContext } from "../config.js";
import { debug } from "../debug.js";

export type DiffStatus = "equal" | "added" | "removed" | "modified" | "split";

// ─── Metrics Type ─────────────────────────────────────────────────────────────

/** Pre-computed metrics for a modified pair, avoiding redundant calculation */
export interface DiffMetrics {
  /** Words that appear unchanged on both sides */
  sharedWords: number;
  /** Total words on the left side (equal + removed) */
  totalWords: number;
}

// ─── Discriminated Union Types ───────────────────────────────────────────────

/** Equal pair: both sides present and identical */
export type EqualPair = {
  status: "equal";
  left: RootContent;
  right: RootContent;
};

/** Added pair: only right side present */
export type AddedPair = {
  status: "added";
  right: RootContent;
  /** Optional inline diff for paragraph split markers */
  inlineDiff?: InlinePart[];
  /** True if this block is relocated text (same content, different place). */
  moved?: true;
  /** Required when `moved`. Partner is the other block with this id. */
  moveId?: number;
};

/** Removed pair: only left side present */
export type RemovedPair = {
  status: "removed";
  left: RootContent;
  /** True if this block is relocated text (same content, different place). */
  moved?: true;
  /** Inline diff vs the destination when this block was moved and also edited. */
  inlineDiff?: InlinePart[];
  /** Required when `moved`. Partner is the other block with this id. */
  moveId?: number;
};

/** Modified pair: both sides present with differences */
export type ModifiedPair = {
  status: "modified";
  left: RootContent;
  right: RootContent;
  /** Multi-level inline diff showing changes */
  inlineDiff: InlinePart[];
  /** Pre-computed metrics for layout decisions */
  metrics: DiffMetrics;
  /** HTML tag to wrap rendered content: "h1"-"h6", "p", "blockquote", "pre", "ul", "div" */
  wrapTag: string;
};

/**
 * Split pair: one paragraph split into two.
 * Renders as two rows: original vs first part, then spacer vs second part.
 */
export type SplitPair = {
  status: "split";
  /** The original paragraph (left side) */
  original: RootContent;
  /** First part after split (right side) */
  firstPart: RootContent;
  /** Second part after split (right side) */
  secondPart: RootContent;
  /** Character index in original text where the split occurs */
  splitPoint: number;
};

/** Discriminated union of all pair types */
export type DiffPair = EqualPair | AddedPair | RemovedPair | ModifiedPair | SplitPair;

// ─── Type Guards ─────────────────────────────────────────────────────────────

export function isEqualPair(pair: DiffPair): pair is EqualPair {
  return pair.status === "equal";
}

export function isAddedPair(pair: DiffPair): pair is AddedPair {
  return pair.status === "added";
}

export function isRemovedPair(pair: DiffPair): pair is RemovedPair {
  return pair.status === "removed";
}

export function isModifiedPair(pair: DiffPair): pair is ModifiedPair {
  return pair.status === "modified";
}

export function isSplitPair(pair: DiffPair): pair is SplitPair {
  return pair.status === "split";
}

// ─── Factory Functions ───────────────────────────────────────────────────────

export function createEqualPair(left: RootContent, right: RootContent): EqualPair {
  return { status: "equal", left, right };
}

export function createAddedPair(
  right: RootContent,
  options?: { inlineDiff?: InlinePart[]; moved?: true; moveId?: number },
): AddedPair {
  const pair: AddedPair = { status: "added", right };
  if (options?.inlineDiff) pair.inlineDiff = options.inlineDiff;
  if (options?.moved) pair.moved = true;
  if (options?.moveId !== undefined) pair.moveId = options.moveId;
  return pair;
}

export function createRemovedPair(
  left: RootContent,
  options?: { moved?: true; inlineDiff?: InlinePart[]; moveId?: number },
): RemovedPair {
  const pair: RemovedPair = { status: "removed", left };
  if (options?.moved) pair.moved = true;
  if (options?.inlineDiff) pair.inlineDiff = options.inlineDiff;
  if (options?.moveId !== undefined) pair.moveId = options.moveId;
  return pair;
}

export function createSplitPair(
  original: RootContent,
  firstPart: RootContent,
  secondPart: RootContent,
  splitPoint: number,
): SplitPair {
  return { status: "split", original, firstPart, secondPart, splitPoint };
}

export interface BlockMatch {
  leftIdx: number;
  rightIdx: number;
  exact: boolean;
}

/**
 * Find best block matches using LCS with similarity threshold.
 * Blocks with >40% text overlap are considered "similar" (modified).
 * Blocks with 100% match are "exact".
 */
export function findBlockMatches(
  leftTexts: string[],
  rightTexts: string[],
  ctx: DiffContext = getDiffContext(),
  leftWraps?: string[],
  rightWraps?: string[],
): BlockMatch[] {
  const m = leftTexts.length;
  const n = rightTexts.length;
  const similarityThreshold = ctx.similarity;
  const minSharedForPairing = ctx.sharedWords;

  // Precompute bigram caches for all blocks (O(n) per block)
  const leftCaches = leftTexts.map(buildBigramCache);
  const rightCaches = rightTexts.map(buildBigramCache);

  // Compute similarity matrix. Dice gates whether blocks are similar enough to
  // match. We boost by shared prefix because paragraph rewrites preserve the
  // opening — shared prefix is the strongest signal that two blocks are versions
  // of the same paragraph, preventing the LCS from matching a later paragraph
  // that shares scattered phrases over an earlier one sharing the actual opening.
  const sim: number[][] = Array.from({ length: m }, () => new Array(n).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      if (leftTexts[i] === rightTexts[j]) {
        sim[i][j] = 1;
      } else {
        const dice = computeDiceCached(leftCaches[i], rightCaches[j]);
        const leftProse = headingless(leftTexts[i]);
        const rightProse = headingless(rightTexts[j]);
        const prefix = sharedPrefixWords(leftProse, rightProse);
        const run = sharedWordRunScore(leftProse, rightProse);
        const minRun = minRunForMatch(leftProse, rightProse);
        const maxWords = Math.max(leftProse.split(/\s+/).length, rightProse.split(/\s+/).length, 1);
        // Dice alone matches unrelated English prose (common bigrams). Require
        // a real shared phrase — prefix or contiguous run — so a relocated
        // section is not glued to whatever filled its old slot.
        const wrapOk =
          !leftWraps || !rightWraps || compatibleWrap(leftWraps[i], rightWraps[j]);
        if (
          wrapOk &&
          (dice >= similarityThreshold || prefix >= minSharedForPairing) &&
          (run >= minRun || prefix >= minRun)
        ) {
          sim[i][j] = dice + prefix / maxWords;
        }
      }
    }
  }

  const THRESHOLD = similarityThreshold;

  // LCS DP where a "match" is any pair with similarity > threshold
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (sim[i][j] >= THRESHOLD) {
        // Exact copies of a paragraph are stronger anchors than fuzzy
        // matches of a relocated section, so a moved block does not steal
        // alignment from text that actually stayed put.
        const exactBonus = leftTexts[i] === rightTexts[j] ? 4 : 0;
        dp[i][j] = dp[i + 1][j + 1] + 1 + sim[i][j] + exactBonus;
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
    const exactBonus = leftTexts[i] === rightTexts[j] ? 4 : 0;
    if (sim[i][j] >= THRESHOLD && dp[i][j] === dp[i + 1][j + 1] + 1 + sim[i][j] + exactBonus) {
      // Use actual string equality for exact match, not similarity threshold
      // (high similarity can still miss single-word changes in long paragraphs)
      const isExact = leftTexts[i] === rightTexts[j];
      debug("findBlockMatches: pair", i, j, "sim:", sim[i][j], "exact:", isExact);
      matches.push({
        leftIdx: i,
        rightIdx: j,
        exact: isExact,
      });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }

  debug("findBlockMatches: returning", matches);
  return matches;
}

/** Count leading words shared by two texts. */
function sharedPrefixWords(a: string, b: string): number {
  const aw = a.split(/\s+/);
  const bw = b.split(/\s+/);
  let n = 0;
  for (let i = 0; i < Math.min(aw.length, bw.length); i++) {
    if (aw[i] === bw[i]) n++; else break;
  }
  return n;
}

function headingless(text: string): string {
  return text.replace(/^#+\s+/, "");
}

function compatibleWrap(left: string, right: string): boolean {
  if (left === right) return true;
  // Heading depth changes still count as the same slot.
  if (left.startsWith("h") && right.startsWith("h") && left.length === 2 && right.length === 2) {
    return true;
  }
  return false;
}

/** Phrase length required to treat two blocks as versions of the same paragraph. */
function minRunForMatch(a: string, b: string): number {
  const shorter = Math.min(wordCount(a), wordCount(b));
  // Headings: "What Culture Sees" vs "What the Firm Can Track" share only "What".
  if (shorter <= 4) return Math.max(2, Math.ceil(shorter * 0.5));
  // Long prose: "the people who can see" is 5 ordinary English words, not a rewrite.
  // 15% of length is too high — it also blocks a paragraph that shares a 7-word
  // tail with its rewritten first half, and then the leftover zipper glues the
  // split-off sentence back as a fake rewrite.
  if (shorter >= 20) return 6;
  return Math.max(2, Math.ceil(shorter * 0.15));
}

/**
 * Post-process diff results to pair up consecutive removed/added blocks
 * that share significant text content.
 */
export function pairUpUnmatchedBlocks(
  pairs: DiffPair[],
  ctx: DiffContext = getDiffContext(),
): DiffPair[] {
  const result: DiffPair[] = [];
  let i = 0;

  while (i < pairs.length) {
    // Collect consecutive removed blocks
    const removedBlocks: RemovedPair[] = [];
    while (i < pairs.length && pairs[i].status === "removed") {
      removedBlocks.push(pairs[i] as RemovedPair);
      i++;
    }

    // Collect consecutive added blocks
    const addedBlocks: AddedPair[] = [];
    while (i < pairs.length && pairs[i].status === "added") {
      addedBlocks.push(pairs[i] as AddedPair);
      i++;
    }

    // Try to pair them up if we have both
    if (removedBlocks.length > 0 && addedBlocks.length > 0) {
      result.push(...pairRemovedAndAdded(removedBlocks, addedBlocks, ctx));
    } else {
      // No pairing possible, just add them as-is
      result.push(...removedBlocks, ...addedBlocks);
    }

    // Add any other pair type (equal, modified) directly
    if (i < pairs.length && pairs[i].status !== "removed" && pairs[i].status !== "added") {
      result.push(pairs[i]);
      i++;
    }
  }

  return result;
}

/**
 * Compute minimum shared words required to pair two blocks.
 * Uses percentage-based threshold for short blocks (headings, etc).
 */
function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function getMinSharedForPairing(
  leftWordCount: number,
  rightWordCount: number,
  configMin: number,
): number {
  const shorter = Math.min(leftWordCount, rightWordCount);

  // For short blocks (headings, etc), require at least 50% of words to be shared
  // but always require at least 2 words
  if (shorter < configMin * 2) {
    return Math.max(2, Math.ceil(shorter * 0.5));
  }

  return Math.max(configMin, Math.ceil(shorter * 0.15));
}

function citeKey(text: string): string | null {
  const m = text.trim().match(/^\[cite:([^\]]+)\]/);
  return m ? m[1] : null;
}

function isHtmlComment(text: string): boolean {
  return text.trimStart().startsWith("<!--");
}

/**
 * Leftover rem+add in inline mode: same-slot rewrite, not a delete next to an insert.
 * Long unlike paragraphs of similar length used to zip here (0 shared words, length
 * ratio ≥ 0.45). Keep that only for short slots — the 8-word rewrite test — so a
 * 30-word deleted paragraph is not glued onto the neighbor that filled its place.
 */
const MAX_LEFTOVER_ZIP_WORDS = 15;

function shouldZipLeftovers(
  leftText: string,
  rightText: string,
  leftWrap: string,
  rightWrap: string,
): boolean {
  if (!compatibleWrap(leftWrap, rightWrap)) return false;
  if (isHtmlComment(leftText) !== isHtmlComment(rightText)) return false;
  const leftCite = citeKey(leftText);
  const rightCite = citeKey(rightText);
  if (leftCite !== null || rightCite !== null) {
    return leftCite !== null && leftCite === rightCite;
  }
  const lw = wordCount(leftText);
  const rw = wordCount(rightText);
  if (Math.min(lw, rw) > MAX_LEFTOVER_ZIP_WORDS) return false;
  const longer = Math.max(lw, rw);
  if (longer === 0) return false;
  return Math.min(lw, rw) / longer >= 0.45;
}

/**
 * Try to pair up removed and added blocks based on shared content.
 * Uses longest common contiguous word run to match blocks.
 */
function pairRemovedAndAdded(
  removed: RemovedPair[],
  added: AddedPair[],
  ctx: DiffContext,
): DiffPair[] {
  const result: DiffPair[] = [];
  const usedAdded = new Set<number>();
  const pairing = new Map<number, number>(); // ri -> ai
  const configMin = ctx.sharedWords;

  // For each removed block, find best matching added block
  for (let ri = 0; ri < removed.length; ri++) {
    const leftText = blockToText(removed[ri].left);
    const leftWordCount = wordCount(leftText);
    let bestMatch = -1;
    let bestScore = 0;

    for (let ai = 0; ai < added.length; ai++) {
      if (usedAdded.has(ai)) continue;
      if (!compatibleWrap(getWrapTag(removed[ri].left), getWrapTag(added[ai].right))) continue;
      const rightText = blockToText(added[ai].right);
      const rightWordCount = wordCount(rightText);
      const score = sharedWordRunScore(leftText, rightText);

      // Require minimum shared contiguous words to pair (scaled for short blocks)
      const minRequired = getMinSharedForPairing(leftWordCount, rightWordCount, configMin);
      if (score >= minRequired && score > bestScore) {
        bestScore = score;
        bestMatch = ai;
      }
    }

    if (bestMatch >= 0) {
      pairing.set(ri, bestMatch);
      usedAdded.add(bestMatch);
    }
  }

  // Inline mode: remaining consecutive removed+added are often the same
  // paragraph rewritten below the similarity bar. Zip only same-slot
  // leftovers — not a deleted paragraph next to a longer unrelated insert,
  // an HTML comment next to prose, or two different bibliography lines.
  if (ctx.pairAdjacent) {
    for (let ri = 0; ri < removed.length; ri++) {
      if (pairing.has(ri)) continue;
      const leftText = blockToText(removed[ri].left);
      for (let ai = 0; ai < added.length; ai++) {
        if (usedAdded.has(ai)) continue;
        const rightText = blockToText(added[ai].right);
        if (
          !shouldZipLeftovers(
            leftText,
            rightText,
            getWrapTag(removed[ri].left),
            getWrapTag(added[ai].right),
          )
        ) {
          continue;
        }
        pairing.set(ri, ai);
        usedAdded.add(ai);
        break;
      }
    }
  }

  // Emit in right-side (added) order to preserve document order invariant.
  // Unpaired removed blocks go first (no right-side position to anchor them).
  const pairedRemoved = new Set(pairing.keys());
  const reversePairing = new Map<number, number>();
  for (const [ri, ai] of pairing) reversePairing.set(ai, ri);

  for (let ri = 0; ri < removed.length; ri++) {
    if (!pairedRemoved.has(ri)) result.push(removed[ri]);
  }
  for (let ai = 0; ai < added.length; ai++) {
    const ri = reversePairing.get(ai);
    if (ri !== undefined) {
      result.push(createModifiedPair(removed[ri].left, added[ai].right));
    } else {
      result.push(added[ai]);
    }
  }

  return result;
}

/** Create a modified pair with computed inline diff and metrics */
export function createModifiedPair(left: RootContent, right: RootContent): ModifiedPair {
  // Use inner text for inline diff so heading prefixes (###) aren't diffed
  const leftText = blockInnerText(left);
  const rightText = blockInnerText(right);
  const inlineDiff = computeInlineDiff(leftText, rightText);
  const metrics: DiffMetrics = {
    sharedWords: countSharedWords(inlineDiff),
    totalWords: countTotalWords(inlineDiff),
  };
  return { status: "modified", left, right, inlineDiff, metrics, wrapTag: getWrapTag(left) };
}
