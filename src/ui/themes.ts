export interface Theme {
  // Surfaces
  bg: string;
  bgAlt: string;
  // Text
  text: string;
  textMuted: string;
  // Borders
  border: string;
  // Headings
  h1: string;
  h2: string;
  h3: string;
  h4: string;
  h5: string;
  // Inline
  link: string;
  bold: string;
  italic: string;
  // Code
  codeBg: string;
  codeBlockBg: string;
  // Blockquote
  blockquoteBorder: string;
  blockquoteText: string;
  // Table
  tableHeaderBg: string;
  // Diff: added
  addedBorder: string;
  addedBg: string;
  // Diff: removed
  removedBorder: string;
  removedBg: string;
  // Diff: modified
  modifiedBorder: string;
  modifiedBg: string;
  // Inline diff: del/ins
  delBg: string;
  delText: string;
  delMinorBg: string;
  delMinorText: string;
  delMinorBorder: string;
  insBg: string;
  insText: string;
  insMinorBg: string;
  insMinorText: string;
  insMinorBorder: string;
  // Char-level diff
  charRemovedBg: string;
  charRemovedText: string;
  charAddedBg: string;
  charAddedText: string;
  charRemovedMinorBg: string;
  charRemovedMinorText: string;
  charRemovedMinorBorder: string;
  charAddedMinorBg: string;
  charAddedMinorText: string;
  charAddedMinorBorder: string;
  // Spacer
  spacerBg: string;
  // Stats bar
  statText: string;
  statEqualDot: string;
  // Scrollbar
  scrollTrack: string;
  scrollThumb: string;
  scrollThumbHover: string;
}

// ── Dark theme ───────────────────────────────────────────────────
// Warm charcoal grays, not blue-tinted, not pure black
export const dark: Theme = {
  bg: "#2b2b2b",
  bgAlt: "#232323",
  text: "#d4d4d4",
  textMuted: "#a0a0a0",
  border: "#3e3e3e",
  h1: "#e0976e",       // warm orange
  h2: "#7eb8da",       // soft blue
  h3: "#6bc5a0",       // soft teal
  h4: "#c4a7e7",       // soft lavender
  h5: "#a8c97e",       // muted green
  link: "#7eb8da",
  bold: "#d4d4d4",     // same as text
  italic: "#d4d4d4",   // same as text
  codeBg: "#353535",
  codeBlockBg: "#1e1e1e",
  blockquoteBorder: "#555",
  blockquoteText: "#999",
  tableHeaderBg: "#353535",
  addedBorder: "#6bc57e",
  addedBg: "rgba(107, 197, 126, 0.1)",
  removedBorder: "#d47380",
  removedBg: "rgba(212, 115, 128, 0.1)",
  modifiedBorder: "#d4a057",
  modifiedBg: "rgba(212, 160, 87, 0.08)",
  delBg: "rgba(212, 115, 128, 0.14)",
  delText: "#d47380",
  delMinorBg: "rgba(212, 115, 128, 0.1)",
  delMinorText: "#c09099",
  delMinorBorder: "rgba(212, 115, 128, 0.5)",
  insBg: "rgba(107, 197, 126, 0.14)",
  insText: "#6bc57e",
  insMinorBg: "rgba(107, 197, 126, 0.1)",
  insMinorText: "#90b898",
  insMinorBorder: "rgba(107, 197, 126, 0.5)",
  charRemovedBg: "rgba(212, 115, 128, 0.5)",
  charRemovedText: "#d47380",
  charAddedBg: "rgba(107, 197, 126, 0.5)",
  charAddedText: "#6bc57e",
  charRemovedMinorBg: "rgba(212, 115, 128, 0.2)",
  charRemovedMinorText: "#c09099",
  charRemovedMinorBorder: "rgba(212, 115, 128, 0.6)",
  charAddedMinorBg: "rgba(107, 197, 126, 0.2)",
  charAddedMinorText: "#90b898",
  charAddedMinorBorder: "rgba(107, 197, 126, 0.6)",
  spacerBg: "rgba(80, 80, 80, 0.1)",
  statText: "#777",
  statEqualDot: "#777",
  scrollTrack: "#2b2b2b",
  scrollThumb: "#4a4a4a",
  scrollThumbHover: "#5a5a5a",
};

// ── Solar theme ──────────────────────────────────────────────────
// Kindle / e-ink warm sepia — easy on the eyes
export const solar: Theme = {
  bg: "#faf4e8",
  bgAlt: "#f0e8d6",
  text: "#433422",
  textMuted: "#7a6b57",
  border: "#d9ccb4",
  h1: "#9e5a2a",       // burnt sienna
  h2: "#3b7a8c",       // teal ink
  h3: "#5a7a3b",       // olive
  h4: "#7a5a8c",       // muted purple
  h5: "#6b7a3b",       // sage
  link: "#3b7a8c",
  bold: "#433422",     // same as text
  italic: "#433422",   // same as text
  codeBg: "#ede5d3",
  codeBlockBg: "#e8dfc9",
  blockquoteBorder: "#c4b598",
  blockquoteText: "#8a7a66",
  tableHeaderBg: "#ede5d3",
  addedBorder: "#5a8a3b",
  addedBg: "rgba(90, 138, 59, 0.1)",
  removedBorder: "#b55a5a",
  removedBg: "rgba(181, 90, 90, 0.1)",
  modifiedBorder: "#b58a3b",
  modifiedBg: "rgba(181, 138, 59, 0.08)",
  delBg: "rgba(181, 90, 90, 0.09)",
  delText: "#9e4a4a",
  delMinorBg: "rgba(181, 90, 90, 0.07)",
  delMinorText: "#a07070",
  delMinorBorder: "rgba(181, 90, 90, 0.4)",
  insBg: "rgba(90, 138, 59, 0.09)",
  insText: "#4a7a2a",
  insMinorBg: "rgba(90, 138, 59, 0.07)",
  insMinorText: "#6a8a55",
  insMinorBorder: "rgba(90, 138, 59, 0.4)",
  charRemovedBg: "rgba(181, 90, 90, 0.3)",
  charRemovedText: "#9e4a4a",
  charAddedBg: "rgba(90, 138, 59, 0.3)",
  charAddedText: "#4a7a2a",
  charRemovedMinorBg: "rgba(181, 90, 90, 0.12)",
  charRemovedMinorText: "#a07070",
  charRemovedMinorBorder: "rgba(181, 90, 90, 0.5)",
  charAddedMinorBg: "rgba(90, 138, 59, 0.12)",
  charAddedMinorText: "#6a8a55",
  charAddedMinorBorder: "rgba(90, 138, 59, 0.5)",
  spacerBg: "rgba(180, 165, 140, 0.15)",
  statText: "#8a7a66",
  statEqualDot: "#8a7a66",
  scrollTrack: "#faf4e8",
  scrollThumb: "#c4b598",
  scrollThumbHover: "#b0a488",
};

export const themes = { dark, solar } as const;
export type ThemeName = keyof typeof themes;

/** Generate CSS custom-property declarations for a theme. */
export function themeVars(t: Theme): string {
  return Object.entries(t)
    .map(([k, v]) => `--md-${camel2kebab(k)}: ${v};`)
    .join("\n    ");
}

function camel2kebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}
