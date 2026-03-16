# Inline Diff Pipeline Cleanup — Design

## Overview

Refactor the inline diff pipeline to fix four structural problems: blockToText/blockToInnerText divergence, InlinePart.children being a half-baked tree that consumers mishandle, triplicated children-branching in the renderer, and block structure being stripped then re-added. The fix is to flatten InlinePart to a single level, carry a `wrapTag` through the pipeline, and consolidate rendering into one function.

## Current State

- **blockToText** serializes AST nodes including heading prefixes (`## Foo`), used for similarity matching in `pipeline.ts` and `block-matching.ts`
- **blockToInnerText** strips heading prefixes, used only in `createModifiedPair` as input to `computeInlineDiff`
- **InlinePart.children** is an optional second level used for char-level refinement (minor changes, whitespace diffs). Created in `buildMinorPair`, `buildCharDiffPair`, and `boundary-optimize.ts`. Read by `countSharedWords` (handles children), `countTotalWords` (ignores children — latent bug), and three renderer functions
- **wrapInTag** reconstructs `<h2>`, `<p>`, etc. from the original AST node, which the renderer passes alongside the inline diff

**What stays**: All external behavior, diff quality, rendering output. The `InlinePart` type name. The pipeline stages.

**What changes**: InlinePart becomes flat (no children). blockToInnerText is removed. A `wrapTag` string travels with the diff. Renderer children-branching collapses to one function.

**What gets deleted**: `blockToInnerText`, `InlinePart.children`, `renderChildren`, the three-way `if (minor && children) / if (children) / else` pattern.

## Summary for Review

- **Interpretation**: These four issues are interconnected — children exist because block structure is lost, blockToInnerText exists because blockToText includes structure, and the renderer triplicates logic because children are optional. Fixing the root (carry block type through pipeline, flatten parts) cascades into fixing all four.
- **Key decisions**: (1) Flatten children into the top-level parts array rather than making a proper tree — the tree adds complexity with no benefit since there are only ever two levels. (2) Add a `wrapTag` string (e.g. `"h2"`, `"p"`) to `ModifiedPair` rather than to each `InlinePart` — block type is per-pair, not per-part. (3) Keep `blockToText` with heading prefixes for similarity (it genuinely helps distinguish heading-from-paragraph matches), but stop using it as diff input.
- **Assumptions**: The char-level refinement currently in children can be represented as adjacent flat parts with a `minor` flag — no information is lost because children are only ever `[equal, removed/added, equal, ...]` sequences that flatten naturally.
- **Scope**: Core pipeline types + renderer. Does not touch CLI output formatting, debug output, or test infrastructure beyond updating to new types.

## Conventions

- Discriminated union pattern with factory functions + type guards (see `DiffPair` in `block-matching.ts`)
- `pnpm build && pnpm test` to verify
- Never use `?.` on required fields; `!` for known-present values
- Path alias `@/` → `src/`

## Architecture

### Subsystems

| # | Subsystem | Responsibility | Depends On | Files |
|---|-----------|---------------|------------|-------|
| 1 | InlinePart flattening | Remove children, flatten char-level diffs into top-level parts | — | `src/core/inline-diff.ts`, `src/core/boundary-optimize.ts` |
| 2 | Block type threading | Carry wrapTag on ModifiedPair, remove blockToInnerText | 1 | `src/text/parse.ts`, `src/core/block-matching.ts` |
| 3 | Metrics fix | Make countTotalWords children-aware (then simplify since flat) | 1 | `src/text/text-metrics.ts` |
| 4 | Renderer consolidation | Single renderPartContent, remove wrapInTag(node,...) calls | 1, 2 | `src/render/render.ts` |

## Shared Contracts

```typescript
// src/core/inline-diff.ts — CHANGED
export interface InlinePart {
  value: string;
  type: "equal" | "added" | "removed";
  // REMOVED: children?: InlinePart[]
  minor?: boolean;
  absorbLevel?: "stopword" | "single";
  /**
   * Char-level sub-part marker. When true, this part came from
   * character-level refinement (was previously a "child").
   * Renderer uses this to choose <span class="char-*"> vs <del>/<ins>.
   */
  charLevel?: boolean;
}

// src/core/block-matching.ts — CHANGED
export interface ModifiedPair {
  status: "modified";
  left: RootContent;
  right: RootContent;
  inlineDiff: InlinePart[];
  metrics: DiffMetrics;
  /** HTML tag to wrap rendered content: "h1"-"h6", "p", "blockquote", "pre", "ul", "div" */
  wrapTag: string;
}

// src/text/parse.ts — NEW export
/** Get the HTML wrapper tag for a block node */
export function getWrapTag(node: RootContent): string;

// src/text/parse.ts — REMOVED
// blockToInnerText is deleted

// src/render/render.ts — NEW (replaces renderChildren + 3-way branching)
/** Render a single changed part to HTML */
function renderPart(part: InlinePart, nextPart?: InlinePart): string;
```

## Subsystem Details

### Subsystem 1: InlinePart Flattening
**Files**: `src/core/inline-diff.ts`, `src/core/boundary-optimize.ts`
**Key decisions**:
- `buildMinorPair` and `buildCharDiffPair` currently return `{ value, type, children: [...] }`. Change them to return a flat array of parts with `charLevel: true` on the char-level sub-parts. The parent "removed"/"added" part disappears — its children become top-level.
- Concretely, `buildMinorPair("Hello", "hello")` currently returns:
  ```
  [{ value: "Hello", type: "removed", minor: true, children: [{value: "H", type: "removed", minor: true}, {value: "ello", type: "equal"}] },
   { value: "hello", type: "added", minor: true, children: [{value: "h", type: "added", minor: true}, {value: "ello", type: "equal"}] }]
  ```
  After: returns flat array:
  ```
  [{ value: "H", type: "removed", minor: true, charLevel: true },
   { value: "ello", type: "equal", charLevel: true },
   { value: "h", type: "added", minor: true, charLevel: true },
   { value: "ello", type: "equal", charLevel: true }]
  ```
  Wait — this loses the pairing structure that the renderer needs (removed-side chars vs added-side chars occupy the same overlay cell). The renderer currently iterates top-level parts and when it hits removed+added, wraps them in a `change-pair` overlay. With flat char-level parts, the removed chars and added chars would be interleaved.

  **Revised approach**: Keep a grouping mechanism but make it explicit. Instead of optional children, use a **`group`** marker:
  ```
  [{ value: "H", type: "removed", minor: true, charLevel: true, group: "g1" },
   { value: "ello", type: "equal", charLevel: true, group: "g1" },  // removed-side equal
   { value: "h", type: "added", minor: true, charLevel: true, group: "g1" },
   { value: "ello", type: "equal", charLevel: true, group: "g1" }]  // added-side equal
  ```
  No — this is more complex than children. The real issue is that children represent **two parallel sequences** (removed-side chars and added-side chars) that need to render in the same visual space.

  **Final approach: keep children but make them mandatory-when-present and provide a utility.**

  Actually, re-reading the problem statement: "either flatten everything into a single level (each part is truly atomic), or make the tree structure explicit and provide walk/fold utilities that all consumers use."

  Go with **option B: explicit tree with walk utilities**. This is simpler because:
  - Children already work correctly in rendering
  - The problem is that metrics/layout code doesn't traverse them
  - Adding 2 utility functions is less churn than restructuring the entire part model

**Revised key decisions**:
- Keep `InlinePart.children` but add walk utilities so no consumer hand-rolls traversal
- Add `walkParts(parts, visitor)` and `flattenParts(parts)` utilities
- All consumers use these instead of direct iteration

### Subsystem 1 (revised): InlinePart walk utilities
**Files**: `src/core/inline-diff.ts` (add utilities)
**Key decisions**:
- `flattenParts(parts: InlinePart[]): InlinePart[]` — recursively flattens children into a single-level array. Each flattened child inherits the parent's `minor` flag if not set.
- `walkLeafParts(parts: InlinePart[], fn: (part: InlinePart, hasParent: boolean) => void)` — visits leaf parts only (children if present, else the part itself). This is what metrics functions need.
- `forEachTopLevelGroup(parts: InlinePart[], fn: (part: InlinePart) => void)` — iterates top-level parts (what the renderer needs — unchanged).
- Mark `children` as explicitly documented: "When present, the part's `value` is the concatenated text (for metrics on the whole chunk) and `children` contains the char-level breakdown (for rendering). Consumers MUST use walk utilities rather than iterating parts directly."

### Subsystem 2: Block Type Threading
**Files**: `src/text/parse.ts`, `src/core/block-matching.ts`
**Key decisions**:
- Add `getWrapTag(node: RootContent): string` in `parse.ts` — extracts the tag logic currently in `render.ts:wrapInTag`
- `blockToInnerText` is deleted. Instead, `createModifiedPair` calls a new `blockToInnerText`-equivalent inline: for headings, strip the `#+ ` prefix from `blockToText` output. Simpler: just use `getInnerText(node)` which serializes children without the heading wrapper.
- Actually, the cleanest fix: `computeInlineDiff` input should always be inner text. Move the "strip heading prefix" logic into `createModifiedPair` by using the existing `serializeNode` on heading children directly. Or — simplest — keep `blockToInnerText` but rename it to make intent clear and make `blockToText` call it internally:

  ```typescript
  export function blockInnerText(node: RootContent): string { /* heading children only */ }
  export function blockToText(node: RootContent): string { /* adds ## prefix for headings, delegates to blockInnerText */ }
  ```
  This way there's one source of truth for inner text, and `blockToText` composes it.

- Add `wrapTag` field to `ModifiedPair`, computed in `createModifiedPair` via `getWrapTag(left)` (left and right always have the same block type for modified pairs — they were matched).

### Subsystem 3: Metrics Fix
**Files**: `src/text/text-metrics.ts`
**Key decisions**:
- `countTotalWords` must account for children (same pattern as `countSharedWords` already does)
- Use `walkLeafParts` from subsystem 1 in both `countTotalWords` and `countSharedWords` to eliminate hand-rolled traversal
- After this change, metrics are correct for parts with children

### Subsystem 4: Renderer Consolidation
**Files**: `src/render/render.ts`
**Key decisions**:
- Extract a single `renderPartInner(part: InlinePart, minor: boolean): string` that handles the three-way branch:
  - Has children → `renderChildren(children, minor)`
  - No children → `<del>/<ins>` wrap
- `renderPartContent`, `renderChangePair`, `renderStandaloneChange` all call `renderPartInner` instead of inlining the logic
- `wrapInTag(node, innerHtml)` in `modifiedRow` replaced by `wrapWithTag(pair.wrapTag, innerHtml)` — a simple string-based wrapper that doesn't need the AST node. The existing `wrapInTag` stays for `renderBlock` (which still needs the node for equal/added/removed blocks).
- `renderSplitPair` still uses `blockToText` + `renderBlock` — unchanged.

## File Map

### New Files
None.

### Modified Files
| File | Change |
|------|--------|
| `src/core/inline-diff.ts` | Add `walkLeafParts`, `flattenParts` exports. Document children contract. |
| `src/text/parse.ts` | Refactor: `blockInnerText` as base, `blockToText` composes. Add `getWrapTag`. Delete `blockToInnerText`. |
| `src/core/block-matching.ts` | `createModifiedPair` uses `blockInnerText`, adds `wrapTag` to returned pair. Update `ModifiedPair` type. |
| `src/text/text-metrics.ts` | `countTotalWords` and `countSharedWords` use `walkLeafParts`. |
| `src/render/render.ts` | Extract `renderPartInner`. Simplify `renderPartContent`, `renderChangePair`, `renderStandaloneChange`. Add `wrapWithTag` string helper, use for modified pairs. |
| `src/core/diff.ts` | Update `ModifiedPair` type to include `wrapTag: string`. |
| `test/diff.test.ts` | Update any tests that check InlinePart structure or use blockToInnerText. |

## Verification
- `pnpm build && pnpm test` passes with no regressions
- `md-diff --debug-pair "## Old heading" "## New heading"` — heading prefix not in inline diff output, wrapTag is "h2"
- `md-diff --debug-pair "Hello World" "hello world"` — minor pair with children renders correctly, metrics count shared words from children
- Visual check: `md-diff @~1` on a commit with heading changes — headings still render with proper `<h2>` tags, no duplicate `##` in diff
