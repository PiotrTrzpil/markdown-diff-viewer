# Canvas Renderer Design Doc

## Vision

Replace the entire HTML/CSS rendering layer with a **hybrid canvas + DOM renderer** powered by **pretext** for text measurement. The diff pipeline (`DiffPair[]`) remains unchanged. Everything after it is new.

**Current**: `DiffPair[] → render.ts (HTML strings) → template.tsx (embedded HTML/CSS/JS) → browser displays HTML with CSS layout`
**New**: `DiffPair[] → serialize to JSON → embed in HTML shell → browser: measure (pretext) → layout (arithmetic) → paint backgrounds (canvas) + place text (absolutely-positioned DOM)`

**Two-layer rendering**:
- **Canvas** (back layer): colored rectangles — block backgrounds, inline diff highlights, borders, divider line. No text.
- **DOM** (front layer): `<span>` elements with `position: absolute` at pretext-computed coordinates. Real selectable text. No CSS layout.

No flexbox, grid, overlays, visibility hacks. All positioning is computed in JS. Canvas draws rectangles. DOM draws text at exact positions. Text is natively selectable, searchable (Cmd+F), and accessible — no invisible overlay tricks.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Server Side (Node.js)                 │
│                                                         │
│  Markdown → Parse → Diff Pipeline → DiffPair[]          │
│                         ↓                               │
│              serialize() → DiffData (JSON)               │
│                         ↓                               │
│         Embed JSON + bundled JS in HTML shell            │
└─────────────────────────────────────────────────────────┘
                          ↓  (open in browser)
┌─────────────────────────────────────────────────────────┐
│                    Client Side (Browser)                 │
│                                                         │
│  1. Parse DiffData JSON                                 │
│  2. PREPARE: prepareWithSegments() per styled run       │
│     (one-time, ~0.04ms/block, cached by pretext)        │
│  3. HEIGHT PASS: layout() for ALL blocks                │
│     (~0.0002ms/block — sub-ms for 1000 blocks)          │
│     → row heights, scroll height, virtual scroll setup  │
│  4. LINE PASS: layoutNextLine()/layoutWithLines()       │
│     for VISIBLE blocks only → LayoutSegment[]           │
│  5. Canvas: fillRect for backgrounds/highlights/borders │
│  6. DOM: <span style="position:absolute"> per segment   │
│     → real selectable text, native Cmd+F, accessible    │
│  7. Minimap: walkLineRanges() — geometry without text   │
└─────────────────────────────────────────────────────────┘
```

### Key Principles

1. The layout engine produces a **flat list of paint operations** — rectangles and text draws with absolute coordinates. The canvas renderer is a trivial loop. All intelligence lives in the layout phase.

2. **pretext's two-phase design is the backbone.** The expensive `prepareWithSegments()` runs once per text segment on load. The cheap `layout()` runs on every resize for ALL blocks (~0.0002ms each). The rich `layoutNextLine()` / `layoutWithLines()` runs only for VISIBLE blocks on paint. This three-tier approach means resize is sub-millisecond and scroll only touches what's on screen.

```
                    ┌─────────────────────────────────────┐
                    │  prepareWithSegments() per run       │  ONE TIME
                    │  ~0.04ms/block, cached by pretext    │  (on load / font change)
                    └────────────┬────────────────────────┘
                                 │
              ┌──────────────────┼──────────────────────┐
              ▼                  ▼                       ▼
     ┌────────────────┐  ┌──────────────┐  ┌────────────────────┐
     │ layout()       │  │ walkLine     │  │ layoutWithLines()  │
     │ → heights only │  │ Ranges()     │  │ or layoutNextLine  │
     │ ALL blocks     │  │ → minimap    │  │ loop               │
     │ EVERY RESIZE   │  │ geometry     │  │ VISIBLE ONLY       │
     │ ~0.2ms/1000    │  │ no text      │  │ → paint + selection │
     └────────────────┘  └──────────────┘  └────────────────────┘
          HEIGHT PASS        MINIMAP            LINE PASS
```

---

## Module Breakdown

### Module 1: Serializer (`src/serialize/serialize.ts`)

**Purpose**: Convert `DiffPair[]` to a JSON-serializable format, stripping mdast nodes down to plain data.

**Runs**: Server-side (Node.js)

```ts
// ── Input: what the diff pipeline produces ──

// ── Output: JSON-safe data ──

interface DiffData {
  files: FileDiffData[];
  settings: UISettings;
  meta: {
    leftTitle: string;
    rightTitle: string;
    projectRoot?: string;
    command?: string;
    version: string;
  };
}

interface FileDiffData {
  path: string;
  pairs: SerializedPair[];
  pairsByLevel?: Record<MatchingLevel, SerializedPair[]>;
  added?: number;
  removed?: number;
}

type SerializedPair =
  | { status: "equal"; left: BlockData; right: BlockData }
  | { status: "added"; right: BlockData; moved?: true; inlineDiff?: InlinePart[] }
  | { status: "removed"; left: BlockData }
  | {
      status: "modified";
      left: BlockData;
      right: BlockData;
      inlineDiff: InlinePart[];
      metrics: DiffMetrics;
      wrapTag: string;
    }
  | {
      status: "split";
      original: BlockData;
      firstPart: BlockData;
      secondPart: BlockData;
      splitPoint: number;
    };

interface BlockData {
  /** Raw markdown text of the block (what blockToText returns) */
  text: string;
  /** Inner text for rendering (no heading # prefix, no code fences) */
  innerText: string;
  /** Block type */
  type: "paragraph" | "heading" | "code" | "blockquote" | "list" | "table" | "html" | "thematicBreak";
  /** 1-6 for headings */
  headingLevel?: number;
  /** Source line number */
  line?: number;
}
```

**Implementation**: Walk `DiffPair[]`, extract text via existing `blockToText()` / `blockInnerText()`, classify type from mdast node, serialize `InlinePart[]` as-is (already plain objects).

**InlinePart is already JSON-safe** — it's `{ value, type, children?, minor?, absorbLevel? }`. No change needed.

**Dependencies**: `src/text/parse.ts` (blockToText, blockInnerText, getWrapTag)

---

### Module 2: Inline Markdown Parser (`src/canvas/markdown-spans.ts`)

**Purpose**: Parse inline markdown formatting into **styled text runs** for measurement and painting.

**Runs**: Client-side (browser)

This replaces remark/rehype for inline content. We only need inline formatting — block-level structure is already known from `BlockData.type`.

```ts
interface StyledRun {
  text: string;
  bold: boolean;
  italic: boolean;
  code: boolean;
  strikethrough: boolean;
  link?: string;  // URL if this is link text
}

/** Parse inline markdown to styled runs */
function parseInlineMarkdown(text: string): StyledRun[]
```

**What to parse**:
- `**bold**` / `__bold__`
- `*italic*` / `_italic_`
- `` `code` ``
- `~~strikethrough~~`
- `[text](url)` — render text with link color, store URL
- Nested: `**bold *and italic* text**`
- Escape: `\*not italic\*`

**What NOT to parse** (handled at block level):
- Headings (`#`)
- Code blocks (` ``` `)
- Block quotes (`>`)
- Lists (`-`, `1.`)
- Tables
- Images (show alt text as plain text)
- HTML blocks (show as plain text, muted)

**Implementation**: State machine or recursive descent parser. Small — inline markdown grammar is simple. Each run is a contiguous text span with uniform style.

---

### Module 3: Font Registry (`src/canvas/fonts.ts`)

**Purpose**: Map (blockType, headingLevel, styledRun) → canvas font string + metrics.

```ts
interface FontSpec {
  family: string;    // "Inter, system-ui, sans-serif"
  size: number;      // pixels
  weight: number;    // 400, 600, 700
  style: "normal" | "italic";
  lineHeight: number; // pixels
}

interface FontConfig {
  baseFontSize: number;  // from settings, default 16
  fontFamily: string;
  monoFamily: string;    // for code
}

/** Resolve font for a styled run within a block context */
function resolveFont(
  blockType: BlockData["type"],
  headingLevel: number | undefined,
  run: StyledRun,
  config: FontConfig,
): FontSpec

/** Convert FontSpec to canvas font string */
function toCanvasFont(spec: FontSpec): string
// e.g. "bold italic 16px Inter, system-ui, sans-serif"
```

**Font mapping** (matches current CSS):

| Block Type | Base Size | Weight | Extra |
|-----------|----------|--------|-------|
| paragraph | 1em | 400 | |
| heading h1 | 1.8em | 700 | |
| heading h2 | 1.4em | 700 | |
| heading h3 | 1.2em | 600 | |
| heading h4 | 1.1em | 600 | |
| heading h5 | 1.0em | 600 | |
| heading h6 | 0.9em | 600 | |
| code | 0.9em | 400 | monospace family |
| blockquote | 1em | 400 | italic |
| list | 1em | 400 | |

Inline modifiers applied additively:
- `bold` → weight = max(current, 700)
- `italic` → style = "italic"
- `code` → family = monoFamily, size *= 0.9

**Line heights**: `fontSize * 1.6` for body, `fontSize * 1.3` for headings, `fontSize * 1.5` for code.

---

### Module 4: Text Measurement (`src/canvas/measure.ts`)

**Purpose**: Prepare text segments via pretext for measurement and line-breaking.

**Runs**: Client-side (browser)

```ts
import {
  prepareWithSegments,
  layoutNextLine,
  walkLineRanges,
  type PreparedTextWithSegments,
  type LayoutCursor,
} from "@chenglou/pretext";

interface PreparedRun extends StyledRun {
  font: FontSpec;
  canvasFont: string;
  /** pretext prepared handle — used for line-breaking */
  prepared: PreparedTextWithSegments;
  /** Full single-line width (measured via pretext at infinite width) */
  fullWidth: number;
  /** Cursor at end of this run's text */
  endCursor: LayoutCursor;
}

const LINE_START: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };
const UNBOUNDED = 100_000;

/** Measure single-line width of prepared text */
function measureFullWidth(prepared: PreparedTextWithSegments): number {
  let w = 0;
  walkLineRanges(prepared, UNBOUNDED, (line) => { w = line.width; });
  return w;
}

/** Prepare a single styled run for measurement + line-breaking */
function prepareRun(run: StyledRun, blockType: BlockData["type"], headingLevel: number | undefined, config: FontConfig): PreparedRun {
  const font = resolveFont(blockType, headingLevel, run, config);
  const canvasFont = toCanvasFont(font);
  const prepared = prepareWithSegments(run.text, canvasFont);
  const wholeLine = layoutNextLine(prepared, LINE_START, UNBOUNDED);

  return {
    ...run,
    font,
    canvasFont,
    prepared,
    fullWidth: wholeLine?.width ?? 0,
    endCursor: wholeLine?.end ?? LINE_START,
  };
}

/** Prepare all runs in a block */
function prepareBlock(
  runs: StyledRun[],
  blockType: BlockData["type"],
  headingLevel: number | undefined,
  config: FontConfig,
): PreparedRun[] {
  return runs.map(r => prepareRun(r, blockType, headingLevel, config));
}
```

**Key insight**: Each run gets its own `prepareWithSegments()` call with the correct font (bold, italic, code, etc.). pretext handles word segmentation, CJK, emoji correction, bidi — per run. The `prepared` handle is then used in two ways:

1. **Height pass** (all blocks, every resize): `layout(prepared, columnWidth, lineHeight)` → `{ height, lineCount }`. Pure arithmetic, ~0.0002ms. Uses the lightweight path internally.
2. **Line pass** (visible blocks only, on paint): `layoutNextLine(prepared, cursor, remainingWidth)` → actual text lines for canvas rendering.

**Two handle tiers for single-font vs mixed-font blocks**:

```ts
import { prepare, layout, prepareWithSegments, layoutWithLines, layoutNextLine, walkLineRanges } from "@chenglou/pretext";

/**
 * For single-font blocks (headings, code blocks, plain paragraphs without
 * inline markdown formatting), we can use pretext end-to-end:
 *
 * - prepare() for height-only pass (lightest handle)
 * - prepareWithSegments() + layoutWithLines() for full line rendering
 *
 * layoutWithLines() returns { lines: LayoutLine[] } with .text and .width
 * per line — no manual layoutNextLine loop needed.
 */
interface SingleFontBlock {
  kind: "single-font";
  text: string;
  canvasFont: string;
  font: FontSpec;
  /** Lightweight handle — used for height pass on every resize */
  preparedLight: PreparedText;
  /** Rich handle — used for line pass on visible blocks only */
  preparedRich: PreparedTextWithSegments;
}

/**
 * For mixed-font blocks (paragraphs with **bold**, *italic*, `code`),
 * each styled run gets its own prepared handle. Line breaking uses the
 * layoutNextLine() loop from rich-note.ts.
 *
 * Height pass: sum layout().height across runs is an approximation.
 * Exact height requires running the layoutNextLine loop (done on visible blocks).
 * For off-screen blocks, the approximation is close enough for scroll position.
 */
interface MixedFontBlock {
  kind: "mixed-font";
  runs: PreparedRun[];
  /** Approximate height from dominant font (for fast height pass) */
  approxPrepared: PreparedText;
}
```

**Code blocks use `pre-wrap` mode** — pretext supports this natively:

```ts
// Code blocks preserve whitespace, hard line breaks, and tabs
const codePrepared = prepareWithSegments(codeText, monoFont, { whiteSpace: "pre-wrap" });
// layout() and layoutWithLines() both respect pre-wrap mode
const { height } = layout(codePrepared, columnWidth, codeLineHeight);
```

**Caching**: pretext caches internally per `(text, font)` pair. No additional cache layer needed.

**Collapsed space widths**: Following pretext's rich-note pattern, we measure the width of a collapsed space per font for inter-run gaps:

```ts
const spaceWidthCache = new Map<string, number>();

function collapsedSpaceWidth(canvasFont: string): number {
  let w = spaceWidthCache.get(canvasFont);
  if (w !== undefined) return w;
  const joined = measureFullWidth(prepareWithSegments("A A", canvasFont));
  const compact = measureFullWidth(prepareWithSegments("AA", canvasFont));
  w = Math.max(0, joined - compact);
  spaceWidthCache.set(canvasFont, w);
  return w;
}

---

### Module 5: Layout Engine (`src/canvas/layout.ts`)

**Purpose**: Compute absolute (x, y, w, h) positions for every visual element. This is the brain of the renderer.

**Runs**: Client-side, called once per file diff (and on resize).

```ts
// ── Output types ──

interface LayoutRow {
  y: number;
  height: number;
  status: DiffStatus;
  leftBlock: LayoutBlock;
  rightBlock: LayoutBlock;
  /** For virtual scroll: index in pairs array */
  pairIndex: number;
}

interface LayoutBlock {
  /** Absolute position and size */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Background color (null for equal blocks) */
  bgColor: string | null;
  /** Left border color */
  borderColor: string | null;
  /** Content lines to paint */
  lines: LayoutLine[];
  /** Block-level decorations (blockquote bar, code bg, list bullet) */
  decorations: Decoration[];
  /** True if this is a spacer (empty, just takes height) */
  spacer: boolean;
}

interface LayoutLine {
  /** Absolute Y position */
  y: number;
  /** Line height */
  height: number;
  /** Text baseline offset from line top */
  baseline: number;
  /** Segments to paint left-to-right */
  segments: LayoutSegment[];
}

interface LayoutSegment {
  /** Absolute X position */
  x: number;
  /** Width in pixels */
  width: number;
  /** Text content */
  text: string;
  /** Canvas font string */
  font: string;
  /** Text color */
  color: string;
  /** Background highlight color (for inline diff) */
  bgColor: string | null;
  /** Text decoration */
  decoration: "none" | "line-through" | "underline";
  /** Opacity (for minor changes) */
  opacity: number;
}

type Decoration =
  | { kind: "rect"; x: number; y: number; w: number; h: number; color: string; opacity?: number }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; color: string; width: number }
  | { kind: "bullet"; x: number; y: number; radius: number; color: string };
```

**Layout has two passes**, matching pretext's two-phase design:

#### Pass 1: Height pass (all blocks, every resize, sub-millisecond)

```
heightPass(pairs: SerializedPair[], columnWidth: number, config: FontConfig) → RowHeights[]

  for each pair:
    1. Determine layout mode (side-by-side vs stacked)

    2. For each side's block:
       IF single-font block (heading, code, plain paragraph):
         height = layout(block.preparedLight, columnWidth, lineHeight).height + padding
       ELSE (mixed-font):
         height = layout(block.approxPrepared, columnWidth, lineHeight).height + padding
         (approximate — exact height computed in line pass for visible blocks)

    3. rowHeight = max(leftHeight, rightHeight)
    4. Store { y: cumulative, height: rowHeight }

  Total time: ~0.0002ms × N blocks → 0.2ms for 1000 blocks
```

This gives us all row positions for: virtual scroll, minimap, scroll height. No text materialization.

#### Pass 2: Line pass (visible blocks only, on paint)

```
linePass(visibleRows: RowHeights[], pairs, columnWidth, theme, config) → LayoutRow[]

  for each visible row:
    1. For each side's block:
       IF single-font block:
         lines = layoutWithLines(block.preparedRich, columnWidth, lineHeight).lines
         → LayoutLine[] with .text, .width per line (pretext does everything)
       ELSE (mixed-font):
         lines = breakIntoLines(block.runs, columnWidth, theme, diffContext)
         → LayoutLine[] via layoutNextLine() loop (rich-note.ts pattern)

    2. Assign absolute (x, y) positions to all lines and segments
    3. If actual height differs from approx (mixed-font), note correction
       (scroll positions self-correct as rows enter viewport)
```

#### Full layout orchestration:

```
layoutDiff(pairs, containerWidth, theme, config):
  columnWidth = (containerWidth - gutterWidth) / 2

  // One-time: prepare all blocks (cached by pretext after first call)
  prepareAllBlocks(pairs, config)

  // Every resize: height pass (~0.2ms for 1000 blocks)
  rowHeights = heightPass(pairs, columnWidth, config)

  // On paint: line pass (visible only)
  // Called by scroll handler with visible range
  visibleRows = linePass(rowHeights[start..end], pairs, columnWidth, theme, config)
```

**Line breaking** (mixed-font, using pretext's `layoutNextLine`):

This follows the pattern from pretext's `rich-note.ts` demo — the proven way to do mixed-font line breaking with pretext.

```ts
/**
 * Break prepared runs into lines using pretext's layoutNextLine.
 *
 * For each run, we ask pretext: "how much of this text fits in the
 * remaining width?" pretext returns the text that fits and a cursor.
 * If the run didn't finish, we break to a new line and continue.
 *
 * This gives us proper word-boundary breaking, CJK support, bidi,
 * emoji handling — all from pretext, per font.
 */
function breakIntoLines(
  runs: PreparedRun[],
  maxWidth: number,
  theme: CanvasTheme,
  diffContext: DiffRunContext,  // carries diffType, minor, absorbLevel per run
): LayoutLine[] {
  const lines: LayoutLine[] = [];
  const safeWidth = Math.max(1, maxWidth);

  let runIndex = 0;
  let textCursor: LayoutCursor | null = null;  // non-null = mid-run

  while (runIndex < runs.length) {
    const segments: LayoutSegment[] = [];
    let lineWidth = 0;
    let lineHeight = 0;
    let remainingWidth = safeWidth;

    // Fill one line
    lineLoop:
    while (runIndex < runs.length) {
      const run = runs[runIndex];
      const diff = diffContext[runIndex];

      // Inter-run gap (space between styled runs)
      const leadingGap = segments.length > 0
        ? collapsedSpaceWidth(run.canvasFont)
        : 0;

      // Fast path: entire run fits on current line
      if (textCursor === null && leadingGap + run.fullWidth <= remainingWidth) {
        segments.push(makeSegment(run, diff, leadingGap, run.fullWidth, run.text, theme));
        lineWidth += leadingGap + run.fullWidth;
        remainingWidth = safeWidth - lineWidth;
        lineHeight = Math.max(lineHeight, run.font.lineHeight);
        runIndex++;
        continue;
      }

      // Slow path: ask pretext how much fits
      const startCursor = textCursor ?? LINE_START;
      const line = layoutNextLine(
        run.prepared,
        startCursor,
        Math.max(1, remainingWidth - leadingGap),
      );

      if (line === null || cursorsMatch(startCursor, line.end)) {
        // Nothing fits or empty — skip run
        runIndex++;
        textCursor = null;
        continue;
      }

      segments.push(makeSegment(run, diff, leadingGap, line.width, line.text, theme));
      lineWidth += leadingGap + line.width;
      lineHeight = Math.max(lineHeight, run.font.lineHeight);

      if (cursorsMatch(line.end, run.endCursor)) {
        // Run fully consumed
        runIndex++;
        textCursor = null;
        remainingWidth = safeWidth - lineWidth;
        continue;
      }

      // Run partially consumed — break to new line
      textCursor = line.end;
      break lineLoop;
    }

    if (segments.length === 0) break;
    lines.push({ segments, height: lineHeight, baseline: lineHeight * 0.8, y: 0 });
  }

  return lines;
}

function cursorsMatch(a: LayoutCursor, b: LayoutCursor): boolean {
  return a.segmentIndex === b.segmentIndex && a.graphemeIndex === b.graphemeIndex;
}
```

**What this gives us**:
- pretext handles all word-boundary detection (including CJK, Thai, Arabic)
- pretext handles emoji and bidi per-run
- We handle cross-run line accumulation (the outer loop)
- Each run uses its own font (bold, italic, code, heading size)
- No custom line-breaking algorithm — pretext does the hard work

**Inline diff overlay onto styled runs**:

For a modified pair, the `inlineDiff: InlinePart[]` describes what changed. The block's `innerText` has inline markdown. We need to merge these two:

1. Parse innerText → `StyledRun[]` (font/style info)
2. Walk `InlinePart[]` to get diff status per character range
3. Merge: each output segment has both style (from markdown) and diff status (from inline diff)

```ts
interface DiffStyledRun extends StyledRun {
  diffType: "equal" | "added" | "removed";
  minor: boolean;
  absorbLevel?: "stopword" | "single";
}

/** Merge markdown styling with diff information */
function mergeDiffAndStyle(
  styledRuns: StyledRun[],
  inlineParts: InlinePart[],
  side: "left" | "right",
): DiffStyledRun[]
```

This is the trickiest part — mapping character positions between the styled runs (from markdown parse) and the inline diff parts (from diff computation). Both cover the same text, just sliced differently.

**Algorithm**: Walk both arrays simultaneously by character offset. When a styled run boundary or diff part boundary is hit, emit a new `DiffStyledRun` segment with the current style + diff status. This is an interval merge.

**Stacked layout** (for low-similarity pairs):

When pairs are stacked, removed blocks render full-width on the left as a single merged block, then added blocks render full-width on the right. The existing grouping logic from `layout.ts:groupPairsForLayout()` applies. In canvas layout, stacked groups simply emit:
1. A row with left = merged removed content, right = spacer
2. A row with left = spacer, right = merged added content

---

### Module 6: Canvas Painter (`src/canvas/painter.ts`)

**Purpose**: Paint background rectangles to a canvas. **No text** — text is handled by the DOM text layer (Module 7). The canvas only draws colored rectangles: block backgrounds, inline diff highlights, borders, decorations, and the center divider.

```ts
class DiffPainter {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr: number;  // devicePixelRatio for crisp rendering

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.dpr = window.devicePixelRatio || 1;
  }

  /** Paint visible rows — backgrounds and decorations only */
  paint(rows: LayoutRow[], viewport: { top: number; bottom: number }, theme: CanvasTheme): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.clearRect(0, viewport.top, this.canvas.width / this.dpr, viewport.bottom - viewport.top);

    // Center divider
    const centerX = this.canvas.width / this.dpr / 2;
    ctx.strokeStyle = theme.border;
    ctx.beginPath();
    ctx.moveTo(centerX, viewport.top);
    ctx.lineTo(centerX, viewport.bottom);
    ctx.stroke();

    for (const row of rows) {
      if (row.y + row.height < viewport.top) continue;
      if (row.y > viewport.bottom) break;
      this.paintBlock(row.leftBlock, ctx);
      this.paintBlock(row.rightBlock, ctx);
    }

    ctx.restore();
  }

  private paintBlock(block: LayoutBlock, ctx: CanvasRenderingContext2D): void {
    if (block.spacer) return;

    // Block background (added/removed/modified)
    if (block.bgColor) {
      ctx.fillStyle = block.bgColor;
      ctx.fillRect(block.x, block.y, block.width, block.height);
    }

    // Left border strip
    if (block.borderColor) {
      ctx.fillStyle = block.borderColor;
      ctx.fillRect(block.x, block.y, 3, block.height);
    }

    // Decorations (blockquote bars, code block backgrounds, list bullets)
    for (const dec of block.decorations) {
      if (dec.kind === "rect") {
        ctx.globalAlpha = dec.opacity ?? 1;
        ctx.fillStyle = dec.color;
        ctx.fillRect(dec.x, dec.y, dec.w, dec.h);
        ctx.globalAlpha = 1;
      } else if (dec.kind === "line") {
        ctx.strokeStyle = dec.color;
        ctx.lineWidth = dec.width;
        ctx.beginPath();
        ctx.moveTo(dec.x1, dec.y1);
        ctx.lineTo(dec.x2, dec.y2);
        ctx.stroke();
      } else if (dec.kind === "bullet") {
        ctx.fillStyle = dec.color;
        ctx.beginPath();
        ctx.arc(dec.x, dec.y, dec.radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Inline diff highlights (background rectangles behind text)
    for (const line of block.lines) {
      for (const seg of line.segments) {
        if (seg.bgColor) {
          ctx.globalAlpha = seg.opacity;
          ctx.fillStyle = seg.bgColor;
          ctx.fillRect(seg.x, line.y, seg.width, line.height);
          ctx.globalAlpha = 1;
        }
        // Strikethrough line (for removed text)
        if (seg.decoration === "line-through") {
          ctx.strokeStyle = seg.color;
          ctx.lineWidth = 1;
          ctx.globalAlpha = seg.opacity;
          const midY = line.y + line.baseline - line.height * 0.15;
          ctx.beginPath();
          ctx.moveTo(seg.x, midY);
          ctx.lineTo(seg.x + seg.width, midY);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }
  }
}
```

**The canvas never calls `fillText`**. It only draws `fillRect`, `strokeRect`, `arc`, and `stroke` for lines. All text is real DOM. Compare with current `render.ts` at 427 lines of interleaved logic.

---

### Module 7: Text Layer (`src/canvas/text-layer.ts`)

**Purpose**: Place real, selectable DOM text at pretext-computed positions. Each `LayoutSegment` becomes an absolutely-positioned `<span>`. No CSS layout — the browser just paints glyphs where we tell it.

```ts
class TextLayer {
  private container: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.container = document.createElement("div");
    this.container.style.cssText =
      "position:absolute; top:0; left:0; right:0; pointer-events:auto; user-select:text;";
    parent.appendChild(this.container);
  }

  /** Rebuild text spans for visible rows */
  update(rows: LayoutRow[], viewport: { top: number; bottom: number }): void {
    this.container.textContent = "";  // Clear
    const frag = document.createDocumentFragment();

    for (const row of rows) {
      if (row.y + row.height < viewport.top) continue;
      if (row.y > viewport.bottom) break;

      this.addBlock(row.leftBlock, frag);
      this.addBlock(row.rightBlock, frag);
    }

    this.container.appendChild(frag);
  }

  private addBlock(block: LayoutBlock, frag: DocumentFragment): void {
    if (block.spacer) return;

    for (const line of block.lines) {
      for (const seg of line.segments) {
        const span = document.createElement("span");
        span.textContent = seg.text;
        span.style.cssText =
          `position:absolute;` +
          `top:${line.y}px;` +
          `left:${seg.x}px;` +
          `font:${seg.font};` +
          `color:${seg.color};` +
          `line-height:${line.height}px;` +
          `white-space:pre;` +
          `opacity:${seg.opacity};`;
        frag.appendChild(span);
      }
    }
  }
}
```

**What this gives us for free**:
- **Native text selection** — click, drag, shift+click, double-click (word), triple-click (line) all work
- **Native Cmd+F** — browser find searches real DOM text
- **Native Cmd+C** — browser copy works on selected text
- **Screen reader support** — real DOM text is accessible
- **Right-click context menu** — native browser context menu works
- **No alignment risk** — the text IS the text, not an invisible overlay matched to canvas

**Performance**: ~30 visible rows × 2 blocks × ~3 lines × ~4 segments = ~720 `<span>` elements. All `position: absolute` — the browser does zero layout computation, just glyph painting. This is trivial for any modern browser.

**Rebuild on scroll**: On each scroll, clear and rebuild spans for the new visible range. Using `DocumentFragment` for batch DOM insertion. The browser handles this in well under 1ms for ~720 elements.

**Copy with context**: On `Cmd+Shift+C`, find which block the selection starts in (by Y coordinate → row lookup via binary search on `LayoutRow.y`), get the source line number from `LayoutRow`, format as `filename:line\ntext`.

---

### Module 8: Virtual Scroll (`src/canvas/scroll.ts`)

**Purpose**: Efficient scrolling with only visible rows rendered.

```ts
class VirtualScroll {
  private container: HTMLDivElement;
  private scrollHeight: number;
  private rowPositions: Array<{ y: number; height: number }>;  // sorted by y

  constructor(container: HTMLDivElement, rows: LayoutRow[]) {
    this.container = container;
    this.rowPositions = rows.map(r => ({ y: r.y, height: r.height }));
    this.scrollHeight = rows.length > 0
      ? rows[rows.length - 1].y + rows[rows.length - 1].height
      : 0;

    // Set scrollable height via a sentinel div
    const sentinel = document.createElement("div");
    sentinel.style.height = `${this.scrollHeight}px`;
    sentinel.style.width = "1px";
    sentinel.style.position = "absolute";
    sentinel.style.top = "0";
    sentinel.style.visibility = "hidden";
    container.appendChild(sentinel);
  }

  /** Get visible row indices for current scroll position */
  getVisibleRange(scrollTop: number, viewportHeight: number): { start: number; end: number } {
    const top = scrollTop;
    const bottom = scrollTop + viewportHeight;

    // Binary search for first visible row
    let start = this.binarySearch(top);
    // Overscan: render a few extra rows above/below for smooth scrolling
    start = Math.max(0, start - 3);

    let end = start;
    while (end < this.rowPositions.length && this.rowPositions[end].y < bottom) {
      end++;
    }
    end = Math.min(this.rowPositions.length, end + 3);

    return { start, end };
  }

  private binarySearch(targetY: number): number {
    let lo = 0, hi = this.rowPositions.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.rowPositions[mid].y + this.rowPositions[mid].height < targetY) {
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return lo;
  }
}
```

**Scroll events**: On scroll, compute visible range, call `painter.paint(visibleRows, viewport)` + `selection.update(visibleRows, viewport)`.

**No dual-pane scroll sync needed** — it's one container with one scrollbar.

---

### Module 9: Minimap (`src/canvas/minimap.ts`)

**Purpose**: Overview minimap using the same layout data.

```ts
class Minimap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  paint(rows: LayoutRow[], totalHeight: number, viewportTop: number, viewportHeight: number): void {
    const scale = this.canvas.height / totalHeight;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw rows as colored bars
    for (const row of rows) {
      if (row.status === "equal") continue;  // Skip equal rows in minimap

      const y = row.y * scale;
      const h = Math.max(row.height * scale, 2);
      ctx.fillStyle = this.statusColor(row.status);
      ctx.fillRect(0, y, this.canvas.width, h);
    }

    // Viewport indicator
    const vpY = viewportTop * scale;
    const vpH = viewportHeight * scale;
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.fillRect(0, vpY, this.canvas.width, vpH);
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.strokeRect(0, vpY, this.canvas.width, vpH);
  }
}
```

Minimap becomes **trivial** — it reads the same row heights from the height pass. No separate DOM measurement. No cache invalidation. No `getBoundingClientRect()`.

For more detailed minimap rendering (showing line-level detail within blocks), use `walkLineRanges()` — pretext's geometry-only API that gives line widths and positions without materializing text strings:

```ts
// Get line-level geometry for a block without creating text strings
walkLineRanges(block.preparedRich, columnWidth, (lineRange) => {
  // lineRange.width — how wide this line is
  // lineRange.start, lineRange.end — cursor positions
  // No .text property — cheaper than layoutWithLines()
  const y = blockY + lineIndex * lineHeight;
  const w = (lineRange.width / columnWidth) * minimapColumnWidth;
  ctx.fillRect(minimapX, y * scale, w, Math.max(lineHeight * scale, 1));
});
```

---

### Module 10: Theme & Colors (`src/canvas/theme.ts`)

**Purpose**: Color palette for painting. Replaces CSS custom properties.

```ts
interface CanvasTheme {
  name: "dark" | "solar";

  // Backgrounds
  bg: string;
  paneBg: string;

  // Text
  textColor: string;
  mutedText: string;

  // Headings (h1-h6)
  headingColors: [string, string, string, string, string, string];

  // Diff status
  addedBg: string;
  addedBorder: string;
  addedTextBg: string;      // inline <ins> highlight
  removedBg: string;
  removedBorder: string;
  removedTextBg: string;    // inline <del> highlight
  modifiedBg: string;
  modifiedBorder: string;

  // Minor changes
  minorAddedBg: string;
  minorRemovedBg: string;

  // UI
  border: string;
  scrollThumb: string;
  minimapViewport: string;

  // Code
  codeBg: string;
  codeText: string;

  // Blockquote
  quoteBorder: string;
  quoteText: string;

  // Links
  linkColor: string;
}
```

Derive from existing `themes.ts` color values. One object per theme, no CSS variables.

---

### Module 11: HTML Shell (`src/canvas/shell.ts`)

**Purpose**: Generate the minimal HTML document that hosts the canvas app. Replaces the 1800-line `template.tsx`.

```ts
function generateCanvasHtml(data: DiffData): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>md-diff</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; overflow: hidden; background: ${data.settings.theme === "solar" ? "#faf4e8" : "#2b2b2b"}; }
    #app { position: relative; width: 100%; height: 100%; overflow-y: auto; }
    #canvas { position: absolute; top: 0; left: 0; pointer-events: none; }
    #text { position: absolute; top: 0; left: 0; right: 0; user-select: text; }
    #text span { position: absolute; white-space: pre; }
    #header { position: fixed; top: 0; left: 0; right: 0; height: 48px; z-index: 10; }
    #minimap { position: fixed; right: 0; top: 48px; bottom: 0; width: 80px; }
    #settings-panel { position: fixed; right: 0; top: 0; width: 320px; z-index: 20; display: none; }
  </style>
</head>
<body>
  <div id="header"></div>
  <div id="app">
    <canvas id="canvas"></canvas>
    <div id="text"></div>
  </div>
  <canvas id="minimap"></canvas>
  <div id="settings-panel"></div>
  <script>
    const DIFF_DATA = ${JSON.stringify(data)};
  </script>
  <script>
    ${bundledClientJs}
  </script>
</body>
</html>`;
}
```

**CSS is ~15 lines** — just positioning the two layers and the UI chrome:
- `#canvas` — behind, `pointer-events: none` (click passes through to text)
- `#text` — in front, `user-select: text` (real selectable text)
- `#text span` — all spans are absolutely positioned, `white-space: pre`

**Header and settings panel**: The only DOM elements with any structure. Built with `document.createElement` in JS. The header has: titles, theme toggle, settings button. The settings panel has: theme, font size, matching level, etc. Simple DOM — a few divs, buttons, and inputs. No CSS layout complexity.

---

### Module 12: App Controller (`src/canvas/app.ts`)

**Purpose**: Orchestrate initialization, event handling, settings, resize.

```ts
class DiffApp {
  private data: DiffData;
  private currentPairs: SerializedPair[];
  private rowHeights: RowHeights[];
  private painter: DiffPainter;       // Canvas: backgrounds only
  private textLayer: TextLayer;        // DOM: real selectable text
  private scroll: VirtualScroll;
  private minimap: Minimap;
  private theme: CanvasTheme;
  private fontConfig: FontConfig;

  constructor(data: DiffData) {
    this.data = data;
    this.theme = getTheme(data.settings.theme ?? "dark");
    this.fontConfig = {
      baseFontSize: data.settings.fontSize ?? 16,
      fontFamily: "Inter, system-ui, sans-serif",
      monoFamily: "'JetBrains Mono', 'Fira Code', monospace",
    };

    // Prepare all blocks (one-time measurement via pretext)
    this.currentPairs = data.files[0].pairs;
    await document.fonts.ready;  // Wait for web fonts before measuring
    prepareAllBlocks(this.currentPairs, this.fontConfig);

    // Height pass: compute all row heights (sub-ms)
    this.rowHeights = heightPass(this.currentPairs, containerWidth, this.fontConfig);

    // Initialize rendering
    this.painter = new DiffPainter(canvasEl);
    this.textLayer = new TextLayer(appEl);
    this.scroll = new VirtualScroll(appEl, this.rowHeights);
    this.minimap = new Minimap(minimapEl);

    // Events
    appEl.addEventListener("scroll", () => this.onScroll());
    window.addEventListener("resize", () => this.onResize());
  }

  private onResize(): void {
    // Height pass only — sub-millisecond for all blocks
    this.rowHeights = heightPass(this.currentPairs, columnWidth, this.fontConfig);
    this.scroll.updatePositions(this.rowHeights);
    this.onScroll();  // Triggers line pass for visible rows
  }

  private onScroll(): void {
    const { start, end } = this.scroll.getVisibleRange(scrollTop, viewportHeight);

    // Line pass — only visible rows get full line-breaking
    const visibleRows = linePass(
      this.rowHeights.slice(start, end),
      this.currentPairs,
      columnWidth,
      this.theme,
      this.fontConfig,
    );

    this.painter.paint(visibleRows, viewport, this.theme);
    this.textLayer.update(visibleRows, viewport);
    this.minimap.paint(this.rowHeights, totalHeight, scrollTop, viewportHeight);
  }

  /** Switch matching level — re-prepare + height pass for new pair set */
  setMatchLevel(level: MatchingLevel): void {
    this.currentPairs = this.data.files[this.currentFile].pairsByLevel?.[level]
      ?? this.data.files[this.currentFile].pairs;
    prepareAllBlocks(this.currentPairs, this.fontConfig);  // one-time if not cached
    this.rowHeights = heightPass(this.currentPairs, columnWidth, this.fontConfig);
    this.scroll.updatePositions(this.rowHeights);
    this.onScroll();
  }

  /** Switch theme — repaint only, no re-measure needed */
  setTheme(name: "dark" | "solar"): void {
    this.theme = getTheme(name);
    this.onScroll();  // Just repaint with new colors
  }

  /** Change font size — must re-prepare (new font strings) + height pass */
  setFontSize(size: number): void {
    this.fontConfig.baseFontSize = size;
    clearCache();  // pretext cache is per (text, font) — font changed
    prepareAllBlocks(this.currentPairs, this.fontConfig);
    this.rowHeights = heightPass(this.currentPairs, columnWidth, this.fontConfig);
    this.scroll.updatePositions(this.rowHeights);
    this.onScroll();
  }
}
```

**Multi-file support**: `activateFile(idx)` switches `this.currentFile`, recomputes layout for that file's pairs, saves/restores scroll position.

---

## What Changes in the Existing Code

### Unchanged (keep as-is)
- `src/core/*` — entire diff pipeline
- `src/text/*` — parsing, tokenization, similarity, metrics
- `src/config.ts` — matching levels, thresholds
- `src/cli/index.ts` — CLI argument parsing
- `src/debug.ts` — debug logging

### Modified
- `src/cli/output.ts` — call `serialize()` + `generateCanvasHtml()` instead of `renderDiffPairs()` + `generateHtml()`

### Removed (replaced by canvas modules)
- `src/render/render.ts` — replaced by layout + painter
- `src/render/render-hints.ts` — absorbed into layout (isMinorChange logic)
- `src/render/layout.ts` — absorbed into canvas layout engine
- `src/ui/template.tsx` — replaced by shell + app controller
- `src/ui/themes.ts` — replaced by canvas theme
- `src/text/html.ts` — no more HTML escaping, markdown→HTML, protected markers

### New
- `src/serialize/serialize.ts`
- `src/canvas/markdown-spans.ts`
- `src/canvas/fonts.ts`
- `src/canvas/measure.ts`
- `src/canvas/layout.ts`
- `src/canvas/painter.ts` (backgrounds/highlights only — no text)
- `src/canvas/text-layer.ts` (absolutely-positioned DOM text spans)
- `src/canvas/scroll.ts`
- `src/canvas/minimap.ts`
- `src/canvas/theme.ts`
- `src/canvas/shell.ts`
- `src/canvas/app.ts`

---

## Implementation Order

### Phase 1: Foundation (can be parallel)
1. **Serializer** — convert DiffPair[] to DiffData JSON
2. **Inline markdown parser** — `**bold**` → StyledRun[]
3. **Font registry** — blockType + style → canvas font string
4. **Theme** — color palettes as plain objects

### Phase 2: Measurement & Layout (sequential, core logic)
5. **Text measurement** — pretext prepare/prepareWithSegments per run, with pre-wrap for code blocks
6. **Layout engine** — two-pass: height pass (layout() for all blocks) + line pass (layoutNextLine/layoutWithLines for visible blocks)

### Phase 3: Rendering (can be parallel after layout)
7. **Canvas painter** — paint background rects, highlights, borders, decorations (no text)
8. **Text layer** — absolutely-positioned DOM `<span>` elements for real selectable text
9. **Virtual scroll** — efficient scroll with binary search
10. **Minimap** — walkLineRanges() geometry visualization

### Phase 4: Integration
11. **HTML shell** — minimal HTML host document
12. **App controller** — wire everything together, events, settings
13. **Output integration** — modify cli/output.ts to use new pipeline

### Phase 5: Polish
14. **Header & settings panel** — DOM-based UI controls
15. **Multi-file navigation** — sidebar, file switching
16. **Keyboard shortcuts** — existing shortcuts ported
17. **Copy with context** — Cmd+Shift+C handler

---

## Risks & Mitigations

### Risk: Mixed-font line breaking
pretext's `prepare()` takes one font at a time. Mixed bold/italic/code within a paragraph requires composing multiple prepared handles.
**Mitigation**: Proven pattern from pretext's own `rich-note.ts` demo. Each styled run gets its own `prepareWithSegments()`. Line breaking uses `layoutNextLine()` per run with `remainingWidth` on the current line. pretext handles word boundaries, CJK, bidi per run; we handle cross-run line accumulation. This is the intended usage pattern.

### Risk: Text/background alignment
DOM text spans and canvas background rects must align. If the DOM places text at a slightly different position than the canvas drew the highlight, it looks wrong.
**Mitigation**: Both layers read from the same `LayoutSegment` coordinates. The DOM span gets `top: Ypx; left: Xpx` from the same values the canvas used for `fillRect(x, y, w, h)`. No separate measurement paths. Build a debug mode that draws bounding boxes on canvas matching each DOM span for validation.

### Risk: Performance on large diffs
Thousands of rows need fast layout computation and virtual scroll.
**Mitigation**: Three-tier pretext usage. Height pass runs `layout()` for all blocks at ~0.0002ms each — 5000 blocks in 1ms. Line pass runs `layoutNextLine()`/`layoutWithLines()` only for ~20-40 visible blocks. Canvas `fillText` is fast. Virtual scroll skips everything off-screen. Profile early.

### Risk: Font loading
Canvas may measure text before web fonts are loaded, giving wrong widths.
**Mitigation**: Use `document.fonts.ready` promise. Defer measurement until fonts are loaded. Fall back to system fonts if load fails.

### Risk: HiDPI / Retina rendering
Canvas needs `devicePixelRatio` scaling for crisp text.
**Mitigation**: Standard pattern: `canvas.width = logicalWidth * dpr`, `ctx.scale(dpr, dpr)`, `canvas.style.width = logicalWidth + "px"`.

### Risk: Tables
Markdown tables need column alignment. Current HTML renderer gets this from `<table>`. In canvas, we need to compute column widths ourselves.
**Mitigation**: Measure each cell, compute max per column, then lay out. Tables are rare in diffs — handle as a stretch goal, render as preformatted text initially.

---

## What We Gain

1. **No CSS layout** — all positioning is arithmetic. No grid, flexbox, overlay, visibility hacks.
2. **No scroll sync** — single container, single scroll.
3. **No height alignment hacks** — heights are pre-computed by pretext `layout()`, not discovered via DOM.
4. **Sub-millisecond resize** — pretext `layout()` at ~0.0002ms/block. 1000 blocks in 0.2ms. No DOM reflow.
5. **Virtual scroll for free** — row heights known upfront from height pass, binary search for visible range.
6. **Lazy line materialization** — `layoutNextLine()`/`layoutWithLines()` only for visible blocks. Off-screen blocks only need height.
7. **Trivial minimap** — `walkLineRanges()` gives geometry without materializing text.
8. **Theme switching = repaint** — no CSS variable propagation, no DOM updates. Same layout data, different colors.
9. **Matching level switch = height pass** — swap pair array, run `layout()` for new blocks, repaint. No hidden DOM.
10. **~15 lines of CSS** instead of ~2500 lines.
11. **Renderer is ~80 lines** instead of ~430 lines.
12. **Testable layout** — layout engine is pure functions, snapshot-testable without a browser.
13. **i18n for free** — pretext handles CJK, Thai, Arabic, bidi, emoji via `Intl.Segmenter`. No custom word-breaking code.
14. **Code blocks preserve whitespace** — pretext's `pre-wrap` mode handles tabs, hard breaks, preserved spaces natively.

## What We Lose (and how we get it back)

| Lost | Recovery |
|------|----------|
| Browser markdown rendering (h1, bold, blockquote styling) | Our own font registry + inline parser. More code, but fully controlled. |
| Native text reflow on resize | pretext `layout()` on resize: 0.2ms for 1000 blocks. Faster than DOM reflow. |
| CSS-based responsive design | Compute layout at new width. Simpler than CSS media queries. |
| Copy-paste preserving formatting | DOM text layer gives native plain text copy. Rich copy could be added later. |
| Browser find (Cmd+F) | DOM text is real — browser find works natively, no special handling needed. |
| Accessibility / screen readers | DOM text is real — screen readers read it natively. Add aria-labels on blocks for structure. |
