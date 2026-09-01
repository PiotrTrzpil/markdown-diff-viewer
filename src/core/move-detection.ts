/**
 * Detection of text that was moved — same words, different place.
 *
 * Marks both sites (`moved: true` on the removed origin and the added
 * destination) so hosts can paint them as a relocation instead of a
 * delete+insert. Does not fold the destination back into the origin.
 *
 * Intra-block (sentence reorder inside one paragraph) runs first; leftover
 * unmarked segments are then matched across blocks. Paragraph splits are
 * handled by the split-detection stage before this.
 */
import { blockInnerText, getWrapTag } from "../text/parse.js";
import { isWholeSentenceSpan } from "../text/sentences.js";
import { sharedWordRunScore } from "../text/similarity.js";
import { countTotalWords, countSharedWords } from "../text/text-metrics.js";
import { countWords } from "../text/tokens.js";
import { computeInlineDiff, type InlinePart } from "./inline-diff.js";
import { isMinorPart } from "./minor-check.js";
import { type DiffPair, type ModifiedPair, type DiffMetrics } from "./block-matching.js";
import { WORD_CONFIG } from "../config.js";
import { createDebugLogger } from "../debug.js";

const debug = createDebugLogger("move-detection");

const MIN_SHARED = WORD_CONFIG.MIN_SHARED_FOR_MOVED;
const MIN_CHARS = WORD_CONFIG.MIN_SEGMENT_LENGTH_FOR_MOVED;
/** Shared run must cover most of the shorter side so a mid-sentence idiom is not a move. */
const MIN_COVER = 0.75;
/** Whole-paragraph move: unchanged words must be more than two-thirds of each side. */
const BLOCK_MOVE_COVER = 2 / 3;

type Segment = {
  pairIdx: number;
  /** Index into a modified pair's inlineDiff; null = the whole added/removed block. */
  partIdx: number | null;
  text: string;
};

type MoveMatch = {
  removed: Segment;
  added: Segment;
  sharedWords: number;
};

export function detectMovedText(pairs: DiffPair[]): DiffPair[] {
  const withIntra = markIntraBlockMoves(pairs);
  return markInterBlockMoves(withIntra);
}

function isCandidate(text: string, part: InlinePart | undefined, asBlock: boolean): boolean {
  if (part && isMinorPart(part)) return false;
  if (part?.moved) return false;
  if (text.length <= MIN_CHARS) return false;
  // Inline slices must be whole sentences; a whole block is already a paragraph.
  if (!asBlock && !isWholeSentenceSpan(text)) return false;
  return true;
}

/** Shared contiguous words, or 0 if the pair is not a sentence/paragraph move. */
function moveScore(a: string, b: string, asBlock: boolean): number {
  const score = sharedWordRunScore(a, b);
  if (score < MIN_SHARED) return 0;
  const leftWords = countWords(a);
  const rightWords = countWords(b);
  if (leftWords === 0 || rightWords === 0) return 0;
  if (asBlock) {
    // Pair relocated rewrites for an inner diff; `moved` is a stricter check later.
    const minWords = Math.min(leftWords, rightWords);
    if (score >= 20 || score >= Math.ceil(minWords * 0.4)) return score;
    return 0;
  }
  const minWords = Math.min(leftWords, rightWords);
  if (score < Math.ceil(minWords * MIN_COVER)) return 0;
  return score;
}

function isWholeBlockMove(originText: string, destText: string, inline: InlinePart[]): boolean {
  const leftWords = countWords(originText);
  const rightWords = countWords(destText);
  if (leftWords === 0 || rightWords === 0) return false;
  // Inner edits split the longest contiguous run; count equal words instead.
  const shared = countSharedWords(inline);
  return shared > BLOCK_MOVE_COVER * leftWords && shared > BLOCK_MOVE_COVER * rightWords;
}

function rebuildModifiedPair(base: ModifiedPair, inlineDiff: InlinePart[]): ModifiedPair {
  const metrics: DiffMetrics = {
    sharedWords: countSharedWords(inlineDiff),
    totalWords: countTotalWords(inlineDiff),
  };
  return {
    status: "modified",
    left: base.left,
    right: base.right,
    inlineDiff,
    metrics,
    wrapTag: getWrapTag(base.left),
  };
}

function markPart(part: InlinePart): InlinePart {
  if (part.moved) return part;
  return { ...part, moved: true };
}

function markParts(parts: InlinePart[], indexes: ReadonlySet<number>): InlinePart[] {
  return parts.map((part, i) => (indexes.has(i) ? markPart(part) : part));
}

function greedyMatches<T>(
  candidates: T[],
  score: (c: T) => number,
  leftKey: (c: T) => string,
  rightKey: (c: T) => string,
): T[] {
  const ranked = [...candidates].sort((a, b) => score(b) - score(a));
  const usedLeft = new Set<string>();
  const usedRight = new Set<string>();
  const out: T[] = [];
  for (const c of ranked) {
    const l = leftKey(c);
    const r = rightKey(c);
    if (usedLeft.has(l) || usedRight.has(r)) continue;
    usedLeft.add(l);
    usedRight.add(r);
    out.push(c);
  }
  return out;
}

function segKey(pairIdx: number, partIdx: number | null): string {
  return partIdx === null ? `${pairIdx}:block` : `${pairIdx}:${partIdx}`;
}

/**
 * True when i and j sit at the same edit site: adjacent, or only short
 * equal glue (whitespace / punctuation) between them. A real move has
 * other text in between.
 */
function isSameSite(parts: InlinePart[], i: number, j: number): boolean {
  const lo = Math.min(i, j);
  const hi = Math.max(i, j);
  for (let k = lo + 1; k < hi; k++) {
    const p = parts[k];
    if (p.type !== "equal") return false;
    if (p.value.replace(/\s+/g, "").length > 2) return false;
  }
  return true;
}

function markIntraBlockMoves(pairs: DiffPair[]): DiffPair[] {
  return pairs.map((pair) => {
    if (pair.status !== "modified") return pair;
    const parts = pair.inlineDiff;
    const candidates: { ri: number; ai: number; score: number }[] = [];

    for (let i = 0; i < parts.length; i++) {
      const rem = parts[i];
      if (rem.type !== "removed" || !isCandidate(rem.value, rem, false)) continue;
      for (let j = 0; j < parts.length; j++) {
        if (i === j || isSameSite(parts, i, j)) continue;
        const add = parts[j];
        if (add.type !== "added" || !isCandidate(add.value, add, false)) continue;
        const score = moveScore(rem.value, add.value, false);
        if (score > 0) candidates.push({ ri: i, ai: j, score });
      }
    }

    const matches = greedyMatches(
      candidates,
      (c) => c.score,
      (c) => String(c.ri),
      (c) => String(c.ai),
    );
    if (matches.length === 0) return pair;

    debug("intra-block:", matches.length, "move(s) in pair");
    const indexes = new Set<number>();
    for (const m of matches) {
      indexes.add(m.ri);
      indexes.add(m.ai);
    }
    return rebuildModifiedPair(pair, markParts(parts, indexes));
  });
}

function collectSegments(pairs: DiffPair[]): { removed: Segment[]; added: Segment[] } {
  const removed: Segment[] = [];
  const added: Segment[] = [];

  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    if (p.status === "modified") {
      p.inlineDiff.forEach((part, partIdx) => {
        if (!isCandidate(part.value, part, false)) return;
        if (part.type === "removed") removed.push({ pairIdx: i, partIdx, text: part.value });
        if (part.type === "added") added.push({ pairIdx: i, partIdx, text: part.value });
      });
    } else if (p.status === "removed" && !p.moved) {
      const text = blockInnerText(p.left);
      if (isCandidate(text, undefined, true)) removed.push({ pairIdx: i, partIdx: null, text });
    } else if (p.status === "added" && !p.moved) {
      const text = blockInnerText(p.right);
      if (isCandidate(text, undefined, true)) added.push({ pairIdx: i, partIdx: null, text });
    }
  }

  return { removed, added };
}

function findInterMatches(removed: Segment[], added: Segment[]): MoveMatch[] {
  const candidates: MoveMatch[] = [];
  for (const rem of removed) {
    for (const add of added) {
      if (rem.pairIdx === add.pairIdx) continue;
      const score = moveScore(
        rem.text,
        add.text,
        rem.partIdx === null && add.partIdx === null,
      );
      if (score > 0) {
        candidates.push({ removed: rem, added: add, sharedWords: score });
      }
    }
  }
  return greedyMatches(
    candidates,
    (c) => c.sharedWords,
    (c) => segKey(c.removed.pairIdx, c.removed.partIdx),
    (c) => segKey(c.added.pairIdx, c.added.partIdx),
  );
}

function markInterBlockMoves(pairs: DiffPair[]): DiffPair[] {
  const { removed, added } = collectSegments(pairs);
  const matches = findInterMatches(removed, added);
  if (matches.length === 0) return pairs;

  debug("inter-block:", matches.length, "move(s)");

  const removedParts = new Map<number, Set<number>>();
  const addedParts = new Map<number, Set<number>>();
  const removedBlocks = new Set<number>();
  const addedBlocks = new Set<number>();

  const addPart = (map: Map<number, Set<number>>, pairIdx: number, partIdx: number) => {
    const set = map.get(pairIdx);
    if (set) set.add(partIdx);
    else map.set(pairIdx, new Set([partIdx]));
  };

  const blockInline = new Map<number, InlinePart[]>();
  const blockMoveIds = new Map<number, number>();
  let nextMoveId = 0;

  for (const m of matches) {
    const wholeBlock = m.removed.partIdx === null && m.added.partIdx === null;
    if (wholeBlock) {
      const origin = pairs[m.removed.pairIdx];
      const dest = pairs[m.added.pairIdx];
      if (origin.status !== "removed" || dest.status !== "added") continue;
      const originText = blockInnerText(origin.left);
      const destText = blockInnerText(dest.right);
      const inline = computeInlineDiff(originText, destText);
      if (!isWholeBlockMove(originText, destText, inline)) continue;
      nextMoveId += 1;
      removedBlocks.add(m.removed.pairIdx);
      addedBlocks.add(m.added.pairIdx);
      blockMoveIds.set(m.removed.pairIdx, nextMoveId);
      blockMoveIds.set(m.added.pairIdx, nextMoveId);
      if (inline.some((p) => p.type === "added" || p.type === "removed")) {
        blockInline.set(m.removed.pairIdx, inline);
        blockInline.set(m.added.pairIdx, inline);
      }
      continue;
    }
    if (m.removed.partIdx === null) removedBlocks.add(m.removed.pairIdx);
    else addPart(removedParts, m.removed.pairIdx, m.removed.partIdx);
    if (m.added.partIdx === null) addedBlocks.add(m.added.pairIdx);
    else addPart(addedParts, m.added.pairIdx, m.added.partIdx);
  }

  return pairs.map((pair, i) => {
    if (removedBlocks.has(i) && pair.status === "removed") {
      const inlineDiff = blockInline.get(i);
      const moveId = blockMoveIds.get(i);
      return {
        ...pair,
        moved: true as const,
        ...(moveId !== undefined ? { moveId } : {}),
        ...(inlineDiff ? { inlineDiff } : {}),
      };
    }
    if (addedBlocks.has(i) && pair.status === "added") {
      const inlineDiff = blockInline.get(i);
      const moveId = blockMoveIds.get(i);
      return {
        ...pair,
        moved: true as const,
        ...(moveId !== undefined ? { moveId } : {}),
        ...(inlineDiff ? { inlineDiff } : {}),
      };
    }
    if (pair.status === "modified") {
      const rem = removedParts.get(i);
      const add = addedParts.get(i);
      if (!rem && !add) return pair;
      const indexes = new Set<number>([...(rem ?? []), ...(add ?? [])]);
      return rebuildModifiedPair(pair, markParts(pair.inlineDiff, indexes));
    }
    return pair;
  });
}
