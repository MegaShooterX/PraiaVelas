// The strategies: different ways of reading the same chart. Each one says, for every candle, +1 (points up),
// -1 (points down) or 0 (says nothing), using only what was known at that candle. The backtest then checks,
// on this fund's own past, how often each one was right.
//
// A new strategy is one more entry in STRATEGIES: signal() for the past, read() for the words on screen.

import { atr, bollinger, ema, macd, rollingMax, rollingMin, rsi, sma } from './indicadores.js';
import { detectPatterns } from './candles.js';
import { money, num, pct } from './formato.js';

/** Everything the strategies read, computed once per analysis. */
export function buildContext(candles, periods) {
	const col = (k) => Float64Array.from(candles, (c) => c[k]);
	const c = col('c');
	const h = col('h');
	const l = col('l');
	const atrs = atr(h, l, c, 14);
	return {
		n: candles.length,
		candles,
		c,
		h,
		l,
		a: col('a'),
		periods,
		atr: atrs,
		emaFast: ema(c, periods.fast),
		emaSlow: ema(c, periods.slow),
		smaMid: sma(c, periods.mid),
		smaLong: sma(c, periods.long),
		rsi: rsi(c, 14),
		macd: macd(c),
		bb: bollinger(c, 20, 2),
		chanHigh: rollingMax(h, periods.chan),
		chanLow: rollingMin(l, periods.chan),
		exitHigh: rollingMax(h, Math.max(2, Math.round(periods.chan / 2))),
		exitLow: rollingMin(l, Math.max(2, Math.round(periods.chan / 2))),
		patterns: detectPatterns(candles, atrs)
	};
}

const ok = (...xs) => xs.every(Number.isFinite);

export const STRATEGIES = [
	{
		id: 'medias',
		name: 'Cruzamento de médias',
		family: 'Tendência',
		about: 'Média curta acima da longa: o preço vem subindo mais rápido que a sua média.',
		signal(x) {
			const s = new Int8Array(x.n);
			for (let i = 0; i < x.n; i++) if (ok(x.emaFast[i], x.emaSlow[i])) s[i] = x.emaFast[i] > x.emaSlow[i] ? 1 : -1;
			return s;
		},
		read(x, i) {
			const { fast, slow } = x.periods;
			const d = x.emaFast[i] / x.emaSlow[i] - 1;
			return `Média de ${fast} ${d > 0 ? 'acima' : 'abaixo'} da média de ${slow} (${pct(d)})`;
		}
	},
	{
		id: 'tendencia',
		name: 'Tendência longa',
		family: 'Tendência',
		about: `Preço acima da média intermediária e ela acima da longa: tendência de alta firme.`,
		signal(x) {
			const s = new Int8Array(x.n);
			for (let i = 0; i < x.n; i++) {
				const m = x.smaMid[i];
				const L = x.smaLong[i];
				if (!ok(m, L)) continue;
				if (x.c[i] > m && m > L) s[i] = 1;
				else if (x.c[i] < m && m < L) s[i] = -1;
			}
			return s;
		},
		read(x, i) {
			const { mid, long } = x.periods;
			if (!ok(x.smaLong[i])) return `Ainda sem histórico para a média de ${long}`;
			return `Preço ${x.c[i] > x.smaMid[i] ? 'acima' : 'abaixo'} da média de ${mid}; média de ${mid} ${x.smaMid[i] > x.smaLong[i] ? 'acima' : 'abaixo'} da de ${long}`;
		}
	},
	{
		id: 'ifr',
		name: 'IFR (força relativa)',
		family: 'Reversão',
		about: 'IFR abaixo de 30 = caiu demais, costuma voltar; acima de 70 = subiu demais.',
		signal(x) {
			const s = new Int8Array(x.n);
			for (let i = 0; i < x.n; i++) {
				if (x.rsi[i] < 30) s[i] = 1;
				else if (x.rsi[i] > 70) s[i] = -1;
			}
			return s;
		},
		read(x, i) {
			const v = x.rsi[i];
			return `IFR(14) em ${num(v, 0)}: ${v < 30 ? 'sobrevendido' : v > 70 ? 'sobrecomprado' : 'zona neutra'}`;
		}
	},
	{
		id: 'bollinger',
		name: 'Bandas de Bollinger',
		family: 'Reversão',
		about: 'Fechou fora da banda: aposta na volta para o meio. O sinal dura até chegar à média.',
		signal(x) {
			const s = new Int8Array(x.n);
			const { upper, lower, mid } = x.bb;
			let state = 0;
			for (let i = 0; i < x.n; i++) {
				if (!ok(upper[i], lower[i])) continue;
				if (x.c[i] < lower[i]) state = 1;
				else if (x.c[i] > upper[i]) state = -1;
				else if ((state === 1 && x.c[i] >= mid[i]) || (state === -1 && x.c[i] <= mid[i])) state = 0;
				s[i] = state;
			}
			return s;
		},
		read(x, i, now) {
			const { upper, lower } = x.bb;
			const where = (x.c[i] - lower[i]) / (upper[i] - lower[i]);
			const text = where < 0 ? 'abaixo da banda inferior' : where > 1 ? 'acima da banda superior' : where < 0.2 ? 'perto da banda inferior' : where > 0.8 ? 'perto da banda superior' : 'no meio das bandas';
			const still = now === 1 && where >= 0 ? '; saiu por baixo e ainda não voltou à média' : now === -1 && where <= 1 ? '; saiu por cima e ainda não voltou à média' : '';
			return `Preço ${text} (${money(lower[i])} a ${money(upper[i])})${still}`;
		}
	},
	{
		id: 'macd',
		name: 'MACD',
		family: 'Tendência',
		about: 'Linha do MACD acima da sua média: força compradora aumentando.',
		signal(x) {
			const s = new Int8Array(x.n);
			const { line, signal } = x.macd;
			for (let i = 0; i < x.n; i++) if (ok(line[i], signal[i])) s[i] = line[i] > signal[i] ? 1 : -1;
			return s;
		},
		read(x, i) {
			const { hist } = x.macd;
			return `Histograma ${hist[i] > 0 ? 'positivo' : 'negativo'} e ${hist[i] > hist[i - 1] ? 'subindo' : 'caindo'}`;
		}
	},
	{
		id: 'rompimento',
		name: 'Rompimento de canal',
		family: 'Tendência',
		about: 'Fechou acima da máxima do canal: rompeu para cima. Sai quando perde a mínima do meio canal.',
		signal(x) {
			const s = new Int8Array(x.n);
			let state = 0;
			for (let i = 1; i < x.n; i++) {
				// The channel of the candles before this one: today's own high cannot be broken by today.
				if (!ok(x.chanHigh[i - 1], x.chanLow[i - 1])) continue;
				if (x.c[i] > x.chanHigh[i - 1]) state = 1;
				else if (x.c[i] < x.chanLow[i - 1]) state = -1;
				else if (state === 1 && x.c[i] < x.exitLow[i - 1]) state = 0;
				else if (state === -1 && x.c[i] > x.exitHigh[i - 1]) state = 0;
				s[i] = state;
			}
			return s;
		},
		read(x, i) {
			return `Canal de ${x.periods.chan} candles: ${money(x.chanLow[i - 1])} a ${money(x.chanHigh[i - 1])}`;
		}
	},
	{
		id: 'candles',
		name: 'Padrões de candle',
		family: 'Candles',
		about: 'Martelo, engolfo, estrelas e doji, só depois que o candle seguinte confirma a direção.',
		signal(x) {
			const s = new Int8Array(x.n);
			const at = new Int8Array(x.n);
			// Two patterns on the same candle pointing opposite ways cancel out.
			for (const p of x.patterns) at[p.i] += p.dir;
			let state = 0;
			let left = 0;
			for (let i = 1; i < x.n; i++) {
				const d = Math.sign(at[i - 1]);
				// Confirmed: the next candle closes in the direction the pattern pointed.
				if (d !== 0 && Math.sign(x.c[i] - x.c[i - 1]) === d) {
					state = d;
					left = 3;
				} else if (left > 0) left--;
				else state = 0;
				s[i] = state;
			}
			return s;
		},
		read(x, i) {
			const recent = x.patterns.filter((p) => p.i > i - 5);
			if (!recent.length) return 'Nenhum padrão nos últimos 5 candles';
			return recent.map((p) => p.name).join(', ');
		}
	}
];
