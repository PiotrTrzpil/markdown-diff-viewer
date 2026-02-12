import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import type { RootContent, Heading } from "mdast";
import type { DiffPair, DiffStatus, InlinePart } from "./diff.js";
import { blockToText } from "./parse.js";
import { escapeHtml, inlineMarkdown } from "./html.js";
import type { Side } from "./config.js";
import { groupPairsForLayout } from "./layout.js";

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
function renderPartContent(part: InlinePart): string {
  if (part.type === "equal") {
    return escapeHtml(part.value);
  }

  if (part.minor && part.children) {
    return renderChildren(part.children, true);
  } else if (part.children) {
    const tag = part.type === "removed" ? "del" : "ins";
    return `<${tag}>${renderChildren(part.children, false)}</${tag}>`;
  } else {
    const tag = part.type === "removed" ? "del" : "ins";
    // Handle paragraph split - convert newline to <br> for visual line break
    let content = escapeHtml(part.value);
    if (part.paragraphSplit) {
      content = content.replace(/\n/g, "<br>");
    }
    return `<${tag}>${content}</${tag}>`;
  }
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
      // Equal parts show on both sides
      html += `<span class="diff-part">${escapeHtml(part.value)}</span>`;
    } else if (part.type === "removed") {
      // Check if this is a minor pair (removed followed by minor added)
      const nextPart = parts[i + 1];
      const isMinorPair = part.minor && part.children && nextPart?.type === "added" && nextPart.minor;

      if (side === "left") {
        // For minor parts with children, render inline without full diff-removed styling
        if (part.minor && part.children) {
          html += `<span class="diff-part">${renderChildren(part.children, true)}</span>`;
        } else {
          // Show removed content visibly on left
          html += `<span class="diff-part diff-removed">${renderPartContent(part)}</span>`;
        }
      } else {
        // For minor pairs, don't create placeholder - the added part will show directly
        if (isMinorPair) {
          // Skip placeholder - added part handles right side
        } else {
          // Show same text invisibly on right (as placeholder for alignment)
          html += `<span class="diff-part diff-placeholder">${escapeHtml(part.value)}</span>`;
        }
      }
    } else if (part.type === "added") {
      // Check if this is part of a minor pair (preceded by minor removed)
      const prevPart = parts[i - 1];
      const isMinorPair = part.minor && part.children && prevPart?.type === "removed" && prevPart.minor;

      if (side === "right") {
        // For minor parts with children, render inline without full diff-added styling
        if (part.minor && part.children) {
          html += `<span class="diff-part">${renderChildren(part.children, true)}</span>`;
        } else {
          // Show added content visibly on right
          const splitClass = part.paragraphSplit ? " paragraph-split" : "";
          html += `<span class="diff-part diff-added${splitClass}">${renderPartContent(part)}</span>`;
        }
      } else {
        // For minor pairs, don't create placeholder - the removed part handles left side
        if (isMinorPair) {
          // Skip placeholder - removed part handles left side
        } else {
          // Show same text invisibly on left (as placeholder for alignment)
          let content = escapeHtml(part.value);
          const splitClass = part.paragraphSplit ? " paragraph-split" : "";
          if (part.paragraphSplit) {
            content = content.replace(/\n/g, "<br>");
          }
          html += `<span class="diff-part diff-placeholder${splitClass}">${content}</span>`;
        }
      }
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

function modifiedRow(pair: DiffPair): RenderedRow {
  // Use gap-based alignment: removed parts become spacers on right, added parts become spacers on left
  const leftInner = inlineMarkdown(renderInlineDiffWithGaps(pair.inlineDiff!, "left"));
  const rightInner = inlineMarkdown(renderInlineDiffWithGaps(pair.inlineDiff!, "right"));
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
function processSideBySide(pair: DiffPair): RenderedRow {
  if (pair.status === "equal") {
    return equalRow(pair.left!, pair.right!);
  }
  return modifiedRow(pair);
}

/** Process a stacked pair into separate left/right rows */
function processStacked(pair: DiffPair): { left?: RenderedRow; right?: RenderedRow } {
  if (pair.status === "removed") {
    return { left: removedRow(pair.left!) };
  }

  if (pair.status === "added") {
    // Check for paragraph split marker - render inlineDiff instead of block content
    if (pair.inlineDiff && pair.inlineDiff.some(p => p.paragraphSplit)) {
      const innerHtml = inlineMarkdown(renderInlineDiff(pair.inlineDiff, "right"));
      return { right: addedRow(pair.right!, innerHtml) };
    }
    return { right: addedRow(pair.right!) };
  }

  // Fully-changed modified: split into removed + added
  if (pair.inlineDiff) {
    const leftInner = inlineMarkdown(renderInlineDiff(pair.inlineDiff, "left"));
    const rightInner = inlineMarkdown(renderInlineDiff(pair.inlineDiff, "right"));
    return {
      left: removedRow(pair.left!, leftInner),
      right: addedRow(pair.right!, rightInner),
    };
  }

  return {
    left: removedRow(pair.left!),
    right: addedRow(pair.right!),
  };
}

/** Render all diff pairs into aligned HTML rows */
export function renderDiffPairs(pairs: DiffPair[]): RenderedRow[] {
  const result: RenderedRow[] = [];
  const groups = groupPairsForLayout(pairs);

  for (const group of groups) {
    if (group.mode === "side-by-side") {
      // Side-by-side groups have exactly one pair
      result.push(processSideBySide(group.pairs[0]));
    } else {
      // Stacked groups: collect all left rows, then all right rows
      const leftRows: RenderedRow[] = [];
      const rightRows: RenderedRow[] = [];

      for (const pair of group.pairs) {
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
