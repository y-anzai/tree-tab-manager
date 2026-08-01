/**
 * 評価エンジン。盤面モデルを受け取り、開拓地の候補・盗賊の置き場所・
 * 次に建てるものの助言を数値化する。
 *
 * どの数値も「絶対的な正解」ではなく重み付きヒューリスティックであり、
 * 重みは WEIGHTS にまとめてあるので調整しやすくしてある。
 */
(function (root) {
  'use strict';

  const Pips = root.CatanPips;
  const Board = root.CatanBoard;

  /** 建設コスト。 */
  const COSTS = {
    road: { brick: 1, lumber: 1 },
    settlement: { brick: 1, lumber: 1, wool: 1, grain: 1 },
    city: { ore: 3, grain: 2 },
    development: { ore: 1, wool: 1, grain: 1 }
  };

  const WEIGHTS = {
    /** ピップ 1 点あたりの基礎点。 */
    pip: 1,
    /** 隣接する資源の種類 1 つあたりの加点（多様性）。 */
    diversity: 1.5,
    /** 6/8 に接する 1 ヘクスあたりの加点。 */
    redNumber: 0.8,
    /** 盤面全体で希少な資源を押さえた場合の加点係数。 */
    scarcity: 2.0,
    /** 資源港（2:1）の加点。対応資源のピップがある場合のみ効く。 */
    resourcePort: 1.2,
    /** 万能港（3:1）の加点。 */
    genericPort: 0.8,
    /** 鉱石＋小麦が揃っている（都市化しやすい）ことへの加点。 */
    citySynergy: 1.0
  };

  /**
   * 盤面全体の資源別ピップ総量を数え、希少度（少ないほど大きい値）を返す。
   * @param {object} board
   * @returns {Record<string, number>}
   */
  function resourceScarcity(board) {
    /** @type {Record<string, number>} */
    const totals = {};
    for (const resource of Pips.RESOURCES) totals[resource] = 0;

    for (const hex of board.topology.hexes) {
      const data = board.hexData[hex.id];
      if (!data.resource || data.resource === 'desert') continue;
      totals[data.resource] = (totals[data.resource] || 0) + Pips.pipsOf(data.number);
    }

    const values = Object.values(totals).filter((v) => v > 0);
    if (values.length === 0) return {};
    const average = values.reduce((a, b) => a + b, 0) / values.length;

    /** @type {Record<string, number>} */
    const scarcity = {};
    for (const [resource, total] of Object.entries(totals)) {
      // 平均より産出が少ない資源ほど 0 より大きい値になる。
      scarcity[resource] = total > 0 ? Math.max(0, (average - total) / average) : 1;
    }
    return scarcity;
  }

  /**
   * ある頂点が接している港を返す。
   * @param {object} board
   * @param {string} vertexId
   * @returns {Array<{resource: string, ratio: number}>}
   */
  function portsAtVertex(board, vertexId) {
    return (board.ports || []).filter((port) => port.vertexIds.includes(vertexId));
  }

  /**
   * 頂点 1 つを開拓地候補として採点する。
   * @param {object} board
   * @param {string} vertexId
   * @param {{scarcity?: Record<string, number>}} [context]
   * @returns {{
   *   vertexId: string, score: number, pips: number,
   *   resources: Record<string, number>, reasons: string[]
   * }}
   */
  function scoreVertex(board, vertexId, context = {}) {
    const scarcity = context.scarcity || resourceScarcity(board);
    const production = Board.vertexProduction(board, vertexId);
    const reasons = [];

    let score = production.totalPips * WEIGHTS.pip;
    if (production.totalPips > 0) {
      reasons.push(`産出 ${production.totalPips} ピップ`);
    }

    const kinds = Object.keys(production.byResource).length;
    if (kinds > 1) {
      const bonus = (kinds - 1) * WEIGHTS.diversity;
      score += bonus;
      reasons.push(`${kinds} 種類の資源（多様性 +${bonus.toFixed(1)}）`);
    }

    const reds = production.hexes.filter((h) => !h.blocked && Pips.isRedNumber(h.number)).length;
    if (reds > 0) {
      score += reds * WEIGHTS.redNumber;
      reasons.push(`赤数字 ${reds} 個`);
    }

    let scarcityBonus = 0;
    for (const [resource, pips] of Object.entries(production.byResource)) {
      scarcityBonus += (scarcity[resource] || 0) * pips * WEIGHTS.scarcity * 0.1;
    }
    if (scarcityBonus > 0.2) {
      score += scarcityBonus;
      reasons.push(`希少資源を確保（+${scarcityBonus.toFixed(1)}）`);
    }

    const ore = production.byResource.ore || 0;
    const grain = production.byResource.grain || 0;
    if (ore > 0 && grain > 0) {
      score += WEIGHTS.citySynergy;
      reasons.push('鉱石＋小麦で都市化しやすい');
    }

    for (const port of portsAtVertex(board, vertexId)) {
      if (port.resource === 'any') {
        score += WEIGHTS.genericPort;
        reasons.push('3:1 港に隣接');
      } else if ((production.byResource[port.resource] || 0) > 0) {
        score += WEIGHTS.resourcePort;
        reasons.push(`${port.resource} の 2:1 港と噛み合う`);
      }
    }

    if (production.blockedPips > 0) {
      reasons.push(`盗賊で ${production.blockedPips} ピップ停止中`);
    }

    return {
      vertexId,
      score: Math.round(score * 10) / 10,
      pips: production.totalPips,
      resources: production.byResource,
      reasons
    };
  }

  /**
   * 建設可能な頂点を採点して上位から並べる。
   * @param {object} board
   * @param {{limit?: number}} [options]
   * @returns {Array<object>}
   */
  function rankSettlementSpots(board, options = {}) {
    const scarcity = resourceScarcity(board);
    const ranked = Board.openVertexIds(board)
      .map((vertexId) => scoreVertex(board, vertexId, { scarcity }))
      .filter((entry) => entry.pips > 0)
      .sort((a, b) => b.score - a.score);
    return options.limit ? ranked.slice(0, options.limit) : ranked;
  }

  /**
   * 盗賊の置き場所を評価する。自分の産出を止めてしまう置き場所は除外する。
   * 相手の得点が高いほど、そこを止める価値を高く見積もる。
   * @param {object} board
   * @returns {Array<{hexId: string, score: number, victims: Array<{playerId: string, pips: number}>, reasons: string[]}>}
   */
  function rankRobberPlacements(board) {
    const selfId = board.selfPlayerId;
    const scoreById = Object.fromEntries(
      (board.players || []).map((p) => [p.id, p.score || 0])
    );
    const maxScore = Math.max(1, ...Object.values(scoreById));

    const results = [];
    for (const hex of board.topology.hexes) {
      if (hex.id === board.robberHexId) continue;
      const data = board.hexData[hex.id];
      const pips = Pips.pipsOf(data.number);
      if (!data.resource || data.resource === 'desert' || pips === 0) continue;

      /** @type {Record<string, number>} */
      const lossByPlayer = {};
      let hitsSelf = false;

      for (const building of board.buildings) {
        const vertex = board.topology.vertices.find((v) => v.id === building.vertexId);
        if (!vertex || !vertex.hexIds.includes(hex.id)) continue;
        const loss = pips * (building.type === 'city' ? 2 : 1);
        if (building.playerId === selfId) {
          hitsSelf = true;
          continue;
        }
        lossByPlayer[building.playerId] = (lossByPlayer[building.playerId] || 0) + loss;
      }

      if (hitsSelf) continue;
      const victims = Object.entries(lossByPlayer)
        .map(([playerId, lost]) => ({ playerId, pips: lost }))
        .sort((a, b) => b.pips - a.pips);
      if (victims.length === 0) continue;

      let score = 0;
      for (const victim of victims) {
        const leaderWeight = 0.5 + 0.5 * ((scoreById[victim.playerId] || 0) / maxScore);
        score += victim.pips * leaderWeight;
      }

      const reasons = victims.map(
        (v) => `${playerName(board, v.playerId)} の産出 ${v.pips} ピップを停止`
      );
      if (Pips.isRedNumber(data.number)) reasons.push('赤数字を封じられる');

      results.push({
        hexId: hex.id,
        score: Math.round(score * 10) / 10,
        victims,
        reasons
      });
    }
    return results.sort((a, b) => b.score - a.score);
  }

  function playerName(board, playerId) {
    return (board.players || []).find((p) => p.id === playerId)?.name || playerId;
  }

  /**
   * 手札に対して、いま何が建てられるか／何が足りないかを返す。
   * @param {Record<string, number>} resources
   * @returns {Array<{target: string, affordable: boolean, missing: Record<string, number>}>}
   */
  function buildOptions(resources) {
    return Object.entries(COSTS).map(([target, cost]) => {
      /** @type {Record<string, number>} */
      const missing = {};
      for (const [resource, amount] of Object.entries(cost)) {
        const have = resources[resource] || 0;
        if (have < amount) missing[resource] = amount - have;
      }
      return { target, affordable: Object.keys(missing).length === 0, missing };
    });
  }

  /**
   * 盤面全体を見て、その場で読める助言を文章の配列で返す。
   * 情報が足りない場合は無理に断定せず、その旨を含める。
   * @param {object} board
   * @returns {Array<{level: 'info'|'good'|'warn', text: string}>}
   */
  function advise(board) {
    /** @type {Array<{level: 'info'|'good'|'warn', text: string}>} */
    const notes = [];
    const { hexes, numbers } = board.completeness;

    if (hexes < 19 || numbers < 18) {
      notes.push({
        level: 'warn',
        text: `盤面を部分的にしか読み取れていません（資源 ${hexes}/19・数字 ${numbers}/18）。助言の精度は限定的です。`
      });
    }

    const spots = rankSettlementSpots(board, { limit: 3 });
    if (spots.length > 0) {
      const best = spots[0];
      notes.push({
        level: 'good',
        text: `最有力の開拓地候補は ${best.pips} ピップ（${Object.keys(best.resources).join('・') || '不明'}）。${best.reasons[0] || ''}`
      });
    }

    const production = Board.playerProduction(board);
    const selfProduction = production[board.selfPlayerId];
    if (selfProduction) {
      const missing = Pips.RESOURCES.filter((r) => !selfProduction.byResource[r]);
      if (missing.length > 0) {
        notes.push({
          level: 'warn',
          text: `自分の産出に ${missing.join('・')} がありません。港か交易で補う前提で動きましょう。`
        });
      }
    }

    const options = buildOptions(board.selfResources || {});
    const affordable = options.filter((o) => o.affordable).map((o) => o.target);
    if (affordable.length > 0) {
      notes.push({ level: 'good', text: `いま建設可能: ${affordable.join('・')}` });
    }

    return notes;
  }

  root.CatanEvaluate = {
    COSTS,
    WEIGHTS,
    resourceScarcity,
    scoreVertex,
    rankSettlementSpots,
    rankRobberPlacements,
    buildOptions,
    advise
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
