/**
 * HTML utilities for rendering diff output.
 */

// Marker characters for protected markdown spans
const BOLD_OPEN = "\x02";
const BOLD_CLOSE = "\x03";
const ITALIC_OPEN = "\x04";
const ITALIC_CLOSE = "\x05";
const WORD_JOIN = "\x00"; // Joins words within protected spans

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
 * Protect markdown formatting before diffing.
 * Converts **bold** and *italic* to atomic tokens that won't be split by word tokenization.
 * Spaces within formatted spans are replaced with WORD_JOIN to keep them together.
 */
export function protectMarkdown(text: string): string {
  // Bold: **text** → \x02text\x03 (with spaces → \x00)
  text = text.replace(/\*\*([^*]+)\*\*/g, (_match, content) => {
    return BOLD_OPEN + content.replace(/ /g, WORD_JOIN) + BOLD_CLOSE;
  });
  // Italic: *text* → \x04text\x05 (with spaces → \x00)
  text = text.replace(/(?<!\*)\*(?!\*)([^*]+)(?<!\*)\*(?!\*)/g, (_match, content) => {
    return ITALIC_OPEN + content.replace(/ /g, WORD_JOIN) + ITALIC_CLOSE;
  });
  return text;
}

/**
 * Restore markdown from protected tokens and convert to HTML.
 * Also restores spaces that were converted to WORD_JOIN.
 */
export function restoreMarkdownToHtml(text: string): string {
  // First restore word joins to spaces
  text = text.replace(new RegExp(WORD_JOIN, "g"), " ");
  // Convert protected bold to HTML
  text = text.replace(new RegExp(`${BOLD_OPEN}([^${BOLD_CLOSE}]*)${BOLD_CLOSE}`, "g"), "<strong>$1</strong>");
  // Convert protected italic to HTML
  text = text.replace(new RegExp(`${ITALIC_OPEN}([^${ITALIC_CLOSE}]*)${ITALIC_CLOSE}`, "g"), "<em>$1</em>");
  return text;
}

/**
 * Convert markdown bold/italic markers to HTML.
 * Handles **bold** and *italic* syntax.
 * Also handles protected markers from protectMarkdown().
 */
export function inlineMarkdown(html: string): string {
  // First restore any protected markers
  html = restoreMarkdownToHtml(html);
  // Bold: **text** → <strong>text</strong>
  html = html.replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>");
  // Then italic: *text* → <em>text</em>
  html = html.replace(
    /(?<!\*)\*(?!\*)([\s\S]+?)(?<!\*)\*(?!\*)/g,
    "<em>$1</em>",
  );
  return html;
}
