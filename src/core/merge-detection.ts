/**
 * Paragraph merge detection.
 *
 * Inverse of split: several left paragraphs become one right paragraph.
 * Runs after split detection and before move detection, so a join is a
 * single modified pair rather than leftover deletes next to a neighbor
 * that already contains their text.
 */
import type { Paragraph, RootContent } from "mdast";
import { WORD_CONFIG } from "../config.js";
import { createDebugLogger } from "../debug.js";
import { blockInnerText, concatParagraphs } from "../text/parse.js";
import { countSharedWords } from "../text/text-metrics.js";
import { countWords } from "../text/tokens.js";
import { createModifiedPair, type DiffPair } from "./block-matching.js";
import { computeInlineDiff } from "./inline-diff.js";

const debug = createDebugLogger("merge-detection");
const MERGE_COVER = WORD_CONFIG.MERGE_COVER;

type Absorb = { pre: number; suf: number };

export function detectParagraphMerges(pairs: DiffPair[]): DiffPair[] {
  const result: DiffPair[] = [];
  let i = 0;
  while (i < pairs.length) {
    const folded = foldMergeAt(pairs, i);
    if (folded) {
      debug(
        `folded ${folded.end - i} pair(s) into a merge at ${i} (pre=${folded.pre} suf=${folded.suf})`,
      );
      result.push(folded.pair);
      i = folded.end;
      continue;
    }
    result.push(pairs[i]);
    i++;
  }
  return result;
}

function foldMergeAt(
  pairs: DiffPair[],
  i: number,
): { pair: DiffPair; end: number; pre: number; suf: number } | null {
  const start = pairs[i];

  if (start.status === "modified" && isParagraph(start.left) && isParagraph(start.right)) {
    const after = takeRemovedParagraphs(pairs, i + 1);
    const pick = bestAbsorb(start.left, start.right, [], after);
    if (!pick) return null;
    return {
      pair: pairFromAbsorb(start.left, start.right, [], after, pick),
      end: i + 1 + pick.suf,
      pre: 0,
      suf: pick.suf,
    };
  }

  if (start.status !== "removed" || !isParagraph(start.left)) return null;

  const before = takeRemovedParagraphs(pairs, i);
  const hubIdx = i + before.length;
  const hub = pairs[hubIdx];
  if (!hub) return null;

  if (hub.status === "modified" && isParagraph(hub.left) && isParagraph(hub.right)) {
    const after = takeRemovedParagraphs(pairs, hubIdx + 1);
    const pick = bestAbsorb(hub.left, hub.right, before, after);
    if (!pick) return null;
    if (pick.pre < before.length) return null;
    return {
      pair: pairFromAbsorb(hub.left, hub.right, before, after, pick),
      end: hubIdx + 1 + pick.suf,
      pre: pick.pre,
      suf: pick.suf,
    };
  }

  if (hub.status === "added" && isParagraph(hub.right) && before.length >= 2) {
    const pick = bestAbsorbFromRemoved(before, hub.right);
    if (!pick) return null;
    if (pick.pre < before.length) return null;
    return {
      pair: createModifiedPair(concatParagraphs(before.slice(before.length - pick.pre)), hub.right),
      end: hubIdx + 1,
      pre: pick.pre,
      suf: 0,
    };
  }

  return null;
}

function covers(left: string, right: string): { leftCover: number; rightCover: number } {
  const leftWords = countWords(left);
  const rightWords = countWords(right);
  const shared = countSharedWords(computeInlineDiff(left, right));
  return {
    leftCover: leftWords === 0 ? 0 : shared / leftWords,
    rightCover: rightWords === 0 ? 0 : shared / rightWords,
  };
}

function bestAbsorb(
  hubLeft: RootContent,
  hubRight: RootContent,
  prefix: RootContent[],
  suffix: RootContent[],
): Absorb | null {
  const right = blockInnerText(hubRight);
  const baselineRight = covers(blockInnerText(hubLeft), right).rightCover;
  let best: (Absorb & { rightCover: number; total: number }) | null = null;
  for (let pre = 0; pre <= prefix.length; pre++) {
    for (let suf = 0; suf <= suffix.length; suf++) {
      if (pre + suf === 0) continue;
      const nodes = [...prefix.slice(prefix.length - pre), hubLeft, ...suffix.slice(0, suf)];
      const { leftCover, rightCover } = covers(joinText(nodes), right);
      if (leftCover < MERGE_COVER || rightCover <= baselineRight) continue;
      const total = pre + suf;
      if (!best || total > best.total || (total === best.total && rightCover > best.rightCover)) {
        best = { pre, suf, rightCover, total };
      }
    }
  }
  return best;
}

function bestAbsorbFromRemoved(prefix: RootContent[], hubRight: RootContent): { pre: number } | null {
  const right = blockInnerText(hubRight);
  let best: { pre: number; leftCover: number } | null = null;
  for (let pre = 2; pre <= prefix.length; pre++) {
    const { leftCover } = covers(joinText(prefix.slice(prefix.length - pre)), right);
    if (leftCover < MERGE_COVER) continue;
    if (!best || pre > best.pre || (pre === best.pre && leftCover > best.leftCover)) {
      best = { pre, leftCover };
    }
  }
  return best;
}

function pairFromAbsorb(
  hubLeft: RootContent,
  hubRight: RootContent,
  prefix: RootContent[],
  suffix: RootContent[],
  pick: Absorb,
): DiffPair {
  const nodes = [
    ...prefix.slice(prefix.length - pick.pre),
    hubLeft,
    ...suffix.slice(0, pick.suf),
  ];
  return createModifiedPair(concatParagraphs(nodes), hubRight);
}

function takeRemovedParagraphs(pairs: DiffPair[], start: number): RootContent[] {
  const nodes: RootContent[] = [];
  for (let i = start; i < pairs.length; i++) {
    const pair = pairs[i];
    if (pair.status !== "removed" || !isParagraph(pair.left)) break;
    nodes.push(pair.left);
  }
  return nodes;
}

function joinText(nodes: RootContent[]): string {
  return nodes.map(blockInnerText).join(" ");
}

function isParagraph(node: RootContent): node is Paragraph {
  return node.type === "paragraph";
}
