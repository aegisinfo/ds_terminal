(function () {
  'use strict';

  // ─── Terminal Theme (Catppuccin Mocha) ──────────────
  const THEME = {
    background: '#1e1e2e',
    foreground: '#cdd6f4',
    cursor: '#f5e0dc',
    cursorAccent: '#1e1e2e',
    selectionBackground: '#585b70',
    black: '#45475a',
    red: '#f38ba8',
    green: '#a6e3a1',
    yellow: '#f9e2af',
    blue: '#89b4fa',
    magenta: '#cba6f7',
    cyan: '#94e2d5',
    white: '#bac2de',
    brightBlack: '#585b70',
    brightRed: '#f38ba8',
    brightGreen: '#a6e3a1',
    brightYellow: '#f9e2af',
    brightBlue: '#89b4fa',
    brightMagenta: '#cba6f7',
    brightCyan: '#94e2d5',
    brightWhite: '#a6adc8',
  };

  const FONT_FAMILY = "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', 'Menlo', monospace";
  const DEFAULT_FONT_SIZE = 14;

  // ─── Pane Manager ────────────────────────────────────
  const paneContainer = document.getElementById('pane-container');
  const statusShell = document.getElementById('status-shell');
  const statusInfo = document.getElementById('status-info');

  let panes = [];                // { id, term, fitAddon, searchAddon, el, termEl, headerEl, active }
  let nextPaneId = 2;           // start at 2 since 0 and 1 are pre-created
  let activePaneId = 0;
  let fontSizes = {};           // paneId -> fontSize
  let dividerEl = null;

  // ─── PTY Data Router ─────────────────────────────────
  const ptyDataHandlers = {};
  const ptyExitHandlers = {};

  // Listen for all PTY data and route to the right pane
  const cleanupData = window.terminal.onData((paneId, data) => {
    if (ptyDataHandlers[paneId]) {
      ptyDataHandlers[paneId](data);
    }
  });

  const cleanupExit = window.terminal.onExit((paneId, exitCode) => {
    if (ptyExitHandlers[paneId]) {
      ptyExitHandlers[paneId](exitCode);
    }
  });

  // ─── Create a Pane ───────────────────────────────────
  function createPane(id, label) {
    // DOM elements
    const el = document.createElement('div');
    el.className = 'pane';
    el.dataset.pane = id;
    el.style.flex = '1';
    el.style.width = '100%';

    const headerEl = document.createElement('div');
    headerEl.className = 'pane-header';
    headerEl.innerHTML = `<span class="pane-label">${label}</span>`;
    el.appendChild(headerEl);

    const termEl = document.createElement('div');
    termEl.className = 'pane-terminal';
    el.appendChild(termEl);

    // xterm.js terminal
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: DEFAULT_FONT_SIZE,
      fontFamily: FONT_FAMILY,
      lineHeight: 1.2,
      theme: THEME,
      scrollback: 5000,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon.FitAddon();
    const webLinksAddon = new WebLinksAddon.WebLinksAddon();
    const searchAddon = new SearchAddon.SearchAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.loadAddon(searchAddon);

    term.open(termEl);

    // Focus on click
    termEl.addEventListener('click', () => focusPane(id));
    // Also focus when terminal element itself gains focus
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown') {
        focusPane(id);
      }
      return true;
    });

    const paneObj = { id, term, fitAddon, searchAddon, el, termEl, headerEl, active: false };
    panes.push(paneObj);

    // Font size tracking
    fontSizes[id] = DEFAULT_FONT_SIZE;

    // Spawn PTY
    startPty(id, term, fitAddon);

    return paneObj;
  }

  // ─── Start PTY for a pane ───────────────────────────
  async function startPty(paneId, term, fitAddon) {
    const platform = window.terminal.getPlatform();

    // Small delay to ensure DOM layout is stable
    await new Promise((r) => setTimeout(r, 50));

    try {
      fitAddon.fit();
    } catch (e) {}

    const cols = term.cols || 80;
    const rows = term.rows || 24;

    try {
      await window.terminal.spawn(paneId, cols, rows);
    } catch (err) {
      term.writeln(`\r\n\x1b[31mFailed to spawn shell: ${err.message}\x1b[0m`);
      return;
    }

    // Route PTY data -> terminal
    ptyDataHandlers[paneId] = (data) => {
      term.write(data);
    };

    // Handle exit
    ptyExitHandlers[paneId] = (exitCode) => {
      term.writeln(`\r\n\x1b[33m[process exited with code ${exitCode}]\x1b[0m`);
    };

    // User input -> PTY
    term.onData((data) => {
      window.terminal.write(paneId, data);
    });

    // Resize -> PTY
    term.onResize(({ cols, rows }) => {
      window.terminal.resize(paneId, cols, rows);
    });
  }

  // ─── Focus a pane ────────────────────────────────────
  function focusPane(id) {
    if (activePaneId === id) return;
    activePaneId = id;

    panes.forEach((p) => {
      p.active = p.id === id;
      p.el.classList.toggle('active', p.id === id);
    });

    // Focus the terminal element
    const pane = panes.find((p) => p.id === id);
    if (pane) {
      pane.term.focus();
      updateStatusBar(pane);
    }
  }

  // ─── Update Status Bar ──────────────────────────────
  function updateStatusBar(pane) {
    if (!pane) return;
    const label = pane.headerEl.querySelector('.pane-label').textContent;
    statusShell.textContent = '●';
    statusInfo.textContent = `Terminal DS · ${label} pane`;
  }

  // ─── Layout: Build Split View ───────────────────────
  // We pre-create pane-0 and pane-1 in HTML, so we just
  // need to pick them up and attach xterm to each.
  function initPanes() {
    const existingPanes = document.querySelectorAll('.pane');
    const labels = ['AEGIS', 'shell'];

    existingPanes.forEach((el, i) => {
      const id = parseInt(el.dataset.pane);
      const termEl = el.querySelector('.pane-terminal');
      const headerEl = el.querySelector('.pane-header');
      const labelEl = headerEl.querySelector('.pane-label');
      const label = labels[i] || 'term';

      const term = new Terminal({
        cursorBlink: true,
        cursorStyle: 'bar',
        fontSize: DEFAULT_FONT_SIZE,
        fontFamily: FONT_FAMILY,
        lineHeight: 1.2,
        theme: THEME,
        scrollback: 5000,
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon.FitAddon();
      const webLinksAddon = new WebLinksAddon.WebLinksAddon();
      const searchAddon = new SearchAddon.SearchAddon();

      term.loadAddon(fitAddon);
      term.loadAddon(webLinksAddon);
      term.loadAddon(searchAddon);
      term.open(termEl);

      termEl.addEventListener('click', () => focusPane(id));
      term.attachCustomKeyEventHandler((e) => {
        if (e.type === 'keydown') focusPane(id);
        return true;
      });

      fontSizes[id] = DEFAULT_FONT_SIZE;

      const paneObj = { id, term, fitAddon, searchAddon, el, termEl, headerEl, active: id === 0 };
      panes.push(paneObj);

      // Spawn PTY after a small delay
      startPty(id, term, fitAddon);
    });

    // Set initial split (vertical)
    paneContainer.classList.add('split-vertical');

    // Insert divider between panes
    insertDivider();

    // Focus first pane
    focusPane(0);
  }

  // ─── Divider Management ──────────────────────────────
  function insertDivider() {
    // Remove existing divider
    if (dividerEl) {
      dividerEl.remove();
      dividerEl = null;
    }

    if (panes.length < 2) return;

    // Find the two panes in DOM order
    const paneEls = paneContainer.querySelectorAll('.pane');
    if (paneEls.length < 2) return;

    dividerEl = document.createElement('div');
    dividerEl.className = 'pane-divider';
    paneContainer.insertBefore(dividerEl, paneEls[1]);

    // Drag logic
    let isDragging = false;
    let startPos = 0;
    let startSizes = [];

    dividerEl.addEventListener('mousedown', (e) => {
      isDragging = true;
      dividerEl.classList.add('dragging');
      startPos = paneContainer.classList.contains('split-vertical') ? e.clientX : e.clientY;

      // Record initial sizes of all panes
      const allPanes = paneContainer.querySelectorAll('.pane');
      startSizes = Array.from(allPanes).map((p) => {
        return paneContainer.classList.contains('split-vertical') ? p.offsetWidth : p.offsetHeight;
      });

      document.addEventListener('mousemove', onDrag);
      document.addEventListener('mouseup', onDragEnd);
      e.preventDefault();
    });

    function onDrag(e) {
      if (!isDragging) return;
      const currentPos = paneContainer.classList.contains('split-vertical') ? e.clientX : e.clientY;
      const delta = currentPos - startPos;
      const isVertical = paneContainer.classList.contains('split-vertical');

      const allPanes = paneContainer.querySelectorAll('.pane');
      const totalSize = isVertical ? paneContainer.offsetWidth : paneContainer.offsetHeight;
      const dividerSize = isVertical ? 4 : 4;

      // Calculate new sizes
      const totalFlex = totalSize - dividerSize * (allPanes.length - 1);
      let sizes = [];
      for (let i = 0; i < allPanes.length; i++) {
        let size = startSizes[i] || (totalFlex / allPanes.length);
        if (i === 0) size = Math.max(150, Math.min(totalFlex - 150, size + delta));
        sizes.push(size);
      }

      // Normalize last pane to fill remaining space
      const used = sizes.slice(0, -1).reduce((a, b) => a + b, 0);
      sizes[allPanes.length - 1] = Math.max(150, totalFlex - used);

      // Apply flex-basis
      allPanes.forEach((p, i) => {
        p.style.flex = '0 0 ' + sizes[i] + 'px';
      });
    }

    function onDragEnd() {
      isDragging = false;
      dividerEl.classList.remove('dragging');
      document.removeEventListener('mousemove', onDrag);
      document.removeEventListener('mouseup', onDragEnd);
    }
  }

  // ─── Resize Handling ─────────────────────────────────
  let resizeTimeout;
  function fitAll() {
    panes.forEach((p) => {
      try {
        p.fitAddon.fit();
        const { cols, rows } = p.term;
        window.terminal.resize(p.id, cols, rows);
      } catch (e) {}
    });
  }

  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(fitAll, 80);
  });

  // ─── Keyboard Shortcuts ──────────────────────────────
  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;

    // Ctrl+Shift+5 = split vertical
    if (ctrl && e.shiftKey && e.key === '5') {
      e.preventDefault();
      splitPane('vertical');
    }

    // Ctrl+Shift+6 = split horizontal
    if (ctrl && e.shiftKey && e.key === '6') {
      e.preventDefault();
      splitPane('horizontal');
    }

    // Ctrl+Shift+W = close active pane (keep at least 1)
    if (ctrl && e.shiftKey && (e.key === 'w' || e.key === 'W')) {
      e.preventDefault();
      closePane(activePaneId);
    }

    // Ctrl+Shift+N = new window (menu handles this too)
    // Zoom: Ctrl+= / Ctrl+-
    if (ctrl && (e.key === '=' || e.key === '-' || e.key === '0')) {
      e.preventDefault();
      const delta = e.key === '=' ? 1 : e.key === '-' ? -1 : 0;
      const active = panes.find((p) => p.id === activePaneId);
      if (active) {
        if (delta === 0) {
          fontSizes[active.id] = DEFAULT_FONT_SIZE;
        } else {
          fontSizes[active.id] = Math.max(10, Math.min(32, fontSizes[active.id] + delta * 2));
        }
        active.term.setOption('fontSize', fontSizes[active.id]);
        // Refit after font change
        setTimeout(() => {
          try { active.fitAddon.fit(); } catch (e) {}
        }, 50);
      }
    }

    // Ctrl+Shift+F = search
    if (ctrl && e.shiftKey && e.key === 'f') {
      e.preventDefault();
      const active = panes.find((p) => p.id === activePaneId);
      if (active) {
        const query = prompt('Search terminal:');
        if (query && query !== '') {
          active.searchAddon.findNext(query);
        }
      }
    }

    // Cycle focus: Ctrl+Tab or Ctrl+`
    if (ctrl && (e.key === 'Tab' || e.key === '`')) {
      e.preventDefault();
      const idx = panes.findIndex((p) => p.id === activePaneId);
      const next = (idx + 1) % panes.length;
      focusPane(panes[next].id);
    }
  });

  // ─── Split Pane ──────────────────────────────────────
  function splitPane(direction) {
    const active = panes.find((p) => p.id === activePaneId);
    if (!active) return;

    const id = nextPaneId++;
    const label = `term-${panes.length}`;

    // Create pane DOM
    const el = document.createElement('div');
    el.className = 'pane';
    el.dataset.pane = id;
    el.style.flex = '1';

    const headerEl = document.createElement('div');
    headerEl.className = 'pane-header';
    headerEl.innerHTML = `<span class="pane-label">${label}</span>`;
    el.appendChild(headerEl);

    const termEl = document.createElement('div');
    termEl.className = 'pane-terminal';
    el.appendChild(termEl);

    // Insert after the active pane in DOM
    active.el.after(el);

    // Set split direction
    paneContainer.classList.remove('split-vertical', 'split-horizontal');
    paneContainer.classList.add('split-' + direction);

    // Reset flex on all existing panes so they distribute evenly
    paneContainer.querySelectorAll('.pane').forEach((p) => {
      p.style.flex = '1';
      p.style.width = direction === 'vertical' ? '50%' : '100%';
    });

    // Create xterm for new pane
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: fontSizes[active.id] || DEFAULT_FONT_SIZE,
      fontFamily: FONT_FAMILY,
      lineHeight: 1.2,
      theme: THEME,
      scrollback: 5000,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon.FitAddon();
    const webLinksAddon = new WebLinksAddon.WebLinksAddon();
    const searchAddon = new SearchAddon.SearchAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.loadAddon(searchAddon);
    term.open(termEl);

    termEl.addEventListener('click', () => focusPane(id));
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown') focusPane(id);
      return true;
    });

    fontSizes[id] = fontSizes[active.id] || DEFAULT_FONT_SIZE;

    const paneObj = { id, term, fitAddon, searchAddon, el, termEl, headerEl, active: false };
    panes.push(paneObj);

    // Rebuild divider
    rebuildDividers();

    // Resize and spawn PTY
    setTimeout(() => {
      try { fitAddon.fit(); } catch (e) {}
      startPty(id, term, fitAddon);
      fitAll();
    }, 50);

    focusPane(id);
  }

  // ─── Close Pane ──────────────────────────────────────
  function closePane(id) {
    if (panes.length <= 1) return;

    const pane = panes.find((p) => p.id === id);
    if (!pane) return;

    // Kill PTY
    window.terminal.kill(id);
    delete ptyDataHandlers[id];
    delete ptyExitHandlers[id];
    delete fontSizes[id];

    // Remove DOM
    pane.el.remove();

    // Remove from array
    panes = panes.filter((p) => p.id !== id);

    // Rebuild divider
    rebuildDividers();

    // Focus next pane
    if (activePaneId === id) {
      const next = panes[Math.min(0, panes.length - 1)];
      if (next) focusPane(next.id);
    }

    // If only one pane left, reset layout
    if (panes.length === 1) {
      paneContainer.classList.remove('split-vertical', 'split-horizontal');
      panes[0].el.style.flex = '1';
      panes[0].el.style.width = '100%';
      fitAll();
    }
  }

  // ─── Rebuild Dividers ────────────────────────────────
  function rebuildDividers() {
    // Remove all dividers
    document.querySelectorAll('.pane-divider').forEach((d) => d.remove());
    dividerEl = null;
    insertDivider();

    // Reset flex on panes to distribute evenly
    const paneEls = paneContainer.querySelectorAll('.pane');
    const direction = paneContainer.classList.contains('split-vertical') ? 'vertical' : 'horizontal';
    paneEls.forEach((p) => {
      p.style.flex = '1';
      p.style.width = direction === 'vertical' ? '100%' : '100%';
    });

    fitAll();
  }

  // ─── Menu Events from Main Process ──────────────────
  const cleanupMenuSplit = window.terminal.onMenuSplit((direction) => {
    splitPane(direction);
  });

  // ─── Initialize ──────────────────────────────────────
  initPanes();

  // Expose for debugging
  window.__panes = panes;
  window.__split = splitPane;
  window.__close = closePane;

})();
