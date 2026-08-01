/**
 * 盤面の状態モデル。スクレイパの出力（不完全なこともある）を受け取り、
 * 評価エンジンが扱える正規形に整える。
 */
(function (root) {
  'use strict';

  const { RESOURCES, pipsOf } = root.CatanPips;
  const Geometry = root.CatanGeometry;

  /** 標準盤の資源構成（デザート 1 + 18 枚）。手動入力時の候補として使う。 */
  const STANDARD_RESOURCE_COUNTS = {
    desert: 1,
    brick: 3,
    ore: 3,
    lumber: 4,
    wool: 4,
    grain: 4
  };

  /** 標準盤の数字トークン 18 枚。 */
  const STANDARD_NUMBERS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

  /**
   * 空の盤面を作る。ヘクスは幾何情報から生成し、資源・数字は未確定（null）。
   * @returns {object}
   */
  function createEmptyBoard() {
    const topology = Geometry.buildTopology();
    return {
      topology,
      /** @type {Record<string, {resource: string|null, number: number|null}>} */
      hexData: Object.fromEntries(
        topology.hexes.map((hex) => [hex.id, { resource: null, number: null }])
      ),
      /** 盗賊のいるヘクス ID。未検出なら null。 */
      robberHexId: null,
      /** @type {Array<{vertexId: string, playerId: string, type: 'settlement'|'city'}>} */
      buildings: [],
      /** @type {Array<{edgeId: string, playerId: string}>} */
      roads: [],
      /** @type {Array<{vertexIds: string[], resource: string|'any', ratio: number}>} */
      ports: [],
      /** @type {Array<{id: string, name: string, color: string|null, score: number|null}>} */
      players: [],
      /** 自分のプレイヤー ID。未検出なら null。 */
      selfPlayerId: null,
      /** @type {Record<string, number>} 自分の手札（分かる範囲）。 */
      selfResources: {},
      /** データがどこまで取れたかの記録。UI で正直に出すために持つ。 */
      completeness: {
        hexes: 0,
        numbers: 0,
        buildings: 0,
        source: 'empty'
      }
    };
  }

  /**
   * スクレイパの生データを盤面モデルに反映する。
   * 生データのヘクス配列は「上の行から左→右」の読み順である前提。
   * @param {object} board createEmptyBoard() の戻り値
   * @param {{hexes?: Array<{resource: string|null, number: number|null, robber?: boolean}>,
   *          players?: Array<object>, selfPlayerId?: string|null,
   *          selfResources?: Record<string, number>, source?: string}} raw
   * @returns {object} 反映後の board（引数を変更して返す）
   */
  function applyRawBoard(board, raw) {
    const orderedHexes = board.topology.hexes;
    const rawHexes = raw.hexes || [];

    let resolvedHexes = 0;
    let resolvedNumbers = 0;

    rawHexes.slice(0, orderedHexes.length).forEach((rawHex, index) => {
      const hexId = orderedHexes[index].id;
      const entry = board.hexData[hexId];
      if (rawHex.resource) {
        entry.resource = rawHex.resource;
        resolvedHexes += 1;
      }
      if (rawHex.number != null) {
        entry.number = Number(rawHex.number);
        resolvedNumbers += 1;
      }
      if (rawHex.robber) {
        board.robberHexId = hexId;
      }
    });

    if (raw.players) board.players = raw.players;
    if (raw.selfPlayerId !== undefined) board.selfPlayerId = raw.selfPlayerId;
    if (raw.selfResources) board.selfResources = raw.selfResources;
    if (raw.buildings) board.buildings = raw.buildings;
    if (raw.ports) board.ports = raw.ports;

    board.completeness = {
      hexes: resolvedHexes,
      numbers: resolvedNumbers,
      buildings: board.buildings.length,
      source: raw.source || 'scraper'
    };

    return board;
  }

  /**
   * 頂点ごとの産出情報（隣接ヘクスの資源とピップ）をまとめる。
   * 盗賊のいるヘクスは blocked として区別し、合計には含めない。
   * @param {object} board
   * @param {string} vertexId
   * @returns {{
   *   totalPips: number,
   *   blockedPips: number,
   *   byResource: Record<string, number>,
   *   hexes: Array<{hexId: string, resource: string|null, number: number|null, pips: number, blocked: boolean}>
   * }}
   */
  function vertexProduction(board, vertexId) {
    const vertex = board.topology.vertices.find((v) => v.id === vertexId);
    const result = {
      totalPips: 0,
      blockedPips: 0,
      byResource: {},
      hexes: []
    };
    if (!vertex) return result;

    for (const hexId of vertex.hexIds) {
      const data = board.hexData[hexId];
      const pips = pipsOf(data.number);
      const blocked = board.robberHexId === hexId;
      const producing = data.resource && data.resource !== 'desert';

      result.hexes.push({ hexId, resource: data.resource, number: data.number, pips, blocked });
      if (!producing) continue;

      if (blocked) {
        result.blockedPips += pips;
      } else {
        result.totalPips += pips;
        result.byResource[data.resource] = (result.byResource[data.resource] || 0) + pips;
      }
    }
    return result;
  }

  /**
   * すでに建物がある／隣接距離ルールに違反する頂点を除いた、建設可能な頂点 ID。
   * 道の接続条件は含めない（初期配置および候補の絞り込み用）。
   * @param {object} board
   * @returns {string[]}
   */
  function openVertexIds(board) {
    const occupied = new Set(board.buildings.map((b) => b.vertexId));
    const blocked = new Set(occupied);
    for (const vertexId of occupied) {
      for (const neighbor of Geometry.neighborVertexIds(board.topology, vertexId)) {
        blocked.add(neighbor);
      }
    }
    return board.topology.vertices.map((v) => v.id).filter((id) => !blocked.has(id));
  }

  /**
   * プレイヤーごとの総産出ピップを資源別に集計する。
   * 都市は 2 倍で数える。
   * @param {object} board
   * @returns {Record<string, {total: number, byResource: Record<string, number>}>}
   */
  function playerProduction(board) {
    /** @type {Record<string, {total: number, byResource: Record<string, number>}>} */
    const result = {};
    for (const building of board.buildings) {
      const multiplier = building.type === 'city' ? 2 : 1;
      const production = vertexProduction(board, building.vertexId);
      const bucket = result[building.playerId] || { total: 0, byResource: {} };
      for (const [resource, pips] of Object.entries(production.byResource)) {
        bucket.byResource[resource] = (bucket.byResource[resource] || 0) + pips * multiplier;
        bucket.total += pips * multiplier;
      }
      result[building.playerId] = bucket;
    }
    return result;
  }

  root.CatanBoard = {
    RESOURCES,
    STANDARD_RESOURCE_COUNTS,
    STANDARD_NUMBERS,
    createEmptyBoard,
    applyRawBoard,
    vertexProduction,
    openVertexIds,
    playerProduction
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
