# Project Instructions for Claude

## Git Workflow

**NEVER auto-push to remote.** Always wait for explicit user confirmation before running `git push`.

When asked to "commit and push", commit first, then ask before pushing.

## Library (preferred for embedders)

```ts
import { diffMarkdown, toHostPayload, changedBlocks } from "markdown-diff-viewer";

const result = diffMarkdown(oldMd, newMd, { matchLevel: "normal" });
// result.document / layout / stats / schemaVersion
// toHostPayload(result) — JSON without internal mdast pairs
```

See `docs/ARCHITECTURE.md`. Subpaths: `markdown-diff-viewer/layout`, `markdown-diff-viewer/git` (Node only).
`pnpm check` includes browser-entry purity (`check:browser`).

DailyDeck embeds this via `file:` and copies `dist/` (not a symlink). After `just rebuild` here, from DailyDeck run `just refresh-md-diff`. Do not `pnpm update markdown-diff-viewer` in DailyDeck — that rewrites the whole lockfile.

## Usage

### Basic — compare two files

```bash
md-diff old.md new.md
```

### Git modes

```bash
md-diff @~1                    # HEAD~1 vs HEAD (all changed .md files)
md-diff @~3..@~1               # Compare commit range
md-diff @main                  # Working dir vs main branch
md-diff @main README.md        # Single file vs branch
md-diff --staged               # Staged changes vs HEAD
md-diff --staged file.md       # Single staged file
md-diff --git v1.0 v2.0        # Between two refs
md-diff --compare feature      # Working dir vs branch
md-diff --pr 42                # PR diff (requires gh CLI)
```

No arguments launches interactive mode (prompts for what to compare).

### Output options

| Flag | Effect |
|------|--------|
| `-p, --preview` | Terminal preview (no browser) |
| `-j, --json` | JSON output |
| `-c, --copy` | Copy HTML to clipboard |
| `-o, --out <file>` | Write HTML to file (`-` for stdout) |
| `--no-open` | Generate HTML without opening browser |
| `-w, --watch` | Regenerate on file changes |
| `-t, --theme <name>` | `dark` (default) or `solar` |
| `-m, --match <level>` | Matching sensitivity: `strict`, `normal`, `loose`, `inline` |
| `--settings <file>` | Load UI settings from JSON file |

### Stdin

```bash
curl -s https://example.com/doc.md | md-diff - local.md
```

## Debugging

### `--debug-pair` — Inline diff diagnostics

Test diff hypotheses without rebuilding the browser view:

```bash
# Two inline strings
md-diff --debug-pair "old text" "new text"

# Two markdown files (runs full pipeline, shows all pairs)
md-diff --debug-pair old.md new.md

# Mix of file and inline text
md-diff --debug-pair old.md "new inline text"
```

Arguments are auto-detected: existing file paths are read as files, otherwise treated as inline text. For multi-block input it runs the full diff pipeline and prints per-pair diagnostics (inline parts with flags, metrics, layout decision with threshold reasoning) plus a summary.

Combine with `--match <strict|normal|loose|inline>` to test different matching levels.

### Corpus checker

`scripts/check-corpus.mjs` diffs real markdown pairs and inspects the document for pairing/inline quality bugs (mashed unlike paragraphs, HTML-comment/cite zips, reconstructed sides that drop source text, leaked protect markers). Needs a built `dist/`.

```bash
just check-corpus
just check-corpus --git ~/Code/culturecraft-book-gen HEAD~1 src/guilds/chapters
just check-corpus --git ~/Code/culturecraft-book-gen --merge-base main --to-worktree src/guilds/chapters
just check-corpus --against /path/to/old/dist/index.js --git ~/Code/culturecraft-book-gen HEAD~1 src/guilds/chapters
```

No args runs `test/fixtures`. Exit 1 if the current engine has quality findings. `--against` also prints pairing and reconstructed-side diffs versus another build; those diffs do not fail the process.

### `--verbose` — Timing

Shows per-file timing breakdown (diff, render, output stages).

### `--debug` — Internal algorithm logging

Granular logging from the diff pipeline: anchor finding, block matching, token processing. Controlled via `__MD_DIFF_DEBUG__` global; logging calls use `debug()` from `src/debug.ts`.

### `--inspect` — Browser debugging

Opens the output in Chrome with remote debugging on port 9222.

Use the **`/inspect` skill** to connect to the running view and interact with it — take snapshots, click elements, extract HTML, and verify rendered output. The skill uses Playwright via `browse.sh`.

### `browse.sh` — Playwright helper

Connects to Chrome's remote debugging port (requires `--inspect` to be running):

```bash
./browse.sh                    # Accessibility snapshot of the page
./browse.sh pick               # Click an element in Chrome to get its HTML
./browse.sh inspect-el         # Right-click > Inspect to capture element
./browse.sh selection          # Get highlighted text
./browse.sh screenshot         # Full page screenshot
./browse.sh screenshot <ref>   # Element screenshot
./browse.sh hover <ref>        # Scroll element into view
./browse.sh scroll-to <ref>    # Scroll without hover side effects
./browse.sh block-html <ref>   # Get outerHTML of element
./browse.sh 9333 <command>     # Custom port
```
