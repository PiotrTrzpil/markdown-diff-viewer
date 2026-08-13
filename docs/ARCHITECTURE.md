# Architecture

markdown-diff-viewer is both a **CLI** and a **library**. The algorithm is host-agnostic; HTML and git are adapters.

## Layer diagram

```
┌─────────────────────────────────────────────────────────────┐
│ CLI (`src/cli/`)                                            │
│   argv, watch, clipboard, terminal colors, completions      │
├─────────────────────────────────────────────────────────────┤
│ Adapters                                                    │
│   git/     Node child_process helpers                       │
│   render/  DiffPair → HTML rows                             │
│   ui/      Standalone browser shell (template, CSS, JS)     │
├─────────────────────────────────────────────────────────────┤
│ Public engine (`src/api.ts`, `src/index.ts`)                │
│   diffMarkdown(left, right, options?) → DiffResult          │
├──────────────┬──────────────────┬───────────────────────────┤
│ model/       │ layout/          │ core/                     │
│ DiffDocument │ LayoutPlan       │ pipeline, matching,       │
│ DiffStats    │ side-by-side vs  │ inline, moves, splits     │
│              │ stacked          │                           │
├──────────────┴──────────────────┴───────────────────────────┤
│ text/   parse, tokens, stopwords, protect, similarity       │
│ config/ pure constants + re-entrant DiffContext             │
└─────────────────────────────────────────────────────────────┘
```

## Package exports

| Subpath | Contents | Environment |
|---------|----------|-------------|
| `markdown-diff-viewer` | `diffMarkdown`, model, layout, types | Browser + Node |
| `markdown-diff-viewer/layout` | Layout planning only | Browser + Node |
| `markdown-diff-viewer/git` | Git content helpers | **Node only** |

## Primary contract

```ts
import { diffMarkdown, toHostPayload, changedBlocks } from "markdown-diff-viewer";

const result = diffMarkdown(oldMd, newMd, {
  matchLevel: "normal", // "strict" | "normal" | "loose"
});

// Host fields (JSON-safe)
const { schemaVersion, document, stats, layout, matchLevel } = result;
// Wire format without mdast pairs:
const payload = toHostPayload(result);
```

| Field | Purpose |
|-------|---------|
| `schemaVersion` | `1` — bump on incompatible document/stats/layout changes |
| `document` | JSON-serializable blocks (`BlockSide.markdown` + `InlinePart[]`) |
| `layout` | Side-by-side vs stacked plan (no HTML) |
| `stats` | Block/word counts |
| `pairs` | Advanced/HTML only — retains mdast; strip with `toHostPayload` |

Helpers: `isModifiedBlock`, `changedBlocks`, `modifiedBlocks`, `cloneDocument`, `isDocumentUnchanged`, `collectInlineLeaves`.

## Context & match level

```ts
withDiffOptions({ matchLevel: "loose" }, (ctx) => {
  // explicit ctx threaded into pipeline; ambient stack also active
});
```

Thresholds are passed into `findBlockMatches` / `pairUpUnmatchedBlocks` / `runPipeline` / `diffBlocks`.  
`setMatchingLevel` is a CLI-only process default shim.

## Browser purity

```bash
pnpm check:browser
# depcruise entry graph: no cli/, git/, ui/, render/, or Node core
```

Enforced in `pnpm check` via `.dependency-cruiser.browser.cjs`.

## Rules (dependency-cruiser)

- `core`, `text`, `model`, `layout` must not import `cli`, `ui`, `git`, or `render` (layout may not import render).
- `core` must not import `text/html` (use `text/protect` for algorithm-side protection).
- `api` / `index` must not import `cli`, `ui`, or `git`.

## Embedder guide (e.g. DailyDeck file browser)

1. Obtain two markdown strings (working tree + `git show HEAD:path`, or two snapshots).
2. Call `diffMarkdown(left, right, { matchLevel })`.
3. Render `layout.items` / `document.blocks` with the host UI (react-markdown, design tokens).
4. Do **not** iframe the CLI HTML shell.

## Internal vs public

| Internal | Public |
|----------|--------|
| `DiffPair` + mdast `RootContent` | `DiffDocument` / `DiffBlock` / `BlockSide` |
| `renderDiffPairs` → HTML strings | `planLayout` → layout modes |
| `src/cli/git` (re-export) | `markdown-diff-viewer/git` |
