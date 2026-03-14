// Tree Tab Manager - Mini Tree Content Script
'use strict';

// ===== 状態 =====
let miniTreeVisible = false;
let collapseState = {};   // tabId -> boolean
let shadowHost = null;
let shadowRoot = null;
let currentShortcut = 'Cmd+Shift+X';
let currentSide = 'right'; // 'left' or 'right'
let currentWidth = 90;
let lastDataJson = ""; // 重複レンダリング防止用
let refreshInterval = null;

// ===== 最小化・磁石設定 =====
const MIN_WIDTH = 40;
const MAGNET_SNAP_THRESHOLD = 50;
const BREAKOUT_THRESHOLD = 20;
let isDraggingPanel = false;
let startX = 0;
let startW = 0;
let breakoutDistance = 0;

// ===== ドラッグ＆ドロップ状態 =====
let draggedTabId = null;

// ===== 永続化 =====
const STORAGE_KEY = 'ttm-mini-tree-collapse';
function loadCollapseState() {
  try { collapseState = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { collapseState = {}; }
}
function saveCollapseState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(collapseState)); } catch { }
}

// ===== ショートカット文字列パース =====
function matchesShortcut(e, shortcutStr) {
  if (!shortcutStr) return false;
  const parts = shortcutStr.split('+');
  const key = parts[parts.length - 1].toUpperCase();
  const needCtrl = parts.includes('Ctrl');
  const needAlt = parts.includes('Alt');
  const needShift = parts.includes('Shift');
  const needMeta = parts.includes('Cmd') || parts.includes('Meta') || parts.includes('Command');

  const eKey = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const eKeyNorm = eKey === 'ARROWUP' ? 'UP' : eKey === 'ARROWDOWN' ? 'DOWN' : eKey === 'ARROWLEFT' ? 'LEFT' : eKey === 'ARROWRIGHT' ? 'RIGHT' : eKey;

  return (
    eKeyNorm === key &&
    e.ctrlKey === needCtrl &&
    e.altKey === needAlt &&
    e.shiftKey === needShift &&
    e.metaKey === needMeta
  );
}

// ===== 設定を読み込む =====
function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['ttm-shortcuts', 'ttm-side-panel-side', 'ttm-mini-tree-visible', 'ttm-mini-tree-width'], (result) => {
      if (result['ttm-shortcuts'] && result['ttm-shortcuts']['toggle-mini-tree']) {
        currentShortcut = result['ttm-shortcuts']['toggle-mini-tree'];
      }
      if (result['ttm-side-panel-side'] && result['ttm-side-panel-side'] !== currentSide) {
        currentSide = result['ttm-side-panel-side'];
        applySidePosition();
      }
      if (result['ttm-mini-tree-width'] !== undefined) {
        currentWidth = result['ttm-mini-tree-width'];
        updateWidthUI();
      }
      const shouldBeVisible = !!result['ttm-mini-tree-visible'];
      if (shouldBeVisible !== miniTreeVisible) {
        if (shouldBeVisible) showMiniTree(true);
        else hideMiniTree(true);
      }
      resolve();
    });
  });
}

// ===== 幅の更新 =====
function updateWidthUI() {
  if (!shadowHost) return;
  shadowHost.style.width = `${currentWidth}px`;
  const panel = shadowRoot.getElementById('ttm-mt-panel');
  if (panel) {
    panel.style.width = `${currentWidth}px`;
    if (currentWidth <= MIN_WIDTH) {
      panel.classList.add('ttm-mt-docked');
    } else {
      panel.classList.remove('ttm-mt-docked');
    }
  }
  applySidePosition();
}

// ===== 位置の適用 =====
function applySidePosition() {
  if (!shadowHost) return;

  if (currentSide === 'left') {
    shadowHost.style.left = '0';
    shadowHost.style.right = 'auto';
    shadowHost.dataset.side = 'left';
  } else {
    shadowHost.style.left = 'auto';
    shadowHost.style.right = '0';
    shadowHost.dataset.side = 'right';
  }

  if (miniTreeVisible) {
    const margin = `${currentWidth}px`;
    if (currentSide === 'left') {
      document.documentElement.style.setProperty('margin-left', margin, 'important');
      document.documentElement.style.removeProperty('margin-right');
    } else {
      document.documentElement.style.setProperty('margin-right', margin, 'important');
      document.documentElement.style.removeProperty('margin-left');
    }
  } else {
    document.documentElement.style.removeProperty('margin-left');
    document.documentElement.style.removeProperty('margin-right');
  }
}

// ===== パネルリサイズ処理 =====
function startResize(e) {
  isDraggingPanel = true;
  startX = e.clientX;
  startW = currentWidth;
  breakoutDistance = 0;

  document.addEventListener('mousemove', handleResize);
  document.addEventListener('mouseup', stopResize);

  const panel = shadowRoot.getElementById('ttm-mt-panel');
  if (panel) panel.style.transition = 'none';
}

function handleResize(e) {
  if (!isDraggingPanel) return;

  let diff = (currentSide === 'right') ? (startX - e.clientX) : (e.clientX - startX);
  let newW = startW + diff;

  if (startW <= MIN_WIDTH && diff > 0) {
    breakoutDistance = diff;
    if (breakoutDistance < BREAKOUT_THRESHOLD) {
      newW = MIN_WIDTH;
    } else {
      newW = MIN_WIDTH + (breakoutDistance - BREAKOUT_THRESHOLD);
    }
  } else if (newW < MAGNET_SNAP_THRESHOLD) {
    newW = MIN_WIDTH;
  }

  if (newW > 400) newW = 400;

  if (newW !== currentWidth) {
    currentWidth = newW;
    updateWidthUI();
  }
}

function stopResize() {
  isDraggingPanel = false;
  document.removeEventListener('mousemove', handleResize);
  document.removeEventListener('mouseup', stopResize);

  const panel = shadowRoot.getElementById('ttm-mt-panel');
  if (panel) panel.style.transition = 'width 0.1s ease';

  chrome.storage.local.set({ 'ttm-mini-tree-width': currentWidth });
}

// ===== ツリー構築 =====
function buildTree(tabs, parents) {
  const tabMap = {};
  tabs.forEach(t => { tabMap[t.id] = { ...t, children: [] }; });
  const roots = [];
  tabs.forEach(t => {
    const pid = parents[t.id];
    if (pid && tabMap[pid]) { tabMap[pid].children.push(tabMap[t.id]); } else { roots.push(tabMap[t.id]); }
  });
  return roots;
}

// ===== レンダリング =====
function escHtml(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function getFavicon(tab) {
  if (tab.favIconUrl && !tab.favIconUrl.startsWith('chrome://')) return tab.favIconUrl;
  try { return `${new URL(tab.url).origin}/favicon.ico`; } catch { return ''; }
}

function renderNode(node, depth, isLast = false, parentIsLast = []) {
  const hasChildren = node.children && node.children.length > 0;
  const isCollapsed = collapseState[node.id] || false;
  const favicon = getFavicon(node);
  const isPinned = node.pinned;

  let html = `<div class="ttm-mt-node" data-tab-id="${node.id}">`;

  // アイテム行
  html += `<div class="ttm-mt-item${node.active ? ' ttm-mt-active' : ''}${isPinned ? ' ttm-mt-pinned' : ''}" 
                data-tab-id="${node.id}" 
                data-index="${node.index}"
                draggable="true">`;

  // ツリー線とインデント
  if (depth > 0) {
    html += `<div class="ttm-mt-lines">`;
    for (let i = 0; i < depth - 1; i++) {
      html += `<div class="ttm-mt-line-v ${parentIsLast[i] ? '' : 'active'}"></div>`;
    }
    html += `<div class="ttm-mt-line-node ${isLast ? 'last' : ''}"></div>`;
    html += `</div>`;
  }

  // トグル
  html += `<div class="ttm-mt-toggle ${hasChildren ? (isCollapsed ? 'ttm-mt-collapsed' : '') : 'ttm-mt-no-children'}" data-tab-id="${node.id}">
      <svg viewBox="0 0 10 10" fill="currentColor"><path d="M2 3l3 4 3-4H2z"/></svg>
    </div>`;

  // ドラッグハンドル
  html += `<div class="ttm-mt-drag-handle">
      <svg viewBox="0 0 10 10" fill="currentColor">
        <circle cx="3" cy="3" r="1"/><circle cx="7" cy="3" r="1"/>
        <circle cx="3" cy="5" r="1"/><circle cx="7" cy="5" r="1"/>
        <circle cx="3" cy="7" r="1"/><circle cx="7" cy="7" r="1"/>
      </svg>
    </div>`;

  // コンテンツラッパー
  html += `<div class="ttm-mt-content">`;

  // アイコン
  html += `<div class="ttm-mt-icon-box">
        ${favicon ? `<img class="ttm-mt-favicon" src="${escHtml(favicon)}" onerror="this.style.display='none'" alt="">` : '<span class="ttm-mt-no-favicon"></span>'}
      </div>`;

  // タイトル
  html += `<span class="ttm-mt-title" title="${escHtml(node.title)}">${escHtml(node.title || '(無題)')}</span>`;

  html += `</div>`; // .ttm-mt-content 終了

  html += `</div>`; // .ttm-mt-item 終了

  // 子要素
  if (hasChildren) {
    html += `<div class="ttm-mt-children${isCollapsed ? ' ttm-mt-children-collapsed' : ''}">`;
    const nextParentIsLast = [...parentIsLast, isLast];
    node.children.forEach((child, idx) => {
      const lastFlag = idx === node.children.length - 1;
      html += renderNode(child, depth + 1, lastFlag, nextParentIsLast);
    });
    html += `</div>`;
  }
  html += `</div>`;
  return html;
}

function renderTree(roots) {
  const container = shadowRoot.getElementById('ttm-mt-tree');
  if (!container) return;
  let html = '';
  roots.forEach((r, idx) => {
    const isLast = idx === roots.length - 1;
    html += renderNode(r, 0, isLast, []);
  });
  container.innerHTML = html || '<div class="ttm-mt-empty">タブなし</div>';

  const items = container.querySelectorAll('.ttm-mt-item');
  items.forEach(el => {
    // クリック（アクティブ化）
    el.addEventListener('click', (e) => {
      if (e.target.closest('.ttm-mt-toggle')) return;
      chrome.runtime.sendMessage({ type: 'MINI_TREE_ACTIVATE_TAB', tabId: parseInt(el.dataset.tabId), windowId: window._ttmWindowId });
    });

    // ドラッグ＆ドロップ
    el.addEventListener('dragstart', (e) => {
      draggedTabId = parseInt(el.dataset.tabId);
      el.classList.add('ttm-mt-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', el.dataset.tabId);
    });

    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const targetId = parseInt(el.dataset.tabId);
      if (targetId === draggedTabId) return;

      const rect = el.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      el.classList.remove('ttm-mt-drag-over-top', 'ttm-mt-drag-over-bottom');
      if (e.clientY < midpoint) {
        el.classList.add('ttm-mt-drag-over-top');
      } else {
        el.classList.add('ttm-mt-drag-over-bottom');
      }
    });

    el.addEventListener('dragleave', () => {
      el.classList.remove('ttm-mt-drag-over-top', 'ttm-mt-drag-over-bottom');
    });

    el.addEventListener('dragend', () => {
      el.classList.remove('ttm-mt-dragging');
      items.forEach(item => item.classList.remove('ttm-mt-drag-over-top', 'ttm-mt-drag-over-bottom'));
    });

    el.addEventListener('drop', (e) => {
      e.preventDefault();
      const targetId = parseInt(el.dataset.tabId);
      if (targetId === draggedTabId) return;

      const targetIndex = parseInt(el.dataset.index);
      const isTop = el.classList.contains('ttm-mt-drag-over-top');

      // 移動先のインデックスを計算
      let newIndex = isTop ? targetIndex : targetIndex + 1;

      chrome.runtime.sendMessage({
        type: 'MINI_TREE_MOVE_TAB',
        tabId: draggedTabId,
        index: newIndex
      });
    });
  });

  container.querySelectorAll('.ttm-mt-toggle').forEach(el => {
    if (el.classList.contains('ttm-mt-no-children')) return;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const tabId = parseInt(el.dataset.tabId);
      collapseState[tabId] = !collapseState[tabId];
      saveCollapseState();
      refreshTree(true);
    });
  });
}

async function refreshTree(force = false) {
  if (!miniTreeVisible) return;
  chrome.runtime.sendMessage({ type: 'GET_MINI_TREE_DATA' }, (res) => {
    if (chrome.runtime.lastError || !res || !res.tabs) return;
    const dataJson = JSON.stringify({ tabs: res.tabs, parents: res.parents, collapse: collapseState });
    if (!force && dataJson === lastDataJson) return;
    lastDataJson = dataJson;
    window._ttmWindowId = (res.tabs.find(t => t.active) || {}).windowId;
    renderTree(buildTree(res.tabs, res.parents || {}));
  });
}

function startPolling() {
  if (refreshInterval) return;
  refreshInterval = setInterval(() => {
    if (document.visibilityState === 'visible') {
      loadSettings();
      refreshTree();
    }
  }, 1000);
}

function stopPolling() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

const PANEL_CSS = `
  :host { all: initial; }
  #ttm-mt-panel {
    all: initial; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    position: absolute; top: 0; left: 0; width: 90px; height: 100vh;
    background: rgba(30,30,46,0.98); display: flex; flex-direction: column;
    pointer-events: all; overflow: hidden; box-sizing: border-box;
    transition: width 0.1s ease;
  }
  
  :host([data-side="right"]) #ttm-mt-panel {
    border-left: 1px solid rgba(69, 71, 90, 0.8);
    box-shadow: -4px 0 20px rgba(0,0,0,0.5);
  }
  :host([data-side="left"]) #ttm-mt-panel {
    border-right: 1px solid rgba(69, 71, 90, 0.8);
    box-shadow: 4px 0 20px rgba(0,0,0,0.5);
  }

  /* 最小化状態 (faviconのみ) */
  #ttm-mt-panel.ttm-mt-docked {
    width: ${MIN_WIDTH}px !important;
  }
  #ttm-mt-panel.ttm-mt-docked #ttm-mt-title,
  #ttm-mt-panel.ttm-mt-docked .ttm-mt-title,
  #ttm-mt-panel.ttm-mt-docked .ttm-mt-toggle,
  #ttm-mt-panel.ttm-mt-docked .ttm-mt-lines {
    display: none !important;
  }
  #ttm-mt-panel.ttm-mt-docked .ttm-mt-item {
    padding-left: 0 !important;
    justify-content: center;
  }
  #ttm-mt-panel.ttm-mt-docked .ttm-mt-icon-box {
    margin: 0;
  }

  #ttm-mt-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 6px 6px 5px; border-bottom: 1px solid rgba(69,71,90,0.6);
    flex-shrink: 0; background: rgba(42,42,62,0.98); gap: 4px;
    height: 30px; box-sizing: border-box;
  }
  #ttm-mt-title { font-size: 9px; font-weight: 700; color: #89b4fa; letter-spacing: 0.04em; text-transform: uppercase; overflow: hidden; white-space: nowrap; flex: 1; }
  #ttm-mt-close { background: none; border: none; color: #6c7086; cursor: pointer; padding: 2px; display: flex; align-items: center; justify-content: center; border-radius: 3px; flex-shrink: 0; transition: background 120ms, color 120ms; line-height: 1; }
  #ttm-mt-close:hover { background: rgba(243,139,168,0.2); color: #f38ba8; }
  #ttm-mt-close svg { width: 12px; height: 12px; }
  
  #ttm-mt-resizer {
    position: absolute; top: 0; bottom: 0; width: 6px; cursor: ew-resize; z-index: 100;
  }
  :host([data-side="right"]) #ttm-mt-resizer { left: -3px; }
  :host([data-side="left"]) #ttm-mt-resizer { right: -3px; }

  #ttm-mt-tree { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 3px 0; }
  #ttm-mt-tree::-webkit-scrollbar { width: 0px; }
  
  .ttm-mt-item { position: relative; border-radius: 4px; margin: 1px 4px; display: flex; align-items: center; height: 28px; cursor: pointer; box-sizing: border-box; overflow: hidden; padding-left: 4px; }
  .ttm-mt-content { display: flex; align-items: center; flex: 1; height: 24px; border-radius: 4px; padding: 0 4px; transition: background 100ms; overflow: hidden; }
  .ttm-mt-item:hover .ttm-mt-content { background: rgba(58,58,80,0.9); }
  .ttm-mt-item.ttm-mt-active .ttm-mt-content { background: rgba(74,74,101,0.9); }
  .ttm-mt-item.ttm-mt-active::before { content: ''; position: absolute; left: 0; top: 4px; bottom: 4px; width: 2px; background: #89b4fa; border-radius: 1px; }

  /* ドラッグ＆ドロップ用スタイル */
  .ttm-mt-dragging { opacity: 0.4; }
  .ttm-mt-drag-over-top { border-top: 2px solid #89b4fa !important; }
  .ttm-mt-drag-over-bottom { border-bottom: 2px solid #89b4fa !important; }

  /* 固定タブの差別化 */
  .ttm-mt-pinned { background: rgba(137, 180, 250, 0.1); border: 1px solid rgba(137, 180, 250, 0.15); margin: 2px 6px; height: 30px; }
  .ttm-mt-pinned .ttm-mt-title { color: #89b4fa; font-size: 10.5px; }

  /* ツリー線描画 */
  .ttm-mt-lines { display: flex; height: 100%; align-items: stretch; flex-shrink: 0; margin-right: 2px; }
  .ttm-mt-line-v { width: 10px; position: relative; flex-shrink: 0; }
  .ttm-mt-line-v.active::before { content: ''; position: absolute; left: 5px; top: 0; bottom: 0; border-left: 1px solid rgba(108, 112, 134, 0.4); }
  .ttm-mt-line-node { width: 12px; position: relative; flex-shrink: 0; }
  .ttm-mt-line-node::before { content: ''; position: absolute; left: 5px; top: 0; height: 50%; border-left: 1px solid rgba(108, 112, 134, 0.4); }
  .ttm-mt-line-node::after { content: ''; position: absolute; left: 5px; top: 50%; width: 5px; border-top: 1px solid rgba(108, 112, 134, 0.4); }
  .ttm-mt-line-node:not(.last)::before { height: 100%; }

  .ttm-mt-toggle { width: 16px; height: 16px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: #6c7086; z-index: 1; }
  .ttm-mt-toggle svg { width: 8px; height: 8px; transition: transform 0.1s; }
  .ttm-mt-toggle.ttm-mt-collapsed svg { transform: rotate(-90deg); }
  .ttm-mt-toggle.ttm-mt-no-children { visibility: hidden; }
  
  .ttm-mt-drag-handle { width: 12px; height: 16px; display: flex; align-items: center; justify-content: center; color: #6c7086; cursor: grab; opacity: 0; transition: opacity 100ms; flex-shrink: 0; }
  .ttm-mt-item:hover .ttm-mt-drag-handle { opacity: 0.6; }
  .ttm-mt-drag-handle:hover { color: #89b4fa; opacity: 1 !important; }
  .ttm-mt-drag-handle svg { width: 8px; height: 12px; }

  .ttm-mt-icon-box { width: 16px; height: 16px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; margin-right: 4px; }
  .ttm-mt-favicon { width: 14px; height: 14px; object-fit: contain; }
  .ttm-mt-no-favicon { width: 12px; height: 12px; background: #45475a; border-radius: 2px; }

  .ttm-mt-title { font-size: 11px; color: #cdd6f4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; user-select: none; }
  .ttm-mt-active .ttm-mt-title { font-weight: 600; color: #fff; }
  .ttm-mt-children-collapsed { display: none; }
  .ttm-mt-empty { font-size: 9px; color: #6c7086; text-align: center; padding: 16px 4px; }
`;

function createMiniTree() {
  if (shadowHost) return;
  loadCollapseState();
  shadowHost = document.createElement('div');
  shadowHost.id = 'ttm-mini-tree-host';
  Object.assign(shadowHost.style, { position: 'fixed', top: '0', zIndex: '2147483647', pointerEvents: 'none', height: '100vh' });
  shadowRoot = shadowHost.attachShadow({ mode: 'open' });
  shadowRoot.innerHTML = `
    <style>${PANEL_CSS}</style>
    <div id="ttm-mt-panel">
      <div id="ttm-mt-resizer"></div>
      <div id="ttm-mt-header">
        <span id="ttm-mt-title">Tabs</span>
        <button id="ttm-mt-close" title="閉じる">
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
          </svg>
        </button>
      </div>
      <div id="ttm-mt-tree"></div>
    </div>
  `;
  document.documentElement.appendChild(shadowHost);
  shadowRoot.getElementById('ttm-mt-close').addEventListener('click', () => hideMiniTree());
  shadowRoot.getElementById('ttm-mt-resizer').addEventListener('mousedown', startResize);

  applySidePosition();
  updateWidthUI();
  refreshTree(true);
}

function showMiniTree(skipSync = false) {
  miniTreeVisible = true;
  if (!shadowHost) { createMiniTree(); } else { shadowHost.style.display = 'block'; applySidePosition(); updateWidthUI(); refreshTree(true); }
  if (!skipSync) chrome.storage.local.set({ 'ttm-mini-tree-visible': true });
  startPolling();
}
function hideMiniTree(skipSync = false) {
  miniTreeVisible = false;
  if (shadowHost) shadowHost.style.display = 'none';
  document.documentElement.style.removeProperty('margin-right');
  document.documentElement.style.removeProperty('margin-left');
  if (!skipSync) chrome.storage.local.set({ 'ttm-mini-tree-visible': false });
  stopPolling();
}
function toggleMiniTree() { if (miniTreeVisible) hideMiniTree(); else showMiniTree(); }

document.addEventListener('keydown', (e) => {
  if (matchesShortcut(e, currentShortcut)) { e.preventDefault(); e.stopImmediatePropagation(); toggleMiniTree(); }
}, true);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    if (changes['ttm-shortcuts']) currentShortcut = (changes['ttm-shortcuts'].newValue || {})['toggle-mini-tree'] || currentShortcut;
    if (changes['ttm-side-panel-side']) { currentSide = changes['ttm-side-panel-side'].newValue || 'right'; applySidePosition(); }
    if (changes['ttm-mini-tree-width'] && !isDraggingPanel) { currentWidth = changes['ttm-mini-tree-width'].newValue || 90; updateWidthUI(); }
    if (changes['ttm-mini-tree-visible']) {
      const v = !!changes['ttm-mini-tree-visible'].newValue;
      if (v !== miniTreeVisible) { if (v) showMiniTree(true); else hideMiniTree(true); }
    }
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'TOGGLE_MINI_TREE') toggleMiniTree();
  else if (message.type === 'MINI_TREE_REFRESH' && miniTreeVisible) refreshTree(true);
});

loadSettings();
startPolling();
