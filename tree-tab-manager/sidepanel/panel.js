// Tree Tab Manager - Sidepanel Script

// ===== 状態管理 =====
const state = {
  // タブパネル
  tabs: [],           // chrome.tabs の一覧
  tabParents: {},     // tabId -> parentTabId
  tabMetadata: {},    // tabId -> { collapsed }
  collapseState: {},  // tabId -> collapsed (ローカル)
  activeTabId: null,
  currentWindowId: null,
  showPinnedTabs: true,  // 固定タブセクションの表示状態
  tabActivationTime: {},  // tabId -> lastActivationTime（最近開いた順用）
  tabGroupMap: {},    // tabId -> groupId（グループ認識用）

  // 履歴パネル
  historyItems: [],
  historyQuery: '',

  // ブックマークパネル
  bookmarkTree: null,
  bookmarkSortMode: 'recent-used', // 'recent-used' | 'recent-added' | 'most-visited' | 'tree'
  bookmarkQuery: '',
  bookmarkFlatList: [],   // フラット化したブックマークリスト
  bookmarkFolderState: {}, // folderId -> collapsed

  // 最近使用したブックマーク
  recentlyUsedBookmarks: {}, // url -> timestamp
  visitCountMap: {},          // url -> visitCount (総訪問回数)

  // タブ名カスタマイズ
  customTabNames: {},    // tabId -> customName
  tabCustomNamesByUrl: {}, // url -> customName（再訪時のため）
};

// ===== 表示モード管理 =====
const DISPLAY_MODES = ['full', 'compact', 'mini'];

// 各モードのアイコン（SVG文字列）
const MODE_ICONS = {
  full: `<svg viewBox="0 0 20 20" fill="currentColor">
    <path fill-rule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h6a1 1 0 110 2H4a1 1 0 01-1-1z" clip-rule="evenodd"/>
  </svg>`,
  compact: `<svg viewBox="0 0 20 20" fill="currentColor">
    <path fill-rule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clip-rule="evenodd"/>
  </svg>`,
  mini: `<svg viewBox="0 0 20 20" fill="currentColor">
    <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"/>
  </svg>`,
};
const MODE_LABELS = { full: '通常', compact: 'コンパクト', mini: 'ミニ' };

function applyDisplayMode(mode) {
  DISPLAY_MODES.forEach(m => document.body.classList.remove(`mode-${m}`));
  document.body.classList.add(`mode-${mode}`);
  state.displayMode = mode;
  try { localStorage.setItem('ttm-displayMode', mode); } catch {}

  const btn = document.getElementById('btn-display-mode');
  if (!btn) return;
  btn.innerHTML = MODE_ICONS[mode];
  btn.title = `表示モード: ${MODE_LABELS[mode]}（クリックで切替）`;
  btn.classList.toggle('mode-active-compact', mode === 'compact');
  btn.classList.toggle('mode-active-mini',    mode === 'mini');
}

// ===== 外観モード（ダーク/ライト）自動切り替え =====
function applyColorScheme() {
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-color-scheme', isDark ? 'dark' : 'light');
  document.body.setAttribute('data-color-scheme', isDark ? 'dark' : 'light');
}

// 初期化時に外観モードを適用
applyColorScheme();

// システム外観モード変更を監視
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyColorScheme);
}

// 保存されたモードを復元（なければ 'full'）
state.displayMode = (() => {
  try { return localStorage.getItem('ttm-displayMode') || 'full'; } catch { return 'full'; }
})();
applyDisplayMode(state.displayMode);

document.getElementById('btn-display-mode').addEventListener('click', () => {
  const idx  = DISPLAY_MODES.indexOf(state.displayMode);
  const next = DISPLAY_MODES[(idx + 1) % DISPLAY_MODES.length];
  applyDisplayMode(next);
});

// ===== ユーティリティ =====
function sendMessage(type, data = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...data }, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(response);
      }
    });
  });
}

function showToast(message, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type}`;
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.classList.add('hidden');
  }, 3000);
}

function formatTime(timestamp) {
  const d = new Date(timestamp);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMs / 3600000);
  if (diffMin < 1) return 'たった今';
  if (diffMin < 60) return `${diffMin}分前`;
  if (diffHour < 24) return `${diffHour}時間前`;
  const diffDay = Math.floor(diffMs / 86400000);
  if (diffDay < 7) return `${diffDay}日前`;
  return d.toLocaleDateString('ja-JP');
}

function formatDate(timestamp) {
  const d = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return '今日';
  if (d.toDateString() === yesterday.toDateString()) return '昨日';

  const diffDay = Math.floor((today - d) / 86400000);
  if (diffDay < 7) return `${diffDay}日前`;
  return d.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' });
}

function getFaviconUrl(url) {
  try {
    const u = new URL(url);
    return `https://www.google.com/s2/favicons?sz=16&domain=${u.hostname}`;
  } catch {
    return null;
  }
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getDefaultFavicon() {
  return `<span class="tab-favicon-default">
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path d="M0 2a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H2a2 2 0 01-2-2V2zm3 1v10h10V3H3z"/>
    </svg>
  </span>`;
}

// ===== タブナビゲーション =====
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const panelId = btn.dataset.panel;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`panel-${panelId}`).classList.add('active');

    if (panelId === 'history') loadHistory();
    if (panelId === 'bookmarks') loadBookmarks();
  });
});

// ===== モーダル管理 =====
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

document.querySelectorAll('.modal-close, [data-modal]').forEach(btn => {
  btn.addEventListener('click', () => {
    closeModal(btn.dataset.modal || btn.closest('.modal').id);
  });
});

document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal(modal.id);
  });
});

// ===== コンテキストメニュー =====
const contextMenu = document.getElementById('context-menu');
const contextMenuItems = document.getElementById('context-menu-items');

function showContextMenu(x, y, items) {
  contextMenuItems.innerHTML = '';
  items.forEach(item => {
    if (item.separator) {
      const li = document.createElement('li');
      li.className = 'context-menu-separator';
      contextMenuItems.appendChild(li);
      return;
    }
    const li = document.createElement('li');
    li.className = `context-menu-item ${item.danger ? 'danger' : ''}`;
    li.innerHTML = `${item.icon || ''}<span>${escapeHtml(item.label)}</span>`;
    li.addEventListener('click', () => {
      hideContextMenu();
      item.action();
    });
    contextMenuItems.appendChild(li);
  });

  contextMenu.classList.remove('hidden');

  // 画面外にはみ出さないよう調整
  const rect = contextMenu.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = x;
  let top = y;

  if (left + rect.width > vw) left = vw - rect.width - 8;
  if (top + rect.height > vh) top = vh - rect.height - 8;

  contextMenu.style.left = `${Math.max(8, left)}px`;
  contextMenu.style.top = `${Math.max(8, top)}px`;
}

function hideContextMenu() {
  contextMenu.classList.add('hidden');
}

document.addEventListener('click', hideContextMenu);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideContextMenu();
    if (state.selectingParentFor != null) {
      cancelParentSelection();
      showToast('キャンセルしました');
    }
  }
});

// ===== タブパネル =====

// 子・孫の総件数を再帰的にカウント
function countDescendants(tab) {
  return (tab.children || []).reduce((n, c) => n + 1 + countDescendants(c), 0);
}

// ツリー構造を構築
function buildTabTree(tabs, parents) {
  const tabMap = {};
  tabs.forEach(tab => {
    tabMap[tab.id] = { ...tab, children: [] };
  });

  const roots = [];
  const pinnedRoots = [];

  tabs.forEach(tab => {
    const parentId = parents[tab.id];
    const parentTab = parentId ? tabMap[parentId] : null;

    if (parentTab && parentTab.pinned === tab.pinned) {
      // 同じピン状態の親がいる場合のみ親子関係を反映
      parentTab.children.push(tabMap[tab.id]);
    } else if (tab.pinned) {
      pinnedRoots.push(tabMap[tab.id]);
    } else {
      roots.push(tabMap[tab.id]);
    }
  });

  return { roots, pinnedRoots };
}

// タブツリーを描画
function renderTabTree() {
  const container = document.getElementById('tab-tree');
  const { roots, pinnedRoots } = buildTabTree(state.tabs, state.tabParents);

  // 固定タブ合計（子孫含む）
  const pinnedTotal = pinnedRoots.reduce((n, t) => n + 1 + countDescendants(t), 0);

  // 固定タブ件数ラベルを更新
  const pinnedCountEl = document.getElementById('pinned-count-label');
  if (pinnedCountEl) pinnedCountEl.textContent = String(pinnedTotal);

  // 固定タブトグルボタンのスタイル更新
  const togglePinnedBtn = document.getElementById('btn-toggle-pinned');
  if (togglePinnedBtn) {
    togglePinnedBtn.classList.toggle('pinned-hidden', !state.showPinnedTabs);
    togglePinnedBtn.title = state.showPinnedTabs
      ? `固定タブを非表示 (${pinnedTotal}件)`
      : `固定タブを表示 (${pinnedTotal}件)`;
  }

  container.innerHTML = '';

  // 固定タブセクション（ツリー形式）
  if (pinnedRoots.length > 0 && state.showPinnedTabs) {
    const pinnedSection = document.createElement('div');
    pinnedSection.className = 'pinned-section';
    const label = document.createElement('div');
    label.className = 'section-label';
    label.textContent = `📌 固定タブ (${pinnedTotal})`;
    pinnedSection.appendChild(label);
    pinnedRoots.forEach(tab => {
      renderTabNode(pinnedSection, tab, 0);
    });
    container.appendChild(pinnedSection);
  }

  // 通常タブ（ツリー）
  if (roots.length > 0) {
    const treeSection = document.createElement('div');
    roots.forEach(tab => {
      renderTabNode(treeSection, tab, 0);
    });
    container.appendChild(treeSection);
  }

  if (pinnedTotal === 0 && roots.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 3H4v10c0 2.21 1.79 4 4 4h6c2.21 0 4-1.79 4-4v-3h2c1.11 0 2-.89 2-2V5c0-1.11-.89-2-2-2zm0 5h-2V5h2v3z"/></svg>
      <p>タブが見つかりません</p>
    </div>`;
  }
}

function renderTabNode(container, tab, depth) {
  const nodeEl = document.createElement('div');
  nodeEl.className = 'tab-node';
  nodeEl.dataset.tabId = tab.id;

  const hasChildren = tab.children && tab.children.length > 0;
  const isCollapsed = state.collapseState[tab.id] || false;

  nodeEl.appendChild(createTabElement(tab, depth, hasChildren, isCollapsed));

  // 子ノード
  if (hasChildren) {
    const childrenEl = document.createElement('div');
    childrenEl.className = `tab-children ${isCollapsed ? 'collapsed' : ''}`;
    childrenEl.dataset.parentId = tab.id;

    tab.children.forEach(child => {
      renderTabNode(childrenEl, child, depth + 1);
    });
    nodeEl.appendChild(childrenEl);
  }

  container.appendChild(nodeEl);
}

function createTabElement(tab, depth, hasChildren = false, isCollapsed = false) {
  const item = document.createElement('div');
  item.className = `tab-item${tab.id === state.activeTabId ? ' active-tab' : ''}${tab.pinned ? ' pinned-tab' : ''}`;
  item.dataset.tabId = tab.id;
  item.draggable = true;

  const indentPx = depth * 16 + 4;
  const faviconUrl = tab.favIconUrl || getFaviconUrl(tab.url);

  // 固定タブではピンボタンを非表示（右クリックメニューで操作可能）
  const showPinBtn = !tab.pinned;

  item.innerHTML = `
    <div class="tab-indent" style="width:${indentPx}px"></div>
    <div class="tab-toggle ${hasChildren ? (isCollapsed ? 'collapsed' : '') : 'no-children'}">
      <svg viewBox="0 0 10 10" fill="currentColor">
        <path d="M2 3l3 4 3-4H2z"/>
      </svg>
    </div>
    ${faviconUrl
      ? `<img class="tab-favicon" src="${escapeHtml(faviconUrl)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" alt="">`
      : ''
    }
    ${!faviconUrl ? getDefaultFavicon() : `<span class="tab-favicon-default" style="display:none">${getDefaultFavicon()}</span>`}
    ${tab.pinned ? '<svg class="tab-pin-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M7 5A3 3 0 0 1 13 5A3 3 0 0 1 7 5ZM9 8H11V14H9ZM9 14L10 17L11 14Z"/></svg>' : ''}
    <div class="tab-info">
      <div class="tab-title" title="${escapeHtml(getTabDisplayName(tab))}">${escapeHtml(getTabDisplayName(tab))}</div>
      ${!tab.pinned ? `<div class="tab-url" title="${escapeHtml(tab.url)}">${escapeHtml(tab.url)}</div>` : ''}
    </div>
    ${hasChildren ? (() => {
      const total = countDescendants(tab);
      return `<span class="desc-badge" title="${total}件の子孫タブ">${total}</span>`;
    })() : ''}
    <div class="tab-actions">
      ${showPinBtn ? `<button class="tab-action-btn" data-action="pin" title="固定">
        <svg viewBox="0 0 20 20" fill="currentColor">
          <path d="M7 5A3 3 0 0 1 13 5A3 3 0 0 1 7 5ZM9 8H11V14H9ZM9 14L10 17L11 14Z"/>
        </svg>
      </button>` : ''}
      ${hasChildren ? (() => {
        const total = countDescendants(tab);
        return `<button class="tab-action-btn close-tree-btn" data-action="close-tree" title="このタブと子タブをすべて閉じる（${total + 1}個）">
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/>
          </svg>
        </button>`;
      })() : ''}
      <button class="tab-action-btn close-btn" data-action="close" title="閉じる">
        <svg viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
        </svg>
      </button>
    </div>
  `;

  // アクティブタブにスクロール
  if (tab.id === state.activeTabId) {
    setTimeout(() => item.scrollIntoView({ block: 'nearest' }), 100);
  }

  // クリックでタブをアクティブ化（親選択モード中は親を設定）
  item.addEventListener('click', (e) => {
    if (e.target.closest('.tab-toggle') || e.target.closest('.tab-action-btn')) return;

    // 親選択モード中：クリックされたタブを親に設定
    if (state.selectingParentFor != null) {
      const childTabId = state.selectingParentFor;
      if (tab.id === childTabId) {
        // 自分自身はキャンセル扱い
        cancelParentSelection();
        showToast('キャンセルしました');
        return;
      }
      cancelParentSelection();
      sendMessage('SET_TAB_PARENT', { tabId: childTabId, parentId: tab.id })
        .then(() => refreshTabTree())
        .then(() => showToast('親タブを設定しました', 'success'));
      return;
    }

    activateTab(tab.id, tab.windowId);
  });

  // 折りたたみトグル
  const toggle = item.querySelector('.tab-toggle');
  if (toggle && hasChildren) {
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleTabCollapse(tab.id);
    });
  }

  // アクションボタン
  const pinBtn = item.querySelector('[data-action="pin"]');
  if (pinBtn) {
    pinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleTabPin(tab.id, !tab.pinned);
    });
  }

  const closeBtn = item.querySelector('[data-action="close"]');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });
  }

  const closeTreeBtn = item.querySelector('[data-action="close-tree"]');
  if (closeTreeBtn) {
    closeTreeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTabWithChildren(tab.id);
    });
  }

  // 右クリックコンテキストメニュー
  item.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showTabContextMenu(e.clientX, e.clientY, tab);
  });

  // ドラッグ&ドロップ
  setupDragAndDrop(item, tab);

  return item;
}

function showTabContextMenu(x, y, tab) {
  // 親タブ（子タブがある）かどうか
  const hasChildren = tab.children && tab.children.length > 0;

  const menuItems = [
    {
      label: tab.pinned ? '固定を解除' : 'タブを固定',
      icon: `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M7 5A3 3 0 0 1 13 5A3 3 0 0 1 7 5ZM9 8H11V14H9ZM9 14L10 17L11 14Z"/></svg>`,
      action: () => toggleTabPin(tab.id, !tab.pinned)
    },
    {
      label: '子タブとして新しいタブを開く',
      icon: `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd"/></svg>`,
      action: () => createChildTab(tab.id)
    }
  ];

  // これより下のタブを子タブにする（非固定タブで、下にタブがある場合）
  if (!tab.pinned) {
    const belowTabs = state.tabs.filter(t => !t.pinned && t.index > tab.index);
    if (belowTabs.length > 0) {
      menuItems.push({
        label: `これより下のタブを子タブにする (${belowTabs.length}個)`,
        icon: `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>`,
        action: () => makeTabsBelowChildren(tab)
      });
    }
  }

  // 親タブの場合、追加メニュー
  if (hasChildren) {
    menuItems.push(
      { separator: true },
      {
        label: '子ツリーを1つ上に移動',
        icon: `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clip-rule="evenodd"/></svg>`,
        action: () => moveChildrenToParentLevel(tab.id)
      },
      {
        label: `このタブと子ツリーを削除 (${countDescendants(tab) + 1}個)`,
        danger: true,
        icon: `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>`,
        action: () => closeTabWithChildren(tab.id)
      }
    );
  } else {
    menuItems.push(
      {
        label: '親タブの子にする',
        icon: `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>`,
        action: () => moveToParent(tab.id)
      }
    );
  }

  // ドメイン集約（同じドメインのタブを子にする）
  try {
    const tabUrl = new URL(tab.url);
    const sameDomainTabs = state.tabs.filter(t => {
      try {
        return new URL(t.url).hostname === tabUrl.hostname && t.id !== tab.id && !t.pinned;
      } catch {
        return false;
      }
    });

    if (sameDomainTabs.length > 0) {
      menuItems.push(
        {
          label: `同じドメインのタブをまとめる (${sameDomainTabs.length}個)`,
          icon: `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v1h1a2 2 0 012 2v5a2 2 0 01-2 2H4a2 2 0 01-2-2v-5a2 2 0 012-2h1zm8-2v1H7V7a3 3 0 016 0z" clip-rule="evenodd"/></svg>`,
          action: () => aggregateSameDomain(tab.id, sameDomainTabs)
        }
      );
    }
  } catch {}

  // 階層移動：1つ上のツリーの子にする
  const parentTabId = state.tabParents[tab.id];
  if (parentTabId) {
    const parentTab = state.tabs.find(t => t.id === parentTabId);
    if (parentTab) {
      const grandParentId = state.tabParents[parentTabId] || null;
      menuItems.push(
        {
          label: '1つ上のツリーの子にする',
          icon: `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M3.293 9.707a1 1 0 010-1.414l6-6a1 1 0 011.414 0l6 6a1 1 0 01-1.414 1.414L11 5.414V17a1 1 0 11-2 0V5.414L4.707 9.707a1 1 0 01-1.414 0z" clip-rule="evenodd"/></svg>`,
          action: () => moveToGrandParentLevel(tab.id, grandParentId)
        }
      );
    }
  }

  menuItems.push(
    { separator: true },
    {
      label: '名前を編集',
      icon: `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>`,
      action: () => editTabName(tab)
    },
    {
      label: 'URLをコピー',
      icon: `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M8 2a1 1 0 000 2h2a1 1 0 100-2H8z"/><path d="M3 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v6h-4.586l1.293-1.293a1 1 0 00-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L10.414 13H15v3a2 2 0 01-2 2H5a2 2 0 01-2-2V5z"/></svg>`,
      action: () => {
        navigator.clipboard.writeText(tab.url).then(() => showToast('URLをコピーしました', 'success'));
      }
    },
    { separator: true },
    {
      label: hasChildren ? 'このタブを閉じる' : 'タブを閉じる',
      danger: true,
      icon: `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>`,
      action: () => closeTab(tab.id)
    }
  );

  showContextMenu(x, y, menuItems);
}

// これより下（index順）の非固定タブをすべて自分の子タブにする
async function makeTabsBelowChildren(tab) {
  const belowTabs = state.tabs.filter(t => !t.pinned && t.index > tab.index);
  if (belowTabs.length === 0) {
    showToast('このタブより下にタブがありません', 'error');
    return;
  }
  for (const t of belowTabs) {
    await sendMessage('SET_TAB_PARENT', { tabId: t.id, parentId: tab.id });
  }
  showToast(`${belowTabs.length}個のタブを子タブにしました`, 'success');
  await refreshTabTree();
}

// 親タブの子をすべて1つ上のレベルに移動
async function moveChildrenToParentLevel(tabId) {
  // state.tabParents を直接使って直接の子タブを収集（state.tabs は .children を持たないフラット配列）
  const children = state.tabs.filter(t => state.tabParents[t.id] === tabId);
  if (children.length === 0) {
    showToast('子タブがありません', 'error');
    return;
  }

  const parentId = state.tabParents[tabId] || null;
  for (const child of children) {
    await sendMessage('SET_TAB_PARENT', { tabId: child.id, parentId });
  }
  showToast('子タブを移動しました', 'success');
  await refreshTabTree();
}

// 親タブとその子タブをすべて削除
async function closeTabWithChildren(tabId) {
  // state.tabParents を使って全子孫IDを収集（state.tabs は .children を持たないフラット配列のため）
  const descendantIds = [];
  function collectDescendants(pid) {
    state.tabs.forEach(t => {
      if (state.tabParents[t.id] === pid) {
        descendantIds.push(t.id);
        collectDescendants(t.id);
      }
    });
  }
  collectDescendants(tabId);

  // IDを先にすべて確定してから閉じる（閉じる途中で state.tabs が変わっても影響しないように）
  for (const id of descendantIds) {
    await closeTab(id);
  }
  await closeTab(tabId);
}

// タブのすべての子孫を取得（配列形式）— ツリー構造オブジェクトが手元にある場合に使用
function getAllDescendants(tab) {
  let result = [];
  if (tab.children && tab.children.length > 0) {
    tab.children.forEach(child => {
      result.push(child);
      result = result.concat(getAllDescendants(child));
    });
  }
  return result;
}

// 親タブの子にする — 親選択モードを開始
function moveToParent(tabId) {
  // 選択対象を state に記録
  state.selectingParentFor = tabId;

  // 自分自身の行をハイライト
  document.querySelectorAll('.tab-item').forEach(el => el.classList.remove('selecting-parent'));
  const self = document.querySelector(`.tab-item[data-tab-id="${tabId}"]`);
  if (self) self.classList.add('selecting-parent');

  showToast('親にしたいタブをクリック（Escでキャンセル）');
}

// 親選択モードをキャンセル
function cancelParentSelection() {
  state.selectingParentFor = null;
  document.querySelectorAll('.tab-item').forEach(el => el.classList.remove('selecting-parent'));
}

// ===== 新規操作機能 =====

// 同じドメインのタブをまとめる
async function aggregateSameDomain(parentTabId, sameDomainTabs) {
  for (const tab of sameDomainTabs) {
    await sendMessage('SET_TAB_PARENT', { tabId: tab.id, parentId: parentTabId });
  }
  showToast(`${sameDomainTabs.length}個のタブを子にしました`, 'success');
  await refreshTabTree();
}

// 1つ上のツリーレベルの子にする
async function moveToGrandParentLevel(tabId, grandParentId) {
  try {
    await sendMessage('SET_TAB_PARENT', { tabId, parentId: grandParentId });
    showToast('タブを1つ上のレベルに移動しました', 'success');
    await refreshTabTree();
  } catch (err) {
    console.error('Failed to move tab:', err);
    showToast('移動に失敗しました', 'error');
  }
}

// ===== タブ名カスタム編集 =====

// タブ名を編集
async function editTabName(tab) {
  const currentName = state.customTabNames[tab.id] || tab.title;
  const newName = prompt(`タブ名を編集:\n\n現在: ${currentName}\n\n※ 空白で削除`, currentName);

  if (newName === null) return; // キャンセル

  if (newName.trim() === '') {
    // 名前をリセット
    delete state.customTabNames[tab.id];
    delete state.tabCustomNamesByUrl[tab.url];
    try {
      localStorage.removeItem(`ttm-custom-name-${tab.id}`);
      localStorage.removeItem(`ttm-custom-name-url-${tab.url}`);
    } catch {}
    showToast('タブ名をリセットしました', 'success');
  } else {
    // 新しい名前を設定
    state.customTabNames[tab.id] = newName.trim();
    state.tabCustomNamesByUrl[tab.url] = newName.trim();
    try {
      localStorage.setItem(`ttm-custom-name-${tab.id}`, newName.trim());
      localStorage.setItem(`ttm-custom-name-url-${tab.url}`, newName.trim());
    } catch {}
    showToast('タブ名を更新しました', 'success');
  }

  renderTabTree();
}

// カスタム名を取得（存在すれば返す）
function getTabDisplayName(tab) {
  // 1. tabIdで保存されたカスタム名
  if (state.customTabNames[tab.id]) {
    return state.customTabNames[tab.id];
  }
  // 2. URLで保存されたカスタム名
  if (state.tabCustomNamesByUrl[tab.url]) {
    return state.tabCustomNamesByUrl[tab.url];
  }
  // 3. デフォルトタイトル
  return tab.title || '(タイトルなし)';
}

// タブ操作
async function activateTab(tabId, windowId) {
  try {
    // 最近開いた時刻を記録（最近開いた順ソート用）
    state.tabActivationTime[tabId] = Date.now();
    try { localStorage.setItem(`ttm-tab-activation-${tabId}`, state.tabActivationTime[tabId]); } catch {}

    await sendMessage('ACTIVATE_TAB', { tabId, windowId });
  } catch (e) {
    console.error('Failed to activate tab:', e);
  }
}

async function closeTab(tabId) {
  try {
    await sendMessage('CLOSE_TAB', { tabId });
  } catch (e) {
    console.error('Failed to close tab:', e);
  }
}

async function toggleTabPin(tabId, pinned) {
  try {
    await sendMessage('PIN_TAB', { tabId, pinned });
    showToast(pinned ? 'タブを固定しました' : '固定を解除しました', 'success');
    await refreshTabTree();
  } catch (e) {
    console.error('Failed to pin tab:', e);
  }
}

function toggleTabCollapse(tabId) {
  state.collapseState[tabId] = !state.collapseState[tabId];
  const nodeEl = document.querySelector(`.tab-node[data-tab-id="${tabId}"]`);
  if (!nodeEl) return;

  const toggle = nodeEl.querySelector('.tab-toggle');
  const childrenEl = nodeEl.querySelector('.tab-children');
  const isCollapsed = state.collapseState[tabId];

  if (toggle) {
    toggle.classList.toggle('collapsed', isCollapsed);
  }
  if (childrenEl) {
    childrenEl.classList.toggle('collapsed', isCollapsed);
  }

  // バックグラウンドに通知
  sendMessage('SET_TAB_COLLAPSED', { tabId, collapsed: isCollapsed });
}

function collapseAll() {
  state.tabs.forEach(tab => {
    state.collapseState[tab.id] = true;
  });
  renderTabTree();
}

function expandAll() {
  state.collapseState = {};
  renderTabTree();
}

async function createChildTab(parentTabId) {
  try {
    await sendMessage('NEW_TAB', { openerTabId: parentTabId });
    await refreshTabTree();
  } catch (e) {
    console.error('Failed to create child tab:', e);
  }
}

// ===== ドラッグ&ドロップ =====
let dragTabId = null;

function setupDragAndDrop(item, tab) {
  item.addEventListener('dragstart', (e) => {
    dragTabId = tab.id;
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(tab.id));
  });

  item.addEventListener('dragend', () => {
    dragTabId = null;
    item.classList.remove('dragging');
    document.querySelectorAll('.tab-item').forEach(el => {
      el.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-inside');
    });
  });

  item.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (dragTabId === tab.id) return;
    const rect = item.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;

    item.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-inside');

    if (y < h * 0.25) {
      item.classList.add('drag-over-above');
      e.dataTransfer.dropEffect = 'move';
    } else if (y > h * 0.75) {
      item.classList.add('drag-over-below');
      e.dataTransfer.dropEffect = 'move';
    } else {
      item.classList.add('drag-over-inside');
      e.dataTransfer.dropEffect = 'move';
    }
  });

  item.addEventListener('dragleave', () => {
    item.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-inside');
  });

  item.addEventListener('drop', async (e) => {
    e.preventDefault();
    item.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-inside');
    if (!dragTabId || dragTabId === tab.id) return;

    const rect = item.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;

    const draggedTab = state.tabs.find(t => t.id === dragTabId);
    if (!draggedTab) return;

    // 固定タブ↔非固定タブ間のドロップは無効
    if (draggedTab.pinned !== tab.pinned) return;

    try {
      if (y >= h * 0.25 && y <= h * 0.75) {
        // ドロップ先の子タブにする
        await sendMessage('SET_TAB_PARENT', { tabId: dragTabId, parentId: tab.id });
      } else {
        // ドロップ先と同じ親にする
        const parentId = state.tabParents[tab.id] || null;
        await sendMessage('SET_TAB_PARENT', { tabId: dragTabId, parentId });

        // 同じ親の場合、タブ位置も同期
        if (draggedTab.windowId === tab.windowId) {
          const targetIndex = y < h * 0.25 ? tab.index : tab.index + 1;
          await chrome.tabs.move(dragTabId, { index: targetIndex });
        }
      }
      await refreshTabTree();
    } catch (err) {
      console.error('Failed to reorder tab:', err);
      showToast('タブの移動に失敗しました', 'error');
    }
  });
}

// ===== タブデータ読み込み =====
async function loadTabs() {
  const [tabs, currentTab] = await Promise.all([
    chrome.tabs.query({ currentWindow: true }),
    chrome.tabs.query({ active: true, currentWindow: true })
  ]);

  state.tabs = tabs.sort((a, b) => a.index - b.index);
  state.activeTabId = currentTab[0]?.id || null;
  state.currentWindowId = tabs[0]?.windowId || null;

  // 最近開いた時刻を復元
  tabs.forEach(tab => {
    try {
      const stored = localStorage.getItem(`ttm-tab-activation-${tab.id}`);
      if (stored) state.tabActivationTime[tab.id] = parseInt(stored, 10);
    } catch {}
  });

  // カスタム名を復元（tabId経由）
  tabs.forEach(tab => {
    try {
      const customName = localStorage.getItem(`ttm-custom-name-${tab.id}`);
      if (customName) state.customTabNames[tab.id] = customName;
    } catch {}
  });

  // カスタム名を復元（URL経由：同じURLの再訪時用）
  tabs.forEach(tab => {
    try {
      const customNameByUrl = localStorage.getItem(`ttm-custom-name-url-${tab.url}`);
      if (customNameByUrl) {
        state.tabCustomNamesByUrl[tab.url] = customNameByUrl;
        // tabIdがない場合、URLから設定
        if (!state.customTabNames[tab.id]) {
          state.customTabNames[tab.id] = customNameByUrl;
        }
      }
    } catch {}
  });

  // グループ情報を取得
  try {
    const groups = await chrome.tabGroups.query({ windowId: state.currentWindowId });
    state.tabGroupMap = {};
    groups.forEach(group => {
      // グループ内のタブを取得して紐づける
      chrome.tabs.query({ groupId: group.id }).then(groupTabs => {
        groupTabs.forEach(t => {
          state.tabGroupMap[t.id] = group.id;
        });
      });
    });
  } catch {
    state.tabGroupMap = {};
  }

  try {
    const resp = await sendMessage('GET_TAB_PARENTS');
    state.tabParents = resp?.parents || {};
  } catch {
    state.tabParents = {};
  }

  renderTabTree();
}

async function refreshTabTree() {
  await loadTabs();
}

// ===== ツールバーボタン =====
document.getElementById('btn-new-tab').addEventListener('click', () => {
  sendMessage('NEW_TAB', {});
});

document.getElementById('btn-collapse-all').addEventListener('click', collapseAll);
document.getElementById('btn-expand-all').addEventListener('click', expandAll);

document.getElementById('btn-toggle-pinned').addEventListener('click', () => {
  state.showPinnedTabs = !state.showPinnedTabs;
  renderTabTree();
  const msg = state.showPinnedTabs ? '固定タブを表示しました' : '固定タブを非表示にしました';
  showToast(msg);
});

document.getElementById('btn-save-session').addEventListener('click', () => {
  const input = document.getElementById('session-name-input');
  input.value = `セッション ${new Date().toLocaleString('ja-JP')}`;
  openModal('modal-save-session');
  setTimeout(() => input.focus(), 100);
});

document.getElementById('btn-confirm-save').addEventListener('click', async () => {
  const name = document.getElementById('session-name-input').value.trim();
  try {
    await sendMessage('SAVE_SESSION', { name: name || undefined });
    closeModal('modal-save-session');
    showToast('セッションを保存しました', 'success');
  } catch (e) {
    showToast('保存に失敗しました', 'error');
  }
});

document.getElementById('btn-load-session').addEventListener('click', async () => {
  openModal('modal-load-session');
  await loadSessionList();
});

async function loadSessionList() {
  const list = document.getElementById('session-list');
  list.innerHTML = '<div class="loading">読み込み中...</div>';

  try {
    const resp = await sendMessage('LOAD_SESSIONS');
    const sessions = resp?.sessions || [];

    if (sessions.length === 0) {
      list.innerHTML = '<div class="no-sessions">保存されたセッションがありません</div>';
      return;
    }

    list.innerHTML = '';
    sessions.forEach(session => {
      const item = document.createElement('div');
      item.className = 'session-item';
      item.innerHTML = `
        <div class="session-icon">
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z"/>
            <path fill-rule="evenodd" d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z" clip-rule="evenodd"/>
          </svg>
        </div>
        <div class="session-info">
          <div class="session-name">${escapeHtml(session.name)}</div>
          <div class="session-meta">${session.tabs.length}タブ・${formatTime(session.createdAt)}</div>
        </div>
        <button class="session-delete" data-id="${session.id}" title="削除">
          <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
        </button>
      `;

      item.addEventListener('click', async (e) => {
        if (e.target.closest('.session-delete')) return;
        try {
          await sendMessage('RESTORE_SESSION', { sessionId: session.id });
          closeModal('modal-load-session');
          showToast('セッションを復元しました', 'success');
        } catch {
          showToast('復元に失敗しました', 'error');
        }
      });

      item.querySelector('.session-delete').addEventListener('click', async (e) => {
        e.stopPropagation();
        await sendMessage('DELETE_SESSION', { sessionId: session.id });
        await loadSessionList();
        showToast('セッションを削除しました');
      });

      list.appendChild(item);
    });
  } catch (e) {
    list.innerHTML = '<div class="no-sessions">読み込みに失敗しました</div>';
  }
}

// ===== 履歴パネル =====
let historySearchTimeout = null;

async function loadHistory(query = '') {
  const container = document.getElementById('history-list');
  container.innerHTML = '<div class="loading">読み込み中...</div>';

  try {
    const resp = await sendMessage('GET_HISTORY', {
      query,
      maxResults: 200,
      startTime: Date.now() - 30 * 24 * 60 * 60 * 1000
    });

    const items = resp?.history || [];
    state.historyItems = items;
    renderHistory(items, query);
  } catch (e) {
    container.innerHTML = '<div class="empty-state"><p>履歴の読み込みに失敗しました</p></div>';
  }
}

function renderHistory(items, query = '') {
  const container = document.getElementById('history-list');

  if (items.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM12.75 6a.75.75 0 00-1.5 0v6c0 .414.336.75.75.75h4.5a.75.75 0 000-1.5h-3.75V6z" clip-rule="evenodd"/></svg>
      <p>履歴が見つかりません</p>
    </div>`;
    return;
  }

  // 日付でグループ化
  const groups = {};
  items.forEach(item => {
    const dateKey = formatDate(item.lastVisitTime);
    if (!groups[dateKey]) groups[dateKey] = [];
    groups[dateKey].push(item);
  });

  container.innerHTML = '';
  Object.entries(groups).forEach(([date, dateItems]) => {
    const groupEl = document.createElement('div');
    groupEl.className = 'history-group';

    const dateEl = document.createElement('div');
    dateEl.className = 'history-date';
    dateEl.textContent = date;
    groupEl.appendChild(dateEl);

    dateItems.forEach(item => {
      const el = document.createElement('div');
      el.className = 'history-item';
      const faviconUrl = getFaviconUrl(item.url);
      const title = highlightText(item.title || item.url, query);
      const url = highlightText(item.url, query);

      el.innerHTML = `
        ${faviconUrl
          ? `<img class="history-favicon" src="${escapeHtml(faviconUrl)}" onerror="this.style.display='none'" alt="">`
          : `<svg class="history-favicon" viewBox="0 0 16 16" fill="currentColor" style="color:var(--text-muted)"><path d="M0 2a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H2a2 2 0 01-2-2V2zm3 1v10h10V3H3z"/></svg>`
        }
        <div class="history-info">
          <div class="history-title">${title}</div>
          <div class="history-url">${url}</div>
        </div>
        <div class="history-time">${formatTime(item.lastVisitTime)}</div>
        <button class="history-remove" title="削除">
          <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
        </button>
      `;

      el.addEventListener('click', (e) => {
        if (e.target.closest('.history-remove')) return;
        chrome.tabs.create({ url: item.url });
        // 最近使用したブックマーク更新
        updateRecentlyUsed(item.url);
      });

      el.querySelector('.history-remove').addEventListener('click', async (e) => {
        e.stopPropagation();
        await chrome.history.deleteUrl({ url: item.url });
        el.remove();
        showToast('履歴から削除しました');
      });

      groupEl.appendChild(el);
    });

    container.appendChild(groupEl);
  });
}

function highlightText(text, query) {
  if (!query || !text) return escapeHtml(text || '');
  const escaped = escapeHtml(text);
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(new RegExp(escapedQuery, 'gi'), (match) =>
    `<mark class="highlight">${match}</mark>`
  );
}

document.getElementById('history-search').addEventListener('input', (e) => {
  clearTimeout(historySearchTimeout);
  historySearchTimeout = setTimeout(() => {
    loadHistory(e.target.value.trim());
  }, 300);
});

// ===== ブックマークパネル =====
let bookmarkSearchTimeout = null;

async function loadBookmarks() {
  const container = document.getElementById('bookmark-list');
  if (state.bookmarkTree) {
    renderBookmarks();
    return;
  }

  container.innerHTML = '<div class="loading">読み込み中...</div>';

  try {
    const [tree, recentHistory] = await Promise.all([
      chrome.bookmarks.getTree(),
      chrome.history.search({ text: '', maxResults: 500, startTime: Date.now() - 90 * 24 * 60 * 60 * 1000 })
    ]);

    state.bookmarkTree = tree;

    // 最近使用したブックマーク・訪問回数を構築
    recentHistory.forEach(item => {
      if (!state.recentlyUsedBookmarks[item.url] || state.recentlyUsedBookmarks[item.url] < item.lastVisitTime) {
        state.recentlyUsedBookmarks[item.url] = item.lastVisitTime;
      }
      state.visitCountMap[item.url] = item.visitCount || 0;
    });

    // フラットリストを作成
    state.bookmarkFlatList = flattenBookmarks(tree);

    renderBookmarks();
  } catch (e) {
    container.innerHTML = '<div class="empty-state"><p>ブックマークの読み込みに失敗しました</p></div>';
  }
}

function flattenBookmarks(nodes, folderPath = '') {
  const result = [];
  nodes.forEach(node => {
    if (node.url) {
      result.push({ ...node, folderPath });
    } else if (node.children) {
      const path = folderPath ? `${folderPath} / ${node.title}` : (node.title || '');
      result.push(...flattenBookmarks(node.children, path));
    }
  });
  return result;
}

function updateRecentlyUsed(url) {
  state.recentlyUsedBookmarks[url] = Date.now();
}

function renderBookmarks() {
  const container = document.getElementById('bookmark-list');
  const query = state.bookmarkQuery;

  if (!state.bookmarkTree) return;

  if (state.bookmarkSortMode === 'tree' && !query) {
    renderBookmarkTree(container, state.bookmarkTree);
    return;
  }

  // フラットリストをフィルタ
  let items = state.bookmarkFlatList;
  if (query) {
    const q = query.toLowerCase();
    items = items.filter(item =>
      (item.title || '').toLowerCase().includes(q) ||
      (item.url || '').toLowerCase().includes(q)
    );
  }

  // ソート
  if (state.bookmarkSortMode === 'recent-used') {
    items = [...items].sort((a, b) => {
      const ta = state.recentlyUsedBookmarks[a.url] || 0;
      const tb = state.recentlyUsedBookmarks[b.url] || 0;
      return tb - ta;
    });
  } else if (state.bookmarkSortMode === 'recent-added') {
    items = [...items].sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
  } else if (state.bookmarkSortMode === 'most-visited') {
    items = [...items].sort((a, b) => {
      const ca = state.visitCountMap[a.url] || 0;
      const cb = state.visitCountMap[b.url] || 0;
      return cb - ca;
    });
  }

  if (items.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v14l-5-2.5L5 18V4z"/></svg>
      <p>ブックマークが見つかりません</p>
    </div>`;
    return;
  }

  container.innerHTML = '';
  items.forEach(item => {
    const el = createBookmarkItem(item, query);
    container.appendChild(el);
  });
}

function createBookmarkItem(item, query = '') {
  const el = document.createElement('div');
  el.className = 'bookmark-item';
  const faviconUrl = getFaviconUrl(item.url);
  const title = highlightText(item.title || item.url, query);
  let dateStr = '';
  if (state.bookmarkSortMode === 'most-visited') {
    const count = state.visitCountMap[item.url] || 0;
    dateStr = count > 0 ? `${count.toLocaleString()}回` : '';
  } else {
    const usedTime = state.recentlyUsedBookmarks[item.url];
    dateStr = usedTime ? formatTime(usedTime) : (item.dateAdded ? formatTime(item.dateAdded) : '');
  }

  el.innerHTML = `
    ${faviconUrl
      ? `<img class="bookmark-favicon" src="${escapeHtml(faviconUrl)}" onerror="this.style.display='none'" alt="">`
      : `<svg class="bookmark-favicon" viewBox="0 0 16 16" fill="currentColor" style="color:var(--text-muted)"><path d="M0 2a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H2a2 2 0 01-2-2V2zm3 1v10h10V3H3z"/></svg>`
    }
    <div class="bookmark-info">
      <div class="bookmark-title">${title}</div>
      <div class="bookmark-url">${escapeHtml(item.url)}</div>
    </div>
    ${dateStr ? `<div class="bookmark-date">${escapeHtml(dateStr)}</div>` : ''}
  `;

  el.addEventListener('click', () => {
    chrome.tabs.create({ url: item.url });
    updateRecentlyUsed(item.url);
  });

  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, [
      {
        label: '新しいタブで開く',
        icon: `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z"/></svg>`,
        action: () => chrome.tabs.create({ url: item.url })
      },
      {
        label: 'URLをコピー',
        icon: `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M8 2a1 1 0 000 2h2a1 1 0 100-2H8z"/></svg>`,
        action: () => {
          navigator.clipboard.writeText(item.url).then(() => showToast('URLをコピーしました', 'success'));
        }
      }
    ]);
  });

  return el;
}

function renderBookmarkTree(container, nodes) {
  container.innerHTML = '';

  function renderNodes(parentEl, nodeList, depth = 0) {
    nodeList.forEach(node => {
      if (node.url) {
        const el = createBookmarkItem(node);
        el.style.paddingLeft = `${depth * 12 + 8}px`;
        parentEl.appendChild(el);
      } else if (node.children && node.children.length > 0 && node.title !== undefined) {
        const folderEl = document.createElement('div');
        folderEl.className = `bookmark-folder ${state.bookmarkFolderState[node.id] ? 'collapsed' : ''}`;

        const header = document.createElement('div');
        header.className = 'bookmark-folder-header';
        header.style.paddingLeft = `${depth * 12 + 4}px`;
        header.innerHTML = `
          <div class="bookmark-folder-toggle">
            <svg viewBox="0 0 10 10" fill="currentColor">
              <path d="M2 3l3 4 3-4H2z"/>
            </svg>
          </div>
          <svg class="bookmark-folder-icon" viewBox="0 0 20 20" fill="currentColor">
            <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/>
          </svg>
          <span class="bookmark-folder-name">${escapeHtml(node.title || 'フォルダ')}</span>
          <span class="bookmark-folder-count">${countBookmarks(node.children)}</span>
        `;
        header.addEventListener('click', () => {
          state.bookmarkFolderState[node.id] = !state.bookmarkFolderState[node.id];
          folderEl.classList.toggle('collapsed', state.bookmarkFolderState[node.id]);
        });
        folderEl.appendChild(header);

        const childrenEl = document.createElement('div');
        childrenEl.className = 'bookmark-folder-children';
        renderNodes(childrenEl, node.children, depth + 1);
        folderEl.appendChild(childrenEl);

        parentEl.appendChild(folderEl);
      }
    });
  }

  // ルートノードの children（実際のブックマークバーやその他）を展開
  nodes.forEach(root => {
    if (root.children) renderNodes(container, root.children, 0);
  });
}

function countBookmarks(nodes) {
  let count = 0;
  nodes.forEach(n => {
    if (n.url) count++;
    else if (n.children) count += countBookmarks(n.children);
  });
  return count;
}

// ソートボタン
document.querySelectorAll('.sort-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.bookmarkSortMode = btn.dataset.sort;
    renderBookmarks();
  });
});

// ブックマーク検索
document.getElementById('bookmark-search').addEventListener('input', (e) => {
  clearTimeout(bookmarkSearchTimeout);
  state.bookmarkQuery = e.target.value.trim();
  bookmarkSearchTimeout = setTimeout(() => {
    renderBookmarks();
  }, 200);
});

// ===== バックグラウンドからのメッセージ受信 =====
chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case 'TAB_CREATED':
    case 'TAB_REMOVED':
    case 'TAB_UPDATED':
    case 'TAB_MOVED':
    case 'TREE_UPDATED':
      // タブパネルが表示中なら更新
      if (document.getElementById('panel-tabs').classList.contains('active')) {
        loadTabs();
      }
      break;

    case 'TAB_ACTIVATED':
      state.activeTabId = message.tabId;
      document.querySelectorAll('.tab-item').forEach(el => {
        el.classList.toggle('active-tab', Number(el.dataset.tabId) === message.tabId);
      });
      break;
  }
});

// ===== 初期化 =====
async function init() {
  await loadTabs();
}

init().catch(console.error);
