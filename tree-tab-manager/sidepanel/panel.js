// Tree Tab Manager - Sidepanel Script

// ===== 状態管理 =====
const state = {
  // タブパネル
  tabs: [],           // chrome.tabs の一覧
  tabParents: {},     // tabId -> parentTabId
  tabMetadata: {},    // tabId -> { collapsed }
  tabQuery: '',       // タブ検索クエリ
  collapseState: {},  // tabId -> collapsed (ローカル)
  activeTabId: null,
  currentWindowId: null,
  showPinnedTabs: true,  // 固定タブセクションの表示状態
  tabActivationTime: {},  // tabId -> lastActivationTime（最近開いた順用）
  lastSortMode: null,     // 前回のソートモードを記憶
  lastMovedTabIds: [],    // アニメーション用：最後に子になったタブ

  tabGroupMap: {},        // tabId -> groupId（グループ認識用）
  tabGroupInfo: {},       // groupId -> { id, title, color, collapsed }
  tabGroupCollapseState: {}, // groupId -> collapsed (ローカルサイドバー状態)

  googleTasks: {},        // url -> listName

  // 履歴パネル
  historyItems: [],
  historyQuery: '',
  historySortMode: 'recent', // 'recent' | 'most-visited'

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

  // ユーザー設定
  userSettings: {
    historyRecentlyClosed: false,
    bookmarkVisitCount: false,
    themeColor: 'blue',
    colorScheme: 'auto',
    sidePanelSide: 'right',
    miniTreeWidth: 90,
    focusIntensity: 'medium', // 'none', 'low', 'medium', 'high'
    closeOnSelect: false,
    tabSelectionAnimation: true,
    tabFontSize: 12,
    toggleSize: 'medium',
    shortcuts: {
      'new-tab': '',
      'toggle-pinned': '',
      'display-mode': '',
      'sort-mode': '',
      'collapse-all': '',
      'expand-all': '',
      'focus-search': '',
      'switch-tabs': '',
      'switch-history': '',
      'switch-bookmarks': '',
      'switch-settings': '',
      'display-mode': '',
    },
    interactionMode: 'sidepanel' // 'sidepanel' | 'popup'
  },
  isRecordingShortcut: false,

  // タブ管理・設定
  tabConfig: [],
  isFirstLoad: true
};

// ショートカット定義
const SHORTCUT_ACTIONS = [
  { id: 'switch-tabs', label: chrome.i18n.getMessage('actionSwitchTabs') },
  { id: 'switch-history', label: chrome.i18n.getMessage('actionSwitchHistory') },
  { id: 'switch-bookmarks', label: chrome.i18n.getMessage('actionSwitchBookmarks') },
  { id: 'switch-settings', label: chrome.i18n.getMessage('actionSwitchSettings') },
  { id: 'focus-search', label: chrome.i18n.getMessage('actionFocusSearch') },
  { id: 'display-mode', label: chrome.i18n.getMessage('actionDisplayMode') },
];

// デフォルトのタブ設定
const DEFAULT_TAB_CONFIG = [
  { id: 'tabs', label: chrome.i18n.getMessage('navTabs'), visible: true, icon: '<svg viewBox="0 0 20 20" fill="currentColor"><path d="M3 3a1 1 0 000 2h11a1 1 0 100-2H3zM3 7a1 1 0 000 2h5a1 1 0 000-2H3zM3 11a1 1 0 100 2h4a1 1 0 100-2H3zM13 16a1 1 0 102 0v-5.586l1.293 1.293a1 1 0 001.414-1.414l-3-3a1 1 0 00-1.414 0l-3 3a1 1 0 101.414 1.414L13 10.414V16z"/></svg>' },
  { id: 'history', label: chrome.i18n.getMessage('navHistory'), visible: true, icon: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd" /></svg>' },
  { id: 'bookmarks', label: chrome.i18n.getMessage('navBookmarks'), visible: true, icon: '<svg viewBox="0 0 20 20" fill="currentColor"><path d="M5 4a2 2 0 012-2h6a2 2 0 012 2v14l-5-2.5L5 18V4z"/></svg>' },
  { id: 'readingList', label: chrome.i18n.getMessage('navReadingList'), visible: true, icon: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" /></svg>' },
  { id: 'settings', label: chrome.i18n.getMessage('navSettings'), visible: true, icon: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd"/></svg>' }
];

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


async function applyDisplayMode(mode) {
  DISPLAY_MODES.forEach(m => document.body.classList.remove(`mode-${m}`));
  document.body.classList.add(`mode-${mode}`);
  state.displayMode = mode;
  try { await chrome.storage.local.set({ 'ttm-displayMode': mode }); } catch { }

  const btn = document.getElementById('btn-toggle-mini-tree') ? document.getElementById('btn-display-mode') : document.getElementById('btn-display-mode');
  if (!btn) return;
  btn.innerHTML = MODE_ICONS[mode];

  let titleStr = '';
  if (mode === 'full') titleStr = chrome.i18n.getMessage('modeTitleFull');
  else if (mode === 'compact') titleStr = chrome.i18n.getMessage('modeTitleCompact');
  else if (mode === 'mini') titleStr = chrome.i18n.getMessage('modeTitleMini');

  btn.title = titleStr;
  btn.classList.toggle('mode-active-compact', mode === 'compact');
  btn.classList.toggle('mode-active-mini', mode === 'mini');
}

// Preset palette: [accent-hex-dark, accent-hex-light, bg-primary-dark, bg-primary-light]
const THEME_PRESETS = {
  blue: { dark: '#89b4fa', light: '#0071e3', bgDark: '#1e1e2e', bgLight: '#f5f5f7' },
  green: { dark: '#a6e3a1', light: '#34c759', bgDark: '#1e2e1e', bgLight: '#f0fff4' },
  yellow: { dark: '#f9e2af', light: '#bb8000', bgDark: '#2e2a18', bgLight: '#fffbee' },
  red: { dark: '#f38ba8', light: '#cc2222', bgDark: '#2e1e20', bgLight: '#fff0f1' },
  purple: { dark: '#cba6f7', light: '#a855f7', bgDark: '#221e2e', bgLight: '#f8f0ff' },
  pink: { dark: '#f5c2e7', light: '#ff2d55', bgDark: '#2e1e28', bgLight: '#fff0f8' },
};

function hexToHsl(hex) {
  let r = parseInt(hex.slice(1, 3), 16) / 255;
  let g = parseInt(hex.slice(3, 5), 16) / 255;
  let b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

function applyThemeColor(colorOrHex) {
  state.userSettings.themeColor = colorOrHex;
  const isDark = document.body.getAttribute('data-color-scheme') !== 'light';

  let accentHex;
  if (THEME_PRESETS[colorOrHex]) {
    const p = THEME_PRESETS[colorOrHex];
    accentHex = isDark ? p.dark : p.light;
  } else {
    accentHex = colorOrHex;
  }

  const [h, s] = hexToHsl(accentHex);

  // Derive bg tones from theme hue
  // Light mode: Lower luminosity slightly and keep some saturation to make tint visible
  const bg = isDark ? [
    hslToHex(h, Math.min(s, 35), 14),
    hslToHex(h, Math.min(s, 30), 18),
    hslToHex(h, Math.min(s, 28), 22),
    hslToHex(h, Math.min(s, 25), 27),
    hslToHex(h, Math.min(s, 22), 33),
  ] : [
    hslToHex(h, Math.min(s, 25), 97), // primary (very light tint)
    hslToHex(h, Math.min(s, 22), 93), // secondary
    hslToHex(h, Math.min(s, 20), 88), // tertiary
    hslToHex(h, Math.min(s, 18), 82), // hover
    hslToHex(h, Math.min(s, 16), 75), // active
  ];

  // Apply to both html and body to ensure specificity over CSS [data-color-scheme="light"]
  [document.documentElement, document.body].forEach(el => {
    el.style.setProperty('--theme-color', accentHex);
    el.style.setProperty('--bg-primary', bg[0]);
    el.style.setProperty('--bg-secondary', bg[1]);
    el.style.setProperty('--bg-tertiary', bg[2]);
    el.style.setProperty('--bg-hover', bg[3]);
    el.style.setProperty('--bg-active', bg[4]);
  });
}

// ===== 外観モード（ダーク/ライト）自動切り替え =====
function applyColorScheme() {
  const mode = state.userSettings.colorScheme || 'auto';
  let isDark;

  if (mode === 'auto') {
    isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  } else {
    isDark = (mode === 'dark');
  }

  document.documentElement.setAttribute('data-color-scheme', isDark ? 'dark' : 'light');
  document.body.setAttribute('data-color-scheme', isDark ? 'dark' : 'light');

  if (state.userSettings.themeColor) {
    applyThemeColor(state.userSettings.themeColor);
  }
}

function applyToggleSize() {
  const size = state.userSettings.toggleSize || 'medium';
  document.body.setAttribute('data-toggle-size', size);
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
  const idx = DISPLAY_MODES.indexOf(state.displayMode);
  const next = DISPLAY_MODES[(idx + 1) % DISPLAY_MODES.length];
  applyDisplayMode(next);

  // Update select input in settings if exists
  const sel = document.getElementById('setting-display-mode');
  if (sel) sel.value = next;
});

/* btn-toggle-mini-tree deactivated
document.getElementById('btn-toggle-mini-tree').addEventListener('click', () => {
  chrome.storage.local.get('ttm-mini-tree-visible', (res) => {
    const next = !res['ttm-mini-tree-visible'];
    chrome.storage.local.set({ 'ttm-mini-tree-visible': next });
  });
});
*/

// ===== タブ並び順モード管理 =====
// 'tree'（ツリー表示）| 'recent'（最近開いた順フラット表示）

function applySortMode(mode) {
  state.tabSortMode = mode;
  try { localStorage.setItem('ttm-tabSortMode', mode); } catch { }
  const btn = document.getElementById('btn-sort-mode');
  if (!btn) return;
  btn.classList.toggle('sort-mode-active', mode === 'recent');
  btn.title = mode === 'recent'
    ? chrome.i18n.getMessage('sortRecentTooltip')
    : chrome.i18n.getMessage('sortTreeTooltip');
  // background.jsが読み込めるように同期
  chrome.storage.local.set({ 'ttm-tab-sort-mode': mode });
}

// 保存された並び順を復元（なければ 'tree'）
state.tabSortMode = (() => {
  try { return localStorage.getItem('ttm-tabSortMode') || 'tree'; } catch { return 'tree'; }
})();
applySortMode(state.tabSortMode);
chrome.storage.local.set({ 'ttm-tab-sort-mode': state.tabSortMode });

document.getElementById('btn-sort-mode').addEventListener('click', () => {
  const next = state.tabSortMode === 'tree' ? 'recent' : 'tree';
  applySortMode(next);
  renderTabTree();
});

// ===== ショートカット管理 =====
function getShortcutString(e) {
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  if (e.metaKey) parts.push('Cmd');

  // メインキー（修飾キー単体の場合は含めない）
  if (!['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
    let key = e.key;
    if (key === ' ') key = 'Space';
    if (key === 'ArrowUp') key = 'Up';
    if (key === 'ArrowDown') key = 'Down';
    if (key === 'ArrowLeft') key = 'Left';
    if (key === 'ArrowRight') key = 'Right';

    // 1文字の場合は大文字、それ以外はそのまま
    parts.push(key.length === 1 ? key.toUpperCase() : key);
  } else if (parts.length === 0) {
    // 修飾キーのみの場合は無効な文字列を返す（録画中は別）
    return '';
  }

  return parts.join('+');
}

function handleShortcutAction(actionId) {
  switch (actionId) {
    case 'switch-tabs':
      document.querySelector('[data-panel="tabs"]')?.click();
      break;
    case 'switch-history':
      document.querySelector('[data-panel="history"]')?.click();
      break;
    case 'switch-bookmarks':
      document.querySelector('[data-panel="bookmarks"]')?.click();
      break;
    case 'switch-settings':
      document.querySelector('[data-panel="settings"]')?.click();
      break;
    case 'new-tab':
      document.getElementById('btn-new-tab')?.click();
      break;
    case 'focus-search':
      const activePanel = document.querySelector('.panel.active');
      const searchInput = activePanel?.querySelector('input[type="text"]');
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
      break;
    case 'toggle-pinned':
      document.getElementById('btn-toggle-pinned')?.click();
      break;
    case 'display-mode':
      document.getElementById('btn-display-mode')?.click();
      break;
    case 'sort-mode':
      document.getElementById('btn-sort-mode')?.click();
      break;
    case 'collapse-all':
      document.getElementById('btn-collapse-all')?.click();
      break;
    case 'expand-all':
      document.getElementById('btn-expand-all')?.click();
      break;
    case 'toggle-mini-tree':
      // アクティブタブのcontent scriptへトグルを送信
      chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('about:')) return;
        chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_MINI_TREE' }).catch(() => { });
      });
      break;
  }
}

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
  if (diffMin < 1) return chrome.i18n.getMessage('timeJustNow');
  if (diffMin < 60) return chrome.i18n.getMessage('timeMinsAgo', [diffMin.toString()]);
  if (diffHour < 24) return chrome.i18n.getMessage('timeHoursAgo', [diffHour.toString()]);
  const diffDay = Math.floor(diffMs / 86400000);
  if (diffDay < 7) return chrome.i18n.getMessage('timeDaysAgo', [diffDay.toString()]);
  return d.toLocaleDateString(undefined);
}

function formatDate(timestamp) {
  const d = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return chrome.i18n.getMessage('timeToday');
  if (d.toDateString() === yesterday.toDateString()) return chrome.i18n.getMessage('timeYesterday');

  const diffDay = Math.floor((today - d) / 86400000);
  if (diffDay < 7) return chrome.i18n.getMessage('timeDaysAgo', [diffDay.toString()]);
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}

function getFaviconUrl(url) {
  if (!url) return null;
  // 全てのURL（通常のWebサイトも含む）でChrome純正のfaviconサービスを強制的に使用する。
  // これにより、claude.aiのような厳格なセキュリティ設定を持つサイトのアイコンも
  // ブラウザの内部キャッシュ経由で安全に表示できる。
  return `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`;
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

// ===== ユーザー設定管理 =====


async function loadUserSettings() {
  try {
    const data = await chrome.storage.local.get(['ttm-user-settings', 'ttm-displayMode']);
    const saved = data['ttm-user-settings'];
    if (saved) {
      const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
      state.userSettings = {
        ...state.userSettings,
        ...parsed,
        shortcuts: { ...state.userSettings.shortcuts, ...(parsed.shortcuts || {}) }
      };
      // 旧設定からの移行
      if (parsed.focusEffect === false) state.userSettings.focusIntensity = 'none';
      if (parsed.focusEffect === true && !parsed.focusIntensity) state.userSettings.focusIntensity = 'medium';
    }
    if (data['ttm-displayMode']) {
      state.displayMode = data['ttm-displayMode'];
    }
    const pinnedData = await chrome.storage.local.get(['ttm-show-pinned-tabs']);
    if (pinnedData['ttm-show-pinned-tabs'] !== undefined) {
      state.showPinnedTabs = pinnedData['ttm-show-pinned-tabs'];
    }
  } catch (e) { }
  applyColorScheme();
  // 他のコンポーネント用への同期
  chrome.storage.local.set({
    'ttm-shortcuts': state.userSettings.shortcuts || {},
    'ttm-side-panel-side': state.userSettings.sidePanelSide || 'right',
    'ttm-mini-tree-width': state.userSettings.miniTreeWidth || 90
  });
}

let saveTimeout = null;
function saveUserSettingsDebounced() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveUserSettings();
  }, 500);
}

async function saveUserSettings() {
  try {
    await chrome.storage.local.set({
      'ttm-user-settings': state.userSettings,
      'ttm-shortcuts': state.userSettings.shortcuts || {},
      'ttm-side-panel-side': state.userSettings.sidePanelSide || 'right',
      'ttm-mini-tree-width': state.userSettings.miniTreeWidth || 90,
      'ttm-show-pinned-tabs': state.showPinnedTabs
    });

    // アクションボタンの振る舞いを更新
    if (state.userSettings.interactionMode === 'popup') {
      chrome.action.setPopup({ popup: 'sidepanel/popup.html' });
      chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => { });
    } else {
      chrome.action.setPopup({ popup: '' });
      chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => { });
    }
  } catch (e) {
    console.error('[TTM] Failed to save user settings:', e);
  }
}

// ===== タブナビゲーション設定管理 =====
async function loadTabConfig() {
  try {
    const data = await chrome.storage.local.get(['ttm-tab-config']);
    const saved = data['ttm-tab-config'];
    if (saved) {
      const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
      // Ensure all defaults exist in parsed (in case of updates)
      const merged = parsed.filter(p => DEFAULT_TAB_CONFIG.some(d => d.id === p.id));
      DEFAULT_TAB_CONFIG.forEach(d => {
        if (!merged.some(m => m.id === d.id)) merged.push(d);
      });
      // Override label and icon with the current localized version
      merged.forEach(m => {
        const defaultDef = DEFAULT_TAB_CONFIG.find(d => d.id === m.id);
        if (defaultDef) {
          m.label = defaultDef.label;
          m.icon = defaultDef.icon;
        }
      });
      state.tabConfig = merged;
    } else {
      state.tabConfig = [...DEFAULT_TAB_CONFIG];
    }
  } catch (e) {
    state.tabConfig = [...DEFAULT_TAB_CONFIG];
  }
}

async function saveTabConfig() {
  try {
    await chrome.storage.local.set({ 'ttm-tab-config': state.tabConfig });
  } catch (e) {
    console.error('Failed to save tab config', e);
  }
}

function renderNavTabs() {
  const nav = document.getElementById('main-nav');
  const currentActive = nav.querySelector('.tab-btn.active')?.dataset?.panel || 'tabs';

  nav.innerHTML = '';

  const visibleTabs = state.tabConfig.filter(t => t.visible);

  visibleTabs.forEach(tab => {
    const btn = document.createElement('button');
    btn.className = `tab-btn ${tab.id === currentActive ? 'active' : ''}`;
    btn.dataset.panel = tab.id;
    btn.innerHTML = `${tab.icon} ${escapeHtml(tab.label)}`;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const panel = document.getElementById(`panel-${tab.id}`);
      if (panel) panel.classList.add('active');

      // アクティブなパネルを保存
      chrome.storage.local.set({ 'ttm-active-panel': tab.id });

      if (tab.id === 'history') loadHistory();
      if (tab.id === 'bookmarks') loadBookmarks();
      if (tab.id === 'readingList') loadReadingList();
    });
    nav.appendChild(btn);
  });

  // 保存されたパネルを復元、またはデフォルト
  chrome.storage.local.get(['ttm-active-panel'], (data) => {
    const savedPanel = data['ttm-active-panel'];
    const targetId = (savedPanel && visibleTabs.some(t => t.id === savedPanel)) ? savedPanel : (visibleTabs[0]?.id || 'tabs');

    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));

    const targetBtn = nav.querySelector(`[data-panel="${targetId}"]`);
    if (targetBtn) targetBtn.classList.add('active');
    const targetPanel = document.getElementById(`panel-${targetId}`);
    if (targetPanel) targetPanel.classList.add('active');

    // 初期ロード時の読み込み
    if (targetId === 'history') loadHistory();
    if (targetId === 'bookmarks') loadBookmarks();
    if (targetId === 'readingList') loadReadingList();
  });
}

// ===== 設定パネル =====
let dragSettingId = null;

function renderSettingsPanel() {
  const list = document.getElementById('tab-visibility-list');
  list.innerHTML = '';

  state.tabConfig.forEach((tab, index) => {
    const item = document.createElement('div');
    item.className = 'settings-item';
    item.draggable = true;
    item.dataset.id = tab.id;

    const isSettings = tab.id === 'settings';
    const checkboxDisabled = isSettings ? 'disabled' : '';
    const checkedHtml = tab.visible ? 'checked' : '';

    item.innerHTML = `
      <div class="settings-item-drag">
        <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm1 4a1 1 0 100 2h12a1 1 0 100-2H4z" clip-rule="evenodd"/></svg>
      </div>
      <div class="settings-item-label">
        ${tab.icon} ${escapeHtml(tab.label)}
      </div>
      <input type="checkbox" class="settings-checkbox" ${checkedHtml} ${checkboxDisabled} title="${isSettings ? chrome.i18n.getMessage('settingsNotHideable') : chrome.i18n.getMessage('settingsToggle')}">
    `;

    // チェックボックス切り替え
    const cb = item.querySelector('.settings-checkbox');
    cb.addEventListener('change', (e) => {
      tab.visible = e.target.checked;
      saveTabConfig();
      renderNavTabs();
    });

    // ドラッグ＆ドロップ設定
    item.addEventListener('dragstart', (e) => {
      dragSettingId = tab.id;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', tab.id);
    });

    item.addEventListener('dragend', () => {
      dragSettingId = null;
      item.classList.remove('dragging');
      document.querySelectorAll('.settings-item').forEach(el => {
        el.classList.remove('drag-over-above', 'drag-over-below');
      });
    });

    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (dragSettingId === tab.id) return;
      const rect = item.getBoundingClientRect();
      const y = e.clientY - rect.top;

      item.classList.remove('drag-over-above', 'drag-over-below');
      if (y < rect.height / 2) {
        item.classList.add('drag-over-above');
      } else {
        item.classList.add('drag-over-below');
      }
    });

    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over-above', 'drag-over-below');
    });

    item.addEventListener('drop', (e) => {
      e.preventDefault();
      item.classList.remove('drag-over-above', 'drag-over-below');
      if (!dragSettingId || dragSettingId === tab.id) return;

      const rect = item.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const insertAfter = y >= rect.height / 2;

      const oldIndex = state.tabConfig.findIndex(t => t.id === dragSettingId);
      const draggedTab = state.tabConfig[oldIndex];
      const targetIndex = state.tabConfig.findIndex(t => t.id === tab.id);

      // 配列を再構築
      state.tabConfig.splice(oldIndex, 1);
      const newTargetIndex = state.tabConfig.findIndex(t => t.id === tab.id);
      state.tabConfig.splice(insertAfter ? newTargetIndex + 1 : newTargetIndex, 0, draggedTab);

      saveTabConfig();
      renderNavTabs();
      renderSettingsPanel();
    });

    list.appendChild(item);
  });

  // その他の設定 - テーマカラー スウォッチ
  function updateSwatchSelection(current) {
    document.querySelectorAll('.color-swatch[data-color]').forEach(sw => {
      sw.classList.toggle('selected', sw.dataset.color === current);
    });
    const customSwatch = document.querySelector('.color-swatch-custom');
    if (customSwatch) {
      const isCustom = current && current.startsWith('#') && !THEME_PRESETS[current];
      customSwatch.classList.toggle('selected', isCustom);
      if (isCustom) {
        const inp = document.getElementById('setting-theme-custom');
        if (inp) inp.value = current;
      }
    }
  }

  document.querySelectorAll('.color-swatch[data-color]').forEach(sw => {
    sw.onclick = () => {
      applyThemeColor(sw.dataset.color);
      updateSwatchSelection(sw.dataset.color);
      saveUserSettings(); // Clicking a swatch is a single action, save immediately
    };
  });

  const customInput = document.getElementById('setting-theme-custom');
  if (customInput) {
    customInput.oninput = () => {
      applyThemeColor(customInput.value);
      updateSwatchSelection(customInput.value);
      saveUserSettingsDebounced(); // Use debounced save during dragging
    };
    customInput.onchange = () => {
      saveUserSettings(); // Save final value on change
    };
  }

  updateSwatchSelection(state.userSettings.themeColor || 'blue');

  const cbHistory = document.getElementById('setting-history-recent');
  if (cbHistory) {
    cbHistory.checked = state.userSettings.historyRecentlyClosed;
    cbHistory.onchange = (e) => {
      state.userSettings.historyRecentlyClosed = e.target.checked;
      saveUserSettings();
      if (document.getElementById('panel-history').classList.contains('active')) loadHistory();
    };
  }

  const selColorScheme = document.getElementById('setting-color-scheme');
  if (selColorScheme) {
    selColorScheme.value = state.userSettings.colorScheme || 'auto';
    selColorScheme.onchange = (e) => {
      state.userSettings.colorScheme = e.target.value;
      saveUserSettings();
      applyColorScheme();
    };
  }

  const cbBookmark = document.getElementById('setting-bookmark-visit');
  if (cbBookmark) {
    cbBookmark.checked = state.userSettings.bookmarkVisitCount;
    cbBookmark.onchange = (e) => {
      state.userSettings.bookmarkVisitCount = e.target.checked;
      saveUserSettings();
      if (document.getElementById('panel-bookmarks').classList.contains('active')) renderBookmarks();
    };
  }

  const selDisplayMode = document.getElementById('setting-display-mode');
  if (selDisplayMode) {
    selDisplayMode.value = state.displayMode;
    selDisplayMode.onchange = (e) => {
      applyDisplayMode(e.target.value);
    };
  }

  const selInteractionMode = document.getElementById('setting-interaction-mode');
  if (selInteractionMode) {
    selInteractionMode.value = state.userSettings.interactionMode || 'sidepanel';
    selInteractionMode.onchange = (e) => {
      state.userSettings.interactionMode = e.target.value;
      saveUserSettings();
    };
  }

  // サイドパネルの位置設定
  const selSide = document.getElementById('setting-side-panel-side');
  if (selSide) {
    selSide.value = state.userSettings.sidePanelSide || 'right';
    selSide.onchange = (e) => {
      state.userSettings.sidePanelSide = e.target.value;
      saveUserSettings();
    };
  }

  // ミニツリーの幅設定
  const sliderWidth = document.getElementById('setting-mini-tree-width');
  const spanWidth = document.getElementById('mini-tree-width-value');
  if (sliderWidth && spanWidth) {
    const val = state.userSettings.miniTreeWidth || 90;
    sliderWidth.value = val;
    spanWidth.textContent = `${val}px`;
    sliderWidth.oninput = (e) => {
      const v = parseInt(e.target.value);
      spanWidth.textContent = `${v}px`;
      state.userSettings.miniTreeWidth = v;
      saveUserSettingsDebounced();
    };
  }

  const selFocusIntensity = document.getElementById('setting-focus-intensity');
  if (selFocusIntensity) {
    selFocusIntensity.value = state.userSettings.focusIntensity || 'medium';
    selFocusIntensity.onchange = (e) => {
      state.userSettings.focusIntensity = e.target.value;
      saveUserSettings();
      applyFocusIntensity();
      updateFocusState();
    };
  }

  const cbCloseOnSelect = document.getElementById('setting-close-on-select');
  if (cbCloseOnSelect) {
    cbCloseOnSelect.checked = !!state.userSettings.closeOnSelect;
    cbCloseOnSelect.onchange = (e) => {
      state.userSettings.closeOnSelect = e.target.checked;
      saveUserSettings();
      applyCloseOnSelectUI();
    };
  }

  const cbTabAnim = document.getElementById('setting-tab-selection-animation');
  if (cbTabAnim) {
    cbTabAnim.checked = !!state.userSettings.tabSelectionAnimation;
    cbTabAnim.onchange = (e) => {
      state.userSettings.tabSelectionAnimation = e.target.checked;
      saveUserSettings();
      applyTabSelectionAnimationUI();
    };
  }

  const selToggleSize = document.getElementById('setting-toggle-size');
  if (selToggleSize) {
    selToggleSize.value = state.userSettings.toggleSize || 'medium';
    selToggleSize.onchange = (e) => {
      state.userSettings.toggleSize = e.target.value;
      saveUserSettings();
      applyToggleSize();
    };
  }

  // タブの文字サイズ設定
  const sliderFontSize = document.getElementById('setting-tab-font-size');
  const spanFontSize = document.getElementById('tab-font-size-value');
  if (sliderFontSize && spanFontSize) {
    const val = state.userSettings.tabFontSize || 12;
    sliderFontSize.value = val;
    spanFontSize.textContent = `${val}px`;
    sliderFontSize.oninput = (e) => {
      const v = parseInt(e.target.value);
      spanFontSize.textContent = `${v}px`;
      state.userSettings.tabFontSize = v;
      saveUserSettingsDebounced();
      applyTabFontSize();
    };
  }

  renderShortcutsSettings();
}

function renderShortcutsSettings() {
  const container = document.getElementById('shortcuts-settings-list');
  if (!container) return;
  container.innerHTML = '';

  // 内部ショートカットを先に描画（同期）
  renderInternalShortcuts(container);

  // 拡張機能自体の有効化やその他のグローバルショートカットを取得して先頭に挿入（非同期）
  chrome.commands.getAll((commands) => {
    // 逆順で先頭に追加（manifestの順序を維持気味に）
    commands.slice().reverse().forEach(cmd => {
      const globalItem = document.createElement('div');
      globalItem.className = 'settings-item-normal';
      globalItem.style.borderLeft = '4px solid var(--theme-color)';

      let label = cmd.description;
      if (!label && cmd.name === '_execute_action') label = chrome.i18n.getMessage('actionEnableExtension');

      globalItem.innerHTML = `
        <div class="settings-item-label">
          <div style="display: flex; flex-direction: column;">
            <span>${label || cmd.name}</span>
            <span style="font-size: 10px; color: var(--text-muted); decoration: underline;">(Global Shortcut)</span>
          </div>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <span class="shortcut-kbd-btn global-shortcut-btn">${cmd.shortcut || '---'}</span>
          <button class="toolbar-btn primary" icon-only title="${chrome.i18n.getMessage('actionChangeShortcut')}">
            <svg viewBox="0 0 20 20" fill="currentColor" style="width:14px;height:14px;"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>
          </button>
        </div>
      `;
      globalItem.querySelector('button').onclick = () => {
        chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
      };
      container.insertBefore(globalItem, container.firstChild);
    });
  });
}

function renderInternalShortcuts(container) {
  SHORTCUT_ACTIONS.forEach(action => {
    const item = document.createElement('div');
    item.className = 'settings-item-normal';

    const label = document.createElement('div');
    label.className = 'settings-item-label';
    label.textContent = action.label;

    const right = document.createElement('div');
    right.style.display = 'flex';
    right.style.gap = '8px';
    right.style.alignItems = 'center';

    const kbd = document.createElement('button');
    kbd.className = 'shortcut-kbd-btn';
    kbd.textContent = state.userSettings.shortcuts[action.id] || '---';

    kbd.onclick = () => {
      if (state.isRecordingShortcut) return;
      state.isRecordingShortcut = true;
      kbd.classList.add('recording');
      kbd.textContent = chrome.i18n.getMessage('shortcutRecordPrompt');

      const onKeyDown = (e) => {
        // Alt, Ctrl, Shift, Meta 自体は無視して継続
        if (['Alt', 'Control', 'Shift', 'Meta'].includes(e.key)) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();

        // Escapeでキャンセル
        if (e.key === 'Escape') {
          stopRecording();
          return;
        }

        const shortcut = getShortcutString(e);
        if (shortcut) {
          state.userSettings.shortcuts[action.id] = shortcut;
          saveUserSettings();
          stopRecording();
        }
      };

      const stopRecording = () => {
        state.isRecordingShortcut = false;
        kbd.classList.remove('recording');
        kbd.textContent = state.userSettings.shortcuts[action.id] || '---';
        window.removeEventListener('keydown', onKeyDown, true);
        renderShortcutsSettings();
      };

      window.addEventListener('keydown', onKeyDown, true);
    };

    const resetBtn = document.createElement('button');
    resetBtn.className = 'toolbar-btn';
    resetBtn.title = chrome.i18n.getMessage('shortcutReset');
    resetBtn.style.padding = '4px';
    resetBtn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" style="width:14px;height:14px;"><path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1z" clip-rule="evenodd"/></svg>`;
    resetBtn.onclick = () => {
      // デフォルトに戻す
      const defaults = {
        'switch-tabs': '',
        'switch-history': '',
        'switch-bookmarks': '',
        'switch-settings': '',
        'focus-search': '',
        'display-mode': ''
      };
      state.userSettings.shortcuts[action.id] = defaults[action.id] || '';
      saveUserSettings();
      renderShortcutsSettings();
    };

    right.appendChild(kbd);
    right.appendChild(resetBtn);
    item.appendChild(label);
    item.appendChild(right);
    container.appendChild(item);
  });
}

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

    // カラー行（グループ色選択など）
    if (item.colorRow) {
      const li = document.createElement('li');
      li.className = 'context-menu-color-row';
      if (item.label) {
        const lbl = document.createElement('span');
        lbl.className = 'context-menu-color-label';
        lbl.textContent = item.label;
        li.appendChild(lbl);
      }
      item.colors.forEach(color => {
        const btn = document.createElement('button');
        btn.className = `color-swatch group-dot-${color.name}${color.current ? ' active' : ''}`;
        btn.title = color.label;
        btn.addEventListener('click', () => { hideContextMenu(); color.action(); });
        li.appendChild(btn);
      });
      contextMenuItems.appendChild(li);
      return;
    }

    const li = document.createElement('li');
    li.className = `context-menu-item${item.danger ? ' danger' : ''}${item.disabled ? ' disabled' : ''}`;
    li.innerHTML = `${item.icon || ''}<span>${escapeHtml(item.label)}</span>${item.hint ? `<span class="context-menu-hint">${escapeHtml(item.hint)}</span>` : ''}`;
    if (!item.disabled) {
      li.addEventListener('click', () => {
        hideContextMenu();
        item.action();
      });
    }
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
  // ショートカット録画中は何もしない
  if (state.isRecordingShortcut) return;

  if (e.key === 'Escape') {
    hideContextMenu();
    if (state.selectingParentFor != null) {
      cancelParentSelection();
      showToast(chrome.i18n.getMessage('toastCancelled'));
    }
    return;
  }

  // 入力フィールドフォーカス時はスキップ（ただし検索フォーカスショートカットは除く）
  const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
  const shortcut = getShortcutString(e);

  if (!shortcut) return;

  // ショートカット判定
  for (const [actionId, key] of Object.entries(state.userSettings.shortcuts || {})) {
    if (key === shortcut) {
      // 検索へのフォーカス以外は入力中は無視
      if (isInput && actionId !== 'focus-search') continue;

      e.preventDefault();
      handleShortcutAction(actionId);
      break;
    }
  }
});

// ===== タブパネル =====

// 子・孫の総件数を再帰的にカウント
function countDescendants(tab) {
  return (tab.children || []).reduce((n, c) => n + 1 + countDescendants(c), 0);
}

// 指定したタブとそのすべての子孫タブのIDを（見た目の順序通りに）取得する
function getBranchIds(tab) {
  let ids = [tab.id];
  (tab.children || []).forEach(child => {
    ids = ids.concat(getBranchIds(child));
  });
  return ids;
}
function getRelativeTimeString(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}h`;
  const day = Math.floor(hour / 24);
  return `${day}d`;
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

// ===== タブグループ関連 =====

// Chrome タブグループの利用可能カラー
const GROUP_COLORS = [
  { name: 'grey', label: chrome.i18n.getMessage('colorGrey') },
  { name: 'blue', label: chrome.i18n.getMessage('colorBlue') },
  { name: 'red', label: chrome.i18n.getMessage('colorRed') },
  { name: 'yellow', label: chrome.i18n.getMessage('colorYellow') },
  { name: 'green', label: chrome.i18n.getMessage('colorGreen') },
  { name: 'pink', label: chrome.i18n.getMessage('colorPink') },
  { name: 'purple', label: chrome.i18n.getMessage('colorPurple') },
  { name: 'cyan', label: chrome.i18n.getMessage('colorCyan') },
  { name: 'orange', label: chrome.i18n.getMessage('colorOrange') },
];

// 任意のタブサブセットからサブツリーを構築（グループ内・未グループの両方で使用）
function buildSubTree(tabSubset, parents) {
  const tabIds = new Set(tabSubset.map(t => t.id));
  const tabMap = {};
  tabSubset.forEach(tab => { tabMap[tab.id] = { ...tab, children: [] }; });
  const roots = [];
  tabSubset.forEach(tab => {
    const parentId = parents[tab.id];
    if (parentId && tabIds.has(parentId)) {
      tabMap[parentId].children.push(tabMap[tab.id]);
    } else {
      roots.push(tabMap[tab.id]);
    }
  });
  return roots;
}

// グループ・未グループが混在した通常タブをChrome順で描画
function renderNormalTabsWithGroups(container, normalTabs) {
  let currentGroupId = null;
  let currentGroupTabsList = [];
  let ungroupedBuffer = [];

  const flushUngrouped = () => {
    if (ungroupedBuffer.length === 0) return;
    const roots = buildSubTree(ungroupedBuffer, state.tabParents);
    const section = document.createElement('div');
    roots.forEach(tab => renderTabNode(section, tab, 0));
    container.appendChild(section);
    ungroupedBuffer = [];
  };

  const flushGroup = () => {
    if (currentGroupId === null || currentGroupTabsList.length === 0) return;
    const groupInfo = state.tabGroupInfo[currentGroupId];
    const groupSection = renderGroupSection(currentGroupId, groupInfo, currentGroupTabsList);
    container.appendChild(groupSection);
    currentGroupTabsList = [];
    currentGroupId = null;
  };

  normalTabs.forEach(tab => {
    const tabGroupId = state.tabGroupMap[tab.id];
    if (tabGroupId !== undefined) {
      flushUngrouped();
      if (tabGroupId !== currentGroupId) {
        flushGroup();
        currentGroupId = tabGroupId;
      }
      currentGroupTabsList.push(tab);
    } else {
      flushGroup();
      ungroupedBuffer.push(tab);
    }
  });
  flushGroup();
  flushUngrouped();
}

// グループセクションを描画して返す
function renderGroupSection(groupId, groupInfo, groupTabs) {
  const section = document.createElement('div');
  section.className = 'tab-group-section';
  section.dataset.groupId = groupId;

  const color = groupInfo?.color || 'grey';
  const isCollapsed = state.tabGroupCollapseState[groupId] || false;

  const header = document.createElement('div');
  header.className = `tab-group-header group-color-${color}`;
  header.innerHTML = `
    <div class="tab-group-toggle ${isCollapsed ? 'collapsed' : ''}">
      <svg viewBox="0 0 10 10" fill="currentColor"><path d="M2 3l3 4 3-4H2z"/></svg>
    </div>
    <div class="tab-group-dot"></div>
    <span class="tab-group-title">${escapeHtml(groupInfo?.title || chrome.i18n.getMessage('groupDefaultName'))}</span>
    <span class="tab-group-count">${groupTabs.length}</span>
  `;

  const childrenEl = document.createElement('div');
  childrenEl.className = `tab-group-children${isCollapsed ? ' collapsed' : ''}`;

  header.addEventListener('click', (e) => {
    // コンテキストメニューのクリックと競合しない
    if (e.target.closest('.context-menu')) return;
    state.tabGroupCollapseState[groupId] = !state.tabGroupCollapseState[groupId];
    const collapsed = state.tabGroupCollapseState[groupId];
    header.querySelector('.tab-group-toggle').classList.toggle('collapsed', collapsed);
    childrenEl.classList.toggle('collapsed', collapsed);
  });

  header.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showGroupContextMenu(e.clientX, e.clientY, groupId, groupInfo);
  });

  const roots = buildSubTree(groupTabs, state.tabParents);
  roots.forEach(tab => renderTabNode(childrenEl, tab, 0));

  section.appendChild(header);
  section.appendChild(childrenEl);
  return section;
}

// グループのコンテキストメニューを表示
function showGroupContextMenu(x, y, groupId, groupInfo) {
  const pencilIcon = `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>`;
  const xIcon = `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>`;

  showContextMenu(x, y, [
    // 色選択スウォッチ行
    {
      colorRow: true,
      label: chrome.i18n.getMessage('ctxColor'),
      colors: GROUP_COLORS.map(c => ({
        name: c.name,
        label: c.label,
        current: c.name === groupInfo?.color,
        action: async () => {
          try {
            await chrome.tabGroups.update(groupId, { color: c.name });
            await refreshTabTree();
          } catch {
            showToast(chrome.i18n.getMessage('toastColorUpdateFailed'), 'error');
          }
        }
      }))
    },
    { separator: true },
    {
      label: chrome.i18n.getMessage('ctxEditGroupName'),
      icon: pencilIcon,
      action: async () => {
        const newTitle = prompt(chrome.i18n.getMessage('promptEditGroup'), groupInfo?.title || '');
        if (newTitle === null) return;
        try {
          await chrome.tabGroups.update(groupId, { title: newTitle });
          await refreshTabTree();
        } catch {
          showToast(chrome.i18n.getMessage('toastGroupUpdateFailed') || 'Update failed', 'error');
        }
      }
    },
    { separator: true },
    {
      label: chrome.i18n.getMessage('ctxUngroup'),
      danger: true,
      icon: xIcon,
      action: async () => {
        const tabsInGroup = state.tabs.filter(t => state.tabGroupMap[t.id] === groupId);
        try {
          await chrome.tabs.ungroup(tabsInGroup.map(t => t.id));
          await refreshTabTree();
          showToast(chrome.i18n.getMessage('toastGroupUngrouped'), 'success');
        } catch {
          showToast(chrome.i18n.getMessage('toastGroupUngroupFailed'), 'error');
        }
      }
    }
  ]);
}

// 指定したクエリにマッチするタブとその親タブをすべて取得
function getMatchingTabs(tabs, query) {
  if (!query) return null;
  const matchIds = new Set();
  const tabMap = new Map(tabs.map(t => [t.id, t]));

  tabs.forEach(tab => {
    const isMatch = tab.title.toLowerCase().includes(query) ||
      tab.url.toLowerCase().includes(query) ||
      (state.customTabNames[tab.id] || '').toLowerCase().includes(query);

    if (isMatch) {
      matchIds.add(tab.id);
      // 親をすべて追加
      let pid = state.tabParents[tab.id];
      while (pid && tabMap.has(pid)) {
        matchIds.add(pid);
        pid = state.tabParents[pid];
      }
    }
  });
  return matchIds;
}

// タブツリーを描画
function renderTabTree() {
  const container = document.getElementById('tab-tree');
  const matchIds = getMatchingTabs(state.tabs, state.tabQuery);
  const filteredTabs = matchIds ? state.tabs.filter(t => matchIds.has(t.id)) : state.tabs;
  let { roots, pinnedRoots } = buildTabTree(filteredTabs, state.tabParents);

  // 検索時、マッチした親タブを強制的に展開する
  if (matchIds) {
    const expandMatchingParents = (nodes) => {
      nodes.forEach(node => {
        if (node.children.length > 0) {
          state.collapseState[node.id] = false;
          expandMatchingParents(node.children);
        }
      });
    };
    expandMatchingParents(roots);
    expandMatchingParents(pinnedRoots);
  }

  // 固定タブ合計（子孫含む）
  const pinnedTotal = pinnedRoots.reduce((n, t) => n + 1 + countDescendants(t), 0);

  // 固定タブ件数ラベルを更新
  const pinnedCountEl = document.getElementById('pinned-count-label');
  if (pinnedCountEl) pinnedCountEl.textContent = String(pinnedTotal);

  // すべて展開/折りたたみボタンのアイコン状態を更新
  const toggleAllBtn = document.getElementById('btn-toggle-all');
  if (toggleAllBtn) {
    const icon = toggleAllBtn.querySelector('.toggle-all-icon');
    if (icon) {
      // いずれかの親タブが展開されていたら「折りたたみ可能」状態
      const anyExpanded = state.tabs.some(tab => {
        const hasChildren = state.tabs.some(t => state.tabParents[t.id] === tab.id);
        return hasChildren && !state.collapseState[tab.id];
      });
      icon.classList.toggle('expanded', !anyExpanded);
      toggleAllBtn.title = anyExpanded ? chrome.i18n.getMessage('toolbarCollapseAll') : chrome.i18n.getMessage('toolbarExpandAll');
    }
  }

  // ソートモードが最近開いた順ならタイマー開始、そうでなければ停止
  if (state.tabSortMode === 'recent') {
    startRecentTimeUpdateTimer();
  } else {
    stopRecentTimeUpdateTimer();
  }

  container.innerHTML = '';

  // 固定タブセクション（ソートモードに関わらず常にツリー形式）
  if (pinnedRoots.length > 0) {
    const pinnedSection = document.createElement('div');
    pinnedSection.className = 'pinned-section';
    const label = document.createElement('div');
    label.className = `section-label collapsible-section ${state.showPinnedTabs ? '' : 'collapsed'}`;
    label.innerHTML = `
      <div class="section-toggle">
        <svg viewBox="0 0 10 10" fill="currentColor"><path d="M2 3l3 4 3-4H2z"/></svg>
      </div>
      ${chrome.i18n.getMessage('pinnedHeader', [pinnedTotal.toString()])}
    `;

    label.addEventListener('click', () => {
      state.showPinnedTabs = !state.showPinnedTabs;
      saveUserSettings();
      renderTabTree();
    });

    pinnedSection.appendChild(label);

    if (state.showPinnedTabs) {
      pinnedRoots.forEach(tab => {
        renderTabNode(pinnedSection, tab, 0);
      });
    }
    container.appendChild(pinnedSection);
  }

  const normalTabs = filteredTabs.filter(t => !t.pinned);

  if (state.tabSortMode === 'recent') {
    // 最近開いた順（フラット表示、インデントなし）
    const sorted = [...normalTabs].sort((a, b) => {
      const ta = state.tabActivationTime[a.id] || 0;
      const tb = state.tabActivationTime[b.id] || 0;
      return tb - ta;
    });
    if (sorted.length > 0) {
      const listSection = document.createElement('div');
      sorted.forEach(tab => {
        const nodeEl = document.createElement('div');
        nodeEl.className = 'tab-node';
        nodeEl.dataset.tabId = tab.id;
        // hasChildren=false でフラット描画（折りたたみなし）
        nodeEl.appendChild(createTabElement(tab, 0, false, false));
        listSection.appendChild(nodeEl);
      });
      container.appendChild(listSection);
    }
  } else {
    // 通常のツリー表示（グループ対応）
    if (normalTabs.length > 0) {
      const treeSection = document.createElement('div');
      renderNormalTabsWithGroups(treeSection, normalTabs);
      container.appendChild(treeSection);
    }
  }

  if (pinnedTotal === 0 && normalTabs.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 3H4v10c0 2.21 1.79 4 4 4h6c2.21 0 4-1.79 4-4v-3h2c1.11 0 2-.89 2-2V5c0-1.11-.89-2-2-2zm0 5h-2V5h2v3z"/></svg>
      <p>${chrome.i18n.getMessage('emptyTabs')}</p>
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

  // 検索クエリへの直接マッチを判定
  const isMatch = state.tabQuery && (
    tab.title.toLowerCase().includes(state.tabQuery) ||
    tab.url.toLowerCase().includes(state.tabQuery) ||
    (state.customTabNames[tab.id] || '').toLowerCase().includes(state.tabQuery)
  );

  item.className = `tab-item${tab.id === state.activeTabId ? ' active-tab' : ''}${tab.pinned ? ' pinned-tab' : ''}${isMatch ? ' search-match' : ''}`;
  if (state.lastMovedTabIds.includes(tab.id)) {
    item.className += ' animating-child';
    // 次回のレンダリングで繰り返さないよう、少し遅れてクリア
    setTimeout(() => {
      state.lastMovedTabIds = state.lastMovedTabIds.filter(id => id !== tab.id);
    }, 1000);
  }
  item.dataset.tabId = tab.id;
  item.draggable = true;

  const faviconUrl = getFaviconUrl(tab.url);

  // 固定タブではピンボタンを非表示（右クリックメニューで操作可能）
  const showPinBtn = !tab.pinned;

  // グループカラードット
  const tabGroupId = state.tabGroupMap[tab.id];
  const tabGroupInfo = tabGroupId !== undefined ? state.tabGroupInfo[tabGroupId] : null;
  const groupDotHtml = tabGroupInfo
    ? `<span class="tab-group-dot-sm group-dot-${tabGroupInfo.color}" title="${escapeHtml(tabGroupInfo.title || chrome.i18n.getMessage('groupDefaultName'))}"></span>`
    : '';

  item.innerHTML = `
    <div class="tab-toggle ${hasChildren ? (isCollapsed ? 'collapsed' : '') : 'no-children'}">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="4 6 8 10 12 6"></polyline>
      </svg>
    </div>
    <div class="tab-content-wrapper">
      ${groupDotHtml}
      ${faviconUrl
      ? `<img class="tab-favicon" src="${escapeHtml(faviconUrl)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" alt="">`
      : ''
    }
      ${!faviconUrl ? getDefaultFavicon() : `<span class="tab-favicon-default" style="display:none">${getDefaultFavicon()}</span>`}
      ${tab.pinned ? '<svg class="tab-pin-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M7 5A3 3 0 0 1 13 5A3 3 0 0 1 7 5ZM9 8H11V14H9ZM9 14L10 17L11 14Z"/></svg>' : ''}
      <div class="tab-info">
        <div class="tab-title" title="${escapeHtml(getTabDisplayName(tab))}">${escapeHtml(getTabDisplayName(tab))}</div>
        ${!tab.pinned ? `<div class="tab-url" title="${escapeHtml(tab.url)}">${escapeHtml(tab.url)}</div>` : ''}
        ${(() => {
      const taskInfo = state.googleTasks[tab.url];
      if (!taskInfo) return '';
      // 互換性維持：文字列（旧形式）の場合はリスト名として扱う
      const listName = typeof taskInfo === 'string' ? taskInfo : taskInfo.listName;
      const status = typeof taskInfo === 'string' ? 'needsAction' : taskInfo.status;
      const isCompleted = status === 'completed';
      return `<div class="tab-todo-tag ${isCompleted ? 'completed' : ''}" title="${escapeHtml(listName)} (Click to toggle status)">
                    <span>${isCompleted ? '✓' : '○'}</span>${escapeHtml(listName)}
                  </div>`;
    })()}
      </div>
      ${(state.tabSortMode === 'recent' && !tab.pinned) ? `<span class="tab-relative-time">${getRelativeTimeString(state.tabActivationTime[tab.id])}</span>` : ''}
      <div class="tab-actions">
        ${showPinBtn ? `<button class="tab-action-btn" data-action="pin" title="${chrome.i18n.getMessage('ctxPin')}">
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path d="M7 5A3 3 0 0 1 13 5A3 3 0 0 1 7 5ZM9 8H11V14H9ZM9 14L10 17L11 14Z"/>
          </svg>
        </button>` : ''}
        <button class="tab-action-btn close-btn" data-action="close" title="${chrome.i18n.getMessage('ctxClose')}">
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
          </svg>
        </button>
        ${hasChildren ? (() => {
      const total = countDescendants(tab);
      return `<button class="tab-action-btn close-tree-btn" data-action="close-tree" title="${chrome.i18n.getMessage('ctxCloseTree')} (${total + 1}${chrome.i18n.getMessage('tabsText')})">
              <svg viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/>
              </svg>
            </button>`;
    })() : ''}
      </div>
      ${hasChildren ? (() => {
      const total = countDescendants(tab);
      return `<span class="desc-badge clickable-toggle ${isCollapsed ? 'collapsed' : ''}" title="${isCollapsed ? chrome.i18n.getMessage('toolbarExpandAll') : chrome.i18n.getMessage('toolbarCollapseAll')} (${total} ${chrome.i18n.getMessage('tabsText')})">${total}</span>`;
    })() : ''}
    </div>
  `;

  /* 
  // アクティブタブにスクロール (ユーザーリクエストにより、更新時の自動スクロールを無効化)
  if (tab.id === state.activeTabId) {
    setTimeout(() => item.scrollIntoView({ block: 'nearest' }), 100);
  }
  */

  // クリックでタブをアクティブ化（親選択モード中は親を設定）
  item.addEventListener('click', (e) => {
    if (e.target.closest('.tab-toggle') || e.target.closest('.tab-action-btn')) return;

    // 親選択モード中：クリックされたタブを親に設定
    if (state.selectingParentFor != null) {
      const childTabId = state.selectingParentFor;
      if (tab.id === childTabId) {
        // 自分自身はキャンセル扱い
        cancelParentSelection();
        showToast(chrome.i18n.getMessage('toastCancelled'));
        return;
      }
      cancelParentSelection();
      sendMessage('SET_TAB_PARENT', { tabId: childTabId, parentId: tab.id })
        .then(() => refreshTabTree())
        .then(() => showToast(chrome.i18n.getMessage('toastParentSet'), 'success'));
      return;
    }

    activateTab(tab.id, tab.windowId);
  });

  // ダブルクリックでタイトルをその場で編集 / アクティブタブなら更新
  item.addEventListener('dblclick', (e) => {
    if (e.target.closest('.tab-toggle') || e.target.closest('.tab-action-btn')) return;

    const isTitle = e.target.closest('.tab-title');
    // アクティブなタブをタイトル以外でダブルクリックした場合はページを更新
    if (tab.id === state.activeTabId && !isTitle) {
      chrome.tabs.reload(tab.id);
      return;
    }

    // それ以外（タイトルダブルクリック、または非アクティブタブのダブルクリック）は名前編集
    const titleEl = item.querySelector('.tab-title');
    if (titleEl) {
      startInlineTabEdit(tab.id, titleEl);
    }
  });

  // 折りたたみトグル
  const toggle = item.querySelector('.tab-toggle');
  if (toggle && hasChildren) {
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleTabCollapse(tab.id);
    });
  }

  // 折りたたみトグル（件数バッジをクリック）
  const badgeToggle = item.querySelector('.desc-badge.clickable-toggle');
  if (badgeToggle && hasChildren) {
    badgeToggle.addEventListener('click', (e) => {
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
  item.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    await showTabContextMenu(e.clientX, e.clientY, tab);
  });

  // トグルクリックイベント
  const todoTag = item.querySelector('.tab-todo-tag');
  if (todoTag && state.googleTasks[tab.url]) {
    todoTag.addEventListener('click', async (e) => {
      e.stopPropagation();
      const taskInfo = state.googleTasks[tab.url];
      try {
        const res = await sendMessage('TOGGLE_GOOGLE_TASK_STATUS', {
          listId: taskInfo.listId,
          taskId: taskInfo.taskId,
          status: taskInfo.status
        });
        if (res.success) {
          await refreshGoogleTasks();
        } else {
          showToast('Failed to toggle status', 'error');
        }
      } catch (err) {
        console.error(err);
      }
    });
  }

  // ドラッグ&ドロップ
  setupDragAndDrop(item, tab);

  return item;
}

async function addTabToGoogleTodo(tab, listId = null) {
  showToast(chrome.i18n.getMessage('msgLoading'), 'info');
  try {
    const res = await sendMessage('ADD_TO_GOOGLE_TODO', {
      tabId: tab.id,
      url: tab.url,
      title: getTabDisplayName(tab),
      listId: listId
    });
    if (res.success) {
      showToast(chrome.i18n.getMessage('toastAddedToGoogleTodo'), 'success');
      await refreshGoogleTasks();
    } else {
      const errorMsg = res.error || chrome.i18n.getMessage('toastGoogleTodoAddFailed');
      showToast(errorMsg, 'error');
    }
  } catch (e) {
    showToast(chrome.i18n.getMessage('toastGoogleTodoAddFailed'), 'error');
  }
}

async function showTabContextMenu(x, y, tab) {
  // 親タブ（子タブがある）かどうか（state.tabParents から正確に判定）
  const hasChildren = state.tabs.some(t => state.tabParents[t.id] === tab.id);
  // 最近開いた順モードではツリー操作を非表示にする
  const isRecentMode = state.tabSortMode === 'recent';

  const ICON = {
    pin: `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M7 5A3 3 0 0 1 13 5A3 3 0 0 1 7 5ZM9 8H11V14H9ZM9 14L10 17L11 14Z"/></svg>`,
    child: `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd"/></svg>`,
    ungroup: `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>`,
    tag: `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M17.707 9.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-7-7A.997.997 0 012 10V5a3 3 0 013-3h5c.256 0 .512.098.707.293l7 7zM5 6a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd"/></svg>`,
    down: `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>`,
    lift: `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clip-rule="evenodd"/></svg>`,
    trash: `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>`,
    left: `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>`,
    domain: `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v1h1a2 2 0 012 2v5a2 2 0 01-2 2H4a2 2 0 01-2-2v-5a2 2 0 012-2h1zm8-2v1H7V7a3 3 0 016 0z" clip-rule="evenodd"/></svg>`,
    up: `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M3.293 9.707a1 1 0 010-1.414l6-6a1 1 0 011.414 0l6 6a1 1 0 01-1.414 1.414L11 5.414V17a1 1 0 11-2 0V5.414L4.707 9.707a1 1 0 01-1.414 0z" clip-rule="evenodd"/></svg>`,
    pencil: `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>`,
    copy: `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M8 2a1 1 0 000 2h2a1 1 0 100-2H8z"/><path d="M3 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v6h-4.586l1.293-1.293a1 1 0 00-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L10.414 13H15v3a2 2 0 01-2 2H5a2 2 0 01-2-2V5z"/></svg>`,
    close: `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>`,
    readingList: `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M9 4.804A7.993 7.993 0 002 8c0 .344.033.677.095 1H5.82a2 2 0 011.61 1.61l.17.68h3.805a2 2 0 011.61-1.61l.17-.68h3.725c.062-.323.095-.656.095-1 0-3.196-2.6-5.804-5.804-5.804z"/><path d="M10 5.804c.344 0 .677.033 1 .095v3.424a2 2 0 01-1.61 1.61l-.68.17v3.801a2 2 0 011.61-1.61l.68-.17h3.424A7.993 7.993 0 0011 11c0-.344-.033-.677-.095-1V6.576a2 2 0 011.61-1.61l.68-.17V1.031A8.003 8.003 0 0010 1c-3.196 0-5.804 2.6-5.804 5.804v3.424A2 2 0 012.586 11.838l.68.17V15.809a2 2 0 01-1.61 1.61l-.68.17v3.424A7.993 7.993 0 005 21c3.196 0 5.804-2.6 5.804-5.804v-3.424a2 2 0 01-1.61-1.61l-.68-.17V6.576c3.196 0 5.804-2.6 5.804-5.804V1.03a8.003 8.003 0 00-1 .095V5.804z"/></svg>`,
  };

  const menuItems = [
    // ─── 基本操作（全モード共通）───
    {
      label: tab.pinned ? chrome.i18n.getMessage('ctxUnpinTab') : chrome.i18n.getMessage('ctxPinTab'),
      icon: ICON.pin,
      action: () => toggleTabPin(tab.id, !tab.pinned)
    },
    {
      label: chrome.i18n.getMessage('ctxOpenChildTab'),
      icon: ICON.child,
      // 最近開いた順モードではツリー構造が見えないためグレーアウト
      disabled: isRecentMode,
      hint: isRecentMode ? chrome.i18n.getMessage('sortRecentUsed') : undefined,
      action: () => createChildTab(tab.id)
    }
  ];

  // Google Todo 追加メニュー
  if (!state.googleTasks[tab.url]) {
    try {
      const res = await sendMessage('GET_TASK_LISTS');
      if (res.success && res.lists && res.lists.length > 0) {
        menuItems.push({ separator: true });
        res.lists.forEach(list => {
          menuItems.push({
            label: `To: ${list.title}`,
            icon: ICON.readingList,
            action: () => addTabToGoogleTodo(tab, list.id)
          });
        });
      }
    } catch (e) {
      console.error('[TTM] Failed to fetch task lists for context menu');
    }
  }

  // ─── グループ操作（固定タブ・全モード共通）───
  if (!tab.pinned) {
    const tabGroupId = state.tabGroupMap[tab.id];
    if (tabGroupId !== undefined) {
      // グループ内のタブ → 除外のみ
      menuItems.push({
        label: chrome.i18n.getMessage('ctxRemoveFromGroup'),
        icon: ICON.ungroup,
        action: async () => {
          try {
            await chrome.tabs.ungroup([tab.id]);
            await refreshTabTree();
            showToast(chrome.i18n.getMessage('toastGroupRemoved'), 'success');
          } catch {
            showToast(chrome.i18n.getMessage('toastGroupRemoveFailed'), 'error');
          }
        }
      });
    } else {
      // グループ外のタブ → 既存グループに追加 + 新規作成
      const existingGroups = Object.values(state.tabGroupInfo);
      if (existingGroups.length > 0) {
        existingGroups.forEach(group => {
          menuItems.push({
            label: chrome.i18n.getMessage('ctxAddToGroup', [group.title || chrome.i18n.getMessage('groupDefaultName')]),
            icon: `<span class="tab-group-dot-sm group-dot-${group.color}"></span>`,
            action: async () => {
              try {
                await chrome.tabs.group({ tabIds: [tab.id], groupId: group.id });
                await refreshTabTree();
                showToast(chrome.i18n.getMessage('toastGroupAdded'), 'success');
              } catch {
                showToast(chrome.i18n.getMessage('toastGroupAddFailed'), 'error');
              }
            }
          });
        });
      }
      menuItems.push({
        label: chrome.i18n.getMessage('ctxNewGroup'),
        icon: ICON.tag,
        action: async () => {
          try {
            const gid = await chrome.tabs.group({ tabIds: [tab.id] });
            const title = prompt(chrome.i18n.getMessage('promptEditGroup'), '');
            if (title !== null && title.trim()) {
              await chrome.tabGroups.update(gid, { title: title.trim() });
            }
            await refreshTabTree();
            showToast(chrome.i18n.getMessage('toastGroupCreated'), 'success');
          } catch {
            showToast(chrome.i18n.getMessage('toastGroupCreateFailed'), 'error');
          }
        }
      });
    }
  }

  // ─── ツリー専用操作（ツリーモードのみ表示）───
  if (!isRecentMode) {
    // これより下のタブを子タブにする
    if (!tab.pinned) {
      const belowTabs = state.tabs.filter(t => !t.pinned && t.index > tab.index);
      if (belowTabs.length > 0) {
        menuItems.push({
          label: `${chrome.i18n.getMessage('ctxMakeChildren')} (${belowTabs.length})`,
          icon: ICON.down,
          action: () => makeTabsBelowChildren(tab)
        });
      }
    }

    // 親タブの場合の追加操作 / 子タブ設定
    if (hasChildren) {
      menuItems.push(
        { separator: true },
        {
          label: chrome.i18n.getMessage('ctxMoveTreeUp'),
          icon: ICON.lift,
          action: () => moveChildrenToParentLevel(tab.id)
        },
        {
          label: `${chrome.i18n.getMessage('ctxCloseTree')} (${countDescendants(tab) + 1})`,
          danger: true,
          icon: ICON.trash,
          action: () => closeTabWithChildren(tab.id)
        }
      );
    } else {
      menuItems.push({
        label: chrome.i18n.getMessage('ctxMoveToGrandparent'),
        icon: ICON.left,
        action: () => moveToParent(tab.id)
      });
    }

    // ドメイン集約
    try {
      const tabUrl = new URL(tab.url);
      const sameDomainTabs = state.tabs.filter(t => {
        try { return new URL(t.url).hostname === tabUrl.hostname && t.id !== tab.id && !t.pinned; }
        catch { return false; }
      });
      if (sameDomainTabs.length > 0) {
        menuItems.push({
          label: `${chrome.i18n.getMessage('ctxGroupDomain')} (${sameDomainTabs.length})`,
          icon: ICON.domain,
          action: () => aggregateSameDomain(tab.id, sameDomainTabs)
        });
      }
    } catch { }

    // 1つ上の階層へ移動
    const parentTabId = state.tabParents[tab.id];
    if (parentTabId && state.tabs.find(t => t.id === parentTabId)) {
      const grandParentId = state.tabParents[parentTabId] || null;
      menuItems.push({
        label: chrome.i18n.getMessage('ctxMoveToGrandparent'),
        icon: ICON.up,
        action: () => moveToGrandParentLevel(tab.id, grandParentId)
      });
    }
  }

  // ─── 共通操作（全モード）───
  menuItems.push(
    { separator: true },
    {
      label: chrome.i18n.getMessage('ctxEditName'),
      icon: ICON.pencil,
      action: () => editTabName(tab)
    },
    {
      label: chrome.i18n.getMessage('ctxCopyUrl'),
      icon: ICON.copy,
      action: () => {
        navigator.clipboard.writeText(tab.url).then(() => showToast(chrome.i18n.getMessage('toastUrlCopied'), 'success'));
      }
    },
    {
      label: chrome.i18n.getMessage('ctxAddToReadingList'),
      icon: ICON.readingList,
      action: async () => {
        try {
          await chrome.readingList.addEntry({
            title: tab.title,
            url: tab.url,
            hasBeenRead: false
          });
          showToast(chrome.i18n.getMessage('toastAddedToReadingList'), 'success');
        } catch (e) {
          showToast(chrome.i18n.getMessage('toastReadingListAddFailed'), 'error');
        }
      }
    },
    { separator: true },
    {
      label: hasChildren && !isRecentMode ? chrome.i18n.getMessage('ctxCloseOnlyTab') : chrome.i18n.getMessage('ctxCloseTab'),
      danger: true,
      icon: ICON.close,
      action: () => closeTab(tab.id)
    }
  );

  showContextMenu(x, y, menuItems);
}

// これより下（index順）の非固定タブをすべて自分の子タブにする
async function makeTabsBelowChildren(tab) {
  const belowTabs = state.tabs.filter(t => !t.pinned && t.index > tab.index);
  if (belowTabs.length === 0) {
    showToast(chrome.i18n.getMessage('toastNoTabsBelow'), 'error');
    return;
  }
  state.lastMovedTabIds = belowTabs.map(t => t.id);
  for (const t of belowTabs) {
    await sendMessage('SET_TAB_PARENT', { tabId: t.id, parentId: tab.id });
  }
  showToast(chrome.i18n.getMessage('toastTabsGroupedCounted', [belowTabs.length.toString()]), 'success');
  await refreshTabTree();
}

// 親タブの子をすべて1つ上のレベルに移動
async function moveChildrenToParentLevel(tabId) {
  // state.tabParents を直接使って直接の子タブを収集（state.tabs は .children を持たないフラット配列）
  const children = state.tabs.filter(t => state.tabParents[t.id] === tabId);
  if (children.length === 0) {
    showToast(chrome.i18n.getMessage('toastNoChildTabs'), 'error');
    return;
  }

  const parentId = state.tabParents[tabId] || null;
  for (const child of children) {
    await sendMessage('SET_TAB_PARENT', { tabId: child.id, parentId });
  }
  showToast(chrome.i18n.getMessage('toastChildTabsMoved'), 'success');
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

  showToast(chrome.i18n.getMessage('toastSelectParent'));
}

// 親選択モードをキャンセル
function cancelParentSelection() {
  state.selectingParentFor = null;
  document.querySelectorAll('.tab-item').forEach(el => el.classList.remove('selecting-parent'));
}

// ===== 新規操作機能 =====

// 同じドメインのタブをまとめる
async function aggregateSameDomain(parentTabId, sameDomainTabs) {
  state.lastMovedTabIds = sameDomainTabs.map(t => t.id);
  for (const tab of sameDomainTabs) {
    await sendMessage('SET_TAB_PARENT', { tabId: tab.id, parentId: parentTabId });
  }
  showToast(chrome.i18n.getMessage('toastTabsGroupedCounted', [sameDomainTabs.length.toString()]), 'success');
  await refreshTabTree();
}

// 1つ上のツリーレベルの子にする
async function moveToGrandParentLevel(tabId, grandParentId) {
  try {
    await sendMessage('SET_TAB_PARENT', { tabId, parentId: grandParentId });
    showToast(chrome.i18n.getMessage('toastTabLevelUp'), 'success');
    await refreshTabTree();
  } catch (err) {
    console.error('Failed to move tab:', err);
    showToast(chrome.i18n.getMessage('toastTabMoveFailed'), 'error');
  }
}

// ===== タブ名カスタム編集 =====

// タブ名を編集
async function editTabName(tab) {
  const currentName = state.customTabNames[tab.id] || tab.title;
  const newName = prompt(chrome.i18n.getMessage('promptEditTabName', [currentName]), currentName);

  if (newName === null) return; // キャンセル

  if (newName.trim() === '') {
    // 名前をリセット
    delete state.customTabNames[tab.id];
    delete state.tabCustomNamesByUrl[tab.url];
    try {
      localStorage.removeItem(`ttm-custom-name-${tab.id}`);
      localStorage.removeItem(`ttm-custom-name-url-${tab.url}`);
    } catch { }
    showToast(chrome.i18n.getMessage('toastTabNameReset'), 'success');
  } else {
    // 新しい名前を設定
    state.customTabNames[tab.id] = newName.trim();
    state.tabCustomNamesByUrl[tab.url] = newName.trim();
    try {
      localStorage.setItem(`ttm-custom-name-${tab.id}`, newName.trim());
      localStorage.setItem(`ttm-custom-name-url-${tab.url}`, newName.trim());
    } catch { }
    showToast(chrome.i18n.getMessage('toastTabNameUpdated'), 'success');
  }

  renderTabTree();
}

// カスタム名を取得（存在すれば返す）
function saveTabCustomName(tabId, url, newName) {
  if (newName) {
    state.customTabNames[tabId] = newName;
    state.tabCustomNamesByUrl[url] = newName;
    localStorage.setItem(`ttm-custom-name-${tabId}`, newName);
    localStorage.setItem(`ttm-custom-name-url-${url}`, newName);
  } else {
    delete state.customTabNames[tabId];
    delete state.tabCustomNamesByUrl[url];
    localStorage.removeItem(`ttm-custom-name-${tabId}`);
    localStorage.removeItem(`ttm-custom-name-url-${url}`);
  }
}

function startInlineTabEdit(tabId, titleEl) {
  const currentName = titleEl.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tab-title-input';
  input.value = currentName;

  // 元のタイトルを一時的に非表示にし、入力を挿入
  const originalDisplay = titleEl.style.display;
  titleEl.style.display = 'none';
  titleEl.parentNode.insertBefore(input, titleEl);

  input.focus();
  input.select();

  let isFinished = false;
  const finishEdit = (save) => {
    if (isFinished) return;
    isFinished = true;

    const newValue = input.value.trim();
    if (input.parentNode) {
      input.parentNode.removeChild(input);
    }
    titleEl.style.display = originalDisplay;

    if (save && newValue !== currentName) {
      const tab = state.tabs.find(t => t.id === tabId);
      if (tab) {
        saveTabCustomName(tabId, tab.url, newValue);
        // ツリー全体を再描画して変更を反映
        renderTabTree();
        showToast(chrome.i18n.getMessage('toastTabNameUpdated'), 'success');
      }
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finishEdit(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finishEdit(false);
    }
  });

  input.addEventListener('blur', () => finishEdit(true));
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('mousedown', (e) => e.stopPropagation());
}

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
  return tab.title || '(No Title)';
}

// タブ操作
async function activateTab(tabId, windowId) {
  try {
    // 最近開いた時刻を記録（最近開いた順ソート用）
    state.tabActivationTime[tabId] = Date.now();
    try { localStorage.setItem(`ttm-tab-activation-${tabId}`, state.tabActivationTime[tabId]); } catch { }

    await sendMessage('ACTIVATE_TAB', {
      tabId,
      windowId,
      focusWindow: !!state.userSettings.closeOnSelect
    });

    // 設定が有効な場合、サイドパネルを閉じる
    if (state.userSettings.closeOnSelect) {
      window.close();
    }
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
    showToast(pinned ? chrome.i18n.getMessage('toastPinned') : chrome.i18n.getMessage('toastUnpinned'), 'success');
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

function toggleAllCollapse() {
  const anyExpanded = state.tabs.some(tab => {
    const hasChildren = state.tabs.some(t => state.tabParents[t.id] === tab.id);
    return hasChildren && !state.collapseState[tab.id];
  });

  if (anyExpanded) {
    collapseAll();
  } else {
    expandAll();
  }
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
// ドラッグ&ドロップのゾーン判定ヘルパー
function getTabDropZone(y, h) {
  const threshold = 0.4; // 上下40%を並び替え、中央20%を親子判定にする
  if (y < h * threshold) return 'above';
  if (y > h * (1 - threshold)) return 'below';
  return 'inside';
}

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

    // 最新のドラッグ中タブとターゲットタブの情報を取得
    const draggedTab = state.tabs.find(t => t.id === dragTabId);
    if (!draggedTab) return;

    // 固定タブ↔非固定タブ間の移動は禁止（視覚的フィードバックを無効化）
    if (draggedTab.pinned !== tab.pinned) {
      e.dataTransfer.dropEffect = 'none';
      return;
    }

    const rect = item.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;
    const zone = getTabDropZone(y, h);

    item.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-inside');
    item.classList.add(`drag-over-${zone}`);
    e.dataTransfer.dropEffect = 'move';
  });

  item.addEventListener('dragleave', () => {
    item.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-inside');
  });

  item.addEventListener('drop', async (e) => {
    e.preventDefault();
    const rect = item.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const h = rect.height;
    const zone = getTabDropZone(y, h);

    item.classList.remove('drag-over-above', 'drag-over-below', 'drag-over-inside');

    if (!dragTabId || dragTabId === tab.id) return;

    try {
      // 動的に最新の物理情報を取得
      const latestTabs = await chrome.tabs.query({ currentWindow: true });
      const currentDraggedTab = latestTabs.find(t => t.id === dragTabId);
      const currentTargetTab = latestTabs.find(t => t.id === tab.id);

      if (!currentDraggedTab || !currentTargetTab) return;
      if (currentDraggedTab.pinned !== currentTargetTab.pinned) return;

      // ドラッグしているタブ（およびその全子孫）のIDリスト
      // state.tabs から現在の枝の構造を取得するために、まず現在の state.tabs を元にした tree 内で対象を探す
      const findInTree = (nodes, id) => {
        for (const n of nodes) {
          if (n.id === id) return n;
          if (n.children) {
            const found = findInTree(n.children, id);
            if (found) return found;
          }
        }
        return null;
      };

      const tree = buildSubTree(state.tabs, state.tabParents);
      const draggedNode = findInTree(tree, dragTabId);
      const targetNode = findInTree(tree, tab.id);

      if (!draggedNode || !targetNode) return;

      const idsToMove = getBranchIds(draggedNode);

      if (zone === 'inside') {
        // ─── 内側ドロップ: ドロップ先の子タブにする ───
        state.lastMovedTabIds = [dragTabId];
        await sendMessage('SET_TAB_PARENT', { tabId: dragTabId, parentId: tab.id });

        if (currentDraggedTab.windowId === currentTargetTab.windowId) {
          // 子にする場合、親の物理位置の直後（既存の子タブがいればそのさらに後）へ
          const descendantCount = countDescendants(targetNode);
          const targetIndex = currentTargetTab.index + descendantCount + 1;
          const finalIndex = currentDraggedTab.index < targetIndex ? targetIndex - idsToMove.length : targetIndex;

          try {
            await chrome.tabs.move(idsToMove, { index: finalIndex });
          } catch (e) { console.warn('Branch move failed', e); }
        }
      } else {
        // ─── 上/下ドロップ: ドロップ先と同じ親にする ───
        const parentId = state.tabParents[tab.id] || null;
        await sendMessage('SET_TAB_PARENT', { tabId: dragTabId, parentId });

        if (currentDraggedTab.windowId === currentTargetTab.windowId) {
          let moveToIndex;
          if (zone === 'above') {
            moveToIndex = currentTargetTab.index;
          } else {
            // 下に挿入する場合、ターゲットの子孫をすべて含めた後ろに配置
            const descendantCount = countDescendants(targetNode);
            moveToIndex = currentTargetTab.index + descendantCount + 1;
          }

          // 自己移動によるズレを補正
          const finalIndex = currentDraggedTab.index < moveToIndex ? moveToIndex - idsToMove.length : moveToIndex;

          try {
            if (finalIndex !== currentDraggedTab.index && finalIndex >= 0) {
              await chrome.tabs.move(idsToMove, { index: finalIndex });
            }
          } catch (e) { console.warn('Branch move failed', e); }
        }
      }
    } catch (err) {
      console.error('Failed to reorder tab:', err);
      showToast(chrome.i18n.getMessage('toastTabReorderFailed'), 'error');
    } finally {
      await refreshTabTree();
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
    } catch { }
  });

  // カスタム名を復元（tabId経由）
  tabs.forEach(tab => {
    try {
      const customName = localStorage.getItem(`ttm-custom-name-${tab.id}`);
      if (customName) state.customTabNames[tab.id] = customName;
    } catch { }
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
    } catch { }
  });

  // グループ情報を取得（タブ一覧の groupId を直接利用して効率化）
  try {
    const groups = await chrome.tabGroups.query({ windowId: state.currentWindowId });
    state.tabGroupInfo = {};
    state.tabGroupMap = {};
    groups.forEach(group => {
      state.tabGroupInfo[group.id] = {
        id: group.id,
        title: group.title,
        color: group.color,
        collapsed: group.collapsed
      };
    });
    tabs.forEach(tab => {
      if (tab.groupId !== undefined && tab.groupId !== -1) {
        state.tabGroupMap[tab.id] = tab.groupId;
      }
    });
  } catch {
    state.tabGroupInfo = {};
    state.tabGroupMap = {};
  }

  try {
    const [parentsResp, metaResp] = await Promise.all([
      sendMessage('GET_TAB_PARENTS'),
      sendMessage('GET_TAB_METADATA')
    ]);
    state.tabParents = parentsResp?.parents || {};

    // 折りたたみ状態を復元
    const metadata = metaResp?.metadata || {};
    Object.entries(metadata).forEach(([id, meta]) => {
      if (meta.collapsed !== undefined) {
        state.collapseState[id] = meta.collapsed;
      }
    });
  } catch {
    state.tabParents = {};
  }

  renderTabTree();

  // 初回ロード時のみアクティブタブまでスクロール & 親を開く
  if (state.isFirstLoad && state.activeTabId) {
    state.isFirstLoad = false;
    setTimeout(() => {
      const activeItem = document.querySelector(`.tab-item[data-tab-id="${state.activeTabId}"]`);
      if (activeItem) {
        // 親を辿って展開
        let parent = activeItem.closest('.tab-node')?.parentElement?.closest('.tab-node');
        while (parent) {
          const parentId = parent.dataset.tabId;
          if (parentId && state.collapseState[parentId]) {
            toggleTabCollapse(parentId); // 展開
          }
          parent = parent.parentElement?.closest('.tab-node');
        }
        activeItem.scrollIntoView({ block: 'nearest' });
      }
    }, 200);
  }
}

async function refreshTabTree() {
  await loadTabs();
}

// ===== ツールバーボタン =====
document.getElementById('btn-new-tab').addEventListener('click', () => {
  sendMessage('NEW_TAB', {});
});

let tabSearchTimeout = null;
const tabSearchInput = document.getElementById('tab-search');
if (tabSearchInput) {
  tabSearchInput.addEventListener('input', (e) => {
    state.tabQuery = e.target.value.toLowerCase();
    clearTimeout(tabSearchTimeout);
    tabSearchTimeout = setTimeout(() => {
      renderTabTree();
    }, 200);
  });
}
document.getElementById('btn-toggle-close-on-select').addEventListener('click', () => {
  state.userSettings.closeOnSelect = !state.userSettings.closeOnSelect;
  saveUserSettings();
  applyCloseOnSelectUI();
});
document.getElementById('btn-toggle-selection-animation').addEventListener('click', () => {
  state.userSettings.tabSelectionAnimation = !state.userSettings.tabSelectionAnimation;
  saveUserSettings();
  applyTabSelectionAnimationUI();
});
document.getElementById('btn-toggle-all').addEventListener('click', toggleAllCollapse);

// 以前のボタンは削除（セクションヘッダーがトグルになったため）

document.getElementById('btn-sessions').addEventListener('click', async () => {
  const input = document.getElementById('session-name-input');
  input.value = `${chrome.i18n.getMessage('sessionText')} ${new Date().toLocaleString()}`;
  openModal('modal-sessions');
  loadSessionList();
  setTimeout(() => input.focus(), 100);
});

document.getElementById('btn-confirm-save').addEventListener('click', async () => {
  const name = document.getElementById('session-name-input').value.trim();
  try {
    await sendMessage('SAVE_SESSION', { name: name || undefined });
    // 保存後、リストを再読み込みして入力を初期化
    loadSessionList();
    document.getElementById('session-name-input').value = `${chrome.i18n.getMessage('sessionText')} ${new Date().toLocaleString()}`;
    showToast(chrome.i18n.getMessage('toastSessionSaved'), 'success');
  } catch (e) {
    showToast(chrome.i18n.getMessage('toastSessionSaveFailed'), 'error');
  }
});

async function loadSessionList() {
  const list = document.getElementById('session-list');
  list.innerHTML = `<div class="loading">${chrome.i18n.getMessage('msgLoading')}</div>`;

  try {
    const resp = await sendMessage('LOAD_SESSIONS');
    const sessions = resp?.sessions || [];

    if (sessions.length === 0) {
      list.innerHTML = `<div class="no-sessions">${chrome.i18n.getMessage('emptySessions')}</div>`;
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
          <div class="session-meta">${session.tabs.length} ${chrome.i18n.getMessage('tabsText')} | ${formatTime(session.createdAt)}</div>
        </div>
        <button class="session-delete" data-id="${session.id}" title="${chrome.i18n.getMessage('ctxDelete')}">
          <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
        </button>
      `;

      item.addEventListener('click', async (e) => {
        if (e.target.closest('.session-delete')) return;
        try {
          await sendMessage('RESTORE_SESSION', { sessionId: session.id });
          closeModal('modal-load-session');
          showToast(chrome.i18n.getMessage('toastSessionRestored'), 'success');
        } catch {
          showToast(chrome.i18n.getMessage('toastSessionRestoreFailed'), 'error');
        }
      });

      item.querySelector('.session-delete').addEventListener('click', async (e) => {
        e.stopPropagation();
        await sendMessage('DELETE_SESSION', { sessionId: session.id });
        await loadSessionList();
        showToast(chrome.i18n.getMessage('toastSessionDeleted'));
      });

      list.appendChild(item);
    });
  } catch (e) {
    list.innerHTML = `<div class="no-sessions">${chrome.i18n.getMessage('emptySessionLoadFail')}</div>`;
  }
}

// ===== 履歴パネル =====
let historySearchTimeout = null;

async function loadHistory(query = '') {
  const container = document.getElementById('history-list');
  container.innerHTML = `<div class="loading" data-i18n="msgLoading">${chrome.i18n.getMessage('msgLoading')}</div>`;

  try {
    let recentSessions = [];
    if (state.userSettings.historyRecentlyClosed && !query) {
      recentSessions = await new Promise((resolve) => {
        chrome.sessions.getRecentlyClosed({ maxResults: 10 }, (sessions) => resolve(sessions || []));
      });
    }

    const resp = await sendMessage('GET_HISTORY', {
      query,
      maxResults: 200,
      startTime: Date.now() - 30 * 24 * 60 * 60 * 1000
    });

    const items = resp?.history || [];
    state.historyItems = items;
    renderHistory(items, query, recentSessions);
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><p>${chrome.i18n.getMessage('emptyHistoryLoadFail')}</p></div>`;
  }
}

function renderHistory(items, query = '', recentSessions = []) {
  const container = document.getElementById('history-list');

  // ソート適用
  let sortedItems = [...items];
  if (state.historySortMode === 'most-visited') {
    sortedItems.sort((a, b) => (b.visitCount || 0) - (a.visitCount || 0));
  }

  if (items.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM12.75 6a.75.75 0 00-1.5 0v6c0 .414.336.75.75.75h4.5a.75.75 0 000-1.5h-3.75V6z" clip-rule="evenodd"/></svg>
      <p>${chrome.i18n.getMessage('emptyHistory')}</p>
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

  // 最近閉じたタブを描画
  if (recentSessions.length > 0) {
    const recentGroupEl = document.createElement('div');
    recentGroupEl.className = 'history-group';

    const recentDateEl = document.createElement('div');
    recentDateEl.className = 'history-date';
    recentDateEl.textContent = chrome.i18n.getMessage('recentlyClosedHeader');
    recentGroupEl.appendChild(recentDateEl);

    recentSessions.forEach(session => {
      let extItem = null;
      let isWindow = false;
      if (session.tab) extItem = session.tab;
      else if (session.window) {
        extItem = { title: `${session.window.tabs.length} tabs`, url: '', lastModified: session.lastModified };
        isWindow = true; // For now simplify representation of window
      }
      if (!extItem) return;

      const el = document.createElement('div');
      el.className = 'history-item';

      const faviconUrl = isWindow ? '' : getFaviconUrl(extItem.url);
      const title = extItem.title || extItem.url;
      const url = extItem.url || '';

      el.innerHTML = `
        ${isWindow
          ? `<svg class="history-favicon" viewBox="0 0 20 20" fill="currentColor" style="color:var(--text-muted)"><path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z"/><path fill-rule="evenodd" d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z" clip-rule="evenodd"/></svg>`
          : (faviconUrl ? `<img class="history-favicon" src="${escapeHtml(faviconUrl)}" onerror="this.style.display='none'" alt="">` : `<svg class="history-favicon" viewBox="0 0 16 16" fill="currentColor" style="color:var(--text-muted)"><path d="M0 2a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H2a2 2 0 01-2-2V2zm3 1v10h10V3H3z"/></svg>`)
        }
        <div class="history-info">
          <div class="history-title">${escapeHtml(title)}</div>
          <div class="history-url">${escapeHtml(url)}</div>
        </div>
        <div class="history-time">${formatTime(session.lastModified * 1000)}</div>
        <button class="history-remove" title="Restore">
          <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1z" clip-rule="evenodd"/></svg>
        </button>
      `;

      el.addEventListener('click', (e) => {
        if (e.target.closest('.history-remove')) {
          chrome.sessions.restore(session.sessionId);
          el.remove();
        } else {
          if (!isWindow) chrome.tabs.create({ url: extItem.url });
        }
      });
      recentGroupEl.appendChild(el);
    });
    container.appendChild(recentGroupEl);

    // Add separator if there are standard history items
    if (Object.keys(groups).length > 0) {
      const sep = document.createElement('div');
      sep.className = 'history-date';
      sep.style.marginTop = '16px';
      sep.textContent = chrome.i18n.getMessage('historyListHeader');
      container.appendChild(sep);
    }
  }
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
        <button class="history-remove" title="${chrome.i18n.getMessage('ctxDelete')}">
          <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
        </button>
      `;

      el.addEventListener('click', (e) => {
        if (e.target.closest('.history-remove')) return;
        chrome.tabs.create({ url: item.url, active: !!state.userSettings.closeOnSelect });
        // 最近使用したブックマーク更新
        updateRecentlyUsed(item.url);

        if (state.userSettings.closeOnSelect) {
          window.close();
        }
      });

      el.querySelector('.history-remove').addEventListener('click', async (e) => {
        e.stopPropagation();
        await chrome.history.deleteUrl({ url: item.url });
        el.remove();
        showToast(chrome.i18n.getMessage('toastHistoryDeleted'));
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

document.getElementById('btn-refresh-history').addEventListener('click', () => {
  const query = document.getElementById('history-search').value.trim();
  loadHistory(query);
});

// 履歴ソート
document.querySelectorAll('#panel-history .sort-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#panel-history .sort-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.historySortMode = btn.dataset.sort;
    loadHistory(document.getElementById('history-search').value.trim());
  });
});

// ===== ブックマークパネル =====
let bookmarkSearchTimeout = null;

async function loadBookmarks() {
  const container = document.getElementById('bookmark-list');
  if (state.bookmarkTree) {
    renderBookmarks();
    return;
  }

  container.innerHTML = `<div class="loading" data-i18n="msgLoading">${chrome.i18n.getMessage('msgLoading')}</div>`;

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
    container.innerHTML = `<div class="empty-state"><p>${chrome.i18n.getMessage('emptyBookmarkLoadFail')}</p></div>`;
  }
}

function flattenBookmarks(nodes, pathObjects = []) {
  const result = [];
  nodes.forEach(node => {
    if (node.url) {
      result.push({ ...node, pathObjects });
    } else if (node.children) {
      const newPath = [...pathObjects, { id: node.id, title: node.title }];
      result.push(...flattenBookmarks(node.children, newPath));
    }
  });
  return result;
}

function navigateToBookmarkFolder(folderId, pathIds) {
  state.bookmarkSortMode = 'tree';
  // すべての親フォルダを展開状態にする
  pathIds.forEach(id => {
    state.bookmarkFolderState[id] = false; // collapsed = false
  });
  state.bookmarkFolderState[folderId] = false;

  // UIのソートボタン状態を更新
  document.querySelectorAll('#panel-bookmarks .sort-btn').forEach(btn => {
    if (btn.parentNode.id === 'bookmark-sort-modes') {
      btn.classList.toggle('active', btn.dataset.sort === 'tree');
    }
  });

  renderBookmarks();

  // スクロール
  setTimeout(() => {
    const folderHeader = document.querySelector(`.bookmark-folder-header[data-folder-id="${folderId}"]`);
    if (folderHeader) {
      folderHeader.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // 一時的にハイライト
      folderHeader.style.background = 'var(--bg-active)';
      setTimeout(() => { folderHeader.style.background = ''; }, 1000);
    }
  }, 100);
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
      <p>${chrome.i18n.getMessage('emptyBookmarks')}</p>
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
    if (state.userSettings.bookmarkVisitCount) {
      const count = state.visitCountMap[item.url] || 0;
      dateStr = count > 0 ? chrome.i18n.getMessage('bookmarkCount', [count.toLocaleString()]) : '';
    } else {
      dateStr = '';
    }
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
      ${(state.bookmarkSortMode !== 'tree' && item.pathObjects && item.pathObjects.length > 0) ? `
        <div class="bookmark-path">
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/>
          </svg>
          <div class="breadcrumb-list">
            ${item.pathObjects.map((p, idx) => `
              <span class="breadcrumb-link" data-folder-id="${p.id}" data-idx="${idx}">${escapeHtml(p.title)}</span>
              ${idx < item.pathObjects.length - 1 ? '<span class="breadcrumb-separator">/</span>' : ''}
            `).join('')}
          </div>
        </div>
      ` : ''}
      <div class="bookmark-url">${escapeHtml(item.url)}</div>
    </div>
    ${dateStr ? `<div class="bookmark-date">${escapeHtml(dateStr)}</div>` : ''}
  `;

  el.addEventListener('click', (e) => {
    const breadcrumb = e.target.closest('.breadcrumb-link');
    if (breadcrumb) {
      e.stopPropagation();
      const folderId = breadcrumb.dataset.folderId;
      const idx = parseInt(breadcrumb.dataset.idx);
      const pathIds = item.pathObjects.slice(0, idx).map(p => p.id);
      navigateToBookmarkFolder(folderId, pathIds);
      return;
    }

    chrome.tabs.create({ url: item.url, active: !!state.userSettings.closeOnSelect });
    updateRecentlyUsed(item.url);

    if (state.userSettings.closeOnSelect) {
      window.close();
    }
  });

  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, [
      {
        label: chrome.i18n.getMessage('ctxOpenNewTab'),
        icon: `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z"/></svg>`,
        action: () => chrome.tabs.create({ url: item.url })
      },
      {
        label: chrome.i18n.getMessage('ctxCopyUrl'),
        icon: `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M8 2a1 1 0 000 2h2a1 1 0 100-2H8z"/></svg>`,
        action: () => {
          navigator.clipboard.writeText(item.url).then(() => showToast(chrome.i18n.getMessage('toastUrlCopied'), 'success'));
        }
      },
      { separator: true },
      {
        label: chrome.i18n.getMessage('ctxEdit'),
        icon: `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>`,
        action: async () => {
          const newTitle = prompt(chrome.i18n.getMessage('promptNewTitle'), item.title);
          if (newTitle === null) return;
          const newUrl = prompt(chrome.i18n.getMessage('promptNewUrl'), item.url);
          if (newUrl === null) return;

          try {
            await chrome.bookmarks.update(item.id, { title: newTitle, url: newUrl });
            showToast(chrome.i18n.getMessage('toastBookmarkUpdated'), 'success');
            state.bookmarkTree = null;
            loadBookmarks();
          } catch (err) {
            console.error('Failed to update bookmark', err);
            showToast(chrome.i18n.getMessage('toastBookmarkUpdateFailed'), 'error');
          }
        }
      },
      {
        label: chrome.i18n.getMessage('ctxDelete'),
        icon: `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>`,
        danger: true,
        action: async () => {
          if (confirm(chrome.i18n.getMessage('confirmDeleteBookmark', [item.title || item.url]))) {
            try {
              await chrome.bookmarks.remove(item.id);
              showToast(chrome.i18n.getMessage('toastBookmarkDeleted'), 'success');
              state.bookmarkTree = null;
              loadBookmarks();
            } catch (err) {
              console.error('Failed to remove bookmark', err);
              showToast(chrome.i18n.getMessage('toastBookmarkDeleteFailed'), 'error');
            }
          }
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
        // デフォルト設定：ルート(depth 0)は展開、それ以外は折りたたみ
        const isCollapsed = state.bookmarkFolderState[node.id] !== undefined
          ? state.bookmarkFolderState[node.id]
          : depth > 0;

        folderEl.className = `bookmark-folder ${isCollapsed ? 'collapsed' : ''}`;

        const header = document.createElement('div');
        header.className = 'bookmark-folder-header';
        header.dataset.folderId = node.id;
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
          <span class="bookmark-folder-name">${escapeHtml(node.title || chrome.i18n.getMessage('defaultFolder'))}</span>
          <span class="bookmark-folder-count">${countBookmarks(node.children)}</span>
        `;
        header.addEventListener('click', () => {
          const currentlyCollapsed = state.bookmarkFolderState[node.id] !== undefined
            ? state.bookmarkFolderState[node.id]
            : depth > 0;
          state.bookmarkFolderState[node.id] = !currentlyCollapsed;
          folderEl.classList.toggle('collapsed', !currentlyCollapsed);
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

// ソートボタン機能
function updateVisitCountToggleBtn() {
  const toggleBtn = document.getElementById('btn-toggle-visit-count');
  if (!toggleBtn) return;
  if (state.bookmarkSortMode === 'most-visited') {
    toggleBtn.classList.remove('hidden');
    if (state.userSettings.bookmarkVisitCount) {
      toggleBtn.style.color = "var(--theme-color)";
      toggleBtn.style.background = "color-mix(in srgb, var(--theme-color) 12%, transparent)";
    } else {
      toggleBtn.style.color = "var(--text-muted)";
      toggleBtn.style.background = "var(--bg-tertiary)";
    }
  } else {
    toggleBtn.classList.add('hidden');
  }
}

document.querySelectorAll('#panel-bookmarks .sort-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#panel-bookmarks .sort-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.bookmarkSortMode = btn.dataset.sort;
    updateVisitCountToggleBtn();
    renderBookmarks();
  });
});

const vcToggle = document.getElementById('btn-toggle-visit-count');
if (vcToggle) {
  vcToggle.addEventListener('click', () => {
    state.userSettings.bookmarkVisitCount = !state.userSettings.bookmarkVisitCount;
    saveUserSettings();
    updateVisitCountToggleBtn();
    const cbBookmark = document.getElementById('setting-bookmark-visit');
    if (cbBookmark) cbBookmark.checked = state.userSettings.bookmarkVisitCount;
    renderBookmarks();
  });
}
updateVisitCountToggleBtn();

// ブックマーク検索
document.getElementById('bookmark-search').addEventListener('input', (e) => {
  clearTimeout(bookmarkSearchTimeout);
  state.bookmarkQuery = e.target.value.trim();
  bookmarkSearchTimeout = setTimeout(() => {
    renderBookmarks();
  }, 200);
});

// ===== リーディングリストパネル =====
let readingListSearchTimeout = null;
let readingListQuery = '';

async function loadReadingList() {
  const container = document.getElementById('reading-list-container');
  if (!container) return;
  container.innerHTML = `<div class="loading" data-i18n="msgLoading">${chrome.i18n.getMessage('msgLoading')}</div>`;

  try {
    const entries = await chrome.readingList.query({});
    renderReadingList(entries);
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><p>${chrome.i18n.getMessage('emptyReadingListLoadFail')}</p></div>`;
  }
}

function renderReadingList(entries) {
  const container = document.getElementById('reading-list-container');
  if (!container) return;

  let filtered = entries;
  if (readingListQuery) {
    const q = readingListQuery.toLowerCase();
    filtered = entries.filter(e =>
      (e.title || '').toLowerCase().includes(q) ||
      (e.url || '').toLowerCase().includes(q)
    );
  }

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 12h5v2h-5zM10 9h5v2h-5zM10 6h5v2h-5zM9 13v-1H4a1 1 0 01-1-1V5a1 1 0 011-1h5V3a1 1 0 011-1h6a1 1 0 011 1v10a1 1 0 01-1 1h-6a1 1 0 01-1-1zM5 11h3V5H5v6z"/></svg>
      <p>${chrome.i18n.getMessage('emptyReadingList')}</p>
    </div>`;
    return;
  }

  // 未読を先に表示、次に更新日時順
  filtered.sort((a, b) => {
    if (a.hasBeenRead === b.hasBeenRead) return (b.lastUpdateTime || 0) - (a.lastUpdateTime || 0);
    return a.hasBeenRead ? 1 : -1;
  });

  container.innerHTML = '';
  filtered.forEach(entry => {
    const el = document.createElement('div');
    el.className = `history-item reading-list-item ${entry.hasBeenRead ? 'read' : 'unread'}`;
    const faviconUrl = getFaviconUrl(entry.url);

    el.innerHTML = `
      ${faviconUrl
        ? `<img class="history-favicon" src="${escapeHtml(faviconUrl)}" onerror="this.style.display='none'" alt="">`
        : `<svg class="history-favicon" viewBox="0 0 16 16" fill="currentColor" style="color:var(--text-muted)"><path d="M0 2a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H2a2 2 0 01-2-2V2zm3 1v10h10V3H3z"/></svg>`
      }
      <div class="history-info">
        <div class="history-title">${highlightText(entry.title || entry.url, readingListQuery)}</div>
        <div class="history-url">${highlightText(entry.url, readingListQuery)}</div>
      </div>
      <div class="reading-list-actions">
        <button class="action-btn-sm toggle-read" title="${entry.hasBeenRead ? chrome.i18n.getMessage('toastReadingListMarkUnread') : chrome.i18n.getMessage('toastReadingListMarkRead')}">
          ${entry.hasBeenRead
        ? '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd"/></svg>'
        : '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>'
      }
        </button>
        <button class="action-btn-sm remove-entry" title="${chrome.i18n.getMessage('ctxDelete')}">
          <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
        </button>
      </div>
    `;

    el.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      chrome.tabs.create({ url: entry.url });
    });

    el.querySelector('.toggle-read').addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await chrome.readingList.updateEntry({
          url: entry.url,
          hasBeenRead: !entry.hasBeenRead
        });
        loadReadingList();
      } catch (err) {
        console.error('Failed to update reading list entry', err);
      }
    });

    el.querySelector('.remove-entry').addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await chrome.readingList.removeEntry({ url: entry.url });
        loadReadingList();
      } catch (err) {
        console.error('Failed to remove reading list entry', err);
      }
    });

    container.appendChild(el);
  });
}

// 検索
document.getElementById('reading-list-search').addEventListener('input', (e) => {
  clearTimeout(readingListSearchTimeout);
  readingListQuery = e.target.value.trim();
  readingListSearchTimeout = setTimeout(() => {
    loadReadingList();
  }, 200);
});

// リーディングリスト更新の監視
if (chrome.readingList) {
  const onRLChange = () => {
    if (document.getElementById('panel-readingList').classList.contains('active')) {
      loadReadingList();
    }
  };
  chrome.readingList.onEntryAdded?.addListener(onRLChange);
  chrome.readingList.onEntryRemoved?.addListener(onRLChange);
  chrome.readingList.onEntryUpdated?.addListener(onRLChange);
}

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

    case 'GOOGLE_TASKS_UPDATED':
      refreshGoogleTasks();
      break;

    case 'SETTINGS_UPDATED':
      state.userSettings = { ...state.userSettings, ...message.settings };
      renderSettingsPanel();
      break;
  }
});

// ===== 初期化 =====
async function init() {
  localizeHtmlPage();
  await loadUserSettings();
  await loadTabConfig();
  renderNavTabs();
  renderSettingsPanel();
  applyColorScheme();
  applyThemeColor(state.userSettings.themeColor || 'blue');
  applyToggleSize();
  applyFocusIntensity();
  applyCloseOnSelectUI();
  applyTabFontSize();
  applyTabSelectionAnimationUI();
  await refreshGoogleTasks();
  await loadTabs();
}

async function refreshGoogleTasks() {
  try {
    const res = await sendMessage('GET_GOOGLE_TASKS');
    state.googleTasks = res.tasks || {};
    renderTabs();
  } catch (e) { }
}

init().catch(console.error);


// ===== i18n Localization =====
function localizeHtmlPage() {
  document.documentElement.lang = chrome.i18n.getUILanguage().split('-')[0];
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.innerHTML = chrome.i18n.getMessage(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = chrome.i18n.getMessage(el.getAttribute('data-i18n-title'));
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = chrome.i18n.getMessage(el.getAttribute('data-i18n-placeholder'));
  });
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', localizeHtmlPage);
} else {
  localizeHtmlPage();
}
let recentTimeUpdateInterval = null;
function startRecentTimeUpdateTimer() {
  if (recentTimeUpdateInterval) return;
  recentTimeUpdateInterval = setInterval(() => {
    if (state.tabSortMode === 'recent') {
      renderTabTree();
    }
  }, 10000); // 10秒おきに再描画
}
function stopRecentTimeUpdateTimer() {
  if (recentTimeUpdateInterval) {
    clearInterval(recentTimeUpdateInterval);
    recentTimeUpdateInterval = null;
  }
}

function applyToggleSize() {
  const size = state.userSettings.toggleSize || 'medium';
  document.body.setAttribute('data-toggle-size', size);
}

function applyFocusIntensity() {
  const intensity = state.userSettings.focusIntensity || 'medium';
  document.body.setAttribute('data-focus-intensity', intensity);
}

function applyCloseOnSelectUI() {
  const isEnabled = !!state.userSettings.closeOnSelect;
  const btn = document.getElementById('btn-toggle-close-on-select');
  if (btn) {
    btn.classList.toggle('active', isEnabled);
  }
  const cb = document.getElementById('setting-close-on-select');
  if (cb) {
    cb.checked = isEnabled;
  }
}

function applyTabFontSize() {
  const size = state.userSettings.tabFontSize || 12;
  document.body.style.setProperty('--tab-font-size', `${size}px`);
  document.body.style.setProperty('--tab-url-font-size', `${Math.max(10, size - 2)}px`);
}

function applyTabSelectionAnimationUI() {
  const isEnabled = state.userSettings.tabSelectionAnimation !== false; // default true
  const btn = document.getElementById('btn-toggle-selection-animation');
  if (btn) {
    btn.classList.toggle('active', isEnabled);
  }
  const cb = document.getElementById('setting-tab-selection-animation');
  if (cb) {
    cb.checked = isEnabled;
  }
  if (isEnabled) {
    document.body.classList.remove('disable-selection-animation');
  } else {
    document.body.classList.add('disable-selection-animation');
  }
}

// サイドパネルのフォーカス状態を管理
function updateFocusState() {
  if (document.hasFocus()) {
    document.body.classList.add('sidepanel-focused');
  } else {
    document.body.classList.remove('sidepanel-focused');
  }
}

window.addEventListener('focus', updateFocusState);
window.addEventListener('blur', updateFocusState);
// 初期実行
updateFocusState();
