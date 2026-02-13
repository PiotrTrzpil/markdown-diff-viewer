import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import type { RootContent, Heading } from "mdast";
import type { DiffPair, DiffStatus, InlinePart, ModifiedPair, AddedPair, RemovedPair, EqualPair } from "../core/diff.js";
import { blockToText } from "../text/parse.js";
import { escapeHtml, inlineMarkdown } from "../text/html.js";
import type { Side } from "../config.js";
import { groupPairsForLayout } from "./layout.js";
import { isMinorChange, isParagraphSplit } from "./render-hints.js";

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
    // Handle paragraph split - convert newline to <br> for visual line break
    let content = escapeHtml(part.value);
    if (isParagraphSplit(part)) {
      content = content.replace(/\n/g, "<br>");
    }
    return `<${tag}>${content}</${tag}>`;
  }
}

/**
 * Render a removed part for gap-aligned diff.
 * On left side: shows visible content. On right side: shows placeholder (unless minor pair).
 */
function renderRemovedPartWithGaps(part: InlinePart, nextPart: InlinePart | undefined, side: Side): string {
  const minor = isMinorChange(part, nextPart);
  const isMinorPair = minor && part.children && nextPart?.type === "added" && isMinorChange(nextPart, undefined);

  if (side === "left") {
    // For minor parts with children, render inline without full diff-removed styling
    if (minor && part.children) {
      return `<span class="diff-part">${renderChildren(part.children, true)}</span>`;
    }
    // Show removed content visibly on left
    return `<span class="diff-part diff-removed">${renderPartContent(part, nextPart)}</span>`;
  }

  // Right side: placeholder for alignment (skip for minor pairs - added part handles it)
  if (isMinorPair) {
    return "";
  }
  return `<span class="diff-part diff-placeholder">${escapeHtml(part.value)}</span>`;
}

/**
 * Render an added part for gap-aligned diff.
 * On right side: shows visible content. On left side: shows placeholder (unless minor pair).
 */
function renderAddedPartWithGaps(part: InlinePart, prevPart: InlinePart | undefined, side: Side): string {
  const minor = isMinorChange(part, undefined);
  const isMinorPair = minor && part.children && prevPart?.type === "removed" && isMinorChange(prevPart, part);
  const split = isParagraphSplit(part);
  const splitClass = split ? " paragraph-split" : "";

  if (side === "right") {
    // For minor parts with children, render inline without full diff-added styling
    if (minor && part.children) {
      return `<span class="diff-part">${renderChildren(part.children, true)}</span>`;
    }
    // Show added content visibly on right
    return `<span class="diff-part diff-added${splitClass}">${renderPartContent(part)}</span>`;
  }

  // Left side: placeholder for alignment (skip for minor pairs - removed part handles it)
  if (isMinorPair) {
    return "";
  }
  let content = escapeHtml(part.value);
  if (split) {
    content = content.replace(/\n/g, "<br>");
  }
  return `<span class="diff-part diff-placeholder${splitClass}">${content}</span>`;
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
      html += renderRemovedPartWithGaps(part, parts[i + 1], side);
    } else if (part.type === "added") {
      html += renderAddedPartWithGaps(part, parts[i - 1], side);
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

function removedRow(node: RootContent, innerHtml?: string): RenderedRow {
  const content = innerHtml
    ? `<div class="removed-block">${wrapInTag(node, innerHtml)}</div>`
    : `<div class="removed-block">${renderBlock(node)}</div>`;
  return { leftHtml: content, rightHtml: SPACER, status: "removed" };
}

function addedRow(node: RootContent, innerHtml?: string): RenderedRow {
  const content = innerHtml
    ? `<div class="added-block">${wrapInTag(node, innerHtml)}</div>`
    : `<div class="added-block">${renderBlock(node)}</div>`;
  return { leftHtml: SPACER, rightHtml: content, status: "added" };
}

// ─── Main Rendering Logic ────────────────────────────────────────────────────

/** Process a side-by-side pair (equal or modified with shared content) */
function processSideBySide(pair: EqualPair | ModifiedPair): RenderedRow {
  if (pair.status === "equal") {
    return equalRow(pair.left, pair.right);
  }
  return modifiedRow(pair);
}

/** Process a stacked pair into separate left/right rows */
function processStacked(pair: RemovedPair | AddedPair | ModifiedPair): { left?: RenderedRow; right?: RenderedRow } {
  switch (pair.status) {
    case "removed":
      return { left: removedRow(pair.left) };

    case "added": {
      // Check for paragraph split marker - render inlineDiff instead of block content
      if (pair.inlineDiff && pair.inlineDiff.some(isParagraphSplit)) {
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
      // Side-by-side groups have exactly one pair (always equal or modified)
      const pair = group.pairs[0];
      if (pair.status === "equal" || pair.status === "modified") {
        result.push(processSideBySide(pair));
      }
    } else {
      // Stacked groups: collect all left rows, then all right rows
      const leftRows: RenderedRow[] = [];
      const rightRows: RenderedRow[] = [];

      for (const pair of group.pairs) {
        if (pair.status === "equal") continue; // Equal pairs don't go in stacked groups
        const { left, right } = processStacked(pair);
        if (left) leftRows.push(left);
        if (right) rightRows.push(right);
      }

      // Output: all removed first, then all added
      result.push(...leftRows, ...rightRows);
    }
  }

  return result;
}
