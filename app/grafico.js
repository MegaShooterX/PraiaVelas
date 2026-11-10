// The candle chart, drawn by hand on a canvas: no library to download, so it works the same in the browser and
// inside the Android app without internet. Drag sideways to go back in time, wheel (or the range buttons) to
// zoom, touch or hover a candle to see its numbers. To the right of the last candle, the projection cone.

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function niceStep(span, target) {
	const raw = span / target;
	const mag = 10 ** Math.floor(Math.log10(raw));
	const n = raw / mag;
	return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}

const brl = (v, d = 2) => v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

export class CandleChart {
	constructor(canvas, tip) {
		this.canvas = canvas;
		this.tip = tip;
		this.data = null;
		this.count = 120;
		this.end = 0;
		this.cursor = null;
		this.layers = { medias: true, bandas: true, padroes: true, projecao: true };
		new ResizeObserver(() => this.draw()).observe(canvas);
		this.listen();
	}

	setData(data, count) {
		this.data = data;
		this.end = data.bars.length;
		if (count) this.count = count;
		this.cursor = null;
		this.draw();
	}

	setCount(count) {
		this.count = count;
		if (this.data) this.end = this.data.bars.length;
		this.draw();
	}

	setLayer(name, on) {
		this.layers[name] = on;
		this.draw();
	}

	visible() {
		const n = this.data.bars.length;
		const count = Math.max(10, Math.min(this.count, n));
		const end = Math.max(count, Math.min(this.end, n));
		const showProjection = this.layers.projecao && end === n && this.data.projection;
		const extra = showProjection ? this.data.projection.steps.length : 0;
		return { n, start: end - count, end, extra, showProjection };
	}

	listen() {
		const c = this.canvas;
		let down = null;
		c.addEventListener('pointerdown', (e) => {
			down = { x: e.clientX, end: this.end, dragging: false, id: e.pointerId };
		});
		c.addEventListener('pointermove', (e) => {
			if (!this.data) return;
			if (down && e.pointerId === down.id) {
				const dx = e.clientX - down.x;
				if (!down.dragging && Math.abs(dx) > 6) {
					down.dragging = true;
					c.setPointerCapture(e.pointerId);
				}
				if (down.dragging) {
					const { start, end, extra } = this.visible();
					const slot = this.plotWidth / (end - start + extra);
					const n = this.data.bars.length;
					this.end = Math.max(Math.min(this.count, n), Math.min(n, Math.round(down.end - dx / slot)));
					this.cursor = null;
					this.draw();
					return;
				}
			}
			if (e.pointerType === 'mouse') this.pointAt(e);
		});
		const up = (e) => {
			if (down && !down.dragging) this.pointAt(e);
			down = null;
		};
		c.addEventListener('pointerup', up);
		c.addEventListener('pointercancel', () => (down = null));
		c.addEventListener('pointerleave', (e) => {
			if (e.pointerType === 'mouse') {
				this.cursor = null;
				this.draw();
			}
		});
		c.addEventListener(
			'wheel',
			(e) => {
				if (!this.data) return;
				e.preventDefault();
				const n = this.data.bars.length;
				this.count = Math.round(Math.max(20, Math.min(n, this.count * (e.deltaY > 0 ? 1.15 : 1 / 1.15))));
				this.draw();
			},
			{ passive: false }
		);
	}

	pointAt(e) {
		const r = this.canvas.getBoundingClientRect();
		this.cursor = { x: e.clientX - r.left, y: e.clientY - r.top };
		this.draw();
	}

	draw() {
		const canvas = this.canvas;
		const W = canvas.clientWidth;
		const H = canvas.clientHeight;
		if (!W || !H) return;
		const dpr = window.devicePixelRatio || 1;
		if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
			canvas.width = Math.round(W * dpr);
			canvas.height = Math.round(H * dpr);
		}
		const g = canvas.getContext('2d');
		g.setTransform(dpr, 0, 0, dpr, 0, 0);
		g.clearRect(0, 0, W, H);
		this.tip.hidden = true;
		if (!this.data) return;

		const color = { up: css('--up'), down: css('--down'), grid: css('--line'), text: css('--muted'), strong: css('--text'), fast: css('--accent'), slow: css('--gold'), band: css('--band'), cone: css('--cone') };
		const { bars, projection } = this.data;
		const { start, end, extra, showProjection } = this.visible();
		const axisW = 58;
		const axisH = 18;
		const plotW = (this.plotWidth = W - axisW);
		const volH = Math.round((H - axisH) * 0.14);
		const priceTop = 8;
		const priceBottom = H - axisH - volH - 6;
		const slots = end - start + extra;
		const slot = plotW / slots;
		const xOf = (i) => (i - start + 0.5) * slot;

		// The price range of what is on screen, the cone and the bands included.
		let lo = Infinity;
		let hi = -Infinity;
		for (let i = start; i < end; i++) {
			lo = Math.min(lo, bars[i].l);
			hi = Math.max(hi, bars[i].h);
			if (this.layers.bandas && Number.isFinite(this.data.bbLower[i])) {
				lo = Math.min(lo, this.data.bbLower[i]);
				hi = Math.max(hi, this.data.bbUpper[i]);
			}
		}
		if (showProjection) for (const s of projection.steps) (lo = Math.min(lo, s.p5)), (hi = Math.max(hi, s.p95));
		const pad = (hi - lo) * 0.05 || hi * 0.01;
		lo -= pad;
		hi += pad;
		const yOf = (v) => priceTop + ((hi - v) / (hi - lo)) * (priceBottom - priceTop);

		// Grid and price axis.
		g.font = '11px system-ui, sans-serif';
		g.textBaseline = 'middle';
		const step = niceStep(hi - lo, 5);
		const digits = step < 0.1 ? 3 : 2;
		for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
			const y = Math.round(yOf(v)) + 0.5;
			g.strokeStyle = color.grid;
			g.lineWidth = 1;
			g.beginPath();
			g.moveTo(0, y);
			g.lineTo(plotW, y);
			g.stroke();
			g.fillStyle = color.text;
			g.fillText(brl(v, digits), plotW + 6, y);
		}

		// Bollinger bands, faint.
		if (this.layers.bandas) {
			g.fillStyle = color.band;
			g.beginPath();
			let started = false;
			for (let i = start; i < end; i++) {
				const v = this.data.bbUpper[i];
				if (!Number.isFinite(v)) continue;
				started ? g.lineTo(xOf(i), yOf(v)) : g.moveTo(xOf(i), yOf(v));
				started = true;
			}
			for (let i = end - 1; i >= start; i--) {
				const v = this.data.bbLower[i];
				if (Number.isFinite(v)) g.lineTo(xOf(i), yOf(v));
			}
			if (started) g.fill();
		}

		// Candles.
		const bodyW = Math.max(1, Math.min(12, slot * 0.7));
		for (let i = start; i < end; i++) {
			const b = bars[i];
			const x = xOf(i);
			g.strokeStyle = g.fillStyle = b.c >= b.o ? color.up : color.down;
			g.lineWidth = 1;
			g.beginPath();
			g.moveTo(Math.round(x) + 0.5, yOf(b.h));
			g.lineTo(Math.round(x) + 0.5, yOf(b.l));
			g.stroke();
			const top = yOf(Math.max(b.o, b.c));
			const height = Math.max(1, yOf(Math.min(b.o, b.c)) - top);
			g.fillRect(x - bodyW / 2, top, bodyW, height);
		}

		// Moving averages.
		if (this.layers.medias) {
			for (const [values, stroke] of [
				[this.data.emaFast, color.fast],
				[this.data.emaSlow, color.slow]
			]) {
				g.strokeStyle = stroke;
				g.lineWidth = 1.5;
				g.beginPath();
				let started = false;
				for (let i = start; i < end; i++) {
					if (!Number.isFinite(values[i])) continue;
					started ? g.lineTo(xOf(i), yOf(values[i])) : g.moveTo(xOf(i), yOf(values[i]));
					started = true;
				}
				g.stroke();
			}
		}

		// Patterns: a small arrow under (up) or over (down) the candle.
		if (this.layers.padroes) {
			const size = Math.max(3, Math.min(6, slot * 0.6));
			for (const m of this.data.markers) {
				if (m.i < start || m.i >= end) continue;
				const b = bars[m.i];
				const x = xOf(m.i);
				g.fillStyle = m.dir > 0 ? color.up : color.down;
				g.beginPath();
				if (m.dir > 0) {
					const y = yOf(b.l) + 4;
					g.moveTo(x, y);
					g.lineTo(x - size, y + size * 1.4);
					g.lineTo(x + size, y + size * 1.4);
				} else {
					const y = yOf(b.h) - 4;
					g.moveTo(x, y);
					g.lineTo(x - size, y - size * 1.4);
					g.lineTo(x + size, y - size * 1.4);
				}
				g.fill();
			}
		}

		// The cone: 90% of the futures inside the light band, 50% inside the dark one, the middle one dashed.
		const lastBar = bars[end - 1];
		if (showProjection) {
			const x0 = xOf(end - 1);
			const xs = projection.steps.map((_, k) => xOf(end + k));
			for (const [a, b, alpha] of [
				['p5', 'p95', 0.18],
				['p25', 'p75', 0.32]
			]) {
				g.globalAlpha = alpha;
				g.fillStyle = color.cone;
				g.beginPath();
				g.moveTo(x0, yOf(lastBar.c));
				projection.steps.forEach((s, k) => g.lineTo(xs[k], yOf(s[b])));
				for (let k = projection.steps.length - 1; k >= 0; k--) g.lineTo(xs[k], yOf(projection.steps[k][a]));
				g.closePath();
				g.fill();
			}
			g.globalAlpha = 1;
			g.strokeStyle = color.cone;
			g.setLineDash([4, 3]);
			g.lineWidth = 1.5;
			g.beginPath();
			g.moveTo(x0, yOf(lastBar.c));
			projection.steps.forEach((s, k) => g.lineTo(xs[k], yOf(s.p50)));
			g.stroke();
			g.setLineDash([]);
		}

		// Last price, on the axis.
		const yLast = yOf(lastBar.c);
		g.fillStyle = lastBar.c >= lastBar.o ? color.up : color.down;
		g.fillRect(plotW + 1, yLast - 9, axisW - 1, 18);
		g.fillStyle = '#fff';
		g.fillText(brl(lastBar.c, digits), plotW + 6, yLast);

		// Volume.
		let maxV = 0;
		for (let i = start; i < end; i++) maxV = Math.max(maxV, bars[i].v);
		const volTop = H - axisH - volH;
		if (maxV > 0) {
			for (let i = start; i < end; i++) {
				const b = bars[i];
				const h = (b.v / maxV) * volH;
				g.globalAlpha = 0.45;
				g.fillStyle = b.c >= b.o ? color.up : color.down;
				g.fillRect(xOf(i) - bodyW / 2, volTop + volH - h, bodyW, h);
			}
			g.globalAlpha = 1;
		}

		// Dates.
		g.fillStyle = color.text;
		g.textBaseline = 'alphabetic';
		const labels = Math.max(2, Math.floor(plotW / 90));
		const every = Math.max(1, Math.round((end - start) / labels));
		for (let i = end - 1; i >= start; i -= every) {
			const [y, m, d] = bars[i].date.split('-');
			const text = end - start > 200 ? `${m}/${y.slice(2)}` : `${d}/${m}`;
			const x = xOf(i);
			if (x < 18) break;
			g.textAlign = 'center';
			g.fillText(text, x, H - 4);
		}
		g.textAlign = 'left';

		this.crosshair(g, { start, end, extra, xOf, yOf, slot, plotW, priceTop, priceBottom, H, axisH, color });
	}

	crosshair(g, { start, end, extra, slot, plotW, H, axisH, color }) {
		if (!this.cursor || this.cursor.x > plotW) return;
		const k = Math.floor(this.cursor.x / slot);
		const i = start + k;
		if (k < 0 || k >= end - start + extra) return;
		const x = (k + 0.5) * slot;
		g.strokeStyle = color.text;
		g.setLineDash([3, 3]);
		g.beginPath();
		g.moveTo(Math.round(x) + 0.5, 0);
		g.lineTo(Math.round(x) + 0.5, H - axisH);
		g.stroke();
		g.setLineDash([]);

		const { bars, projection } = this.data;
		let html;
		if (i < end) {
			const b = bars[i];
			const prev = bars[i - 1];
			const change = prev ? b.c / prev.c - 1 : NaN;
			const [y, m, d] = b.date.split('-');
			html = `<b>${d}/${m}/${y}</b><br>Abertura ${brl(b.o)} · Máx. ${brl(b.h)}<br>Mín. ${brl(b.l)} · Fech. <b>${brl(b.c)}</b>${Number.isFinite(change) ? ` (${change > 0 ? '+' : ''}${brl(change * 100, 1)}%)` : ''}`;
			const marks = this.data.markers.filter((mk) => mk.i === i).map((mk) => mk.name);
			if (marks.length) html += `<br>${marks.join(', ')}`;
		} else {
			const s = projection.steps[i - end];
			html = `<b>Projeção: +${i - end + 1}</b><br>Mediana ${brl(s.p50)}<br>50%: ${brl(s.p25)} a ${brl(s.p75)}<br>90%: ${brl(s.p5)} a ${brl(s.p95)}`;
		}
		this.tip.innerHTML = html;
		this.tip.hidden = false;
		const left = x > plotW / 2 ? x - this.tip.offsetWidth - 10 : x + 10;
		this.tip.style.left = `${Math.max(0, left)}px`;
		this.tip.style.top = '6px';
	}
}
