#!/usr/bin/env bash
set -euo pipefail

# Connect playwright-cli to Chrome's remote debugging port.
# Usage: ./browse.sh                    (snapshot, default port 9222)
#        ./browse.sh pick               (activate element picker, click to select)
#        ./browse.sh inspect-el         (right-click > Inspect to capture element)
#        ./browse.sh selection           (get highlighted text)
#        ./browse.sh screenshot [ref]   (full page or element screenshot)
#        ./browse.sh hover <ref>        (scroll element into view)
#        ./browse.sh scroll-to <ref>    (scroll element into view, no hover side effects)
#        ./browse.sh block-html <ref>   (get outerHTML of element for debugging)
#        ./browse.sh goto-file <name>  (click file in sidebar by partial name match)
#        ./browse.sh find-text <text>  (scroll to diff block containing text)
#        ./browse.sh <command> [args]   (run any playwright-cli command)
#        ./browse.sh 9333 <command>     (custom port)
#
# First run md-diff with --inspect to launch Chrome with debugging enabled:
#   md-diff left.md right.md --inspect

PORT=9222
# If first arg is a number, treat it as port
if [[ "${1:-}" =~ ^[0-9]+$ ]]; then
  PORT="$1"
  shift
fi

export PLAYWRIGHT_MCP_CDP_ENDPOINT="http://localhost:${PORT}"
# playwright-cli daemon defaults to isolated=true, which creates a new browser
# context instead of using Chrome's existing one. Override to attach to the
# existing page (the md-diff tab).
export PLAYWRIGHT_MCP_ISOLATED=false
# Allow file:// URLs since md-diff serves from a temp file.
export PLAYWRIGHT_MCP_ALLOW_UNRESTRICTED_FILE_ACCESS=true

CMD="${1:-snapshot}"

# Ensure daemon is running and connected to Chrome
if ! playwright-cli list 2>/dev/null | grep -q 'status: open'; then
  playwright-cli open >/dev/null 2>&1
fi

case "$CMD" in
  pick)
    playwright-cli run-code "async page => {
      const client = await page.context().newCDPSession(page);
      await client.send('DOM.enable');
      await client.send('Overlay.enable');
      await client.send('Overlay.setInspectMode', {
        mode: 'searchForNode',
        highlightConfig: { showInfo: true, contentColor: { r: 111, g: 168, b: 220, a: 0.66 } }
      });
      console.log('Pick an element in the browser...');
      const outerHTML = await new Promise(resolve => {
        client.on('Overlay.inspectNodeRequested', async ({ backendNodeId }) => {
          await client.send('Overlay.setInspectMode', { mode: 'none', highlightConfig: {} });
          const { outerHTML } = await client.send('DOM.getOuterHTML', { backendNodeId });
          resolve(outerHTML);
        });
      });
      console.log(outerHTML);
    }"
    ;;
  inspect-el)
    echo "Right-click an element in Chrome and choose 'Inspect'..."
    playwright-cli run-code "async page => {
      const client = await page.context().newCDPSession(page);
      await client.send('DOM.enable');
      const outerHTML = await new Promise(resolve => {
        client.on('DOM.inspectNodeRequested', async ({ backendNodeId }) => {
          const { outerHTML } = await client.send('DOM.getOuterHTML', { backendNodeId });
          resolve(outerHTML);
        });
      });
      console.log(outerHTML);
    }"
    ;;
  selection)
    playwright-cli eval "window.getSelection().toString()"
    ;;
  scroll-to)
    # Scroll element into view without clicking. Uses hover (which scrolls) then snapshot.
    REF="${2:?Usage: browse.sh scroll-to <ref>}"
    playwright-cli hover "$REF"
    playwright-cli snapshot
    ;;
  block-html)
    # Get outerHTML of an element by its snapshot ref
    REF="${2:?Usage: browse.sh block-html <ref>}"
    playwright-cli eval "el => el.outerHTML" "$REF"
    ;;
  goto-file)
    # Click a file in the sidebar by partial name match
    PATTERN="${2:?Usage: browse.sh goto-file <partial-name>}"
    playwright-cli run-code "async () => { const items = await page.locator('.file-list li').all(); for (const item of items) { const t = await item.textContent(); if (t && t.includes('${PATTERN}')) { await item.click(); break; } } }"
    playwright-cli snapshot
    ;;
  find-text)
    # Scroll to the first diff block containing the given text
    TEXT="${2:?Usage: browse.sh find-text <text>}"
    playwright-cli run-code "async () => { const blocks = await page.locator('.diff-block').all(); for (const block of blocks) { const t = await block.textContent(); if (t && t.includes('${TEXT}')) { await block.scrollIntoViewIfNeeded(); break; } } }"
    playwright-cli snapshot
    ;;
  block-diff)
    # Extract structured diff parts from a rendered diff block
    REF="${2:?Usage: browse.sh block-diff <ref>}"
    playwright-cli eval 'el => {
      const parts = [];
      for (const node of el.querySelectorAll(".diff-part, .change-pair")) {
        if (node.classList.contains("change-pair")) {
          const rm = node.querySelector(".diff-removed");
          const ad = node.querySelector(".diff-added");
          const rmVis = rm && rm.classList.contains("visible");
          const adVis = ad && ad.classList.contains("visible");
          const entry = { type: "change" };
          if (rm) entry.removed = rm.textContent;
          if (ad) entry.added = ad.textContent;
          if (node.classList.contains("standalone")) entry.standalone = true;
          if (rmVis && !adVis) entry.side = "left-only";
          else if (adVis && !rmVis) entry.side = "right-only";
          parts.push(entry);
        } else {
          const entry = { type: "equal", value: node.textContent };
          if (node.classList.contains("absorbable-stopword")) entry.absorb = "stopword";
          else if (node.classList.contains("absorbable-single")) entry.absorb = "single";
          if (node.querySelector(".char-removed")) entry.minor = true;
          parts.push(entry);
        }
      }
      return JSON.stringify(parts, null, 2);
    }' "$REF"
    ;;
  *)
    shift || true
    exec playwright-cli "$CMD" "$@"
    ;;
esac
