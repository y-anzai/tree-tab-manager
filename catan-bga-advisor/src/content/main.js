/**
 * content script のエントリポイント。
 * 盤面の読み取り → 評価 → オーバーレイ描画 と、side panel との通信を担う。
 */
(function (root) {
  'use strict';

  const Scraper = root.CatanScraper;
  const Overlay = root.CatanOverlay;
  const BoardModel = root.CatanBoard;
  const Evaluate = root.CatanEvaluate;

  /** 盤面の再読み取り間隔（ミリ秒）。DOM 変化が激しいので間引く。 */
  const REFRESH_INTERVAL_MS = 1500;

  const DEFAULT_SETTINGS = {
    enabled: true,
    showPips: true,
    showProbability: false,
    highlightRed: true,
    showSpots: false
  };

  let settings = { ...DEFAULT_SETTINGS };
  /** 最後に読み取った生データ。手動入力で上書きされることがある。 */
  let lastRaw = null;
  /** 手動で入力された盤面（あればスクレイプ結果より優先する）。 */
  let manualRaw = null;
  let refreshTimer = null;

  /**
   * 現在の盤面を読み取り、評価結果を組み立てる。
   * @returns {{board: object, raw: object, analysis: object}}
   */
  function analyze() {
    const raw = manualRaw || Scraper.scrape();
    lastRaw = raw;

    const board = BoardModel.applyRawBoard(BoardModel.createEmptyBoard(), raw);
    const analysis = {
      completeness: board.completeness,
      diagnostics: raw.diagnostics || null,
      scarcity: Evaluate.resourceScarcity(board),
      topSpots: Evaluate.rankSettlementSpots(board, { limit: 8 }),
      robber: Evaluate.rankRobberPlacements(board).slice(0, 5),
      buildOptions: Evaluate.buildOptions(board.selfResources || {}),
      notes: Evaluate.advise(board),
      players: board.players,
      hexes: board.topology.hexes.map((hex) => ({
        id: hex.id,
        ...board.hexData[hex.id],
        robber: board.robberHexId === hex.id
      }))
    };
    return { board, raw, analysis };
  }

  /**
   * ヘクス ID → 画面上の座標。オーバーレイ描画に使う。
   * スクレイプ結果は読み順に並んでいるので、添字で対応づけられる。
   * @param {object} board
   * @param {object} raw
   * @returns {Array<object>}
   */
  function hexesWithScreenPosition(board, raw) {
    return board.topology.hexes
      .map((hex, index) => {
        const source = (raw.hexes || [])[index];
        if (!source || source.x == null) return null;
        return {
          x: source.x,
          y: source.y,
          number: board.hexData[hex.id].number,
          resource: board.hexData[hex.id].resource,
          robber: board.robberHexId === hex.id
        };
      })
      .filter(Boolean);
  }

  /** 1 サイクル実行し、結果を side panel に送る。 */
  function tick() {
    if (!settings.enabled) {
      Overlay.clear();
      return;
    }

    let result;
    try {
      result = analyze();
    } catch (error) {
      chrome.runtime.sendMessage({
        type: 'catan:error',
        message: error instanceof Error ? error.message : String(error)
      });
      return;
    }

    Overlay.updateState({
      showPips: settings.showPips,
      showProbability: settings.showProbability,
      highlightRed: settings.highlightRed,
      showSpots: settings.showSpots
    });
    Overlay.render(hexesWithScreenPosition(result.board, result.raw));

    chrome.runtime.sendMessage({ type: 'catan:analysis', payload: result.analysis });
  }

  function startLoop() {
    if (refreshTimer) return;
    refreshTimer = setInterval(tick, REFRESH_INTERVAL_MS);
    tick();
  }

  function stopLoop() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
    Overlay.clear();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message?.type) {
      case 'catan:setSettings':
        settings = { ...settings, ...message.payload };
        if (settings.enabled) startLoop();
        else stopLoop();
        sendResponse({ ok: true, settings });
        return true;

      case 'catan:requestAnalysis':
        try {
          sendResponse({ ok: true, payload: analyze().analysis });
        } catch (error) {
          sendResponse({ ok: false, error: String(error) });
        }
        return true;

      case 'catan:setManualBoard':
        // hexes は読み順 19 要素。null 要素は「未入力」として扱う。
        manualRaw = message.payload
          ? { hexes: message.payload.hexes, source: 'manual' }
          : null;
        tick();
        sendResponse({ ok: true });
        return true;

      case 'catan:getRaw':
        sendResponse({ ok: true, payload: lastRaw });
        return true;

      default:
        return false;
    }
  });

  chrome.storage.sync.get(DEFAULT_SETTINGS).then((stored) => {
    settings = { ...DEFAULT_SETTINGS, ...stored };
    if (settings.enabled) startLoop();
  });

  // ページ遷移（BGA は SPA 的に画面が切り替わる）でも描画位置を保つ。
  window.addEventListener('resize', tick, { passive: true });
  window.addEventListener('scroll', tick, { passive: true });
})(typeof globalThis !== 'undefined' ? globalThis : window);
