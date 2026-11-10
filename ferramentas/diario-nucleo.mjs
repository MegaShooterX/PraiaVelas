// The robot's journal, the part shared by the computer (ferramentas/diario.mjs, which seals each day) and the site
// (ferramentas/site.mjs, which publishes the lesson for the app on GitHub). The rules themselves (the day, the
// score, the lesson) are in the engine (app/motor/analise.js journalEntry, app/motor/diario.js), frozen with it;
// this file only puts them together: many days at once, the records of what followed, the lesson of a day, the
// day's final word (chance corrected, action, top 10) and its score.

import { cpus } from 'node:os';
import { Worker } from 'node:worker_threads';

export const PROFILE_IDS = ['curto', 'swing', 'posicao'];
export const HORIZON_WORD = { curto: '1 semana', swing: '1 mês', posicao: '3 meses' };

/** The parts of a history a helper needs to cut it at a day (the rest is rebuilt from them). */
const portable = (h) => ({ ticker: h.ticker, name: h.name, fetchedAt: h.fetchedAt, raw: h.raw, dividends: h.dividends });

/**
 * The journal's days for `dates`, lived side by side on the computer's cores (the engine of engineDir, every
 * history cut at each day by journalEntry). onEntry(entry, done, total) as each one comes.
 */
// On the computer two cores stay free for whoever is using it; on GitHub (CI), all of them work.
export async function liveDays(engineDir, histories, dates, { workers = Math.max(1, process.env.CI ? cpus().length : Math.min(14, cpus().length - 2)), onEntry } = {}) {
	if (!dates.length) return [];
	const shared = Object.fromEntries(Object.entries(histories).map(([t, h]) => [t, portable(h)]));
	const n = Math.min(workers, dates.length);
	// Interleaved: the later days, with more history, are spread over all the helpers.
	const parts = Array.from({ length: n }, (_, k) => dates.filter((_, j) => j % n === k));
	const out = [];
	await Promise.all(
		parts.map(
			(part) =>
				new Promise((resolve, reject) => {
					const w = new Worker(new URL('./diario-trabalho.mjs', import.meta.url), { workerData: { engineDir, histories: shared, dates: part } });
					w.on('message', (m) => {
						if (m.done) return;
						out.push(m.entry);
						onEntry?.(m.entry, out.length, dates.length);
					});
					w.on('error', reject);
					w.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ajudante saiu com ${code}`))));
				})
		)
	);
	return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * Every chance of the journal whose horizon has passed by the calendar's place `until`, with what followed: for each
 * profile and group, records { i (the day's place), p, y (beat the group's average), ret, t }. Days that are not on
 * the calendar are left out.
 */
export function recordsOf(entries, histories, calendar, until, diario) {
	const place = new Map(calendar.map((d, i) => [d, i]));
	const out = Object.fromEntries(PROFILE_IDS.map((p) => [p, { FII: [], Ação: [] }]));
	for (const e of entries) {
		const i = place.get(e.date);
		if (i === undefined) continue;
		for (const p of PROFILE_IDS) {
			for (const [kind, g] of Object.entries(e.profiles[p] ?? {})) {
				const s = diario.scoreDay(g.rows, histories, calendar, i, diario.JOURNAL_HORIZON[p], until);
				if (!s) continue;
				for (const r of s.rows) out[p][kind].push({ i, p: r.p, y: r.y, ret: r.ret, t: r.ticker });
			}
		}
	}
	return out;
}

/** The lessons of the day at the calendar's place `at`: one per profile and group, from what had followed by then. */
export function lessonsAt(records, at, diario) {
	const out = {};
	for (const p of PROFILE_IDS) {
		out[p] = {};
		for (const kind of ['FII', 'Ação']) out[p][kind] = diario.lessonFor(records[p]?.[kind] ?? [], at, p);
	}
	return out;
}

/** What the robot's rules (robo.decide) do with a chance, given how the model checked itself and the market. */
function actionOf(engine, p, kind, profile, g) {
	return engine.decide({ forecast: { p, confidence: g.confidence, base: 0.5, analogs: { n: 0, beat: 0, mean: 0 }, drivers: [], rows: 0 }, market: g.market, kind, group: engine.GROUPS[kind], profile: { id: profile } }).action;
}

/**
 * A day's final word, in each profile: every asset with the model's chance (p), the chance corrected by the lesson
 * (q), and what the rules do with each (a: with p, b: with q), highest q first; and the two top 10s.
 */
export function finalOf(entry, lessons, engine, diario) {
	const out = {};
	for (const p of PROFILE_IDS) {
		const rows = [];
		for (const [kind, g] of Object.entries(entry.profiles[p] ?? {})) {
			const lesson = lessons?.[p]?.[kind] ?? null;
			for (const [t, v] of g.rows) {
				const q = Math.round(diario.applyLesson(v, lesson) * 1e6) / 1e6;
				rows.push({ t, kind, p: v, q, a: actionOf(engine, v, kind, p, g), b: actionOf(engine, q, kind, p, g) });
			}
		}
		rows.sort((x, y) => y.q - x.q || y.p - x.p);
		const byP = [...rows].sort((x, y) => y.p - x.p);
		out[p] = { rows, top: rows.slice(0, 10).map((r) => r.t), topRaw: byP.slice(0, 10).map((r) => r.t) };
	}
	return out;
}

const mean = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : NaN);

/**
 * How a day's final word turned out in one profile (null while its horizon has not passed by `until`): each asset's
 * return and whether it beat its group's average, and for the top 10 (with the lesson and without), the buys and
 * all of them, the average return and how many beat their group.
 */
export function scoreFinal(entry, final, histories, calendar, at, until, profile, diario) {
	const h = diario.JOURNAL_HORIZON[profile];
	const scored = {};
	let end = null;
	for (const [kind, g] of Object.entries(entry.profiles[profile] ?? {})) {
		const s = diario.scoreDay(g.rows, histories, calendar, at, h, until);
		if (!s) continue;
		end = s.to;
		for (const r of s.rows) scored[r.ticker] = { ret: r.ret, y: r.y, kind, groupMean: s.mean };
	}
	if (!end) return null;
	const rows = final[profile].rows.filter((r) => scored[r.t]).map((r) => ({ ...r, ...scored[r.t] }));
	const pack = (list) => ({ n: list.length, beat: list.filter((r) => r.y).length, mean: mean(list.map((r) => r.ret)), vsGroup: mean(list.map((r) => r.ret - r.groupMean)) });
	const top = rows.filter((r) => final[profile].top.includes(r.t));
	const topRaw = rows.filter((r) => final[profile].topRaw.includes(r.t));
	// How honest each chance was (log-loss: lower is better), with the lesson and without.
	const loss = (v, y) => -Math.log(Math.max(1e-9, y ? v : 1 - v));
	return {
		date: entry.date,
		end,
		profile,
		all: pack(rows),
		top: pack(top),
		topRaw: pack(topRaw),
		buys: pack(rows.filter((r) => r.b === 'COMPRAR')),
		buysRaw: pack(rows.filter((r) => r.a === 'COMPRAR')),
		hi: pack(rows.filter((r) => r.q >= 0.6)),
		hiRaw: pack(rows.filter((r) => r.p >= 0.6)),
		loss: { n: rows.length, lesson: rows.reduce((s, r) => s + loss(r.q, r.y), 0), raw: rows.reduce((s, r) => s + loss(r.p, r.y), 0) },
		byKind: Object.fromEntries(['FII', 'Ação'].map((k) => {
			const ks = rows.filter((r) => r.kind === k);
			return [k, { n: ks.length, lesson: ks.reduce((s, r) => s + loss(r.q, r.y), 0), raw: ks.reduce((s, r) => s + loss(r.p, r.y), 0), hi: pack(ks.filter((r) => r.q >= 0.6)), hiRaw: pack(ks.filter((r) => r.p >= 0.6)) }];
		})),
		picks: top.map((r) => ({ t: r.t, q: r.q, ret: r.ret, y: r.y, vs: r.ret - r.groupMean })),
		picksRaw: topRaw.map((r) => ({ t: r.t, q: r.p, ret: r.ret, y: r.y, vs: r.ret - r.groupMean }))
	};
}

/** A series of scored days in a few numbers: on average, how much the top 10 earned above all, how often it won, t. */
export function addUp(scores, h) {
	const spread = scores.map((s) => s.top.mean - s.all.mean);
	const spreadRaw = scores.map((s) => s.topRaw.mean - s.all.mean);
	// Days next to each other share most of their future: the t is taken on days one horizon apart.
	const apart = scores.filter((_, k) => k % h === 0).map((s) => s.top.mean - s.all.mean);
	const m = mean(apart);
	const sd = apart.length > 1 ? Math.sqrt(apart.reduce((a, v) => a + (v - m) ** 2, 0) / (apart.length - 1)) : NaN;
	const beat = scores.reduce((a, s) => a + s.top.beat, 0);
	const n = scores.reduce((a, s) => a + s.top.n, 0);
	const buys = scores.reduce((a, s) => a + s.buys.n, 0);
	const buysBeat = scores.reduce((a, s) => a + s.buys.beat, 0);
	return {
		days: scores.length,
		spread: mean(spread),
		spreadRaw: mean(spreadRaw),
		won: spread.filter((v) => v > 0).length,
		t: sd > 0 ? m / (sd / Math.sqrt(apart.length)) : NaN,
		tDays: apart.length,
		topBeat: n ? beat / n : NaN,
		allBeat: scores.length ? mean(scores.map((s) => s.all.beat / (s.all.n || 1))) : NaN,
		buys,
		buysBeat: buys ? buysBeat / buys : NaN
	};
}

/**
 * A scored day made small for the app: when, what the top 10 did, how many beat their group. The top 10 is the one
 * the app showed: corrected by the lesson when it is in use (apply), the model's otherwise.
 */
export function briefScore(s, apply = false) {
	const top = apply ? s.top : s.topRaw;
	const picks = apply ? s.picks : s.picksRaw;
	return { date: s.date, end: s.end, profile: s.profile, beat: top.beat, n: top.n, spread: Math.round((top.mean - s.all.mean) * 1e6) / 1e6, picks: picks?.map((x) => ({ t: x.t, y: x.y, vs: Math.round(x.vs * 1e5) / 1e5 })) ?? null };
}

/**
 * The journal file the app reads, from days lived without seals (the site's, on GitHub): the lessons of the last
 * day, and the last bet of each horizon that came due, scored with the lesson of its own day. apply: whether the
 * lesson passed its test (decided once, on the computer). onTime(entry): the day was lived on its own close.
 */
export function journalForApp({ entries, histories, calendar, engine, logic, apply, test, onTime = () => false }) {
	const place = new Map(calendar.map((d, i) => [d, i]));
	const until = calendar.length - 1;
	const records = recordsOf(entries, histories, calendar, until, engine.diario);
	const lastEntry = entries.at(-1);
	const lessons = lastEntry ? lessonsAt(records, place.get(lastEntry.date), engine.diario) : null;
	const last = {};
	for (const p of PROFILE_IDS) {
		const h = engine.diario.JOURNAL_HORIZON[p];
		const e = [...entries].reverse().find((x) => place.has(x.date) && place.get(x.date) + h <= until);
		if (!e) continue;
		const at = place.get(e.date);
		const final = finalOf(e, lessonsAt(records, at, engine.diario), engine, engine.diario);
		const s = scoreFinal(e, final, histories, calendar, at, until, p, engine.diario);
		if (s) last[p] = { ...briefScore(s, apply), refeito: !onTime(e) };
	}
	return {
		v: 1,
		logic,
		asOf: lastEntry?.date ?? null,
		apply,
		test,
		lessons: lessons ? Object.fromEntries(PROFILE_IDS.map((p) => [p, { FII: lessonForApp(lessons[p].FII), Ação: lessonForApp(lessons[p].Ação) }])) : null,
		last,
		record: null
	};
}

/**
 * Is the robot right? (Rhuan, 10/11/2026: "preciso achar mais fácil no relatório se o sistema vem acertando ou
 * errando".) From scored records: how often the 1st, the top 3 and the top 10 of each group beat the group's
 * average, beside all of them (the base: about half). In plain counts, so a person can read them.
 */
export function precisionOf(records) {
	const out = {};
	for (const p of PROFILE_IDS) {
		out[p] = {};
		for (const kind of ['FII', 'Ação']) {
			const byDay = new Map();
			for (const r of records[p]?.[kind] ?? []) {
				if (!byDay.has(r.i)) byDay.set(r.i, []);
				byDay.get(r.i).push(r);
			}
			const c = { days: byDay.size, all: [0, 0], first: [0, 0], top3: [0, 0], top10: [0, 0] };
			for (const rows of byDay.values()) {
				rows.sort((a, b) => b.p - a.p);
				for (const [k, r] of rows.entries()) {
					c.all[0] += r.y;
					c.all[1]++;
					if (k === 0) (c.first[0] += r.y), c.first[1]++;
					if (k < 3) (c.top3[0] += r.y), c.top3[1]++;
					if (k < 10) (c.top10[0] += r.y), c.top10[1]++;
				}
			}
			const rate = ([y, n]) => (n ? Math.round((y / n) * 1000) / 1000 : null);
			out[p][kind] = { days: c.days, all: rate(c.all), first: rate(c.first), top3: rate(c.top3), top10: rate(c.top10) };
		}
	}
	return out;
}

/**
 * The verdict of a series of bets, in words: each bet won when the top 10 earned more than all of them. Only bets
 * one horizon apart are counted (next ones share most of their future); fewer than 8 is too early to say.
 */
export function verdictOf(wins, h) {
	const apart = wins.filter((_, k) => k % h === 0);
	const n = apart.length;
	const won = apart.filter(Boolean).length;
	if (n < 8) return { n, won, word: 'cedo', text: `ainda cedo para dizer (${n} aposta${n === 1 ? '' : 's'} separada${n === 1 ? '' : 's'}; precisa de 8)` };
	const z = (won - n / 2) / Math.sqrt(n / 4);
	if (z >= 2) return { n, won, z, word: 'acerta', text: `acerta mais que a sorte: ganhou em ${won} de ${n}` };
	if (z <= -2) return { n, won, z, word: 'erra', text: `erra mais que a sorte: ganhou em só ${won} de ${n}` };
	return { n, won, z, word: 'sorte', text: `igual à sorte: ganhou em ${won} de ${n} (a sorte daria uns ${Math.round(n / 2)})` };
}

/** A lesson made small for the app (the numbers it needs, and what it learned from, in words). */
export function lessonForApp(L) {
	if (!L) return null;
	const r6 = (v) => (Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : null);
	return {
		alpha: r6(L.alpha),
		beta: r6(L.beta),
		centre: r6(L.centre),
		days: L.days,
		recentDays: L.recentDays,
		recent: { n: L.recent.n, said: r6(L.recent.said), hit: r6(L.recent.hit), hi: { n: L.recent.hi.n, days: L.recent.hi.days, said: r6(L.recent.hi.said), hit: r6(L.recent.hi.hit) } }
	};
}
