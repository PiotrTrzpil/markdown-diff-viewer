import type { RenderedRow } from "../render.js";

export function generateHtml(
  rows: RenderedRow[],
  leftTitle: string,
  rightTitle: string
): string {
  const rowsHtml = rows
    .map(
      (row) => `
      <div class="diff-row ${row.status}">
        <div class="diff-cell left">${row.leftHtml}</div>
        <div class="diff-cell right">${row.rightHtml}</div>
      </div>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Markdown Diff: ${escapeAttr(leftTitle)} ↔ ${escapeAttr(rightTitle)}</title>
<style>
${CSS}
</style>
</head>
<body>
  <header>
    <div class="header-cell left-header">${escapeHtmlText(leftTitle)}</div>
    <div class="header-cell right-header">${escapeHtmlText(rightTitle)}</div>
  </header>
  <div class="diff-container" id="container">
    <div class="diff-pane left-pane" id="leftPane">
      ${rows.map((r) => `<div class="diff-block ${r.status}">${r.leftHtml}</div>`).join("\n")}
    </div>
    <div class="diff-pane right-pane" id="rightPane">
      ${rows.map((r) => `<div class="diff-block ${r.status}">${r.rightHtml}</div>`).join("\n")}
    </div>
  </div>
  <div class="stats-bar" id="statsBar"></div>
  <script>
${SCRIPT}
  </script>
</body>
</html>`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeHtmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #1e1e2e;
    color: #cdd6f4;
    display: flex;
    flex-direction: column;
    height: 100vh;
  }

  header {
    display: flex;
    border-bottom: 2px solid #45475a;
    background: #181825;
    flex-shrink: 0;
  }

  .header-cell {
    flex: 1;
    padding: 10px 20px;
    font-weight: 600;
    font-size: 13px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: #bac2de;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .left-header { border-right: 1px solid #45475a; }

  .diff-container {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .diff-pane {
    flex: 1;
    overflow-y: auto;
    padding: 16px 24px;
    line-height: 1.7;
  }

  .left-pane {
    border-right: 1px solid #45475a;
  }

  /* Typography for rendered markdown */
  .diff-pane h1 { font-size: 1.8em; margin: 0.6em 0 0.3em; color: #cba6f7; border-bottom: 1px solid #45475a; padding-bottom: 0.2em; }
  .diff-pane h2 { font-size: 1.5em; margin: 0.5em 0 0.3em; color: #89b4fa; }
  .diff-pane h3 { font-size: 1.25em; margin: 0.4em 0 0.2em; color: #74c7ec; }
  .diff-pane h4 { font-size: 1.1em; margin: 0.3em 0 0.2em; color: #94e2d5; }
  .diff-pane h5, .diff-pane h6 { font-size: 1em; margin: 0.2em 0; color: #a6e3a1; }
  .diff-pane p { margin: 0.5em 0; }
  .diff-pane ul, .diff-pane ol { margin: 0.5em 0 0.5em 1.5em; }
  .diff-pane li { margin: 0.2em 0; }
  .diff-pane blockquote { border-left: 3px solid #585b70; padding-left: 12px; color: #a6adc8; margin: 0.5em 0; }
  .diff-pane pre { background: #11111b; padding: 12px; border-radius: 6px; overflow-x: auto; margin: 0.5em 0; }
  .diff-pane code { font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 0.9em; }
  .diff-pane :not(pre) > code { background: #313244; padding: 2px 5px; border-radius: 3px; }
  .diff-pane a { color: #89b4fa; text-decoration: underline; }
  .diff-pane strong { color: #f5e0dc; }
  .diff-pane em { color: #f2cdcd; }
  .diff-pane table { border-collapse: collapse; margin: 0.5em 0; width: 100%; }
  .diff-pane th, .diff-pane td { border: 1px solid #45475a; padding: 6px 10px; text-align: left; }
  .diff-pane th { background: #313244; }
  .diff-pane hr { border: none; border-top: 1px solid #45475a; margin: 1em 0; }
  .diff-pane img { max-width: 100%; }

  /* Diff block styles */
  .diff-block {
    padding: 2px 0;
    border-radius: 4px;
    margin: 1px 0;
  }

  .diff-block.equal { }

  .diff-block.added {
    background: rgba(166, 227, 161, 0.1);
    border-left: 3px solid #a6e3a1;
    padding-left: 8px;
  }

  .diff-block.removed {
    background: rgba(243, 139, 168, 0.1);
    border-left: 3px solid #f38ba8;
    padding-left: 8px;
  }

  .diff-block.modified {
    background: rgba(250, 179, 135, 0.08);
    border-left: 3px solid #fab387;
    padding-left: 8px;
  }

  /* Spacer for alignment */
  .spacer {
    min-height: 2em;
    background: rgba(88, 91, 112, 0.1);
    border-radius: 4px;
    margin: 2px 0;
  }

  /* Inline diff highlights */
  del {
    background: rgba(243, 139, 168, 0.3);
    color: #f38ba8;
    text-decoration: line-through;
    text-decoration-color: rgba(243, 139, 168, 0.5);
    border-radius: 2px;
    padding: 0 2px;
  }

  ins {
    background: rgba(166, 227, 161, 0.3);
    color: #a6e3a1;
    text-decoration: none;
    border-radius: 2px;
    padding: 0 2px;
  }

  .added-block { }
  .removed-block { }
  .modified-block { }

  /* Stats bar */
  .stats-bar {
    display: flex;
    gap: 16px;
    padding: 6px 20px;
    background: #181825;
    border-top: 1px solid #45475a;
    font-size: 12px;
    color: #6c7086;
    flex-shrink: 0;
  }

  .stat-item { display: flex; align-items: center; gap: 4px; }
  .stat-dot { width: 8px; height: 8px; border-radius: 50%; }
  .stat-dot.equal { background: #6c7086; }
  .stat-dot.added { background: #a6e3a1; }
  .stat-dot.removed { background: #f38ba8; }
  .stat-dot.modified { background: #fab387; }

  /* Scrollbar styling */
  .diff-pane::-webkit-scrollbar { width: 8px; }
  .diff-pane::-webkit-scrollbar-track { background: #1e1e2e; }
  .diff-pane::-webkit-scrollbar-thumb { background: #45475a; border-radius: 4px; }
  .diff-pane::-webkit-scrollbar-thumb:hover { background: #585b70; }
`;

const SCRIPT = `
(function() {
  // Scroll sync
  const left = document.getElementById('leftPane');
  const right = document.getElementById('rightPane');
  let syncing = false;

  function syncScroll(source, target) {
    if (syncing) return;
    syncing = true;
    const ratio = source.scrollTop / (source.scrollHeight - source.clientHeight || 1);
    target.scrollTop = ratio * (target.scrollHeight - target.clientHeight);
    syncing = false;
  }

  left.addEventListener('scroll', () => syncScroll(left, right));
  right.addEventListener('scroll', () => syncScroll(right, left));

  // Block-level alignment: match heights of corresponding blocks
  const leftBlocks = left.querySelectorAll('.diff-block');
  const rightBlocks = right.querySelectorAll('.diff-block');
  const count = Math.min(leftBlocks.length, rightBlocks.length);

  for (let i = 0; i < count; i++) {
    const lh = leftBlocks[i].getBoundingClientRect().height;
    const rh = rightBlocks[i].getBoundingClientRect().height;
    const maxH = Math.max(lh, rh);
    leftBlocks[i].style.minHeight = maxH + 'px';
    rightBlocks[i].style.minHeight = maxH + 'px';
  }

  // Stats
  const stats = { equal: 0, added: 0, removed: 0, modified: 0 };
  leftBlocks.forEach(b => {
    if (b.classList.contains('equal')) stats.equal++;
    else if (b.classList.contains('added')) stats.added++;
    else if (b.classList.contains('removed')) stats.removed++;
    else if (b.classList.contains('modified')) stats.modified++;
  });

  const bar = document.getElementById('statsBar');
  bar.innerHTML = [
    ['equal', 'Unchanged'],
    ['modified', 'Modified'],
    ['added', 'Added'],
    ['removed', 'Removed'],
  ].map(([cls, label]) =>
    '<span class="stat-item"><span class="stat-dot ' + cls + '"></span>' + stats[cls] + ' ' + label + '</span>'
  ).join('');
})();
`;
