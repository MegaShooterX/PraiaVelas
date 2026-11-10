// The blind experiment of the decision bot (app/motor/robo.js).
//
//   node ferramentas/experimento.mjs congelar        copies app/motor to D:\Projetos\PraiaVelas\versoes\<versão>
//                                                    (or versoes\rascunho-<hash> while it is a draft, with no
//                                                    version number yet), where it no longer changes: the tests run
//                                                    from there
//   node ferramentas/experimento.mjs lacrar          decides at past dates with the data cut there, and seals it
//        [--pregoes 40,30,20] [--perfis swing] [--sem-serie]   which past dates (trading days before the last
//                                                    close), which profiles, and whether to add the 3-year series
//   node ferramentas/experimento.mjs lacrar-futuro   decides on the last close and seals it until the future comes
//   node ferramentas/experimento.mjs revelar         opens what really happened after each decision, scores them
//                                                    (a decision whose horizon has not passed yet stays sealed,
//                                                    or, in the recent test, is measured up to the last close and
//                                                    marked partial)
//   node ferramentas/experimento.mjs relatorio       only redraws the reports (after conclusoes.md is written):
//                                                    relatorio-lite.html and relatorio-avancado.html
//   node ferramentas/experimento.mjs atualizar       "revelar" in every test with something still sealed or partial
//   node ferramentas/experimento.mjs acumulado       the future tests of each engine added together (the decisions
//                                                    sealed every week): futuro-acumulado.json in the experiments
//   [--versao 0.0.1]                                 the frozen engine that decides (a number, or rascunho-<hash>;
//                                                    default: the frozen copy of app/motor, which must exist)
//   [--pasta <nome>]                                 the experiment's folder (default: today's date)
//   [--comparar <pasta>]                             revelar/relatorio: another experiment's numbers alongside
//
// Versions go 0.0.1, 0.0.2, ... (Rhuan, 08/11/2026), and a number is given only when he asks (09/11/2026): until
// then the changes gather in a draft (ENGINE_DRAFT in analise.js), frozen and tested by the hash of its code.
//
// Blind by construction: each decision gets historyUntil(history, date) and nothing after it, for the asset, its
// group and its market. The decisions are written and sealed (SHA-256 of the file and of the engine's code)
// before any result exists; "revelar" refuses to run if the decisions changed, and says whether the engine that
// decided is still the frozen one. Everything is kept in D:\Projetos\PraiaVelas.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeReports } from './relatorio.mjs';

const base = process.env.PRAIAVELAS_SAIDA ?? 'D:\\Projetos\\PraiaVelas';
const cacheDir = join(base, 'cache');
mkdirSync(cacheDir, { recursive: true });
const fileOf = (key) => join(cacheDir, `${key.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
const fileStore = { get: (k) => (existsSync(fileOf(k)) ? readFileSync(fileOf(k), 'utf8') : null), set: (k, raw) => writeFileSync(fileOf(k), raw) };

const args = process.argv.slice(2);
const step = args[0];
const option = (name) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : null);
const flag = (name) => args.includes(`--${name}`);
const chosenFolder = option('pasta');
let folder = null;
function openFolder(name) {
	folder = join(base, 'experimentos', chosenFolder ?? name);
	mkdirSync(folder, { recursive: true });
	return folder;
}
/** A seal is never written twice: overwriting one would erase the proof that the decisions came first. */
function refuseIfSealed() {
	if (existsSync(join(folder, 'lacre.json'))) throw new Error(`Já existe um lacre em ${folder}. Use outra --pasta.`);
}

// ------------------------------------------------------------------------------------------------------- motores

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const appEngineDir = fileURLToPath(new URL('../app/motor/', import.meta.url));
const versionsDir = join(base, 'versoes');
const engineDirOf = (version) => join(versionsDir, version, 'motor');
const engineFiles = (dir) => readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
const dirHash = (dir) => sha256(engineFiles(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n'));
const FIRST_VERSION = '0.0.1';

/** One engine (the app's, or a frozen version), with its own store pointing at the cache on disk. */
async function loadEngine(dir) {
	const at = (f) => import(pathToFileURL(join(dir, f)).href);
	const [armazem, analise, dados, robo, estrategias, rede] = await Promise.all(['armazem.js', 'analise.js', 'dados.js', 'robo.js', 'estrategias.js', 'rede.js'].map(at));
	armazem.useStore(fileStore);
	const mercado = existsSync(join(dir, 'mercado.js')) ? await at('mercado.js') : null;
	// A frozen draft is known by its folder (rascunho-<hash>), not by the number it still carries.
	const folderName = basename(dirname(dir));
	return {
		dir,
		version: folderName.startsWith('rascunho-') ? folderName : (analise.ENGINE_VERSION ?? FIRST_VERSION),
		draft: Boolean(analise.ENGINE_DRAFT),
		analyze: analise.analyze,
		prepare: analise.prepare ?? null,
		poolEvidence: analise.poolEvidence ?? null,
		fetchHistory: dados.fetchHistory,
		historyUntil: dados.historyUntil,
		decide: robo.decide,
		RULES: robo.RULES,
		RULE_LINES: robo.RULE_LINES ?? null,
		STRATEGIES: estrategias.STRATEGIES,
		getJson: rede.getJson,
		GROUPS: mercado?.GROUPS ?? null,
		SEGMENTS: mercado?.SEGMENTS ?? null,
		studyGroup: analise.studyGroup ?? null,
		fetchRates: analise.fetchRates ?? null,
		ratesUntil: analise.ratesUntil ?? null,
		fetchFundamentals: analise.fetchFundamentals ?? null,
		fundamentalsUntil: analise.fundamentalsUntil ?? null
	};
}

/** The engine of app/motor: it measures what happened (cleaned prices) in every experiment, whatever decided. */
const current = await loadEngine(appEngineDir);
const STRATEGIES = current.STRATEGIES;

/** Every frozen version on disk, with the hash of its code. */
function knownVersions() {
	if (!existsSync(versionsDir)) return [];
	return readdirSync(versionsDir)
		.filter((v) => existsSync(engineDirOf(v)))
		.map((v) => ({ version: v, hash: dirHash(engineDirOf(v)) }));
}

function freeze() {
	const now = dirHash(appEngineDir);
	const same = knownVersions().find((k) => k.hash === now);
	if (same) return console.log(`O motor do app já está congelado como ${same.version} em ${engineDirOf(same.version)} (${now}).`);
	// A draft has no number yet (Rhuan, 09/11/2026): it is frozen under the start of its hash.
	const name = current.draft ? `rascunho-${now.slice(0, 8)}` : current.version;
	const dir = engineDirOf(name);
	if (existsSync(dir)) throw new Error(`A versão ${name} já foi congelada com outro código: com ENGINE_DRAFT = true em app/motor/analise.js, ele congela como rascunho.`);
	mkdirSync(dir, { recursive: true });
	for (const f of engineFiles(appEngineDir)) copyFileSync(join(appEngineDir, f), join(dir, f));
	console.log(`Motor ${name} congelado em ${dir}\nHash: ${dirHash(dir)}`);
}

/** The engine that decides: a frozen version, never the code that may still change. */
async function deciderEngine() {
	const version = option('versao') ?? knownVersions().find((k) => k.hash === dirHash(appEngineDir))?.version;
	if (!version) throw new Error('O motor do app não está congelado. Rode: node ferramentas/experimento.mjs congelar');
	const dir = engineDirOf(version);
	if (!existsSync(dir)) throw new Error(`A versão ${version} não está congelada. Rode: node ferramentas/experimento.mjs congelar`);
	const engine = await loadEngine(dir);
	if (engine.version !== version) throw new Error(`A pasta da versão ${version} tem o motor ${engine.version}.`);
	return engine;
}

// ------------------------------------------------------------------------------------------------------ universo

/** The 28 assets of the tests of 0.0.1 and 0.0.2. Since 0.0.3 the universe is the engine's groups (63 assets). */
const LEGACY_UNIVERSE = [
	['HGLG11', 'FII', 'Logística'],
	['BTLG11', 'FII', 'Logística'],
	['XPLG11', 'FII', 'Logística'],
	['VILG11', 'FII', 'Logística'],
	['LVBI11', 'FII', 'Logística'],
	['XPML11', 'FII', 'Shoppings'],
	['VISC11', 'FII', 'Shoppings'],
	['HSML11', 'FII', 'Shoppings'],
	['KNRI11', 'FII', 'Híbrido'],
	['HGRU11', 'FII', 'Renda urbana'],
	['TRXF11', 'FII', 'Renda urbana'],
	['ALZR11', 'FII', 'Híbrido'],
	['PVBI11', 'FII', 'Lajes'],
	['JSRE11', 'FII', 'Lajes'],
	['MXRF11', 'FII', 'Papel'],
	['KNCR11', 'FII', 'Papel'],
	['KNIP11', 'FII', 'Papel'],
	['CPTS11', 'FII', 'Papel'],
	['RECR11', 'FII', 'Papel'],
	['VGIR11', 'FII', 'Papel'],
	['PETR4', 'Ação', 'Petróleo'],
	['VALE3', 'Ação', 'Mineração'],
	['ITUB4', 'Ação', 'Bancos'],
	['BBAS3', 'Ação', 'Bancos'],
	['BBDC4', 'Ação', 'Bancos'],
	['WEGE3', 'Ação', 'Indústria'],
	['ABEV3', 'Ação', 'Bebidas'],
	['MGLU3', 'Ação', 'Varejo']
];
let UNIVERSE = LEGACY_UNIVERSE;
/** The assets an engine decides on: its groups when it learns from them (0.0.3+), the old 28 otherwise. */
const universeOf = (engine) =>
	engine.studyGroup && engine.GROUPS ? Object.values(engine.GROUPS).flatMap((g) => g.members.map((t) => [t, g.id, engine.SEGMENTS?.[t] ?? g.name])) : LEGACY_UNIVERSE;
/** The CDI and Selic histories (0.0.3+), cut at each decision date. */
let RATES = null;
/** The FIIs' CVM reports (0.0.5+), cut at each decision date by the day each could be read. */
let FUNDS = null;
/** The index fund that stands for each market: also what "the market did" in the report. */
const MARKET_OF = { FII: 'XFIX11', Ação: 'BOVA11' };
/** The recent test: trading days before the last close, and the profiles read on them. */
const RECENT = {
	profiles: option('perfis') ? option('perfis').split(',') : ['swing'],
	offsets: option('pregoes') ? option('pregoes').split(',').map(Number) : [40, 30, 20]
};
/** The long series: one decision a month (every 21 trading days) over the last 3 years, in each profile. */
const SERIES = { profiles: ['curto', 'swing', 'posicao'], from: 756, every: 21, since: option('desde'), until: option('ate') };
const withSeries = !flag('sem-serie');
const withRecent = !flag('sem-recente');
const HORIZON_DAYS = { curto: 5, swing: 21, posicao: 65 };
const PROFILE_NAME = { curto: 'Curto (5 pregões)', swing: 'Swing (21 pregões)', posicao: 'Posição (13 semanas)' };

/** The rules of 0.0.1 in words (that version did not carry them). */
const RULE_LINES_001 = [
	'**COMPRAR**: nota das estratégias ponderadas ≥ 0,20, confiança média ou alta no teste fora da amostra do próprio ativo, e mais da metade dos futuros simulados terminando acima.',
	'**VENDER**: o espelho disso (nota ≤ −0,20, confiança média ou alta, no máximo metade dos futuros acima). Em FII, vender = sair do fundo (não é venda a descoberto).',
	'**FICAR DE FORA**: em todo o resto. Mesmo assim ele registra o **veredito forçado** (o lado que escolheria se fosse obrigado), para todas as decisões serem conferidas.'
];

/**
 * The histories of the universe and the markets, from the cache when younger than maxAgeMs. The past tests take a
 * day-old copy; the seal of today's decisions takes a fresh one (FRESH): with a day-old cache, on 09/11/2026, 21 of
 * the 41 FIIs were decided on the prices of three days before.
 */
async function loadHistories(engine, maxAgeMs = 24 * 3_600_000) {
	const out = {};
	for (const [ticker] of UNIVERSE) out[ticker] = await engine.fetchHistory(ticker, { maxAgeMs });
	for (const ticker of Object.values(MARKET_OF)) out[ticker] = await engine.fetchHistory(ticker, { maxAgeMs });
	return out;
}
const FRESH = 30 * 60_000;

const lastIndexUntil = (candles, date) => {
	let lo = 0;
	let hi = candles.length - 1;
	let found = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (candles[mid].date <= date) (found = mid), (lo = mid + 1);
		else hi = mid - 1;
	}
	return found;
};

// ---------------------------------------------------------------------------------------------------------- lacrar

/**
 * What the bot knows on `date` in one profile, for every asset: the histories cut there, and (since 0.0.2) the
 * evidence of each group and the state of each market, made only from those cut histories.
 */
function dayContext(engine, histories, date, profile) {
	if (!engine.poolEvidence) return null;
	if (engine.studyGroup && RATES) {
		// 0.0.3+: each group studied whole on the cut histories, with the rates cut too; the model learns only from
		// pictures whose future had already happened by `date`.
		const rates = engine.ratesUntil(RATES, date);
		const fundamentals = FUNDS && engine.fundamentalsUntil ? engine.fundamentalsUntil(FUNDS, date) : null;
		for (const reports of Object.values(fundamentals?.funds ?? {})) if (reports.some((r) => r.known > date)) throw new Error(`Vazou futuro nos relatórios da CVM ${date}`);
		const ctx = { cut: {}, prepared: {}, pools: {}, market: {}, models: {}, today: {}, rates };
		for (const kind of Object.keys(MARKET_OF)) {
			const hs = [];
			for (const [t, k] of UNIVERSE) {
				if (k !== kind) continue;
				ctx.cut[t] = engine.historyUntil(histories[t], date);
				if (ctx.cut[t].candles.length) hs.push(ctx.cut[t]);
			}
			ctx.market[kind] = engine.historyUntil(histories[MARKET_OF[kind]], date);
			const s = engine.studyGroup(hs, { profile, market: ctx.market[kind], rates, fundamentals });
			Object.assign(ctx.prepared, s.prepared);
			Object.assign(ctx.today, s.today);
			ctx.pools[kind] = s.pool;
			ctx.models[kind] = s.model;
		}
		return ctx;
	}
	const cut = {};
	const prepared = {};
	for (const [t] of UNIVERSE) {
		cut[t] = engine.historyUntil(histories[t], date);
		try {
			prepared[t] = engine.prepare(cut[t], profile);
		} catch {
			// Too short at this date.
		}
	}
	const pools = {};
	const market = {};
	for (const kind of Object.keys(MARKET_OF)) {
		pools[kind] = engine.poolEvidence(
			UNIVERSE.filter((u) => u[1] === kind && prepared[u[0]]).map((u) => prepared[u[0]]),
			profile
		);
		market[kind] = engine.historyUntil(histories[MARKET_OF[kind]], date);
	}
	return { cut, prepared, pools, market };
}

/** One decision of the bot at `date`, seeing only the history up to it; null when there is too little of it. */
function decisionAt(engine, history, date, p, [ticker, kind, segment], detailed, day) {
	const past = day?.cut[ticker] ?? engine.historyUntil(history, date);
	let r;
	try {
		r = engine.analyze(past, {
			profile: p.profile,
			mode: 'ponderada',
			kind,
			market: day?.market[kind] ?? null,
			pool: day?.pools[kind] ?? null,
			prepared: day?.prepared[ticker] ?? null,
			model: day?.models?.[kind] ?? null,
			picture: day?.today?.[ticker]?.x ?? null,
			// Everything the group's study knows of the asset today (the second opinion, since the draft of 09/11/2026).
			today: day?.today?.[ticker] ?? null,
			rates: day?.rates ?? null
		});
	} catch {
		return null;
	}
	if (r.asOf > date || past.candles.at(-1).date > date) throw new Error(`Vazou futuro em ${ticker} ${date}`);
	if (r.market && r.market.date > date) throw new Error(`Vazou futuro no mercado de ${ticker} ${date}`);
	if (day?.pools[kind] && day.pools[kind].asOf > date) throw new Error(`Vazou futuro na prova do grupo ${kind} ${date}`);
	if (day?.models?.[kind] && day.models[kind].trainedUntil > date) throw new Error(`Vazou futuro no modelo ${kind} ${date}`);
	if (day?.rates && day.rates.cdi.at(-1)?.[0] > date) throw new Error(`Vazou futuro nos juros ${date}`);
	const d = engine.decide(r);
	const decision = {
		version: engine.version,
		group: p.group,
		profile: p.profile,
		offset: p.offset,
		date,
		ticker,
		kind,
		segment,
		price: r.context.last,
		horizonDays: p.horizonDays,
		action: d.action,
		forced: d.forced,
		score: d.score,
		probUp: d.probUp,
		confidence: d.confidence,
		expected: d.expected,
		cone: r.projection?.final ?? null,
		scale: r.projection?.scale ?? 1,
		evidence: r.evidenceFrom?.kind ?? 'próprio',
		marketNow: r.market ? { ticker: r.market.ticker, trend: r.market.trend, turn: r.market.turn ?? null, volRatio: r.market.volRatio, agitated: r.market.agitated, change1m: r.market.change1m } : null,
		strategies: r.strategies.map((s) => ({ id: s.id, now: s.now, weight: s.weight })),
		// 0.0.3+: the learned chance (orders the top 10), and how its model checked out. What the chance is about:
		// 'cdi' (0.0.3, beat the CDI) or 'grupo' (0.0.4+, beat the average of the group).
		p: r.forecast?.p ?? null,
		raw: r.forecast?.raw ?? null,
		// Draft of 09/11/2026: the chance before the second opinion, and the second opinion itself (null before it).
		own: r.forecast?.own ?? null,
		second: r.forecast?.second ?? null,
		target: r.forecast ? (r.forecast.target ?? 'cdi') : null,
		modelConfidence: r.forecast?.confidence ?? null
	};
	if (detailed) {
		Object.assign(decision, {
			verdict: r.verdict.label,
			reasons: d.reasons,
			blockers: d.blockers,
			narrative: r.context.narrative,
			validation: { n: r.validation.n, hit: r.validation.hit, baseHit: r.validation.baseHit, edge: r.validation.edge },
			warnings: r.warnings
		});
	}
	return decision;
}

function writeSeal(engine, decisions, skipped, extra = {}) {
	const text = JSON.stringify(
		{ version: engine.version, rules: engine.RULES, ruleLines: engine.RULE_LINES ?? RULE_LINES_001, universe: UNIVERSE, recent: RECENT, series: withSeries ? SERIES : null, horizons: HORIZON_DAYS, ...extra, decisions },
		null,
		1
	);
	writeFileSync(join(folder, 'decisoes.json'), text);
	const info = {
		sealedAt: new Date().toISOString(),
		version: engine.version,
		decisionsSha256: sha256(text),
		engineSha256: dirHash(engine.dir),
		engineDir: engine.dir,
		engineFiles: engineFiles(engine.dir),
		count: decisions.length,
		skipped
	};
	writeFileSync(join(folder, 'lacre.json'), JSON.stringify(info, null, 1));
	console.log(`Lacre: ${info.decisionsSha256}\nMotor ${engine.version}: ${info.engineSha256}\nPasta: ${folder}\n`);
	return info;
}

const forcedWord = (f) => (f > 0 ? 'COMPRA' : f < 0 ? 'VENDA ' : 'NENHUM');
const decisionLine = (d) =>
	`  ${d.ticker.padEnd(7)} ${d.action.padEnd(14)} forçado ${forcedWord(d.forced)} nota ${d.score.toFixed(2).padStart(5)} chance de alta ${(d.probUp * 100).toFixed(0).padStart(3)}% confiança ${d.confidence}`;

async function seal() {
	const engine = await deciderEngine();
	openFolder(new Date().toISOString().slice(0, 10));
	refuseIfSealed();
	UNIVERSE = universeOf(engine);
	RATES = engine.fetchRates ? await engine.fetchRates() : null;
	FUNDS = engine.fetchFundamentals ? await engine.fetchFundamentals() : null;
	if (FUNDS) console.log(`Relatórios da CVM: ${Object.keys(FUNDS.funds).length} FIIs, lidos até ${FUNDS.until}.`);
	const histories = await loadHistories(current);
	const calendar = histories.HGLG11.candles.map((c) => c.date);
	const points = [];
	if (withRecent) for (const profile of RECENT.profiles) for (const offset of RECENT.offsets) points.push({ group: 'recente', profile, offset, horizonDays: HORIZON_DAYS[profile] });
	if (withSeries) {
		for (const profile of SERIES.profiles) {
			if (SERIES.since) {
				// A date range (--desde, --ate): one decision every SERIES.every trading days from the first date.
				const first = calendar.findIndex((d) => d >= SERIES.since);
				const last = SERIES.until ? calendar.findLastIndex((d) => d <= SERIES.until) : calendar.length - 1;
				for (let i = first; i >= 0 && i <= last; i += SERIES.every) points.push({ group: 'serie', profile, offset: calendar.length - 1 - i, horizonDays: HORIZON_DAYS[profile] });
			} else {
				for (let k = SERIES.from; k >= HORIZON_DAYS[profile]; k -= SERIES.every) points.push({ group: 'serie', profile, offset: k, horizonDays: HORIZON_DAYS[profile] });
			}
		}
	}

	const decisions = [];
	let skipped = 0;
	const started = Date.now();
	for (const [k, p] of points.entries()) {
		const date = calendar[calendar.length - 1 - p.offset];
		if (k % 20 === 0) console.log(`  ${k + 1}/${points.length} · ${p.profile} ${date} · ${((Date.now() - started) / 1000).toFixed(0)} s`);
		const day = dayContext(engine, histories, date, p.profile);
		for (const asset of UNIVERSE) {
			const decision = decisionAt(engine, histories[asset[0]], date, p, asset, p.group === 'recente', day);
			if (decision) decisions.push({ id: decisions.length + 1, ...decision });
			else skipped++;
		}
	}
	console.log(`${decisions.length} decisões do motor ${engine.version} lacradas em ${((Date.now() - started) / 1000).toFixed(0)} s (${skipped} pontos sem histórico suficiente).`);
	writeSeal(engine, decisions, skipped);
	const recent = decisions.filter((d) => d.group === 'recente');
	for (const profile of withRecent ? RECENT.profiles : []) {
		for (const offset of RECENT.offsets) {
			const list = recent.filter((d) => d.offset === offset && d.profile === profile);
			console.log(`${PROFILE_NAME[profile]}, decisões em ${list[0]?.date} (${offset} pregões atrás), sem saber o que veio depois:`);
			for (const d of list) console.log(decisionLine(d));
		}
	}
	if (withSeries) {
		const count = (a) => decisions.filter((d) => d.group === 'serie' && d.action === a).length;
		console.log(`\nSérie no passado: ${count('COMPRAR')} compras, ${count('VENDER')} vendas, ${count('FICAR DE FORA')} de fora.`);
	}
}

/** Business days after a date, holidays not counted: only to say roughly when a decision can be opened. */
function roughlyAfter(date, days) {
	const t = new Date(`${date}T12:00:00Z`);
	while (days > 0) {
		t.setUTCDate(t.getUTCDate() + 1);
		if (t.getUTCDay() % 6 !== 0) days--;
	}
	return t.toISOString().slice(0, 10);
}

/**
 * The test that cannot be contaminated: the bot decides on the last close, in each profile, and the decisions are
 * sealed until each horizon has passed. Nobody knows these results yet.
 */
async function sealFuture() {
	const engine = await deciderEngine();
	UNIVERSE = universeOf(engine);
	RATES = engine.fetchRates ? await engine.fetchRates() : null;
	FUNDS = engine.fetchFundamentals ? await engine.fetchFundamentals() : null;
	if (FUNDS) console.log(`Relatórios da CVM: ${Object.keys(FUNDS.funds).length} FIIs, lidos até ${FUNDS.until}.`);
	const histories = await loadHistories(current, FRESH);
	const calendar = histories.HGLG11.candles.map((c) => c.date);
	const date = calendar.at(-1);
	// Every asset decided on today's close: one still on an older close (no trade that day, or Yahoo late) is told.
	const behind = UNIVERSE.filter(([t]) => histories[t]?.candles.at(-1)?.date < date).map(([t]) => `${t} (${histories[t].candles.at(-1).date})`);
	if (behind.length) console.log(`Com dados mais antigos que ${date}: ${behind.join(', ')}`);
	openFolder(engine.version === FIRST_VERSION ? `futuro-${date}` : engine.version.startsWith('rascunho-') ? `futuro-${date}-${engine.version}` : `futuro-${date}-v${engine.version}`);
	refuseIfSealed();
	const decisions = [];
	let skipped = 0;
	for (const profile of SERIES.profiles) {
		const day = dayContext(engine, histories, date, profile);
		for (const asset of UNIVERSE) {
			const decision = decisionAt(engine, histories[asset[0]], date, { group: 'futuro', profile, offset: 0, horizonDays: HORIZON_DAYS[profile] }, asset, true, day);
			if (decision) decisions.push({ id: decisions.length + 1, ...decision, opensAround: roughlyAfter(date, HORIZON_DAYS[profile]) });
			else skipped++;
		}
	}
	console.log(`${decisions.length} decisões do motor ${engine.version} de ${date} lacradas para conferir no futuro (${skipped} sem histórico suficiente).`);
	writeSeal(engine, decisions, skipped, { future: { date } });
	for (const profile of SERIES.profiles) {
		const list = decisions.filter((d) => d.profile === profile);
		console.log(`${PROFILE_NAME[profile]}, abre por volta de ${list[0]?.opensAround}:`);
		if (list.some((d) => Number.isFinite(d.p))) {
			const top = [...list].sort((a, b) => b.p - a.p).slice(0, 10);
			console.log(`  Top 10 lacrado: ${top.map((d) => `${d.ticker} ${Math.round(d.p * 100)}%`).join(', ')}`);
		} else for (const d of list) console.log(decisionLine(d));
	}
}

// --------------------------------------------------------------------------------------------------------- revelar

async function cdiIndex(from) {
	const [y, m, d] = from.split('-');
	const today = new Date();
	const end = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
	const rows = await current.getJson(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial=${d}/${m}/${y}&dataFinal=${end}`);
	const points = rows.map((r) => {
		const [dd, mm, yy] = r.data.split('/');
		return [`${yy}-${mm}-${dd}`, Number(String(r.valor).replace(',', '.')) / 100];
	});
	let acc = 1;
	const index = points.map(([date, rate]) => [date, (acc *= 1 + rate)]);
	// The CDI of a day is earned overnight: from the close of `a` to the close of `b`, the days after a up to b.
	return (a, b) => {
		const at = (date) => {
			let v = 1;
			for (const [d, x] of index) {
				if (d > date) break;
				v = x;
			}
			return v;
		};
		return at(b) / at(a) - 1;
	};
}

function summarize(list) {
	const s = { n: list.length };
	if (!list.length) return s;
	const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
	const buys = list.filter((d) => d.action === 'COMPRAR');
	const sells = list.filter((d) => d.action === 'VENDER');
	const outs = list.filter((d) => d.action === 'FICAR DE FORA');
	const coned = list.filter((d) => d.cone && !d.partial);
	const opinion = list.filter((d) => d.forced !== 0);
	Object.assign(s, {
		forcedN: opinion.length,
		noOpinion: list.length - opinion.length,
		forcedHits: list.filter((d) => d.forcedHit).length,
		up: list.filter((d) => d.totalRet > 0).length,
		meanAll: mean(list.map((d) => d.totalRet)),
		meanCdi: mean(list.map((d) => d.cdi)),
		buys: buys.length,
		buyHits: buys.filter((d) => d.totalRet > 0).length,
		buyBeatCdi: buys.filter((d) => d.totalRet > d.cdi).length,
		buyBeatGroup: buys.filter((d) => d.totalRet > d.market).length,
		buyMean: mean(buys.map((d) => d.totalRet)),
		sells: sells.length,
		sellHits: sells.filter((d) => d.totalRet < 0).length,
		sellBetterCdi: sells.filter((d) => d.totalRet < d.cdi).length,
		sellMean: mean(sells.map((d) => d.totalRet)),
		outs: outs.length,
		outMean: mean(outs.map((d) => d.totalRet)),
		coned: coned.length,
		cone50: coned.filter((d) => d.inside50).length / (coned.length || 1),
		cone90: coned.filter((d) => d.inside90).length / (coned.length || 1),
		forcedUpMean: mean(list.filter((d) => d.forced === 1).map((d) => d.totalRet)),
		forcedDownMean: mean(list.filter((d) => d.forced === -1).map((d) => d.totalRet)),
		forcedUp: list.filter((d) => d.forced === 1).length,
		forcedDown: list.filter((d) => d.forced === -1).length,
		forcedUpHits: list.filter((d) => d.forced === 1 && d.forcedHit).length,
		forcedDownHits: list.filter((d) => d.forced === -1 && d.forcedHit).length
	});
	return s;
}

function calibration(list) {
	const bins = [
		[0, 0.4],
		[0.4, 0.5],
		[0.5, 0.6],
		[0.6, 1.01]
	];
	return bins.map(([lo, hi]) => {
		const inBin = list.filter((d) => d.probUp >= lo && d.probUp < hi);
		return { lo, hi, n: inBin.length, predicted: inBin.reduce((s, d) => s + d.probUp, 0) / (inBin.length || 1), realized: inBin.filter((d) => d.priceRet > 0).length / (inBin.length || 1) };
	});
}

function strategyStudy(list) {
	return STRATEGIES.map((s) => {
		const all = list.map((d) => ({ d, st: d.strategies.find((x) => x.id === s.id) })).filter(({ st }) => st && st.now !== 0);
		const counted = all.filter(({ st }) => st.weight > 0);
		const rate = (xs) => ({ n: xs.length, hit: xs.filter(({ d, st }) => Math.sign(d.totalRet) === st.now).length / (xs.length || 1) });
		const r = rate(all);
		// The base for the same mix: how often the asset went the way the signal said by chance (mostly up).
		const upShare = list.filter((d) => d.totalRet > 0).length / list.length;
		const longs = all.filter(({ st }) => st.now > 0).length;
		const baseHit = all.length ? (longs * upShare + (all.length - longs) * (1 - upShare)) / all.length : NaN;
		return { id: s.id, name: s.name, n: r.n, hit: r.hit, baseHit, counted: rate(counted) };
	});
}

/**
 * The test of the top 10 (0.0.3+, decisions that carry the learned chance p): on each date of each profile, the
 * assets are ordered by p; the 10 best overall (and the 10 best FIIs, the 5 best stocks) are compared with all of
 * them and with the CDI, by the return with dividends minus the CDI over the horizon. Also the calibration of p
 * (when it said X%, how often the asset did what it was about: beat the CDI, or since 0.0.4 beat the average of its
 * group) and the top 10 sealed for the future.
 */
function rankingStudy(opened, all) {
	const withP = opened.filter((d) => Number.isFinite(d.p) && Number.isFinite(d.cdi));
	const sealed = all.filter((d) => d.pending && Number.isFinite(d.p));
	if (!withP.length && !sealed.length) return null;
	const excess = (d) => d.totalRet - d.cdi;
	const mean = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : NaN);
	const share = (ds) => (ds.length ? ds.filter((d) => excess(d) > 0).length / ds.length : NaN);
	const shareOf = (ds, ok) => (ds.length ? ds.filter(ok).length / ds.length : NaN);
	const target = withP.find((d) => d.target)?.target ?? sealed.find((d) => d.target)?.target ?? 'cdi';
	const hit = (d) => (target === 'grupo' ? d.beatGroup : excess(d) > 0);
	const out = { target, profiles: [] };
	for (const profile of SERIES.profiles) {
		const list = withP.filter((d) => d.profile === profile);
		const byDate = new Map();
		for (const d of list) {
			if (!byDate.has(d.date)) byDate.set(d.date, []);
			byDate.get(d.date).push(d);
		}
		const periods = [...byDate.entries()]
			.sort((a, b) => (a[0] < b[0] ? -1 : 1))
			.map(([date, ds]) => {
				const sorted = [...ds].sort((a, b) => b.p - a.p);
				const top = sorted.slice(0, 10);
				const fii = sorted.filter((d) => d.kind === 'FII');
				const acao = sorted.filter((d) => d.kind === 'Ação');
				return {
					date,
					n: ds.length,
					all: mean(ds.map(excess)),
					allShare: share(ds),
					top: mean(top.map(excess)),
					topShare: share(top),
					bottom: mean(sorted.slice(-10).map(excess)),
					fiiAll: mean(fii.map(excess)),
					fiiTop: fii.length >= 10 ? mean(fii.slice(0, 10).map(excess)) : NaN,
					acaoAll: mean(acao.map(excess)),
					acaoTop: acao.length >= 5 ? mean(acao.slice(0, 5).map(excess)) : NaN,
					picks: top.map((d) => ({ t: d.ticker, p: d.p, e: excess(d) }))
				};
			});
		const summary = (ps) => {
			const spread = ps.map((x) => x.top - x.all);
			const sd = Math.sqrt(mean(spread.map((v) => (v - mean(spread)) ** 2)) * (spread.length / Math.max(1, spread.length - 1)));
			const fiiSpread = ps.filter((x) => Number.isFinite(x.fiiTop)).map((x) => x.fiiTop - x.fiiAll);
			const acaoSpread = ps.filter((x) => Number.isFinite(x.acaoTop)).map((x) => x.acaoTop - x.acaoAll);
			return {
				periods: ps.length,
				top: mean(ps.map((x) => x.top)),
				all: mean(ps.map((x) => x.all)),
				bottom: mean(ps.map((x) => x.bottom)),
				spread: mean(spread),
				spreadT: spread.length > 1 && sd > 0 ? mean(spread) / (sd / Math.sqrt(spread.length)) : NaN,
				topWon: ps.length ? spread.filter((v) => v > 0).length / ps.length : NaN,
				topShare: mean(ps.map((x) => x.topShare)),
				allShare: mean(ps.map((x) => x.allShare)),
				fiiSpread: mean(fiiSpread),
				fiiWon: fiiSpread.length ? fiiSpread.filter((v) => v > 0).length / fiiSpread.length : NaN,
				acaoSpread: mean(acaoSpread),
				acaoWon: acaoSpread.length ? acaoSpread.filter((v) => v > 0).length / acaoSpread.length : NaN
			};
		};
		const years = [...new Set(periods.map((x) => x.date.slice(0, 4)))].sort();
		const buckets = [
			[0, 0.4],
			[0.4, 0.5],
			[0.5, 0.6],
			[0.6, 1.01]
		].map(([lo, hi]) => {
			const inB = list.filter((d) => d.p >= lo && d.p < hi);
			return { lo, hi, n: inB.length, said: mean(inB.map((d) => d.p)), beat: shareOf(inB, hit), beatCdi: share(inB), beatGroup: shareOf(inB, (d) => d.beatGroup) };
		});
		const future = sealed.filter((d) => d.profile === profile);
		out.profiles.push({
			profile,
			target,
			name: PROFILE_NAME[profile],
			all: summary(periods),
			byYear: years.map((y) => ({ year: y, ...summary(periods.filter((x) => x.date.startsWith(y))) })),
			calibration: buckets,
			periods: periods.map(({ picks, ...rest }) => ({ ...rest, picks })),
			sealedTop: future.length
				? {
						date: future[0].date,
						opensAround: future[0].opensAround,
						top: [...future]
							.sort((a, b) => b.p - a.p)
							.slice(0, 10)
							.map((d) => ({ t: d.ticker, p: d.p, kind: d.kind, segment: d.segment, action: d.action }))
					}
				: null
		});
	}
	return out;
}

const recentConfig = (stored) => {
	const r = stored.recent ?? RECENT;
	return { profiles: r.profiles ?? [r.profile ?? 'swing'], offsets: r.offsets ?? [] };
};

async function reveal() {
	openFolder(new Date().toISOString().slice(0, 10));
	const text = readFileSync(join(folder, 'decisoes.json'), 'utf8');
	const sealInfo = JSON.parse(readFileSync(join(folder, 'lacre.json'), 'utf8'));
	if (sha256(text) !== sealInfo.decisionsSha256) throw new Error('As decisões foram mexidas depois do lacre: o experimento não vale.');
	const frozen = knownVersions().find((k) => k.hash === sealInfo.engineSha256);
	const stored = JSON.parse(text);
	const { decisions, horizons } = stored;
	UNIVERSE = stored.universe ?? LEGACY_UNIVERSE;
	const recentCfg = recentConfig(stored);
	const histories = await loadHistories(current);
	const calendar = histories.HGLG11.candles.map((c) => c.date);
	// A decision whose horizon goes past the last close: the future test stays sealed; the recent test is measured
	// up to the last close and marked partial.
	const status = (d) => {
		const at = calendar.indexOf(d.date);
		if (at >= 0 && at + d.horizonDays <= calendar.length - 1) return { at, days: d.horizonDays, partial: false };
		if (d.group === 'recente' && at >= 0 && at < calendar.length - 1) return { at, days: calendar.length - 1 - at, partial: true };
		return null;
	};
	const toOpen = decisions.filter((d) => status(d));
	let cdi = () => NaN;
	if (toOpen.length) {
		try {
			cdi = await cdiIndex(toOpen.reduce((m, d) => (d.date < m ? d.date : m), '9999'));
		} catch (error) {
			console.log(`Sem o CDI do Banco Central (${error.message}): a coluna do CDI fica vazia.`);
		}
	}

	const windowReturn = (ticker, from, to) => {
		const cs = histories[ticker]?.candles;
		if (!cs) return NaN;
		const a = cs[lastIndexUntil(cs, from)];
		const b = cs[lastIndexUntil(cs, to)];
		return a && b ? b.a / a.a - 1 : NaN;
	};

	for (const d of decisions) {
		const st = status(d);
		if (!st) {
			d.pending = true;
			continue;
		}
		const cs = histories[d.ticker].candles;
		const i0 = lastIndexUntil(cs, d.date);
		const endDate = calendar[st.at + st.days];
		const i1 = lastIndexUntil(cs, endDate);
		const c0 = cs[i0];
		const c1 = cs[i1];
		d.checkDays = st.days;
		d.partial = st.partial;
		d.endDate = c1.date;
		d.endPrice = c1.c;
		d.priceRet = c1.c / c0.c - 1;
		d.totalRet = c1.a / c0.a - 1;
		d.cdi = cdi(c0.date, c1.date);
		d.index = windowReturn(MARKET_OF[d.kind], c0.date, c1.date);
		let low = Infinity;
		let high = -Infinity;
		for (let i = i0 + 1; i <= i1; i++) (low = Math.min(low, cs[i].l)), (high = Math.max(high, cs[i].h));
		d.worst = low / c0.c - 1;
		d.best = high / c0.c - 1;
		d.forcedHit = d.forced === 0 ? null : d.totalRet !== 0 && Math.sign(d.totalRet) === d.forced;
		d.actionHit = d.action === 'COMPRAR' ? d.totalRet > 0 : d.action === 'VENDER' ? d.totalRet < 0 : null;
		// A cone drawn for the whole horizon says little about a partial window: it is only checked at the end.
		if (d.cone && !d.partial) {
			d.inside50 = c1.c >= d.cone.p25 && c1.c <= d.cone.p75;
			d.inside90 = c1.c >= d.cone.p5 && c1.c <= d.cone.p95;
		}
		if (d.reasons) {
			const from = Math.max(0, i0 - 60);
			d.path = cs.slice(from, i1 + 1).map((c) => c.c);
			d.pathDecision = i0 - from;
		}
	}
	const opened = decisions.filter((d) => !d.pending);
	// The market on the same window: the average of the other assets of the same kind, to tell a wrong call on
	// the asset from a move of everything at once.
	const peersOf = new Map();
	for (const d of opened) {
		const key = `${d.group}|${d.profile}|${d.date}|${d.kind}`;
		if (!peersOf.has(key)) peersOf.set(key, []);
		peersOf.get(key).push(d);
	}
	for (const peers of peersOf.values()) {
		const mean = peers.reduce((s, x) => s + x.totalRet, 0) / peers.length;
		for (const d of peers) {
			d.market = mean;
			d.beatGroup = d.totalRet > mean;
			// 0.0.4+: the forced side is "better or worse than the others", so it is scored against them.
			if (d.target === 'grupo' && d.forced !== 0) d.forcedHit = d.totalRet !== mean && Math.sign(d.totalRet - mean) === d.forced;
		}
	}

	const recent = opened.filter((d) => d.group === 'recente');
	const series = opened.filter((d) => d.group === 'serie');
	const future = decisions.filter((d) => d.group === 'futuro');
	const results = {
		version: stored.version ?? frozen?.version ?? FIRST_VERSION,
		ruleLines: stored.ruleLines ?? RULE_LINES_001,
		comparedWith: option('comparar'),
		recentConfig: recentCfg,
		future: future.length
			? SERIES.profiles.map((p) => {
					const list = future.filter((d) => d.profile === p);
					const open = list.filter((d) => !d.pending);
					return { profile: p, name: PROFILE_NAME[p], pending: list.length - open.length, opensAround: list[0]?.opensAround, all: summarize(open) };
				})
			: null,
		seal: sealInfo,
		engineUnchanged: Boolean(frozen),
		engineVersion: frozen?.version ?? null,
		revealedAt: new Date().toISOString(),
		horizons,
		recent: {
			all: summarize(recent),
			byProfile: recentCfg.profiles.map((p) => ({ profile: p, name: PROFILE_NAME[p], ...summarize(recent.filter((d) => d.profile === p)) })),
			byDate: recentCfg.offsets.map((o) => ({ offset: o, date: recent.find((d) => d.offset === o)?.date, ...summarize(recent.filter((d) => d.offset === o)) })),
			byKind: ['FII', 'Ação'].map((k) => ({ kind: k, ...summarize(recent.filter((d) => d.kind === k)) })),
			strategies: strategyStudy(recent)
		},
		series: SERIES.profiles.map((p) => {
			const list = series.filter((d) => d.profile === p);
			const years = [...new Set(list.map((d) => d.date.slice(0, 4)))].sort();
			return {
				profile: p,
				name: PROFILE_NAME[p],
				all: summarize(list),
				byKind: ['FII', 'Ação'].map((k) => ({ kind: k, ...summarize(list.filter((d) => d.kind === k)) })),
				byYear: years.map((y) => ({ year: y, ...summarize(list.filter((d) => d.date.startsWith(y))) })),
				byConfidence: ['baixa', 'média', 'alta'].map((c) => ({ confidence: c, ...summarize(list.filter((d) => d.confidence === c)) })),
				calibration: calibration(list),
				strategies: strategyStudy(list)
			};
		}),
		ranking: rankingStudy(opened, decisions),
		decisions
	};
	writeFileSync(join(folder, 'resultados.json'), JSON.stringify(results, null, 1));
	printSummary(results);
	writeReport(results);
}

// --------------------------------------------------------------------------------------------------------- saída

const P = (v, d = 1) => (Number.isFinite(v) ? `${v > 0 ? '+' : ''}${(v * 100).toFixed(d).replace('.', ',')}%` : '—');
const R = (k, n) => (n ? `${((k / n) * 100).toFixed(0)}%` : '—');

function printSummary(res) {
	const line = (label, s) =>
		console.log(
			`${label.padEnd(26)} n=${String(s.n).padStart(4)} | forçado acertou ${R(s.forcedHits, s.forcedN ?? s.n).padStart(4)} de ${String(s.forcedN ?? s.n).padStart(3)} (subiu ${R(s.up, s.n).padStart(4)}) | COMPRAR ${String(s.buys).padStart(3)} acerto ${R(s.buyHits, s.buys).padStart(4)} média ${P(s.buyMean).padStart(6)} | VENDER ${String(s.sells).padStart(3)} acerto ${R(s.sellHits, s.sells).padStart(4)} média ${P(s.sellMean).padStart(6)} | todos ${P(s.meanAll).padStart(6)} CDI ${P(s.meanCdi)} | cone 50% ${s.coned ? R(s.cone50 * 100, 100) : '—'} 90% ${s.coned ? R(s.cone90 * 100, 100) : '—'}`
		);
	console.log(`Lacre conferido. Motor que decidiu: ${res.engineUnchanged ? `versão ${res.engineVersion}, congelada e igual ao lacre` : 'NÃO confere com nenhuma versão congelada'}\n`);
	if (res.recent.all.n) {
		line('Recente (todas)', res.recent.all);
		for (const b of res.recent.byProfile ?? []) line(`  ${b.name}`, b);
		for (const b of res.recent.byKind) line(`  ${b.kind}`, b);
	}
	for (const s of res.series) {
		if (!s.all.n) continue;
		line(`Série ${s.name}`, s.all);
		for (const b of s.byKind) line(`  ${b.kind}`, b);
		for (const b of s.byConfidence) line(`  confiança ${b.confidence}`, b);
	}
	for (const f of res.future ?? []) {
		if (f.all.n) line(`Futuro ${f.name}`, f.all);
		if (f.pending) console.log(`Futuro ${f.name}: ${f.pending} decisões ainda lacradas, abrem por volta de ${f.opensAround}.`);
	}
}

/** The two reports (lite and advanced) are drawn by relatorio.mjs. */
function writeReport(res) {
	const out = writeReports(res, {
		folder,
		base,
		summarize,
		profileName: PROFILE_NAME,
		strategyName: (id) => STRATEGIES.find((s) => s.id === id)?.name ?? id,
		firstVersion: FIRST_VERSION
	});
	console.log(`\nRelatórios:\n  ${out.lite}\n  ${out.advanced}`);
}

// ------------------------------------------------------------------------------------------ the future, added up

const experimentsDir = join(base, 'experimentos');
const opened = (name) => {
	try {
		return JSON.parse(readFileSync(join(experimentsDir, name, 'resultados.json'), 'utf8'));
	} catch {
		return null;
	}
};

/** Opens again every test with something sealed or partial (and every sealed one never opened): what is due comes out. */
function updateAll() {
	const self = fileURLToPath(import.meta.url);
	for (const name of readdirSync(experimentsDir).sort()) {
		if (!existsSync(join(experimentsDir, name, 'lacre.json'))) continue;
		const r = opened(name);
		if (r && !r.decisions.some((d) => d.pending || d.partial)) continue;
		const extra = r?.comparedWith ? ['--comparar', r.comparedWith] : [];
		console.log(`\n== ${name}`);
		try {
			const out = execFileSync(process.execPath, [self, 'revelar', '--pasta', name, ...extra], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
			console.log(out.trim().split('\n').filter((l) => /lacradas|Futuro|Lacre conferido/.test(l)).join('\n'));
		} catch (error) {
			console.log(`Falhou: ${String(error.message).split('\n')[0]}`);
		}
	}
}

/**
 * The clean proof, added up: every future test of the same engine (one sealed each week), each date's top 10
 * against all, and the 10 best FIIs against all the FIIs (where 0.0.4 and 0.0.5 separated best in the past, in 1
 * week: a lead that only the future can confirm).
 */
function addUpFuture() {
	const byEngine = new Map();
	for (const name of readdirSync(experimentsDir).filter((n) => n.startsWith('futuro-')).sort()) {
		const r = opened(name);
		if (!r) continue;
		const list = r.decisions.filter((d) => !d.pending && !d.partial && Number.isFinite(d.p) && Number.isFinite(d.totalRet));
		if (!byEngine.has(r.version)) byEngine.set(r.version, { tests: [], decisions: [] });
		const e = byEngine.get(r.version);
		e.tests.push({ name, date: r.decisions[0]?.date, open: list.length, sealed: r.decisions.filter((d) => d.pending).length });
		e.decisions.push(...list);
	}
	const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
	const tOf = (xs) => {
		if (xs.length < 2) return NaN;
		const m = mean(xs);
		const sd = Math.sqrt(xs.reduce((a, v) => a + (v - m) ** 2, 0) / (xs.length - 1));
		return sd > 0 ? m / (sd / Math.sqrt(xs.length)) : NaN;
	};
	const out = { madeAt: new Date().toISOString(), engines: [] };
	for (const [version, e] of byEngine) {
		const profiles = [];
		for (const profile of SERIES.profiles) {
			const dates = [...new Set(e.decisions.filter((d) => d.profile === profile).map((d) => d.date))].sort();
			const rows = dates.map((date) => {
				const ds = e.decisions.filter((d) => d.profile === profile && d.date === date).sort((a, b) => b.p - a.p);
				const fii = ds.filter((d) => d.kind === 'FII');
				return { date, top: mean(ds.slice(0, 10).map((d) => d.totalRet)) - mean(ds.map((d) => d.totalRet)), fii: fii.length >= 10 ? mean(fii.slice(0, 10).map((d) => d.totalRet)) - mean(fii.map((d) => d.totalRet)) : NaN };
			});
			const top = rows.map((x) => x.top);
			const fii = rows.map((x) => x.fii).filter(Number.isFinite);
			profiles.push({ profile, dates: rows.length, top: mean(top), topT: tOf(top), topWon: top.filter((v) => v > 0).length, fii: mean(fii), fiiT: tOf(fii), fiiWon: fii.filter((v) => v > 0).length, rows });
		}
		out.engines.push({ version, tests: e.tests, profiles });
	}
	writeFileSync(join(experimentsDir, 'futuro-acumulado.json'), JSON.stringify(out, null, 1));
	const P = (v) => (Number.isFinite(v) ? `${v > 0 ? '+' : ''}${(v * 100).toFixed(2).replace('.', ',')}%` : '—');
	for (const e of out.engines) {
		console.log(`\nMotor ${e.version}: ${e.tests.length} teste(s) do futuro, ${e.tests.reduce((a, t) => a + t.sealed, 0)} decisões ainda lacradas`);
		for (const p of e.profiles) {
			if (!p.dates) continue;
			console.log(`  ${PROFILE_NAME[p.profile].padEnd(22)} ${String(p.dates).padStart(3)} data(s) | Top 10 − todos ${P(p.top)} (t ${Number.isFinite(p.topT) ? p.topT.toFixed(2) : '—'}, ganhou ${p.topWon}) | 10 melhores FIIs − todos os FIIs ${P(p.fii)} (t ${Number.isFinite(p.fiiT) ? p.fiiT.toFixed(2) : '—'}, ganhou ${p.fiiWon})`);
		}
	}
	console.log(`\n${join(experimentsDir, 'futuro-acumulado.json')}`);
}

if (step === 'congelar') freeze();
else if (step === 'atualizar') updateAll();
else if (step === 'acumulado') addUpFuture();
else if (step === 'lacrar') await seal();
else if (step === 'lacrar-futuro') await sealFuture();
else if (step === 'revelar') await reveal();
else if (step === 'relatorio') {
	openFolder(new Date().toISOString().slice(0, 10));
	const res = JSON.parse(readFileSync(join(folder, 'resultados.json'), 'utf8'));
	if (option('comparar')) res.comparedWith = option('comparar');
	writeReport(res);
} else console.log('Use: node ferramentas/experimento.mjs congelar | lacrar | lacrar-futuro | revelar | relatorio | atualizar | acumulado [--versao X] [--pasta <nome>] [--comparar <pasta>]');
