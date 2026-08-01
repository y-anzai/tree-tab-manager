/**
 * ピップ（出目確率）に関する純粋関数群。
 * content script / side panel の双方から `globalThis.CatanPips` として参照する。
 */
(function (root) {
  'use strict';

  /** 2d6 で各数字が出る組み合わせ数（＝ピップ数、盤上の点の数と一致する）。 */
  const PIP_BY_NUMBER = {
    2: 1, 3: 2, 4: 3, 5: 4, 6: 5,
    8: 5, 9: 4, 10: 3, 11: 2, 12: 1
  };

  const TOTAL_COMBINATIONS = 36;

  /** 資源の種類。desert は産出なし。 */
  const RESOURCES = ['brick', 'lumber', 'wool', 'grain', 'ore'];

  /**
   * 数字トークンのピップ数を返す。7 や無効値は 0。
   * @param {number|string|null|undefined} number
   * @returns {number}
   */
  function pipsOf(number) {
    const n = Number(number);
    return PIP_BY_NUMBER[n] || 0;
  }

  /**
   * 1 ダイスロールあたりの出現確率（0〜1）。
   * @param {number|string} number
   * @returns {number}
   */
  function probabilityOf(number) {
    return pipsOf(number) / TOTAL_COMBINATIONS;
  }

  /**
   * ピップ数を「6/8 に近いほど高い」5 段階の強さに落とす。UI の色分け用。
   * @param {number} pips
   * @returns {0|1|2|3|4|5}
   */
  function pipTier(pips) {
    if (pips <= 0) return 0;
    return Math.min(5, pips);
  }

  /**
   * 数字が 6 または 8（＝赤数字）かどうか。
   * @param {number|string} number
   * @returns {boolean}
   */
  function isRedNumber(number) {
    const n = Number(number);
    return n === 6 || n === 8;
  }

  root.CatanPips = {
    PIP_BY_NUMBER,
    TOTAL_COMBINATIONS,
    RESOURCES,
    pipsOf,
    probabilityOf,
    pipTier,
    isRedNumber
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
