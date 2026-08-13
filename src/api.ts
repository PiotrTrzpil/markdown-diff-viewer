/**
 * Public engine — strings in, serializable result out.
 * No filesystem, git, or HTML.
 */

import {
  createDiffContext,
  getDiffContext,
  hasActiveDiffContext,
  withDiffOptions,
  MATCHING_LEVEL_NAMES,
  type DiffOptions,
  type DiffContext,
  type MatchingLevel,
} from "./config.js";
import { diffBlocks, type DiffPair } from "./core/diff.js";
import { planLayout, type LayoutPlan } from "./layout/index.js";
import { projectPairsToDocument, type DiffDocument } from "./model/document.js";
import { computeStats, type DiffStats } from "./model/stats.js";
import { parseMarkdown, extractBlocks } from "./text/parse.js";

/** Bump when document / stats / layout JSON shape changes incompatibly */
export const DIFF_SCHEMA_VERSION = 1 as const;
export type DiffSchemaVersion = typeof DIFF_SCHEMA_VERSION;

/** Fully JSON-serializable result (no mdast) */
export interface HostDiffPayload {
  schemaVersion: DiffSchemaVersion;
  document: DiffDocument;
  stats: DiffStats;
  layout: LayoutPlan;
  matchLevel: MatchingLevel;
}

/** Engine result; `pairs` is for HTML/CLI adapters only */
export interface DiffResult extends HostDiffPayload {
  /** Internal mdast pairs — strip with {@link toHostPayload} for wire format */
  pairs: DiffPair[];
}

/** Diff two markdown strings (primary library entry). */
export function diffMarkdown(
  leftContent: string,
  rightContent: string,
  options?: DiffOptions,
): DiffResult {
  return withDiffOptions(options, (ctx) => {
    const pairs = parseAndDiff(leftContent, rightContent, ctx);
    return buildResult(pairs, ctx.matchLevel);
  });
}

/** Drop internal pairs for JSON / cross-process use. */
export function toHostPayload(result: DiffResult): HostDiffPayload {
  const { pairs: _pairs, ...host } = result;
  return host;
}

/** Parse and run the block pipeline (returns internal pairs). */
export function getPairs(
  leftContent: string,
  rightContent: string,
  options?: DiffOptions,
): DiffPair[] {
  if (options?.matchLevel !== undefined || !hasActiveDiffContext()) {
    return withDiffOptions(options, (ctx) => parseAndDiff(leftContent, rightContent, ctx));
  }
  return parseAndDiff(leftContent, rightContent, getDiffContext());
}

export interface AllLevelResults {
  matchLevel: MatchingLevel;
  result: DiffResult;
  byLevel: Record<MatchingLevel, DiffResult>;
}

/** Diff at every match level (no HTML). Does not mutate process defaults. */
export function computeAllLevels(
  leftContent: string,
  rightContent: string,
  activeLevel?: MatchingLevel,
): AllLevelResults {
  const matchLevel = activeLevel ?? createDiffContext().matchLevel;
  const byLevel = {} as Record<MatchingLevel, DiffResult>;

  for (const level of MATCHING_LEVEL_NAMES) {
    byLevel[level] = diffMarkdown(leftContent, rightContent, { matchLevel: level });
  }

  return { matchLevel, result: byLevel[matchLevel], byLevel };
}

// ─── Internals ───────────────────────────────────────────────────────────────

function parseAndDiff(left: string, right: string, ctx: DiffContext): DiffPair[] {
  return diffBlocks(
    extractBlocks(parseMarkdown(left)),
    extractBlocks(parseMarkdown(right)),
    ctx,
  );
}

function buildResult(pairs: DiffPair[], matchLevel: MatchingLevel): DiffResult {
  const document = projectPairsToDocument(pairs);
  return {
    schemaVersion: DIFF_SCHEMA_VERSION,
    document,
    stats: computeStats(pairs),
    layout: planLayout(document),
    matchLevel,
    pairs,
  };
}

export type { DiffOptions, MatchingLevel, DiffDocument, DiffStats, LayoutPlan, DiffPair, DiffContext };
