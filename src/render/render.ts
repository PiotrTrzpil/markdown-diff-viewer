import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import type { RootContent } from "mdast";
import type { DiffPair, DiffStatus, InlinePart, ModifiedPair, EqualPair, SplitPair } from "../core/diff.js";
import { blockToText, getWrapTag } from "../text/parse.js";
import { escapeHtml, inlineMarkdown } from "../text/html.js";
import type { Side } from "../config.js";
import { groupPairsForLayout } from "../layout/index.js";
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

/** Render the inner content of a changed part (removed or added). */
function renderPartInner(part: InlinePart): string {
  if (part.minor) {
    return `<span class="char-${part.type} minor">${escapeHtml(part.value)}</span>`;
  }
  const tag = part.type === "removed" ? "del" : "ins";
  return `<${tag}>${escapeHtml(part.value)}</${tag}>`;
}

/** Render content of a part (the actual text with markup) */
function renderPartContent(part: InlinePart): string {
  const absorbClass = getAbsorbClass(part);

  if (part.type === "equal") {
    return wrapAbsorb(escapeHtml(part.value), absorbClass);
  }

  return wrapAbsorb(renderPartInner(part), absorbClass);
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

  const isMinorPair =
    removed.minor === true &&
    added.minor === true &&
    isMinorChange(removed, added) &&
    isMinorChange(added, removed);

  if (isMinorPair) {
    const content = side === "left" ? renderPartInner(removed) : renderPartInner(added);
    return `<span class="diff-part${removedAbsorb}">${content}</span>`;
  }

  const removedContent = renderPartInner(removed);
  const addedContent = renderPartInner(added);
  const removedVis = side === "left" ? "visible" : "hidden";
  const addedVis = side === "right" ? "visible" : "hidden";
  const pairAbsorb = removedAbsorb || addedAbsorb;

  return `<span class="change-pair${pairAbsorb}">` +
    `<span class="change-layer ${removedVis} diff-removed">${removedContent}</span>` +
    `<span class="change-layer ${addedVis} diff-added">${addedContent}</span>` +
    "</span>";
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
  const diffClass = part.moved
    ? partType === "removed" ? "diff-moved-from" : "diff-moved"
    : partType === "removed" ? "diff-removed" : "diff-added";
  const absorbClass = getAbsorbClass(part);

  const content = renderPartInner(part);

  if (side === homeSide) {
    // Home side: render visible
    return `<span class="change-pair standalone${absorbClass}">` +
      `<span class="change-layer visible ${diffClass}">${content}</span>` +
      "</span>";
  }

  // Away side: render hidden (reserves space via grid)
  return `<span class="change-pair standalone${absorbClass}">` +
    `<span class="change-layer hidden ${diffClass}">${content}</span>` +
    "</span>";
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
      html += `<span class="diff-part${absorbClass}">${escapeHtml(part.value)}</span>`;
      i++;
    } else {
      // Collect consecutive non-equal parts and render each individually,
      // but wrap the group in a single inline container so there are no
      // alignment line breaks between changes with no equal text.
      html += "<span class=\"change-group\">";
      while (i < parts.length && parts[i].type !== "equal") {
        if (
          parts[i].type === "removed" &&
          parts[i + 1]?.type === "added" &&
          !parts[i].moved &&
          !parts[i + 1].moved
        ) {
          html += renderChangePair(parts[i], parts[i + 1], side);
          i += 2;
        } else if (parts[i].type === "removed") {
          html += renderStandaloneChange(parts[i], side, "removed");
          i++;
        } else if (parts[i].type === "added") {
          html += renderStandaloneChange(parts[i], side, "added");
          i++;
        } else {
          i++;
        }
      }
      html += "</span>";
    }
  }

  return html;
}

/** Render inline diff parts to HTML (simple, no gap alignment) */
function renderInlineDiff(parts: InlinePart[], side: Side): string {
  let html = "";
  for (const part of parts) {
    if (part.type === "equal") {
      html += `<span class="diff-equal">${escapeHtml(part.value)}</span>`;
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
  return wrapWithTag(getWrapTag(node), innerHtml);
}

/** Wrap inner HTML in a semantic tag by tag name */
function wrapWithTag(tag: string, innerHtml: string): string {
  if (tag === "blockquote") return `<blockquote><p>${innerHtml}</p></blockquote>`;
  if (tag === "pre") return `<pre><code>${innerHtml}</code></pre>`;
  if (tag === "ul") return `<ul><li>${innerHtml}</li></ul>`;
  return `<${tag}>${innerHtml}</${tag}>`;
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
  // Wrap in semantic tag (h1-h6, p, blockquote, etc.) so headings keep their styling
  const leftContent = wrapWithTag(pair.wrapTag, leftInner);
  const rightContent = wrapWithTag(pair.wrapTag, rightInner);
  return {
    leftHtml: `<div class="modified-block gap-aligned">${leftContent}</div>`,
    rightHtml: `<div class="modified-block gap-aligned">${rightContent}</div>`,
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
          const html =
            pair.moved && pair.inlineDiff
              ? renderBlockContent(pair.left, inlineMarkdown(renderInlineDiff(pair.inlineDiff, "left")), line)
              : renderBlockContent(pair.left, undefined, line);
          removedContents.push(pair.moved ? `<div class="moved-block moved-from">${html}</div>` : html);
        } else if (pair.status === "added") {
          const line = pair.right.position?.start?.line;
          const html = pair.inlineDiff
            ? renderBlockContent(pair.right, inlineMarkdown(renderInlineDiff(pair.inlineDiff, "right")), line)
            : renderBlockContent(pair.right, undefined, line);
          addedContents.push(pair.moved ? `<div class="moved-block">${html}</div>` : html);
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
