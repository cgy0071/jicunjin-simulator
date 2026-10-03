/* 积存金模拟器界面。规则在 engine.js。 */
(function () {
  'use strict';

  const KEY = 'jicunjin-sim-v1';
  const selftest = /(?:\?|&)selftest=1(?:&|$)/.test(location.search);
  const $ = function (id) { return document.getElementById(id); };

  const ui = {
    tab: 'market',
    chartType: 'day',
    chartRange: 'near',
    freq: 'daily',
    tradeFilter: 'all',
    showAllTrades: false,
    playing: false,
    speed: 'fast',
    timer: 0,
    busy: false,
    settingsReady: false,
    note: '定投按当天开盘价成交，页面上的现价停在收盘价。点「播放」或「一年」会按交易日快进，不跟现实时钟。'
  };
  const form = { side: 'buy', mode: 'money', money: '500', gram: '1.0000' };
  let state = null;
  let redrawPrice = function () {};
  let redrawEquity = function () {};
  let toastTimer = 0;
  let lastPrice = null;
  let chipSig = '';

  function setText(id, text) {
    const el = $(id);
    if (el && el.textContent !== text) el.textContent = text;
  }

  function tone(cents) {
    if (cents > 0) return 'up';
    if (cents < 0) return 'down';
    return 'flat';
  }

  function yuan(cents, signed) {
    return JCJ.formatYuan(cents, { signed: !!signed });
  }

  function plain(cents) {
    return JCJ.formatYuan(cents, { symbol: false });
  }

  function unitsToInput(units) {
    const abs = Math.abs(units);
    return Math.floor(abs / JCJ.GRAM_UNIT) + '.' + String(abs % JCJ.GRAM_UNIT).padStart(4, '0');
  }

  const PLAY_SPEED = {
    slow: { days: 5, delay: 70 },
    mid: { days: 21, delay: 45 },
    fast: { days: 63, delay: 30 }
  };

  function bannerText() {
    const next = JCJ.formatDate(JCJ.nextTradingDay(state.clock));
    const pace = PLAY_SPEED[ui.speed] || PLAY_SPEED.fast;
    return '模拟按交易日快进，不跟现实时钟。播放每步约 ' + pace.days + ' 个交易日，下一步进入 ' + next + '。';
  }

  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2800);
  }

  function saveNow() {
    if (selftest) return;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (err) { /* 隐私模式可能拒绝写入 */ }
  }

  let saveTimer = 0;
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 80);
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== 1 || !parsed.account || !parsed.clock || !parsed.settings || !parsed.rng) return null;
      if (!Array.isArray(parsed.candles) || !parsed.candles.length) return null;
      if (!parsed.meta) parsed.meta = { source: '已保存的模拟行情' };
      if (!JCJ.SCENARIOS[parsed.settings.scenario]) parsed.settings.scenario = 'base';
      return parsed;
    } catch (err) {
      return null;
    }
  }

  function markSeg(selector, attr, value) {
    document.querySelectorAll(selector).forEach(function (btn) {
      const on = btn.getAttribute(attr) === value;
      btn.classList.toggle('is-on', on);
      if (btn.hasAttribute('aria-pressed') || btn.closest('.seg')) btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function applyTab() {
    document.querySelectorAll('[data-panel]').forEach(function (el) {
      el.classList.toggle('is-on', el.getAttribute('data-panel') === ui.tab);
    });
    markSeg('[data-tab]', 'data-tab', ui.tab);
  }

  function rangeCount() {
    const table = {
      day: { near: 66, year: 252, all: 100000 },
      week: { near: 26, year: 52, all: 100000 },
      month: { near: 6, year: 12, all: 100000 }
    };
    const row = table[ui.chartType] || table.day;
    return row[ui.chartRange] || row.near;
  }

  function priceModel() {
    const stats = JCJ.holdingStats(state);
    if (ui.chartType === 'intraday') {
      const candle = state.candles[state.candles.length - 1];
      const prev = state.candles.length > 1 ? state.candles[state.candles.length - 2].close : candle.open;
      return { type: 'line', values: JCJ.intradayPoints(candle), prevClose: prev, cost: stats.avgCostCentsPerGram, date: candle.date };
    }
    return {
      type: 'candle',
      candles: JCJ.aggregateCandles(state.candles, ui.chartType),
      cost: stats.avgCostCentsPerGram,
      range: rangeCount()
    };
  }

  function equityModel() {
    return {
      points: state.snapshots.map(function (snap) {
        return {
          date: snap.date,
          equity: (snap.cashCents + snap.valueCents) / 100,
          principal: snap.principalCents / 100
        };
      })
    };
  }

  function rememberInput() {
    const value = $('ticket-input').value;
    if (form.mode === 'money') form.money = value;
    else form.gram = value;
  }

  function syncInput() {
    const input = $('ticket-input');
    input.value = form.mode === 'money' ? form.money : form.gram;
    $('ticket-prefix').textContent = form.mode === 'money' ? '¥' : '';
    $('ticket-suffix').textContent = form.mode === 'gram' ? '克' : '';
  }

  function readTicket() {
    const raw = $('ticket-input').value;
    const quote = JCJ.quote(state);
    let preview;
    if (form.mode === 'money') {
      const cents = JCJ.parseYuanToCents(raw);
      if (cents == null) preview = { ok: false, error: '请输入正确的金额' };
      else if (form.side === 'buy') preview = JCJ.previewBuyByMoney(cents, quote.buy, state.account.cashCents);
      else preview = JCJ.previewSellByMoney(cents, quote.sell, state.account.gramUnits);
    } else {
      const units = JCJ.parseGramToUnits(raw);
      if (units == null) preview = { ok: false, error: '请输入正确的克重' };
      else if (form.side === 'buy') preview = JCJ.previewBuyByGram(units, quote.buy, state.account.cashCents);
      else preview = JCJ.previewSellByGram(units, quote.sell, state.account.gramUnits);
    }
    if (preview.ok && !JCJ.isMarketOpen(state.clock)) {
      preview = Object.assign({}, preview, { ok: false, error: '现在不能交易：' + (JCJ.closureReason(state.clock) || '非交易时间') });
    }
    return preview;
  }

  function addLine(box, label, value) {
    const row = document.createElement('p');
    const name = document.createElement('span');
    name.textContent = label;
    const strong = document.createElement('strong');
    strong.className = 'num';
    strong.textContent = value;
    row.appendChild(name);
    row.appendChild(strong);
    box.appendChild(row);
  }

  function paintPreview() {
    const preview = readTicket();
    const box = $('ticket-preview');
    box.replaceChildren();
    if (preview.priceCents) addLine(box, form.side === 'buy' ? '买入价' : '卖出价', plain(preview.priceCents) + ' 元/克');
    if (preview.units) addLine(box, form.side === 'buy' ? '可得克重' : '卖出克重', JCJ.formatGram(preview.units) + ' 克');
    if (form.side === 'buy' && preview.payCents) addLine(box, '实际扣款', yuan(preview.payCents));
    if (form.side === 'sell' && preview.receiveCents) addLine(box, '实际到账', yuan(preview.receiveCents));
    if (form.side === 'buy' && preview.units) {
      const loss = Math.round(preview.units * state.settings.spreadCents * 2 / JCJ.GRAM_UNIT);
      addLine(box, '价差', loss === 0 ? '金价不变时没有价差亏损' : '金价不变时约浮亏 ' + yuan(loss));
    }
    if (form.side === 'sell' && preview.units && preview.receiveCents) {
      const realized = JCJ.estimateSellRealized(state.account, preview.units, preview.receiveCents);
      if (realized != null) addLine(box, '实现收益', yuan(realized, true));
    }
    if (preview.refundCents > 0) addLine(box, '零头留存', yuan(preview.refundCents));
    if (preview.capped) addLine(box, '提示', '金额超过持仓，将全部卖出');
    $('ticket-error').textContent = preview.ok ? '' : (preview.error || '');
    const button = $('ticket-submit');
    button.disabled = !preview.ok || ui.busy;
    button.textContent = form.side === 'buy' ? '确认买入' : '确认卖出';
    button.classList.toggle('btn-gold', form.side === 'buy');
    button.classList.toggle('btn-dark', form.side === 'sell');
    $('ticket-avail').textContent = form.side === 'buy'
      ? '可用余额 ' + yuan(state.account.cashCents)
      : '可卖 ' + JCJ.formatGram(state.account.gramUnits) + ' 克';
    $('deposit-link').hidden = form.side !== 'buy';
  }

  function paintChips() {
    const sig = form.side + '|' + form.mode + '|' + state.account.gramUnits;
    if (sig === chipSig) return;
    chipSig = sig;
    const box = $('chips');
    box.replaceChildren();
    function chip(label, act, extra) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.dataset.act = act;
      if (extra) Object.keys(extra).forEach(function (key) { btn.dataset[key] = extra[key]; });
      box.appendChild(btn);
    }
    if (form.side === 'sell') chip('全部', 'sell-all');
    if (form.mode === 'money' && form.side === 'buy') {
      [100, 500, 1000, 5000].forEach(function (n) { chip(n + ' 元', 'chip', { value: String(n) }); });
    } else if (form.mode === 'money') {
      [100, 500, 1000].forEach(function (n) { chip(n + ' 元', 'chip', { value: String(n) }); });
    } else if (form.side === 'buy') {
      ['0.1000', '0.5000', '1.0000', '5.0000'].forEach(function (n) { chip(n + ' 克', 'chip', { value: n }); });
    } else {
      chip('25%', 'chip-pct', { pct: '25' });
      chip('50%', 'chip-pct', { pct: '50' });
      chip('1 克', 'chip', { value: '1.0000' });
    }
  }

  function paintPlans() {
    const box = $('plan-list');
    box.replaceChildren();
    if (!state.plans.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = '还没有定投。定好金额和周期，再按「下一交易日」，扣款才会发生。';
      box.appendChild(p);
      return;
    }
    const order = { active: 0, paused: 1, ended: 2 };
    const plans = state.plans.slice().sort(function (a, b) {
      return (order[a.status] - order[b.status]) || (a.id - b.id);
    });
    plans.forEach(function (plan) {
      const card = document.createElement('article');
      card.className = 'plan';
      const head = document.createElement('header');
      const title = document.createElement('b');
      title.textContent = planTitle(plan) + ' · ' + yuan(plan.amountCents);
      const status = document.createElement('span');
      status.className = 'meta';
      status.textContent = plan.status === 'active' ? '进行中' : (plan.status === 'paused' ? '已暂停' : '已终止');
      head.appendChild(title);
      head.appendChild(status);
      card.appendChild(head);
      const meta = document.createElement('p');
      meta.className = 'meta';
      const bits = ['成功 ' + plan.successTimes + ' 期'];
      if (plan.failTimes) bits.push('失败 ' + plan.failTimes + ' 期');
      bits.push('累计 ' + yuan(plan.investedCents));
      bits.push(JCJ.formatGram(plan.investedUnits) + ' 克');
      meta.textContent = bits.join(' · ');
      card.appendChild(meta);
      if (plan.nextRun && plan.status === 'active') {
        const next = document.createElement('p');
        next.className = 'meta';
        const delay = plan.nominal && plan.nominal !== JCJ.ymd(plan.nextRun) ? '，遇休市顺延' : '';
        next.textContent = '下次扣款 ' + JCJ.formatClock(plan.nextRun) + delay;
        card.appendChild(next);
      }
      if (plan.lastError && plan.status === 'active') {
        const err = document.createElement('p');
        err.className = 'form-error';
        err.textContent = '最近一次：' + plan.lastError;
        card.appendChild(err);
      }
      const actions = document.createElement('div');
      actions.className = 'plan-actions';
      function act(name, label) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn';
        btn.dataset.act = name;
        btn.dataset.id = String(plan.id);
        btn.textContent = label;
        actions.appendChild(btn);
      }
      if (plan.status === 'active') {
        act('pause', '暂停');
        act('stop', '终止');
      } else if (plan.status === 'paused') {
        act('resume', '恢复');
        act('stop', '终止');
      } else {
        act('remove', '删除');
      }
      card.appendChild(actions);
      box.appendChild(card);
    });
  }

  function planTitle(plan) {
    const day = '周' + '日一二三四五六'[plan.weekday];
    if (plan.freq === 'weekly') return '每' + day;
    if (plan.freq === 'biweekly') return '每两周 · ' + day;
    if (plan.freq === 'monthly') return '每月 ' + plan.monthDay + ' 日';
    return JCJ.FREQ_NAME[plan.freq];
  }

  function tradeTitle(type) {
    return { buy: '买入', sell: '卖出', dca: '定投', dca_fail: '定投失败', deposit: '转入资金' }[type] || type;
  }

  function paintTrades() {
    const box = $('trade-list');
    box.replaceChildren();
    const rows = state.trades.filter(function (trade) {
      if (ui.tradeFilter === 'buy') return trade.type === 'buy' || trade.type === 'dca';
      if (ui.tradeFilter === 'sell') return trade.type === 'sell';
      if (ui.tradeFilter === 'fail') return trade.type === 'dca_fail';
      return true;
    }).slice().reverse();
    if (!rows.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = '还没有成交。';
      box.appendChild(p);
      return;
    }
    const visible = ui.showAllTrades ? rows : rows.slice(0, 40);
    visible.forEach(function (trade) {
      const row = document.createElement('article');
      row.className = 'trade';
      const left = document.createElement('div');
      const name = document.createElement('b');
      name.textContent = tradeTitle(trade.type);
      if (trade.note) name.textContent += ' · ' + trade.note;
      const meta = document.createElement('div');
      meta.className = 'meta';
      const bits = [JCJ.formatClock(trade.time)];
      if (trade.gramUnits) bits.push(JCJ.formatGram(trade.gramUnits) + ' 克');
      if (trade.priceCents) bits.push('@ ' + plain(trade.priceCents));
      if (trade.type === 'sell') bits.push('实现 ' + yuan(trade.realizedCents, true));
      meta.textContent = bits.join('  ');
      left.appendChild(name);
      left.appendChild(meta);
      const money = document.createElement('div');
      money.className = 'money num';
      if (trade.type === 'sell' || trade.type === 'deposit') money.textContent = yuan(trade.moneyCents, true);
      else if (trade.type === 'dca_fail') money.textContent = '未扣款';
      else money.textContent = yuan(-trade.moneyCents, true);
      row.appendChild(left);
      row.appendChild(money);
      box.appendChild(row);
    });
    if (rows.length > visible.length) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'btn';
      more.dataset.act = 'more-trades';
      more.textContent = '展开全部 ' + rows.length + ' 笔';
      box.appendChild(more);
    }
  }

  function paintRules() {
    const root = $('rules');
    const sig = state.settings.spreadCents + '|' + state.settings.scenario;
    if (root.dataset.sig === sig) return;
    const open = {};
    root.querySelectorAll('details[open]').forEach(function (el) { open[el.dataset.key] = true; });
    const first = root.dataset.sig == null;
    root.replaceChildren();
    JCJ.explainRules(state).forEach(function (section, index) {
      const details = document.createElement('details');
      details.dataset.key = section.key;
      if (open[section.key] || (first && index === 0)) details.open = true;
      const summary = document.createElement('summary');
      summary.textContent = section.title;
      details.appendChild(summary);
      section.paragraphs.forEach(function (text) {
        const p = document.createElement('p');
        p.textContent = text;
        details.appendChild(p);
      });
      root.appendChild(details);
    });
    root.dataset.sig = sig;
  }

  function paintPlanForm() {
    markSeg('[data-freq]', 'data-freq', ui.freq);
    $('weekday-line').hidden = !(ui.freq === 'weekly' || ui.freq === 'biweekly');
    $('monthday-line').hidden = ui.freq !== 'monthly';
    const amount = JCJ.parseYuanToCents($('plan-amount').value);
    const monthDay = parseInt($('plan-day').value, 10);
    const next = JCJ.previewSchedule({
      freq: ui.freq,
      weekday: parseInt($('plan-weekday').value, 10),
      monthDay: monthDay
    }, state.clock);
    if (amount == null || amount < 100) $('plan-next').textContent = '定投金额最低 1.00 元';
    else if (!next) $('plan-next').textContent = '这个扣款日无法安排';
    else $('plan-next').textContent = '下次扣款 ' + JCJ.formatClock(next) + (ui.freq === 'daily' ? '（遇休市顺延）' : '');
    $('plan-submit').disabled = ui.busy;
  }

  function render() {
    const stats = JCJ.holdingStats(state);
    setText('top-equity', yuan(stats.equityCents));
    setText('top-grams', JCJ.formatGram(stats.gramUnits) + ' 克');
    setText('top-cash', yuan(stats.cashCents));
    setText('sim-clock', '模拟 ' + JCJ.formatClock(state.clock));
    const status = $('sim-status');
    if (stats.marketOpen) {
      status.textContent = '交易中';
      status.className = 'pill';
    } else {
      status.textContent = JCJ.closureReason(state.clock) || '休市';
      status.className = 'pill closed';
    }
    setText('banner', bannerText());
    setText('sim-note', ui.note);
    const price = $('price-num');
    const priceText = plain(stats.markCents);
    if (price.textContent !== priceText) {
      price.textContent = priceText;
      if (lastPrice != null && lastPrice !== stats.markCents) {
        price.classList.remove('flash-up', 'flash-down');
        void price.offsetWidth;
        price.classList.add(stats.markCents > lastPrice ? 'flash-up' : 'flash-down');
      }
      lastPrice = stats.markCents;
    }
    const change = $('price-change');
    change.className = 'change num ' + tone(stats.changeCents);
    change.textContent = (stats.changeCents > 0 ? '+' : '') + plain(stats.changeCents);
    const pct = document.createElement('small');
    pct.textContent = JCJ.formatPct(stats.changeRate);
    change.appendChild(pct);
    setText('q-buy', plain(stats.buyCents));
    setText('q-sell', plain(stats.sellCents));
    setText('q-spread', plain(stats.roundTripCents));
    setText('o-open', plain(stats.openCents));
    setText('o-high', plain(stats.highCents));
    setText('o-low', plain(stats.lowCents));
    setText('o-prev', plain(stats.prevCloseCents));
    setText('strip-grams', JCJ.formatGram(stats.gramUnits) + ' 克');
    setText('strip-value', yuan(stats.valueCents));
    const strip = $('strip-pnl');
    strip.textContent = yuan(stats.unrealCents, true);
    strip.className = 'num ' + tone(stats.unrealCents);
    $('intro').hidden = !!state.introHidden;
    $('range-seg').hidden = ui.chartType === 'intraday';
    markSeg('[data-kind]', 'data-kind', ui.chartType);
    markSeg('[data-range]', 'data-range', ui.chartRange);
    markSeg('[data-side]', 'data-side', form.side);
    markSeg('[data-mode]', 'data-mode', form.mode);
    markSeg('[data-filter]', 'data-filter', ui.tradeFilter);
    paintPreview();
    paintChips();
    setText('pos-equity', yuan(stats.equityCents));
    setText('pos-grams', JCJ.formatGram(stats.gramUnits) + ' 克');
    setText('pos-value', yuan(stats.valueCents));
    setText('pos-cash', yuan(stats.cashCents));
    setText('pos-cost', yuan(stats.costCents));
    setText('pos-avg', stats.avgCostCentsPerGram == null ? '--' : (stats.avgCostCentsPerGram / 100).toFixed(2) + ' 元/克');
    const rate = $('pos-rate');
    rate.textContent = JCJ.formatPct(stats.unrealRate);
    rate.className = 'num ' + (stats.unrealRate == null ? 'flat' : tone(stats.unrealCents));
    paintSigned('pos-realized', stats.realizedCents);
    paintSigned('pos-pnl', stats.pnlCents);
    paintSigned('pos-day', stats.dayPnlCents);
    if (stats.gramUnits > 0) {
      setText('live-formula', '持有收益 = 市值 ' + yuan(stats.valueCents) + ' − 成本 ' + yuan(stats.costCents) + ' = ' + yuan(stats.unrealCents, true) + '。金价不变时，这笔负数主要是买卖价差。');
    } else {
      setText('live-formula', '持有收益 = 按卖出价计算的市值 − 持仓成本。卖出结转成本后，差额记成已实现收益。');
    }
    setText('pos-dd', '最大回撤 ' + yuan(stats.drawdownCents, true) + '（' + JCJ.formatPct(stats.drawdownRate) + '）');
    setText('audit-line', stats.auditOk ? '账本校验通过：总资产 = 本金 + 累计收益。' : '账本不平衡。可以重置账户后重新开始。');
    $('audit-line').className = stats.auditOk ? 'audit' : 'audit up';
    paintTrades();
    paintPlans();
    paintPlanForm();
    paintRules();
    paintSettings();
    const play = $('play');
    play.textContent = ui.playing ? '暂停' : '播放';
    play.setAttribute('aria-pressed', ui.playing ? 'true' : 'false');
    play.disabled = ui.busy;
    document.querySelectorAll('[data-act="advance"]').forEach(function (btn) { btn.disabled = ui.busy || ui.playing; });
    const nextBtn = document.querySelector('[data-days="1"]');
    if (nextBtn) nextBtn.title = '进入 ' + JCJ.formatDate(JCJ.nextTradingDay(state.clock));
    $('price-chart').setAttribute('aria-label', '金价图，最新 ' + plain(stats.markCents) + ' 元每克');
    applyTab();
    redrawPrice();
    redrawEquity();
  }

  function paintSigned(id, cents) {
    const el = $(id);
    el.textContent = yuan(cents, true);
    el.className = 'num ' + tone(cents);
  }

  function paintSettings() {
    const scenario = $('scenario');
    if (!ui.settingsReady) {
      $('spread-input').value = (state.settings.spreadCents / 100).toFixed(2);
      $('start-cash').value = (state.settings.startCashCents / 100).toFixed(2);
      scenario.value = state.settings.scenario;
      $('speed').value = ui.speed;
      ui.settingsReady = true;
    } else if (document.activeElement !== scenario) {
      scenario.value = state.settings.scenario;
    }
    const spec = JCJ.SCENARIOS[state.settings.scenario];
    setText('scenario-desc', spec.name + '：' + spec.desc);
    setText('price-source', state.meta.source + '。更早的 K 线和之后的每一天都是按这个假设生成的随机路径。');
  }

  function submitTicket() {
    if (ui.busy) return;
    const raw = $('ticket-input').value;
    let result;
    if (form.mode === 'money') {
      const cents = JCJ.parseYuanToCents(raw);
      if (cents == null) result = { ok: false, error: '请输入正确的金额' };
      else result = form.side === 'buy' ? JCJ.buyByMoney(state, cents) : JCJ.sellByMoney(state, cents);
    } else {
      const units = JCJ.parseGramToUnits(raw);
      if (units == null) result = { ok: false, error: '请输入正确的克重' };
      else result = form.side === 'buy' ? JCJ.buyByGram(state, units) : JCJ.sellByGram(state, units);
    }
    if (!result.ok) {
      toast(result.error);
      paintPreview();
      return;
    }
    ui.note = result.realizedCents != null
      ? '卖出 ' + JCJ.formatGram(result.units) + ' 克，到账 ' + yuan(result.receiveCents) + '，实现收益 ' + yuan(result.realizedCents, true)
      : '买入 ' + JCJ.formatGram(result.units) + ' 克，扣款 ' + yuan(result.payCents);
    toast(ui.note);
    chipSig = '';
    saveSoon();
    render();
  }

  function describeSteps(logs) {
    if (!logs.length) return ui.note;
    let ok = 0;
    let fail = 0;
    logs.forEach(function (day) {
      day.dca.forEach(function (item) { if (item.ok) ok += 1; else fail += 1; });
    });
    const last = logs[logs.length - 1];
    let text = JCJ.formatDate(last.date) + ' 收于 ' + plain(last.close);
    if (logs.length > 1) text = '走过 ' + logs.length + ' 个交易日，现停在 ' + text;
    if (ok || fail) text += '。定投成功 ' + ok + ' 笔';
    if (fail) text += '，失败 ' + fail + ' 笔';
    return text;
  }

  function runAdvance(days) {
    if (ui.busy) return;
    stopPlay();
    ui.busy = true;
    const logs = [];
    try {
      logs.push.apply(logs, JCJ.advanceDays(state, days));
      ui.note = describeSteps(logs);
    } catch (err) {
      toast(err.message || '推演中断');
    } finally {
      ui.busy = false;
      saveNow();
      render();
      if (logs.length) toast(ui.note);
    }
  }

  function stopPlay() {
    ui.playing = false;
    clearTimeout(ui.timer);
  }

  function playLoop() {
    if (!ui.playing) return;
    const pace = PLAY_SPEED[ui.speed] || PLAY_SPEED.fast;
    const count = pace.days;
    try {
      const logs = JCJ.advanceDays(state, count);
      ui.note = describeSteps(logs);
    } catch (err) {
      ui.playing = false;
      toast(err.message || '推演中断');
    }
    render();
    ui.playTicks = (ui.playTicks || 0) + 1;
    if (ui.playTicks % 8 === 0) saveNow();
    ui.timer = setTimeout(playLoop, pace.delay);
  }

  function togglePlay() {
    if (ui.busy) return;
    if (ui.playing) {
      stopPlay();
      saveNow();
      render();
      return;
    }
    ui.playing = true;
    render();
    playLoop();
  }

  function openModal(opts) {
    return new Promise(function (resolve) {
      const modal = $('modal');
      const back = document.activeElement;
      $('modal-title').textContent = opts.title;
      $('modal-text').textContent = opts.text || '';
      $('modal-error').textContent = '';
      $('modal-ok').textContent = opts.okText || '确定';
      $('modal-ok').classList.toggle('danger', !!opts.danger);
      const field = $('modal-field');
      const input = $('modal-input');
      if (opts.inputValue == null) field.hidden = true;
      else {
        field.hidden = false;
        input.value = opts.inputValue;
      }
      modal.hidden = false;
      function finish(result) {
        modal.hidden = true;
        $('modal-ok').onclick = null;
        $('modal-cancel').onclick = null;
        modal.onclick = null;
        document.removeEventListener('keydown', onKey);
        if (back && back.focus) back.focus();
        resolve(result);
      }
      function onKey(event) { if (event.key === 'Escape') finish({ ok: false }); }
      $('modal-ok').onclick = function () {
        if (opts.inputValue != null) {
          const cents = JCJ.parseYuanToCents(input.value);
          if (cents == null) {
            $('modal-error').textContent = '请输入正确的金额';
            return;
          }
          finish({ ok: true, cents: cents });
          return;
        }
        finish({ ok: true });
      };
      $('modal-cancel').onclick = function () { finish({ ok: false }); };
      modal.onclick = function (event) { if (event.target.dataset.close) finish({ ok: false }); };
      document.addEventListener('keydown', onKey);
      if (opts.inputValue != null) input.focus();
      else $('modal-ok').focus();
    });
  }

  async function onDeposit() {
    const answer = await openModal({
      title: '转入虚拟资金',
      text: '这笔钱会计入本金，不会算成投资收益。',
      okText: '转入',
      inputValue: '1000'
    });
    if (!answer.ok) return;
    const result = JCJ.deposit(state, answer.cents);
    if (!result.ok) { toast(result.error); return; }
    ui.note = '已转入 ' + yuan(answer.cents);
    toast(ui.note);
    saveSoon();
    render();
  }

  async function onReset() {
    const answer = await openModal({
      title: '重置账户？',
      text: '清空持仓、定投和成交，现金恢复为初始资金。当前这一天的金价还在，后面的路径也不变。',
      okText: '重置',
      danger: true
    });
    if (!answer.ok) return;
    JCJ.resetAccount(state);
    ui.note = '账户已重置，金价路径保持不变。';
    toast(ui.note);
    chipSig = '';
    saveNow();
    render();
  }

  async function onRestart() {
    const answer = await openModal({
      title: '回到起点？',
      text: '丢掉现在的持仓和已经走过的行情，回到 2026-09-30。价格路径由固定随机种子生成，同样的操作会再看到同样的价格。',
      okText: '重新开始',
      danger: true
    });
    if (!answer.ok) return;
    try { localStorage.removeItem(KEY); } catch (err) { /* ignore */ }
    location.reload();
  }

  function exportCsv() {
    const lines = ['时间,类型,克重,价格,金额,实现收益,备注'];
    state.trades.forEach(function (trade) {
      lines.push([
        JCJ.formatClock(trade.time),
        tradeTitle(trade.type),
        (trade.gramUnits / JCJ.GRAM_UNIT).toFixed(4),
        (trade.priceCents / 100).toFixed(2),
        (trade.moneyCents / 100).toFixed(2),
        (trade.realizedCents / 100).toFixed(2),
        '"' + String(trade.note || '').replace(/"/g, '""') + '"'
      ].join(','));
    });
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'jicunjin-sim.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function onCreatePlan(event) {
    event.preventDefault();
    if (ui.busy) return;
    const amount = JCJ.parseYuanToCents($('plan-amount').value);
    const monthDay = parseInt($('plan-day').value, 10);
    const result = JCJ.createPlan(state, {
      amountCents: amount == null ? 0 : amount,
      freq: ui.freq,
      weekday: parseInt($('plan-weekday').value, 10),
      monthDay: monthDay,
      immediate: $('plan-now').checked
    });
    if (!result.ok) { toast(result.error); return; }
    ui.note = '定投已创建，下次扣款 ' + JCJ.formatClock(result.plan.nextRun);
    if (result.warning) ui.note += '。' + result.warning;
    toast(ui.note);
    chipSig = '';
    saveSoon();
    render();
  }

  async function onPlanClick(event) {
    const btn = event.target.closest('[data-act]');
    if (!btn || !btn.dataset.id) return;
    const id = Number(btn.dataset.id);
    const act = btn.dataset.act;
    if (act === 'stop') {
      const answer = await openModal({ title: '终止定投？', text: '之后不再扣款。已经买到的黄金还在，这条计划会留在列表里。', okText: '终止', danger: true });
      if (!answer.ok) return;
    }
    if (act === 'remove') {
      const answer = await openModal({ title: '删除这条计划？', text: '只删除计划记录，成交记录还在。', okText: '删除', danger: true });
      if (!answer.ok) return;
    }
    const fn = { pause: JCJ.pausePlan, resume: JCJ.resumePlan, stop: JCJ.stopPlan, remove: JCJ.removePlan }[act];
    if (!fn) return;
    const result = fn(state, id);
    if (!result.ok) { toast(result.error); return; }
    saveSoon();
    render();
  }

  function onSpread() {
    const cents = JCJ.parseYuanToCents($('spread-input').value);
    if (cents == null) { toast('请输入 0 到 10 元的点差'); return; }
    const result = JCJ.setSpread(state, cents);
    if (!result.ok) {
      toast(result.error);
      $('spread-input').value = (state.settings.spreadCents / 100).toFixed(2);
      return;
    }
    $('spread-input').value = (cents / 100).toFixed(2);
    ui.note = '单边点差已改为 ' + plain(cents) + ' 元/克，持仓已按新的卖出价重估。';
    toast(ui.note);
    saveSoon();
    render();
  }

  function onStartCash() {
    const cents = JCJ.parseYuanToCents($('start-cash').value);
    if (cents == null) { toast('请输入正确的金额'); return; }
    const result = JCJ.setStartCash(state, cents);
    if (!result.ok) {
      toast(result.error);
      $('start-cash').value = (state.settings.startCashCents / 100).toFixed(2);
      return;
    }
    $('start-cash').value = (cents / 100).toFixed(2);
    $('start-hint').textContent = result.appliedNow ? '已更新当前虚拟本金。' : '重置账户后才会改成这个金额。';
    saveSoon();
    render();
  }

  function onClick(event) {
    const btn = event.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'advance') runAdvance(parseInt(btn.dataset.days, 10));
    else if (act === 'play') togglePlay();
    else if (act === 'tab') {
      ui.tab = btn.dataset.tab;
      applyTab();
      requestAnimationFrame(function () { redrawPrice(); redrawEquity(); });
    } else if (act === 'side') {
      rememberInput();
      form.side = btn.dataset.side;
      chipSig = '';
      syncInput();
      render();
    } else if (act === 'mode') {
      rememberInput();
      form.mode = btn.dataset.mode;
      chipSig = '';
      syncInput();
      render();
    } else if (act === 'chip') {
      if (form.mode === 'money') form.money = btn.dataset.value;
      else form.gram = btn.dataset.value;
      syncInput();
      paintPreview();
    } else if (act === 'chip-pct') {
      const pct = parseInt(btn.dataset.pct, 10);
      const units = Math.floor(state.account.gramUnits * pct / 100);
      form.mode = 'gram';
      form.side = 'sell';
      form.gram = unitsToInput(units);
      chipSig = '';
      syncInput();
      render();
    } else if (act === 'sell-all') {
      form.side = 'sell';
      form.mode = 'gram';
      form.gram = unitsToInput(state.account.gramUnits);
      chipSig = '';
      syncInput();
      render();
    } else if (act === 'chart') {
      ui.chartType = btn.dataset.kind;
      render();
    } else if (act === 'range') {
      ui.chartRange = btn.dataset.range;
      render();
    } else if (act === 'filter') {
      ui.tradeFilter = btn.dataset.filter;
      ui.showAllTrades = false;
      render();
    } else if (act === 'freq') {
      ui.freq = btn.dataset.freq;
      paintPlanForm();
    } else if (act === 'more-trades') {
      ui.showAllTrades = true;
      paintTrades();
    } else if (act === 'dismiss') {
      state.introHidden = true;
      saveSoon();
      $('intro').hidden = true;
    } else if (act === 'deposit') onDeposit();
    else if (act === 'reset') onReset();
    else if (act === 'restart') onRestart();
    else if (act === 'export') exportCsv();
  }

  function bind() {
    document.body.addEventListener('click', onClick);
    $('ticket-input').addEventListener('input', function () { rememberInput(); paintPreview(); });
    $('ticket-input').addEventListener('keydown', function (event) { if (event.key === 'Enter') submitTicket(); });
    $('ticket-submit').addEventListener('click', submitTicket);
    $('plan-form').addEventListener('submit', onCreatePlan);
    $('plan-form').addEventListener('input', paintPlanForm);
    $('plan-list').addEventListener('click', onPlanClick);
    $('scenario').addEventListener('change', function () {
      const result = JCJ.setScenario(state, $('scenario').value);
      if (!result.ok) { toast(result.error); return; }
      ui.note = '之后的行情改为「' + JCJ.SCENARIOS[state.settings.scenario].name + '」。已经走过的价格不变。';
      saveSoon();
      render();
    });
    $('speed').addEventListener('change', function () { ui.speed = $('speed').value; });
    $('spread-input').addEventListener('change', onSpread);
    $('start-cash').addEventListener('change', onStartCash);
    window.addEventListener('beforeunload', saveNow);
  }

  function bootCharts() {
    redrawPrice = JCJChart.mountPrice($('price-chart'), $('chart-tip'), priceModel);
    redrawEquity = JCJChart.mountEquity($('equity-chart'), $('equity-tip'), equityModel);
  }

  function runSelftest() {
    const buy = JCJ.buyByMoney(state, 100000);
    const plan = JCJ.createPlan(state, { amountCents: 10000, freq: 'daily' });
    const logs = JCJ.advanceDays(state, 3);
    const checked = JCJ.audit(state);
    render();
    const out = document.createElement('pre');
    out.id = 'selftest-result';
    out.textContent = JSON.stringify({
      buy: buy.ok,
      units: buy.units,
      pay: buy.payCents,
      plan: plan.ok,
      days: logs.map(function (day) { return day.date; }),
      success: state.plans[0].successTimes,
      audit: checked.ok,
      loss: checked.unreal < 0,
      grams: state.account.gramUnits,
      price: $('price-num').textContent,
      equity: $('top-equity').textContent,
      shownGrams: $('strip-grams').textContent,
      submit: $('ticket-submit').textContent
    });
    document.body.appendChild(out);
  }

  document.addEventListener('DOMContentLoaded', function () {
    state = selftest ? JCJ.createInitialState({ seed: 7 }) : (loadState() || JCJ.createInitialState());
    bind();
    bootCharts();
    syncInput();
    render();
    if (selftest) runSelftest();
    requestAnimationFrame(function () { redrawPrice(); redrawEquity(); });
  });
})();
