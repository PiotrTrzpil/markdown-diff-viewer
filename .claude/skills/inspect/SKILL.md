---
name: inspect
description: Connect to the md-diff browser view via playwright-cli for inspection and interaction. Requires md-diff to be running with --inspect flag.
---

Connect to the md-diff Chrome instance via remote debugging and interact with the page.

## Steps

1. **ALWAYS use `./browse.sh`** to run playwright-cli commands. Never call `playwright-cli` directly or set `PLAYWRIGHT_MCP_CDP_ENDPOINT` manually. `browse.sh` handles CDP endpoint configuration automatically and attaches to the existing Chrome page.
   ```bash
   ./browse.sh snapshot             # take a snapshot (default command)
   ./browse.sh tab-list             # list tabs
   ./browse.sh click e5             # click element by ref
   ./browse.sh hover e5             # scroll element into view
   ./browse.sh screenshot           # full page screenshot
   ./browse.sh screenshot e5        # element-level screenshot (zoomed in)
   ./browse.sh scroll-to e5         # scroll to element + snapshot
   ./browse.sh block-html e5        # get outerHTML of element
   ./browse.sh selection            # read user's text selection
   ./browse.sh pick                 # let user pick an element (blue highlight picker)
   ./browse.sh inspect-el           # capture element user right-clicks > Inspects
   ./browse.sh eval "document.title"              # evaluate JS expression
   ./browse.sh eval "el => el.className" e5       # evaluate on specific element
   ```

2. **First run:** If the daemon has stale state from a previous session, run `playwright-cli close-all` first, then `./browse.sh snapshot` to get a fresh connection.

3. **NEVER read the entire snapshot YAML file** — it can be very large. Instead, use Grep to search for specific text content, element refs, or class names within the YAML file.

## Debugging workflow

To inspect a specific diff block:
1. `./browse.sh snapshot` — get element refs
2. Find the ref near the problem area (search the YAML for text content)
3. `./browse.sh screenshot <ref>` — zoomed-in screenshot of just that element
4. `./browse.sh block-diff <ref>` — structured diff parts (type, value, absorb, minor flags)
5. `./browse.sh block-html <ref>` — raw HTML with CSS classes (for CSS debugging)

**Always prefer `screenshot <ref>` over `screenshot`** — full-page screenshots are too small to read text. Element screenshots zoom into exactly the content you need. Use `resize 1920 1080` first if you need a wider full-page view.

## eval syntax

Two modes depending on whether a ref is passed:

**Page-level** (no ref) — single expression returning a value:
```bash
./browse.sh eval "document.title"
./browse.sh eval "document.querySelectorAll('.diff-part').length"
```

**Element-level** (with ref) — arrow function receiving the element:
```bash
./browse.sh eval "el => el.outerHTML" e5
./browse.sh eval "el => el.className" e5
./browse.sh eval "el => el.children.length" e5
```

**Gotchas:**
- Page-level: **no arrow functions** (`=>`) anywhere in the expression — playwright interprets them as function definitions and breaks. Use `function()` for callbacks:
  ```bash
  # WRONG — breaks with "result is not a function"
  ./browse.sh eval "Array.from(els).map(el => el.className)"
  # RIGHT — use function() and wrap in JSON.stringify
  ./browse.sh eval "JSON.stringify(Array.from(document.querySelectorAll('.x')).map(function(el){return el.className}))"
  ```
- No `var`/`let`/`const`, no multi-statement blocks, no `forEach`
- Use `run-code` for anything complex:
  ```bash
  ./browse.sh run-code "const els = await page.locator('.diff-block').all(); console.log(els.length)"
  ```

## Notes

- The user must first launch md-diff with `--inspect` to open Chrome with remote debugging.
- If connection fails or lands on `about:blank`, run `playwright-cli close-all` and retry.
- The left header shows the project root path (`data-path` attribute) for identification.
