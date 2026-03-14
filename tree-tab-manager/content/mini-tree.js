// Tree Tab Manager - Mini Tree Content Script
'use strict';

// ===== 状態 =====
let miniTreeVisible = false;
let collapseState = {};   // tabId -> boolean
let shadowHost = null;
let shadowRoot = null;
let currentShortcut = 'Cmd+Shift+X';

// ===== 永続化 =====
const STORAGE_KEY = 'ttm-mini-tree-collapse';
function loadCollapseState() {
  try { collapseState = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { collapseState = {}; }
}
function saveCollapseState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(collapseState)); } catch { }
}

// ===== ショートカット文字列パース =====
// "Cmd+Shift+X" や "Ctrl+Shift+X" → e と比較できる形に
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

// ===== ショートカット設定を読み込む =====
function loadShortcut() {
  chrome.storage.local.get('ttm-shortcuts', (result) => {
    if (result && result['ttm-shortcuts'] && result['ttm-shortcuts']['toggle-mini-tree']) {
      currentShortcut = result['ttm-shortcuts']['toggle-mini-tree'];
    }
  });
}

// ===== ツリー構築 =====
function buildTree(tabs, parents) {
  const tabMap = {};
  tabs.forEach(t => { tabMap[t.id] = { ...t, children: [] }; });

  const roots = [];
  tabs.forEach(t => {
    const pid = parents[t.id];
    if (pid && tabMap[pid]) {
      tabMap[pid].children.push(tabMap[t.id]);
    } else {
      roots.push(tabMap[t.id]);
    }
  });
  return roots;
}

// ===== レンダリング =====
function escHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getFavicon(tab) {
  if (tab.favIconUrl && !tab.favIconUrl.startsWith('chrome://')) return tab.favIconUrl;
  try {
    const u = new URL(tab.url);
    return `${u.origin}/favicon.ico`;
  } catch { return ''; }
}

function renderNode(node, depth) {
  const hasChildren = node.children && node.children.length > 0;
  const isCollapsed = collapseState[node.id] || false;
  const favicon = getFavicon(node);
  const indent = depth * 10;

  let html = `<div class="ttm-mt-node" data-tab-id="${node.id}">
    <div class="ttm-mt-item${node.active ? ' ttm-mt-active' : ''}" style="padding-left:${4 + indent}px" data-tab-id="${node.id}">
      <div class="ttm-mt-toggle ${hasChildren ? (isCollapsed ? 'ttm-mt-collapsed' : '') : 'ttm-mt-no-children'}" data-tab-id="${node.id}">
        <svg viewBox="0 0 10 10" fill="currentColor"><path d="M2 3l3 4 3-4H2z"/></svg>
      </div>
      ${favicon
      ? `<img class="ttm-mt-favicon" src="${escHtml(favicon)}" onerror="this.style.display='none'" alt="">`
      : '<span class="ttm-mt-no-favicon"></span>'
    }
      <span class="ttm-mt-title" title="${escHtml(node.title)}">${escHtml(node.title || '(無題)')}</span>
    </div>`;

  if (hasChildren) {
    html += `<div class="ttm-mt-children${isCollapsed ? ' ttm-mt-children-collapsed' : ''}">`;
    node.children.forEach(child => { html += renderNode(child, depth + 1); });
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

function renderTree(roots) {
  const container = shadowRoot.getElementById('ttm-mt-tree');
  if (!container) return;
  let html = '';
  roots.forEach(r => { html += renderNode(r, 0); });
  container.innerHTML = html || '<div class="ttm-mt-empty">タブなし</div>';

  // イベント: タブクリック
  container.querySelectorAll('.ttm-mt-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.ttm-mt-toggle')) return;
      const tabId = parseInt(el.dataset.tabId);
      chrome.runtime.sendMessage({ type: 'MINI_TREE_ACTIVATE_TAB', tabId, windowId: window._ttmWindowId });
    });
  });

  // イベント: 折りたたみトグル
  container.querySelectorAll('.ttm-mt-toggle').forEach(el => {
    if (el.classList.contains('ttm-mt-no-children')) return;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const tabId = parseInt(el.dataset.tabId);
      collapseState[tabId] = !collapseState[tabId];
      saveCollapseState();
      refreshTree();
    });
  });
}

// ===== データ取得 & 描画 =====
function refreshTree() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_MINI_TREE_DATA' }, (res) => {
      if (chrome.runtime.lastError) { resolve(); return; }
      if (!res || !res.tabs) { resolve(); return; }
      window._ttmWindowId = (res.tabs.find(t => t.active) || {}).windowId;
      const roots = buildTree(res.tabs, res.parents || {});
      renderTree(roots);
      resolve();
    });
  });
}

// ===== Shadow DOM でUI構築 =====
const PANEL_CSS = `
  :host { all: initial; }
  #ttm-mt-panel {
    all: initial;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    position: fixed;
    top: 0;
    right: 0;
    width: 90px;
    height: 100vh;
    background: rgba(30, 30, 46, 0.97);
    border-left: 1px solid rgba(69, 71, 90, 0.8);
    display: flex;
    flex-direction: column;
    pointer-events: all;
    box-shadow: -4px 0 20px rgba(0,0,0,0.5);
    overflow: hidden;
    box-sizing: border-box;
  }
  #ttm-mt-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 6px 5px;
    border-bottom: 1px solid rgba(69,71,90,0.6);
    flex-shrink: 0;
    background: rgba(42,42,62,0.98);
    gap: 4px;
  }
  #ttm-mt-title {
    font-size: 9px;
    font-weight: 700;
    color: #89b4fa;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    overflow: hidden;
    white-space: nowrap;
    flex: 1;
  }
  #ttm-mt-close {
    background: none;
    border: none;
    color: #6c7086;
    cursor: pointer;
    padding: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
    flex-shrink: 0;
    transition: background 120ms, color 120ms;
    line-height: 1;
  }
  #ttm-mt-close:hover { background: rgba(243,139,168,0.2); color: #f38ba8; }
  #ttm-mt-close svg { width: 12px; height: 12px; }
  #ttm-mt-tree {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 3px 0;
  }
  #ttm-mt-tree::-webkit-scrollbar { width: 3px; }
  #ttm-mt-tree::-webkit-scrollbar-track { background: transparent; }
  #ttm-mt-tree::-webkit-scrollbar-thumb { background: #45475a; border-radius: 2px; }
  #ttm-mt-tree::-webkit-scrollbar-thumb:hover { background: #6c7086; }
  .ttm-mt-node { position: relative; }
  .ttm-mt-item {
    display: flex;
    align-items: center;
    gap: 3px;
    height: 26px;
    cursor: pointer;
    border-radius: 3px;
    margin: 1px 3px;
    transition: background 100ms;
    box-sizing: border-box;
    padding-right: 3px;
    min-width: 0;
    position: relative;
  }
  .ttm-mt-item:hover { background: rgba(58,58,80,0.9); }
  .ttm-mt-item.ttm-mt-active { background: rgba(74,74,101,0.9); }
  .ttm-mt-item.ttm-mt-active::before {
    content: '';
    position: absolute;
    left: 0;
    top: 3px;
    bottom: 3px;
    width: 2px;
    background: #89b4fa;
    border-radius: 1px;
  }
  .ttm-mt-toggle {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #6c7086;
    border-radius: 2px;
    transition: color 100ms, background 100ms;
  }
  .ttm-mt-toggle:hover { color: #cdd6f4; background: rgba(69,71,90,0.5); }
  .ttm-mt-toggle svg { width: 8px; height: 8px; transition: transform 120ms; }
  .ttm-mt-toggle.ttm-mt-collapsed svg { transform: rotate(-90deg); }
  .ttm-mt-toggle.ttm-mt-no-children { visibility: hidden; }
  .ttm-mt-favicon {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    object-fit: contain;
  }
  .ttm-mt-no-favicon {
    width: 12px;
    height: 12px;
    flex-shrink: 0;
    background: #45475a;
    border-radius: 2px;
  }
  .ttm-mt-title {
    font-size: 10px;
    color: #cdd6f4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
    line-height: 1.2;
    user-select: none;
  }
  .ttm-mt-active .ttm-mt-title { font-weight: 600; }
  .ttm-mt-children-collapsed { display: none; }
  .ttm-mt-empty {
    font-size: 9px;
    color: #6c7086;
    text-align: center;
    padding: 16px 4px;
  }
`;

function createMiniTree() {
  if (shadowHost) return;
  loadCollapseState();

  shadowHost = document.createElement('div');
  shadowHost.id = 'ttm-mini-tree-host';
  Object.assign(shadowHost.style, {
    position: 'fixed',
    top: '0',
    right: '0',
    width: '90px',
    height: '100vh',
    zIndex: '2147483647',
    pointerEvents: 'none',
  });

  shadowRoot = shadowHost.attachShadow({ mode: 'open' });
  shadowRoot.innerHTML = `
    <style>${PANEL_CSS}</style>
    <div id="ttm-mt-panel">
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

  shadowRoot.getElementById('ttm-mt-close').addEventListener('click', () => {
    hideMiniTree();
  });

  refreshTree();
}

// ===== 表示/非表示 =====
function showMiniTree() {
  miniTreeVisible = true;
  if (!shadowHost) {
    createMiniTree();
  } else {
    shadowHost.style.display = 'block';
    refreshTree();
  }
}

function hideMiniTree() {
  miniTreeVisible = false;
  if (shadowHost) shadowHost.style.display = 'none';
}

function toggleMiniTree() {
  if (miniTreeVisible) {
    hideMiniTree();
  } else {
    showMiniTree();
  }
}

// ===== グローバルキーダウンリスナー =====
// capture: true で全てのキーイベントを最優先に受け取る
document.addEventListener('keydown', (e) => {
  if (matchesShortcut(e, currentShortcut)) {
    e.preventDefault();
    e.stopImmediatePropagation();
    toggleMiniTree();
  }
}, true);

// ===== ストレージ変更監視 (設定変更をリアルタイム反映) =====
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes['ttm-shortcuts']) {
    const shortcuts = changes['ttm-shortcuts'].newValue || {};
    if (shortcuts['toggle-mini-tree']) {
      currentShortcut = shortcuts['toggle-mini-tree'];
    }
  }
});

// ===== メッセージリスナー (background.jsからの通知) =====
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'TOGGLE_MINI_TREE') {
    // background.js経由(コマンド)でも動かせるように残す
    toggleMiniTree();
  } else if (message.type === 'MINI_TREE_REFRESH' && miniTreeVisible) {
    refreshTree();
  }
});

// ===== 初期化 =====
loadShortcut();
