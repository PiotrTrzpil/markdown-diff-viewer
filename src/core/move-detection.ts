/**
 * Detection of text that was "moved" between blocks.
 * Identifies text removed from one block that appears in another.
 * Also handles paragraph splits where text is just reorganized.
 */
import { blockToText } from "../text/parse.js";
import { sharedWordRunScore, similarity } from "./similarity.js";
import { computeInlineDiff, type InlinePart } from "./inline-diff.js";
import { isMinorPart } from "./minor-check.js";
import { type DiffPair, type ModifiedPair, type AddedPair } from "./block-matching.js";
import { WORD_CONFIG } from "../config.js";
import { createDebugLogger } from "../debug.js";

const debug = createDebugLogger("move-detection");

/**
 * Detect text that was "moved" - removed from one block but appears as added in another block.
 * This handles both modified+added and modified+modified sequences.
 * Also detects "paragraph splits" where a single paragraph was split into two.
 */
export function detectMovedText(pairs: DiffPair[]): DiffPair[] {
  // First: detect paragraph splits (added block + modified block = original paragraph)
  const splitHandled = detectParagraphSplits(pairs);
  if (splitHandled !== pairs) {
    return splitHandled;
  }

  // First pass: collect all removed and added text segments from modified blocks
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

  // For each match, convert removed text to equal in both blocks
  return applyMoveMatches(pairs, moveMatches);
}

/** Similarity threshold for paragraph split detection */
const SPLIT_SIMILARITY_THRESHOLD = 0.95;

/**
 * Candidate for paragraph split matching.
 */
interface SplitCandidate {
  leftText: string;      // Original text (from modifiedPair.left)
  part1Text: string;     // First part of split
  part2Text: string;     // Second part of split
  modifiedPair: ModifiedPair;
  addedPair: AddedPair;
  patternName: string;   // For debug logging
}

/**
 * Try to match a paragraph split candidate.
 * Returns the result pairs if match found, null otherwise.
 */
function tryMatchParagraphSplit(candidate: SplitCandidate): { modified: ModifiedPair; added: AddedPair } | null {
  const combinedNew = candidate.part1Text + " " + candidate.part2Text;
  const sim = similarity(combinedNew, candidate.leftText);

  debug(`detectParagraphSplits ${candidate.patternName}:`);
  debug("  leftText:", candidate.leftText.substring(0, 50) + "...");
  debug("  part1Text:", candidate.part1Text.substring(0, 50) + "...");
  debug("  part2Text:", candidate.part2Text.substring(0, 50) + "...");
  debug("  similarity:", sim);

  if (sim > SPLIT_SIMILARITY_THRESHOLD) {
    const splitDiff = createParagraphSplitDiff(candidate.leftText, candidate.part1Text, candidate.part2Text);
    return {
      modified: {
        status: "modified",
        left: candidate.modifiedPair.left,
        right: candidate.modifiedPair.right,
        inlineDiff: splitDiff,
      },
      added: {
        status: "added",
        right: candidate.addedPair.right,
        inlineDiff: [{ value: "¶", type: "added" }],
      },
    };
  }

  return null;
}

/**
 * Detect when a paragraph was split into two (no text changes, just a paragraph break inserted).
 * Pattern: added block immediately followed by modified block, where:
 *   addedText + " " + modifiedRightText ≈ modifiedLeftText
 * Also handles: modified block followed by added block.
 * Returns the original pairs array unchanged if no splits are detected.
 */
function detectParagraphSplits(pairs: DiffPair[]): DiffPair[] {
  const result: DiffPair[] = [];
  let i = 0;
  let foundSplit = false;

  while (i < pairs.length) {
    let splitResult: { modified: ModifiedPair; added: AddedPair } | null = null;

    // Pattern 1: added block followed by modified block
    const pair0 = pairs[i];
    const pair1 = pairs[i + 1];
    if (i + 1 < pairs.length &&
        pair0.status === "added" &&
        pair1?.status === "modified") {
      splitResult = tryMatchParagraphSplit({
        leftText: blockToText(pair1.left),
        part1Text: blockToText(pair0.right),
        part2Text: blockToText(pair1.right),
        modifiedPair: pair1,
        addedPair: pair0,
        patternName: "pattern 1: added+modified",
      });
    }

    // Pattern 2: modified block followed by added block
    if (!splitResult &&
        i + 1 < pairs.length &&
        pair0.status === "modified" &&
        pair1?.status === "added") {
      splitResult = tryMatchParagraphSplit({
        leftText: blockToText(pair0.left),
        part1Text: blockToText(pair0.right),
        part2Text: blockToText(pair1.right),
        modifiedPair: pair0,
        addedPair: pair1,
        patternName: "pattern 2: modified+added",
      });
    }

    if (splitResult) {
      foundSplit = true;
      result.push(splitResult.modified);
      result.push(splitResult.added);
      i += 2;
    } else {
      result.push(pairs[i]);
      i++;
    }
  }

  // Only return the new result if we actually found splits
  return foundSplit ? result : pairs;
}

/**
 * Create inline diff for a paragraph split.
 * Shows: equalPart1 + "¶" (added) + equalPart2
 */
function createParagraphSplitDiff(
  oldText: string,
  newPart1: string,
  newPart2: string,
): InlinePart[] {
  // Find where the split occurred in the old text
  // The split point is where newPart1 ends in oldText
  const part1Normalized = newPart1.trim();
  const splitIdx = oldText.indexOf(part1Normalized);

  if (splitIdx >= 0) {
    const splitPoint = splitIdx + part1Normalized.length;
    // Find the actual space/punctuation between the two parts in oldText
    let spaceEnd = splitPoint;
    while (spaceEnd < oldText.length && /\s/.test(oldText[spaceEnd])) {
      spaceEnd++;
    }

    return [
      { value: oldText.substring(0, splitPoint), type: "equal" },
      { value: "\n¶ ", type: "added" },
      { value: oldText.substring(spaceEnd), type: "equal" },
    ];
  }

  // Fallback: just show the whole thing with a ¶ in between
  return [
    { value: newPart1, type: "equal" },
    { value: "\n¶ ", type: "added" },
    { value: newPart2, type: "equal" },
  ];
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
  };
}

function handleAddedMove(current: DiffPair, pairs: DiffPair[], moveAsAdded: MoveMatch): DiffPair {
  // This added block's content is already shown in the modified block
  if (current.status === "added") {
    // Show as paragraph indicator
    return {
      status: "added",
      right: current.right,
      inlineDiff: [{ value: "¶ ", type: "added" }, { value: "(content shown above)", type: "equal" }],
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
    };
  }

  return current;
}
