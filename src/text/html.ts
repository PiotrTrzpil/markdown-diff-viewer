/**
 * HTML helpers for the render adapter (presentation only).
 * Algorithm-side markdown protection: {@link ./protect.ts}.
 */

import { restoreProtectedToHtml } from "./protect.js";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Restore protected spans, then convert remaining **bold** / *italic* to tags.
 */
export function inlineMarkdown(html: string): string {
  html = restoreProtectedToHtml(html);
  html = html.replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(
    /(?<!\*)\*(?!\*)([\s\S]+?)(?<!\*)\*(?!\*)/g,
    "<em>$1</em>",
  );
  return html;
}
