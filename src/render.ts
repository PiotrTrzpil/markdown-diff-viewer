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

/** Render inline diff parts to HTML with <ins>/<del> markers */
function renderInlineDiff(parts: InlinePart[], side: "left" | "right"): string {
  let html = "";

  for (const part of parts) {
    if (part.type === "equal") {
      html += escapeHtml(part.value);
      continue;
    }

    // Skip parts that don't belong to this side
    if (part.type === "removed" && side === "right") continue;
    if (part.type === "added" && side === "left") continue;

    if (part.minor && part.children) {
      // Minor change: only mark the changed chars, no word-level wrapper
      html += renderChildren(part.children, true);
    } else if (part.children) {
      // Major change with char-level refinement
      const tag = part.type === "removed" ? "del" : "ins";
      html += `<${tag}>${renderChildren(part.children, false)}</${tag}>`;
    } else {
      // Simple change without children
      const tag = part.type === "removed" ? "del" : "ins";
      html += `<${tag}>${escapeHtml(part.value)}</${tag}>`;
    }
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
  const leftInner = inlineMarkdown(renderInlineDiff(pair.inlineDiff!, "left"));
  const rightInner = inlineMarkdown(renderInlineDiff(pair.inlineDiff!, "right"));
  return {
    leftHtml: `<div class="modified-block">${wrapInTag(pair.left!, leftInner)}</div>`,
    rightHtml: `<div class="modified-block">${wrapInTag(pair.right!, rightInner)}</div>`,
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

/** Check if inline diff has any equal parts (shared content) */
function hasEqualParts(parts: InlinePart[]): boolean {
  return parts.some((p) => p.type === "equal");
}

/** Check if a pair should be displayed side-by-side (has shared content) */
function isSideBySide(pair: DiffPair): boolean {
  if (pair.status === "equal") return true;
  if (pair.status === "modified" && pair.inlineDiff && hasEqualParts(pair.inlineDiff)) return true;
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
