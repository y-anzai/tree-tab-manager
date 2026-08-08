/**
 * service worker。ツールバーアイコンから side panel を開くことと、
 * BGA のタブでのみ side panel を有効にすることだけを担当する。
 */

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
    // 古い Chrome では未対応。その場合はアイコンクリックで手動的に開く。
  });
});

const BGA_HOST = 'boardgamearena.com';

async function syncPanelForTab(tabId, url) {
  const enabled = Boolean(url && url.includes(BGA_HOST));
  try {
    await chrome.sidePanel.setOptions({
      tabId,
      path: 'src/panel/index.html',
      enabled
    });
  } catch {
    // タブが既に閉じられている場合は無視してよい。
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' || changeInfo.url) {
    syncPanelForTab(tabId, changeInfo.url || tab.url);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab) syncPanelForTab(tabId, tab.url);
});
