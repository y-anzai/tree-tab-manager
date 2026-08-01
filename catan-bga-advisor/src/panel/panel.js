/**
 * side panel の UI。content script から解析結果を受け取って描画し、
 * 表示設定と手動入力を content script に送り返す。
 */
(function () {
  'use strict';

  const DEFAULT_SETTINGS = {
    enabled: true,
    showPips: true,
    showProbability: false,
    highlightRed: true,
    showSpots: false
  };

  const RESOURCE_LABELS = {
    brick: 'レンガ',
    lumber: '木材',
    wool: '羊毛',
    grain: '小麦',
    ore: '鉱石',
    desert: '砂漠'
  };

  const HEX_COUNT = 19;

  const elements = {
    enabled: document.getElementById('toggle-enabled'),
    pips: document.getElementById('toggle-pips'),
    probability: document.getElementById('toggle-probability'),
    red: document.getElementById('toggle-red'),
    spots: document.getElementById('toggle-spots'),
    status: document.getElementById('status'),
    warnings: document.getElementById('warnings'),
    notes: document.getElementById('notes'),
    spotList: document.getElementById('spots'),
    robber: document.getElementById('robber'),
    scarcity: document.getElementById('scarcity'),
    manual: document.getElementById('manual'),
    refresh: document.getElementById('refresh')
  };

  /**
   * 現在アクティブな BGA タブに向けてメッセージを送る。
   * @param {object} message
   * @returns {Promise<any|null>} タブがない／content script 未注入なら null
   */
  async function sendToTab(message) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return null;
    try {
      return await chrome.tabs.sendMessage(tab.id, message);
    } catch {
      return null;
    }
  }

  function currentSettings() {
    return {
      enabled: elements.enabled.checked,
      showPips: elements.pips.checked,
      showProbability: elements.probability.checked,
      highlightRed: elements.red.checked,
      showSpots: elements.spots.checked
    };
  }

  async function pushSettings() {
    const settings = currentSettings();
    await chrome.storage.sync.set(settings);
    await sendToTab({ type: 'catan:setSettings', payload: settings });
  }

  function renderList(container, items, renderItem) {
    container.textContent = '';
    for (const item of items) container.appendChild(renderItem(item));
  }

  function listItem(text, level) {
    const li = document.createElement('li');
    li.textContent = text;
    if (level) li.dataset.level = level;
    return li;
  }

  function resourceLabel(resource) {
    return RESOURCE_LABELS[resource] || resource;
  }

  /**
   * 解析結果をパネル全体に反映する。
   * @param {object} analysis
   */
  function render(analysis) {
    const { hexes, numbers } = analysis.completeness;
    elements.status.textContent = `資源 ${hexes}/19・数字 ${numbers}/18 を認識（取得元: ${analysis.completeness.source}）`;

    renderList(elements.warnings, analysis.diagnostics?.warnings || [], (text) => listItem(text));
    renderList(elements.notes, analysis.notes || [], (note) => listItem(note.text, note.level));

    renderList(elements.spotList, analysis.topSpots || [], (spot) => {
      const li = document.createElement('li');
      const resources = Object.entries(spot.resources)
        .map(([resource, pips]) => `${resourceLabel(resource)}${pips}`)
        .join(' / ');
      const score = document.createElement('span');
      score.className = 'score';
      score.textContent = `評価 ${spot.score}（${spot.pips} ピップ）`;
      const why = document.createElement('span');
      why.className = 'why';
      why.textContent = `${resources}｜${spot.reasons.join('、')}`;
      li.append(score, why);
      return li;
    });

    renderList(elements.robber, analysis.robber || [], (entry) => {
      const li = document.createElement('li');
      const score = document.createElement('span');
      score.className = 'score';
      score.textContent = `評価 ${entry.score}`;
      const why = document.createElement('span');
      why.className = 'why';
      why.textContent = entry.reasons.join('、');
      li.append(score, why);
      return li;
    });

    const scarcityEntries = Object.entries(analysis.scarcity || {}).sort((a, b) => b[1] - a[1]);
    renderList(elements.scarcity, scarcityEntries, ([resource, value]) => {
      const li = document.createElement('li');
      li.textContent = `${resourceLabel(resource)}: ${value > 0.2 ? '希少' : '十分'}`;
      const bar = document.createElement('span');
      bar.className = 'bar';
      bar.style.width = `${Math.round(Math.min(1, value) * 60) + 4}px`;
      li.appendChild(bar);
      return li;
    });
  }

  /** 手動入力フォーム（19 行）を組み立てる。 */
  function buildManualForm() {
    elements.manual.textContent = '';
    for (let index = 0; index < HEX_COUNT; index += 1) {
      const label = document.createElement('label');
      label.textContent = `${index + 1}`;
      label.htmlFor = `manual-resource-${index}`;

      const resource = document.createElement('select');
      resource.id = `manual-resource-${index}`;
      resource.appendChild(new Option('—', ''));
      for (const key of Object.keys(RESOURCE_LABELS)) {
        resource.appendChild(new Option(RESOURCE_LABELS[key], key));
      }

      const number = document.createElement('select');
      number.id = `manual-number-${index}`;
      number.appendChild(new Option('—', ''));
      for (const value of [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]) {
        number.appendChild(new Option(String(value), String(value)));
      }

      elements.manual.append(label, resource, number);
    }
  }

  function readManualForm() {
    const hexes = [];
    for (let index = 0; index < HEX_COUNT; index += 1) {
      const resource = document.getElementById(`manual-resource-${index}`).value || null;
      const numberValue = document.getElementById(`manual-number-${index}`).value;
      hexes.push({
        resource,
        number: numberValue ? Number(numberValue) : null,
        robber: false
      });
    }
    return hexes;
  }

  async function requestAnalysis() {
    const response = await sendToTab({ type: 'catan:requestAnalysis' });
    if (response?.ok) {
      render(response.payload);
    } else {
      elements.status.textContent =
        'BGA の対局ページで開いてください（content script に接続できませんでした）。';
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'catan:analysis') render(message.payload);
    if (message?.type === 'catan:error') {
      elements.status.textContent = `読み取りエラー: ${message.message}`;
    }
  });

  for (const key of ['enabled', 'pips', 'probability', 'red', 'spots']) {
    elements[key].addEventListener('change', pushSettings);
  }

  elements.refresh.addEventListener('click', requestAnalysis);

  document.getElementById('manual-apply').addEventListener('click', async () => {
    await sendToTab({ type: 'catan:setManualBoard', payload: { hexes: readManualForm() } });
    await requestAnalysis();
  });

  document.getElementById('manual-clear').addEventListener('click', async () => {
    await sendToTab({ type: 'catan:setManualBoard', payload: null });
    await requestAnalysis();
  });

  (async function init() {
    const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    elements.enabled.checked = stored.enabled;
    elements.pips.checked = stored.showPips;
    elements.probability.checked = stored.showProbability;
    elements.red.checked = stored.highlightRed;
    elements.spots.checked = stored.showSpots;
    buildManualForm();
    await requestAnalysis();
  })();
})();
