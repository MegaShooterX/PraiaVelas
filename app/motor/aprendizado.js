// Learning from the recent past to order the top 10 (0.0.4).
//
// The question the bot learns to answer: over the horizon, will this asset earn more than the average of its group
// (all the FIIs, or all the stocks), with dividends? It is what a top 10 is: the ones that will do better than the
// others. Asking against the group, and not against the CDI as 0.0.3 did, takes out of the account the moves of the
// whole market, which decided almost everything in the tests (09/11/2026).
//
// For every candle of every asset it builds a picture of the situation with a few measures, each from candles up to
// that one, and each compared with the other assets of the group on the same day ("pays more dividends than the
// others", "fell further from its high than the others"...). A logistic regression learns how much each measure
// tilts the chance:
// - from the last year of pictures (Rhuan, 09/11/2026: "qualquer coisa de 2025 pra trás é muito antigo");
// - starting from what held in the older years: the recent fit is pulled toward the older one instead of toward
//   zero, so a year with little to say leaves the old lesson, and a year that says something clear overrides it.
// The turns ("prever o ponto que vai começar a subir") are in the measures: the short rebound and the "turning up"
// state (price back above the short average while still under the middle one).
//
// Design fixed on 09/11/2026 before any result of it was seen (the plan is in the experiment's folder): 8 measures,
// lambda 10 (toward the old fit, which is pulled toward zero with lambda 10), one-year window, 50 neighbours, a bank
// of at most 1000 situations, the chance shown halfway to the base rate; nothing tuned on a test.
//
// Draft of 09/11/2026 (no version number until Rhuan asks), two options, both fixed before its test and both left
// off by analise.js after it (they did not meet its rules):
// - 3 months: the lesson of the older years only, without the correction of the last two. In the tests of 0.0.4 and
//   0.0.5, with that correction, the assets given 60% or more did better than their group only 36% of the times:
//   two years hold only eight 3-month periods, too few to correct anything (trainModel's recentFit).
// - A second opinion, the learner of 0.0.3 (aprendizado-cdi.js), tilts the chance (forecast's `second`).

/** What the bot looks at, each against the other assets of the group on the same day. high/low: in a person's words. */
export const FEATURES = [
	{ id: 'dy', high: 'paga mais dividendos que os outros', low: 'paga menos dividendos que os outros' },
	{ id: 'dd', high: 'está mais perto da máxima do ano que os outros', low: 'caiu mais da máxima do ano que os outros' },
	{ id: 'mom6', high: 'subiu mais que os outros nos últimos 6 meses', low: 'caiu mais que os outros nos últimos 6 meses' },
	{ id: 'mom', high: 'subiu mais que os outros no período recente', low: 'caiu mais que os outros no período recente' },
	{ id: 'rec', high: 'reagiu mais que os outros nos últimos dias', low: 'reagiu menos que os outros nos últimos dias' },
	{ id: 'vol', high: 'está mais agitado que o normal dele, mais que os outros', low: 'está mais calmo que o normal dele, mais que os outros' },
	{ id: 'vira', high: 'dá sinais de virar para cima', low: 'dá sinais de virar para baixo' },
	{ id: 'liq', high: 'é mais negociado que os outros', low: 'é menos negociado que os outros' }
];

const LAMBDA = 10;
const NEIGHBOURS = 50;
const BANK_MAX = 1000;
const CLIP = 3;
/** At least this many assets with a picture on a day, for "compared with the others" to mean something. */
const MIN_PEERS = 5;
/** How much of the model's distance from the base rate is shown: half (fixed up front, not fitted). */
const SHRINK = 0.5;

const sigmoid = (t) => 1 / (1 + Math.exp(-t));
const clip = (v) => Math.max(-CLIP, Math.min(CLIP, v));

/** The day that puts candles of different assets side by side: the date for daily candles, the week's Monday for weekly ones (an asset may skip the Monday or the Friday). */
function sameDay(end, weekly) {
	if (!weekly) return end;
	const d = new Date(`${end}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
	return d.toISOString().slice(0, 10);
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
		out[i] = Math.sqrt(Math.max(0, (s2[i + 1] - s2[i + 1 - win] - k * m * m) / (k - 1)));
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

/**
 * The raw pictures of one asset, one per candle of the profile (null while there is too little past), and the
 * return with dividends over the next `horizon` candles (NaN while that future is unknown). They become
 * "compared with the others" for the whole group in relativize(). Every measure uses only candles and dividends
 * up to its own date.
 */
export function dataset(prep, history) {
	const { P, bars, x } = prep;
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
	const traded = Float64Array.from(bars, (b) => b.c * b.v);
	const divs = history.dividends;
	const X = new Array(n).fill(null);
	const ret = new Float64Array(n).fill(NaN);
	let d0 = 0;
	let d1 = 0;
	let paid = 0;
	let tradedSum = 0;
	for (let i = 0; i < n; i++) {
		// Dividends with ex-date in the 365 days up to this candle's end.
		const yearAgo = new Date(`${ends[i]}T12:00:00Z`);
		yearAgo.setUTCDate(yearAgo.getUTCDate() - 365);
		const from = yearAgo.toISOString().slice(0, 10);
		while (d1 < divs.length && divs[d1].date <= ends[i]) paid += divs[d1++].amount;
		while (d0 < d1 && divs[d0].date <= from) paid -= divs[d0++].amount;
		tradedSum += traded[i];
		if (i >= R) tradedSum -= traded[i - R];
		if (i + h < n) ret[i] = a[i + h] / a[i] - 1;
		if (i < Y) continue;
		const short = Math.sign(c[i] - x.emaFast[i]);
		const medium = Math.sign(c[i] - x.smaMid[i]);
		const row = Float64Array.from([
			paid / c[i],
			c[i] / top[i] - 1,
			a[i] / a[i - L] - 1,
			a[i] / a[i - h] - 1,
			a[i] / a[i - K] - 1,
			sdShort[i] / sdYear[i],
			short > 0 && medium < 0 ? 1 : short < 0 && medium > 0 ? -1 : 0,
			Math.log(1 + tradedSum / R)
		]);
		if (row.every(Number.isFinite)) X[i] = row;
	}
	return { ticker: history.ticker, dates: ends, keys: ends.map((e) => sameDay(e, weekly)), X, ret, horizon: h };
}

/**
 * Turns the raw pictures of a whole group into pictures "compared with the others": on each day, each measure as
 * how far it is from the group's average that day, in standard deviations (Z), and the target as the return minus
 * the group's average return over the same horizon (rel). Days with fewer than MIN_PEERS assets are left out.
 * Returns the group's averages and spreads on its last day, to compare an asset outside the group.
 */
export function relativize(sets) {
	const byDate = new Map();
	sets.forEach((s, k) => {
		s.Z = new Array(s.dates.length).fill(null);
		s.rel = new Float64Array(s.dates.length).fill(NaN);
		s.keys.forEach((d, i) => {
			if (!byDate.has(d)) byDate.set(d, []);
			byDate.get(d).push([k, i]);
		});
	});
	const d = FEATURES.length;
	let last = null;
	for (const [date, cells] of byDate) {
		const known = cells.filter(([k, i]) => Number.isFinite(sets[k].ret[i]));
		if (known.length >= MIN_PEERS) {
			const m = known.reduce((s, [k, i]) => s + sets[k].ret[i], 0) / known.length;
			for (const [k, i] of known) sets[k].rel[i] = sets[k].ret[i] - m;
		}
		const pics = cells.filter(([k, i]) => sets[k].X[i]);
		if (pics.length < MIN_PEERS) continue;
		const mean = new Array(d).fill(0);
		const sd = new Array(d).fill(0);
		for (const [k, i] of pics) for (let j = 0; j < d; j++) mean[j] += sets[k].X[i][j] / pics.length;
		for (const [k, i] of pics) for (let j = 0; j < d; j++) sd[j] += (sets[k].X[i][j] - mean[j]) ** 2 / Math.max(1, pics.length - 1);
		for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j]) || 1;
		for (const [k, i] of pics) sets[k].Z[i] = Float64Array.from(sets[k].X[i], (v, j) => clip((v - mean[j]) / sd[j]));
		if (!last || date > last.date) last = { date, mean, sd };
	}
	return last;
}

/** A raw picture compared with a group's averages and spreads (for an asset outside the group). */
export const compare = (x, cross) => (x && cross ? Float64Array.from(x, (v, j) => clip((v - cross.mean[j]) / cross.sd[j])) : null);

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
 * Logistic regression by Newton's method, with a ridge penalty lambda pulling the weights (not the intercept)
 * toward `prior` (zeros when there is none). Pictures next to each other share most of their future, so each weighs
 * 1/horizon: the sum of weights is about the number of independent tries.
 */
function fit(rows, horizon, prior = null) {
	const d = FEATURES.length + 1;
	const p0 = prior ?? new Array(d).fill(0);
	const w = 1 / Math.max(1, horizon);
	let beta = [...p0];
	for (let iter = 0; iter < 30; iter++) {
		const H = Array.from({ length: d }, () => new Array(d).fill(0));
		const g = new Array(d).fill(0);
		for (const r of rows) {
			let eta = beta[0];
			for (let j = 1; j < d; j++) eta += beta[j] * r.z[j - 1];
			const p = sigmoid(eta);
			const e = w * (r.y - p);
			const q = w * p * (1 - p);
			for (let j = 0; j < d; j++) {
				const zj = j ? r.z[j - 1] : 1;
				g[j] += e * zj;
				for (let k = j; k < d; k++) H[j][k] += q * zj * (k ? r.z[k - 1] : 1);
			}
		}
		for (let j = 0; j < d; j++) for (let k = 0; k < j; k++) H[j][k] = H[k][j];
		for (let j = 1; j < d; j++) {
			g[j] -= LAMBDA * (beta[j] - p0[j]);
			H[j][j] += LAMBDA;
		}
		H[0][0] += 1e-9;
		const step = solve(H, g);
		beta = beta.map((b, j) => b + step[j]);
		if (Math.max(...step.map(Math.abs)) < 1e-7) break;
	}
	return beta;
}

const raw = (beta, z) => {
	let eta = beta[0];
	for (let j = 0; j < z.length; j++) eta += beta[j + 1] * z[j];
	return sigmoid(eta);
};

const logLoss = (p, y) => -(y * Math.log(Math.max(1e-9, p)) + (1 - y) * Math.log(Math.max(1e-9, 1 - p)));

/**
 * Trains on the group's pictures (sets: dataset() of each asset, cut at the same date, then relativize()). The
 * older pictures (before the window) give the starting point; the pictures of the last `window` candles whose
 * future is already known decide. Also checks itself inside the window: trained on its first 70% of dates
 * (stopping a horizon early), scored on the last 30% against guessing the base rate. Null when there is too little.
 * recentFit false: the older years' fit is the model (when there is one), and it is checked on the same last 30%,
 * which it never saw.
 */
export function trainModel(sets, horizon, window, cross = null, { recentFit = true } = {}) {
	const calendar = [...new Set(sets.flatMap((s) => s.keys))].sort();
	const cutoff = calendar[Math.max(0, calendar.length - 1 - window)];
	const recent = [];
	const old = [];
	for (const s of sets) {
		for (let i = 0; i < s.Z.length; i++) {
			if (!s.Z[i] || !Number.isFinite(s.rel[i])) continue;
			const row = { z: s.Z[i], y: s.rel[i] > 0 ? 1 : 0, rel: s.rel[i], date: s.keys[i], end: s.dates[i], t: s.ticker, i };
			(s.keys[i] >= cutoff ? recent : old).push(row);
		}
	}
	if (recent.length < 10 * horizon) return null;
	const prior = old.length >= 10 * horizon ? fit(old, horizon) : null;
	const oldOnly = !recentFit && prior !== null;
	const beta = oldOnly ? prior : fit(recent, horizon, prior);

	const dates = [...new Set(recent.map((r) => r.date))].sort();
	const at = Math.floor(dates.length * 0.7);
	const split = dates[at];
	const trainEnd = dates[Math.max(0, at - horizon)];
	const before = recent.filter((r) => r.date < trainEnd);
	const after = recent.filter((r) => r.date >= split);
	let validation = { n: 0, skill: NaN };
	if (before.length >= 5 * horizon && after.length) {
		const vb = oldOnly ? prior : fit(before, horizon, prior);
		const base = before.reduce((s, r) => s + r.y, 0) / before.length;
		let ll = 0;
		let ll0 = 0;
		const hi = { n: 0, beat: 0 };
		const lo = { n: 0, beat: 0 };
		for (const r of after) {
			const p = raw(vb, r.z);
			ll += logLoss(p, r.y);
			ll0 += logLoss(base, r.y);
			if (p >= 0.6) (hi.n++, (hi.beat += r.y));
			if (p <= 0.4) (lo.n++, (lo.beat += r.y));
		}
		validation = { n: after.length, independent: after.length / horizon, base, skill: 1 - ll / ll0, hi, lo, split };
	}

	// The bank of past situations, for "the most similar ones": pictures one horizon apart per asset (so they do not
	// overlap), at most BANK_MAX.
	const lastOf = Object.fromEntries(sets.map((s) => [s.ticker, s.Z.length - 1]));
	const pick = recent.filter((r) => (lastOf[r.t] - r.i) % horizon === 0);
	const stride = Math.max(1, Math.ceil(pick.length / BANK_MAX));
	const bank = pick.filter((_, k) => k % stride === 0).map((b) => ({ z: [...b.z].map((v) => Math.round(v * 100) / 100), r: Math.round(b.rel * 10000) / 10000, t: b.t, d: b.date }));

	return {
		v: 2,
		target: 'grupo',
		lesson: oldOnly ? 'anos antigos' : 'último período',
		horizon,
		window,
		features: FEATURES.map((f) => f.id),
		beta,
		prior,
		base: recent.reduce((s, r) => s + r.y, 0) / recent.length,
		rows: recent.length,
		oldRows: old.length,
		independent: recent.length / horizon,
		from: recent.reduce((m, r) => (r.end < m ? r.end : m), recent[0].end),
		trainedUntil: recent.reduce((m, r) => (r.end > m ? r.end : m), ''),
		validation,
		confidence: !(validation.skill > 0) ? 'baixa' : validation.skill > 0.02 ? 'alta' : 'média',
		cross,
		bank
	};
}

/** How much the second opinion tilts the chance, in log-odds per log-odds of its distance from the group (fixed up front). */
const SECOND = 0.5;
const logit = (p) => Math.log(p / (1 - p));

/**
 * Today's chance of earning more than the group's average, what weighed most, and the most similar situations of
 * the last year with what followed. z: today's picture compared with the others (from relativize or compare).
 * second: the second opinion (0.0.3's learner) on this asset, as the log-odds of its chance minus the average of
 * the group's (from analise.studyGroup); null leaves the chance as this model says.
 */
export function forecast(model, z, second = null) {
	if (!model || !z || z.length !== FEATURES.length) return null;
	const r = raw(model.beta, z);
	// Halfway between what the model says and the base rate; then tilted by the second opinion, when there is one.
	const own = model.base + SHRINK * (r - model.base);
	const tilt = Number.isFinite(second) ? SECOND * second : 0;
	const p = tilt ? sigmoid(logit(own) + tilt) : own;
	const drivers = FEATURES.map((f, j) => ({ id: f.id, value: z[j], effect: model.beta[j + 1] * z[j], text: z[j] >= 0 ? f.high : f.low }));
	if (tilt) drivers.push({ id: 'segunda', value: second, effect: tilt, text: tilt > 0 ? 'a segunda opinião do robô (sinais de gráfico, juros e época do ano) também é a favor' : 'a segunda opinião do robô (sinais de gráfico, juros e época do ano) é contra' });
	drivers.splice(0, drivers.length, ...drivers.filter((x) => Math.abs(x.effect) >= 0.05).sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect)));
	const near = model.bank
		.map((b) => {
			let s = 0;
			for (let j = 0; j < z.length; j++) s += (b.z[j] - z[j]) ** 2;
			return { s, r: b.r, t: b.t, d: b.d };
		})
		.sort((a, b) => a.s - b.s)
		.slice(0, NEIGHBOURS);
	const analogs = { n: near.length, beat: near.filter((b) => b.r > 0).length, mean: near.reduce((s, b) => s + b.r, 0) / (near.length || 1), examples: near.slice(0, 5).map(({ t, d, r: v }) => ({ t, d, r: v })) };
	return { target: 'grupo', p, own, second: Number.isFinite(second) ? second : null, raw: r, base: model.base, lesson: model.lesson ?? 'último período', confidence: model.confidence, skill: model.validation.skill, drivers, analogs, from: model.from, trainedUntil: model.trainedUntil, rows: model.rows };
}
