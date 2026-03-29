/**
 * Canvas theme definitions — plain color objects, no CSS variables.
 * Derived from src/ui/themes.ts color values.
 */
import type { CanvasTheme } from "./types.js";

// ─── Dark Theme ──────────────────────────────────────────────────────────────
// Warm charcoal grays — matches the existing dark theme in themes.ts

export const darkTheme: CanvasTheme = {
  name: "dark",

  // Backgrounds
  bg: "#2b2b2b",
  paneBg: "#232323", // bgAlt

  // Text
  textColor: "#d4d4d4",
  mutedText: "#a0a0a0",

  // Headings h1–h6 (h6 derived from h5 by slightly desaturating)
  headingColors: [
    "#e0976e", // h1 — warm orange
    "#7eb8da", // h2 — soft blue
    "#6bc5a0", // h3 — soft teal
    "#c4a7e7", // h4 — soft lavender
    "#a8c97e", // h5 — muted green
    "#8ab88a", // h6 — derived: desaturated h5
  ],

  // Diff status — row-level backgrounds and border accents
  addedBg: "rgba(107, 197, 126, 0.1)",
  addedBorder: "#6bc57e",
  addedTextBg: "rgba(107, 197, 126, 0.14)", // insBg — inline <ins> highlight
  removedBg: "rgba(212, 115, 128, 0.1)",
  removedBorder: "#d47380",
  removedTextBg: "rgba(212, 115, 128, 0.14)", // delBg — inline <del> highlight
  modifiedBg: "rgba(212, 160, 87, 0.08)",
  modifiedBorder: "#d4a057",

  // Minor changes
  minorAddedBg: "rgba(107, 197, 126, 0.2)", // charAddedMinorBg
  minorRemovedBg: "rgba(212, 115, 128, 0.2)", // charRemovedMinorBg

  // UI chrome
  border: "#3e3e3e",
  scrollThumb: "#4a4a4a",
  minimapViewport: "rgba(255, 255, 255, 0.08)", // subtle viewport indicator on dark bg

  // Code
  codeBg: "#353535", // codeBg (inline code)
  codeText: "#d4d4d4", // same as text; code color inherits body text

  // Blockquote
  quoteBorder: "#555",
  quoteText: "#999",

  // Links
  linkColor: "#7eb8da", // same as h2 / link in themes.ts
};

// ─── Solar Theme ─────────────────────────────────────────────────────────────
// Kindle / e-ink warm sepia — matches the existing solar theme in themes.ts

export const solarTheme: CanvasTheme = {
  name: "solar",

  // Backgrounds
  bg: "#faf4e8",
  paneBg: "#f0e8d6", // bgAlt

  // Text
  textColor: "#433422",
  mutedText: "#7a6b57",

  // Headings h1–h6 (h6 derived from h5 by lightening/desaturating slightly)
  headingColors: [
    "#9e5a2a", // h1 — burnt sienna
    "#3b7a8c", // h2 — teal ink
    "#5a7a3b", // h3 — olive
    "#7a5a8c", // h4 — muted purple
    "#6b7a3b", // h5 — sage
    "#7a8a5a", // h6 — derived: lighter sage variant
  ],

  // Diff status — row-level backgrounds and border accents
  addedBg: "rgba(90, 138, 59, 0.1)",
  addedBorder: "#5a8a3b",
  addedTextBg: "rgba(90, 138, 59, 0.09)", // insBg — inline <ins> highlight
  removedBg: "rgba(181, 90, 90, 0.1)",
  removedBorder: "#b55a5a",
  removedTextBg: "rgba(181, 90, 90, 0.09)", // delBg — inline <del> highlight
  modifiedBg: "rgba(181, 138, 59, 0.08)",
  modifiedBorder: "#b58a3b",

  // Minor changes
  minorAddedBg: "rgba(90, 138, 59, 0.12)", // charAddedMinorBg
  minorRemovedBg: "rgba(181, 90, 90, 0.12)", // charRemovedMinorBg

  // UI chrome
  border: "#d9ccb4",
  scrollThumb: "#c4b598",
  minimapViewport: "rgba(67, 52, 34, 0.12)", // subtle viewport indicator on warm bg

  // Code
  codeBg: "#ede5d3", // codeBg (inline code)
  codeText: "#433422", // same as text; code color inherits body text

  // Blockquote
  quoteBorder: "#c4b598",
  quoteText: "#8a7a66",

  // Links
  linkColor: "#3b7a8c", // same as h2 / link in themes.ts
};

// ─── Getter ───────────────────────────────────────────────────────────────────

export function getTheme(name: "dark" | "solar"): CanvasTheme {
  return name === "solar" ? solarTheme : darkTheme;
}
