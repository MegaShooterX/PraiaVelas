// Reading the candles themselves: grouping days into weeks, and spotting the classic patterns.
//
// A pattern only means something after a move: a hammer is a hammer at the end of a fall. So each one looks at
// the trend just before it, measured in ATRs (the size of a normal candle of this fund), which works the same
// for a fund at R$ 9 and one at R$ 150. Candles too small to say anything (most days of a quiet fund) are skipped.

export const PATTERNS = {
	martelo: { name: 'Martelo', dir: 1, text: 'Sombra inferior longa depois de queda: os compradores reagiram.' },
	martelo_invertido: { name: 'Martelo invertido', dir: 1, text: 'Sombra superior longa depois de queda: primeira tentativa de subir.' },
	enforcado: { name: 'Enforcado', dir: -1, text: 'Desenho de martelo, mas depois de alta: sinal de cansaço.' },
	estrela_cadente: { name: 'Estrela cadente', dir: -1, text: 'Sombra superior longa depois de alta: o preço subiu e foi devolvido.' },
	doji_topo: { name: 'Doji no topo', dir: -1, text: 'Abriu e fechou no mesmo preço depois de alta: indecisão.' },
	doji_fundo: { name: 'Doji no fundo', dir: 1, text: 'Abriu e fechou no mesmo preço depois de queda: indecisão.' },
	engolfo_alta: { name: 'Engolfo de alta', dir: 1, text: 'Candle de alta que cobre todo o corpo do candle de baixa anterior.' },
	engolfo_baixa: { name: 'Engolfo de baixa', dir: -1, text: 'Candle de baixa que cobre todo o corpo do candle de alta anterior.' },
	estrela_manha: { name: 'Estrela da manhã', dir: 1, text: 'Queda forte, um candle pequeno e uma alta forte: virada para cima.' },
	estrela_tarde: { name: 'Estrela da tarde', dir: -1, text: 'Alta forte, um candle pequeno e uma queda forte: virada para baixo.' }
};

const DAY = 86_400_000;

/** The Monday of the week of a date, which names the week. */
function weekOf(date) {
	const t = Date.parse(`${date}T00:00:00Z`);
	const weekday = (new Date(t).getUTCDay() + 6) % 7;
	return new Date(t - weekday * DAY).toISOString().slice(0, 10);
}

/** Days into weeks ('W') or months ('M'); 'D' keeps the days. Each candle keeps the date of its last day in "end". */
export function resample(candles, timeframe) {
	if (timeframe === 'D') return candles.map((c) => ({ ...c, end: c.date }));
	const keyOf = timeframe === 'W' ? (c) => weekOf(c.date) : (c) => c.date.slice(0, 7);
	const out = [];
	let key = null;
	for (const c of candles) {
		const k = keyOf(c);
		const cur = out.at(-1);
		if (k !== key) {
			out.push({ ...c, end: c.date });
			key = k;
		} else {
			cur.h = Math.max(cur.h, c.h);
			cur.l = Math.min(cur.l, c.l);
			cur.c = c.c;
			cur.a = c.a;
			cur.v += c.v;
			cur.end = c.date;
		}
	}
	return out;
}

function shape(c) {
	const body = Math.abs(c.c - c.o);
	const range = c.h - c.l;
	return {
		...c,
		body,
		range,
		upper: c.h - Math.max(c.o, c.c),
		lower: Math.min(c.o, c.c) - c.l,
		bull: c.c > c.o,
		bear: c.c < c.o
	};
}

/** +1 after a rise of more than one ATR over the last 5 candles up to j, -1 after such a fall, 0 otherwise. */
function trendBefore(candles, atrs, j) {
	if (j < 5 || !(atrs[j] > 0)) return 0;
	const move = (candles[j].c - candles[j - 5].c) / atrs[j];
	return move > 1 ? 1 : move < -1 ? -1 : 0;
}

/** Every pattern found, each at the candle where it completes: [{ i, id, name, dir, text }]. */
export function detectPatterns(candles, atrs) {
	const found = [];
	const add = (i, id) => found.push({ i, id, ...PATTERNS[id] });
	for (let i = 8; i < candles.length; i++) {
		const A = atrs[i];
		if (!(A > 0)) continue;
		const b = shape(candles[i]);
		const p = shape(candles[i - 1]);
		const q = shape(candles[i - 2]);

		const t1 = trendBefore(candles, atrs, i - 1);
		if (b.range >= 0.6 * A && t1 !== 0) {
			if (b.body <= 0.1 * b.range) add(i, t1 === 1 ? 'doji_topo' : 'doji_fundo');
			else {
				const small = Math.max(0.25 * b.body, 0.1 * b.range);
				if (b.lower >= 2 * b.body && b.upper <= small) add(i, t1 === -1 ? 'martelo' : 'enforcado');
				if (b.upper >= 2 * b.body && b.lower <= small) add(i, t1 === -1 ? 'martelo_invertido' : 'estrela_cadente');
			}
		}

		const t2 = trendBefore(candles, atrs, i - 2);
		if (t2 === -1 && p.bear && b.bull && b.body >= 0.5 * A && b.body > p.body && b.o <= p.c && b.c >= p.o) add(i, 'engolfo_alta');
		if (t2 === 1 && p.bull && b.bear && b.body >= 0.5 * A && b.body > p.body && b.o >= p.c && b.c <= p.o) add(i, 'engolfo_baixa');

		const t3 = trendBefore(candles, atrs, i - 3);
		if (t3 === -1 && q.bear && q.body >= 0.8 * A && p.body <= 0.3 * q.body && b.bull && b.c > (q.o + q.c) / 2) add(i, 'estrela_manha');
		if (t3 === 1 && q.bull && q.body >= 0.8 * A && p.body <= 0.3 * q.body && b.bear && b.c < (q.o + q.c) / 2) add(i, 'estrela_tarde');
	}
	return found;
}

/**
 * How each pattern did in this fund's own past: after it appeared, did the price go where it pointed within
 * the horizon? fwd[i] is the return from candle i to candle i + horizon.
 */
export function studyPatterns(patterns, fwd) {
	const study = {};
	for (const p of patterns) {
		const f = fwd[p.i];
		if (!Number.isFinite(f)) continue;
		const s = (study[p.id] ??= { id: p.id, name: p.name, dir: p.dir, n: 0, hits: 0, sum: 0 });
		s.n++;
		s.sum += f;
		if (Math.sign(f) === p.dir) s.hits++;
	}
	return Object.values(study)
		.map((s) => ({ ...s, hit: s.hits / s.n, mean: s.sum / s.n }))
		.sort((x, y) => y.n - x.n);
}
