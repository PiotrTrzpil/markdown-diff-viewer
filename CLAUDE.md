# Project Instructions for Claude

## Git Workflow

**NEVER auto-push to remote.** Always wait for explicit user confirmation before running `git push`.

When asked to "commit and push", commit first, then ask before pushing.

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
| `-m, --match <level>` | Matching sensitivity: `strict`, `normal`, `loose` |
| `--settings <file>` | Load UI settings from JSON file |

### Stdin

```bash
curl -s https://example.com/doc.md | md-diff - local.md
```

## Development Practices

**TDD is critical.** Always write a failing test first, then fix the code. This is non-negotiable for bug fixes — the regression test proves the bug exists and proves the fix works.

**ALWAYS verify visually in the browser.** After ANY rendering change, generate HTML with a real diff (`md-diff @HEAD` on a real repo like `culturecraft-book-gen`), open it in the browser, and visually confirm text is not overlapping, colors are correct, word boundaries are right, and bold/italic renders properly. Use playwright to automate this check — take screenshots, inspect DOM spans, compare char-by-char colors against the embedded DiffData. Never trust that "tests pass" means "it looks right." The browser is the ground truth.

Other best practices:
- **Read before writing.** Read all relevant source files before making changes. Understand the pipeline stages and how data flows between them.
- **Minimal changes.** Fix the bug where it belongs. Don't refactor surrounding code or add unrelated improvements.
- **Diagnose before fixing.** Run the pipeline on a repro case and inspect the actual output (pair statuses, metrics, match decisions) before writing any fix.
- **Run the full test suite** (`pnpm build && pnpm test`) after every change. Don't rely on running just the new test.
- **Visual verification is mandatory** for rendering changes. Use `pnpm test:e2e` and also open the output in a real browser.

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

Combine with `--match <strict|normal|loose>` to test different matching levels.

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
