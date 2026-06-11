/**
 * Client-side script for the diff viewer page (settings, file navigation,
 * scroll sync, block alignment, minimap, copy-with-context).
 */
export const SCRIPT = `
(function() {
  const html = document.documentElement;

  // ── Settings Panel ──────────────────────────────────────────────
  const settingsPanel = document.getElementById('settingsPanel');
  const settingsOverlay = document.getElementById('settingsOverlay');
  const settingsToggle = document.getElementById('settingsToggle');
  const settingsClose = document.getElementById('settingsClose');

  function openSettings() {
    settingsPanel.classList.add('open');
    settingsOverlay.classList.add('open');
  }

  function closeSettings() {
    settingsPanel.classList.remove('open');
    settingsOverlay.classList.remove('open');
  }

  settingsToggle.addEventListener('click', openSettings);
  settingsClose.addEventListener('click', closeSettings);
  settingsOverlay.addEventListener('click', closeSettings);

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && settingsPanel.classList.contains('open')) {
      closeSettings();
    }
  });

  // ── Storage Keys ────────────────────────────────────────────────
  const STORAGE = {
    theme: 'md-diff-theme',
    fontSize: 'md-diff-font-size',
    minimap: 'md-diff-show-minimap',
    gapAlign: 'md-diff-gap-align',
    inlineHighlight: 'md-diff-show-minor',
    mergeMinor: 'md-diff-merge-minor',
    matchLevel: 'md-diff-match-level',
    compact: 'md-diff-compact',
    sidebarWidth: 'md-diff-sidebar-width',
  };

  const DEFAULT_FONT_SIZE = 14;

  // Load initial settings from CLI (if provided)
  const initialSettingsAttr = html.getAttribute('data-initial-settings');
  const initialSettings = initialSettingsAttr ? JSON.parse(initialSettingsAttr) : {};

  // Helper to get initial value (CLI settings override localStorage)
  function getInitial(key, storageKey, defaultVal) {
    if (key in initialSettings) return initialSettings[key];
    const saved = localStorage.getItem(storageKey);
    return saved !== null ? saved : defaultVal;
  }

  // ── Theme Setting ───────────────────────────────────────────────
  const themeToggle = document.getElementById('themeToggle');
  const themeSelect = document.getElementById('themeSelect');

  function setTheme(theme) {
    html.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE.theme, theme);
    themeSelect.value = theme;
  }

  const initialTheme = getInitial('theme', STORAGE.theme, html.getAttribute('data-theme'));
  setTheme(initialTheme);

  themeToggle.addEventListener('click', () => {
    const next = html.getAttribute('data-theme') === 'dark' ? 'solar' : 'dark';
    setTheme(next);
  });

  themeSelect.addEventListener('change', () => setTheme(themeSelect.value));

  // ── Merge Minor Setting ────────────────────────────────────────
  const mergeMinorSelect = document.getElementById('mergeMinorSelect');

  function setMergeMinor(level) {
    html.setAttribute('data-merge-minor', level);
    localStorage.setItem(STORAGE.mergeMinor, level);
    mergeMinorSelect.value = level;
  }

  const initialMergeMinor = getInitial('mergeMinor', STORAGE.mergeMinor, 'conservative');
  setMergeMinor(initialMergeMinor);

  mergeMinorSelect.addEventListener('change', () => setMergeMinor(mergeMinorSelect.value));

  // ── Matching Level Setting ─────────────────────────────────────
  const matchLevelSelect = document.getElementById('matchLevelSelect');

  function setMatchLevel(level) {
    html.setAttribute('data-match-level', level);
    localStorage.setItem(STORAGE.matchLevel, level);
    matchLevelSelect.value = level;

    // Switch visible diff containers for all files
    document.querySelectorAll('.file-diff').forEach(fileDiff => {
      fileDiff.querySelectorAll('.diff-container[data-match-level]').forEach(container => {
        const containerLevel = container.getAttribute('data-match-level');
        container.style.display = containerLevel === level ? '' : 'none';
      });
    });

    // Defer alignment to next frame to ensure layout is complete after display change
    requestAnimationFrame(() => {
      document.querySelectorAll('.file-diff').forEach(fileDiff => {
        const visibleContainer = fileDiff.querySelector('.diff-container:not([style*="display: none"])');
        if (visibleContainer) {
          const lp = visibleContainer.querySelector('.left-pane');
          const rp = visibleContainer.querySelector('.right-pane');
          if (lp && rp) alignBlocks(lp, rp);
        }
      });
    });
  }

  const initialMatchLevel = getInitial('matchLevel', STORAGE.matchLevel, 'normal');
  setMatchLevel(initialMatchLevel);

  matchLevelSelect.addEventListener('change', () => setMatchLevel(matchLevelSelect.value));

  // ── Font Size Setting ───────────────────────────────────────────
  const fontSizeRange = document.getElementById('fontSizeRange');
  const fontSizeValue = document.getElementById('fontSizeValue');

  function setFontSize(size) {
    document.body.style.fontSize = size + 'px';
    fontSizeRange.value = size;
    fontSizeValue.textContent = size + 'px';
    localStorage.setItem(STORAGE.fontSize, size);
  }

  const initialFontSize = getInitial('fontSize', STORAGE.fontSize, DEFAULT_FONT_SIZE);
  setFontSize(typeof initialFontSize === 'string' ? parseInt(initialFontSize, 10) : initialFontSize);

  fontSizeRange.addEventListener('input', () => setFontSize(parseInt(fontSizeRange.value, 10)));

  // ── Boolean Settings ───────────────────────────────────────────
  // Helper for boolean settings with initial value support
  function initBoolWithInitial(checkboxId, settingsKey, storageKey, dataAttr, defaultOn) {
    const checkbox = document.getElementById(checkboxId);
    let isOn;
    if (settingsKey in initialSettings) {
      isOn = initialSettings[settingsKey];
    } else {
      const saved = localStorage.getItem(storageKey);
      isOn = saved ? saved === 'on' : defaultOn;
    }
    html.setAttribute(dataAttr, isOn ? 'on' : 'off');
    checkbox.checked = isOn;
    checkbox.addEventListener('change', () => {
      const val = checkbox.checked ? 'on' : 'off';
      html.setAttribute(dataAttr, val);
      localStorage.setItem(storageKey, val);
    });
    return checkbox;
  }

  initBoolWithInitial('showMinimapCheck', 'showMinimap', STORAGE.minimap, 'data-show-minimap', true);
  initBoolWithInitial('showMinorCheck', 'showMinor', STORAGE.inlineHighlight, 'data-show-minor', true);
  initBoolWithInitial('compactModeCheck', 'compact', STORAGE.compact, 'data-compact', false);

  // Gap alignment needs special handling for realignment
  const gapAlignCheck = document.getElementById('gapAlignCheck');
  let gapOn;
  if ('gapAlign' in initialSettings) {
    gapOn = initialSettings.gapAlign;
  } else {
    const savedGap = localStorage.getItem(STORAGE.gapAlign);
    gapOn = savedGap ? savedGap === 'on' : true;
  }
  html.setAttribute('data-gap-align', gapOn ? 'on' : 'off');
  gapAlignCheck.checked = gapOn;

  gapAlignCheck.addEventListener('change', () => {
    const active = document.querySelector('.file-diff:not([style*="display: none"])') || document.querySelector('.file-diff');
    const lp = active && active.querySelector('.left-pane');
    const scrollRatio = lp ? lp.scrollTop / (lp.scrollHeight - lp.clientHeight || 1) : 0;

    const isOn = gapAlignCheck.checked;
    html.setAttribute('data-gap-align', isOn ? 'on' : 'off');
    localStorage.setItem(STORAGE.gapAlign, isOn ? 'on' : 'off');

    if (active) {
      const rp = active.querySelector('.right-pane');
      if (lp && rp) {
        alignBlocks(lp, rp);
        lp.scrollTop = scrollRatio * (lp.scrollHeight - lp.clientHeight);
      }
    }
  });

  function alignBlocks(leftPane, rightPane) {
    const lb = leftPane.querySelectorAll('.diff-block');
    const rb = rightPane.querySelectorAll('.diff-block');
    const n = Math.min(lb.length, rb.length);

    // Reset all heights first
    for (let i = 0; i < n; i++) {
      lb[i].style.minHeight = '';
      rb[i].style.minHeight = '';
    }

    // Align blocks (gap alignment within blocks is handled by invisible placeholders)
    for (let i = 0; i < n; i++) {
      const maxH = Math.max(lb[i].getBoundingClientRect().height, rb[i].getBoundingClientRect().height);
      lb[i].style.minHeight = maxH + 'px';
      rb[i].style.minHeight = maxH + 'px';
    }
  }

  function computeStats(leftPane) {
    const s = { equal: 0, added: 0, removed: 0, modified: 0 };
    leftPane.querySelectorAll('.diff-block').forEach(b => {
      if (b.classList.contains('equal')) s.equal++;
      else if (b.classList.contains('added')) s.added++;
      else if (b.classList.contains('removed')) s.removed++;
      else if (b.classList.contains('modified')) s.modified++;
    });
    return s;
  }

  function renderStats(stats) {
    document.getElementById('statsBar').innerHTML = [
      ['equal', 'Unchanged'],
      ['modified', 'Modified'],
      ['added', 'Added'],
      ['removed', 'Removed'],
    ].map(([cls, label]) =>
      '<span class="stat-item"><span class="stat-dot ' + cls + '"></span>' + stats[cls] + ' ' + label + '</span>'
    ).join('');
  }

  function setupScrollSync(leftPane, rightPane) {
    let syncing = false;
    function sync(src, tgt) {
      if (syncing) return;
      syncing = true;
      const r = src.scrollTop / (src.scrollHeight - src.clientHeight || 1);
      tgt.scrollTop = r * (tgt.scrollHeight - tgt.clientHeight);
      syncing = false;
    }
    leftPane.addEventListener('scroll', () => sync(leftPane, rightPane));
    rightPane.addEventListener('scroll', () => sync(rightPane, leftPane));
  }

  const fileDiffs = document.querySelectorAll('.file-diff');
  const fileList = document.getElementById('fileList');
  const fileItems = fileList ? fileList.querySelectorAll('.file-item') : [];
  const filePathDisplay = document.getElementById('filePathDisplay');
  const sidebar = document.getElementById('fileSidebar');
  let currentFileIdx = 0;
  const scrollPositions = {};  // In-memory only, resets on page reload

  function saveScrollPosition(idx, scrollTop) {
    scrollPositions[idx] = scrollTop;
  }

  function getSavedScrollPosition(idx) {
    return scrollPositions[idx];
  }

  function findFirstChange(pane) {
    const blocks = pane.querySelectorAll('.diff-block');
    for (const block of blocks) {
      if (block.classList.contains('added') ||
          block.classList.contains('removed') ||
          block.classList.contains('modified')) {
        return block;
      }
    }
    return null;
  }

  function scrollToFirstChange(pane) {
    const firstChange = findFirstChange(pane);
    if (firstChange) {
      // Scroll so the change appears ~20% down from the top of the viewport
      const padding = Math.max(100, pane.clientHeight * 0.2);
      const targetTop = firstChange.offsetTop - padding;
      pane.scrollTop = Math.max(0, targetTop);
    }
  }

  fileDiffs.forEach(fd => {
    const lp = fd.querySelector('.left-pane');
    const rp = fd.querySelector('.right-pane');
    if (lp && rp) setupScrollSync(lp, rp);
  });

  function activateFile(idx) {
    if (idx < 0 || idx >= fileDiffs.length) return;

    // Save scroll position of current file before switching (but not on same-file activation)
    if (idx !== currentFileIdx) {
      const prevActive = fileDiffs[currentFileIdx];
      if (prevActive) {
        const prevPane = prevActive.querySelector('.left-pane');
        if (prevPane) {
          saveScrollPosition(currentFileIdx, prevPane.scrollTop);
        }
      }
    }

    currentFileIdx = idx;

    fileDiffs.forEach((fd, i) => {
      fd.style.display = i === idx ? '' : 'none';
    });

    // Update sidebar selection - find item by data-file-idx, not DOM order
    let activeItem = null;
    fileItems.forEach((item) => {
      const itemIdx = parseInt(item.getAttribute('data-file-idx') || '-1', 10);
      const isActive = itemIdx === idx;
      item.classList.toggle('active', isActive);
      if (isActive) {
        activeItem = item;
        item.scrollIntoView({ block: 'nearest' });
      }
    });

    // Update file path display
    if (filePathDisplay && activeItem) {
      const fullPath = activeItem.getAttribute('data-full-path');
      filePathDisplay.querySelector('.current-file-path').textContent = fullPath;
    }

    const active = fileDiffs[idx];
    if (active) {
      const lp = active.querySelector('.left-pane');
      const rp = active.querySelector('.right-pane');
      if (lp && rp) {
        renderStats(computeStats(lp));

        // Defer alignment and scroll to next frame to ensure CSS grid layout is complete
        requestAnimationFrame(() => {
          alignBlocks(lp, rp);
          const savedPos = getSavedScrollPosition(idx);
          if (savedPos !== undefined) {
            lp.scrollTop = savedPos;
          } else {
            scrollToFirstChange(lp);
          }
        });
      }
    }
  }

  // File list click handlers
  fileItems.forEach((item) => {
    const fileIdx = parseInt(item.getAttribute('data-file-idx') || '0', 10);
    item.addEventListener('click', () => activateFile(fileIdx));
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activateFile(fileIdx);
      }
    });
  });

  activateFile(0);

  // Keyboard navigation (arrow keys, no modifier needed)
  document.addEventListener('keydown', (e) => {
    // Only handle if not in an input/textarea
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    // Only handle if we have multiple files
    if (fileDiffs.length <= 1) return;

    if (e.key === 'ArrowDown' || e.key === 'j') {
      if (currentFileIdx < fileDiffs.length - 1) {
        activateFile(currentFileIdx + 1);
        // Dispatch custom event for minimap update
        document.dispatchEvent(new CustomEvent('filechange'));
        e.preventDefault();
      }
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      if (currentFileIdx > 0) {
        activateFile(currentFileIdx - 1);
        // Dispatch custom event for minimap update
        document.dispatchEvent(new CustomEvent('filechange'));
        e.preventDefault();
      }
    }
  });

  // Save scroll position on scroll (debounced)
  let scrollSaveTimeout = null;
  fileDiffs.forEach((fd, idx) => {
    const lp = fd.querySelector('.left-pane');
    if (lp) {
      lp.addEventListener('scroll', () => {
        if (idx !== currentFileIdx) return;
        clearTimeout(scrollSaveTimeout);
        scrollSaveTimeout = setTimeout(() => saveScrollPosition(idx, lp.scrollTop), 200);
      });
    }
  });

  // Sidebar resize functionality
  const resizeHandle = document.getElementById('sidebarResize');
  if (resizeHandle && sidebar) {
    const savedWidth = localStorage.getItem(STORAGE.sidebarWidth);
    if (savedWidth) {
      document.body.style.setProperty('--sidebar-width', savedWidth + 'px');
    }

    let isDragging = false;
    let startX = 0;
    let startWidth = 0;

    resizeHandle.addEventListener('mousedown', (e) => {
      isDragging = true;
      startX = e.clientX;
      startWidth = sidebar.offsetWidth;
      resizeHandle.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const delta = e.clientX - startX;
      const newWidth = Math.max(120, Math.min(400, startWidth + delta));
      document.body.style.setProperty('--sidebar-width', newWidth + 'px');
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        resizeHandle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem(STORAGE.sidebarWidth, sidebar.offsetWidth);
      }
    });
  }

  // Custom minimap for dual-pane synchronized scrolling
  (function initMinimap() {
    const minimapEl = document.getElementById('minimap');
    const canvas = document.getElementById('minimapCanvas');
    const viewport = document.getElementById('minimapViewport');
    if (!canvas || !viewport || !minimapEl) return;

    const ctx = canvas.getContext('2d');
    let currentPane = null;
    let isDragging = false;
    let pendingRender = null;
    // Cache block data per file index: { scrollHeight, blocks: [{top, height, status}] }
    const blockCache = new Map();

    const colors = {
      dark: { added: '#22c55e', removed: '#ef4444', modified: '#eab308', equal: 'rgba(160, 160, 160, 0.2)', bg: '#2b2b2b' },
      solar: { added: '#16a34a', removed: '#dc2626', modified: '#ca8a04', equal: 'rgba(120, 113, 108, 0.15)', bg: '#faf4e8' }
    };
    const getColors = () => colors[html.getAttribute('data-theme')] || colors.dark;

    function getActivePane() {
      const active = fileDiffs[currentFileIdx];
      return active ? active.querySelector('.left-pane') : null;
    }

    function positionMinimap() {
      const pane = getActivePane();
      if (!pane) return;
      const paneRect = pane.getBoundingClientRect();
      minimapEl.style.top = paneRect.top + 'px';
      minimapEl.style.height = paneRect.height + 'px';
    }

    function computeBlockData(pane) {
      const blocks = pane.querySelectorAll('.diff-block');
      const data = [];
      // Batch read all positions to avoid layout thrashing
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        let status = 'equal';
        if (block.classList.contains('added')) status = 'added';
        else if (block.classList.contains('removed')) status = 'removed';
        else if (block.classList.contains('modified')) status = 'modified';
        data.push({ top: block.offsetTop, height: block.offsetHeight, status });
      }
      return { scrollHeight: pane.scrollHeight, blocks: data };
    }

    function renderMinimap(forceRecompute) {
      const pane = getActivePane();
      if (!pane) return;
      currentPane = pane;
      positionMinimap();

      const dpr = window.devicePixelRatio || 1;
      const rect = minimapEl.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);

      const cols = getColors();
      ctx.fillStyle = cols.bg;
      ctx.fillRect(0, 0, rect.width, rect.height);

      // Use cached block data or compute it
      let cached = blockCache.get(currentFileIdx);
      if (!cached || forceRecompute) {
        cached = computeBlockData(pane);
        blockCache.set(currentFileIdx, cached);
      }

      const { scrollHeight, blocks } = cached;
      if (!blocks.length) return;

      const scale = rect.height / scrollHeight;
      const halfW = rect.width / 2;

      // Draw all blocks
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        const y = b.top * scale;
        const h = Math.max(b.height * scale, 2);
        ctx.fillStyle = cols[b.status];
        ctx.fillRect(4, y, halfW - 6, h);
        ctx.fillRect(halfW + 2, y, halfW - 6, h);
      }

      updateViewport();
    }

    function scheduleRender(forceRecompute) {
      if (pendingRender) return;
      pendingRender = requestAnimationFrame(() => {
        pendingRender = null;
        renderMinimap(forceRecompute);
      });
    }

    function invalidateCache(fileIdx) {
      if (fileIdx !== undefined) blockCache.delete(fileIdx);
      else blockCache.clear();
    }

    function updateViewport() {
      const pane = currentPane || getActivePane();
      if (!pane) return;

      const scrollHeight = pane.scrollHeight;
      const clientHeight = pane.clientHeight;
      const scrollTop = pane.scrollTop;
      const minimapHeight = minimapEl.getBoundingClientRect().height;

      const scale = minimapHeight / scrollHeight;
      viewport.style.top = (scrollTop * scale) + 'px';
      viewport.style.height = Math.max(clientHeight * scale, 20) + 'px';
    }

    function scrollToPosition(e) {
      const pane = currentPane || getActivePane();
      if (!pane) return;

      const rect = minimapEl.getBoundingClientRect();
      const ratio = (e.clientY - rect.top) / rect.height;
      const maxScroll = pane.scrollHeight - pane.clientHeight;
      pane.scrollTop = Math.max(0, Math.min(ratio * pane.scrollHeight - pane.clientHeight / 2, maxScroll));
    }

    // Event listeners
    minimapEl.addEventListener('mousedown', (e) => {
      isDragging = true;
      scrollToPosition(e);
    });
    document.addEventListener('mousemove', (e) => { if (isDragging) scrollToPosition(e); });
    document.addEventListener('mouseup', () => { isDragging = false; });

    // Update viewport on scroll
    let scrollListenerPane = null;
    function attachScrollListener() {
      const pane = getActivePane();
      if (pane && pane !== scrollListenerPane) {
        if (scrollListenerPane) scrollListenerPane.removeEventListener('scroll', updateViewport);
        scrollListenerPane = pane;
        pane.addEventListener('scroll', updateViewport);
      }
    }

    // Initial render - use double rAF to ensure layout is ready
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        renderMinimap();
        attachScrollListener();
      });
    });

    // Re-render on theme change (no recompute needed, just redraw)
    themeToggle.addEventListener('click', () => scheduleRender(false));

    // Re-render on file change
    document.addEventListener('filechange', () => {
      scheduleRender(false);
      attachScrollListener();
    });
    fileItems.forEach(item => {
      item.addEventListener('click', () => {
        scheduleRender(false);
        attachScrollListener();
      });
    });

    // Re-render on gap alignment toggle (invalidate cache - heights change)
    gapAlignCheck.addEventListener('change', () => {
      invalidateCache(currentFileIdx);
      scheduleRender(true);
    });

    // Re-render on resize (invalidate all caches)
    window.addEventListener('resize', () => {
      invalidateCache();
      positionMinimap();
      scheduleRender(true);
    });
  })();

  // Copy with context (Cmd-Shift-C)
  document.addEventListener('keydown', (e) => {
    if (e.metaKey && e.shiftKey && e.key.toLowerCase() === 'c') {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;

      const text = sel.toString();
      const range = sel.getRangeAt(0);
      const startEl = range.startContainer.parentElement;
      const block = startEl?.closest('.diff-block');
      const pane = block?.closest('.diff-pane');

      if (!block || !pane) return;

      // Determine side and get line number
      const isLeft = pane.classList.contains('left-pane');
      const lineAttr = isLeft ? 'data-line-left' : 'data-line-right';

      // First try block-level line number, then look for inner data-line span
      let line = block.getAttribute(lineAttr);
      if (!line) {
        const lineSpan = startEl?.closest('[data-line]');
        line = lineSpan?.getAttribute('data-line') || '?';
      }

      // Get file name (just the basename, not full path)
      const fullPath = fileItems[currentFileIdx]?.getAttribute('data-full-path') || 'unknown';
      const fileName = fullPath.split('/').pop() || fullPath;

      // Format: file:line + newline + selected text
      const formatted = fileName + ':' + line + '\\n' + text;

      navigator.clipboard.writeText(formatted);
      e.preventDefault();
    }
  });
})();
`;
