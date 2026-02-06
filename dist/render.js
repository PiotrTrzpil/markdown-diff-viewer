import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { blockToText } from "./parse.js";
const mdToHtml = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeStringify, { allowDangerousHtml: true });
/** Render a single markdown block to HTML */
function renderBlock(node) {
    const text = blockToText(node);
    const result = mdToHtml.processSync(text);
    return String(result);
}
/** Escape HTML entities */
function escapeHtml(s) {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
/** Render inline diff parts to HTML with <ins>/<del> markers */
function renderInlineDiff(parts, side) {
    let html = "";
    for (const part of parts) {
        const escaped = escapeHtml(part.value);
        if (part.type === "equal") {
            html += escaped;
        }
        else if (part.type === "removed" && side === "left") {
            html += `<del>${escaped}</del>`;
        }
        else if (part.type === "added" && side === "right") {
            html += `<ins>${escaped}</ins>`;
        }
        // Skip added parts on left side, removed parts on right side
    }
    return html;
}
/** Wrap text content in appropriate HTML tag based on node type */
function wrapInTag(node, innerHtml) {
    switch (node.type) {
        case "heading": {
            const level = node.depth || 1;
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
/** Render all diff pairs into aligned HTML rows */
export function renderDiffPairs(pairs) {
    return pairs.map((pair) => {
        switch (pair.status) {
            case "equal":
                return {
                    leftHtml: renderBlock(pair.left),
                    rightHtml: renderBlock(pair.right),
                    status: "equal",
                };
            case "added":
                return {
                    leftHtml: '<div class="spacer"></div>',
                    rightHtml: `<div class="added-block">${renderBlock(pair.right)}</div>`,
                    status: "added",
                };
            case "removed":
                return {
                    leftHtml: `<div class="removed-block">${renderBlock(pair.left)}</div>`,
                    rightHtml: '<div class="spacer"></div>',
                    status: "removed",
                };
            case "modified": {
                if (pair.inlineDiff) {
                    const leftInner = renderInlineDiff(pair.inlineDiff, "left");
                    const rightInner = renderInlineDiff(pair.inlineDiff, "right");
                    return {
                        leftHtml: `<div class="modified-block">${wrapInTag(pair.left, leftInner)}</div>`,
                        rightHtml: `<div class="modified-block">${wrapInTag(pair.right, rightInner)}</div>`,
                        status: "modified",
                    };
                }
                return {
                    leftHtml: `<div class="modified-block">${renderBlock(pair.left)}</div>`,
                    rightHtml: `<div class="modified-block">${renderBlock(pair.right)}</div>`,
                    status: "modified",
                };
            }
            default:
                return { leftHtml: "", rightHtml: "", status: "unknown" };
        }
    });
}
