// Tree Tab Manager - Background Service Worker

// タブの親子関係を管理するマップ (tabId -> parentTabId)
const tabParentMap = new Map();
// タブのカスタムツリー情報 (tabId -> { collapsed, customParent })
const tabMetadata = new Map();

// 保存用キー
const STORAGE_KEY_PARENTS = 'ttm-tab-parents';
const STORAGE_KEY_METADATA = 'ttm-tab-metadata';

// ブックマーク・歴史メタデータ キャッシュ (UX・描画安定性向上のため)
let bookmarksCache = null;
let bookmarksFlatListCache = null;
let recentlyUsedBookmarksCache = {};
let visitCountMapCache = {};

async function updateBookmarksCache() {
  try {
    const [tree, recentHistory] = await Promise.all([
      chrome.bookmarks.getTree(),
      chrome.history.search({ text: '', maxResults: 1000, startTime: Date.now() - 90 * 24 * 60 * 60 * 1000 })
    ]);

    bookmarksCache = tree;
    recentlyUsedBookmarksCache = {};
    visitCountMapCache = {};

    recentHistory.forEach(item => {
      if (!recentlyUsedBookmarksCache[item.url] || recentlyUsedBookmarksCache[item.url] < item.lastVisitTime) {
        recentlyUsedBookmarksCache[item.url] = item.lastVisitTime;
      }
      visitCountMapCache[item.url] = item.visitCount || 0;
    });

    bookmarksFlatListCache = flattenBookmarks(tree);
    console.log('[TTM] Bookmarks cache updated.');
    notifyPanels({ type: 'BOOKMARKS_UPDATED' });
  } catch (e) {
    console.error('[TTM] Failed to update bookmarks cache', e);
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

// 変更監視
chrome.bookmarks.onCreated.addListener(updateBookmarksCache);
chrome.bookmarks.onRemoved.addListener(updateBookmarksCache);
chrome.bookmarks.onChanged.addListener(updateBookmarksCache);
chrome.bookmarks.onMoved.addListener(updateBookmarksCache);
chrome.history.onVisited.addListener((result) => {
  updateBookmarksCache();
  notifyPanels({ type: 'HISTORY_UPDATED', visit: result });
});
chrome.history.onVisitRemoved.addListener(() => {
  updateBookmarksCache();
  notifyPanels({ type: 'HISTORY_UPDATED' });
});

// Google Tasks キャッシュ (url -> listName)
let googleTasksCache = new Map();

// 起動時にデータをロード
async function loadTreeData() {
  // キャッシュを先行して構築（非同期）
  updateBookmarksCache();
  const data = await chrome.storage.local.get([STORAGE_KEY_PARENTS, STORAGE_KEY_METADATA, 'ttm-last-tab-state', 'ttm-google-tasks-cache']);
  const savedParents = data[STORAGE_KEY_PARENTS] || {};
  const savedMetadata = data[STORAGE_KEY_METADATA] || {};
  const lastState = data['ttm-last-tab-state'] || [];

  if (data['ttm-google-tasks-cache']) {
    googleTasksCache = new Map(Object.entries(data['ttm-google-tasks-cache']));
  }

  const currentTabs = await chrome.tabs.query({});
  const tabIds = new Set(currentTabs.map(t => t.id));

  // 1. IDがそのまま生きているかチェック (拡張機能の再読込ケース)
  const isIdStable = lastState.length > 0 && lastState.some(t => tabIds.has(t.id));

  if (isIdStable) {
    console.log('[TTM] IDs are stable. Loading mapping directly.');
    for (const [id, parentId] of Object.entries(savedParents)) {
      tabParentMap.set(parseInt(id), parentId);
    }
    for (const [id, meta] of Object.entries(savedMetadata)) {
      tabMetadata.set(parseInt(id), meta);
    }
  } else if (lastState.length > 0) {
    // 2. ブラウザ再起動などでIDが書き換わっているケースの復旧
    console.log('[TTM] Browser restart detected. Attempting to recover tree via heuristics...');
    const oldToNewMap = new Map();
    const unmatchedNewTabs = [...currentTabs];

    // ヒューリスティックマッチング (URL + Title + Index)
    lastState.forEach(oldTab => {
      const matchIdx = unmatchedNewTabs.findIndex(t =>
        t.url === oldTab.url &&
        t.title === oldTab.title &&
        t.index === oldTab.index
      );
      if (matchIdx !== -1) {
        const newTab = unmatchedNewTabs.splice(matchIdx, 1)[0];
        oldToNewMap.set(oldTab.id, newTab.id);
      }
    });

    // 緩いマッチング (URLのみ)
    if (unmatchedNewTabs.length > 0) {
      lastState.forEach(oldTab => {
        if (oldToNewMap.has(oldTab.id)) return;
        const matchIdx = unmatchedNewTabs.findIndex(t => t.url === oldTab.url);
        if (matchIdx !== -1) {
          const newTab = unmatchedNewTabs.splice(matchIdx, 1)[0];
          oldToNewMap.set(oldTab.id, newTab.id);
        }
      });
    }

    // マッピングに基づいて親子関係とメタデータを復元
    for (const [oldId, oldParentId] of Object.entries(savedParents)) {
      const newId = oldToNewMap.get(parseInt(oldId));
      const newParentId = oldToNewMap.get(oldParentId);
      if (newId && newParentId) {
        tabParentMap.set(newId, newParentId);
      }
    }
    for (const [oldId, meta] of Object.entries(savedMetadata)) {
      const newId = oldToNewMap.get(parseInt(oldId));
      if (newId) {
        tabMetadata.set(newId, meta);
      }
    }
  }

  // 存在しないタブのクリーンアップ
  for (const id of tabParentMap.keys()) {
    if (!tabIds.has(id)) tabParentMap.delete(id);
  }
  for (const id of tabMetadata.keys()) {
    if (!tabIds.has(id)) tabMetadata.delete(id);
  }
  console.log(`[TTM] Tree recovered: ${tabParentMap.size} relationships`);
}

// データを保存
async function saveTreeData() {
  const tabs = await chrome.tabs.query({});
  const tabState = tabs.map(t => ({
    id: t.id,
    url: t.url,
    title: t.title,
    index: t.index,
    windowId: t.windowId
  }));

  await chrome.storage.local.set({
    [STORAGE_KEY_PARENTS]: Object.fromEntries(tabParentMap),
    [STORAGE_KEY_METADATA]: Object.fromEntries(tabMetadata),
    'ttm-last-tab-state': tabState
  });
}

// 初期化実行
loadTreeData();

// Google Tasks 同期
async function fetchGoogleTasks() {
  try {
    const token = await new Promise((resolve) => {
      chrome.identity.getAuthToken({ interactive: false }, (t) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(t);
      });
    });
    if (!token) return;

    const listsRes = await fetch('https://www.googleapis.com/tasks/v1/users/@me/lists', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const lists = await listsRes.json();
    if (!lists.items) return;

    const newCache = new Map();
    for (const list of lists.items) {
      const tasksRes = await fetch(`https://www.googleapis.com/tasks/v1/lists/${list.id}/tasks`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const tasks = await tasksRes.json();
      if (tasks.items) {
        tasks.items.forEach(task => {
          const urlMatch = (task.notes || task.title || '').match(/https?:\/\/[^\s]+/);
          if (urlMatch) {
            newCache.set(urlMatch[0], {
              listName: list.title,
              listId: list.id,
              taskId: task.id,
              status: task.status // 'needsAction' or 'completed'
            });
          }
        });
      }
    }
    googleTasksCache = newCache;
    await chrome.storage.local.set({ 'ttm-google-tasks-cache': Object.fromEntries(newCache) });
    notifyPanels({ type: 'GOOGLE_TASKS_UPDATED' });
  } catch (e) {
    console.error('[TTM] Google Tasks fetch failed:', e);
  }
}

// 定期同期と初期同期
setInterval(fetchGoogleTasks, 3600000);
setTimeout(fetchGoogleTasks, 5000);

loadTreeData();

// 拡張機能のインストール/起動時にサイドパネルを設定
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get('ttm-user-settings');
  const settings = data['ttm-user-settings'] || {};
  const mode = settings.interactionMode || 'sidepanel';

  if (mode === 'popup') {
    chrome.action.setPopup({ popup: 'sidepanel/popup.html' });
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => { });
  } else {
    chrome.action.setPopup({ popup: '' });
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => { });
  }

  setupContextMenus();
});

// コンテキストメニュー作成を関数化して再呼び出し可能に
function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'add-to-snippets',
      title: chrome.i18n.getMessage('ctxAddSnippet'),
      contexts: ['selection']
    });
  });
}

// サービスワーカー起動時にも設定（安定性のため）
setupContextMenus();

// コンテキストメニュークリック
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'add-to-snippets') {
    try {
      // 1. まずメッセージを送ってみる
      await chrome.tabs.sendMessage(tab.id, { 
        type: 'CAPTURE_SNIPPET',
        selectionText: info.selectionText 
      });
    } catch (e) {
      console.log('[TTM] Content script not ready, injecting...');
      // 2. 失敗（未注入）なら注入して再試行
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content/snippets.js']
        });
        // 3. 注入完了直後だとリスナーの準備に極短時間かかる場合があるため、少し待ってから送信
        setTimeout(() => {
          chrome.tabs.sendMessage(tab.id, { 
            type: 'CAPTURE_SNIPPET',
            selectionText: info.selectionText 
          }).catch(err => console.error('[TTM] Retry sendMessage failed:', err));
        }, 100);
      } catch (err) {
        console.error("[TTM] Failed to inject snippets script:", err);
      }
    }
  }
});

// アクションボタンクリックでサイドパネルを開く（ポップアップ設定時は動かない）
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => { });
});

// コマンドリスナー（ショートカットキー）
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-interaction-mode') {
    const data = await chrome.storage.local.get('ttm-user-settings');
    const settings = data['ttm-user-settings'] || {};
    const currentMode = settings.interactionMode || 'sidepanel';
    const newMode = currentMode === 'sidepanel' ? 'popup' : 'sidepanel';

    settings.interactionMode = newMode;
    await chrome.storage.local.set({ 'ttm-user-settings': settings });

    // アクションの振る舞いを更新
    if (newMode === 'popup') {
      chrome.action.setPopup({ popup: 'sidepanel/popup.html' });
      chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => { });
    } else {
      chrome.action.setPopup({ popup: '' });
      chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => { });
    }

    // パネルが開いている場合は通知
    chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', settings }).catch(() => { });
  }
});

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

  // 保存
  await saveTreeData();

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
  if (changeInfo.status === 'complete' || changeInfo.title || changeInfo.favIconUrl || 'groupId' in changeInfo || 'audible' in changeInfo || 'mutedInfo' in changeInfo) {
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

  saveTreeData(); // 非同期で保存
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

    case 'GET_BOOKMARKS_CACHE':
      sendResponse({
        tree: bookmarksCache,
        flatList: bookmarksFlatListCache,
        recentlyUsed: recentlyUsedBookmarksCache,
        visitCounts: visitCountMapCache
      });
      break;

    case 'SET_TAB_PARENT':
      if (message.parentId === null) {
        tabParentMap.delete(message.tabId);
      } else {
        tabParentMap.set(message.tabId, message.parentId);
      }
      saveTreeData();
      notifyPanels({ type: 'TREE_UPDATED' });
      sendResponse({ success: true });
      break;

    case 'GET_TAB_METADATA':
      sendResponse({ metadata: Object.fromEntries(tabMetadata) });
      break;

    case 'SET_TAB_COLLAPSED':
      const meta = tabMetadata.get(message.tabId) || {};
      tabMetadata.set(message.tabId, { ...meta, collapsed: message.collapsed });
      saveTreeData();
      sendResponse({ success: true });
      break;

    case 'CLOSE_TAB':
      chrome.tabs.remove(message.tabId).then(() => sendResponse({ success: true }));
      return true;

    case 'ACTIVATE_TAB':
      chrome.tabs.update(message.tabId, { active: true })
        .then(() => {
          if (message.focusWindow !== false) {
            return chrome.windows.update(message.windowId, { focused: true });
          }
        })
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
            saveTreeData();
          }
          notifyPanels({ type: 'TREE_UPDATED' });
          sendResponse({ tab });
        });
      return true;

    case 'GET_GOOGLE_TASKS':
      sendResponse({ tasks: Object.fromEntries(googleTasksCache) });
      break;

    case 'GET_TASK_LISTS':
      (async () => {
        try {
          const token = await new Promise((resolve, reject) => {
            chrome.identity.getAuthToken({ interactive: false }, (t) => {
              if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
              else resolve(t);
            });
          });
          const res = await fetch('https://www.googleapis.com/tasks/v1/users/@me/lists', {
            headers: { Authorization: `Bearer ${token}` }
          });
          const data = await res.json();
          sendResponse({ success: true, lists: data.items || [] });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }
      })();
      return true;

    case 'TOGGLE_GOOGLE_TASK_STATUS':
      (async () => {
        try {
          const token = await new Promise((resolve, reject) => {
            chrome.identity.getAuthToken({ interactive: false }, (t) => {
              if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
              else resolve(t);
            });
          });
          const { listId, taskId, status } = message;
          const newStatus = status === 'completed' ? 'needsAction' : 'completed';

          const res = await fetch(`https://www.googleapis.com/tasks/v1/lists/${listId}/tasks/${taskId}`, {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              status: newStatus,
              completed: newStatus === 'completed' ? new Date().toISOString() : null
            })
          });

          if (!res.ok) throw new Error('Failed to update task status');
          const updatedTask = await res.json();

          // キャッシュ更新
          for (const [url, info] of googleTasksCache.entries()) {
            if (info.taskId === taskId) {
              info.status = updatedTask.status;
              break;
            }
          }
          await chrome.storage.local.set({ 'ttm-google-tasks-cache': Object.fromEntries(googleTasksCache) });
          notifyPanels({ type: 'GOOGLE_TASKS_UPDATED' });

          sendResponse({ success: true, status: updatedTask.status });
        } catch (e) {
          sendResponse({ success: false, error: e.message });
        }
      })();
      return true;

    case 'ADD_TO_GOOGLE_TODO':
      (async () => {
        try {
          const token = await new Promise((resolve, reject) => {
            console.log('[TTM] Requesting auth token...');
            chrome.identity.getAuthToken({ interactive: true }, (t) => {
              if (chrome.runtime.lastError) {
                console.error('[TTM] Auth token error:', chrome.runtime.lastError);
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                console.log('[TTM] Auth token received');
                resolve(t);
              }
            });
          });

          const listsRes = await fetch('https://www.googleapis.com/tasks/v1/users/@me/lists', {
            headers: { Authorization: `Bearer ${token}` }
          });
          const lists = await listsRes.json();

          let targetListId = message.listId;
          let targetListTitle = '';

          if (!targetListId) {
            const defaultList = lists.items?.[0];
            if (!defaultList) throw new Error('No list found');
            targetListId = defaultList.id;
            targetListTitle = defaultList.title;
          } else {
            const list = lists.items.find(l => l.id === targetListId);
            targetListTitle = list ? list.title : 'Task';
          }

          const res = await fetch(`https://www.googleapis.com/tasks/v1/lists/${targetListId}/tasks`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              title: message.title,
              notes: message.url
            })
          });

          if (!res.ok) throw new Error('Failed to create task');
          const newTask = await res.json();

          googleTasksCache.set(message.url, {
            listName: targetListTitle,
            listId: targetListId,
            taskId: newTask.id,
            status: newTask.status
          });
          await chrome.storage.local.set({ 'ttm-google-tasks-cache': Object.fromEntries(googleTasksCache) });
          notifyPanels({ type: 'GOOGLE_TASKS_UPDATED' });

          sendResponse({ success: true, listName: targetListTitle });
        } catch (e) {
          console.error('[TTM] Google Todo add failed:', e);
          sendResponse({ success: false, error: e.message });
        }
      })();
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

    case 'SAVE_SNIPPET':
      (async () => {
        try {
          console.log("[TTM] Saving snippet:", message.snippet);
          const result = await chrome.storage.local.get('ttm-snippets');
          let snippets = result['ttm-snippets'];
          if (!Array.isArray(snippets)) snippets = [];
          snippets.unshift(message.snippet);
          await chrome.storage.local.set({ 'ttm-snippets': snippets });
          notifyPanels({ type: 'SNIPPETS_UPDATED' });
          sendResponse({ success: true });
        } catch (e) {
          console.error("[TTM] Failed to save snippet:", e);
          sendResponse({ success: false, error: e.message });
        }
      })();
      return true;

    case 'GET_SNIPPETS':
      chrome.storage.local.get('ttm-snippets').then(res => {
        sendResponse({ snippets: res['ttm-snippets'] || [] });
      });
      return true;

    case 'GET_SNIPPET_FOLDERS':
      chrome.storage.local.get('ttm-snippet-folders').then(res => {
        sendResponse({ folders: res['ttm-snippet-folders'] || [] });
      });
      return true;

    case 'DELETE_SNIPPET':
      (async () => {
        const result = await chrome.storage.local.get('ttm-snippets');
        const snippets = (result['ttm-snippets'] || []).filter(s => s.id !== message.id);
        await chrome.storage.local.set({ 'ttm-snippets': snippets });
        notifyPanels({ type: 'SNIPPETS_UPDATED' });
        sendResponse({ success: true });
      })();
      return true;

    case 'UPDATE_SNIPPET':
      (async () => {
        const result = await chrome.storage.local.get('ttm-snippets');
        let snippets = result['ttm-snippets'] || [];
        const idx = snippets.findIndex(s => s.id === message.snippet.id);
        if (idx !== -1) {
          snippets[idx] = { ...snippets[idx], ...message.snippet };
          await chrome.storage.local.set({ 'ttm-snippets': snippets });
          notifyPanels({ type: 'SNIPPETS_UPDATED' });
        }
        sendResponse({ success: true });
      })();
      return true;

    case 'CREATE_SNIPPET_FOLDER':
      (async () => {
        const result = await chrome.storage.local.get('ttm-snippet-folders');
        const folders = result['ttm-snippet-folders'] || [];
        folders.push(message.folder);
        await chrome.storage.local.set({ 'ttm-snippet-folders': folders });
        notifyPanels({ type: 'SNIPPETS_UPDATED' });
        sendResponse({ success: true });
      })();
      return true;

    case 'UPDATE_SNIPPET_FOLDER':
      (async () => {
        const result = await chrome.storage.local.get('ttm-snippet-folders');
        let folders = result['ttm-snippet-folders'] || [];
        const idx = folders.findIndex(f => f.id === message.id);
        if (idx !== -1) {
          folders[idx] = { ...folders[idx], ...message.folder };
          await chrome.storage.local.set({ 'ttm-snippet-folders': folders });
          notifyPanels({ type: 'SNIPPETS_UPDATED' });
        }
        sendResponse({ success: true });
      })();
      return true;

    case 'DELETE_SNIPPET_FOLDER':
      (async () => {
        const foldersResult = await chrome.storage.local.get('ttm-snippet-folders');
        const folders = (foldersResult['ttm-snippet-folders'] || []).filter(f => f.id !== message.id);
        await chrome.storage.local.set({ 'ttm-snippet-folders': folders });

        // フォルダー内のスニペットをルートに移動
        const snippetsResult = await chrome.storage.local.get('ttm-snippets');
        const snippets = (snippetsResult['ttm-snippets'] || []).map(s => {
          if (s.folderId === message.id) delete s.folderId;
          return s;
        });
        await chrome.storage.local.set({ 'ttm-snippets': snippets });

        notifyPanels({ type: 'SNIPPETS_UPDATED' });
        sendResponse({ success: true });
      })();
      return true;

    case 'REORDER_SNIPPETS':
      (async () => {
        await chrome.storage.local.set({ 'ttm-snippets': message.snippets });
        notifyPanels({ type: 'SNIPPETS_UPDATED' });
        sendResponse({ success: true });
      })();
      return true;

    case 'MOVE_SNIPPET_TO_FOLDER':
      (async () => {
        const result = await chrome.storage.local.get('ttm-snippets');
        let snippets = result['ttm-snippets'] || [];
        const idx = snippets.findIndex(s => s.id === message.snippetId);
        if (idx !== -1) {
          if (message.folderId) {
            snippets[idx].folderId = message.folderId;
          } else {
            delete snippets[idx].folderId;
          }
          await chrome.storage.local.set({ 'ttm-snippets': snippets });
          notifyPanels({ type: 'SNIPPETS_UPDATED' });
        }
        sendResponse({ success: true });
      })();
      return true;

    case 'INCREMENT_SNIPPET_CLICK':
      (async () => {
        const result = await chrome.storage.local.get('ttm-snippets');
        let snippets = result['ttm-snippets'] || [];
        const idx = snippets.findIndex(s => s.id === message.id);
        if (idx !== -1) {
          snippets[idx].clickCount = (snippets[idx].clickCount || 0) + 1;
          await chrome.storage.local.set({ 'ttm-snippets': snippets });
          notifyPanels({ type: 'SNIPPETS_UPDATED' });
        }
        sendResponse({ success: true });
      })();
      return true;

    case 'NAVIGATE_TO_SNIPPET':
      (async () => {
        const { url, scrollY, text } = message;
        const tabs = await chrome.tabs.query({});
        let targetTab = tabs.find(t => t.url === url);

        async function doScroll(tabId) {
          try {
            await chrome.tabs.sendMessage(tabId, { type: 'SCROLL_TO_POSITION', scrollY, text });
          } catch (err) {
            // Content script not loaded yet or missing, inject it then retry
            try {
              await chrome.scripting.executeScript({
                target: { tabId },
                files: ['content/snippets.js']
              });
            } catch (injErr) {
              // Ignore injection errors (e.g., chrome:// pages)
            }
            setTimeout(() => {
              chrome.tabs.sendMessage(tabId, { type: 'SCROLL_TO_POSITION', scrollY, text }).catch(() => {});
            }, 500);
          }
        }

        if (targetTab) {
          await chrome.tabs.update(targetTab.id, { active: true });
          await chrome.windows.update(targetTab.windowId, { focused: true });
          // SPA may need a moment to reactive its virtual DOM after tab re-focus
          setTimeout(() => doScroll(targetTab.id), 300);
        } else {
          targetTab = await chrome.tabs.create({ url });
          const listener = (tabId, changeInfo) => {
            if (tabId === targetTab.id && changeInfo.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              // Give extra time for React/SPA rendering (e.g. Gemini, Genspark)
              setTimeout(() => doScroll(tabId), 1000);
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
        }
        sendResponse({ success: true });
      })();
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

// 設定変更を監視して振る舞いを同期
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes['ttm-user-settings']) {
    const newSettings = changes['ttm-user-settings'].newValue;
    if (newSettings && newSettings.interactionMode) {
      const mode = newSettings.interactionMode;
      if (mode === 'popup') {
        chrome.action.setPopup({ popup: 'sidepanel/popup.html' });
        chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => { });
      } else {
        chrome.action.setPopup({ popup: '' });
        chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => { });
      }
    }
  }
});

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
