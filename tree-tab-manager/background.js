// Tree Tab Manager - Background Service Worker

// タブの親子関係を管理するマップ (tabId -> parentTabId)
const tabParentMap = new Map();
// タブのカスタムツリー情報 (tabId -> { collapsed, customParent })
const tabMetadata = new Map();

// 拡張機能のインストール/起動時にサイドパネルを設定
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// アクションボタンクリックでサイドパネルを開く
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// コマンドリスナー（ショートカットキー）
// chrome.commands.onCommand.addListener(async (command) => {
//   if (command === 'toggle-mini-tree') {
//     const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
//     if (!activeTab) return;
//     if (!activeTab.url || activeTab.url.startsWith('chrome://') || activeTab.url.startsWith('about:') || activeTab.url.startsWith('chrome-extension://')) return;
//     chrome.tabs.sendMessage(activeTab.id, { type: 'TOGGLE_MINI_TREE' }).catch(() => { });
//   }
// });

// タブ作成時に親子関係を記録
chrome.tabs.onCreated.addListener(async (tab) => {
  let parentId = tab.openerTabId;

  // リンクを踏んだ場合の親子関係を捕捉するためのヒューリスティック
  // openerTabId が無い場合、現在同一ウィンドウでアクティブなタブを親候補とする
  if (parentId === undefined) {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
      if (activeTab && activeTab.id !== tab.id && activeTab.url && !activeTab.url.startsWith('chrome://')) {
        parentId = activeTab.id;
      }
    } catch (e) {
      console.error('[TTM] Failed to query active tab for parent heuristic:', e);
    }
  }

  if (parentId !== undefined) {
    tabParentMap.set(tab.id, parentId);
  }

  // メタデータ初期化
  tabMetadata.set(tab.id, { collapsed: false });
  // サイドパネルに通知
  notifyPanels({ type: 'TAB_CREATED', tabId: tab.id });

  // ツリーモードなら物理的な並び替えを同期
  const res = await chrome.storage.local.get('ttm-tab-sort-mode');
  if (res['ttm-tab-sort-mode'] === 'tree') {
    await syncPhysicalTabsWithTree();
  }
});

// タブ更新時に通知
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.title || changeInfo.favIconUrl || 'groupId' in changeInfo) {
    // グループが変更された場合、すべての子孫も同じグループに入れる（ユーザーリクエスト）
    if ('groupId' in changeInfo) {
      const descendants = getDescendantIds(tabId);
      if (descendants.length > 0) {
        try {
          if (changeInfo.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
            await chrome.tabs.ungroup(descendants);
          } else {
            await chrome.tabs.group({
              groupId: changeInfo.groupId,
              tabIds: descendants
            });
          }
        } catch (e) {
          console.error('[TTM] Failed to sync descendant groups:', e);
        }
      }
    }
    notifyPanels({ type: 'TAB_UPDATED', tabId, changeInfo });
  }
});

// 子孫タブのIDをすべて取得（再帰）
function getDescendantIds(tabId) {
  let ids = [];
  for (const [childId, parentId] of tabParentMap.entries()) {
    if (parentId === tabId) {
      ids.push(childId);
      ids = ids.concat(getDescendantIds(childId));
    }
  }
  return ids;
}

// タブ削除時に親子関係をクリーンアップ
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  const currentParentId = tabParentMap.get(tabId);
  tabParentMap.delete(tabId);
  tabMetadata.delete(tabId);

  // 削除されたタブの子タブの親を削除タブの親に変更（リフト）
  for (const [childId, parentId] of tabParentMap.entries()) {
    if (parentId === tabId) {
      if (currentParentId !== undefined) {
        tabParentMap.set(childId, currentParentId);
      } else {
        tabParentMap.delete(childId);
      }
    }
  }
  notifyPanels({ type: 'TAB_REMOVED', tabId });
});

// タブ移動時に通知
chrome.tabs.onMoved.addListener((tabId, moveInfo) => {
  notifyPanels({ type: 'TAB_MOVED', tabId, moveInfo });
});

// タブアクティブ変更時に通知
chrome.tabs.onActivated.addListener((activeInfo) => {
  notifyPanels({ type: 'TAB_ACTIVATED', tabId: activeInfo.tabId });
});

// タブのピン状態変更時に通知
chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
  notifyPanels({ type: 'TAB_ATTACHED', tabId });
});

// タブグループ変更時に通知
chrome.tabGroups.onCreated.addListener(() => notifyPanels({ type: 'TREE_UPDATED' }));
chrome.tabGroups.onUpdated.addListener(() => notifyPanels({ type: 'TREE_UPDATED' }));
chrome.tabGroups.onRemoved.addListener(() => notifyPanels({ type: 'TREE_UPDATED' }));

// サイドパネルからのメッセージを処理
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'GET_TAB_PARENTS':
      sendResponse({ parents: Object.fromEntries(tabParentMap) });
      break;

    case 'SET_TAB_PARENT':
      if (message.parentId === null) {
        tabParentMap.delete(message.tabId);
      } else {
        tabParentMap.set(message.tabId, message.parentId);
      }
      notifyPanels({ type: 'TREE_UPDATED' });
      sendResponse({ success: true });
      break;

    case 'GET_TAB_METADATA':
      sendResponse({ metadata: Object.fromEntries(tabMetadata) });
      break;

    case 'SET_TAB_COLLAPSED':
      const meta = tabMetadata.get(message.tabId) || {};
      tabMetadata.set(message.tabId, { ...meta, collapsed: message.collapsed });
      sendResponse({ success: true });
      break;

    case 'CLOSE_TAB':
      chrome.tabs.remove(message.tabId).then(() => sendResponse({ success: true }));
      return true;

    case 'ACTIVATE_TAB':
      chrome.tabs.update(message.tabId, { active: true })
        .then(() => chrome.windows.update(message.windowId, { focused: true }))
        .then(() => sendResponse({ success: true }));
      return true;

    case 'PIN_TAB':
      chrome.tabs.update(message.tabId, { pinned: message.pinned })
        .then(() => sendResponse({ success: true }));
      return true;

    case 'NEW_TAB':
      chrome.tabs.create({ url: message.url || undefined, openerTabId: message.openerTabId || undefined })
        .then((tab) => {
          // openerTabId は onCreated のコールバックで取得できないケースがあるため
          // NEW_TAB ハンドラ側で明示的に親子関係を設定する
          if (message.openerTabId) {
            tabParentMap.set(tab.id, message.openerTabId);
          }
          notifyPanels({ type: 'TREE_UPDATED' });
          sendResponse({ tab });
        });
      return true;

    case 'GET_HISTORY':
      chrome.history.search({
        text: message.query || '',
        maxResults: message.maxResults || 100,
        startTime: message.startTime || (Date.now() - 7 * 24 * 60 * 60 * 1000)
      }).then((results) => sendResponse({ history: results }));
      return true;

    case 'SAVE_SESSION':
      saveSession(message.name).then((session) => sendResponse({ session }));
      return true;

    case 'LOAD_SESSIONS':
      loadSessions().then((sessions) => sendResponse({ sessions }));
      return true;

    case 'RESTORE_SESSION':
      restoreSession(message.sessionId).then(() => sendResponse({ success: true }));
      return true;

    case 'DELETE_SESSION':
      deleteSession(message.sessionId).then(() => sendResponse({ success: true }));
      return true;

    /* cases for MINI_TREE deactivated */
    // case 'GET_MINI_TREE_DATA': ...
    // case 'MINI_TREE_ACTIVATE_TAB': ...
    // case 'MINI_TREE_TOGGLE_COLLAPSE': ...
    // case 'MINI_TREE_MOVE_TAB': ...

  }
  return false;
});

// 全サイドパネルおよびミニツリーに通知
function notifyPanels(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // サイドパネルが開いていない場合はエラーを無視
  });
  // ミニツリーへの通知は非アクティブ化
  /*
  if (message.type === 'TREE_UPDATED' || message.type === 'TAB_CREATED' || ... ) { ... }
  */
}

// セッション保存
async function saveSession(name) {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const parents = Object.fromEntries(tabParentMap);
  const metadata = Object.fromEntries(tabMetadata);

  const session = {
    id: `session_${Date.now()}`,
    name: name || `セッション ${new Date().toLocaleString('ja-JP')}`,
    createdAt: Date.now(),
    tabs: tabs.map(tab => ({
      id: tab.id,
      url: tab.url,
      title: tab.title,
      favIconUrl: tab.favIconUrl,
      pinned: tab.pinned,
      index: tab.index,
      parentId: parents[tab.id] || null,
      collapsed: (metadata[tab.id] || {}).collapsed || false
    }))
  };

  const result = await chrome.storage.local.get('sessions');
  const sessions = result.sessions || [];
  sessions.unshift(session);
  // 最大20セッションを保持
  if (sessions.length > 20) sessions.splice(20);

  await chrome.storage.local.set({ sessions });
  return session;
}

// セッション一覧取得
async function loadSessions() {
  const result = await chrome.storage.local.get('sessions');
  return result.sessions || [];
}

// セッション復元
async function restoreSession(sessionId) {
  const result = await chrome.storage.local.get('sessions');
  const sessions = result.sessions || [];
  const session = sessions.find(s => s.id === sessionId);
  if (!session) return;

  // 新しいウィンドウでセッションを開く
  const pinnedTabs = session.tabs.filter(t => t.pinned);
  const normalTabs = session.tabs.filter(t => !t.pinned);

  const newWindow = await chrome.windows.create({
    url: pinnedTabs.length > 0 ? pinnedTabs[0].url : (normalTabs[0] ? normalTabs[0].url : 'chrome://newtab')
  });

  const tabIdMap = {}; // 旧ID -> 新ID

  // ピン留めタブを先に作成
  for (const tabData of pinnedTabs) {
    const tab = await chrome.tabs.create({
      windowId: newWindow.id,
      url: tabData.url,
      pinned: true
    });
    tabIdMap[tabData.id] = tab.id;
  }

  // 通常タブを作成
  for (const tabData of normalTabs) {
    if (tabData.url === (normalTabs[0] ? normalTabs[0].url : '') && Object.keys(tabIdMap).length === 0) {
      // 最初のタブはウィンドウ作成時に作られる
      tabIdMap[tabData.id] = newWindow.tabs[0].id;
    } else {
      const tab = await chrome.tabs.create({
        windowId: newWindow.id,
        url: tabData.url
      });
      tabIdMap[tabData.id] = tab.id;
    }
  }

  // 親子関係を復元
  for (const tabData of session.tabs) {
    const newTabId = tabIdMap[tabData.id];
    if (newTabId && tabData.parentId !== null) {
      const newParentId = tabIdMap[tabData.parentId];
      if (newParentId) {
        tabParentMap.set(newTabId, newParentId);
      }
    }
    if (newTabId && tabData.collapsed) {
      tabMetadata.set(newTabId, { collapsed: true });
    }
  }
}

// セッション削除
async function deleteSession(sessionId) {
  const result = await chrome.storage.local.get('sessions');
  const sessions = (result.sessions || []).filter(s => s.id !== sessionId);
  await chrome.storage.local.set({ sessions });
}

// ===== 物理タブの並び順同期 (ツリー形式) =====
let isSyncing = false;

// 定期的に実行 (5秒おき)
setInterval(async () => {
  if (isSyncing) return;
  const res = await chrome.storage.local.get('ttm-tab-sort-mode');
  if (res['ttm-tab-sort-mode'] === 'tree') {
    isSyncing = true;
    try {
      await syncPhysicalTabsWithTree();
    } finally {
      isSyncing = false;
    }
  }
}, 5000);

async function syncPhysicalTabsWithTree() {
  const windows = await chrome.windows.getAll({ populate: true });

  for (const win of windows) {
    const tabs = win.tabs;
    if (!tabs || tabs.length <= 1) continue;

    // 現在のウィンドウ内での親子関係を考慮してツリー構築
    const tabMap = new Map();
    tabs.forEach(t => tabMap.set(t.id, { id: t.id, children: [] }));

    const roots = [];
    tabs.forEach(t => {
      const parentId = tabParentMap.get(t.id);
      if (parentId && tabMap.has(parentId)) {
        tabMap.get(parentId).children.push(tabMap.get(t.id));
      } else {
        roots.push(tabMap.get(t.id));
      }
    });

    // ツリーを平坦化 (行きがけ順)
    const sortedIds = [];
    const flatten = (nodes) => {
      nodes.forEach(n => {
        sortedIds.push(n.id);
        if (n.children.length > 0) flatten(n.children);
      });
    };
    flatten(roots);

    // 現在の物理的なID並びと比較
    const currentIds = tabs.map(t => t.id);
    const hasChanged = sortedIds.some((id, idx) => id !== currentIds[idx]);

    if (hasChanged) {
      console.log("[TTM] Syncing tab order to match tree structure...");
      // 一括移動 (インデックス0から順番に配置)
      // 注意: ピン留めタブが混ざっている場合は、Chromeの制約でピン留めは前に、
      // 通常タブは後に配置されるため、完全な一致にならない場合がある
      try {
        await chrome.tabs.move(sortedIds, { windowId: win.id, index: 0 });
      } catch (e) {
        // タブが閉じられた直後などのエラーは無視
      }
    }
  }
}
