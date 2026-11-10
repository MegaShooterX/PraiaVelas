// The projection: not one price, but the range of where the price may be in `horizon` candles.
//
// Thousands of possible futures are drawn by replaying pieces of the fund's own recent past (blocks of a few
// candles, so calm and rough stretches come in their real order). The cone shows where most of them ended: 50%
// of the futures inside the dark band, 90% inside the light one.
//
// Since 0.0.2 the analysis gives no tilt (drift 0): in 0.0.1 the strategies tilted the cone, and its "chance of
// going up" said 67% to 73% when the price rose 35% to 50% of the times. And when the market is rougher than its
// usual year, the replayed moves are scaled up (`scale`): in the agitated October of 2026 only 37% of the prices
// ended inside the 90% band of 0.0.1. Since 10/11/2026 that widening is gentler and calibrated, for 1 week and 1
// month (RANGE in analise.js): the bands had become too wide.

/** A small seeded random generator: the same data gives the same cone every time. */
function random(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function quantile(sorted, q) {
	const pos = (sorted.length - 1) * q;
	const lo = Math.floor(pos);
	const hi = Math.ceil(pos);
	return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * prices: closes (without dividends: the cone is of the price on screen). drift: the expected log change of the
 * price per candle. scale: how much bigger than in the replayed past the moves are taken to be (1 = the same).
 * Returns, for each future candle, the 5/25/50/75/95% points, and the chance of ending above.
 */
export function monteCarlo(prices, { horizon, drift = 0, lookback = 750, paths = 2000, block = 5, seed = 7, scale = 1 }) {
	const start = Math.max(1, prices.length - lookback);
	const returns = [];
	for (let i = start; i < prices.length; i++) returns.push(Math.log(prices[i] / prices[i - 1]));
	const last = prices.at(-1);
	if (returns.length < block * 2) return null;
	// The past's own drift is taken out: the past going up is no reason for the future to.
	const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
	const centered = returns.map((r) => (r - mean) * scale);
	const rand = random(seed);
	const atStep = Array.from({ length: horizon }, () => new Float64Array(paths));
	let above = 0;
	for (let p = 0; p < paths; p++) {
		let total = 0;
		let step = 0;
		while (step < horizon) {
			const from = Math.floor(rand() * (centered.length - block));
			for (let k = 0; k < block && step < horizon; k++, step++) {
				total += centered[from + k] + drift;
				atStep[step][p] = total;
			}
		}
		if (total > 0) above++;
	}
	const steps = atStep.map((values) => {
		const sorted = Float64Array.from(values).sort();
		const at = (q) => last * Math.exp(quantile(sorted, q));
		return { p5: at(0.05), p25: at(0.25), p50: at(0.5), p75: at(0.75), p95: at(0.95) };
	});
	return { last, steps, final: steps.at(-1), probUp: above / paths };
}
