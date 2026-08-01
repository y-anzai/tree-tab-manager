/**
 * Board Game Arena の Catan 盤面を DOM から読み取る。
 *
 * BGA 側の DOM 構造は予告なく変わるため、特定の id/class を決め打ちせず、
 * 「それらしい要素」をヒューリスティックに探す方針をとる。読み取り結果には
 * 常に診断情報 (diagnostics) を添え、どこまで取れたのかを UI で提示する。
 */
(function (root) {
  'use strict';

  /** 資源名 → BGA のクラス名・画像名に現れがちな語。 */
  const RESOURCE_KEYWORDS = {
    brick: ['brick', 'clay', 'tuile', 'lehm'],
    lumber: ['lumber', 'wood', 'forest', 'holz'],
    wool: ['wool', 'sheep', 'pasture', 'wolle'],
    grain: ['grain', 'wheat', 'field', 'getreide'],
    ore: ['ore', 'stone', 'mountain', 'erz'],
    desert: ['desert', 'wueste', 'wste']
  };

  const HEX_HINT = /(^|[-_ ])(hex|tile|land|terrain)/i;
  const NUMBER_HINT = /(number|token|chit|dice)/i;
  const ROBBER_HINT = /(robber|thief|brigand|raeuber)/i;

  /**
   * 要素に紐づく文字列（id・class・背景画像 URL・data 属性）をひとまとめにする。
   * 資源判定はこの文字列に対するキーワード一致で行う。
   * @param {Element} element
   * @returns {string}
   */
  function signatureOf(element) {
    const parts = [element.id || '', element.className || ''];
    for (const attribute of element.attributes || []) {
      if (attribute.name.startsWith('data-')) parts.push(attribute.value);
    }
    const style = element.getAttribute('style') || '';
    parts.push(style);
    const img = element.querySelector?.('img');
    if (img) parts.push(img.getAttribute('src') || '', img.getAttribute('alt') || '');
    return parts.join(' ').toLowerCase();
  }

  /**
   * シグネチャ文字列から資源を推定する。判定できなければ null。
   * @param {string} signature
   * @returns {string|null}
   */
  function resourceFromSignature(signature) {
    for (const [resource, keywords] of Object.entries(RESOURCE_KEYWORDS)) {
      if (keywords.some((keyword) => signature.includes(keyword))) return resource;
    }
    return null;
  }

  /**
   * 盤面のルート要素らしきものを探す。見つからなければ document.body。
   * @returns {Element}
   */
  function findBoardRoot() {
    const candidates = ['#board', '#game_play_area', '#catan_board', '.board', '#play_area'];
    for (const selector of candidates) {
      const element = document.querySelector(selector);
      if (element) return element;
    }
    return document.body;
  }

  /**
   * 盤面上のヘクス要素の候補を、位置情報付きで集める。
   * @param {Element} boardRoot
   * @returns {Array<{element: Element, x: number, y: number, signature: string}>}
   */
  function collectHexElements(boardRoot) {
    const found = [];
    for (const element of boardRoot.querySelectorAll('*')) {
      const identity = `${element.id || ''} ${element.className || ''}`;
      if (!HEX_HINT.test(identity)) continue;
      if (NUMBER_HINT.test(identity)) continue;

      const rect = element.getBoundingClientRect();
      // 極端に小さい／大きい要素はヘクスではなくコンテナとみなす。
      if (rect.width < 20 || rect.width > 400) continue;

      found.push({
        element,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        signature: signatureOf(element)
      });
    }
    return found;
  }

  /**
   * 中心座標から「上の行→左から右」の読み順に並べ替える。
   * 行の判定は、ヘクス 1 個分の高さの半分を許容幅とする。
   * @param {Array<{x: number, y: number}>} items
   * @returns {Array<object>}
   */
  function sortIntoReadingOrder(items) {
    if (items.length === 0) return [];
    const heights = items.map((item) => item.y).sort((a, b) => a - b);
    const span = heights[heights.length - 1] - heights[0];
    const rowTolerance = Math.max(10, span / 10);

    return [...items].sort((a, b) => {
      if (Math.abs(a.y - b.y) > rowTolerance) return a.y - b.y;
      return a.x - b.x;
    });
  }

  /**
   * 数字トークン要素を集め、テキストから数値を取り出す。
   * @param {Element} boardRoot
   * @returns {Array<{x: number, y: number, number: number}>}
   */
  function collectNumberTokens(boardRoot) {
    const tokens = [];
    for (const element of boardRoot.querySelectorAll('*')) {
      const identity = `${element.id || ''} ${element.className || ''}`;
      if (!NUMBER_HINT.test(identity)) continue;

      const text = (element.textContent || '').trim();
      let value = Number(text);
      if (!Number.isInteger(value) || value < 2 || value > 12) {
        // テキストで取れない実装（画像表示）向けに、属性からも探す。
        const match = signatureOf(element).match(/(?:number|token|chit)[^0-9]{0,4}(1[0-2]|[2-9])\b/);
        value = match ? Number(match[1]) : NaN;
      }
      if (!Number.isInteger(value) || value < 2 || value > 12) continue;

      const rect = element.getBoundingClientRect();
      tokens.push({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, number: value });
    }
    return tokens;
  }

  /**
   * 盗賊コマの中心座標を返す。見つからなければ null。
   * @param {Element} boardRoot
   * @returns {{x: number, y: number}|null}
   */
  function findRobber(boardRoot) {
    for (const element of boardRoot.querySelectorAll('*')) {
      const identity = `${element.id || ''} ${element.className || ''}`;
      if (!ROBBER_HINT.test(identity)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0) continue;
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    return null;
  }

  /**
   * 点 target に最も近い要素の添字を返す。距離が maxDistance を超える場合は -1。
   * @param {Array<{x: number, y: number}>} items
   * @param {{x: number, y: number}} target
   * @param {number} maxDistance
   * @returns {number}
   */
  function nearestIndex(items, target, maxDistance) {
    let bestIndex = -1;
    let bestDistance = Infinity;
    items.forEach((item, index) => {
      const distance = Math.hypot(item.x - target.x, item.y - target.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    return bestDistance <= maxDistance ? bestIndex : -1;
  }

  /**
   * BGA のスコアパネルからプレイヤー情報を読む。
   * @returns {Array<{id: string, name: string, color: string|null, score: number}>}
   */
  function collectPlayers() {
    const players = [];
    for (const board of document.querySelectorAll('.player-board, .playerboard, [id^="overall_player_board_"]')) {
      const id = (board.id || '').replace(/^\D+/, '') || board.id;
      const name = board.querySelector('.player-name, .playername')?.textContent?.trim() || id;
      const scoreText = board.querySelector('.player_score_value, .score')?.textContent?.trim();
      const color = board.querySelector('[style*="color"]')?.style?.color || null;
      players.push({ id, name, color, score: Number(scoreText) || 0 });
    }
    return players;
  }

  /**
   * 盤面を 1 回読み取る。
   * @returns {{
   *   hexes: Array<{resource: string|null, number: number|null, robber: boolean, x: number, y: number}>,
   *   players: Array<object>,
   *   source: string,
   *   diagnostics: {boardRoot: string, hexCandidates: number, numberTokens: number, robberFound: boolean, warnings: string[]}
   * }}
   */
  function scrape() {
    const boardRoot = findBoardRoot();
    const warnings = [];

    const hexCandidates = sortIntoReadingOrder(collectHexElements(boardRoot));
    if (hexCandidates.length === 0) {
      warnings.push('ヘクスらしき要素が見つかりませんでした。対局画面が開いているか確認してください。');
    } else if (hexCandidates.length !== 19) {
      warnings.push(`ヘクス候補が ${hexCandidates.length} 個です（標準盤は 19 個）。誤検出または拡張盤の可能性があります。`);
    }

    const numberTokens = collectNumberTokens(boardRoot);
    if (numberTokens.length === 0 && hexCandidates.length > 0) {
      warnings.push('数字トークンを読み取れませんでした。ピップ表示は手動入力に切り替えてください。');
    }

    // ヘクス 1 個分の目安サイズ。数字トークンの割り当て半径に使う。
    const hexSize = hexCandidates.length > 0
      ? hexCandidates[0].element.getBoundingClientRect().width
      : 80;

    const hexes = hexCandidates.map((candidate) => ({
      resource: resourceFromSignature(candidate.signature),
      number: null,
      robber: false,
      x: candidate.x,
      y: candidate.y
    }));

    for (const token of numberTokens) {
      const index = nearestIndex(hexes, token, hexSize * 0.6);
      if (index >= 0 && hexes[index].number == null) hexes[index].number = token.number;
    }

    const robber = findRobber(boardRoot);
    if (robber) {
      const index = nearestIndex(hexes, robber, hexSize * 0.7);
      if (index >= 0) hexes[index].robber = true;
    }

    return {
      hexes,
      players: collectPlayers(),
      source: 'scraper',
      diagnostics: {
        boardRoot: boardRoot.id ? `#${boardRoot.id}` : boardRoot.tagName.toLowerCase(),
        hexCandidates: hexCandidates.length,
        numberTokens: numberTokens.length,
        robberFound: Boolean(robber),
        warnings
      }
    };
  }

  root.CatanScraper = {
    RESOURCE_KEYWORDS,
    signatureOf,
    resourceFromSignature,
    findBoardRoot,
    sortIntoReadingOrder,
    scrape
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
