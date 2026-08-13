/**
 * markdown-diff-viewer — browser-safe library entry.
 *
 *   import { diffMarkdown, toHostPayload } from "markdown-diff-viewer"
 *
 * Git (Node): `markdown-diff-viewer/git`
 * Layout only: `markdown-diff-viewer/layout`
 */

// Engine
export {
  diffMarkdown,
  getPairs,
  computeAllLevels,
  toHostPayload,
  DIFF_SCHEMA_VERSION,
  type DiffResult,
  type HostDiffPayload,
  type DiffSchemaVersion,
  type AllLevelResults,
} from "./api.js";

export type { DiffOptions, MatchingLevel, DiffContext } from "./config.js";
export {
  MATCHING_LEVELS,
  MATCHING_LEVEL_NAMES,
  isMatchingLevel,
  createDiffContext,
  runWithDiffContext,
  withDiffOptions,
  getDiffContext,
  setMatchingLevel,
  getMatchingLevel,
  WORD_CONFIG,
  RENDER_CONFIG,
  BOUNDARY_CONFIG,
  type Side,
} from "./config.js";

// Document model
export type { DiffDocument, DiffBlock, BlockSide, BlockKind } from "./model/document.js";
export { projectPairsToDocument, toBlockSide, blockKindFromNode } from "./model/document.js";
export {
  isEqualBlock,
  isAddedBlock,
  isRemovedBlock,
  isModifiedBlock,
  isSplitBlock,
  isChangedBlock,
  changedBlocks,
  modifiedBlocks,
  cloneDocument,
  isDocumentUnchanged,
  collectInlineLeaves,
  walkDocumentInlineLeaves,
} from "./model/guards.js";
export type { DiffStats } from "./model/stats.js";
export { computeStats, computeDocumentStats, aggregateStats } from "./model/stats.js";

// Layout
export type { LayoutPlan, LayoutPlanItem, LayoutMode, LayoutGroup } from "./layout/index.js";
export {
  planLayout,
  isSideBySide,
  isBlockSideBySide,
  groupPairsForLayout,
} from "./layout/index.js";

// Advanced (mdast pairs / pipeline)
export type {
  DiffStatus,
  DiffPair,
  DiffMetrics,
  EqualPair,
  AddedPair,
  RemovedPair,
  ModifiedPair,
  SplitPair,
  InlinePart,
} from "./core/diff.js";
export {
  isEqualPair,
  isAddedPair,
  isRemovedPair,
  isModifiedPair,
  isSplitPair,
  walkLeafParts,
  flattenParts,
  diffBlocks,
  computeInlineDiff,
} from "./core/diff.js";

export {
  parseMarkdown,
  extractBlocks,
  blockToText,
  blockInnerText,
  getWrapTag,
} from "./text/parse.js";
