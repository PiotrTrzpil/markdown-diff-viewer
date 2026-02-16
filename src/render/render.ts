import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import type { RootContent, Heading } from "mdast";
import type { DiffPair, DiffStatus, InlinePart, ModifiedPair, EqualPair, SplitPair } from "../core/diff.js";
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

  // Handle HTML comments specially - make them visible with muted styling
  if (node.type === "html" && text.trim().startsWith("<!--")) {
    return `<div class="html-comment">${escapeHtml(text)}</div>`;
  }

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

/** Get CSS class for absorbable parts */
function getAbsorbClass(part: InlinePart): string {
  if (part.absorbLevel === "stopword") return " absorbable-stopword";
  if (part.absorbLevel === "single") return " absorbable-single";
  return "";
}

/** Wrap content in absorb span if needed */
function wrapAbsorb(content: string, absorbClass: string): string {
  return absorbClass ? `<span class="${absorbClass.trim()}">${content}</span>` : content;
}

/** Render content of a part (the actual text with markup) */
function renderPartContent(part: InlinePart, nextPart?: InlinePart): string {
  const absorbClass = getAbsorbClass(part);

  if (part.type === "equal") {
    return wrapAbsorb(escapeHtml(part.value), absorbClass);
  }

  const minor = isMinorChange(part, nextPart);
  const tag = part.type === "removed" ? "del" : "ins";

  if (minor && part.children) {
    return wrapAbsorb(renderChildren(part.children, true), absorbClass);
  } else if (part.children) {
    return wrapAbsorb(`<${tag}>${renderChildren(part.children, false)}</${tag}>`, absorbClass);
  } else {
    return wrapAbsorb(`<${tag}>${escapeHtml(part.value)}</${tag}>`, absorbClass);
  }
}

/**
 * Render a removed+added pair using CSS grid overlay.
 * Both texts occupy the same grid cell, so container sizes to the taller one.
 * Only the appropriate side's text is visible.
 */
function renderChangePair(
  removed: InlinePart,
  added: InlinePart,
  side: Side,
): string {
  const removedAbsorb = getAbsorbClass(removed);
  const addedAbsorb = getAbsorbClass(added);

  // Check if this is a minor pair (case/punctuation only)
  const removedMinor = isMinorChange(removed, added);
  const addedMinor = isMinorChange(added, removed);
  const isMinorPair = removedMinor && addedMinor && removed.children && added.children;

  if (isMinorPair) {
    // Minor pair: show actual content with char-level highlighting, no overlay needed
    const content = side === "left"
      ? renderChildren(removed.children!, true)
      : renderChildren(added.children!, true);
    return `<span class="diff-part${removedAbsorb}">${content}</span>`;
  }

  // Build the removed layer content
  let removedContent: string;
  if (removedMinor && removed.children) {
    removedContent = renderChildren(removed.children, true);
  } else {
    removedContent = removed.children
      ? `<del>${renderChildren(removed.children, false)}</del>`
      : `<del>${escapeHtml(removed.value)}</del>`;
  }

  // Build the added layer content
  let addedContent: string;
  if (addedMinor && added.children) {
    addedContent = renderChildren(added.children, true);
  } else {
    addedContent = added.children
      ? `<ins>${renderChildren(added.children, false)}</ins>`
      : `<ins>${escapeHtml(added.value)}</ins>`;
  }

  // Determine visibility classes
  const removedVis = side === "left" ? "visible" : "hidden";
  const addedVis = side === "right" ? "visible" : "hidden";

  // Use combined absorb class (prefer the more specific one)
  const pairAbsorb = removedAbsorb || addedAbsorb;

  return `<span class="change-pair${pairAbsorb}">` +
    `<span class="change-layer ${removedVis} diff-removed">${removedContent}</span>` +
    `<span class="change-layer ${addedVis} diff-added">${addedContent}</span>` +
    `</span>`;
}

/**
 * Render a standalone change (removed or added without a pair).
 */
function renderStandaloneChange(
  part: InlinePart,
  side: Side,
  partType: "removed" | "added",
): string {
  const homeSide: Side = partType === "removed" ? "left" : "right";
  const diffClass = partType === "removed" ? "diff-removed" : "diff-added";
  const absorbClass = getAbsorbClass(part);
  const tag = partType === "removed" ? "del" : "ins";

  // Build content
  let content: string;
  if (part.minor && part.children) {
    content = renderChildren(part.children, true);
  } else if (part.children) {
    content = `<${tag}>${renderChildren(part.children, false)}</${tag}>`;
  } else {
    content = `<${tag}>${escapeHtml(part.value)}</${tag}>`;
  }

  if (side === homeSide) {
    // Home side: render visible
    return `<span class="change-pair standalone${absorbClass}">` +
      `<span class="change-layer visible ${diffClass}">${content}</span>` +
      `</span>`;
  }

  // Away side: render hidden (reserves space via grid)
  return `<span class="change-pair standalone${absorbClass}">` +
    `<span class="change-layer hidden ${diffClass}">${content}</span>` +
    `</span>`;
}

/**
 * Render an absorbable equal part with side information for CSS styling.
 * In merge mode, CSS styles these as removed (left) or added (right).
 */
function renderAbsorbableEqual(part: InlinePart, side: Side): string {
  const absorbClass = getAbsorbClass(part);
  const escaped = escapeHtml(part.value);
  return `<span class="diff-part${absorbClass} ${side}">${escaped}</span>`;
}

/**
 * Render inline diff with overlay-based alignment.
 * Removed+added pairs are wrapped in a grid container where both occupy
 * the same cell, so the container sizes to max(removed_height, added_height).
 */
function renderInlineDiffWithGaps(parts: InlinePart[], side: Side): string {
  let html = "";
  let i = 0;

  while (i < parts.length) {
    const part = parts[i];
    const absorbClass = getAbsorbClass(part);

    if (part.type === "equal") {
      // Absorbable equals get special rendering to show as change when merged
      if (part.absorbLevel) {
        html += renderAbsorbableEqual(part, side);
      } else {
        html += `<span class="diff-part${absorbClass}">${escapeHtml(part.value)}</span>`;
      }
      i++;
    } else if (part.type === "removed" && parts[i + 1]?.type === "added") {
      // Removed+added pair: use overlay
      html += renderChangePair(part, parts[i + 1], side);
      i += 2;
    } else if (part.type === "removed") {
      // Standalone removed
      html += renderStandaloneChange(part, side, "removed");
      i++;
    } else if (part.type === "added") {
      // Standalone added
      html += renderStandaloneChange(part, side, "added");
      i++;
    } else {
      i++;
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
  leftLine?: number;   // Source line from left/old file
  rightLine?: number;  // Source line from right/new file
}

const SPACER = '<div class="spacer"></div>';

function equalRow(left: RootContent, right: RootContent): RenderedRow {
  return {
    leftHtml: renderBlock(left),
    rightHtml: renderBlock(right),
    status: "equal",
    leftLine: left.position?.start?.line,
    rightLine: right.position?.start?.line,
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
    leftLine: pair.left.position?.start?.line,
    rightLine: pair.right.position?.start?.line,
  };
}

/** Render block content, optionally wrapping with line number for copy-with-context */
function renderBlockContent(node: RootContent, innerHtml?: string, line?: number): string {
  const content = innerHtml ? wrapInTag(node, innerHtml) : renderBlock(node);
  return line !== undefined ? `<span data-line="${line}">${content}</span>` : content;
}

function removedRow(node: RootContent, innerHtml?: string): RenderedRow {
  const content = `<div class="removed-block">${renderBlockContent(node, innerHtml)}</div>`;
  return { leftHtml: content, rightHtml: SPACER, status: "removed", leftLine: node.position?.start?.line };
}

function addedRow(node: RootContent, innerHtml?: string): RenderedRow {
  const content = `<div class="added-block">${renderBlockContent(node, innerHtml)}</div>`;
  return { leftHtml: SPACER, rightHtml: content, status: "added", rightLine: node.position?.start?.line };
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
    leftLine: pair.original.position?.start?.line,
    rightLine: pair.firstPart.position?.start?.line,
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
          const line = pair.left.position?.start?.line;
          removedContents.push(renderBlockContent(pair.left, undefined, line));
        } else if (pair.status === "added") {
          // Skip moved content - already rendered at source location
          if (pair.moved) continue;
          const line = pair.right.position?.start?.line;
          if (pair.inlineDiff) {
            const innerHtml = inlineMarkdown(renderInlineDiff(pair.inlineDiff, "right"));
            addedContents.push(renderBlockContent(pair.right, innerHtml, line));
          } else {
            addedContents.push(renderBlockContent(pair.right, undefined, line));
          }
        } else if (pair.status === "modified") {
          // Fully-changed modified: add to both removed and added
          const leftLine = pair.left.position?.start?.line;
          const rightLine = pair.right.position?.start?.line;
          const leftInner = inlineMarkdown(renderInlineDiff(pair.inlineDiff, "left"));
          const rightInner = inlineMarkdown(renderInlineDiff(pair.inlineDiff, "right"));
          removedContents.push(renderBlockContent(pair.left, leftInner, leftLine));
          addedContents.push(renderBlockContent(pair.right, rightInner, rightLine));
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
