/**
 * Detection of text that was "moved" between blocks.
 * Identifies text removed from one block that appears in another.
 */
import { blockToText } from "../text/parse.js";
import { sharedWordRunScore } from "../text/similarity.js";
import { countTotalWords, countSharedWords } from "../text/text-metrics.js";
import { computeInlineDiff } from "./inline-diff.js";
import { isMinorPart } from "./minor-check.js";
import { type DiffPair, type ModifiedPair } from "./block-matching.js";
import { WORD_CONFIG } from "../config.js";
import { createDebugLogger } from "../debug.js";

const debug = createDebugLogger("move-detection");

/**
 * Detect text that was "moved" - removed from one block but appears as added in another block.
 * This handles both modified+added and modified+modified sequences.
 *
 * Note: Paragraph splits are handled by the split-detection stage before this.
 */
export function detectMovedText(pairs: DiffPair[]): DiffPair[] {
  // Collect all removed and added text segments from modified blocks
  const removedSegments: { pairIdx: number; text: string }[] = [];
  const addedSegments: { pairIdx: number; text: string }[] = [];

  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    if (p.status === "modified") {
      for (const part of p.inlineDiff) {
        if (part.type === "removed" && !isMinorPart(part) && part.value.length > WORD_CONFIG.MIN_SEGMENT_LENGTH_FOR_MOVED) {
          removedSegments.push({ pairIdx: i, text: part.value });
        }
        if (part.type === "added" && !isMinorPart(part) && part.value.length > WORD_CONFIG.MIN_SEGMENT_LENGTH_FOR_MOVED) {
          addedSegments.push({ pairIdx: i, text: part.value });
        }
      }
    }
    if (p.status === "added") {
      addedSegments.push({ pairIdx: i, text: blockToText(p.right) });
    }
  }

  // Find matches between removed and added segments
  const moveMatches = findMoveMatches(removedSegments, addedSegments);

  if (moveMatches.length === 0) {
    return pairs;
  }

  debug("Found", moveMatches.length, "move matches");

  // For each match, convert removed text to equal in both blocks
  return applyMoveMatches(pairs, moveMatches);
}

interface MoveMatch {
  removedIdx: number;
  addedIdx: number;
  sharedWords: number;
}

function findMoveMatches(
  removedSegments: { pairIdx: number; text: string }[],
  addedSegments: { pairIdx: number; text: string }[],
): MoveMatch[] {
  const moveMatches: MoveMatch[] = [];

  for (const removed of removedSegments) {
    for (const added of addedSegments) {
      if (removed.pairIdx !== added.pairIdx) {
        const score = sharedWordRunScore(removed.text, added.text);
        if (score >= WORD_CONFIG.MIN_SHARED_FOR_MOVED) {
          moveMatches.push({ removedIdx: removed.pairIdx, addedIdx: added.pairIdx, sharedWords: score });
        }
      }
    }
  }

  return moveMatches;
}

function applyMoveMatches(pairs: DiffPair[], moveMatches: MoveMatch[]): DiffPair[] {
  const result: DiffPair[] = [];
  const processedMoves = new Set<string>();

  for (let i = 0; i < pairs.length; i++) {
    const current = pairs[i];

    // Check if this pair has moved text
    const moveAsRemoved = moveMatches.find(m => m.removedIdx === i);
    const moveAsAdded = moveMatches.find(m => m.addedIdx === i);

    if (moveAsRemoved && current.status === "modified") {
      result.push(handleRemovedMove(current, pairs, moveAsRemoved));
      processedMoves.add(`${moveAsRemoved.removedIdx}-${moveAsRemoved.addedIdx}`);
    } else if (moveAsAdded) {
      const key = `${moveAsAdded.removedIdx}-${moveAsAdded.addedIdx}`;
      if (processedMoves.has(key)) {
        result.push(handleAddedMove(current, pairs, moveAsAdded));
      } else {
        result.push(current);
      }
    } else {
      result.push(current);
    }
  }

  return result;
}

function handleRemovedMove(current: ModifiedPair, pairs: DiffPair[], moveAsRemoved: MoveMatch): ModifiedPair {
  // This block has text that was "moved out" - find the matching added text
  const addedPair = pairs[moveAsRemoved.addedIdx];
  let addedText = "";
  if (addedPair.status === "added") {
    addedText = blockToText(addedPair.right);
  } else if (addedPair.status === "modified") {
    addedText = addedPair.inlineDiff.filter(p => p.type === "added").map(p => p.value).join("");
  }

  // Recompute inline diff combining both sides' perspectives
  const leftText = blockToText(current.left);
  const rightText = blockToText(current.right) + "\n\n" + addedText;
  const newInlineDiff = computeInlineDiff(leftText, rightText);

  return {
    status: "modified",
    left: current.left,
    right: current.right,
    inlineDiff: newInlineDiff,
    metrics: {
      sharedWords: countSharedWords(newInlineDiff),
      totalWords: countTotalWords(newInlineDiff),
    },
  };
}

function handleAddedMove(current: DiffPair, pairs: DiffPair[], moveAsAdded: MoveMatch): DiffPair {
  // This added block's content is already shown in the modified block
  if (current.status === "added") {
    // Mark as moved - render layer will skip this entirely
    return {
      status: "added",
      right: current.right,
      moved: true,
    };
  }

  if (current.status === "modified") {
    // For modified pairs where the added portion was moved from elsewhere,
    // just show what's actually new
    const removedPair = pairs[moveAsAdded.removedIdx];
    const removedText = removedPair.status === "modified"
      ? removedPair.inlineDiff.filter(p => p.type === "removed").map(p => p.value).join("")
      : "";

    const filteredDiff = current.inlineDiff.map(part => {
      if (part.type === "added" && sharedWordRunScore(part.value, removedText) >= 5) {
        return { ...part, type: "equal" as const };
      }
      return part;
    });

    return {
      status: "modified",
      left: current.left,
      right: current.right,
      inlineDiff: filteredDiff,
      metrics: {
        sharedWords: countSharedWords(filteredDiff),
        totalWords: countTotalWords(filteredDiff),
      },
    };
  }

  return current;
}
