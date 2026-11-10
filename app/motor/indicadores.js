// Indicators over a series of numbers: one value per candle, NaN while there is not enough past yet.
// Each value uses only the candles up to its own, never a later one: a study that peeks at the future
// would look right on the past and fail on the next day (the tests check this).

export const blank = (n) => new Float64Array(n).fill(NaN);

export function sma(x, n) {
	const out = blank(x.length);
	let sum = 0;
	let missing = 0;
	for (let i = 0; i < x.length; i++) {
		if (Number.isNaN(x[i])) missing++;
		else sum += x[i];
		if (i >= n) {
			if (Number.isNaN(x[i - n])) missing--;
			else sum -= x[i - n];
		}
		if (i >= n - 1 && missing === 0) out[i] = sum / n;
	}
	return out;
}

/** Exponential average, started from the plain average of its first n values. k = 1/n gives Wilder's. */
function smooth(x, n, k) {
	const out = blank(x.length);
	let prev = NaN;
	let seed = 0;
	let count = 0;
	for (let i = 0; i < x.length; i++) {
		const v = x[i];
		if (Number.isNaN(v)) {
			out[i] = prev;
			continue;
		}
		if (Number.isNaN(prev)) {
			seed += v;
			if (++count === n) out[i] = prev = seed / n;
			continue;
		}
		prev += k * (v - prev);
		out[i] = prev;
	}
	return out;
}

export const ema = (x, n) => smooth(x, n, 2 / (n + 1));
export const wilder = (x, n) => smooth(x, n, 1 / n);

export function rollingStd(x, n) {
	const out = blank(x.length);
	for (let i = n - 1; i < x.length; i++) {
		let sum = 0;
		let sq = 0;
		for (let j = i - n + 1; j <= i; j++) {
			sum += x[j];
			sq += x[j] * x[j];
		}
		const mean = sum / n;
		out[i] = Math.sqrt(Math.max(0, sq / n - mean * mean));
	}
	return out;
}

/** Relative strength index (Wilder): 0 to 100, how much of the recent movement was up. */
export function rsi(close, n = 14) {
	const out = blank(close.length);
	let gain = 0;
	let loss = 0;
	for (let i = 1; i < close.length; i++) {
		const change = close[i] - close[i - 1];
		const g = change > 0 ? change : 0;
		const l = change < 0 ? -change : 0;
		if (i <= n) {
			gain += g / n;
			loss += l / n;
			if (i < n) continue;
		} else {
			gain = (gain * (n - 1) + g) / n;
			loss = (loss * (n - 1) + l) / n;
		}
		out[i] = loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss);
	}
	return out;
}

export function macd(close, fast = 12, slow = 26, signalN = 9) {
	const a = ema(close, fast);
	const b = ema(close, slow);
	const line = a.map((v, i) => v - b[i]);
	const signal = ema(line, signalN);
	const hist = line.map((v, i) => v - signal[i]);
	return { line, signal, hist };
}

export function bollinger(close, n = 20, k = 2) {
	const mid = sma(close, n);
	const sd = rollingStd(close, n);
	return { mid, upper: mid.map((m, i) => m + k * sd[i]), lower: mid.map((m, i) => m - k * sd[i]) };
}

export function atr(high, low, close, n = 14) {
	const tr = blank(close.length);
	for (let i = 0; i < close.length; i++) {
		tr[i] = i === 0 ? high[i] - low[i] : Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]));
	}
	return wilder(tr, n);
}

/** Highest value of the window that ends at each candle, itself included. */
export function rollingMax(x, n) {
	const out = blank(x.length);
	for (let i = n - 1; i < x.length; i++) {
		let m = -Infinity;
		for (let j = i - n + 1; j <= i; j++) if (x[j] > m) m = x[j];
		out[i] = m;
	}
	return out;
}

export function rollingMin(x, n) {
	const out = blank(x.length);
	for (let i = n - 1; i < x.length; i++) {
		let m = Infinity;
		for (let j = i - n + 1; j <= i; j++) if (x[j] < m) m = x[j];
		out[i] = m;
	}
	return out;
}

/** Change over n candles: 0.05 = up 5%. */
export function roc(x, n) {
	const out = blank(x.length);
	for (let i = n; i < x.length; i++) out[i] = x[i] / x[i - n] - 1;
	return out;
}
