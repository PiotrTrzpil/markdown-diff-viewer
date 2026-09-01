/**
 * Host-agnostic layout: side-by-side vs stacked.
 */

import type { DiffPair } from "../core/block-matching.js";
import type { DiffBlock, DiffDocument } from "../model/document.js";
import { getDiffContext, RENDER_CONFIG } from "../config.js";

const {
  LONG_PARAGRAPH_WORDS,
  MIN_SHARED_WORDS_FOR_SIDE_BY_SIDE,
  MIN_SHARED_RATIO_FOR_SIDE_BY_SIDE,
} = RENDER_CONFIG;

function enoughSharedContent(sharedWords: number, totalWords: number): boolean {
  if (sharedWords === 0) return false;
  if (totalWords >= LONG_PARAGRAPH_WORDS) {
    if (sharedWords < MIN_SHARED_WORDS_FOR_SIDE_BY_SIDE) return false;
    if (sharedWords / totalWords < MIN_SHARED_RATIO_FOR_SIDE_BY_SIDE) return false;
  }
  return true;
}

function preferInlineLayout(): boolean {
  return getDiffContext().pairAdjacent;
}

/** Whether an internal pair should render side-by-side. */
export function isSideBySide(pair: DiffPair): boolean {
  if (pair.status === "equal" || pair.status === "split") return true;
  if (pair.status === "modified") {
    if (preferInlineLayout()) return true;
    return enoughSharedContent(pair.metrics.sharedWords, pair.metrics.totalWords);
  }
  return false;
}

/** Whether a host-facing block should render side-by-side. */
export function isBlockSideBySide(block: DiffBlock): boolean {
  if (block.status === "equal" || block.status === "split") return true;
  if (block.status === "modified") {
    if (preferInlineLayout()) return true;
    return enoughSharedContent(block.metrics.sharedWords, block.metrics.totalWords);
  }
  return false;
}

export type LayoutMode = "side-by-side" | "stacked";

export interface LayoutGroup {
  mode: LayoutMode;
  pairs: DiffPair[];
}

/** Group internal pairs for the HTML adapter. */
export function groupPairsForLayout(pairs: DiffPair[]): LayoutGroup[] {
  const groups: LayoutGroup[] = [];
  let i = 0;

  while (i < pairs.length) {
    if (isSideBySide(pairs[i])) {
      groups.push({ mode: "side-by-side", pairs: [pairs[i]] });
      i++;
    } else {
      const stacked: DiffPair[] = [];
      while (i < pairs.length && !isSideBySide(pairs[i])) {
        stacked.push(pairs[i]);
        i++;
      }
      groups.push({ mode: "stacked", pairs: stacked });
    }
  }

  return groups;
}

export type LayoutPlanItem =
  | { mode: "side-by-side"; block: DiffBlock }
  | { mode: "stacked"; blocks: DiffBlock[] };

export interface LayoutPlan {
  items: LayoutPlanItem[];
}

/** Plan layout for a serializable document (public API). */
export function planLayout(document: DiffDocument): LayoutPlan {
  const items: LayoutPlanItem[] = [];
  let i = 0;
  const { blocks } = document;

  while (i < blocks.length) {
    if (isBlockSideBySide(blocks[i])) {
      items.push({ mode: "side-by-side", block: blocks[i] });
      i++;
    } else {
      const stacked: DiffBlock[] = [];
      while (i < blocks.length && !isBlockSideBySide(blocks[i])) {
        stacked.push(blocks[i]);
        i++;
      }
      items.push({ mode: "stacked", blocks: stacked });
    }
  }

  return { items };
}
