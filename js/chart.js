/* 金价 K 线、分时和总资产曲线。价格单位是分/克，资产曲线用元。 */
(function (root, factory) {
  const api = factory();
  if (root) root.JCJChart = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const UP = '#d84c4c';
  const DOWN = '#1b9a6c';
  const INK = '#1d1a16';
  const MUTED = '#8d867b';
  const GOLD = '#b98a3c';
  const MA20 = '#6d7c90';
  const GRID = 'rgba(29, 26, 22, 0.08)';

  function setup(canvas) {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width < 20 || height < 20) return null;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const pxW = Math.round(width * dpr);
    const pxH = Math.round(height * dpr);
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    return { ctx: ctx, width: width, height: height };
  }

  function group(n) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function priceText(cents) {
    return (cents / 100).toFixed(2);
  }

  function shortDate(iso) {
    return iso.slice(5);
  }

  function domain(values) {
    let min = Infinity;
    let max = -Infinity;
    values.forEach(function (value) {
      if (value == null || !isFinite(value)) return;
      if (value < min) min = value;
      if (value > max) max = value;
    });
    if (!isFinite(min) || !isFinite(max)) return { min: 0, max: 1 };
    if (min === max) {
      min -= 100;
      max += 100;
    }
    const pad = Math.max(20, (max - min) * 0.1);
    return { min: min - pad, max: max + pad };
  }

  function yOf(value, box, plot) {
    const span = plot.max - plot.min || 1;
    return box.top + (plot.max - value) / span * box.height;
  }

  function movingAverage(candles, windowSize) {
    const out = new Array(candles.length).fill(null);
    let sum = 0;
    for (let i = 0; i < candles.length; i++) {
      sum += candles[i].close;
      if (i >= windowSize) sum -= candles[i - windowSize].close;
      if (i >= windowSize - 1) out[i] = sum / windowSize;
    }
    return out;
  }

  function strokeSeries(ctx, xs, ys, color, width, dash) {
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < xs.length; i++) {
      if (ys[i] == null || !isFinite(ys[i])) {
        started = false;
        continue;
      }
      if (!started) {
        ctx.moveTo(xs[i], ys[i]);
        started = true;
      } else ctx.lineTo(xs[i], ys[i]);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash || []);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawGrid(ctx, box, plot, format) {
    ctx.font = '12px "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < 3; i++) {
      const value = plot.max - (plot.max - plot.min) * (i / 2);
      const y = yOf(value, box, plot);
      ctx.strokeStyle = GRID;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(box.left, y);
      ctx.lineTo(box.left + box.width, y);
      ctx.stroke();
      ctx.fillStyle = MUTED;
      ctx.fillText(format(value), box.left + box.width + 8, y);
    }
  }

  function clip(ctx, box, draw) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.left, box.top, box.width, box.height);
    ctx.clip();
    draw();
    ctx.restore();
  }

  function placeTip(tip, x, width) {
    const tipWidth = 148;
    let left = x + 12;
    if (left + tipWidth > width - 8) left = x - tipWidth - 8;
    if (left < 8) left = 8;
    tip.style.left = left + 'px';
    tip.hidden = false;
  }

  function drawPrice(canvas, tip, model, hoverX) {
    const view = setup(canvas);
    if (!view) return;
    const ctx = view.ctx;
    const box = { left: 8, top: 16, width: Math.max(10, view.width - 84), height: Math.max(10, view.height - 40) };
    if (model.type === 'line') drawLine(ctx, view, box, model, hoverX, tip);
    else drawCandles(ctx, view, box, model, hoverX, tip);
  }

  function drawLine(ctx, view, box, model, hoverX, tip) {
    const values = model.values || [];
    const extras = values.slice();
    if (model.prevClose != null) extras.push(model.prevClose);
    if (model.cost != null) extras.push(model.cost);
    const plot = domain(extras);
    drawGrid(ctx, box, plot, priceText);
    const n = values.length;
    if (!n) return;
    const xs = [];
    const ys = [];
    for (let i = 0; i < n; i++) {
      xs.push(box.left + (n === 1 ? box.width / 2 : (box.width * i) / (n - 1)));
      ys.push(yOf(values[i], box, plot));
    }
    clip(ctx, box, function () {
      if (model.prevClose != null) {
        const y = yOf(model.prevClose, box, plot);
        ctx.strokeStyle = 'rgba(29,26,22,0.28)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(box.left, y);
        ctx.lineTo(box.left + box.width, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const up = model.prevClose == null || values[n - 1] >= model.prevClose;
      const grad = ctx.createLinearGradient(0, box.top, 0, box.top + box.height);
      grad.addColorStop(0, up ? 'rgba(216,76,76,0.22)' : 'rgba(27,154,108,0.20)');
      grad.addColorStop(1, 'rgba(216,76,76,0)');
      ctx.beginPath();
      ctx.moveTo(xs[0], ys[0]);
      for (let i = 1; i < n; i++) ctx.lineTo(xs[i], ys[i]);
      ctx.lineTo(xs[n - 1], box.top + box.height);
      ctx.lineTo(xs[0], box.top + box.height);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      strokeSeries(ctx, xs, ys, up ? UP : DOWN, 1.8);
      if (model.cost != null) {
        const y = yOf(model.cost, box, plot);
        ctx.strokeStyle = GOLD;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(box.left, y);
        ctx.lineTo(box.left + box.width, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    });
    ctx.fillStyle = MUTED;
    ctx.font = '12px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText('开盘', box.left, view.height - 4);
    ctx.textAlign = 'right';
    ctx.fillText('收盘', box.left + box.width, view.height - 4);
    paintHover(ctx, view, box, xs, hoverX, tip, function (index) {
      const prev = model.prevClose == null ? values[0] : model.prevClose;
      const pct = prev ? ((values[index] - prev) / prev) * 100 : 0;
      const sign = pct > 0 ? '+' : '';
      return model.date + '  分时\n' + priceText(values[index]) + '  元/克\n较昨收 ' + sign + pct.toFixed(2) + '%';
    });
  }

  function drawCandles(ctx, view, box, model, hoverX, tip) {
    const all = model.candles || [];
    const range = model.range || all.length;
    const start = Math.max(0, all.length - range);
    const candles = all.slice(start);
    const ma5 = movingAverage(all, 5).slice(start);
    const ma20 = movingAverage(all, 20).slice(start);
    const extras = [];
    candles.forEach(function (c) {
      extras.push(c.high, c.low);
    });
    ma5.forEach(function (v) { if (v != null) extras.push(v); });
    ma20.forEach(function (v) { if (v != null) extras.push(v); });
    if (model.cost != null) extras.push(model.cost);
    const plot = domain(extras);
    drawGrid(ctx, box, plot, priceText);
    const n = candles.length;
    if (!n) return;
    const slot = box.width / n;
    const body = Math.max(1.4, Math.min(16, slot * 0.62));
    const xs = [];
    clip(ctx, box, function () {
      for (let i = 0; i < n; i++) {
        const c = candles[i];
        const x = box.left + slot * i + slot / 2;
        xs.push(x);
        const up = c.close >= c.open;
        ctx.strokeStyle = up ? UP : DOWN;
        ctx.fillStyle = up ? UP : DOWN;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, yOf(c.high, box, plot));
        ctx.lineTo(x, yOf(c.low, box, plot));
        ctx.stroke();
        const top = yOf(Math.max(c.open, c.close), box, plot);
        const bottom = yOf(Math.min(c.open, c.close), box, plot);
        ctx.fillRect(x - body / 2, top, body, Math.max(1, bottom - top));
      }
      strokeSeries(ctx, xs, ma5.map(function (v) { return v == null ? null : yOf(v, box, plot); }), GOLD, 1.2);
      strokeSeries(ctx, xs, ma20.map(function (v) { return v == null ? null : yOf(v, box, plot); }), MA20, 1.2);
      if (model.cost != null) {
        const y = yOf(model.cost, box, plot);
        ctx.strokeStyle = GOLD;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(box.left, y);
        ctx.lineTo(box.left + box.width, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = GOLD;
        ctx.font = '11px "Segoe UI", "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('成本', box.left + 4, Math.min(box.top + box.height - 4, Math.max(box.top + 12, y - 4)));
      }
    });
    ctx.fillStyle = MUTED;
    ctx.font = '12px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    ctx.fillText(shortDate(candles[0].date), box.left, view.height - 4);
    if (n > 2) {
      ctx.textAlign = 'center';
      ctx.fillText(shortDate(candles[Math.floor((n - 1) / 2)].date), box.left + box.width / 2, view.height - 4);
    }
    ctx.textAlign = 'right';
    ctx.fillText(shortDate(candles[n - 1].date), box.left + box.width, view.height - 4);
    paintHover(ctx, view, box, xs, hoverX, tip, function (index) {
      const c = candles[index];
      const prev = index > 0 ? candles[index - 1].close : (start > 0 ? all[start - 1].close : c.open);
      const pct = prev ? ((c.close - prev) / prev) * 100 : 0;
      const sign = pct > 0 ? '+' : '';
      return c.date + '  ' + sign + pct.toFixed(2) + '%\n开 ' + priceText(c.open) + '   收 ' + priceText(c.close) + '\n高 ' + priceText(c.high) + '   低 ' + priceText(c.low);
    });
  }

  function paintHover(ctx, view, box, xs, hoverX, tip, textOf) {
    if (hoverX == null || !xs.length) {
      if (tip) tip.hidden = true;
      return;
    }
    let index = 0;
    let best = Infinity;
    for (let i = 0; i < xs.length; i++) {
      const dist = Math.abs(xs[i] - hoverX);
      if (dist < best) {
        best = dist;
        index = i;
      }
    }
    if (hoverX < box.left - 8 || hoverX > box.left + box.width + 8) {
      if (tip) tip.hidden = true;
      return;
    }
    ctx.strokeStyle = 'rgba(29,26,22,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(xs[index], box.top);
    ctx.lineTo(xs[index], box.top + box.height);
    ctx.stroke();
    ctx.setLineDash([]);
    if (!tip) return;
    tip.textContent = textOf(index);
    placeTip(tip, xs[index], view.width);
  }

  function drawEquity(canvas, tip, model, hoverX) {
    const view = setup(canvas);
    if (!view) return;
    const ctx = view.ctx;
    const box = { left: 8, top: 14, width: Math.max(10, view.width - 78), height: Math.max(10, view.height - 36) };
    const points = model.points || [];
    const values = [];
    points.forEach(function (p) {
      values.push(p.equity, p.principal);
    });
    let min = Infinity;
    let max = -Infinity;
    values.forEach(function (v) {
      if (v < min) min = v;
      if (v > max) max = v;
    });
    if (!isFinite(min)) return;
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const pad = Math.max(0.5, (max - min) * 0.12);
    const plot = { min: min - pad, max: max + pad };
    const range = plot.max - plot.min;
    drawGrid(ctx, box, plot, function (v) {
      if (range < 80) return v.toFixed(2);
      return group(v);
    });
    if (!points.length) return;
    const n = points.length;
    const xs = [];
    const equity = [];
    const principal = [];
    for (let i = 0; i < n; i++) {
      xs.push(box.left + (n === 1 ? box.width / 2 : (box.width * i) / (n - 1)));
      equity.push(yOf(points[i].equity, box, plot));
      principal.push(yOf(points[i].principal, box, plot));
    }
    clip(ctx, box, function () {
      const grad = ctx.createLinearGradient(0, box.top, 0, box.top + box.height);
      grad.addColorStop(0, 'rgba(185,138,60,0.20)');
      grad.addColorStop(1, 'rgba(185,138,60,0)');
      ctx.beginPath();
      ctx.moveTo(xs[0], equity[0]);
      for (let i = 1; i < n; i++) ctx.lineTo(xs[i], equity[i]);
      ctx.lineTo(xs[n - 1], box.top + box.height);
      ctx.lineTo(xs[0], box.top + box.height);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
      strokeSeries(ctx, xs, principal, GOLD, 1.2, [4, 4]);
      strokeSeries(ctx, xs, equity, INK, 1.8);
    });
    ctx.fillStyle = MUTED;
    ctx.font = '12px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    ctx.fillText(shortDate(points[0].date), box.left, view.height - 2);
    ctx.textAlign = 'right';
    ctx.fillText(shortDate(points[n - 1].date), box.left + box.width, view.height - 2);
    paintHover(ctx, view, box, xs, hoverX, tip, function (index) {
      const p = points[index];
      const pnl = p.equity - p.principal;
      const sign = pnl > 0 ? '+' : '';
      return p.date + '\n总资产 ' + p.equity.toFixed(2) + '\n本金 ' + p.principal.toFixed(2) + '\n累计收益 ' + sign + pnl.toFixed(2);
    });
  }

  function mount(canvas, tip, getModel, draw) {
    let hoverX = null;
    function redraw() {
      draw(canvas, tip, getModel(), hoverX);
    }
    if (!canvas) return redraw;
    canvas.addEventListener('pointermove', function (event) {
      if (event.pointerType === 'touch') return;
      const rect = canvas.getBoundingClientRect();
      hoverX = event.clientX - rect.left;
      redraw();
    });
    canvas.addEventListener('pointerdown', function (event) {
      const rect = canvas.getBoundingClientRect();
      hoverX = event.clientX - rect.left;
      redraw();
    });
    canvas.addEventListener('pointerleave', function (event) {
      if (event.pointerType === 'touch') return;
      hoverX = null;
      redraw();
    });
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(function () { redraw(); });
      observer.observe(canvas);
    }
    return redraw;
  }

  return {
    mountPrice: function (canvas, tip, getModel) {
      return mount(canvas, tip, getModel, drawPrice);
    },
    mountEquity: function (canvas, tip, getModel) {
      return mount(canvas, tip, getModel, drawEquity);
    }
  };
});
