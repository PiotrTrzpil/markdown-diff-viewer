# Project Review — 2026-06-11 (focus: bugs)

## Summary

The core diff pipeline is in good shape — well-typed, well-tested, cleanly layered. The bugs were concentrated in the CLI/UI integration layer: option plumbing that silently dropped values, a documented git shortcut that never worked, and one real algorithmic bug in move detection (backward moves duplicated content). All confirmed bugs were fixed and verified; `pnpm build`, `pnpm lint` (0 errors), and `pnpm test` (167 tests) all pass.

## Fixes Applied

### Bugs

- `src/cli/index.ts:83` — `--version` always printed "unknown": `getVersion()` resolved `../package.json` relative to `dist/cli/index.js`, i.e. `dist/package.json`, which doesn't exist. Fixed to `../../package.json`. Verified: now prints `1.0.0`.
- `src/cli/git.ts:319` — the documented `md-diff @~3..@~1` range shortcut was broken: the regex didn't allow the `@` in the second ref, so the argument fell through to compare mode with garbage ref `~3..@~1`. Fixed regex to accept `@~3..@~1` and `@~3..~1`. Verified: now expands to `HEAD~3` → `HEAD~1`.
- `src/core/move-detection.ts:83` — **backward moves duplicated content**: when text moved to an added block that appears *earlier* in the document than its source block, the added block was never marked `moved` (the order-dependent `processedMoves` check only worked for forward moves), while the source pair still merged the moved text into its diff. Result: the moved text rendered twice on the right side. Made the added-side decision order-independent (mirrors exactly the decision taken on the removed side). Added a regression test in `test/move-detection.test.ts`.
- `src/cli/output.ts:236` — `--settings` was silently ignored in all multi-file modes (`@~1`, `--staged`, `--compare`, `--pr`): `outputMultiFile` passed `undefined` instead of `opts.uiSettings` to `generateMultiFileHtml`.
- `src/cli/index.ts` + `src/ui/template.tsx` — an explicit `--match strict|loose` had no effect in the browser view: the initially-visible diff container was hardcoded to `"normal"` and the CLI flag never reached the embedded settings. The CLI level (when explicitly passed, detected via `program.getOptionValueSource`) is now embedded in `data-initial-settings` and selects the initially-visible container.
- `src/ui/template.tsx` (client script) — the ⌘⇧C "copy with context" shortcut never fired: with Shift held, `e.key` is `'C'`, but the code compared against `'c'`. Now compares case-insensitively.
- `src/ui/template.tsx` (CSS) — the merge-minor rules referenced undefined variables `--removed-bg` / `--added-bg`; the theme variables are `--md-removed-bg` / `--md-added-bg`. Fixed (note: the feature has a deeper issue, see below).
- `src/cli/output.ts` + `src/cli/stats.ts` — `split` pairs were invisible in `--preview` output and uncounted in stats (missing switch case in both). Split paragraphs now show as a `¶`-prefixed line in preview and count as modified blocks in stats.

### Performance

- `src/text/similarity.ts` — `computeDiceCached` cloned a `Map` of bigrams on every call despite never mutating it, and its doc comment falsely claimed it mutates the first argument. This runs in the O(left-blocks × right-blocks) hot loop of block matching. Removed the clone, fixed the comment.

### Cleanups (lint errors → 0)

- Removed unused imports and duplicate import lines in `src/cli/index.ts`, `src/core/block-matching.ts`; `prefer-const`, quote-style, indent autofixes.
- Removed dead functions: `renderAbsorbableEqual`, `removedRow`, `addedRow` (`src/render/render.ts`), `initBooleanSetting` (dead JS in the client script string), deprecated-and-unused `getChangedMdFiles` / `getStagedMdFiles` (`src/cli/git.ts`).
- Deduplicated the `UISettings` interface, which was defined identically in both `src/cli/index.ts` and `src/ui/template.tsx`; the single definition now lives in `template.tsx`. This also removed the `cli/index.ts ↔ cli/output.ts` circular dependency (madge confirms).

## Issues Found

### Critical

*(all fixed above; remaining items are design-level)*

- **"Merge Minor Changes" setting is dead UI.** Stop-word absorption is applied unconditionally at diff-compute time (`absorbStopWordsDeclarative` in `computeInlineDiff`, `src/core/inline-diff.ts:117`). The runtime-toggle path it was designed for — `markAbsorbableParts` (mark-only mode, `src/core/rewrite-rules.ts:386`) plus the `.absorbable-*` CSS with `.left`/`.right` side classes — is never wired in: `markAbsorbableParts` has no callers and nothing renders the side classes. So the Settings dropdown ("Off / Conservative / Aggressive") changes nothing. Deciding between (a) removing the setting, or (b) switching `computeInlineDiff` to mark-only and letting CSS do the merging needs a product call — option (b) changes diff metrics and layout decisions.

### Recommended Refactors

- **Match-level switching does nothing in multi-file mode.** `rowsByLevel` is only computed in `runSingleFile`; `runMultiFile` (`src/cli/index.ts:206`) renders a single container, so the "Matching Sensitivity" dropdown is a silent no-op for git/staged/compare/PR views. Either compute all three levels per file (3× diff cost) or hide/disable the dropdown when no level variants exist.
- **Redundant diff computation in single-file mode.** `runSingleFile` computes the diff once for `rows`/`pairs`, then `getRowsAtAllLevels` recomputes all three levels — the active level is diffed twice (4 pipeline runs total per generate, also on every watch reload). Reuse `rowsByLevel[currentLevel]` for `rows`.
- **`src/ui/template.tsx` is 1622 lines** (lint max-lines warning): a ~700-line CSS string and a ~680-line client-script string embedded in the component file. Split into `styles.ts` and `client-script.ts`; this would clear 3 of the 5 remaining lint warnings.
- **Type-only circular deps** `core/inline-diff.ts ↔ core/boundary-optimize.ts` and `↔ core/rewrite-rules.ts` (madge): `InlinePart` lives in `inline-diff.ts` while the helpers it imports also import the type back. Move `InlinePart` into its own module (e.g. `core/inline-part.ts`).
- `main()` in `src/cli/index.ts` has complexity 28 (limit 25) — the mode dispatch (pr/staged/compare/git/shortcut/file) could move into a small dispatch table or per-mode handlers.

### Minor

- `knip` reports unused exports that look like intentional public API: the `DiffPair` type guards (`isEqualPair` etc.), `flattenParts`, `markAbsorbableParts`, `sharedWordRatio`. Kept; consider a knip `ignoreExports` entry or trimming once the API surface is settled.
- `findBlockMatches` (`src/core/block-matching.ts:169`): when a strong shared prefix passes the gate but dice is far below threshold, `sim = dice + prefix/maxWords` can still land below `THRESHOLD` for long paragraphs — the "strong prefix is sufficient" comment isn't fully honored. Harmless (it only means a missed pairing) but worth revisiting if long rewritten paragraphs fail to pair.
- `longestCommonRun` uses `Uint16Array` for run lengths — caps at 65 535 matching words per block, fine in practice.
- `readStdin` (`src/cli/index.ts`) has no `error` handler on stdin; a stream error would hang the promise.

## Observations

- The `DiffPair` discriminated union with factory functions and type guards makes illegal states unrepresentable; the pipeline stages (`src/core/pipeline.ts`) are explicit and easy to follow.
- The declarative rewrite-rule system (`src/core/rewrite-rules.ts`) is a genuinely nice design — rules are named, ordered, independently testable, and `test/rewrite-rules.test.ts` covers them.
- Core diff logic has solid test coverage (167 tests across 8 files, including regression suites); the CLI layer is the least-tested area and is where most bugs were found — a `test/cli` suite around `expandGitShortcut`, settings plumbing, and output modes would have caught several of these.
