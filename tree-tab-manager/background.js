// Tree Tab Manager - Background Service Worker

// タブの親子関係を管理するマップ (tabId -> parentTabId)
const tabParentMap = new Map();
// タブのカスタムツリー情報 (tabId -> { collapsed, customParent })
const tabMetadata = new Map();

// 拡張機能のインストール/起動時にサイドパネルを設定
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  // コンテキストメニュー（右クリックメニュー）を作成
  chrome.contextMenus.create({
    id: "open-side-panel",
    title: chrome.i18n.getMessage('openContextMenu'),
    contexts: ["all"]
  });
});

// アクションボタンクリックでサイドパネルを開く
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// コンテキストメニューのクリックイベントをリッスン
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "open-side-panel") {
    // ChromeのサイドパネルAPIはバックグラウンドからの「閉じる」機能を直接サポートしていないため
    // 常に「開く（またはフォーカスする）」動作になる
    chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

// タブ作成時に親子関係を記録
chrome.tabs.onCreated.addListener((tab) => {
  if (tab.openerTabId !== undefined) {
    tabParentMap.set(tab.id, tab.openerTabId);
  }
  // メタデータ初期化
  tabMetadata.set(tab.id, { collapsed: false });
  // サイドパネルに通知
  notifyPanels({ type: 'TAB_CREATED', tabId: tab.id });
});

// タブ更新時に通知
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.title || changeInfo.favIconUrl || 'groupId' in changeInfo) {
    notifyPanels({ type: 'TAB_UPDATED', tabId, changeInfo });
  }
});

// タブ削除時に親子関係をクリーンアップ
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  tabParentMap.delete(tabId);
  tabMetadata.delete(tabId);
  // 削除されたタブの子タブの親を削除タブの親に変更（リフト）
  for (const [childId, parentId] of tabParentMap.entries()) {
    if (parentId === tabId) {
      const grandParent = tabParentMap.get(tabId);
      if (grandParent !== undefined) {
        tabParentMap.set(childId, grandParent);
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

  }
  return false;
});

// 全サイドパネルに通知
function notifyPanels(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // サイドパネルが開いていない場合はエラーを無視
  });
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
