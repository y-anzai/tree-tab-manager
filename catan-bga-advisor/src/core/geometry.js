/**
 * 標準カタン盤（19 ヘクス）の幾何情報を生成する。
 *
 * ヘクスはキューブ座標 (q, r, s) で表し、q + r + s === 0 かつ各成分の絶対値が
 * 2 以下のもの＝ちょうど 19 個が標準盤になる。頂点と辺は、各ヘクスの角の
 * 実座標を丸めて重複排除することで導出する（隣接表を手書きしない）。
 */
(function (root) {
  'use strict';

  const BOARD_RADIUS = 2;

  /** キューブ座標での 6 近傍。 */
  const NEIGHBOR_OFFSETS = [
    { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
    { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }
  ];

  /**
   * pointy-top ヘクスの中心座標（辺長 1 の単位系）。
   * @param {number} q
   * @param {number} r
   * @returns {{x: number, y: number}}
   */
  function hexCenter(q, r) {
    return {
      x: Math.sqrt(3) * (q + r / 2),
      y: 1.5 * r
    };
  }

  /**
   * ヘクスの 6 頂点の座標を、北から時計回りに返す。
   * @param {{q: number, r: number}} hex
   * @returns {Array<{x: number, y: number}>}
   */
  function hexCorners(hex) {
    const center = hexCenter(hex.q, hex.r);
    const corners = [];
    for (let i = 0; i < 6; i += 1) {
      const angle = (Math.PI / 180) * (60 * i - 30);
      corners.push({
        x: center.x + Math.cos(angle),
        y: center.y + Math.sin(angle)
      });
    }
    return corners;
  }

  /**
   * 頂点の同一判定キー。
   *
   * 座標を丸めて突き合わせると、sqrt(3) を含む値が丸め境界にかかって同じ点が
   * 別々に数えられることがある（54 個であるべき頂点が 56 個になる）。そこで
   * 「その頂点を共有する 3 つのヘクス（盤外を含む）の整数座標」でキーを作り、
   * 浮動小数の比較を同定から排除する。
   *
   * @param {{q: number, r: number}} hex 角を持つヘクス
   * @param {{x: number, y: number}} corner 角の実座標
   * @returns {string}
   */
  function cornerKey(hex, corner) {
    const owners = [{ q: hex.q, r: hex.r }];
    for (const offset of NEIGHBOR_OFFSETS) {
      const neighbor = { q: hex.q + offset.q, r: hex.r + offset.r };
      const center = hexCenter(neighbor.q, neighbor.r);
      // 角を共有する隣接ヘクスの中心までの距離はちょうど 1、共有しない場合は
      // sqrt(3) 以上離れる。許容 0.01 で十分に安全に切り分けられる。
      if (Math.abs(Math.hypot(center.x - corner.x, center.y - corner.y) - 1) < 0.01) {
        owners.push(neighbor);
      }
    }
    return owners
      .map((owner) => `${owner.q},${owner.r}`)
      .sort()
      .join('|');
  }

  /**
   * 標準盤のヘクス一覧をキューブ座標で返す。
   * 並び順は上の行から左→右（BGA の盤面表示と同じ読み順）。
   * @returns {Array<{id: string, q: number, r: number, s: number, x: number, y: number}>}
   */
  function buildHexes() {
    const hexes = [];
    for (let r = -BOARD_RADIUS; r <= BOARD_RADIUS; r += 1) {
      const qMin = Math.max(-BOARD_RADIUS, -r - BOARD_RADIUS);
      const qMax = Math.min(BOARD_RADIUS, -r + BOARD_RADIUS);
      for (let q = qMin; q <= qMax; q += 1) {
        const center = hexCenter(q, r);
        hexes.push({ id: `h${q},${r}`, q, r, s: -q - r, x: center.x, y: center.y });
      }
    }
    return hexes;
  }

  /**
   * ヘクス一覧から頂点・辺と、その隣接関係をまとめて構築する。
   * @returns {{
   *   hexes: Array<object>,
   *   vertices: Array<{id: string, x: number, y: number, hexIds: string[], edgeIds: string[]}>,
   *   edges: Array<{id: string, vertexIds: [string, string]}>
   * }}
   */
  function buildTopology() {
    const hexes = buildHexes();
    /** @type {Map<string, {id: string, x: number, y: number, hexIds: string[], edgeIds: string[]}>} */
    const vertexByKey = new Map();
    /** @type {Map<string, {id: string, vertexIds: [string, string]}>} */
    const edgeById = new Map();

    for (const hex of hexes) {
      const corners = hexCorners(hex);
      const cornerIds = corners.map((corner) => {
        const key = cornerKey(hex, corner);
        let vertex = vertexByKey.get(key);
        if (!vertex) {
          vertex = { id: `v${vertexByKey.size}`, x: corner.x, y: corner.y, hexIds: [], edgeIds: [] };
          vertexByKey.set(key, vertex);
        }
        if (!vertex.hexIds.includes(hex.id)) vertex.hexIds.push(hex.id);
        return vertex.id;
      });

      for (let i = 0; i < 6; i += 1) {
        const a = cornerIds[i];
        const b = cornerIds[(i + 1) % 6];
        const edgeId = [a, b].sort().join('-');
        if (!edgeById.has(edgeId)) {
          edgeById.set(edgeId, { id: edgeId, vertexIds: [a, b].sort() });
        }
      }
    }

    const vertices = Array.from(vertexByKey.values());
    const vertexById = new Map(vertices.map((v) => [v.id, v]));
    for (const edge of edgeById.values()) {
      for (const vertexId of edge.vertexIds) {
        vertexById.get(vertexId).edgeIds.push(edge.id);
      }
    }

    return { hexes, vertices, edges: Array.from(edgeById.values()) };
  }

  /**
   * ある頂点に隣接する（＝辺 1 本で繋がる）頂点 ID を返す。
   * 距離ルール（隣接頂点には家を建てられない）の判定に使う。
   * @param {object} topology buildTopology() の戻り値
   * @param {string} vertexId
   * @returns {string[]}
   */
  function neighborVertexIds(topology, vertexId) {
    const edgeIds = new Set(
      topology.vertices.find((v) => v.id === vertexId)?.edgeIds || []
    );
    const result = new Set();
    for (const edge of topology.edges) {
      if (!edgeIds.has(edge.id)) continue;
      for (const id of edge.vertexIds) {
        if (id !== vertexId) result.add(id);
      }
    }
    return Array.from(result);
  }

  root.CatanGeometry = {
    BOARD_RADIUS,
    hexCenter,
    hexCorners,
    buildHexes,
    buildTopology,
    neighborVertexIds
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
