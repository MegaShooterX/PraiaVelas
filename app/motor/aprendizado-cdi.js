// The robot's SECOND OPINION (since the draft of 09/11/2026): the learner of version 0.0.3, copied without any change
// to its code. Its order of the top 10 was the better one in the 1-month horizon from 2022 on, while the chance of
// 0.0.4 (aprendizado.js) is the honest one; analise.js joins the two (see SECOND_OPINION there).
//
// Learning from the recent past (since 0.0.3). The question the bot learns to answer: over the horizon, will this
// asset earn more than the CDI (the money standing still)? For every candle of every asset of the group it builds
// a picture of the situation (the features below, each from candles up to that one) and writes down what came
// after (the return with dividends minus the CDI). A logistic regression learns, from all the assets of the group
// at once, how much each feature tilts the chance. Then, for today's picture of each asset, it gives that chance
// (which orders the top 10), the features that weighed most, and the most similar situations with what followed.
//
// What it learns from (Rhuan, 09/11/2026: "qualquer coisa de 2025 pra trás é muito antigo... aí é só sazonal"):
// only the last year of pictures. The older years enter one way only: the seasonality, how the same month of the
// year went for the group in the years before (Christmas, Carnival, December dividends...).
// And the turns ("prever o ponto que vai começar a subir"): the short rebound and the "turning up" state (price
// back above the short average while still under the middle one), of the asset and of the market. The model
// learns from the last year how often those first signs were followed by a rise.
//
// Design fixed on 09/11/2026 before any result of it was seen (the plan is in the experiment's folder): lambda 10,
// one-year window, 50 neighbours, a bank of at most 1000 situations; nothing tuned on a test.

import { STRATEGIES } from './estrategias.js';

/** What the bot looks at. high/low: how a person says it, when the value is above or below the usual. */
export const FEATURES = [
	...STRATEGIES.map((s) => ({ id: `s_${s.id}`, high: `a estratégia ${s.name} aponta alta`, low: `a estratégia ${s.name} aponta queda` })),
	{ id: 'mom', high: 'o preço subiu no período recente', low: 'o preço caiu no período recente' },
	{ id: 'mom6', high: 'o preço subiu nos últimos 6 meses', low: 'o preço caiu nos últimos 6 meses' },
	{ id: 'rec', high: 'o preço reagiu para cima nos últimos dias', low: 'o preço continuou caindo nos últimos dias' },
	{ id: 'dd', high: 'o preço está perto da máxima do ano', low: 'o preço está bem abaixo da máxima do ano' },
	{ id: 'vol', high: 'o preço está balançando mais que o normal', low: 'o preço está mais calmo que o normal' },
	{ id: 'rsi', high: 'vem de muitas altas seguidas', low: 'vem de muitas quedas seguidas' },
	{ id: 'vira', high: 'o preço dá sinais de virar para cima', low: 'o preço dá sinais de virar para baixo' },
	{ id: 'dy', high: 'paga dividendos altos comparados ao CDI', low: 'paga dividendos baixos comparados ao CDI' },
	{ id: 'selic', high: 'os juros (Selic) subiram nos últimos 6 meses', low: 'os juros (Selic) caíram ou ficaram parados nos últimos 6 meses' },
	{ id: 'mmom', high: 'o mercado subiu no período recente', low: 'o mercado caiu no período recente' },
	{ id: 'mrec', high: 'o mercado reagiu para cima nos últimos dias', low: 'o mercado continuou caindo nos últimos dias' },
	{ id: 'mvol', high: 'o mercado está instável', low: 'o mercado está calmo' },
	{ id: 'mtrend', high: 'o mercado está em alta', low: 'o mercado está em queda' },
	{ id: 'mvira', high: 'o mercado dá sinais de virar para cima', low: 'o mercado dá sinais de virar para baixo' },
	{ id: 'saz', high: 'nos anos anteriores, esta época costumou ser boa', low: 'nos anos anteriores, esta época costumou ser fraca' }
];
/** The features dataset() builds; the last one (saz) is added for the whole group by addSeasonality(). */
const OWN = FEATURES.length - 1;

const LAMBDA = 10;
const NEIGHBOURS = 50;
const BANK_MAX = 1000;
const CLIP = 5;
/** How much of the model's distance from the base rate is shown: half (fixed up front, not fitted). */
const SHRINK = 0.5;

const sigmoid = (t) => 1 / (1 + Math.exp(-t));

function lastIndexUntil(sorted, value) {
	let lo = 0;
	let hi = sorted.length - 1;
	let found = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (sorted[mid] <= value) (found = mid), (lo = mid + 1);
		else hi = mid - 1;
	}
	return found;
}

/** Rolling standard deviation of x over `win` values ending at each i (NaN counted out), by prefix sums. */
function rollingSd(x, win) {
	const n = x.length;
	const s1 = new Float64Array(n + 1);
	const s2 = new Float64Array(n + 1);
	const cnt = new Float64Array(n + 1);
	for (let i = 0; i < n; i++) {
		const v = Number.isFinite(x[i]) ? x[i] : 0;
		s1[i + 1] = s1[i] + v;
		s2[i + 1] = s2[i] + v * v;
		cnt[i + 1] = cnt[i] + (Number.isFinite(x[i]) ? 1 : 0);
	}
	const out = new Float64Array(n).fill(NaN);
	for (let i = win - 1; i < n; i++) {
		const k = cnt[i + 1] - cnt[i + 1 - win];
		if (k < 3) continue;
		const m = (s1[i + 1] - s1[i + 1 - win]) / k;
		out[i] = Math.sqrt(Math.max(0, ((s2[i + 1] - s2[i + 1 - win]) - k * m * m) / (k - 1)));
	}
	return out;
}

/** Rolling maximum over `win` values ending at each i (monotonic queue). */
function rollingMax(x, win) {
	const out = new Float64Array(x.length).fill(NaN);
	const q = [];
	for (let i = 0; i < x.length; i++) {
		while (q.length && x[q.at(-1)] <= x[i]) q.pop();
		q.push(i);
		while (q[0] <= i - win) q.shift();
		if (i >= win - 1) out[i] = x[q[0]];
	}
	return out;
}

/** Simple and exponential averages of x (exponential seeded with the simple one). */
function averages(x, nSma, nEma) {
	const n = x.length;
	const sma = new Float64Array(n).fill(NaN);
	const emaOut = new Float64Array(n).fill(NaN);
	let s = 0;
	for (let i = 0; i < n; i++) {
		s += x[i];
		if (i >= nSma) s -= x[i - nSma];
		if (i >= nSma - 1) sma[i] = s / nSma;
	}
	let e = NaN;
	let seed = 0;
	for (let i = 0; i < n; i++) {
		if (i < nEma) {
			seed += x[i];
			if (i === nEma - 1) e = seed / nEma;
		} else e += (2 / (nEma + 1)) * (x[i] - e);
		emaOut[i] = e;
	}
	return { sma, ema: emaOut };
}

/** The market's daily state on each of its days: adjusted close, roughness, trend and turn (-1, 0, 1). */
function marketSeries(market) {
	const days = market?.candles ?? [];
	const n = days.length;
	const dates = days.map((d) => d.end ?? d.date);
	const a = Float64Array.from(days, (d) => d.a);
	const c = Float64Array.from(days, (d) => d.c);
	const lr = new Float64Array(n).fill(NaN);
	for (let i = 1; i < n; i++) lr[i] = Math.log(c[i] / c[i - 1]);
	const sd21 = rollingSd(lr, 21);
	const sd252 = rollingSd(lr, 252);
	const { sma, ema: e21 } = averages(c, 50, 21);
	const vol = new Float64Array(n).fill(NaN);
	const trend = new Float64Array(n).fill(NaN);
	const turn = new Float64Array(n).fill(NaN);
	for (let i = 0; i < n; i++) {
		vol[i] = sd21[i] / sd252[i];
		if (!Number.isFinite(sma[i]) || !Number.isFinite(e21[i])) continue;
		const short = Math.sign(c[i] - e21[i]);
		const medium = Math.sign(c[i] - sma[i]);
		trend[i] = short === medium ? short : 0;
		turn[i] = short > 0 && medium < 0 ? 1 : short < 0 && medium > 0 ? -1 : 0;
	}
	return { dates, a, vol, trend, turn };
}

/**
 * The pictures of one asset, one per candle of the profile: features (null while there is too little past; the
 * seasonality is added later by addSeasonality) and the target y = return with dividends over the next `horizon`
 * candles minus the CDI over the same days (NaN while that future is unknown). prep: analise.prepare(); history:
 * the asset's (for dividends); market: the group's index fund history; tools: juros.rateTools(). Every feature
 * uses only candles, dividends and rates up to its own date.
 */
export function dataset(prep, history, market, tools) {
	const { P, bars, x, signals } = prep;
	const n = bars.length;
	const h = P.horizon;
	const weekly = P.timeframe === 'W';
	const L = weekly ? 26 : 126;
	const Y = weekly ? 52 : 252;
	const R = weekly ? 8 : 21;
	const K = weekly ? 2 : 5;
	const { a, c } = x;
	const ends = bars.map((b) => b.end ?? b.date);
	const lr = new Float64Array(n).fill(NaN);
	for (let i = 1; i < n; i++) lr[i] = Math.log(c[i] / c[i - 1]);
	const sdShort = rollingSd(lr, R);
	const sdYear = rollingSd(lr, Y);
	const top = rollingMax(x.h, Y);
	const m = marketSeries(market);
	const divs = history.dividends;
	const X = new Array(n).fill(null);
	const y = new Float64Array(n).fill(NaN);
	let d0 = 0;
	let d1 = 0;
	let paid = 0;
	for (let i = 0; i < n; i++) {
		// Dividends with ex-date in the 365 days up to this candle's end.
		const yearAgo = new Date(`${ends[i]}T12:00:00Z`);
		yearAgo.setUTCDate(yearAgo.getUTCDate() - 365);
		const from = yearAgo.toISOString().slice(0, 10);
		while (d1 < divs.length && divs[d1].date <= ends[i]) paid += divs[d1++].amount;
		while (d0 < d1 && divs[d0].date <= from) paid -= divs[d0++].amount;
		if (i + h < n) y[i] = a[i + h] / a[i] - 1 - tools.cdiBetween(ends[i], ends[i + h]);
		if (i < Y) continue;
		const mi = lastIndexUntil(m.dates, ends[i]);
		const mh = lastIndexUntil(m.dates, ends[i - h]);
		const short = Math.sign(c[i] - x.emaFast[i]);
		const medium = Math.sign(c[i] - x.smaMid[i]);
		const row = Float64Array.from([
			...signals.map((s) => s[i]),
			a[i] / a[i - h] - 1,
			a[i] / a[i - L] - 1,
			a[i] / a[i - K] - 1,
			c[i] / top[i] - 1,
			sdShort[i] / sdYear[i],
			x.rsi[i] / 100 - 0.5,
			short > 0 && medium < 0 ? 1 : short < 0 && medium > 0 ? -1 : 0,
			paid / c[i] - tools.cdi12(ends[i]),
			tools.selicChange(ends[i]),
			mi >= 0 && mh >= 0 ? m.a[mi] / m.a[mh] - 1 : NaN,
			mi >= 5 ? m.a[mi] / m.a[mi - 5] - 1 : NaN,
			mi >= 0 ? m.vol[mi] : NaN,
			mi >= 0 ? m.trend[mi] : NaN,
			mi >= 0 ? m.turn[mi] : NaN
		]);
		if (row.length === OWN && row.every(Number.isFinite)) X[i] = row;
	}
	return { ticker: history.ticker, dates: ends, X, y, horizon: h };
}

/**
 * The seasonality of the group: for each calendar month and year, the sum and count of the targets of all its
 * assets. A picture dated in month m of year Y gets the mean of month m over the years before Y only (those
 * futures are all known by then). Adds it as the last feature of every picture (null without 20 past cases) and
 * returns the table, kept in the model to score an asset outside the group.
 */
export function addSeasonality(sets) {
	const table = {};
	for (const s of sets) {
		for (let i = 0; i < s.dates.length; i++) {
			if (!Number.isFinite(s.y[i])) continue;
			const mo = s.dates[i].slice(5, 7);
			const yr = s.dates[i].slice(0, 4);
			const cell = ((table[mo] ??= {})[yr] ??= [0, 0]);
			cell[0] += s.y[i];
			cell[1]++;
		}
	}
	for (const s of sets) {
		s.X = s.X.map((row, i) => {
			if (!row) return null;
			const z = seasonalFor(table, s.dates[i]);
			return Number.isFinite(z) ? Float64Array.from([...row, z]) : null;
		});
	}
	return table;
}

/** The mean target of the same month in the years before `date`'s (NaN under 20 cases). */
export function seasonalFor(table, date) {
	const months = table?.[date.slice(5, 7)];
	if (!months) return NaN;
	const year = date.slice(0, 4);
	let sum = 0;
	let n = 0;
	for (const [yr, [s, c]] of Object.entries(months)) {
		if (yr < year) {
			sum += s;
			n += c;
		}
	}
	return n >= 20 ? sum / n : NaN;
}

function standardizer(rows) {
	const d = FEATURES.length;
	const mean = new Float64Array(d);
	const sd = new Float64Array(d);
	for (const r of rows) for (let j = 0; j < d; j++) mean[j] += r.x[j];
	for (let j = 0; j < d; j++) mean[j] /= rows.length;
	for (const r of rows) for (let j = 0; j < d; j++) sd[j] += (r.x[j] - mean[j]) ** 2;
	for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j] / Math.max(1, rows.length - 1)) || 1;
	return { mean: [...mean], sd: [...sd] };
}

const zOf = (x, mean, sd) => Float64Array.from(x, (v, j) => Math.max(-CLIP, Math.min(CLIP, (v - mean[j]) / sd[j])));

/** Solves A v = b (small, symmetric positive definite) by Gaussian elimination with partial pivoting. */
function solve(A, b) {
	const n = b.length;
	const M = A.map((row, i) => [...row, b[i]]);
	for (let k = 0; k < n; k++) {
		let p = k;
		for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[p][k])) p = i;
		[M[k], M[p]] = [M[p], M[k]];
		for (let i = k + 1; i < n; i++) {
			const f = M[i][k] / M[k][k];
			for (let j = k; j <= n; j++) M[i][j] -= f * M[k][j];
		}
	}
	const v = new Array(n).fill(0);
	for (let i = n - 1; i >= 0; i--) {
		let s = M[i][n];
		for (let j = i + 1; j < n; j++) s -= M[i][j] * v[j];
		v[i] = s / M[i][i];
	}
	return v;
}

/**
 * Logistic regression with a ridge penalty (lambda 10, not on the intercept), by Newton's method. Candles next to each
 * other share most of their future, so each row weighs 1/horizon: the sum of weights is about the number of
 * independent tries.
 */
function fit(rows, horizon) {
	const { mean, sd } = standardizer(rows);
	const d = FEATURES.length + 1;
	const Z = rows.map((r) => [1, ...zOf(r.x, mean, sd)]);
	const w = 1 / Math.max(1, horizon);
	let beta = new Array(d).fill(0);
	for (let iter = 0; iter < 30; iter++) {
		const H = Array.from({ length: d }, () => new Array(d).fill(0));
		const g = new Array(d).fill(0);
		for (let r = 0; r < rows.length; r++) {
			const z = Z[r];
			let eta = 0;
			for (let j = 0; j < d; j++) eta += beta[j] * z[j];
			const p = sigmoid(eta);
			const e = w * (rows[r].y - p);
			const q = w * p * (1 - p);
			for (let j = 0; j < d; j++) {
				g[j] += e * z[j];
				const qz = q * z[j];
				for (let k = j; k < d; k++) H[j][k] += qz * z[k];
			}
		}
		for (let j = 0; j < d; j++) for (let k = 0; k < j; k++) H[j][k] = H[k][j];
		for (let j = 1; j < d; j++) {
			g[j] -= LAMBDA * beta[j];
			H[j][j] += LAMBDA;
		}
		const step = solve(H, g);
		beta = beta.map((b, j) => b + step[j]);
		if (Math.max(...step.map(Math.abs)) < 1e-7) break;
	}
	return { mean, sd, beta };
}

const probability = (m, x) => {
	const z = zOf(x, m.mean, m.sd);
	let eta = m.beta[0];
	for (let j = 0; j < z.length; j++) eta += m.beta[j + 1] * z[j];
	return sigmoid(eta);
};

const logLoss = (p, y) => -(y * Math.log(Math.max(1e-9, p)) + (1 - y) * Math.log(Math.max(1e-9, 1 - p)));

/**
 * Trains on the pictures of the last `window` candles of the group whose future is already known (sets: dataset()
 * of each asset, cut at the same date, with addSeasonality applied). Also checks itself out of sample inside that
 * year: trained on its first 70% of dates (stopping a horizon early), scored on the last 30% against simply
 * guessing the base rate. Returns null when there is too little.
 */
export function trainModel(sets, horizon, window, seasonal = null) {
	const calendar = [...new Set(sets.flatMap((s) => s.dates))].sort();
	const cutoff = calendar[Math.max(0, calendar.length - 1 - window)];
	const rows = [];
	for (const s of sets) {
		for (let i = 0; i < s.X.length; i++) {
			if (s.X[i] && Number.isFinite(s.y[i]) && s.dates[i] >= cutoff) rows.push({ x: s.X[i], y: s.y[i] > 0 ? 1 : 0, ret: s.y[i], date: s.dates[i], t: s.ticker, i });
		}
	}
	if (rows.length < 10 * horizon) return null;
	const model = fit(rows, horizon);

	const dates = [...new Set(rows.map((r) => r.date))].sort();
	const at = Math.floor(dates.length * 0.7);
	const split = dates[at];
	const trainEnd = dates[Math.max(0, at - horizon)];
	const before = rows.filter((r) => r.date < trainEnd);
	const after = rows.filter((r) => r.date >= split);
	let validation = { n: 0, skill: NaN };
	if (before.length >= 5 * horizon && after.length) {
		const vm = fit(before, horizon);
		const base = before.reduce((s, r) => s + r.y, 0) / before.length;
		let ll = 0;
		let ll0 = 0;
		const hi = { n: 0, beat: 0 };
		const lo = { n: 0, beat: 0 };
		for (const r of after) {
			const p = probability(vm, r.x);
			ll += logLoss(p, r.y);
			ll0 += logLoss(base, r.y);
			if (p >= 0.6) (hi.n++, (hi.beat += r.y));
			if (p <= 0.3) (lo.n++, (lo.beat += r.y));
		}
		validation = { n: after.length, independent: after.length / horizon, base, skill: 1 - ll / ll0, hi, lo, split };
	}

	// The bank of past situations, for "the most similar ones": pictures one horizon apart per asset (so they do
	// not overlap), at most BANK_MAX, standardized like the model.
	const pick = rows.filter((r) => (sets.find((s) => s.ticker === r.t).X.length - 1 - r.i) % horizon === 0);
	const stride = Math.max(1, Math.ceil(pick.length / BANK_MAX));
	const bank = pick.filter((_, k) => k % stride === 0).map((b) => ({ z: [...zOf(b.x, model.mean, model.sd)].map((v) => Math.round(v * 100) / 100), r: Math.round(b.ret * 10000) / 10000, t: b.t, d: b.date }));

	return {
		v: 1,
		horizon,
		window,
		features: FEATURES.map((f) => f.id),
		...model,
		base: rows.reduce((s, r) => s + r.y, 0) / rows.length,
		rows: rows.length,
		independent: rows.length / horizon,
		from: dates[0],
		trainedUntil: dates.at(-1),
		validation,
		confidence: !(validation.skill > 0) ? 'baixa' : validation.skill > 0.02 ? 'alta' : 'média',
		seasonal,
		bank
	};
}


/**
 * Today's chance of earning more than the CDI, what weighed most, and the most similar situations of the past
 * year with what followed. x: today's picture (from dataset(), with the seasonality).
 */
export function forecast(model, x) {
	if (!model || !x || x.length !== FEATURES.length) return null;
	const z = zOf(x, model.mean, model.sd);
	// The chance shown, used to decide and to order the top 10, is modest on purpose: halfway between what the
	// model says and the base rate of the year, because one or two years hold few independent periods to trust it.
	const raw = probability(model, x);
	const p = model.base + SHRINK * (raw - model.base);
	const drivers = FEATURES.map((f, j) => ({ id: f.id, value: z[j], effect: model.beta[j + 1] * z[j], text: z[j] >= 0 ? f.high : f.low }))
		.filter((d) => Math.abs(d.effect) >= 0.05)
		.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
	const near = model.bank
		.map((b) => {
			let s = 0;
			for (let j = 0; j < z.length; j++) s += (b.z[j] - z[j]) ** 2;
			return { s, r: b.r, t: b.t, d: b.d };
		})
		.sort((a, b) => a.s - b.s)
		.slice(0, NEIGHBOURS);
	const analogs = { n: near.length, beat: near.filter((b) => b.r > 0).length, mean: near.reduce((s, b) => s + b.r, 0) / (near.length || 1), examples: near.slice(0, 5).map(({ t, d, r }) => ({ t, d, r })) };
	return { p, raw, base: model.base, confidence: model.confidence, skill: model.validation.skill, drivers, analogs, from: model.from, trainedUntil: model.trainedUntil, rows: model.rows };
}
