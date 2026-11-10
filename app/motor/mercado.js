// The market around an asset (since 0.0.2): the group it belongs to (FIIs or stocks), the index fund that
// stands for that whole market, and what that market is doing now.
//
// Why: in the blind test of 08/11/2026, 45 of the 46 wrong calls of version 0.0.1 were moves of the whole market
// (everything rose until 21/10/2026, then everything fell), and it studied each asset alone. So the bot now reads
// the market before the asset, and FIIs and stocks are studied apart: they are different markets.

import { resample } from './candles.js';
import { ema, sma } from './indicadores.js';

export const GROUPS = {
	FII: {
		id: 'FII',
		name: 'FIIs',
		the: 'os',
		inThe: 'nos',
		market: 'XFIX11',
		marketName: 'IFIX (pelo ETF XFIX11)',
		// Since 0.0.3: the liquid FIIs Yahoo has (about R$ 1,5 mi a day or more, 09/11/2026), so a top 10 means something.
		members: ['HGLG11', 'BTLG11', 'XPLG11', 'VILG11', 'LVBI11', 'BRCO11', 'GGRC11', 'GARE11', 'XPML11', 'VISC11', 'HSML11', 'HGBS11', 'KNRI11', 'ALZR11', 'HGRU11', 'TRXF11', 'RBVA11', 'PVBI11', 'JSRE11', 'BRCR11', 'TGAR11', 'RZTR11', 'MXRF11', 'KNCR11', 'KNIP11', 'CPTS11', 'RECR11', 'VGIR11', 'HGCR11', 'RBRR11', 'KNSC11', 'KNHY11', 'MCCI11', 'VRTA11', 'RBRY11', 'XPCI11', 'VGHF11', 'KNUQ11', 'PCIP11', 'BTCI11', 'HFOF11']
	},
	Ação: {
		id: 'Ação',
		name: 'ações',
		the: 'as',
		inThe: 'nas',
		market: 'BOVA11',
		marketName: 'Ibovespa (pelo ETF BOVA11)',
		members: ['PETR4', 'VALE3', 'ITUB4', 'BBAS3', 'BBDC4', 'WEGE3', 'ABEV3', 'MGLU3', 'B3SA3', 'RENT3', 'SUZB3', 'PRIO3', 'RADL3', 'EQTL3', 'BBSE3', 'TAEE11', 'CMIG4', 'ITSA4', 'GGBR4', 'VIVT3', 'SBSP3', 'LREN3']
	}
};

/** What each asset is, in a person's words. */
export const SEGMENTS = {
	...Object.fromEntries(['HGLG11', 'BTLG11', 'XPLG11', 'VILG11', 'LVBI11', 'BRCO11', 'GGRC11', 'GARE11'].map((t) => [t, 'galpões de logística'])),
	...Object.fromEntries(['XPML11', 'VISC11', 'HSML11', 'HGBS11'].map((t) => [t, 'shoppings'])),
	...Object.fromEntries(['PVBI11', 'JSRE11', 'BRCR11'].map((t) => [t, 'escritórios'])),
	...Object.fromEntries(['KNRI11', 'ALZR11'].map((t) => [t, 'imóveis variados'])),
	...Object.fromEntries(['HGRU11', 'TRXF11', 'RBVA11'].map((t) => [t, 'lojas e agências alugadas'])),
	TGAR11: 'construção de imóveis',
	RZTR11: 'terras agrícolas',
	...Object.fromEntries(['MXRF11', 'KNCR11', 'KNIP11', 'CPTS11', 'RECR11', 'VGIR11', 'HGCR11', 'RBRR11', 'KNSC11', 'KNHY11', 'MCCI11', 'VRTA11', 'RBRY11', 'XPCI11', 'VGHF11', 'KNUQ11', 'PCIP11', 'BTCI11'].map((t) => [t, 'títulos imobiliários (papel)'])),
	HFOF11: 'cotas de outros FIIs',
	PETR4: 'petróleo',
	PRIO3: 'petróleo',
	VALE3: 'mineração',
	ITUB4: 'banco',
	BBAS3: 'banco',
	BBDC4: 'banco',
	ITSA4: 'holding (Itaú)',
	WEGE3: 'indústria',
	ABEV3: 'bebidas',
	MGLU3: 'varejo',
	LREN3: 'varejo',
	B3SA3: 'bolsa de valores',
	RENT3: 'aluguel de carros',
	SUZB3: 'papel e celulose',
	RADL3: 'farmácias',
	EQTL3: 'energia',
	TAEE11: 'energia',
	CMIG4: 'energia',
	BBSE3: 'seguros',
	GGBR4: 'siderurgia',
	VIVT3: 'telefonia',
	SBSP3: 'saneamento'
};

/** FII or stock: by the lists above, else by the name Yahoo gives (every FII has "imobiliário" or "FII" in it). */
export function kindOf(ticker, name = '') {
	for (const g of Object.values(GROUPS)) if (g.members.includes(ticker)) return g.id;
	return /imobili|\bfii\b|fiagro/i.test(name) ? 'FII' : 'Ação';
}

/** A month whose daily moves are 1.5 times the year's usual size counts as an agitated market. */
export const AGITATED = 1.5;

/**
 * How rough the last month was against the last year, from daily closes: 2 means the daily moves of the last 21
 * trading days were twice the usual size of the last 252.
 */
export function volRatio(candles, recent = 21, usual = 252) {
	const r = [];
	for (let i = Math.max(1, candles.length - usual); i < candles.length; i++) r.push(Math.log(candles[i].c / candles[i - 1].c));
	if (r.length < recent * 3) return NaN;
	const sd = (xs) => {
		const m = xs.reduce((a, b) => a + b, 0) / xs.length;
		return Math.sqrt(xs.reduce((a, v) => a + (v - m) ** 2, 0) / (xs.length - 1));
	};
	const all = sd(r);
	return all > 0 ? sd(r.slice(-recent)) / all : NaN;
}

/**
 * The market now, in the same candles and periods as the reading: up (+1) when the close is above both its slow
 * average and its middle one, down (-1) when below both, turning (0) when the two disagree, which is when a
 * trend-follower arrives late. Only the candles handed in are used.
 */
export function marketState(history, profile) {
	const days = history?.candles;
	if (!days || days.length < 260) return null;
	const bars = resample(days, profile.timeframe);
	const c = Float64Array.from(bars, (b) => b.c);
	const last = c.length - 1;
	const slow = ema(c, profile.periods.slow)[last];
	const mid = sma(c, profile.periods.mid)[last];
	if (!Number.isFinite(slow) || !Number.isFinite(mid)) return null;
	const short = Math.sign(c[last] - slow);
	const medium = Math.sign(c[last] - mid);
	const ratio = volRatio(days);
	const back = (n) => days[Math.max(0, days.length - 1 - n)].c;
	return {
		ticker: history.ticker,
		date: days.at(-1).date,
		last: c[last],
		trend: short === medium ? short : 0,
		// Since 0.0.3: which way it is turning. Above the short average but still below the middle one is the first
		// sign of a turn up (the fall losing strength); the mirror is a turn down.
		turn: short > 0 && medium < 0 ? 1 : short < 0 && medium > 0 ? -1 : 0,
		change5d: days.at(-1).c / back(5) - 1,
		short,
		medium,
		slow,
		mid,
		volRatio: ratio,
		agitated: ratio >= AGITATED,
		change1m: days.at(-1).c / back(21) - 1,
		change3m: days.at(-1).c / back(63) - 1
	};
}
