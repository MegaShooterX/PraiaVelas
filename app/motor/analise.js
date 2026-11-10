// The whole study of one asset, in one call: what has been happening, what the market around it is doing, what
// each strategy reads now and how right it was in the past of its group, the range where the price may go, and
// (since 0.0.3) the chance, learned from the last year of the group, that it does better than the others over the
// horizon. And the study of a whole group at once, which orders the "Top 10 de agora". Nothing here touches the
// screen: the app, the terminal tools and the tests all use it.
//
// Versions: 0.0.1 studied each asset alone; 0.0.2 took the evidence from the whole group and read the market
// first; 0.0.3 (09/11/2026) learns from the last year of the group (aprendizado.js) the chance of beating the
// CDI; 0.0.4 (09/11/2026) the chance of beating the group's average, from 8 measures compared with the other
// assets, starting from what held in the older years. The bot's rules are in robo.js. The old versions are kept frozen
// in D:\Projetos\PraiaVelas\versoes (0.0.5, with the FIIs' CVM reports in the model, was tested and left out).
//
// The draft of 09/11/2026, all at once and without a version number until Rhuan asks (ENGINE_DRAFT):
// - the FIIs' P/VP, from their reports to the CVM (cvm.js), is shown on the fund's page; the robot does not use it;
// - tested and switched off (their blind test did not meet the rules fixed before it), kept for the future test:
//   SECOND_OPINION, the learner of 0.0.3 (aprendizado-cdi.js) tilting the chance by its view of each asset against
//   the group; and OLD_LESSON, the 3-month reading with only the lesson of the older years.
// With both off, the robot decides exactly as 0.0.4.
//
// The robot's journal (diario.js, draft of 10/11/2026): every trading day the chances are written down
// (journalEntry), scored when the horizon passes, and the robot learns from its own record how far to trust them.
// The app shows the corrected chance (ranking and analyze with a journal) only when the journal's lesson passed
// its test (the journal file says so: apply); otherwise the chance is the model's, as before.

import { fetchHistory, historyUntil } from './dados.js';
import { load, save } from './armazem.js';
import { resample, studyPatterns } from './candles.js';
import { buildContext, STRATEGIES } from './estrategias.js';
import { combinedAt, evaluate, forwardReturns, outOfSample, pooledEvaluate, pooledOutOfSample, weightsFor } from './backtest.js';
import { GROUPS, kindOf, marketState, SEGMENTS, volRatio } from './mercado.js';
import { monteCarlo } from './projecao.js';
import { compare, dataset, forecast, relativize, trainModel } from './aprendizado.js';
import * as second from './aprendizado-cdi.js';
import { fetchRates, rateTools, ratesUntil } from './juros.js';
import { bookNow, fetchFundamentals, FUND_IDS, fundamentalsUntil } from './cvm.js';
import { applyLesson, lessonWords } from './diario.js';

export { fetchFundamentals, fetchRates, fundamentalsUntil, ratesUntil };

/** The last version number. A new one only when Rhuan asks (09/11/2026); until then the changes are a draft. */
export const ENGINE_VERSION = '0.0.4';
export const ENGINE_DRAFT = true;
/**
 * The learner of 0.0.3 as a second opinion on the chance (draft of 09/11/2026). Off: in its blind test (experimentos\
 * 2026-11-09-top10-pacote) it did not improve the 1-month top 10, the rule fixed before the test. The frozen draft
 * rascunho-fbd2177e keeps it on, sealed every week beside the app for the future to judge.
 */
const SECOND_OPINION = false;
/**
 * The timeframes whose model keeps only the lesson of the older years. Empty: in the same test, the 3-month top 10
 * did worse than 0.0.4's with it (it is on in rascunho-fbd2177e).
 */
const OLD_LESSON = new Set();
/**
 * Where the chances come from: the logic of 0.0.4 while both options above are off. A journal's lesson is learned
 * on the chances of one logic and corrects only those (a lesson of other chances is not used).
 */
export const MODEL_LOGIC = SECOND_OPINION || OLD_LESSON.size ? 'pacote-2026-11-09' : '0.0.4';

/** Ways of reading the chart: the size of each candle and how far ahead the reading looks. */
export const PROFILES = {
	curto: {
		id: 'curto',
		name: 'Curto',
		about: 'Candles diários, olhando 1 semana à frente',
		timeframe: 'D',
		horizon: 5,
		unit: 'pregões',
		perYear: 252,
		lookback: 500,
		periods: { fast: 9, slow: 21, mid: 50, long: 200, chan: 20 }
	},
	swing: {
		id: 'swing',
		name: 'Swing',
		about: 'Candles diários, olhando 1 mês à frente',
		timeframe: 'D',
		horizon: 21,
		unit: 'pregões',
		perYear: 252,
		lookback: 750,
		periods: { fast: 9, slow: 21, mid: 50, long: 200, chan: 20 }
	},
	posicao: {
		id: 'posicao',
		name: 'Posição',
		about: 'Candles semanais, olhando 3 meses à frente',
		timeframe: 'W',
		horizon: 13,
		unit: 'semanas',
		perYear: 52,
		lookback: 156,
		periods: { fast: 5, slow: 13, mid: 26, long: 52, chan: 13 }
	}
};

/** The model decides from the last year (252 trading days); the 3-month reading from the last two (104 weeks): one year holds only four 3-month periods. The years before give its starting point. */
const WINDOW = { D: 252, W: 104 };

export const MODES = {
	ponderada: { id: 'ponderada', name: 'Ponderada pelo histórico', about: 'Cada estratégia pesa conforme acertou no grupo (todos os FIIs, ou todas as ações); as que não foram melhores que o acaso ficam de fora.' },
	simples: { id: 'simples', name: 'Votação simples', about: 'Todas as estratégias valem o mesmo voto.' }
};

export const DEFAULT_WATCHLIST = ['HGLG11', 'MXRF11', 'KNRI11', 'XPML11', 'BTLG11', 'VISC11', 'KNCR11', 'HGRU11'];

const VERDICTS = [
	[0.5, 'Alta', 'alta'],
	[0.2, 'Leve alta', 'leve-alta'],
	[-0.2, 'Neutro', 'neutro'],
	[-0.5, 'Leve baixa', 'leve-baixa'],
	[-Infinity, 'Baixa', 'baixa']
];

function dayNumber(date) {
	return Date.parse(`${date}T00:00:00Z`) / 86_400_000;
}

/** Dividends paid in the 365 days up to the last candle. */
function lastYearDividends(history) {
	const end = dayNumber(history.candles.at(-1).date);
	const paid = history.dividends.filter((d) => dayNumber(d.date) > end - 365 && dayNumber(d.date) <= end);
	return { paid, total: paid.reduce((s, d) => s + d.amount, 0) };
}

/** What has been happening, from the daily candles whatever the profile. */
function recentContext(history) {
	const days = history.candles;
	const last = days.at(-1);
	const back = (n) => days[Math.max(0, days.length - 1 - n)];
	const year = days.slice(-252);
	const month = days.slice(-21);
	const { paid, total } = lastYearDividends(history);
	const high = Math.max(...year.map((d) => d.h));
	const low = Math.min(...year.map((d) => d.l));
	return {
		last: last.c,
		date: last.date,
		dayChange: days.length > 1 ? last.c / back(1).c - 1 : NaN,
		change1m: last.c / back(21).c - 1,
		change3m: last.c / back(63).c - 1,
		change12m: last.c / back(252).c - 1,
		total12m: last.a / back(252).a - 1,
		high52: high,
		low52: low,
		fromHigh: last.c / high - 1,
		liquidity: month.reduce((s, d) => s + d.c * d.v, 0) / month.length,
		dy12: total / last.c,
		dividends12: total,
		lastDividend: paid.at(-1) ?? history.dividends.at(-1) ?? null,
		dividendSeries: history.dividends.slice(-24)
	};
}

/** The sentences of "o que vem ocorrendo". */
function narrative(ctx) {
	const p = (v) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(1).replace('.', ',')}%`;
	const lines = [];
	lines.push(`Em 1 mês a cota variou ${p(ctx.change1m)}; em 3 meses, ${p(ctx.change3m)}; em 12 meses, ${p(ctx.change12m)} (${p(ctx.total12m)} somando os dividendos).`);
	if (ctx.fromHigh > -0.01) lines.push('Está na máxima das últimas 52 semanas.');
	else lines.push(`Está ${p(-ctx.fromHigh).replace('+', '')} abaixo da máxima de 52 semanas.`);
	if (ctx.dy12 > 0) lines.push(`Pagou ${p(ctx.dy12).replace('+', '')} de dividendos sobre o preço atual nos últimos 12 meses.`);
	if (ctx.liquidity < 500_000) lines.push('Pouca liquidez: menos de R$ 500 mil negociados por dia, o preço pode pular.');
	return lines;
}

function verdictOf(score) {
	const [, label, tone] = VERDICTS.find(([min]) => score >= min);
	return { label, tone };
}

/** The candles of one profile, what every strategy said on each of them, and what came after (when known). */
export function prepare(history, profile = 'swing') {
	const P = PROFILES[profile] ?? PROFILES.swing;
	const bars = resample(history.candles, P.timeframe);
	if (bars.length < 80) throw new Error(`Histórico curto demais para estudar: ${bars.length} candles.`);
	const x = buildContext(bars, P.periods);
	const fwd = forwardReturns(x.a, P.horizon);
	const signals = STRATEGIES.map((s) => s.signal(x));
	return { ticker: history.ticker, P, bars, x, fwd, signals, dates: bars.map((b) => b.date) };
}

/**
 * The evidence of a whole group in one profile: each strategy tested on all its assets at once, and the
 * combination checked out of sample the same way. prepared: prepare() of each asset, with their histories cut at
 * the same date. Kept small (numbers only), so the app can keep it instead of the histories.
 */
export function poolEvidence(prepared, profile) {
	const P = PROFILES[profile] ?? PROFILES.swing;
	const list = prepared.filter((a) => a.P.id === P.id);
	if (list.length < 3) return null;
	const strategies = STRATEGIES.map((s, k) => ({
		id: s.id,
		...pooledEvaluate(
			list.map((a) => ({ dates: a.dates, fwd: a.fwd, signal: a.signals[k] })),
			P.horizon
		)
	}));
	const validation = {};
	for (const m of Object.keys(MODES)) validation[m] = pooledOutOfSample(list, P.horizon, m);
	const asOf = list.reduce((m, a) => (a.dates.at(-1) > m ? a.dates.at(-1) : m), '');
	return { profile: P.id, assets: list.map((a) => a.ticker), asOf, strategies, validation };
}

/** A small summary of an asset for the ranking: what a person sees in the list. */
function brief(history) {
	const c = recentContext(history);
	return { ticker: history.ticker, name: history.name, date: c.date, price: c.last, dayChange: c.dayChange, dy12: c.dy12, change1m: c.change1m };
}

/**
 * The study of a whole group in one profile, with every history cut at the same date: the pooled evidence of the
 * strategies, the model learned from the group, and today's picture of each asset compared with the others (with
 * its brief). histories: of the group's assets; market: the group's index fund. rates (CDI and Selic, cut at the
 * same date): for the second opinion, which asks "more than the CDI?"; without them there is none. fundamentals
 * (the CVM reports, cut at the same date): only for the P/VP shown, never for the chance.
 */
export function studyGroup(histories, { profile, market, rates = null, fundamentals = null }) {
	const P = PROFILES[profile] ?? PROFILES.swing;
	const tools = SECOND_OPINION && rates?.cdi?.length ? rateTools(rates) : null;
	const items = [];
	for (const h of histories) {
		try {
			const prep = prepare(h, P.id);
			items.push({ h, prep, set: dataset(prep, h), set2: tools && market ? second.dataset(prep, h, market, tools) : null, reports: fundamentals?.funds?.[h.ticker] ?? null });
		} catch {
			// Too short for this profile.
		}
	}
	const pool = poolEvidence(
		items.map((i) => i.prep),
		P.id
	);
	let model = null;
	const today = {};
	if (items.length >= 5) {
		const sets = items.map((i) => i.set);
		const cross = relativize(sets);
		model = trainModel(sets, P.horizon, WINDOW[P.timeframe], cross, { recentFit: !OLD_LESSON.has(P.timeframe) });
		// The second opinion: 0.0.3's chance of beating the CDI for each asset today, as its distance (in log-odds)
		// from the average of the group's. Only the distance counts: what moves the whole group is not about the order.
		const opinions = new Map();
		if (items.every((i) => i.set2)) {
			const sets2 = items.map((i) => i.set2);
			const seasonal = second.addSeasonality(sets2);
			const model2 = second.trainModel(sets2, P.horizon, WINDOW[P.timeframe], seasonal);
			for (const i of items) {
				const x2 = i.set2.X.at(-1);
				const f2 = model2 && x2 ? second.forecast(model2, x2) : null;
				// Only a picture of the same day as the asset's last candle (a stale one is no opinion on today).
				if (f2 && i.set2.dates.at(-1) === i.h.candles.at(-1)?.date) opinions.set(i.h.ticker, Math.log(f2.p / (1 - f2.p)));
			}
		}
		const mean2 = opinions.size >= 5 ? [...opinions.values()].reduce((a, b) => a + b, 0) / opinions.size : NaN;
		for (const i of items) {
			// Compared with the others on its last day; when too few others have that day yet, with the group's last day.
			const z = i.set.Z.at(-1) ?? compare(i.set.X.at(-1), cross);
			const b = brief(i.h);
			const o = opinions.get(i.h.ticker);
			today[i.h.ticker] = { ...b, x: z ? [...z] : null, second: Number.isFinite(o) && Number.isFinite(mean2) ? o - mean2 : null, book: i.reports ? bookNow(i.reports, b.date, b.price) : null };
		}
	}
	return { profile: P.id, pool, model, today, market: marketState(market, P), prepared: Object.fromEntries(items.map((i) => [i.h.ticker, i.prep])) };
}

/**
 * The chance corrected by the robot's journal (diario.js): only when its lesson is in use (apply: it passed its
 * test) and was learned on chances of this same logic. The model's own chance stays in beforeJournal.
 */
function withJournal(f, journal, kind, profile) {
	const lesson = journal?.apply && journal.logic === MODEL_LOGIC ? (journal.lessons?.[profile]?.[kind] ?? null) : null;
	if (!f || !lesson) return f;
	return { ...f, beforeJournal: f.p, p: applyLesson(f.p, lesson), journal: { asOf: journal.asOf, ...lessonWords(lesson), recent: lesson.recent, beta: lesson.beta } };
}

/** Today's picture of an asset outside its group's study (searched by code): the same measures, compared with the group's last day. */
function pictureOf(prep, history, model) {
	if (!model?.cross) return null;
	const z = compare(dataset(prep, history).X.at(-1), model.cross);
	return z ? [...z] : null;
}

/**
 * history: the asset's. kind: 'FII' or 'Ação' (found from the name when not given). market: the history of the
 * group's index fund (XFIX11 or BOVA11). pool: poolEvidence() of the group in this profile. model and picture
 * (today's features, from studyGroup) or rates: for the learned chance. Without the pool the strategies' evidence
 * is the asset's own; without the model there is no learned chance, and the bot does not act. today: what the
 * group's study knows of the asset today (studyGroup's today[ticker]): the second opinion and the P/VP shown.
 * journal: the robot's journal (diario.js), whose lesson corrects the chance when it is in use.
 */
export function analyze(history, { profile = 'swing', mode = 'ponderada', kind = null, market = null, pool = null, prepared = null, model = null, picture = null, rates = null, today = null, journal = null } = {}) {
	const prep = prepared ?? prepare(history, profile);
	const { P, bars, x, fwd, signals } = prep;
	const last = x.n - 1;
	const group = GROUPS[kind ?? kindOf(history.ticker, history.name)] ?? GROUPS.FII;
	const own = signals.map((s) => evaluate(s, fwd, P.horizon));
	const pooled = pool?.profile === P.id && pool.strategies?.length === STRATEGIES.length ? pool : null;
	const evidence = pooled ? pooled.strategies : own;
	const weights = weightsFor(evidence, mode);
	const totalWeight = weights.reduce((s, w) => s + w, 0);
	const score = combinedAt(signals, weights, last);
	const validation = pooled ? (pooled.validation[mode] ?? pooled.validation.ponderada) : outOfSample(signals, fwd, P.horizon, mode);
	const baseMean = own[0].mean;

	const context = recentContext(history);
	const marketNow = marketState(market, P);
	// No tilt: the cone is centred on today's price, and wider when the asset or its market has been rougher
	// in the last month than in its usual year.
	const ownRatio = volRatio(history.candles);
	const scale = Math.max(1, Number.isFinite(ownRatio) ? ownRatio : 1, Number.isFinite(marketNow?.volRatio) ? marketNow.volRatio : 1);
	const projection = monteCarlo(x.c, { horizon: P.horizon, drift: 0, lookback: P.lookback, scale });
	const learned = withJournal(model ? forecast(model, picture ?? pictureOf(prep, history, model), today?.second ?? null) : null, journal, group.id, P.id);
	const book = today?.book ?? null;

	const patternStudy = studyPatterns(x.patterns, fwd);
	const recentPatterns = x.patterns
		.filter((p) => p.i > last - 5)
		.map((p) => ({ ...p, date: bars[p.i].date, study: patternStudy.find((s) => s.id === p.id) ?? null }));

	const strategies = STRATEGIES.map((s, k) => ({
		id: s.id,
		name: s.name,
		family: s.family,
		about: s.about,
		now: signals[k][last],
		reading: s.read(x, last, signals[k][last]),
		stats: evidence[k],
		own: own[k],
		weight: totalWeight > 0 ? weights[k] / totalWeight : 0
	}));

	const trusted = validation.n >= 20 && validation.edge > 0 && validation.hit > validation.baseHit;
	const confidence = !trusted ? 'baixa' : Math.abs(score) >= 0.5 ? 'alta' : 'média';
	const warnings = [];
	if (history.stale) warnings.push('Sem internet: mostrando a última cópia baixada.');
	if (!pooled) warnings.push(`Prova só deste ativo: não deu para juntar ${group.the} ${group.name} do grupo.`);
	if (!marketNow) warnings.push(`Sem a leitura do mercado (${group.market}).`);
	if (!learned) warnings.push('Sem o modelo aprendido (não deu para estudar o grupo): o robô não decide.');
	if (group.id === 'FII' && FUND_IDS[history.ticker] && !book) warnings.push('Sem o relatório do fundo na CVM: o P/VP não aparece.');
	if (bars.length < P.perYear * 3) warnings.push('Menos de 3 anos de histórico: os acertos medidos valem pouco.');
	if (context.liquidity < 500_000) warnings.push('Pouca liquidez: os candles têm muito ruído.');

	return {
		version: ENGINE_VERSION,
		ticker: history.ticker,
		name: history.name,
		segment: SEGMENTS[history.ticker] ?? null,
		fetchedAt: history.fetchedAt,
		profile: P,
		mode: MODES[mode] ?? MODES.ponderada,
		asOf: bars[last].end ?? bars[last].date,
		kind: group.id,
		group: { id: group.id, name: group.name, the: group.the, inThe: group.inThe, market: group.market, marketName: group.marketName },
		evidenceFrom: pooled ? { kind: 'grupo', assets: pooled.assets.length } : { kind: 'próprio', assets: 1 },
		market: marketNow,
		forecast: learned,
		book,
		context: { ...context, narrative: narrative(context) },
		verdict: { score, ...verdictOf(score), confidence },
		expected: { total: baseMean, base: baseMean, probUp: projection?.probUp ?? NaN },
		projection: projection ? { ...projection, scale } : null,
		validation,
		strategies,
		patterns: { recent: recentPatterns, study: patternStudy },
		chart: {
			bars,
			emaFast: x.emaFast,
			emaSlow: x.emaSlow,
			bbUpper: x.bb.upper,
			bbLower: x.bb.lower,
			markers: x.patterns.map((p) => ({ i: p.i, dir: p.dir, name: p.name }))
		},
		warnings
	};
}

const STUDY_MAX_AGE = 6 * 3_600_000;
/** Histories of the groups downloaded in this session (not kept: the phone's storage is small). */
const memory = {};

/**
 * The study of a whole group (FII or Ação) in the three profiles, for the app: the histories are downloaded once
 * per session, the summary (evidence, models, today's pictures) is kept for a few hours.
 * onProgress(done, total, ticker) tells the screen how far it got.
 */
export async function groupStudy(kind, { force = false, onProgress } = {}) {
	const key = `cache:estudo:${ENGINE_VERSION}${ENGINE_DRAFT ? '+rascunho' : ''}:${kind}`;
	const cached = load(key);
	if (!force && cached?.studies && Date.now() - cached.madeAt < STUDY_MAX_AGE) return cached;
	const group = GROUPS[kind];
	if (!group) return null;
	const members = group.members;
	if (force || !memory[kind]) {
		const histories = [];
		for (let i = 0; i < members.length; i++) {
			onProgress?.(i, members.length, members[i]);
			try {
				histories.push(await fetchHistory(members[i], { keep: false }));
			} catch {
				// A member that does not download stays out this time.
			}
		}
		memory[kind] = histories;
	}
	onProgress?.(members.length, members.length, null);
	const market = await fetchHistory(group.market).catch(() => null);
	// The CDI and Selic (Banco Central), for the second opinion; the FIIs' CVM reports, for the P/VP shown. Without
	// either, the study still runs: no second opinion, or no P/VP.
	const rates = SECOND_OPINION ? await fetchRates().catch(() => null) : null;
	const fundamentals = kind === 'FII' ? await fetchFundamentals({ force, onProgress: (k, n) => onProgress?.(k, n, 'CVM') }).catch(() => null) : null;
	const studies = {};
	for (const p of Object.keys(PROFILES)) {
		const s = studyGroup(memory[kind], { profile: p, market, rates, fundamentals });
		studies[p] = { pool: s.pool, model: s.model, today: s.today, market: s.market };
	}
	const out = { madeAt: Date.now(), kind, studies, sources: { rates: Boolean(rates?.cdi?.length), cvm: fundamentals ? fundamentals.until : null } };
	if (studies.swing.pool) save(key, out);
	return out;
}

/**
 * The ranking of a group in one profile: every asset with today's learned chance of doing better than the
 * group's average, highest first. Each row carries what robo.decide() needs (forecast, kind, group, market, profile).
 * journal: the robot's journal, whose lesson corrects the chances when it is in use.
 */
export function ranking(study, profile, journal = null) {
	const s = study?.studies?.[profile];
	if (!s?.model) return [];
	const g = GROUPS[study.kind];
	const group = { id: g.id, name: g.name, the: g.the, inThe: g.inThe, market: g.market, marketName: g.marketName };
	return Object.values(s.today)
		.map((t) => ({ ...t, kind: study.kind, segment: SEGMENTS[t.ticker] ?? null, group, market: s.market, profile: PROFILES[profile], forecast: withJournal(forecast(s.model, t.x, t.second), journal, study.kind, profile) }))
		.filter((r) => r.forecast)
		.sort((a, b) => b.forecast.p - a.forecast.p);
}

/**
 * One day of the robot's journal (diario.js): the model's chance for every asset of both groups in the three
 * profiles, each group studied with every history cut at `date` (nothing after it reaches the study). histories:
 * whole, by ticker (the groups' members and their index funds). Also how the model checked itself and the market,
 * which the robot's rules need. The chances are the model's own (no journal lesson: that is learned from these).
 */
export function journalEntry(histories, date) {
	const profiles = {};
	for (const p of Object.keys(PROFILES)) {
		profiles[p] = {};
		for (const [kind, g] of Object.entries(GROUPS)) {
			const hs = g.members.filter((t) => histories[t]).map((t) => historyUntil(histories[t], date)).filter((h) => h.candles.length);
			const market = histories[g.market] ? historyUntil(histories[g.market], date) : null;
			const s = studyGroup(hs, { profile: p, market: market?.candles.length ? market : null });
			const rows = ranking({ kind, studies: { [p]: s } }, p);
			if (!rows.length) continue;
			if (s.model.trainedUntil > date) throw new Error(`Vazou futuro no modelo ${kind} ${p} ${date}`);
			profiles[p][kind] = {
				confidence: s.model.confidence,
				market: s.market ? { trend: s.market.trend, turn: s.market.turn ?? 0, agitated: Boolean(s.market.agitated) } : null,
				rows: rows.map((r) => [r.ticker, Math.round(r.forecast.p * 1e6) / 1e6])
			};
		}
	}
	return { date, profiles };
}

/** Kept for the 0.0.2 callers: the pooled evidence of the group in the three profiles. */
export async function groupPools(kind, options = {}) {
	const study = await groupStudy(kind, options);
	return study ? Object.fromEntries(Object.entries(study.studies).map(([p, s]) => [p, s.pool])) : null;
}

export async function analyzeTicker(ticker, { profile = 'swing', mode = 'ponderada', force = false, onProgress, journal = null } = {}) {
	const history = await fetchHistory(ticker, { force });
	const kind = kindOf(history.ticker, history.name);
	const group = GROUPS[kind];
	const market = await fetchHistory(group.market, { force }).catch(() => null);
	const study = await groupStudy(kind, { force, onProgress }).catch(() => null);
	const s = study?.studies?.[profile];
	const today = s?.today?.[history.ticker] ?? null;
	return analyze(history, { profile, mode, kind, market, pool: s?.pool ?? null, model: s?.model ?? null, picture: today?.x ?? null, today, journal });
}
