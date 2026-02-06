import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import type { RootContent, Heading } from "mdast";
import type { DiffPair, InlinePart } from "./diff.js";
import { blockToText } from "./parse.js";

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

/** Escape HTML entities */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Convert markdown bold/italic markers to HTML */
function inlineMarkdown(html: string): string {
  // Bold first: **text** → <strong>text</strong>
  html = html.replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>");
  // Then italic: *text* → <em>text</em>
  html = html.replace(/(?<!\*)\*(?!\*)([\s\S]+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
  return html;
}

// ─── Inline Diff Rendering ───────────────────────────────────────────────────

/** Minimum words in an equal segment to trigger alignment break */
const ALIGN_MIN_WORDS = 5;

/** Count words in a string */
function countWords(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

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
    return `<${tag}>${escapeHtml(part.value)}</${tag}>`;
  }
}

/**
 * Render inline diff with gap-based alignment.
 * Removed/added parts show the text on both sides, but invisible on the opposite
 * side (using visibility:hidden to preserve space).
 */
function renderInlineDiffWithGaps(parts: InlinePart[], side: "left" | "right"): string {
  let html = "";

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (part.type === "equal") {
      // Equal parts show on both sides
      html += `<span class="diff-part">${escapeHtml(part.value)}</span>`;
    } else if (part.type === "removed") {
      if (side === "left") {
        // Show removed content visibly on left
        html += `<span class="diff-part diff-removed">${renderPartContent(part)}</span>`;
      } else {
        // Show same text invisibly on right (as placeholder for alignment)
        html += `<span class="diff-part diff-placeholder">${escapeHtml(part.value)}</span>`;
      }
    } else if (part.type === "added") {
      if (side === "right") {
        // Show added content visibly on right
        html += `<span class="diff-part diff-added">${renderPartContent(part)}</span>`;
      } else {
        // Show same text invisibly on left (as placeholder for alignment)
        html += `<span class="diff-part diff-placeholder">${escapeHtml(part.value)}</span>`;
      }
    }
  }

  return html;
}

/** Render inline diff parts to HTML (simple, no gap alignment) */
function renderInlineDiff(parts: InlinePart[], side: "left" | "right"): string {
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
    case "heading":
      const level = (node as Heading).depth;
      return `<h${level}>${innerHtml}</h${level}>`;
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
  status: string;
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

/** Thresholds for side-by-side display of long paragraphs */
const LONG_PARAGRAPH_WORDS = 20;
const MIN_SHARED_WORDS = 3;

/** Count total words in inline diff parts */
function countTotalWords(parts: InlinePart[]): number {
  let total = 0;
  for (const p of parts) {
    if (p.type === "equal" || p.type === "removed") {
      total += countWords(p.value);
    }
  }
  return total;
}

/** Count words in equal (shared) parts of inline diff */
function countSharedWords(parts: InlinePart[]): number {
  let shared = 0;
  for (const p of parts) {
    if (p.type === "equal") {
      shared += countWords(p.value);
    }
  }
  return shared;
}

/** Check if a pair should be displayed side-by-side (has enough shared content) */
function isSideBySide(pair: DiffPair): boolean {
  if (pair.status === "equal") return true;
  if (pair.status === "modified" && pair.inlineDiff) {
    const sharedWords = countSharedWords(pair.inlineDiff);
    if (sharedWords === 0) return false;

    // For long paragraphs, require minimum shared words
    const totalWords = countTotalWords(pair.inlineDiff);
    if (totalWords >= LONG_PARAGRAPH_WORDS && sharedWords < MIN_SHARED_WORDS) {
      return false;
    }
    return true;
  }
  return false;
}

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
  let i = 0;

  while (i < pairs.length) {
    // Handle side-by-side pairs directly
    if (isSideBySide(pairs[i])) {
      result.push(processSideBySide(pairs[i]));
      i++;
      continue;
    }

    // Collect consecutive stacked pairs
    const leftRows: RenderedRow[] = [];
    const rightRows: RenderedRow[] = [];

    while (i < pairs.length && !isSideBySide(pairs[i])) {
      const { left, right } = processStacked(pairs[i]);
      if (left) leftRows.push(left);
      if (right) rightRows.push(right);
      i++;
    }

    // Output: all removed first, then all added
    result.push(...leftRows, ...rightRows);
  }

  return result;
}
