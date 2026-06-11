/**
 * Diff-pair computation shared by the CLI modes and debug tooling.
 */
import { parseMarkdown, extractBlocks } from "../text/parse.js";
import { diffBlocks, type DiffPair } from "../core/diff.js";
import { renderDiffPairs, type RenderedRow } from "../render/render.js";
import {
  setMatchingLevel,
  getMatchingLevel,
  MATCHING_LEVEL_NAMES,
  type MatchingLevel,
} from "../config.js";

/** Parse two markdown documents and run the full diff pipeline */
export function getPairs(leftContent: string, rightContent: string): DiffPair[] {
  const leftBlocks = extractBlocks(parseMarkdown(leftContent));
  const rightBlocks = extractBlocks(parseMarkdown(rightContent));
  return diffBlocks(leftBlocks, rightBlocks);
}

/** Diff results for all matching levels, with the active level's results singled out */
export interface AllLevelResults {
  /** Pairs at the active matching level */
  pairs: DiffPair[];
  /** Rendered rows at the active matching level */
  rows: RenderedRow[];
  /** Rendered rows at every matching level (for UI level switching) */
  rowsByLevel: Record<MatchingLevel, RenderedRow[]>;
}

/** Compute the diff at all matching levels in a single pass */
export function computeAllLevels(leftContent: string, rightContent: string): AllLevelResults {
  const activeLevel = getMatchingLevel();
  const rowsByLevel = {} as Record<MatchingLevel, RenderedRow[]>;
  let activePairs: DiffPair[] = [];

  for (const level of MATCHING_LEVEL_NAMES) {
    setMatchingLevel(level);
    const pairs = getPairs(leftContent, rightContent);
    rowsByLevel[level] = renderDiffPairs(pairs);
    if (level === activeLevel) activePairs = pairs;
  }

  setMatchingLevel(activeLevel);
  return { pairs: activePairs, rows: rowsByLevel[activeLevel], rowsByLevel };
}
