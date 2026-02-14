import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import type { RootContent, Heading } from "mdast";
import type { DiffPair, DiffStatus, InlinePart, ModifiedPair, AddedPair, RemovedPair, EqualPair, SplitPair } from "../core/diff.js";
import { blockToText } from "../text/parse.js";
import { escapeHtml, inlineMarkdown } from "../text/html.js";
import type { Side } from "../config.js";
import { groupPairsForLayout } from "./layout.js";
import { isMinorChange } from "./render-hints.js";

// ─── Markdown Processing ─────────────────────────────────────────────────────

const mdToHtml = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeStringify, { allowDangerousHtml: true });

/** Render a single markdown block to HTML */
function renderBlock(node: RootContent): string {
  const text = blockToText(node);
  const result = mdToHtml.processSync(text);
  return String(result);
}

// ─── Inline Diff Rendering ───────────────────────────────────────────────────

/** Render children parts to HTML */
function renderChildren(children: InlinePart[], minor: boolean): string {
  let html = "";
  for (const child of children) {
    if (child.type === "equal") {
      html += escapeHtml(child.value);
    } else {
      const minorClass = minor ? " minor" : "";
      html += `<span class="char-${child.type}${minorClass}">${escapeHtml(child.value)}</span>`;
    }
  }
  return html;
}

/** Render content of a part (the actual text with markup) */
function renderPartContent(part: InlinePart, nextPart?: InlinePart): string {
  if (part.type === "equal") {
    return escapeHtml(part.value);
  }

  const minor = isMinorChange(part, nextPart);

  if (minor && part.children) {
    return renderChildren(part.children, true);
  } else if (part.children) {
    const tag = part.type === "removed" ? "del" : "ins";
    return `<${tag}>${renderChildren(part.children, false)}</${tag}>`;
  } else {
    const tag = part.type === "removed" ? "del" : "ins";
    const content = escapeHtml(part.value);
    return `<${tag}>${content}</${tag}>`;
  }
}

/**
 * Render a changed (removed or added) part for gap-aligned diff.
 * On the "home" side: shows visible content.
 * On the "away" side: shows placeholder (unless it's part of a minor pair).
 */
function renderChangePartWithGaps(
  part: InlinePart,
  adjacentPart: InlinePart | undefined,
  side: Side,
  partType: "removed" | "added",
): string {
  const homeSide: Side = partType === "removed" ? "left" : "right";
  const adjacentType = partType === "removed" ? "added" : "removed";
  const diffClass = partType === "removed" ? "diff-removed" : "diff-added";

  // For removed parts, minor check uses adjacentPart; for added parts, it doesn't
  const minor = isMinorChange(part, partType === "removed" ? adjacentPart : undefined);
  const isMinorPair =
    minor &&
    part.children &&
    adjacentPart?.type === adjacentType &&
    isMinorChange(adjacentPart, partType === "removed" ? undefined : part);

  if (side === homeSide) {
    // Home side: render the actual content
    if (minor && part.children) {
      return `<span class="diff-part">${renderChildren(part.children, true)}</span>`;
    }
    const contentArg = partType === "removed" ? adjacentPart : undefined;
    return `<span class="diff-part ${diffClass}">${renderPartContent(part, contentArg)}</span>`;
  }

  // Away side: placeholder for alignment (skip for minor pairs - home side handles both)
  if (isMinorPair) {
    return "";
  }
  return `<span class="diff-part diff-placeholder">${escapeHtml(part.value)}</span>`;
}

/**
 * Render inline diff with gap-based alignment.
 * Removed/added parts show the text on both sides, but invisible on the opposite
 * side (using visibility:hidden to preserve space).
 */
function renderInlineDiffWithGaps(parts: InlinePart[], side: Side): string {
  let html = "";

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (part.type === "equal") {
      html += `<span class="diff-part">${escapeHtml(part.value)}</span>`;
    } else if (part.type === "removed") {
      html += renderChangePartWithGaps(part, parts[i + 1], side, "removed");
    } else if (part.type === "added") {
      html += renderChangePartWithGaps(part, parts[i - 1], side, "added");
    }
  }

  return html;
}

/** Render inline diff parts to HTML (simple, no gap alignment) */
function renderInlineDiff(parts: InlinePart[], side: Side): string {
  let html = "";
  for (const part of parts) {
    if (part.type === "equal") {
      html += escapeHtml(part.value);
    } else if ((part.type === "removed" && side === "left") || (part.type === "added" && side === "right")) {
      html += renderPartContent(part);
    }
    // Skip removed on right, added on left
  }
  return html;
}

// ─── Block Wrapping ──────────────────────────────────────────────────────────

/** Wrap text content in appropriate HTML tag based on node type */
function wrapInTag(node: RootContent, innerHtml: string): string {
  switch (node.type) {
    case "heading": {
      const level = (node as Heading).depth;
      return `<h${level}>${innerHtml}</h${level}>`;
    }
    case "paragraph":
      return `<p>${innerHtml}</p>`;
    case "blockquote":
      return `<blockquote><p>${innerHtml}</p></blockquote>`;
    case "code":
      return `<pre><code>${innerHtml}</code></pre>`;
    case "list":
      return `<ul><li>${innerHtml}</li></ul>`;
    default:
      return `<div>${innerHtml}</div>`;
  }
}

// ─── Row Builders ────────────────────────────────────────────────────────────

export interface RenderedRow {
  leftHtml: string;
  rightHtml: string;
  status: DiffStatus;
}

const SPACER = '<div class="spacer"></div>';

function equalRow(left: RootContent, right: RootContent): RenderedRow {
  return {
    leftHtml: renderBlock(left),
    rightHtml: renderBlock(right),
    status: "equal",
  };
}

function modifiedRow(pair: ModifiedPair): RenderedRow {
  // Use gap-based alignment: removed parts become spacers on right, added parts become spacers on left
  const leftInner = inlineMarkdown(renderInlineDiffWithGaps(pair.inlineDiff, "left"));
  const rightInner = inlineMarkdown(renderInlineDiffWithGaps(pair.inlineDiff, "right"));
  return {
    leftHtml: `<div class="modified-block gap-aligned">${leftInner}</div>`,
    rightHtml: `<div class="modified-block gap-aligned">${rightInner}</div>`,
    status: "modified",
  };
}

function renderRemovedContent(node: RootContent, innerHtml?: string): string {
  return innerHtml ? wrapInTag(node, innerHtml) : renderBlock(node);
}

function renderAddedContent(node: RootContent, innerHtml?: string): string {
  return innerHtml ? wrapInTag(node, innerHtml) : renderBlock(node);
}

function removedRow(node: RootContent, innerHtml?: string): RenderedRow {
  const content = `<div class="removed-block">${renderRemovedContent(node, innerHtml)}</div>`;
  return { leftHtml: content, rightHtml: SPACER, status: "removed" };
}

function addedRow(node: RootContent, innerHtml?: string): RenderedRow {
  const content = `<div class="added-block">${renderAddedContent(node, innerHtml)}</div>`;
  return { leftHtml: SPACER, rightHtml: content, status: "added" };
}

/** Merge multiple removed blocks into a single row */
function mergedRemovedRow(contents: string[]): RenderedRow {
  const content = `<div class="removed-block">${contents.join("")}</div>`;
  return { leftHtml: content, rightHtml: SPACER, status: "removed" };
}

/** Merge multiple added blocks into a single row */
function mergedAddedRow(contents: string[]): RenderedRow {
  const content = `<div class="added-block">${contents.join("")}</div>`;
  return { leftHtml: SPACER, rightHtml: content, status: "added" };
}

/**
 * Render a split pair as a single side-by-side row.
 * Left: original paragraph (all equal text)
 * Right: same text with ¶ marker inserted at split point (only ¶ is "added")
 */
function renderSplitPair(pair: SplitPair): RenderedRow {
  const originalText = blockToText(pair.original);

  // Left side: render the original paragraph as-is (all equal)
  const leftHtml = renderBlock(pair.original);

  // Right side: construct text with ¶ at the split point
  // Text before split + ¶ (added) + text after split
  const textBeforeSplit = originalText.substring(0, pair.splitPoint);
  const textAfterSplit = originalText.substring(pair.splitPoint).trimStart();

  // Build right side HTML: equal text + added pilcrow + equal text
  const rightInnerHtml =
    `<span class="diff-part">${escapeHtml(textBeforeSplit)}</span>` +
    "<span class=\"diff-part diff-added paragraph-split\"><ins> ¶<br></ins></span>" +
    `<span class="diff-part">${escapeHtml(textAfterSplit)}</span>`;

  const rightHtml = `<div class="modified-block gap-aligned"><p>${rightInnerHtml}</p></div>`;

  return {
    leftHtml: `<div class="modified-block gap-aligned">${leftHtml}</div>`,
    rightHtml,
    status: "split",
  };
}

// ─── Main Rendering Logic ────────────────────────────────────────────────────

/** Process a side-by-side pair (equal, modified, or split) */
function processSideBySide(pair: EqualPair | ModifiedPair | SplitPair): RenderedRow {
  if (pair.status === "equal") {
    return equalRow(pair.left, pair.right);
  }
  if (pair.status === "split") {
    return renderSplitPair(pair);
  }
  return modifiedRow(pair);
}

/** Process a stacked pair into separate left/right rows */
function processStacked(pair: RemovedPair | AddedPair | ModifiedPair): { left?: RenderedRow; right?: RenderedRow } {
  switch (pair.status) {
    case "removed":
      return { left: removedRow(pair.left) };

    case "added": {
      // Skip moved content - already rendered at source location
      if (pair.moved) {
        return {};
      }
      // Render inlineDiff if present
      if (pair.inlineDiff) {
        const innerHtml = inlineMarkdown(renderInlineDiff(pair.inlineDiff, "right"));
        return { right: addedRow(pair.right, innerHtml) };
      }
      return { right: addedRow(pair.right) };
    }

    case "modified": {
      // Fully-changed modified: split into removed + added
      const leftInner = inlineMarkdown(renderInlineDiff(pair.inlineDiff, "left"));
      const rightInner = inlineMarkdown(renderInlineDiff(pair.inlineDiff, "right"));
      return {
        left: removedRow(pair.left, leftInner),
        right: addedRow(pair.right, rightInner),
      };
    }
  }
}

/** Render all diff pairs into aligned HTML rows */
export function renderDiffPairs(pairs: DiffPair[]): RenderedRow[] {
  const result: RenderedRow[] = [];
  const groups = groupPairsForLayout(pairs);

  for (const group of groups) {
    if (group.mode === "side-by-side") {
      // Side-by-side groups have exactly one pair (equal, modified, or split)
      const pair = group.pairs[0];
      if (pair.status === "equal" || pair.status === "modified" || pair.status === "split") {
        result.push(processSideBySide(pair));
      }
    } else {
      // Stacked groups: merge consecutive same-type blocks
      const removedContents: string[] = [];
      const addedContents: string[] = [];

      for (const pair of group.pairs) {
        if (pair.status === "equal" || pair.status === "split") continue;

        if (pair.status === "removed") {
          removedContents.push(renderRemovedContent(pair.left));
        } else if (pair.status === "added") {
          // Skip moved content - already rendered at source location
          if (pair.moved) continue;
          if (pair.inlineDiff) {
            const innerHtml = inlineMarkdown(renderInlineDiff(pair.inlineDiff, "right"));
            addedContents.push(renderAddedContent(pair.right, innerHtml));
          } else {
            addedContents.push(renderAddedContent(pair.right));
          }
        } else if (pair.status === "modified") {
          // Fully-changed modified: add to both removed and added
          const leftInner = inlineMarkdown(renderInlineDiff(pair.inlineDiff, "left"));
          const rightInner = inlineMarkdown(renderInlineDiff(pair.inlineDiff, "right"));
          removedContents.push(renderRemovedContent(pair.left, leftInner));
          addedContents.push(renderAddedContent(pair.right, rightInner));
        }
      }

      // Output: one merged removed row, then one merged added row
      if (removedContents.length > 0) {
        result.push(mergedRemovedRow(removedContents));
      }
      if (addedContents.length > 0) {
        result.push(mergedAddedRow(addedContents));
      }
    }
  }

  return result;
}
