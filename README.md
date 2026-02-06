# markdown-diff-viewer

Side-by-side rich diff viewer for Markdown files. Compare documents with intelligent block-level and character-level diffing, rendered in an interactive browser UI.

## Features

- **Smart Block Matching** - Uses similarity-based LCS algorithm to match paragraphs, even when they've been moved or partially edited
- **Character-Level Diffs** - Highlights exact changes within words (e.g., "Oxytocin" → "oxytocin" shows only the case change)
- **Minor Change Detection** - Subtle styling for case-only and punctuation-only changes
- **Stop-Word Absorption** - Prevents noise from isolated articles ("the", "a", "of") appearing as changes
- **Git Integration** - Compare files between any git refs (commits, branches, tags)
- **Multi-File Diffs** - Diff all changed markdown files between git refs at once
- **Two Themes** - Dark mode and Solar (warm sepia) themes with toggle
- **Synchronized Scrolling** - Left and right panes scroll together
- **Keyboard Navigation** - Alt+Up/Down to switch between files in multi-file mode

## Installation

```bash
# Clone and install
git clone https://github.com/user/markdown-diff-viewer.git
cd markdown-diff-viewer
pnpm install

# Build
pnpm build

# Link globally (optional)
pnpm link --global
```

## Usage

### Compare Two Files

```bash
md-diff before.md after.md
```

Opens the diff in your default browser.

### Git Mode - Single File

Compare a file between two git refs (commits, branches, tags):

```bash
# Compare between commits
md-diff --git HEAD~1 HEAD README.md

# Compare between branches
md-diff --git main feature-branch docs/api.md

# Compare with a specific commit
md-diff --git abc123 def456 notes.md
```

### Git Mode - All Changed Files

Omit the filename to diff all changed `.md` files between refs:

```bash
# All markdown changes in the last commit
md-diff --git HEAD~1 HEAD

# All markdown changes between branches
md-diff --git main develop
```

This creates a multi-file viewer with a dropdown to switch between files.

### Output Options

```bash
# Write to a specific file instead of temp
md-diff before.md after.md --out diff.html

# Write to stdout (for piping)
md-diff before.md after.md --out -

# Don't auto-open browser
md-diff before.md after.md --no-open
```

### Theme Selection

```bash
# Use solar (warm sepia) theme
md-diff before.md after.md --theme solar

# Use dark theme (default)
md-diff before.md after.md --theme dark
```

The theme can also be toggled in the viewer using the button in the header.

## How It Works

### Block-Level Diffing

1. Parses both Markdown files into AST (Abstract Syntax Tree) using [remark](https://github.com/remarkjs/remark)
2. Extracts top-level blocks (paragraphs, headings, code blocks, lists, etc.)
3. Computes similarity between all block pairs using Dice coefficient on character bigrams
4. Finds optimal block alignment using LCS (Longest Common Subsequence) weighted by similarity
5. Blocks with >40% similarity are matched as "modified", others as added/removed

### Inline Diffing

For modified blocks:

1. Tokenizes text into words with preserved whitespace
2. Finds contiguous matching runs of 3+ words to anchor the diff
3. Refines remaining segments with character-level diff
4. Detects minor changes (case-only, punctuation-only) for subtle highlighting
5. Absorbs isolated stop words to reduce noise

### Rendering

- **Side-by-side**: Blocks with shared content shown in two columns
- **Stacked**: Completely different blocks shown as removed block(s), then added block(s)
- Uses semantic HTML (`<ins>`, `<del>`) with CSS styling
- Supports full GitHub Flavored Markdown (tables, task lists, strikethrough, etc.)

## Display Modes

| Content Type | Display |
|--------------|---------|
| Identical blocks | Side-by-side, no highlighting |
| Modified with shared text | Side-by-side with inline highlighting |
| Completely different | Stacked (removed first, then added) |
| Removed only | Left side only, right side empty |
| Added only | Right side only, left side empty |

## Examples

### Minor Changes

When comparing:
```markdown
The "Sacred Canopy" protects us.
```
to:
```markdown
The sacred canopy protects us.
```

The viewer shows subtle underlines on the changed characters (`"S` → `s`, `C` → `c`, removed quotes) rather than highlighting entire words.

### Structural Changes

When a paragraph is completely rewritten, the viewer stacks the old version (red) above the new version (green) instead of showing confusing side-by-side comparisons.

## Development

```bash
# Install dependencies
pnpm install

# Build TypeScript
pnpm build

# Watch mode
pnpm dev

# Run tests
pnpm test

# Run CLI directly
node dist/cli.js before.md after.md
```

## Project Structure

```
src/
├── cli.ts          # Command-line interface
├── parse.ts        # Markdown parsing and block extraction
├── diff.ts         # Block and inline diffing algorithms
├── render.ts       # HTML rendering logic
├── ui/
│   ├── template.tsx  # HTML page template (JSX)
│   └── themes.ts     # Color themes
└── *.test.ts       # Test files
```

## Dependencies

- [unified](https://github.com/unifiedjs/unified) - Markdown processing pipeline
- [remark](https://github.com/remarkjs/remark) - Markdown parser
- [remark-gfm](https://github.com/remarkjs/remark-gfm) - GitHub Flavored Markdown
- [diff](https://github.com/kpdecker/jsdiff) - Character-level diffing
- [@kitajs/html](https://github.com/kitajs/html) - JSX to HTML (no React)
- [open](https://github.com/sindresorhus/open) - Open URLs in browser

## License

MIT
