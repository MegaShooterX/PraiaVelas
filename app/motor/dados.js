// The history of a fund: one candle per trading day for up to ten years, and the dividends it paid.
// Source: Yahoo Finance (the B3 code with ".SA"). Prices come already adjusted for splits; "a" is the close
// adjusted for dividends too (computed here, see withDividends), which is what an investor really earned, so
// returns are measured on it.

import { getJson } from './rede.js';
import { load, save } from './armazem.js';

const HOUR = 3_600_000;

export function cleanTicker(raw) {
	return String(raw ?? '').trim().toUpperCase().replace(/\.SA$/, '').replace(/[^A-Z0-9]/g, '');
}

/** B3 codes: four letters and the number of the kind of share (FIIs are almost always 11). */
export function looksLikeTicker(ticker) {
	return /^[A-Z]{4}\d{1,2}[A-Z]?$/.test(ticker);
}

const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

/** Yahoo's answer → the compact form kept on the phone (columns, not one object per day: a third of the room). */
export function parseYahooChart(json, ticker) {
	const result = json?.chart?.result?.[0];
	if (!result?.timestamp?.length) throw new Error(json?.chart?.error?.description ?? 'sem cotações');
	const quote = result.indicators?.quote?.[0] ?? {};
	const adjusted = result.indicators?.adjclose?.[0]?.adjclose ?? quote.close;
	const offset = (result.meta?.gmtoffset ?? -10800) * 1000;
	const cols = { d: [], o: [], h: [], l: [], c: [], a: [], v: [] };
	result.timestamp.forEach((t, i) => {
		const c = quote.close?.[i];
		let o = quote.open?.[i];
		if (!(c > 0)) return;
		if (!(o > 0)) o = c;
		// Yahoo now and then has a high below the close: the candle must contain its own body.
		const h = Math.max(quote.high?.[i] ?? c, o, c);
		const l = Math.min(quote.low?.[i] > 0 ? quote.low[i] : c, o, c);
		const date = new Date(t * 1000 + offset).toISOString().slice(0, 10);
		// The same day twice (the last one while the market is open): the later wins.
		if (cols.d.at(-1) === date) for (const k of Object.keys(cols)) cols[k].pop();
		cols.d.push(date);
		cols.o.push(round(o));
		cols.h.push(round(h));
		cols.l.push(round(l));
		cols.c.push(round(c));
		cols.a.push(round(adjusted?.[i] > 0 ? adjusted[i] : c, 6));
		cols.v.push(quote.volume?.[i] ?? 0);
	});
	const seen = new Set();
	const dividends = Object.values(result.events?.dividends ?? {})
		.map((d) => [new Date(d.date * 1000 + offset).toISOString().slice(0, 10), round(d.amount, 6)])
		.filter(([date, amount]) => amount > 0 && !seen.has(date) && seen.add(date))
		.sort((x, y) => (x[0] < y[0] ? -1 : 1));
	return {
		v: 1,
		ticker,
		name: result.meta?.longName ?? result.meta?.shortName ?? ticker,
		fetchedAt: Date.now(),
		cols,
		dividends
	};
}

/**
 * Yahoo sometimes records a few days at a wrong level and then goes back: XPML11 at a hundredth of its price
 * for three days of January 2026, RECR11 at 72% of it for four days of November 2025. A jump of more than 30%
 * (up, or 23% down) that comes back to within 3% of where it left, within 5 candles, is such a record, and those
 * days are dropped. The market is kept: the falls of about 20% in a day of March 2020 that came back in days
 * (HGLG11, VILG11, PETR4, WEGE3), or MGLU3 falling 58% on 26/10/2026 and staying there.
 * Only the candles handed in are used: cut at a date, it judges with what was known then.
 */
export function dropBadTicks(candles) {
	const out = [];
	let i = 0;
	while (i < candles.length) {
		const prev = out.at(-1);
		if (prev && Math.abs(Math.log(candles[i].c / prev.c)) > Math.log(1.3)) {
			let back = -1;
			for (let j = i + 1; j < Math.min(candles.length, i + 6); j++) {
				if (Math.abs(Math.log(candles[j].c / prev.c)) < Math.log(1.03)) {
					back = j;
					break;
				}
			}
			if (back > 0) {
				i = back;
				continue;
			}
		}
		out.push(candles[i]);
		i++;
	}
	return out;
}

/**
 * The close with dividends reinvested ("a"), computed here from the closes and the dividends instead of taken
 * from Yahoo: Yahoo's own is broken wherever the price was (XPML11's January 2026 turned a R$ 0,92 dividend into
 * an 87% one and shrank its whole past sevenfold). Each dividend, on its ex-date, scales every earlier day by
 * (1 - dividend / close of the day before), so returns measured on "a" include what was paid.
 */
export function withDividends(candles, dividends) {
	const out = new Array(candles.length);
	let factor = 1;
	let d = dividends.length - 1;
	for (let i = candles.length - 1; i >= 0; i--) {
		while (d >= 0 && dividends[d].date > candles[i].date) {
			const part = dividends[d].amount / candles[i].c;
			// A dividend of more than half the price is another error of the data, not a payment.
			if (part > 0 && part < 0.5) factor *= 1 - part;
			d--;
		}
		out[i] = { ...candles[i], a: candles[i].c * factor };
	}
	return out;
}

export function expandHistory(stored) {
	const { cols } = stored;
	const raw = cols.d.map((date, i) => ({ date, o: cols.o[i], h: cols.h[i], l: cols.l[i], c: cols.c[i], v: cols.v[i] }));
	const dividends = stored.dividends.map(([date, amount]) => ({ date, amount }));
	return {
		ticker: stored.ticker,
		name: stored.name,
		fetchedAt: stored.fetchedAt,
		raw,
		candles: withDividends(dropBadTicks(raw), dividends),
		dividends
	};
}

/**
 * The history as it was known at the close of `date`: nothing after it, cleaned and adjusted only with what
 * existed then. Used to test the bot blind.
 */
export function historyUntil(history, date) {
	const raw = history.raw.filter((c) => c.date <= date);
	const dividends = history.dividends.filter((d) => d.date <= date);
	return { ...history, raw, dividends, candles: withDividends(dropBadTicks(raw), dividends), stale: false };
}

/**
 * The history of one fund. Kept for a few hours, so opening it again is instant; without internet the last
 * copy is used and marked as old ("stale"). keep: false uses a copy already kept but does not keep a new one
 * (the twenty funds of a group would not fit in the phone's storage; only their summary is kept).
 */
export async function fetchHistory(ticker, { maxAgeMs = 6 * HOUR, force = false, keep = true } = {}) {
	const key = `cache:hist:${ticker}`;
	const cached = load(key);
	if (!force && cached?.v === 1 && Date.now() - cached.fetchedAt < maxAgeMs) return expandHistory(cached);
	try {
		const path = `/v8/finance/chart/${encodeURIComponent(ticker)}.SA?range=10y&interval=1d&events=div%7Csplit&includeAdjustedClose=true`;
		// Yahoo has two doors to the same data; when one says "too many requests", the other often does not.
		let json;
		try {
			json = await getJson(`https://query1.finance.yahoo.com${path}`);
		} catch (first) {
			if (/HTTP 404/.test(String(first?.message))) throw first;
			json = await getJson(`https://query2.finance.yahoo.com${path}`);
		}
		const compact = parseYahooChart(json, ticker);
		if (keep) save(key, compact);
		return expandHistory(compact);
	} catch (error) {
		if (cached?.v === 1) return { ...expandHistory(cached), stale: true };
		const why = String(error?.message ?? error);
		throw new Error(/HTTP 404/.test(why) ? `${ticker} não encontrado no Yahoo Finance.` : `Não consegui baixar ${ticker}: ${why}`);
	}
}
