/**
 * Relocations: the same words, a different place.
 *
 * A move always pairs two sites of the same kind:
 *   block  — a removed paragraph ↔ an added paragraph
 *   inline — a removed sentence ↔ an added sentence (same block or another)
 *
 * Joins (several paragraphs becoming one) belong to merge-detection.
 * Splits (one paragraph becoming two) belong to split-detection.
 * Those stages run first; this one never crosses a block with an inline slice.
 */
import { blockInnerText, getWrapTag } from "../text/parse.js";
import { isWholeSentenceSpan } from "../text/sentences.js";
import { sharedWordRunScore } from "../text/similarity.js";
import { countSharedWords, countTotalWords } from "../text/text-metrics.js";
import { countWords } from "../text/tokens.js";
import { WORD_CONFIG } from "../config.js";
import { createDebugLogger } from "../debug.js";
import { type DiffMetrics, type DiffPair, type ModifiedPair } from "./block-matching.js";
import { computeInlineDiff, type InlinePart } from "./inline-diff.js";
import { isMinorPart } from "./minor-check.js";

const debug = createDebugLogger("move-detection");

const MIN_SHARED = WORD_CONFIG.MIN_SHARED_FOR_MOVED;
const MIN_CHARS = WORD_CONFIG.MIN_SEGMENT_LENGTH_FOR_MOVED;
/** Shared run must cover most of the shorter side so a mid-sentence idiom is not a move. */
const MIN_COVER = 0.75;
/** Whole-paragraph move: unchanged words must be more than two-thirds of each side. */
const BLOCK_MOVE_COVER = 2 / 3;

type IdAlloc = { next: number };

function allocId(ids: IdAlloc): number {
  ids.next += 1;
  return ids.next;
}

export function detectMovedText(pairs: DiffPair[]): DiffPair[] {
  const ids: IdAlloc = { next: 0 };
  return markBlockMoves(markInlineMoves(pairs, ids), ids);
}

function isCandidate(text: string, part: InlinePart | undefined, asBlock: boolean): boolean {
  if (part && isMinorPart(part)) return false;
  if (part?.moved) return false;
  if (text.length <= MIN_CHARS) return false;
  if (!asBlock && !isWholeSentenceSpan(text)) return false;
  return true;
}

function moveScore(a: string, b: string, asBlock: boolean): number {
  const score = sharedWordRunScore(a, b);
  if (score < MIN_SHARED) return 0;
  const leftWords = countWords(a);
  const rightWords = countWords(b);
  if (leftWords === 0 || rightWords === 0) return 0;
  if (asBlock) {
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

function markPart(part: InlinePart, moveId: number): InlinePart {
  if (part.moved) return part;
  return { ...part, moved: true, moveId };
}

function markParts(parts: InlinePart[], moveIds: ReadonlyMap<number, number>): InlinePart[] {
  return parts.map((part, i) => {
    const moveId = moveIds.get(i);
    return moveId === undefined ? part : markPart(part, moveId);
  });
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

/**
 * True when i and j sit at the same edit site: adjacent, or only short
 * equal glue (whitespace / punctuation) between them.
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

type InlineSeg = { pairIdx: number; partIdx: number; text: string };

function collectInlineSegs(pairs: DiffPair[]): { removed: InlineSeg[]; added: InlineSeg[] } {
  const removed: InlineSeg[] = [];
  const added: InlineSeg[] = [];
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    if (p.status !== "modified") continue;
    p.inlineDiff.forEach((part, partIdx) => {
      if (!isCandidate(part.value, part, false)) return;
      if (part.type === "removed") removed.push({ pairIdx: i, partIdx, text: part.value });
      if (part.type === "added") added.push({ pairIdx: i, partIdx, text: part.value });
    });
  }
  return { removed, added };
}

function markInlineMoves(pairs: DiffPair[], ids: IdAlloc): DiffPair[] {
  const { removed, added } = collectInlineSegs(pairs);
  const candidates: { rem: InlineSeg; add: InlineSeg; score: number }[] = [];
  for (const rem of removed) {
    for (const add of added) {
      if (rem.pairIdx === add.pairIdx) {
        const pair = pairs[rem.pairIdx];
        if (pair.status !== "modified") {
          throw new Error(`inline move candidate ${rem.pairIdx} is ${pair.status}, expected modified`);
        }
        if (isSameSite(pair.inlineDiff, rem.partIdx, add.partIdx)) continue;
      }
      const score = moveScore(rem.text, add.text, false);
      if (score > 0) candidates.push({ rem, add, score });
    }
  }
  const matches = greedyMatches(
    candidates,
    (c) => c.score,
    (c) => `${c.rem.pairIdx}:${c.rem.partIdx}`,
    (c) => `${c.add.pairIdx}:${c.add.partIdx}`,
  );
  if (matches.length === 0) return pairs;

  debug("inline:", matches.length, "move(s)");
  const byPair = new Map<number, Map<number, number>>();
  const addId = (pairIdx: number, partIdx: number, moveId: number) => {
    const map = byPair.get(pairIdx) ?? new Map<number, number>();
    map.set(partIdx, moveId);
    byPair.set(pairIdx, map);
  };
  for (const m of matches) {
    const id = allocId(ids);
    addId(m.rem.pairIdx, m.rem.partIdx, id);
    addId(m.add.pairIdx, m.add.partIdx, id);
  }
  return pairs.map((pair, i) => {
    if (pair.status !== "modified") return pair;
    const moveIds = byPair.get(i);
    if (!moveIds || moveIds.size === 0) return pair;
    return rebuildModifiedPair(pair, markParts(pair.inlineDiff, moveIds));
  });
}

type BlockSeg = { pairIdx: number; text: string };

function collectBlockSegs(pairs: DiffPair[]): { removed: BlockSeg[]; added: BlockSeg[] } {
  const removed: BlockSeg[] = [];
  const added: BlockSeg[] = [];
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    if (p.status === "removed" && !p.moved) {
      const text = blockInnerText(p.left);
      if (isCandidate(text, undefined, true)) removed.push({ pairIdx: i, text });
    } else if (p.status === "added" && !p.moved) {
      const text = blockInnerText(p.right);
      if (isCandidate(text, undefined, true)) added.push({ pairIdx: i, text });
    }
  }
  return { removed, added };
}

function markBlockMoves(pairs: DiffPair[], ids: IdAlloc): DiffPair[] {
  const { removed, added } = collectBlockSegs(pairs);
  const candidates: { rem: BlockSeg; add: BlockSeg; score: number }[] = [];
  for (const rem of removed) {
    for (const add of added) {
      const score = moveScore(rem.text, add.text, true);
      if (score > 0) candidates.push({ rem, add, score });
    }
  }
  const matches = greedyMatches(
    candidates,
    (c) => c.score,
    (c) => String(c.rem.pairIdx),
    (c) => String(c.add.pairIdx),
  );
  if (matches.length === 0) return pairs;

  const blockMoveIds = new Map<number, number>();
  const blockInline = new Map<number, InlinePart[]>();
  for (const m of matches) {
    const origin = pairs[m.rem.pairIdx];
    const dest = pairs[m.add.pairIdx];
    if (origin.status !== "removed" || dest.status !== "added") continue;
    const originText = blockInnerText(origin.left);
    const destText = blockInnerText(dest.right);
    const inline = computeInlineDiff(originText, destText);
    if (!isWholeBlockMove(originText, destText, inline)) continue;
    const moveId = allocId(ids);
    blockMoveIds.set(m.rem.pairIdx, moveId);
    blockMoveIds.set(m.add.pairIdx, moveId);
    if (inline.some((p) => p.type === "added" || p.type === "removed")) {
      blockInline.set(m.rem.pairIdx, inline);
      blockInline.set(m.add.pairIdx, inline);
    }
  }
  if (blockMoveIds.size === 0) return pairs;

  debug("block:", blockMoveIds.size / 2, "move(s)");
  return pairs.map((pair, i) => {
    const moveId = blockMoveIds.get(i);
    if (moveId === undefined) return pair;
    if (pair.status !== "removed" && pair.status !== "added") {
      throw new Error(`block move ${moveId} landed on ${pair.status} pair ${i}`);
    }
    const inlineDiff = blockInline.get(i);
    return { ...pair, moved: true as const, moveId, ...(inlineDiff ? { inlineDiff } : {}) };
  });
}
