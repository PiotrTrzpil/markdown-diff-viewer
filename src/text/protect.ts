/**
 * Protect markdown formatting spans so word/char diff does not split them.
 *
 * Lives under `text/` (not `html/`) because the algorithm depends on it —
 * protection is an input transform, not a presentation concern.
 */

// Marker characters for protected markdown spans
const BOLD_OPEN = "\x02";
const BOLD_CLOSE = "\x03";
const ITALIC_OPEN = "\x04";
const ITALIC_CLOSE = "\x05";
/** Joins words within protected spans so tokenization treats them as one unit */
const WORD_JOIN = "\x00";

/** Escape markers used when restoring protected spans (HTML adapter). */
export const PROTECT_MARKERS = {
  BOLD_OPEN,
  BOLD_CLOSE,
  ITALIC_OPEN,
  ITALIC_CLOSE,
  WORD_JOIN,
} as const;

/**
 * Protect markdown formatting before diffing.
 * Converts **bold** and *italic* to atomic tokens that won't be split by word tokenization.
 * Spaces within formatted spans are replaced with WORD_JOIN to keep them together.
 */
export function protectMarkdown(text: string): string {
  // Bold: **text** → \x02text\x03 (with spaces → \x00)
  text = text.replace(/\*\*([^*]+)\*\*/g, (_match, content: string) => {
    return BOLD_OPEN + content.replace(/ /g, WORD_JOIN) + BOLD_CLOSE;
  });
  // Italic: *text* → \x04text\x05 (with spaces → \x00)
  text = text.replace(/(?<!\*)\*(?!\*)([^*]+)(?<!\*)\*(?!\*)/g, (_match, content: string) => {
    return ITALIC_OPEN + content.replace(/ /g, WORD_JOIN) + ITALIC_CLOSE;
  });
  return text;
}

/**
 * Restore markdown from protected tokens and convert to HTML.
 * Also restores spaces that were converted to WORD_JOIN.
 */
export function restoreProtectedToHtml(text: string): string {
  text = text.replaceAll(WORD_JOIN, " ");
  text = text.replace(
    new RegExp(`${BOLD_OPEN}([^${BOLD_CLOSE}]*)${BOLD_CLOSE}`, "g"),
    "<strong>$1</strong>",
  );
  text = text.replace(
    new RegExp(`${ITALIC_OPEN}([^${ITALIC_CLOSE}]*)${ITALIC_CLOSE}`, "g"),
    "<em>$1</em>",
  );
  return text;
}
