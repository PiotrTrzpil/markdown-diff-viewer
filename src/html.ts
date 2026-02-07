/**
 * HTML utilities for rendering diff output.
 */

/**
 * Escape HTML entities to prevent XSS and ensure proper rendering.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Convert markdown bold/italic markers to HTML.
 * Handles **bold** and *italic* syntax.
 */
export function inlineMarkdown(html: string): string {
  // Bold first: **text** → <strong>text</strong>
  html = html.replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>");
  // Then italic: *text* → <em>text</em>
  html = html.replace(
    /(?<!\*)\*(?!\*)([\s\S]+?)(?<!\*)\*(?!\*)/g,
    "<em>$1</em>",
  );
  return html;
}
