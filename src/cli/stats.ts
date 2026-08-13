/**
 * CLI terminal formatting for {@link DiffStats}.
 */

import type { DiffStats } from "../model/stats.js";
import { c } from "./colors.js";

export type { DiffStats };
export {
  computeStats,
  aggregateStats,
  extractTextFromNode,
} from "../model/stats.js";

export function formatStats(stats: DiffStats): string {
  const parts: string[] = [];

  if (stats.filesChanged > 1) {
    parts.push(`${c.bold}${stats.filesChanged}${c.reset} files`);
  }

  const blockChanges = stats.blocksModified + stats.blocksAdded + stats.blocksRemoved;
  if (blockChanges > 0) {
    parts.push(
      `${c.bold}${blockChanges}${c.reset} block${blockChanges !== 1 ? "s" : ""} changed`,
    );
  }

  if (stats.wordsAdded > 0) {
    parts.push(`${c.green}+${stats.wordsAdded}${c.reset} words`);
  }
  if (stats.wordsRemoved > 0) {
    parts.push(`${c.red}-${stats.wordsRemoved}${c.reset} words`);
  }

  return parts.length === 0 ? `${c.dim}No changes${c.reset}` : parts.join(", ");
}
