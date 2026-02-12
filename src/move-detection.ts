/**
 * Detection of text that was "moved" between blocks.
 * Identifies text removed from one block that appears in another.
 * Also handles paragraph splits where text is just reorganized.
 */
import { blockToText } from "./parse.js";
import { sharedWordRunScore, similarity } from "./similarity.js";
import { computeInlineDiff, type InlinePart } from "./inline-diff.js";
import { type DiffPair } from "./block-matching.js";
import { WORD_CONFIG } from "./config.js";

/** Debug logging - enabled via --debug flag */
function debug(...args: unknown[]) {
  if ((globalThis as Record<string, unknown>).__MD_DIFF_DEBUG__) {
    console.log("[DEBUG move-detection]", ...args);
  }
}

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
    if (p.status === "modified" && p.inlineDiff) {
      for (const part of p.inlineDiff) {
        if (part.type === "removed" && !part.minor && part.value.length > WORD_CONFIG.MIN_SEGMENT_LENGTH_FOR_MOVED) {
          removedSegments.push({ pairIdx: i, text: part.value });
        }
        if (part.type === "added" && !part.minor && part.value.length > WORD_CONFIG.MIN_SEGMENT_LENGTH_FOR_MOVED) {
          addedSegments.push({ pairIdx: i, text: part.value });
        }
      }
    }
    if (p.status === "added" && p.right) {
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
    // Pattern 1: added block followed by modified block
    if (i + 1 < pairs.length &&
        pairs[i].status === "added" &&
        pairs[i + 1].status === "modified") {
      const addedPair = pairs[i];
      const modifiedPair = pairs[i + 1];

      const addedText = blockToText(addedPair.right!);
      const leftText = blockToText(modifiedPair.left!);
      const rightText = blockToText(modifiedPair.right!);

      // Check if addedText + rightText ≈ leftText (paragraph was split)
      const combinedNew = addedText + " " + rightText;
      const sim = similarity(combinedNew, leftText);

      debug("detectParagraphSplits pattern 1: added+modified");
      debug("  addedText:", addedText.substring(0, 50) + "...");
      debug("  leftText:", leftText.substring(0, 50) + "...");
      debug("  rightText:", rightText.substring(0, 50) + "...");
      debug("  similarity:", sim);

      if (sim > 0.95) {
        foundSplit = true;
        // This is a paragraph split! Show as a single modified block with ¶ marker
        const splitDiff = createParagraphSplitDiff(leftText, addedText, rightText);
        result.push({
          status: "modified",
          left: modifiedPair.left,
          right: modifiedPair.right,
          inlineDiff: splitDiff,
        });
        // Add the "added" block as a paragraph break indicator
        result.push({
          status: "added",
          left: null,
          right: addedPair.right,
          inlineDiff: [{ value: "¶ New paragraph", type: "added", paragraphSplit: true }],
        });
        i += 2;
        continue;
      }
    }

    // Pattern 2: modified block followed by added block
    if (i + 1 < pairs.length &&
        pairs[i].status === "modified" &&
        pairs[i + 1].status === "added") {
      const modifiedPair = pairs[i];
      const addedPair = pairs[i + 1];

      const leftText = blockToText(modifiedPair.left!);
      const rightText = blockToText(modifiedPair.right!);
      const addedText = blockToText(addedPair.right!);

      // Check if rightText + addedText ≈ leftText (paragraph was split)
      const combinedNew = rightText + " " + addedText;
      const sim = similarity(combinedNew, leftText);

      debug("detectParagraphSplits pattern 2: modified+added");
      debug("  leftText:", leftText.substring(0, 50) + "...");
      debug("  rightText:", rightText.substring(0, 50) + "...");
      debug("  addedText:", addedText.substring(0, 50) + "...");
      debug("  similarity:", sim);

      if (sim > 0.95) {
        foundSplit = true;
        // This is a paragraph split! Show the modified block with just the first part
        const splitDiff = createParagraphSplitDiff(leftText, rightText, addedText);
        result.push({
          status: "modified",
          left: modifiedPair.left,
          right: modifiedPair.right,
          inlineDiff: splitDiff,
        });
        // Add the "added" block as a paragraph break indicator
        result.push({
          status: "added",
          left: null,
          right: addedPair.right,
          inlineDiff: [{ value: "¶ New paragraph", type: "added", paragraphSplit: true }],
        });
        i += 2;
        continue;
      }
    }

    result.push(pairs[i]);
    i++;
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
      { value: "\n¶ ", type: "added", paragraphSplit: true },
      { value: oldText.substring(spaceEnd), type: "equal" },
    ];
  }

  // Fallback: just show the whole thing with a ¶ in between
  return [
    { value: newPart1, type: "equal" },
    { value: "\n¶ ", type: "added", paragraphSplit: true },
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

    if (moveAsRemoved && current.status === "modified" && current.inlineDiff) {
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

function handleRemovedMove(current: DiffPair, pairs: DiffPair[], moveAsRemoved: MoveMatch): DiffPair {
  // This block has text that was "moved out" - find the matching added text
  const addedPair = pairs[moveAsRemoved.addedIdx];
  const addedText = addedPair.status === "added" && addedPair.right
    ? blockToText(addedPair.right)
    : addedPair.inlineDiff?.filter(p => p.type === "added").map(p => p.value).join("") || "";

  // Recompute inline diff combining both sides' perspectives
  const leftText = blockToText(current.left!);
  const rightText = blockToText(current.right!) + "\n\n" + addedText;
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
  if (current.status === "added" && current.right) {
    // Show as paragraph indicator
    return {
      status: "added",
      left: null,
      right: current.right,
      inlineDiff: [{ value: "¶ ", type: "added" }, { value: "(content shown above)", type: "equal" }],
    };
  } else if (current.status === "modified" && current.inlineDiff) {
    // For modified pairs where the added portion was moved from elsewhere,
    // just show what's actually new
    const removedText = pairs[moveAsAdded.removedIdx].inlineDiff
      ?.filter(p => p.type === "removed")
      .map(p => p.value)
      .join("") || "";

    const filteredDiff = current.inlineDiff.map(part => {
      if (part.type === "added" && sharedWordRunScore(part.value, removedText) >= 5) {
        return { ...part, type: "equal" as const };
      }
      return part;
    });

    return {
      ...current,
      inlineDiff: filteredDiff,
    };
  }

  return current;
}
