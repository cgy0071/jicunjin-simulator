/* 积存金模拟器的成交、定投与账本规则。金额用分，克重用 0.0001 克。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.JCJ = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const GRAM_UNIT = 10000;
  const MIN_BUY_CENTS = 100;
  const MAX_ORDER_CENTS = 100000000;
  const SESSION_OPEN = 9 * 60;
  const SESSION_CLOSE = 22 * 60 + 30;
  const ANCHOR_DATE = { y: 2026, m: 9, d: 30, hh: 15, mm: 0 };
  const ANCHOR_CENTS = 90680;
  const HISTORY_DAYS = 252;
  const DEFAULT_SEED = 0x51a7c0de;

  const SCENARIOS = {
    base: { mu: 0.04, sigma: 0.15, name: '基准', desc: '之后的期望漂移约 4%，波动约 15%。单条路径会偏离很多。' },
    bull: { mu: 0.12, sigma: 0.14, name: '慢牛', desc: '之后的期望漂移约 12%，波动约 14%。这不是预测。' },
    range: { mu: 0, sigma: 0.12, name: '震荡', desc: '之后几乎没有方向，波动约 12%。' },
    bear: { mu: -0.1, sigma: 0.18, name: '偏空', desc: '之后的期望漂移约 -10%，波动约 18%。' },
    wild: { mu: 0.04, sigma: 0.3, name: '高波动', desc: '期望漂移约 4%，波动加大到约 30%。' }
  };

  const FREQ_NAME = {
    daily: '每个交易日',
    weekly: '每周',
    biweekly: '每两周',
    monthly: '每月'
  };

  const HOLIDAY_RANGES = [
    ['2026-01-01', '2026-01-03', '元旦'],
    ['2026-02-15', '2026-02-23', '春节'],
    ['2026-04-04', '2026-04-06', '清明'],
    ['2026-05-01', '2026-05-05', '劳动节'],
    ['2026-06-19', '2026-06-21', '端午'],
    ['2026-09-25', '2026-09-27', '中秋'],
    ['2026-10-01', '2026-10-07', '国庆']
  ];

  const HOLIDAY_NAME = {};
  HOLIDAY_RANGES.forEach(function (row) {
    let cursor = parseYmd(row[0]);
    const end = clockValue(parseYmd(row[1]));
    while (clockValue(cursor) <= end) {
      HOLIDAY_NAME[ymd(cursor)] = row[2];
      cursor = addDays(cursor, 1);
    }
  });

  function pad(n, w) {
    let s = String(n);
    while (s.length < (w || 2)) s = '0' + s;
    return s;
  }

  function copyClock(c) {
    return { y: c.y, m: c.m, d: c.d, hh: c.hh || 0, mm: c.mm || 0 };
  }

  function ymd(c) {
    return c.y + '-' + pad(c.m) + '-' + pad(c.d);
  }

  function parseYmd(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
    if (!m) throw new Error('日期无效：' + str);
    return { y: +m[1], m: +m[2], d: +m[3], hh: 0, mm: 0 };
  }

  function asClock(input) {
    if (typeof input === 'string') return parseYmd(input);
    return input;
  }

  function clockValue(c) {
    return (((c.y * 100 + c.m) * 100 + c.d) * 100 + (c.hh || 0)) * 100 + (c.mm || 0);
  }

  function addDays(c, n) {
    const dt = new Date(Date.UTC(c.y, c.m - 1, c.d + n));
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), hh: c.hh || 0, mm: c.mm || 0 };
  }

  function weekday(input) {
    const c = asClock(input);
    return new Date(Date.UTC(c.y, c.m - 1, c.d)).getUTCDay();
  }

  function weekName(input) {
    return '周' + '日一二三四五六'[weekday(input)];
  }

  function holidayName(input) {
    const c = asClock(input);
    return HOLIDAY_NAME[ymd(c)] || '';
  }

  function isTradingDay(input) {
    const c = asClock(input);
    const w = weekday(c);
    if (w === 0 || w === 6) return false;
    if (HOLIDAY_NAME[ymd(c)]) return false;
    return true;
  }

  function minutesOf(c) {
    return (c.hh || 0) * 60 + (c.mm || 0);
  }

  function isMarketOpen(input) {
    const c = asClock(input);
    if (!isTradingDay(c)) return false;
    const mins = minutesOf(c);
    return mins >= SESSION_OPEN && mins <= SESSION_CLOSE;
  }

  function closureReason(input) {
    const c = asClock(input);
    const name = holidayName(c);
    if (name) return name + '休市';
    const w = weekday(c);
    if (w === 0 || w === 6) return '周末休市';
    const mins = minutesOf(c);
    if (mins < SESSION_OPEN) return '未到开市（09:00）';
    if (mins > SESSION_CLOSE) return '已过收市（22:30）';
    return '';
  }

  function lastTradingDay(input) {
    let d = copyClock(asClock(input));
    for (let i = 0; i < 40; i++) {
      if (isTradingDay(d)) return { y: d.y, m: d.m, d: d.d, hh: 15, mm: 0 };
      d = addDays(d, -1);
    }
    throw new Error('找不到交易日');
  }

  function nextTradingDay(input) {
    let d = addDays(asClock(input), 1);
    for (let i = 0; i < 40; i++) {
      if (isTradingDay(d)) return { y: d.y, m: d.m, d: d.d, hh: 10, mm: 0 };
      d = addDays(d, 1);
    }
    throw new Error('找不到下一交易日');
  }

  function postponeToSession(input) {
    let d = { y: input.y, m: input.m, d: input.d, hh: 10, mm: 0 };
    for (let i = 0; i < 40; i++) {
      if (isTradingDay(d)) return d;
      d = addDays(d, 1);
      d.hh = 10;
      d.mm = 0;
    }
    throw new Error('找不到后续交易日');
  }

  function makeRng(box) {
    return {
      next: function () {
        let a = box.s | 0;
        a = (a + 0x6d2b79f5) | 0;
        box.s = a;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      }
    };
  }

  function randn(rng) {
    const u = Math.max(rng.next(), 1e-12);
    const v = rng.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function rngFromString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    }
    return makeRng({ s: h >>> 0 });
  }

  function groupDigits(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function formatYuan(cents, opts) {
    opts = opts || {};
    const signed = !!opts.signed;
    const withSymbol = opts.symbol !== false;
    const neg = cents < 0;
    const abs = Math.abs(cents);
    const body = (withSymbol ? '¥' : '') + groupDigits(Math.floor(abs / 100)) + '.' + pad(abs % 100);
    if (neg) return '-' + body;
    if (signed && cents > 0) return '+' + body;
    return body;
  }

  function formatGram(units) {
    const neg = units < 0;
    const abs = Math.abs(units);
    return (neg ? '-' : '') + groupDigits(Math.floor(abs / GRAM_UNIT)) + '.' + pad(abs % GRAM_UNIT, 4);
  }

  function formatPct(ratio) {
    if (ratio == null || !Number.isFinite(ratio)) return '--';
    const v = ratio * 100;
    if (v > 0) return '+' + v.toFixed(2) + '%';
    return v.toFixed(2) + '%';
  }

  function formatDate(input) {
    const c = asClock(input);
    return ymd(c);
  }

  function formatClock(input) {
    const c = asClock(input);
    return ymd(c) + ' ' + weekName(c) + ' ' + pad(c.hh || 0) + ':' + pad(c.mm || 0);
  }

  function parseYuanToCents(str) {
    const text = String(str == null ? '' : str).trim();
    if (!/^\d+(\.\d{0,2})?$/.test(text)) return null;
    const parts = text.split('.');
    const frac = ((parts[1] || '') + '00').slice(0, 2);
    const cents = parseInt(parts[0], 10) * 100 + parseInt(frac, 10);
    if (!Number.isFinite(cents)) return null;
    return cents;
  }

  function parseGramToUnits(str) {
    const text = String(str == null ? '' : str).trim();
    if (!/^\d+(\.\d{0,4})?$/.test(text)) return null;
    const parts = text.split('.');
    const frac = ((parts[1] || '') + '0000').slice(0, 4);
    const units = parseInt(parts[0], 10) * GRAM_UNIT + parseInt(frac, 10);
    if (!Number.isFinite(units)) return null;
    return units;
  }

  function fail(error, extra) {
    return Object.assign({ ok: false, error: error }, extra || {});
  }

  function pass(extra) {
    return Object.assign({ ok: true, error: '' }, extra);
  }

  function quote(state) {
    const spread = state.settings.spreadCents;
    return {
      mid: state.markCents,
      buy: state.markCents + spread,
      sell: state.markCents - spread,
      spread: spread * 2
    };
  }

  function marketValueCents(units, sellCents) {
    if (units <= 0) return 0;
    return Math.round(units * sellCents / GRAM_UNIT);
  }

  function payFor(units, priceCents) {
    return Math.round(units * priceCents / GRAM_UNIT);
  }

  function marketGate(state) {
    if (!isMarketOpen(state.clock)) {
      return fail('现在不能交易：' + (closureReason(state.clock) || '非交易时间'));
    }
    const q = quote(state);
    if (q.sell <= 0) return fail('点差过大，卖出价无效');
    return pass({ quote: q });
  }

  function previewBuyByMoney(amountCents, buyCents, cashCents) {
    if (!Number.isInteger(amountCents) || amountCents <= 0) return fail('请输入正确的金额');
    if (amountCents < MIN_BUY_CENTS) return fail('最低买入 1.00 元');
    if (amountCents > MAX_ORDER_CENTS) return fail('单笔不超过 100 万元');
    if (!Number.isInteger(buyCents) || buyCents <= 0) return fail('报价无效');
    let units = Math.floor(amountCents * GRAM_UNIT / buyCents);
    if (units < 1) return fail('金额太小，不足 0.0001 克');
    let pay = payFor(units, buyCents);
    while (units > 0 && pay > amountCents) {
      units -= 1;
      pay = payFor(units, buyCents);
    }
    if (units < 1 || pay < MIN_BUY_CENTS) return fail('金额太小，不足 0.0001 克');
    const refund = amountCents - pay;
    if (pay > cashCents) {
      return fail('余额不足', { units: units, payCents: pay, refundCents: refund, priceCents: buyCents });
    }
    return pass({ units: units, payCents: pay, refundCents: refund, priceCents: buyCents });
  }

  function previewBuyByGram(units, buyCents, cashCents) {
    if (!Number.isInteger(units) || units <= 0) return fail('请输入正确的克重');
    if (!Number.isInteger(buyCents) || buyCents <= 0) return fail('报价无效');
    const pay = payFor(units, buyCents);
    if (pay < MIN_BUY_CENTS) return fail('最低买入 1.00 元');
    if (pay > MAX_ORDER_CENTS) return fail('单笔不超过 100 万元');
    if (pay > cashCents) return fail('余额不足', { units: units, payCents: pay, refundCents: 0, priceCents: buyCents });
    return pass({ units: units, payCents: pay, refundCents: 0, priceCents: buyCents });
  }

  function previewSellByGram(units, sellCents, holdingUnits) {
    if (!Number.isInteger(holdingUnits) || holdingUnits <= 0) return fail('没有可卖出的黄金');
    if (!Number.isInteger(units) || units <= 0) return fail('请输入正确的克重');
    if (units > holdingUnits) return fail('超过持有克重');
    if (!Number.isInteger(sellCents) || sellCents <= 0) return fail('报价无效');
    const receive = payFor(units, sellCents);
    if (receive <= 0) return fail('卖出金额过小');
    return pass({
      units: units,
      receiveCents: receive,
      priceCents: sellCents,
      sellAll: units === holdingUnits
    });
  }

  function previewSellByMoney(amountCents, sellCents, holdingUnits) {
    if (!Number.isInteger(holdingUnits) || holdingUnits <= 0) return fail('没有可卖出的黄金');
    if (!Number.isInteger(amountCents) || amountCents <= 0) return fail('请输入正确的金额');
    if (!Number.isInteger(sellCents) || sellCents <= 0) return fail('报价无效');
    const full = payFor(holdingUnits, sellCents);
    if (amountCents < MIN_BUY_CENTS && amountCents !== full) return fail('最低卖出 1.00 元，或直接全部卖出');
    let guess = Math.round(amountCents * GRAM_UNIT / sellCents);
    if (guess < 1) guess = 1;
    if (guess > holdingUnits) guess = holdingUnits;
    let best = guess;
    let bestRecv = payFor(best, sellCents);
    let bestDiff = Math.abs(bestRecv - amountCents);
    for (let delta = -2; delta <= 2; delta++) {
      const u = guess + delta;
      if (u < 1 || u > holdingUnits) continue;
      const recv = payFor(u, sellCents);
      const diff = Math.abs(recv - amountCents);
      if (diff < bestDiff) {
        best = u;
        bestRecv = recv;
        bestDiff = diff;
      }
    }
    if (bestRecv <= 0) return fail('卖出金额过小');
    return pass({
      units: best,
      receiveCents: bestRecv,
      priceCents: sellCents,
      requestedCents: amountCents,
      capped: amountCents > full,
      sellAll: best === holdingUnits
    });
  }

  function releasedCost(account, units) {
    if (units >= account.gramUnits) return account.costCents;
    return Math.round(account.costCents * units / account.gramUnits);
  }

  function estimateSellRealized(account, units, receiveCents) {
    if (units > account.gramUnits || units <= 0) return null;
    return receiveCents - releasedCost(account, units);
  }

  function applyBuy(account, preview) {
    account.cashCents -= preview.payCents;
    account.costCents += preview.payCents;
    account.gramUnits += preview.units;
  }

  function applySell(account, preview) {
    const released = releasedCost(account, preview.units);
    const realized = preview.receiveCents - released;
    account.realizedCents += realized;
    account.costCents -= released;
    account.gramUnits -= preview.units;
    account.cashCents += preview.receiveCents;
    if (account.gramUnits === 0) account.costCents = 0;
    return realized;
  }

  function audit(state) {
    const q = quote(state);
    const value = marketValueCents(state.account.gramUnits, q.sell);
    const unreal = value - state.account.costCents;
    const pnl = state.account.realizedCents + unreal;
    const equity = state.account.cashCents + value;
    const diff = equity - (state.account.principalCents + pnl);
    const dust = state.account.gramUnits === 0 && state.account.costCents !== 0;
    const neg = state.account.gramUnits < 0 || state.account.costCents < 0 || state.account.cashCents < 0;
    return { ok: diff === 0 && !dust && !neg, diff: diff, equity: equity, pnl: pnl, value: value, unreal: unreal, quote: q };
  }

  function addTrade(state, partial) {
    state.trades.push(Object.assign({
      id: state.seq++,
      type: 'buy',
      time: copyClock(state.clock),
      planId: null,
      note: '',
      realizedCents: 0,
      gramUnits: 0,
      priceCents: 0,
      moneyCents: 0
    }, partial));
    if (state.trades.length > 2000) state.trades.splice(0, state.trades.length - 2000);
  }

  function takeSnapshot(state) {
    const checked = audit(state);
    const snap = {
      date: ymd(state.clock),
      cashCents: state.account.cashCents,
      valueCents: checked.value,
      gramUnits: state.account.gramUnits,
      costCents: state.account.costCents,
      realizedCents: state.account.realizedCents,
      principalCents: state.account.principalCents,
      markCents: state.markCents
    };
    const last = state.snapshots[state.snapshots.length - 1];
    if (last && last.date === snap.date) state.snapshots[state.snapshots.length - 1] = snap;
    else state.snapshots.push(snap);
    if (state.snapshots.length > 4000) state.snapshots.splice(0, state.snapshots.length - 4000);
  }

  function buyByMoney(state, amountCents, meta) {
    const gate = marketGate(state);
    if (!gate.ok) return gate;
    const preview = previewBuyByMoney(amountCents, gate.quote.buy, state.account.cashCents);
    if (!preview.ok) return preview;
    applyBuy(state.account, preview);
    addTrade(state, Object.assign({
      type: 'buy',
      gramUnits: preview.units,
      priceCents: gate.quote.buy,
      moneyCents: preview.payCents
    }, meta || {}));
    takeSnapshot(state);
    return pass(preview);
  }

  function buyByGram(state, units, meta) {
    const gate = marketGate(state);
    if (!gate.ok) return gate;
    const preview = previewBuyByGram(units, gate.quote.buy, state.account.cashCents);
    if (!preview.ok) return preview;
    applyBuy(state.account, preview);
    addTrade(state, Object.assign({
      type: 'buy',
      gramUnits: preview.units,
      priceCents: gate.quote.buy,
      moneyCents: preview.payCents
    }, meta || {}));
    takeSnapshot(state);
    return pass(preview);
  }

  function sellByGram(state, units) {
    const gate = marketGate(state);
    if (!gate.ok) return gate;
    const preview = previewSellByGram(units, gate.quote.sell, state.account.gramUnits);
    if (!preview.ok) return preview;
    const realized = applySell(state.account, preview);
    addTrade(state, {
      type: 'sell',
      gramUnits: preview.units,
      priceCents: gate.quote.sell,
      moneyCents: preview.receiveCents,
      realizedCents: realized
    });
    takeSnapshot(state);
    return pass(Object.assign({ realizedCents: realized }, preview));
  }

  function sellByMoney(state, amountCents) {
    const gate = marketGate(state);
    if (!gate.ok) return gate;
    const preview = previewSellByMoney(amountCents, gate.quote.sell, state.account.gramUnits);
    if (!preview.ok) return preview;
    const realized = applySell(state.account, preview);
    addTrade(state, {
      type: 'sell',
      gramUnits: preview.units,
      priceCents: gate.quote.sell,
      moneyCents: preview.receiveCents,
      realizedCents: realized,
      note: preview.capped ? '持仓不足，已全部卖出' : ''
    });
    takeSnapshot(state);
    return pass(Object.assign({ realizedCents: realized }, preview));
  }

  function sellAll(state) {
    if (state.account.gramUnits <= 0) return fail('没有可卖出的黄金');
    return sellByGram(state, state.account.gramUnits);
  }

  function deposit(state, cents) {
    if (!Number.isInteger(cents) || cents < MIN_BUY_CENTS) return fail('最低转入 1.00 元');
    if (cents > 1000000000) return fail('单次转入不超过 1000 万元');
    state.account.cashCents += cents;
    state.account.principalCents += cents;
    addTrade(state, { type: 'deposit', moneyCents: cents, note: '虚拟资金' });
    takeSnapshot(state);
    return pass({ cents: cents });
  }

  function scenarioOf(state) {
    return SCENARIOS[state.settings.scenario] ? state.settings.scenario : 'base';
  }

  function makeCandle(date, prevClose, scenario, rng) {
    const spec = SCENARIOS[scenario] || SCENARIOS.base;
    const dt = 1 / 252;
    const z = randn(rng);
    const factor = Math.exp((spec.mu - 0.5 * spec.sigma * spec.sigma) * dt + spec.sigma * Math.sqrt(dt) * z);
    let close = Math.round(prevClose * factor);
    if (close < 5000) close = 5000;
    const gap = Math.exp(randn(rng) * 0.0035);
    let open = Math.round(prevClose * gap);
    if (open < 5000) open = 5000;
    const amp = Math.abs(randn(rng)) * prevClose * 0.008 + prevClose * 0.002;
    let high = Math.max(open, close) + Math.round(amp * (0.35 + rng.next()));
    let low = Math.min(open, close) - Math.round(amp * (0.35 + rng.next()));
    high = Math.max(high, open, close);
    low = Math.min(low, open, close);
    if (low < 1) low = 1;
    return { date: date, open: open, high: high, low: low, close: close };
  }

  function listTradingDaysEnding(endClock, n) {
    let d = lastTradingDay(endClock);
    const out = [];
    let guard = 0;
    while (out.length < n && guard++ < n * 5) {
      if (isTradingDay(d)) out.push(ymd(d));
      d = addDays(d, -1);
    }
    if (out.length !== n) throw new Error('交易日不足');
    out.reverse();
    return out;
  }

  function buildHistoryState(anchorCents, seed) {
    const box = { s: seed >>> 0 };
    const rng = makeRng(box);
    const raw = [];
    let prev = anchorCents;
    for (let i = 0; i < HISTORY_DAYS; i++) {
      const candle = makeCandle('pending', prev, 'base', rng);
      raw.push(candle);
      prev = candle.close;
    }
    const scale = anchorCents / raw[raw.length - 1].close;
    raw.forEach(function (c) {
      c.open = Math.max(1, Math.round(c.open * scale));
      c.high = Math.max(1, Math.round(c.high * scale));
      c.low = Math.max(1, Math.round(c.low * scale));
      c.close = Math.max(1, Math.round(c.close * scale));
      c.high = Math.max(c.high, c.open, c.close);
      c.low = Math.min(c.low, c.open, c.close);
    });
    const last = raw[raw.length - 1];
    last.close = anchorCents;
    last.high = Math.max(last.high, last.open, last.close);
    last.low = Math.min(last.low, last.open, last.close);
    const dates = listTradingDaysEnding(ANCHOR_DATE, HISTORY_DAYS);
    raw.forEach(function (c, i) { c.date = dates[i]; });
    return { candles: raw, rngBox: box };
  }

  function intradayPoints(candle) {
    const n = 96;
    const rng = rngFromString([candle.date, candle.open, candle.high, candle.low, candle.close].join('|'));
    const points = new Array(n);
    points[0] = candle.open;
    for (let i = 1; i < n - 1; i++) {
      const t = i / (n - 1);
      const bridge = Math.round(candle.open + (candle.close - candle.open) * t);
      const noise = Math.round(randn(rng) * (candle.high - candle.low) * 0.12);
      let p = bridge + noise;
      if (p > candle.high) p = candle.high;
      if (p < candle.low) p = candle.low;
      points[i] = p;
    }
    points[n - 1] = candle.close;
    return points;
  }

  function emptyAccount(cash) {
    return { cashCents: cash, gramUnits: 0, costCents: 0, realizedCents: 0, principalCents: cash };
  }

  function createBlankState() {
    const cash = 2000000;
    return {
      version: 1,
      settings: { spreadCents: 80, scenario: 'base', startCashCents: cash },
      rng: { s: 123456789 },
      meta: {
        anchorDate: '2026-09-30',
        anchorCents: ANCHOR_CENTS,
        source: '上海黄金交易所 Au(T+D) 2026-09-30 行情附近 906.80 元/克'
      },
      candles: [{ date: '2026-09-30', open: 90000, high: 91000, low: 89500, close: ANCHOR_CENTS }],
      clock: { y: 2026, m: 9, d: 30, hh: 15, mm: 0 },
      markCents: ANCHOR_CENTS,
      account: emptyAccount(cash),
      plans: [],
      trades: [],
      snapshots: [],
      seq: 1,
      introHidden: false
    };
  }

  function createInitialState(opts) {
    opts = opts || {};
    const seed = (opts.seed == null ? DEFAULT_SEED : opts.seed) >>> 0;
    let anchor = opts.anchorCents == null ? ANCHOR_CENTS : opts.anchorCents | 0;
    if (anchor < 10000) anchor = ANCHOR_CENTS;
    const built = buildHistoryState(anchor, seed);
    const cash = 2000000;
    const last = built.candles[built.candles.length - 1];
    const state = {
      version: 1,
      settings: { spreadCents: 80, scenario: 'base', startCashCents: cash },
      rng: built.rngBox,
      meta: {
        anchorDate: last.date,
        anchorCents: anchor,
        source: opts.source || '上海黄金交易所 Au(T+D) 2026-09-30 行情附近 906.80 元/克'
      },
      candles: built.candles,
      clock: { y: ANCHOR_DATE.y, m: ANCHOR_DATE.m, d: ANCHOR_DATE.d, hh: 15, mm: 0 },
      markCents: last.close,
      account: emptyAccount(cash),
      plans: [],
      trades: [],
      snapshots: [],
      seq: 1,
      introHidden: false
    };
    takeSnapshot(state);
    return state;
  }

  function findPlan(state, id) {
    for (let i = 0; i < state.plans.length; i++) {
      if (state.plans[i].id === id) return state.plans[i];
    }
    return null;
  }

  function findNextRun(plan, now) {
    if (plan.freq === 'monthly') {
      let y = now.y;
      let m = now.m - 1;
      if (m < 1) { m = 12; y -= 1; }
      for (let i = 0; i < 18; i++) {
        const nominal = { y: y, m: m, d: plan.monthDay, hh: 10, mm: 0 };
        const run = postponeToSession(nominal);
        if (clockValue(run) > clockValue(now)) return { nominal: ymd(nominal), nextRun: run };
        m += 1;
        if (m > 12) { m = 1; y += 1; }
      }
    } else if (plan.freq === 'daily') {
      let d = addDays(now, -16);
      for (let i = 0; i < 50; i++) {
        const run = postponeToSession(d);
        if (clockValue(run) > clockValue(now)) return { nominal: ymd(d), nextRun: run };
        d = addDays(d, 1);
      }
    } else {
      let d = addDays(now, -16);
      for (let i = 0; i < 50; i++) {
        if (weekday(d) === plan.weekday) {
          const run = postponeToSession(d);
          if (clockValue(run) > clockValue(now)) return { nominal: ymd(d), nextRun: run };
        }
        d = addDays(d, 1);
      }
    }
    throw new Error('无法安排扣款日');
  }

  function stepNominal(plan, nominal) {
    if (plan.freq === 'monthly') {
      let y = nominal.y;
      let m = nominal.m + 1;
      if (m > 12) { m = 1; y += 1; }
      return { y: y, m: m, d: plan.monthDay, hh: 10, mm: 0 };
    }
    const days = plan.freq === 'daily' ? 1 : plan.stepDays;
    const d = addDays(nominal, days);
    return { y: d.y, m: d.m, d: d.d, hh: 10, mm: 0 };
  }

  function scheduleAfterExecution(plan, executedClock) {
    let nominal = parseYmd(plan.nominal);
    for (let i = 0; i < 60; i++) {
      nominal = stepNominal(plan, nominal);
      const run = postponeToSession(nominal);
      if (clockValue(run) > clockValue(executedClock)) {
        plan.nominal = ymd(nominal);
        plan.nextRun = run;
        return;
      }
    }
    throw new Error('无法安排下一次扣款');
  }

  function arm(plan, now) {
    const first = findNextRun(plan, now);
    plan.nominal = first.nominal;
    plan.nextRun = copyClock(first.nextRun);
  }

  function previewSchedule(spec, clock) {
    try {
      const freq = spec && spec.freq;
      if (!FREQ_NAME[freq]) return null;
      const plan = {
        freq: freq,
        weekday: spec.weekday == null ? 1 : spec.weekday | 0,
        monthDay: spec.monthDay == null ? 8 : spec.monthDay | 0,
        stepDays: freq === 'biweekly' ? 14 : 7
      };
      if ((freq === 'weekly' || freq === 'biweekly') && (plan.weekday < 1 || plan.weekday > 5)) return null;
      if (freq === 'monthly' && (plan.monthDay < 1 || plan.monthDay > 28)) return null;
      return findNextRun(plan, clock).nextRun;
    } catch (err) {
      return null;
    }
  }

  function createPlan(state, spec) {
    spec = spec || {};
    const freq = spec.freq;
    if (!FREQ_NAME[freq]) return fail('请选择定投周期');
    if (!Number.isInteger(spec.amountCents) || spec.amountCents < MIN_BUY_CENTS) return fail('定投金额最低 1.00 元');
    if (spec.amountCents > MAX_ORDER_CENTS) return fail('单笔定投不超过 100 万元');
    if (state.plans.length >= 30) return fail('最多保留 30 个定投计划');
    const plan = {
      id: state.seq++,
      amountCents: spec.amountCents,
      freq: freq,
      weekday: spec.weekday == null ? 1 : spec.weekday | 0,
      monthDay: spec.monthDay == null ? Math.min(state.clock.d, 28) : spec.monthDay | 0,
      stepDays: freq === 'biweekly' ? 14 : 7,
      status: 'active',
      nominal: '',
      nextRun: null,
      successTimes: 0,
      failTimes: 0,
      investedCents: 0,
      investedUnits: 0,
      lastError: '',
      createdAt: copyClock(state.clock)
    };
    if (freq === 'weekly' || freq === 'biweekly') {
      if (plan.weekday < 1 || plan.weekday > 5) return fail('定投扣款日请选周一至周五');
    }
    if (freq === 'monthly' && (plan.monthDay < 1 || plan.monthDay > 28)) return fail('每月扣款日请选 1 到 28 日');
    arm(plan, state.clock);
    if (spec.immediate) {
      const bought = buyByMoney(state, spec.amountCents, {
        type: 'dca',
        planId: plan.id,
        note: '创建时先买一笔'
      });
      if (!bought.ok) return bought;
      plan.successTimes = 1;
      plan.investedCents = bought.payCents;
      plan.investedUnits = bought.units;
    }
    state.plans.push(plan);
    const warning = !spec.immediate && state.account.cashCents < spec.amountCents
      ? '当前余额不够本期金额，扣款日若仍不足，该期会失败'
      : '';
    return pass({ plan: plan, warning: warning });
  }

  function pausePlan(state, id) {
    const plan = findPlan(state, id);
    if (!plan) return fail('找不到计划');
    if (plan.status !== 'active') return fail('只有进行中的计划可以暂停');
    plan.status = 'paused';
    return pass({ plan: plan });
  }

  function resumePlan(state, id) {
    const plan = findPlan(state, id);
    if (!plan) return fail('找不到计划');
    if (plan.status !== 'paused') return fail('只有暂停的计划可以恢复');
    plan.status = 'active';
    plan.lastError = '';
    arm(plan, state.clock);
    return pass({ plan: plan });
  }

  function stopPlan(state, id) {
    const plan = findPlan(state, id);
    if (!plan) return fail('找不到计划');
    if (plan.status === 'ended') return fail('计划已经终止');
    plan.status = 'ended';
    plan.nextRun = null;
    return pass({ plan: plan });
  }

  function removePlan(state, id) {
    const plan = findPlan(state, id);
    if (!plan) return fail('找不到计划');
    if (plan.status === 'active') return fail('请先终止，再删除');
    state.plans = state.plans.filter(function (item) { return item.id !== id; });
    return pass();
  }

  function executePlan(state, plan) {
    const result = buyByMoney(state, plan.amountCents, { type: 'dca', planId: plan.id, note: '' });
    if (!result.ok) {
      plan.failTimes += 1;
      plan.lastError = result.error;
      addTrade(state, {
        type: 'dca_fail',
        planId: plan.id,
        moneyCents: plan.amountCents,
        note: result.error
      });
    } else {
      plan.successTimes += 1;
      plan.failTimes = plan.failTimes || 0;
      plan.investedCents += result.payCents;
      plan.investedUnits += result.units;
      plan.lastError = '';
    }
    return result;
  }

  function runDuePlans(state) {
    const results = [];
    const plans = state.plans.slice().sort(function (a, b) { return a.id - b.id; });
    plans.forEach(function (plan) {
      if (plan.status !== 'active' || !plan.nextRun) return;
      if (clockValue(plan.nextRun) > clockValue(state.clock)) return;
      const result = executePlan(state, plan);
      scheduleAfterExecution(plan, state.clock);
      results.push({
        ok: result.ok,
        planId: plan.id,
        error: result.error,
        payCents: result.payCents || 0,
        units: result.units || 0
      });
    });
    return results;
  }

  function advanceOne(state) {
    const next = nextTradingDay(state.clock);
    const candle = makeCandle(ymd(next), state.markCents, scenarioOf(state), makeRng(state.rng));
    state.candles.push(candle);
    if (state.candles.length > 5000) state.candles.splice(0, state.candles.length - 5000);
    state.markCents = candle.open;
    state.clock = { y: next.y, m: next.m, d: next.d, hh: 10, mm: 0 };
    const dca = runDuePlans(state);
    state.markCents = candle.close;
    state.clock = { y: next.y, m: next.m, d: next.d, hh: 15, mm: 0 };
    takeSnapshot(state);
    return { date: ymd(next), open: candle.open, close: candle.close, dca: dca };
  }

  function advanceDays(state, n) {
    const count = n | 0;
    if (count < 1) return [];
    const logs = [];
    for (let i = 0; i < count; i++) logs.push(advanceOne(state));
    return logs;
  }

  function setSpread(state, cents) {
    if (!Number.isInteger(cents) || cents < 0 || cents > 1000) return fail('单边点差需在 0 到 10 元之间');
    if (state.markCents - cents <= 0) return fail('点差过大，卖出价会小于等于 0');
    state.settings.spreadCents = cents;
    if (state.snapshots.length) takeSnapshot(state);
    return pass();
  }

  function setScenario(state, id) {
    if (!SCENARIOS[id]) return fail('未知的行情假设');
    state.settings.scenario = id;
    return pass();
  }

  function setStartCash(state, cents) {
    if (!Number.isInteger(cents) || cents < 10000 || cents > 1000000000) return fail('初始资金需在 100 元到 1000 万元之间');
    const account = state.account;
    const pristine = state.trades.length === 0 && state.plans.length === 0 && account.gramUnits === 0
      && account.cashCents === account.principalCents;
    state.settings.startCashCents = cents;
    if (pristine) {
      account.cashCents = cents;
      account.principalCents = cents;
      takeSnapshot(state);
    }
    return pass({ appliedNow: pristine });
  }

  function resetAccount(state) {
    const start = state.settings.startCashCents;
    state.account = emptyAccount(start);
    state.plans = [];
    state.trades = [];
    state.snapshots = [];
    takeSnapshot(state);
    return pass();
  }

  function pnlOfSnap(s) {
    return s.realizedCents + (s.valueCents - s.costCents);
  }

  function dayPnlCents(state) {
    const snaps = state.snapshots;
    if (snaps.length < 2) return 0;
    return pnlOfSnap(snaps[snaps.length - 1]) - pnlOfSnap(snaps[snaps.length - 2]);
  }

  function drawdown(state) {
    let peak = 0;
    let maxDd = 0;
    let have = false;
    state.snapshots.forEach(function (s) {
      const equity = s.cashCents + s.valueCents;
      if (!have || equity > peak) peak = equity;
      have = true;
      const dd = equity - peak;
      if (dd < maxDd) maxDd = dd;
    });
    return { cents: maxDd, rate: peak > 0 ? maxDd / peak : 0 };
  }

  function holdingStats(state) {
    const checked = audit(state);
    const account = state.account;
    const candle = state.candles[state.candles.length - 1];
    const prevClose = state.candles.length > 1 ? state.candles[state.candles.length - 2].close : state.markCents;
    const change = state.markCents - prevClose;
    const dd = drawdown(state);
    return {
      markCents: state.markCents,
      prevCloseCents: prevClose,
      changeCents: change,
      changeRate: prevClose ? change / prevClose : 0,
      buyCents: checked.quote.buy,
      sellCents: checked.quote.sell,
      spreadCents: state.settings.spreadCents,
      roundTripCents: state.settings.spreadCents * 2,
      cashCents: account.cashCents,
      principalCents: account.principalCents,
      gramUnits: account.gramUnits,
      costCents: account.costCents,
      avgCostCentsPerGram: account.gramUnits > 0 ? account.costCents * GRAM_UNIT / account.gramUnits : null,
      valueCents: checked.value,
      unrealCents: checked.unreal,
      unrealRate: account.costCents > 0 ? checked.unreal / account.costCents : null,
      realizedCents: account.realizedCents,
      pnlCents: checked.pnl,
      equityCents: checked.equity,
      dayPnlCents: dayPnlCents(state),
      drawdownCents: dd.cents,
      drawdownRate: dd.rate,
      auditOk: checked.ok,
      marketOpen: isMarketOpen(state.clock),
      openCents: candle.open,
      highCents: candle.high,
      lowCents: candle.low,
      closeCents: candle.close
    };
  }

  function weekKey(dateStr) {
    const d = parseYmd(dateStr);
    const w = weekday(d);
    const delta = w === 0 ? -6 : 1 - w;
    return ymd(addDays(d, delta));
  }

  function aggregateCandles(candles, kind) {
    if (kind === 'day' || kind === 'intraday') return candles.slice();
    const buckets = new Map();
    const order = [];
    candles.forEach(function (c) {
      const key = kind === 'week' ? weekKey(c.date) : c.date.slice(0, 7);
      if (!buckets.has(key)) {
        buckets.set(key, { date: c.date, open: c.open, high: c.high, low: c.low, close: c.close });
        order.push(key);
      } else {
        const bucket = buckets.get(key);
        bucket.high = Math.max(bucket.high, c.high);
        bucket.low = Math.min(bucket.low, c.low);
        bucket.close = c.close;
        bucket.date = c.date;
      }
    });
    return order.map(function (key) { return buckets.get(key); });
  }

  function explainRules(state) {
    const spread = formatYuan(state.settings.spreadCents, { symbol: false });
    const roundTrip = formatYuan(state.settings.spreadCents * 2, { symbol: false });
    const scenario = SCENARIOS[scenarioOf(state)];
    return [
      {
        key: 'what',
        title: '它模仿什么',
        paragraphs: [
          '页面按常见的支付宝积存金、银行积存金来做：黄金只记克重，用人民币买入和赎回，不能提取金条。',
          '这是独立的机制模拟器，与支付宝、蚂蚁集团和任何银行无关，不会连接真实账户。'
        ]
      },
      {
        key: 'quote',
        title: '报价和点差',
        paragraphs: [
          '大字是中间价。买入价 = 中间价 + 单边点差，卖出价 = 中间价 − 单边点差。',
          '当前单边点差 ' + spread + ' 元/克，买卖价差 ' + roundTrip + ' 元/克。不再另收手续费，成本就在价差里。'
        ]
      },
      {
        key: 'buy',
        title: '买入',
        paragraphs: [
          '可以按金额，也可以按克重，最低 1.00 元。克重保留到 0.0001 克，金额保留到 0.01 元。',
          '按金额买入时，不足 0.0001 克的零头留在余额里，不会多扣。单笔不超过 100 万元。'
        ]
      },
      {
        key: 'sell',
        title: '卖出和估值',
        paragraphs: [
          '卖出按卖出价成交。持仓市值也按卖出价计算，因为这是此刻赎回能拿到的钱。',
          '所以金价没变时，刚买完也会显示大约等于双边点差的浮亏。这是价差，不是账算错。'
        ]
      },
      {
        key: 'pnl',
        title: '成本和收益',
        paragraphs: [
          '成本用移动加权：买入把成交金额加进成本；卖出时按卖出克重占持仓的比例结转成本，剩下的黄金成本价基本不变。',
          '持有收益 = 卖出价市值 − 持仓成本。已实现收益 = 卖出到账 − 结转成本。累计收益 = 两者相加。',
          '总资产 = 现金 + 黄金市值，也等于本金 + 累计收益。追加的虚拟资金计入本金，不计成收益。'
        ]
      },
      {
        key: 'dca',
        title: '定投',
        paragraphs: [
          '周期可以是每个交易日、每周、每两周或每月。扣款日如果休市，顺延到下一个交易日，顺延期间不重复扣款。',
          '点「一年」会立刻走完约 252 个交易日；点「播放」会连续快进。模拟不跟现实时钟。定投按当天开盘价买入，页面上的现价停在收盘价。余额不足则该期失败，不补扣。',
          '暂停后再恢复，只安排下一个扣款日，暂停期间错过的期数不补。创建时可选按当前价先买一笔。'
        ]
      },
      {
        key: 'hours',
        title: '什么时候能交易',
        paragraphs: [
          '模拟交易日的 09:00–22:30 可以手动买卖。周末休市。',
          '2026 年另外内置了一份近似假期（含国庆 10 月 1 日至 7 日），没有模拟调休上班。真实产品的交易时间以银行公告为准。'
        ]
      },
      {
        key: 'path',
        title: '金价从哪里来',
        paragraphs: [
          '路径末端锚定 2026-09-30 上海金 Au(T+D) 附近的 906.80 元/克。更早的 K 线和之后每一天都是随机走势。',
          '当前假设是「' + scenario.name + '」：' + scenario.desc + ' 更换假设只影响之后的涨跌分布，不改写已经走过的价格。红涨绿跌。'
        ]
      }
    ];
  }

  return {
    GRAM_UNIT: GRAM_UNIT,
    ANCHOR_CENTS: ANCHOR_CENTS,
    SCENARIOS: SCENARIOS,
    FREQ_NAME: FREQ_NAME,
    createInitialState: createInitialState,
    createBlankState: createBlankState,
    quote: quote,
    audit: audit,
    holdingStats: holdingStats,
    buyByMoney: buyByMoney,
    buyByGram: buyByGram,
    sellByGram: sellByGram,
    sellByMoney: sellByMoney,
    sellAll: sellAll,
    deposit: deposit,
    setSpread: setSpread,
    setScenario: setScenario,
    setStartCash: setStartCash,
    resetAccount: resetAccount,
    createPlan: createPlan,
    previewSchedule: previewSchedule,
    pausePlan: pausePlan,
    resumePlan: resumePlan,
    stopPlan: stopPlan,
    removePlan: removePlan,
    advanceDays: advanceDays,
    previewBuyByMoney: previewBuyByMoney,
    previewBuyByGram: previewBuyByGram,
    previewSellByGram: previewSellByGram,
    previewSellByMoney: previewSellByMoney,
    estimateSellRealized: estimateSellRealized,
    isTradingDay: isTradingDay,
    isMarketOpen: isMarketOpen,
    closureReason: closureReason,
    holidayName: holidayName,
    weekday: weekday,
    weekName: weekName,
    nextTradingDay: nextTradingDay,
    lastTradingDay: lastTradingDay,
    intradayPoints: intradayPoints,
    aggregateCandles: aggregateCandles,
    explainRules: explainRules,
    parseYuanToCents: parseYuanToCents,
    parseGramToUnits: parseGramToUnits,
    formatYuan: formatYuan,
    formatGram: formatGram,
    formatPct: formatPct,
    formatClock: formatClock,
    formatDate: formatDate,
    ymd: ymd
  };
});
