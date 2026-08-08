/**
 * 盤面の上にピップ数などのバッジを重ねて表示するオーバーレイ。
 * BGA 側の DOM には手を入れず、body 直下の専用レイヤーに絶対配置する。
 */
(function (root) {
  'use strict';

  const Pips = root.CatanPips;
  const LAYER_ID = 'catan-advisor-overlay';

  /**
   * バッジをヘクス中心から上にずらす量（px）。
   * 中心に置くと数字トークンそのものを覆ってしまい、盤面が読めなくなる。
   */
  const BADGE_OFFSET_Y = 30;

  /** 表示切り替えの状態。side panel からのメッセージで更新される。 */
  const state = {
    showPips: true,
    showProbability: false,
    highlightRed: true,
    showSpots: false,
    /** @type {Array<{x: number, y: number, rank: number, score: number}>} */
    spotMarkers: []
  };

  function ensureLayer() {
    let layer = document.getElementById(LAYER_ID);
    if (!layer) {
      layer = document.createElement('div');
      layer.id = LAYER_ID;
      document.body.appendChild(layer);
    }
    return layer;
  }

  function clear() {
    const layer = document.getElementById(LAYER_ID);
    if (layer) layer.textContent = '';
  }

  /**
   * バッジを 1 つ作る。座標は viewport 基準で受け取り、ページ座標に直す。
   * @param {{x: number, y: number}} point
   * @param {string} text
   * @param {string[]} modifiers 追加クラス（tier / red など）
   * @param {number} [offsetY] 中心からの上方向のずらし量
   * @returns {HTMLElement}
   */
  function createBadge(point, text, modifiers, offsetY = BADGE_OFFSET_Y) {
    const badge = document.createElement('div');
    badge.className = ['catan-advisor-badge', ...modifiers].join(' ');
    badge.textContent = text;
    badge.style.left = `${point.x + window.scrollX}px`;
    badge.style.top = `${point.y + window.scrollY - offsetY}px`;
    return badge;
  }

  /**
   * 読み取ったヘクス情報をもとにオーバーレイを描き直す。
   * @param {Array<{x: number, y: number, number: number|null, resource: string|null, robber: boolean}>} hexes
   */
  function render(hexes) {
    const layer = ensureLayer();
    layer.textContent = '';

    const anyBadge = state.showPips || state.showProbability;
    if (anyBadge) {
      for (const hex of hexes) {
        if (hex.number == null) continue;
        const pips = Pips.pipsOf(hex.number);
        if (pips === 0) continue;

        const labels = [];
        if (state.showPips) labels.push(`${pips}`);
        if (state.showProbability) labels.push(`${(Pips.probabilityOf(hex.number) * 100).toFixed(1)}%`);

        const modifiers = [`catan-advisor-tier-${Pips.pipTier(pips)}`];
        if (state.highlightRed && Pips.isRedNumber(hex.number)) modifiers.push('catan-advisor-red');
        if (hex.robber) modifiers.push('catan-advisor-blocked');

        layer.appendChild(createBadge(hex, labels.join(' / '), modifiers));
      }
    }

    if (state.showSpots) {
      for (const marker of state.spotMarkers) {
        layer.appendChild(
          // 候補マーカーは頂点そのものを指すのでずらさない。
          createBadge(marker, `#${marker.rank}`, ['catan-advisor-spot'], 0)
        );
      }
    }
  }

  /**
   * 表示設定を部分更新する。
   * @param {Partial<typeof state>} patch
   */
  function updateState(patch) {
    Object.assign(state, patch);
  }

  root.CatanOverlay = { state, updateState, render, clear, LAYER_ID };
})(typeof globalThis !== 'undefined' ? globalThis : window);
