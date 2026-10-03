/* node js/engine.test.js */
'use strict';

const JCJ = require('./engine.js');

let passed = 0;
let failed = 0;

function assert(cond, message) {
  if (cond) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error('FAIL:', message);
}

function approx(a, b, tol) {
  return Math.abs(a - b) <= tol;
}

(function moneyAndParse() {
  assert(JCJ.parseYuanToCents('500') === 50000, '500 yuan');
  assert(JCJ.parseYuanToCents('500.1') === 50010, '500.1 yuan');
  assert(JCJ.parseYuanToCents('500.10') === 50010, '500.10 yuan');
  assert(JCJ.parseYuanToCents('1.') === 100, 'trailing dot');
  assert(JCJ.parseYuanToCents('') === null, 'empty yuan');
  assert(JCJ.parseYuanToCents('500.123') === null, 'too many decimals');
  assert(JCJ.parseYuanToCents('-1') === null, 'negative yuan');
  assert(JCJ.parseGramToUnits('1.1018') === 11018, 'grams');
  assert(JCJ.parseGramToUnits('0.0001') === 1, 'min gram');
  assert(JCJ.parseGramToUnits('1.10180') === null, 'five decimals');
  assert(JCJ.formatYuan(0) === '¥0.00', 'zero yuan');
  assert(JCJ.formatYuan(-176) === '-¥1.76', 'negative yuan');
  assert(JCJ.formatYuan(176, { signed: true }) === '+¥1.76', 'signed yuan');
  assert(JCJ.formatYuan(90680, { symbol: false }) === '906.80', 'price');
  assert(JCJ.formatGram(11018) === '1.1018', 'format gram');
  assert(JCJ.formatPct(0.0114) === '+1.14%', 'pct up');
  assert(JCJ.formatPct(-0.0032) === '-0.32%', 'pct down');
  assert(JCJ.formatPct(null) === '--', 'pct empty');
})();

(function calendar() {
  assert(JCJ.weekday('2026-01-01') === 4, '2026-01-01 Thursday');
  assert(JCJ.weekday('2026-09-30') === 3, '2026-09-30 Wednesday');
  assert(JCJ.weekday('2026-10-01') === 4, '2026-10-01 Thursday');
  assert(JCJ.weekday('2026-10-03') === 6, '2026-10-03 Saturday');
  assert(JCJ.weekday('2026-10-08') === 4, '2026-10-08 Thursday');
  assert(JCJ.weekday('2026-10-09') === 5, '2026-10-09 Friday');
  assert(JCJ.weekday('2026-10-12') === 1, '2026-10-12 Monday');
  assert(JCJ.weekday('2026-10-19') === 1, '2026-10-19 Monday');
  assert(JCJ.holidayName('2026-10-03') === '国庆', 'national day name');
  assert(JCJ.holidayName('2026-09-30') === '', 'anchor is not a holiday');
  assert(JCJ.isTradingDay('2026-09-30') === true, 'anchor trades');
  assert(JCJ.isTradingDay('2026-10-01') === false, 'oct 1 closed');
  assert(JCJ.isTradingDay('2026-10-03') === false, 'oct 3 closed');
  assert(JCJ.isTradingDay('2026-10-07') === false, 'oct 7 closed');
  assert(JCJ.isTradingDay('2026-10-08') === true, 'oct 8 open');
  assert(JCJ.isMarketOpen({ y: 2026, m: 9, d: 30, hh: 15, mm: 0 }) === true, '15:00 open');
  assert(JCJ.isMarketOpen({ y: 2026, m: 9, d: 30, hh: 9, mm: 0 }) === true, '09:00 open');
  assert(JCJ.isMarketOpen({ y: 2026, m: 9, d: 30, hh: 8, mm: 59 }) === false, '08:59 closed');
  assert(JCJ.isMarketOpen({ y: 2026, m: 9, d: 30, hh: 22, mm: 30 }) === true, '22:30 open');
  assert(JCJ.isMarketOpen({ y: 2026, m: 9, d: 30, hh: 22, mm: 31 }) === false, '22:31 closed');
  assert(JCJ.isMarketOpen({ y: 2026, m: 10, d: 3, hh: 10, mm: 0 }) === false, 'holiday closed');
  assert(JCJ.ymd(JCJ.nextTradingDay({ y: 2026, m: 9, d: 30, hh: 15, mm: 0 })) === '2026-10-08', 'next day skips holiday');
  assert(JCJ.closureReason('2026-10-03').indexOf('国庆') >= 0, 'closure reason');
})();

(function exactFill() {
  const st = JCJ.createBlankState();
  const buy = JCJ.buyByMoney(st, 100);
  assert(buy.ok && buy.units === 11 && buy.payCents === 100, '1 yuan fill ' + JSON.stringify(buy));
  JCJ.resetAccount(st);
  const big = JCJ.buyByMoney(st, 100000);
  assert(big.ok && big.units === 11018 && big.payCents === 99999, '1000 yuan fill ' + JSON.stringify(big));
  const checked = JCJ.audit(st);
  assert(checked.unreal === -176, 'spread loss is 1.76 yuan, got ' + checked.unreal);
  assert(checked.ok, 'audit after buy');
  const sold = JCJ.sellAll(st);
  assert(sold.ok && sold.receiveCents === 99823 && sold.realizedCents === -176, 'sell all ' + JSON.stringify(sold));
  assert(st.account.gramUnits === 0 && st.account.costCents === 0, 'flat after sell all');
  assert(st.account.cashCents === 1999824, 'cash after round trip ' + st.account.cashCents);
  assert(JCJ.audit(st).ok && JCJ.audit(st).pnl === -176, 'pnl is the spread');
})();

(function zeroSpread() {
  const st = JCJ.createBlankState();
  assert(JCJ.setSpread(st, 0).ok, 'zero spread allowed');
  const buy = JCJ.buyByMoney(st, 100000);
  assert(buy.ok, 'buy at zero spread');
  assert(JCJ.audit(st).unreal === 0, 'no instant loss without spread');
  assert(JCJ.setSpread(st, 90680).ok === false, 'spread cannot wipe the bid');
})();

(function weightedCost() {
  const st = JCJ.createBlankState();
  JCJ.buyByMoney(st, 100000);
  const beforeUnits = st.account.gramUnits;
  const beforeCost = st.account.costCents;
  const sold = JCJ.sellByGram(st, 5000);
  assert(sold.ok, 'partial sell');
  assert(st.account.gramUnits === beforeUnits - 5000, 'units reduced');
  const released = beforeCost - st.account.costCents;
  assert(sold.realizedCents === sold.receiveCents - released, 'realized identity');
  const avgBefore = beforeCost / beforeUnits;
  const avgAfter = st.account.costCents / st.account.gramUnits;
  assert(approx(avgBefore, avgAfter, avgBefore * 1e-4), 'average cost stays put');
  assert(JCJ.audit(st).ok, 'audit after partial');
  const over = JCJ.sellByGram(st, st.account.gramUnits + 1);
  assert(!over.ok, 'cannot oversell');
  assert(st.account.gramUnits === beforeUnits - 5000, 'failed sell does not move gold');
})();

(function guards() {
  const st = JCJ.createBlankState();
  st.account.cashCents = 50;
  st.account.principalCents = 50;
  const denied = JCJ.buyByMoney(st, 10000);
  assert(!denied.ok, 'cash short');
  assert(st.account.cashCents === 50 && st.account.gramUnits === 0, 'state unchanged');
  st.clock = { y: 2026, m: 10, d: 3, hh: 10, mm: 0 };
  const closed = JCJ.buyByMoney(st, 10000);
  assert(!closed.ok, 'closed market');
  const made = JCJ.createPlan(st, { amountCents: 10000, freq: 'daily', immediate: true });
  assert(!made.ok && st.plans.length === 0, 'immediate buy does not create a plan when closed');
})();

(function plansAndHolidays() {
  const st = JCJ.createBlankState();
  const daily = JCJ.createPlan(st, { amountCents: 10000, freq: 'daily' });
  assert(daily.ok, 'create daily');
  assert(JCJ.ymd(daily.plan.nextRun) === '2026-10-08', 'daily first run skips national day');
  assert(JCJ.ymd(JCJ.previewSchedule({ freq: 'daily' }, st.clock)) === '2026-10-08', 'schedule preview');
  const monday = JCJ.createPlan(st, { amountCents: 10000, freq: 'weekly', weekday: 1 });
  assert(JCJ.ymd(monday.plan.nextRun) === '2026-10-08', 'Monday plan postponed to Oct 8');
  assert(monday.plan.nominal === '2026-10-05', 'nominal stays on Monday');
  const biweekly = JCJ.createPlan(st, { amountCents: 10000, freq: 'biweekly', weekday: 1 });
  assert(JCJ.ymd(biweekly.plan.nextRun) === '2026-10-08', 'biweekly first run is the coming slot');
  const month = JCJ.createPlan(st, { amountCents: 10000, freq: 'monthly', monthDay: 1 });
  assert(JCJ.ymd(month.plan.nextRun) === '2026-10-08', 'month day 1 postponed');

  const early = JCJ.createBlankState();
  early.clock = { y: 2026, m: 10, d: 8, hh: 9, mm: 0 };
  const beforeOpenSlot = JCJ.createPlan(early, { amountCents: 10000, freq: 'weekly', weekday: 1 });
  assert(JCJ.ymd(beforeOpenSlot.plan.nextRun) === '2026-10-08', '09:00 still catches postponed Monday');
  assert(beforeOpenSlot.plan.nextRun.hh === 10, 'runs at 10:00');

  const late = JCJ.createBlankState();
  late.clock = { y: 2026, m: 10, d: 8, hh: 15, mm: 0 };
  const afterSlot = JCJ.createPlan(late, { amountCents: 10000, freq: 'weekly', weekday: 1 });
  assert(JCJ.ymd(afterSlot.plan.nextRun) === '2026-10-12', '15:00 waits for the next Monday');

  const run = JCJ.createBlankState();
  JCJ.createPlan(run, { amountCents: 10000, freq: 'daily' });
  JCJ.createPlan(run, { amountCents: 10000, freq: 'weekly', weekday: 1 });
  JCJ.createPlan(run, { amountCents: 10000, freq: 'biweekly', weekday: 1 });
  const logs = JCJ.advanceDays(run, 1);
  assert(logs[0].date === '2026-10-08', 'advance lands on Oct 8');
  assert(logs[0].dca.length === 3 && logs[0].dca.every(function (item) { return item.ok; }), 'three plans fire once');
  assert(run.plans[0].successTimes === 1, 'daily once');
  assert(JCJ.ymd(run.plans[0].nextRun) === '2026-10-09', 'daily rolls to Friday');
  assert(JCJ.ymd(run.plans[1].nextRun) === '2026-10-12', 'weekly rolls to next Monday');
  assert(JCJ.ymd(run.plans[2].nextRun) === '2026-10-19', 'biweekly skips a week');
  assert(run.clock.hh === 15 && run.markCents === logs[0].close, 'parked at the close');
  assert(run.trades[0].time.hh === 10, 'dca timestamp is 10:00');
  assert(run.trades[0].priceCents === logs[0].open + run.settings.spreadCents, 'dca uses the open');

  const more = JCJ.advanceDays(run, 2);
  assert(more[0].date === '2026-10-09' && more[1].date === '2026-10-12', 'skips the weekend');
  assert(run.plans[0].successTimes === 3, 'daily caught both following sessions');
  assert(run.plans[1].successTimes === 2, 'weekly fired on the 12th');
  assert(run.plans[2].successTimes === 1, 'biweekly did not fire early');
  assert(JCJ.audit(run).ok, 'audit after scheduled buys');
})();

(function pauseFailDeposit() {
  const st = JCJ.createBlankState();
  const created = JCJ.createPlan(st, { amountCents: 10000, freq: 'daily' });
  JCJ.pausePlan(st, created.plan.id);
  JCJ.advanceDays(st, 1);
  assert(created.plan.successTimes === 0 && created.plan.failTimes === 0, 'paused plan stays quiet');
  JCJ.resumePlan(st, created.plan.id);
  assert(JCJ.ymd(created.plan.nextRun) === '2026-10-09', 'resume does not backfill');
  st.account.cashCents = 0;
  st.account.principalCents = 0;
  JCJ.advanceDays(st, 1);
  assert(created.plan.failTimes === 1 && st.account.gramUnits === 0, 'short cash fails the slot');
  assert(st.trades.some(function (t) { return t.type === 'dca_fail'; }), 'failure is recorded');
  assert(JCJ.deposit(st, 50000).ok, 'deposit');
  JCJ.advanceDays(st, 1);
  assert(created.plan.successTimes === 1, 'later slot can succeed');
  assert(JCJ.audit(st).ok, 'audit after deposit and fail');
  JCJ.stopPlan(st, created.plan.id);
  const stoppedTimes = created.plan.successTimes;
  JCJ.advanceDays(st, 1);
  assert(created.plan.successTimes === stoppedTimes, 'stopped plan does not buy');
  assert(JCJ.removePlan(st, created.plan.id).ok, 'remove ended plan');
})();

(function immediateAndMonth() {
  const st = JCJ.createBlankState();
  const created = JCJ.createPlan(st, { amountCents: 50000, freq: 'monthly', monthDay: 8, immediate: true });
  assert(created.ok && created.plan.successTimes === 1, 'immediate buy counts');
  assert(JCJ.ymd(created.plan.nextRun) === '2026-10-08', 'next monthly slot remains');
  assert(st.trades[0].note === '创建时先买一笔', 'immediate note');
  JCJ.advanceDays(st, 1);
  assert(created.plan.successTimes === 2, 'scheduled buy still happens');
  const nov = JCJ.createBlankState();
  nov.clock = { y: 2026, m: 10, d: 8, hh: 15, mm: 0 };
  const nextMonth = JCJ.createPlan(nov, { amountCents: 10000, freq: 'monthly', monthDay: 8 });
  assert(JCJ.ymd(nextMonth.plan.nextRun) === '2026-11-09', 'Nov 8 is Sunday so it slips to Monday');
})();

(function historyAndYear() {
  const a = JCJ.createInitialState();
  const b = JCJ.createInitialState();
  assert(JSON.stringify(a.candles) === JSON.stringify(b.candles), 'history is deterministic');
  assert(a.candles.length === 252, 'one year of sessions');
  assert(a.candles[a.candles.length - 1].date === '2026-09-30', 'anchor date');
  assert(a.candles[a.candles.length - 1].close === 90680, 'anchor price');
  assert(a.markCents === 90680 && a.clock.hh === 15, 'parked on the anchor close');
  a.candles.forEach(function (c) {
    assert(JCJ.isTradingDay(c.date), 'candle falls on a trading day ' + c.date);
    assert(c.high >= c.open && c.high >= c.close && c.low <= c.open && c.low <= c.close && c.low > 0, 'ohlc ' + c.date);
  });
  assert(a.candles.every(function (c) { return c.date !== '2026-01-01' && c.date !== '2026-02-17'; }), 'holidays absent');
  const points = JCJ.intradayPoints(a.candles[a.candles.length - 1]);
  const again = JCJ.intradayPoints(a.candles[a.candles.length - 1]);
  assert(JSON.stringify(points) === JSON.stringify(again), 'intraday stable');
  assert(points[0] === a.candles[a.candles.length - 1].open, 'intraday opens');
  assert(points[points.length - 1] === a.candles[a.candles.length - 1].close, 'intraday closes');
  const candle = a.candles[a.candles.length - 1];
  assert(points.every(function (p) { return p >= candle.low && p <= candle.high; }), 'intraday inside range');

  a.account.cashCents = 10000000;
  a.account.principalCents = 10000000;
  JCJ.createPlan(a, { amountCents: 20000, freq: 'daily' });
  const logs = JCJ.advanceDays(a, 252);
  assert(logs.length === 252, '252 sessions');
  assert(logs[0].date === '2026-10-08', 'year starts after the holiday');
  assert(logs[1].date === '2026-10-09' && logs[2].date === '2026-10-12', 'first week shape');
  assert(a.plans[0].successTimes === 252, 'daily plan hits every session, got ' + a.plans[0].successTimes);
  assert(a.plans[0].failTimes === 0, 'no failed slots');
  assert(JCJ.audit(a).ok, 'audit after a simulated year');
  assert(a.markCents === a.candles[a.candles.length - 1].close, 'mark matches the last close');
  const last = a.snapshots[a.snapshots.length - 1];
  const snapPnl = last.realizedCents + last.valueCents - last.costCents;
  assert(snapPnl === JCJ.audit(a).pnl, 'snapshot matches the ledger');
  const copy = JSON.parse(JSON.stringify(a));
  const left = JCJ.advanceDays(a, 1)[0].close;
  const right = JCJ.advanceDays(copy, 1)[0].close;
  assert(left === right, 'saved rng keeps the same next close');
})();

(function fuzzLedger() {
  const st = JCJ.createBlankState();
  let seed = 99;
  function rnd() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  for (let i = 0; i < 80; i++) {
    const yuan = 1 + Math.floor(rnd() * 400);
    JCJ.buyByMoney(st, yuan * 100);
    assert(JCJ.audit(st).ok, 'audit during buy ' + i);
    if (st.account.gramUnits > 10 && rnd() > 0.45) {
      const units = Math.max(1, Math.floor(st.account.gramUnits * rnd()));
      JCJ.sellByGram(st, Math.min(units, st.account.gramUnits));
      assert(JCJ.audit(st).ok, 'audit during sell ' + i);
      assert(st.account.cashCents >= 0 && st.account.costCents >= 0, 'no negative balances');
    }
  }
  if (st.account.gramUnits > 0) JCJ.sellAll(st);
  assert(st.account.gramUnits === 0 && st.account.costCents === 0, 'fuzz flat');
  assert(JCJ.audit(st).ok, 'audit after fuzz');
})();

(function rulesMentionSpread() {
  const st = JCJ.createBlankState();
  const text = JSON.stringify(JCJ.explainRules(st));
  assert(text.indexOf('0.80') >= 0, 'rules quote the default spread');
  assert(text.indexOf('卖出价') >= 0, 'rules mention sell-price valuation');
})();

if (failed) {
  console.error(failed + ' failed, ' + passed + ' passed');
  process.exit(1);
}
console.log(passed + ' passed');
