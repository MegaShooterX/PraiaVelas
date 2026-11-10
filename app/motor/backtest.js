// The test of each strategy on the fund's own past.
//
// For every candle where a strategy pointed up or down, look at what the price (with dividends) did over the
// next `horizon` candles. "Hit" alone misleads with FIIs: they pay every month, so they rise most of the time and
// a strategy that always says "up" looks good. So every hit rate comes with its base (how often the fund rose
// anyway), and the "edge" is how much better than the base the strategy did, in return.

/** Return with dividends from candle i to candle i + horizon (NaN where the future is not known yet). */
export function forwardReturns(adjusted, horizon) {
	const out = new Float64Array(adjusted.length).fill(NaN);
	for (let i = 0; i + horizon < adjusted.length; i++) out[i] = adjusted[i + horizon] / adjusted[i] - 1;
	return out;
}

export function evaluate(signal, fwd, horizon, from = 0, to = signal.length) {
	let nAll = 0;
	let sumAll = 0;
	let sqAll = 0;
	let upAll = 0;
	let nL = 0;
	let sumL = 0;
	let hitL = 0;
	let nS = 0;
	let sumS = 0;
	let hitS = 0;
	for (let i = from; i < to; i++) {
		const f = fwd[i];
		if (!Number.isFinite(f)) continue;
		nAll++;
		sumAll += f;
		sqAll += f * f;
		if (f > 0) upAll++;
		if (signal[i] === 1) {
			nL++;
			sumL += f;
			if (f > 0) hitL++;
		} else if (signal[i] === -1) {
			nS++;
			sumS += f;
			if (f < 0) hitS++;
		}
	}
	const mean = nAll ? sumAll / nAll : NaN;
	const up = nAll ? upAll / nAll : NaN;
	const sd = nAll > 1 ? Math.sqrt(Math.max(0, sqAll / nAll - mean * mean)) : NaN;
	const meanL = nL ? sumL / nL : NaN;
	const meanS = nS ? sumS / nS : NaN;
	const n = nL + nS;
	const edge = n ? ((nL ? nL * (meanL - mean) : 0) + (nS ? nS * (mean - meanS) : 0)) / n : NaN;
	// Signals on following candles share most of their future, so they are far fewer independent tries.
	const independent = n / Math.max(1, horizon);
	const tStat = sd > 0 && independent > 0 ? edge / (sd / Math.sqrt(independent)) : 0;
	return {
		n,
		nL,
		nS,
		mean,
		up,
		sd,
		meanL,
		meanS,
		hit: n ? (hitL + hitS) / n : NaN,
		baseHit: n ? (nL * up + nS * (1 - up)) / n : NaN,
		edge,
		independent,
		tStat,
		evidence: evidenceOf(n, tStat)
	};
}

/** The same 0.5 that gives a strategy weight (weightsFor) is where "fraca" starts. */
function evidenceOf(n, tStat) {
	return !n ? 'sem sinais' : tStat >= 2 ? 'forte' : tStat >= 1 ? 'moderada' : tStat >= 0.5 ? 'fraca' : tStat <= -1 ? 'contrária' : 'nenhuma';
}

/**
 * The same test over a whole group of assets (all the FIIs, or all the stocks) at once, since 0.0.2. One fund
 * has about 120 independent months in ten years: too few to tell a method from luck, and in the blind test of
 * 08/11/2026 most of the weights learned that way did not hold out of sample.
 *
 * Each asset's signal is measured against that asset's own average (the base), as in evaluate. Then, on each
 * date, the excess returns of the assets that signalled are averaged into one number: the assets of a group move
 * together, so twenty FIIs signalling on the same day are closer to one try than to twenty. The t-stat comes from
 * that series of dates, counted once per horizon.
 *
 * items: [{ dates, fwd, signal }], one per asset, dates as 'YYYY-MM-DD' on the same exchange calendar.
 * Only candles with from <= date < to count.
 */
export function pooledEvaluate(items, horizon, from = '', to = '￿') {
	const byDate = new Map();
	let n = 0;
	let nL = 0;
	let nS = 0;
	let hits = 0;
	let baseHits = 0;
	let assets = 0;
	for (const { dates, fwd, signal } of items) {
		let sum = 0;
		let count = 0;
		let up = 0;
		for (let i = 0; i < dates.length; i++) {
			if (dates[i] < from || dates[i] >= to || !Number.isFinite(fwd[i])) continue;
			sum += fwd[i];
			count++;
			if (fwd[i] > 0) up++;
		}
		if (!count) continue;
		const base = sum / count;
		const upRate = up / count;
		let used = false;
		for (let i = 0; i < dates.length; i++) {
			const s = signal[i];
			if (!s || dates[i] < from || dates[i] >= to || !Number.isFinite(fwd[i])) continue;
			used = true;
			n++;
			if (s > 0) {
				nL++;
				if (fwd[i] > 0) hits++;
				baseHits += upRate;
			} else {
				nS++;
				if (fwd[i] < 0) hits++;
				baseHits += 1 - upRate;
			}
			const cell = byDate.get(dates[i]) ?? [0, 0];
			cell[0] += s * (fwd[i] - base);
			cell[1]++;
			byDate.set(dates[i], cell);
		}
		if (used) assets++;
	}
	const perDate = [...byDate.values()].map(([s, c]) => s / c);
	const days = perDate.length;
	const edge = days ? perDate.reduce((a, b) => a + b, 0) / days : NaN;
	const sd = days > 1 ? Math.sqrt(perDate.reduce((a, v) => a + (v - edge) ** 2, 0) / (days - 1)) : NaN;
	const independent = days / Math.max(1, horizon);
	const tStat = sd > 0 && independent > 0 ? edge / (sd / Math.sqrt(independent)) : 0;
	return { n, nL, nS, hit: n ? hits / n : NaN, baseHit: n ? baseHits / n : NaN, edge, sd, independent, tStat, assets, days, evidence: evidenceOf(n, tStat) };
}

/**
 * How much each strategy counts in the final reading.
 * - ponderada: by the strength of its edge in this fund (t-stat); one whose edge is too small to tell from luck
 *   (t below 0.5) gets 0.
 * - simples: one vote each.
 */
export function weightsFor(stats, mode) {
	if (mode === 'simples') return stats.map((s) => (s.n > 0 ? 1 : 0));
	return stats.map((s) => (s.edge > 0 && s.tStat >= 0.5 ? s.tStat : 0));
}

/**
 * Total weight below which the reading leans back towards neutral: one strategy with weak evidence (t = 0.9)
 * alone must not give a full "Alta". Four is about two strategies with good evidence, or four votes.
 */
const CONVICTION = 4;

/** The combined reading at candle i: from -1 (all point down) to +1 (all point up). */
export function combinedAt(signals, weights, i) {
	let num = 0;
	let den = 0;
	signals.forEach((s, k) => {
		num += weights[k] * s[i];
		den += weights[k];
	});
	return den > 0 ? num / Math.max(den, CONVICTION) : 0;
}

/**
 * The honest check of the combination: weights learned only on the first 70% of the past, then used on the
 * last 30%, which they never saw. If it does no better than the base there, the reading is not to be trusted.
 */
export function outOfSample(signals, fwd, horizon, mode, threshold = 0.2) {
	const n = fwd.length;
	const split = Math.floor(n * 0.7);
	// The training part stops `horizon` candles early, so its returns do not reach into the test part.
	const train = signals.map((s) => evaluate(s, fwd, horizon, 0, Math.max(0, split - horizon)));
	const weights = weightsFor(train, mode);
	const combined = new Int8Array(n);
	for (let i = split; i < n; i++) {
		const v = combinedAt(signals, weights, i);
		combined[i] = v > threshold ? 1 : v < -threshold ? -1 : 0;
	}
	return { ...evaluate(combined, fwd, horizon, split, n), split };
}

/**
 * outOfSample for a whole group (since 0.0.2): the weights are learned from all the assets on the first 70% of
 * the group's calendar (stopping a horizon early, so no return reaches into the test part), then the combined
 * reading of each asset is scored on the last 30%, all assets together.
 * assets: [{ dates, fwd, signals }] from analise.prepare.
 */
export function pooledOutOfSample(assets, horizon, mode, threshold = 0.2) {
	const calendar = [...new Set(assets.flatMap((a) => a.dates))].sort();
	const at = Math.floor(calendar.length * 0.7);
	const split = calendar[at];
	const trainEnd = calendar[Math.max(0, at - horizon)];
	const strategies = assets[0].signals.length;
	const train = Array.from({ length: strategies }, (_, k) =>
		pooledEvaluate(
			assets.map((a) => ({ dates: a.dates, fwd: a.fwd, signal: a.signals[k] })),
			horizon,
			'',
			trainEnd
		)
	);
	const weights = weightsFor(train, mode);
	const combined = assets.map((a) => {
		const signal = new Int8Array(a.dates.length);
		for (let i = 0; i < a.dates.length; i++) {
			if (a.dates[i] < split) continue;
			const v = combinedAt(a.signals, weights, i);
			signal[i] = v > threshold ? 1 : v < -threshold ? -1 : 0;
		}
		return { dates: a.dates, fwd: a.fwd, signal };
	});
	return { ...pooledEvaluate(combined, horizon, split), split, trainEnd };
}
