// The robot's journal on the computer (Rhuan, 10/11/2026: "ao fazer o relatório, no dia que executar, ele mapeia
// novamente e diz depois se acertou e errou, com isso melhora a análise e tenta de novo no próximo dia").
//
//   node ferramentas/diario.mjs passado [--desde 2019-01-02]
//        lives every trading day from that date up to the day before the last close, with the frozen engine and
//        every history cut at each day, and seals them: the past, lived one day at a time ("treinado do passado")
//   node ferramentas/diario.mjs revelar-passado
//        opens the past: what followed each day, the lesson of each day from what had followed by then, and the
//        test fixed in plano.md before (once: the verdict is never written again)
//   node ferramentas/diario.mjs hoje
//        the day of the last close: lives it, corrects it with today's lesson, seals it; scores every sealed day
//        whose horizon has passed; writes licao.json (what the app reads) and the two reports. Run every weekday
//        after the close by the task "PraiaVelas: robô do dia".
//   node ferramentas/diario.mjs herdar --de rascunho-xxxxxxxx
//        a new engine whose chances are the same (only what is shown changed, like the price range) inherits the
//        old engine's journal, after checking on three days that both give exactly the same chances
//   node ferramentas/diario.mjs relatorio      only redraws the two reports
//   node ferramentas/diario.mjs conferir       checks every seal
//   [--versao rascunho-xxxxxxxx]               the frozen engine (default: the frozen copy of app/motor)
//
// Everything is kept in D:\Projetos\PraiaVelas\diario\<engine> (PRAIAVELAS_SAIDA changes the base), never in the
// Google Drive. A sealed day is never written again: a day that was missed is lived later and marked late
// (refeito), and it does not count in the proof, only in the lesson.

import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { addUp, briefScore as brief, finalOf, HORIZON_WORD, lessonForApp, lessonsAt, liveDays, precisionOf, PROFILE_IDS, recordsOf, scoreFinal, verdictOf } from './diario-nucleo.mjs';

const base = process.env.PRAIAVELAS_SAIDA ?? 'D:\\Projetos\\PraiaVelas';
const args = process.argv.slice(2);
const step = args[0];
const option = (name) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : null);

// ------------------------------------------------------------------------------------------------------ engine

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const appEngineDir = fileURLToPath(new URL('../app/motor/', import.meta.url));
const versionsDir = join(base, 'versoes');
const engineFiles = (dir) => readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
const dirHash = (dir) => sha256(engineFiles(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n'));

/** The frozen engine that keeps the journal: never the code that may still change. */
async function frozenEngine() {
	const known = existsSync(versionsDir) ? readdirSync(versionsDir).filter((v) => existsSync(join(versionsDir, v, 'motor'))) : [];
	const now = dirHash(appEngineDir);
	const version = option('versao') ?? known.find((v) => dirHash(join(versionsDir, v, 'motor')) === now);
	if (!version) throw new Error('O motor do app não está congelado. Rode: node ferramentas/experimento.mjs congelar');
	const dir = join(versionsDir, version, 'motor');
	if (!existsSync(join(dir, 'diario.js'))) throw new Error(`O motor ${version} não tem o diário (diario.js).`);
	const at = (f) => import(pathToFileURL(join(dir, f)).href);
	const [armazem, analise, dados, robo, mercado, diario] = await Promise.all(['armazem.js', 'analise.js', 'dados.js', 'robo.js', 'mercado.js', 'diario.js'].map(at));
	const cacheDir = join(base, 'cache');
	mkdirSync(cacheDir, { recursive: true });
	const fileOf = (key) => join(cacheDir, `${key.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
	armazem.useStore({ get: (k) => (existsSync(fileOf(k)) ? readFileSync(fileOf(k), 'utf8') : null), set: (k, raw) => writeFileSync(fileOf(k), raw) });
	return { version, dir, hash: dirHash(dir), analise, dados, decide: robo.decide, GROUPS: mercado.GROUPS, diario };
}

/** The histories of both groups and their index funds; fresh (half an hour) for today, a day old for the past. */
async function loadHistories(engine, maxAgeMs) {
	const out = {};
	for (const g of Object.values(engine.GROUPS)) {
		for (const t of [...g.members, g.market]) {
			try {
				out[t] = await engine.dados.fetchHistory(t, { maxAgeMs });
			} catch (error) {
				console.log(`Sem ${t}: ${error.message}`);
			}
		}
	}
	return out;
}
const FRESH = 30 * 60_000;
const DAY_OLD = 24 * 3_600_000;

// ------------------------------------------------------------------------------------------------------ files

let engine = null;
let folder = null;
const pastDir = () => join(folder, 'passado');
const daysDir = () => join(folder, 'dias');
const readJson = (path, fallback = null) => {
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch {
		return fallback;
	}
};
const localDate = () => {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dateBr = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
const P = (v, d = 1) => (Number.isFinite(v) ? `${v > 0 ? '+' : ''}${(v * 100).toFixed(d).replace('.', ',')}%` : '—');

async function open() {
	engine = await frozenEngine();
	folder = join(base, 'diario', engine.version);
	mkdirSync(daysDir(), { recursive: true });
	mkdirSync(pastDir(), { recursive: true });
	writeFileSync(join(base, 'diario', 'atual.json'), JSON.stringify({ engine: engine.version, folder }, null, 1));
}

/** The sealed past (passado/entradas.json), checked against its seal. */
function readPast() {
	const file = join(pastDir(), 'entradas.json');
	if (!existsSync(file)) return null;
	const text = readFileSync(file, 'utf8');
	const seal = readJson(join(pastDir(), 'lacre.json'));
	if (!seal || sha256(text) !== seal.entriesSha256) throw new Error('O passado do diário foi mexido depois do lacre: não vale.');
	return JSON.parse(text);
}

/** Every sealed day of the journal (dias/), each checked against the seal registry. */
function readDays() {
	const seals = new Map();
	const registry = join(folder, 'lacres.jsonl');
	if (existsSync(registry)) for (const line of readFileSync(registry, 'utf8').split('\n').filter(Boolean)) seals.set(JSON.parse(line).date, JSON.parse(line));
	const out = [];
	for (const f of readdirSync(daysDir()).filter((x) => x.endsWith('.json')).sort()) {
		const text = readFileSync(join(daysDir(), f), 'utf8');
		const day = JSON.parse(text);
		const seal = seals.get(day.date);
		if (!seal || seal.sha256 !== sha256(text)) throw new Error(`O dia ${day.date} do diário foi mexido depois do lacre: não vale.`);
		out.push(day);
	}
	return out;
}

// ------------------------------------------------------------------------------------------------------ passado

async function livePast() {
	await open();
	if (existsSync(join(pastDir(), 'lacre.json'))) throw new Error(`O passado do diário do motor ${engine.version} já está lacrado em ${pastDir()}.`);
	if (!existsSync(join(folder, 'plano.md'))) throw new Error(`Falta o plano (${join(folder, 'plano.md')}): ele é escrito antes de viver o passado.`);
	const histories = await loadHistories(engine, FRESH);
	const calendar = histories.HGLG11.candles.map((c) => c.date);
	const since = option('desde') ?? '2019-01-02';
	// The last close is the journal's first day of its own ("hoje"): the past stops the day before.
	const dates = calendar.filter((d) => d >= since && d < calendar.at(-1));
	console.log(`Vivendo ${dates.length} pregões de ${dateBr(dates[0])} a ${dateBr(dates.at(-1))} com o motor ${engine.version}, cada um só com os dados até ele…`);
	const started = Date.now();
	const entries = await liveDays(engine.dir, histories, dates, {
		onEntry: (e, k, n) => k % 100 === 0 && console.log(`  ${k}/${n} · ${((Date.now() - started) / 1000).toFixed(0)} s`)
	});
	const text = JSON.stringify({ engine: engine.version, logic: engine.analise.MODEL_LOGIC, computedAt: new Date().toISOString(), from: dates[0], to: dates.at(-1), entries });
	writeFileSync(join(pastDir(), 'entradas.json'), text);
	const seal = { sealedAt: new Date().toISOString(), engine: engine.version, engineSha256: engine.hash, entriesSha256: sha256(text), days: entries.length, from: dates[0], to: dates.at(-1) };
	writeFileSync(join(pastDir(), 'lacre.json'), JSON.stringify(seal, null, 1));
	console.log(`${entries.length} pregões vividos e lacrados em ${((Date.now() - started) / 60000).toFixed(1)} min.\nLacre: ${seal.entriesSha256}\nMotor ${engine.version}: ${engine.hash}`);
}

/**
 * The past opened: each day corrected by its own lesson (learned only from the days whose horizon had passed by
 * then), scored, and the test of plano.md decided. Written once.
 */
async function revealPast() {
	await open();
	if (existsSync(join(pastDir(), 'veredito.json'))) throw new Error(`O teste do passado já foi aberto (${join(pastDir(), 'veredito.json')}): ele só vale uma vez.`);
	const past = readPast();
	if (!past) throw new Error('O passado ainda não foi vivido. Rode: node ferramentas/diario.mjs passado');
	const seal = readJson(join(pastDir(), 'lacre.json'));
	if (seal.engineSha256 !== engine.hash) throw new Error('O motor que viveu o passado não é o congelado agora.');
	const histories = await loadHistories(engine, DAY_OLD);
	const calendar = histories.HGLG11.candles.map((c) => c.date);
	const place = new Map(calendar.map((d, i) => [d, i]));
	const until = calendar.length - 1;
	const records = recordsOf(past.entries, histories, calendar, until, engine.diario);
	const started = Date.now();
	const scores = Object.fromEntries(PROFILE_IDS.map((p) => [p, []]));
	const path = Object.fromEntries(PROFILE_IDS.map((p) => [p, { FII: [], Ação: [] }]));
	let lastMonth = '';
	for (const [k, e] of past.entries.entries()) {
		const at = place.get(e.date);
		if (at === undefined) continue;
		const lessons = lessonsAt(records, at, engine.diario);
		const final = finalOf(e, lessons, engine, engine.diario);
		for (const p of PROFILE_IDS) {
			const s = scoreFinal(e, final, histories, calendar, at, until, p, engine.diario);
			if (s) scores[p].push(s);
		}
		// The lesson as it stood at the start of each month, for the report's chart.
		if (e.date.slice(0, 7) !== lastMonth) {
			lastMonth = e.date.slice(0, 7);
			for (const p of PROFILE_IDS) for (const kind of ['FII', 'Ação']) if (lessons[p][kind]) path[p][kind].push({ d: e.date, beta: lessons[p][kind].beta, alpha: lessons[p][kind].alpha - lessons[p][kind].centre });
		}
		if (k % 200 === 0) console.log(`  ${k + 1}/${past.entries.length} · ${e.date} · ${((Date.now() - started) / 1000).toFixed(0)} s`);
	}
	const results = summarizePast(scores, path, past);
	writeFileSync(join(pastDir(), 'resultados.json'), JSON.stringify(results));
	const verdict = decideTest(results);
	writeFileSync(join(pastDir(), 'veredito.json'), JSON.stringify(verdict, null, 1));
	printPast(results, verdict);
	await refresh(histories);
}

const mean = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : NaN);

/** The past's numbers: by profile, whole and by year, with and without the lesson. */
function summarizePast(scores, path, past) {
	const out = { madeAt: new Date().toISOString(), engine: engine.version, from: past.from, to: past.to, profiles: {} };
	for (const p of PROFILE_IDS) {
		const list = scores[p];
		const h = engine.diario.JOURNAL_HORIZON[p];
		const loss = (ls, k) => ls.reduce((s, x) => s + x.loss[k], 0) / Math.max(1, ls.reduce((s, x) => s + x.loss.n, 0));
		const kindLoss = (kind, k) => list.reduce((s, x) => s + (x.byKind[kind]?.[k] ?? 0), 0) / Math.max(1, list.reduce((s, x) => s + (x.byKind[kind]?.n ?? 0), 0));
		const pack = (key) => ({ n: list.reduce((s, x) => s + x[key].n, 0), beat: list.reduce((s, x) => s + x[key].beat, 0) });
		const kindPack = (kind, key) => ({ n: list.reduce((s, x) => s + (x.byKind[kind]?.[key].n ?? 0), 0), beat: list.reduce((s, x) => s + (x.byKind[kind]?.[key].beat ?? 0), 0) });
		const years = [...new Set(list.map((s) => s.date.slice(0, 4)))].sort();
		const piece = (ls) => ({ ...addUp(ls, h), lossLesson: loss(ls, 'lesson'), lossRaw: loss(ls, 'raw'), topDiff: mean(ls.map((s) => s.top.mean - s.topRaw.mean)) });
		out.profiles[p] = {
			profile: p,
			all: piece(list),
			byYear: years.map((y) => ({ year: y, ...piece(list.filter((s) => s.date.startsWith(y))) })),
			hi: pack('hi'),
			hiRaw: pack('hiRaw'),
			buys: pack('buys'),
			buysRaw: pack('buysRaw'),
			byKind: Object.fromEntries(['FII', 'Ação'].map((k) => [k, { lossLesson: kindLoss(k, 'lesson'), lossRaw: kindLoss(k, 'raw'), hi: kindPack(k, 'hi'), hiRaw: kindPack(k, 'hiRaw') }])),
			path: path[p],
			// Each day's top 10 against all, with and without the lesson (the chart), and the last days in full.
			series: list.map((s) => [s.date, Math.round((s.top.mean - s.all.mean) * 1e6) / 1e6, Math.round((s.topRaw.mean - s.all.mean) * 1e6) / 1e6]),
			last: list.slice(-30)
		};
	}
	return out;
}

/**
 * The test fixed in plano.md before the past was opened: the lesson goes into the app only if
 * 1. the chances with it are more honest (lower log-loss) in at least 2 of the 3 horizons, and
 * 2. the 1-month top 10 ordered with it earns at least as much as the one without (average difference >= 0).
 */
function decideTest(results) {
	const per = PROFILE_IDS.map((p) => ({ profile: p, lesson: results.profiles[p].all.lossLesson, raw: results.profiles[p].all.lossRaw }));
	const better = per.filter((x) => x.lesson < x.raw).length;
	const topDiff = results.profiles.swing.all.topDiff;
	const criteria = [
		{ id: 'calibragem', text: 'Chances mais honestas (log-loss menor) com a lição em pelo menos 2 dos 3 prazos', value: `${better} de 3`, passed: better >= 2, detail: per },
		{ id: 'top10', text: 'O Top 10 de 1 mês com a lição rende pelo menos o mesmo que sem ela (diferença média ≥ 0)', value: P(topDiff, 3), passed: Number.isFinite(topDiff) && topDiff >= 0 }
	];
	return { madeAt: new Date().toISOString(), engine: engine.version, passed: criteria.every((c) => c.passed), criteria };
}

function printPast(results, verdict) {
	console.log(`\nO passado do diário (${dateBr(results.from)} a ${dateBr(results.to)}), cada dia com a lição só do que tinha vencido até ele:`);
	for (const p of PROFILE_IDS) {
		const s = results.profiles[p];
		const a = s.all;
		console.log(
			`  ${HORIZON_WORD[p].padEnd(8)} ${String(a.days).padStart(4)} dias | log-loss ${a.lossLesson.toFixed(5)} com a lição × ${a.lossRaw.toFixed(5)} sem | Top 10 − todos ${P(a.spread, 3)} com × ${P(a.spreadRaw, 3)} sem (t ${Number.isFinite(a.t) ? a.t.toFixed(2) : '—'} em ${a.tDays}) | 60%+: ${s.hi.n ? Math.round((s.hi.beat / s.hi.n) * 100) : '—'}% de ${s.hi.n} com × ${s.hiRaw.n ? Math.round((s.hiRaw.beat / s.hiRaw.n) * 100) : '—'}% de ${s.hiRaw.n} sem`
		);
	}
	console.log(`\nO teste do plano: ${verdict.passed ? 'PASSOU, a lição entra no app' : 'NÃO PASSOU, o app continua com a chance do modelo'}.`);
	for (const c of verdict.criteria) console.log(`  ${c.passed ? '✓' : '✗'} ${c.text}: ${c.value}`);
}

// ------------------------------------------------------------------------------------------------------ hoje

async function today() {
	await open();
	const past = readPast();
	if (!past) throw new Error('O passado ainda não foi vivido. Rode: node ferramentas/diario.mjs passado');
	let histories = await loadHistories(engine, FRESH);
	const behindOf = (hs, date) => Object.entries(hs).filter(([, h]) => h.candles.at(-1)?.date < date).map(([t, h]) => `${t} (${h.candles.at(-1).date})`);
	// A day is sealed once: if Yahoo does not have the close of many assets yet, it waits a little for them (an asset
	// or two without trades that day is normal).
	for (let retry = 1; retry <= 2; retry++) {
		const late = behindOf(histories, histories.HGLG11.candles.at(-1).date);
		if (late.length <= 5) break;
		console.log(`${late.length} ativos ainda sem o fechamento de hoje: tento de novo em 10 minutos.`);
		await new Promise((r) => setTimeout(r, 10 * 60_000));
		histories = await loadHistories(engine, 0);
	}
	const calendar = histories.HGLG11.candles.map((c) => c.date);
	const place = new Map(calendar.map((d, i) => [d, i]));
	const last = calendar.at(-1);
	const behind = behindOf(histories, last);
	if (behind.length) console.log(`Com dados mais antigos que ${last}: ${behind.join(', ')}`);
	let days = readDays();
	const lived = new Set([...past.entries.map((e) => e.date), ...days.map((d) => d.date)]);
	const lastLived = [...lived].sort().at(-1);
	const missing = calendar.filter((d) => d > lastLived && d <= last);
	if (missing.length) {
		const entries = await liveDays(engine.dir, histories, missing);
		const until = calendar.length - 1;
		const records = recordsOf([...past.entries, ...days.map((d) => d.entry)], histories, calendar, until, engine.diario);
		for (const entry of entries) {
			const at = place.get(entry.date);
			const lessons = lessonsAt(records, at, engine.diario);
			const final = finalOf(entry, lessons, engine, engine.diario);
			// Lived with a newer close already known: it counts for the lesson, not for the proof.
			const late = entry.date !== last;
			const day = {
				v: 1,
				date: entry.date,
				computedAt: new Date().toISOString(),
				late,
				engine: engine.version,
				logic: engine.analise.MODEL_LOGIC,
				lessons: Object.fromEntries(PROFILE_IDS.map((p) => [p, { FII: lessonForApp(lessons[p].FII), Ação: lessonForApp(lessons[p].Ação) }])),
				entry,
				final
			};
			const text = JSON.stringify(day);
			const file = join(daysDir(), `${entry.date}.json`);
			if (existsSync(file)) continue;
			writeFileSync(file, text);
			appendFileSync(join(folder, 'lacres.jsonl'), `${JSON.stringify({ date: entry.date, sha256: sha256(text), sealedAt: day.computedAt, late, engine: engine.version, engineSha256: engine.hash })}\n`);
			console.log(`Dia ${dateBr(entry.date)} lacrado${late ? ' (refeito depois: não conta na prova)' : ''}.`);
		}
		days = readDays();
	} else console.log(`O dia ${dateBr(last)} já estava no diário.`);
	await refresh(histories);
}

/**
 * Scores every sealed day whose horizon has passed, writes placar.json, licao.json (what the app reads: today's
 * lessons, whether they are in use, and how the last scored days went) and the reports. Prints what was due today.
 */
async function refresh(histories) {
	const past = readPast();
	const days = readDays();
	const calendar = histories.HGLG11.candles.map((c) => c.date);
	const place = new Map(calendar.map((d, i) => [d, i]));
	const until = calendar.length - 1;
	const last = calendar.at(-1);
	const verdict = readJson(join(pastDir(), 'veredito.json'));
	const pastResults = readJson(join(pastDir(), 'resultados.json'));
	const score = {};
	for (const p of PROFILE_IDS) {
		const list = [];
		for (const d of days.filter((x) => !x.late)) {
			const s = scoreFinal(d.entry, d.final, histories, calendar, place.get(d.date), until, p, engine.diario);
			if (s) list.push(s);
		}
		score[p] = { list, sum: addUp(list, engine.diario.JOURNAL_HORIZON[p]) };
	}
	const todayDay = days.find((d) => d.date === last) ?? days.at(-1) ?? null;
	const scoreboard = {
		madeAt: new Date().toISOString(),
		engine: engine.version,
		asOf: last,
		since: days.find((d) => !d.late)?.date ?? null,
		sealed: days.length,
		late: days.filter((d) => d.late).length,
		profiles: Object.fromEntries(PROFILE_IDS.map((p) => [p, { sum: score[p].sum, list: score[p].list }]))
	};
	writeFileSync(join(folder, 'placar.json'), JSON.stringify(scoreboard));
	const apply = verdict?.passed === true;
	const latest = (p) => {
		const own = score[p].list.at(-1);
		if (own) return { ...brief(own, apply), refeito: false };
		const replay = pastResults?.profiles?.[p]?.last?.at(-1);
		return replay ? { ...brief(replay, apply), refeito: true } : null;
	};
	// Is it right or wrong? Each horizon: the sealed bets (the proof) and the past lived day by day (since 2019), in
	// words, a strip of the last bets, and how often the 1st, the top 3 and the top 10 of each group beat its average.
	const precision = precisionOf(recordsOf([...(past?.entries ?? []), ...days.map((d) => d.entry)], histories, calendar, until, engine.diario));
	const scoreboardWords = {};
	for (const p of PROFILE_IDS) {
		const h = engine.diario.JOURNAL_HORIZON[p];
		const sealedWins = score[p].list.map((x) => (apply ? x.top : x.topRaw).mean > x.all.mean);
		const pastWins = (pastResults?.profiles?.[p]?.series ?? []).map(([, withLesson, raw]) => (apply ? withLesson : raw) > 0);
		scoreboardWords[p] = {
			precision: precision[p],
			sealed: { since: scoreboard.since, ...verdictOf(sealedWins, h), days: sealedWins.length },
			past: pastResults ? { from: pastResults.from, to: pastResults.to, ...verdictOf(pastWins, h), days: pastWins.length } : null,
			strip: (sealedWins.length ? sealedWins : pastWins).slice(-40),
			stripSealed: sealedWins.length > 0
		};
	}
	const lesson = {
		v: 1,
		placar: scoreboardWords,
		logic: todayDay?.logic ?? engine.analise.MODEL_LOGIC,
		engine: engine.version,
		asOf: todayDay?.date ?? null,
		apply,
		test: verdict ? { passed: verdict.passed, madeAt: verdict.madeAt } : null,
		lessons: todayDay?.lessons ?? null,
		last: Object.fromEntries(PROFILE_IDS.map((p) => [p, latest(p)])),
		record: Object.fromEntries(PROFILE_IDS.map((p) => [p, { since: scoreboard.since, ...score[p].sum }]))
	};
	writeFileSync(join(folder, 'licao.json'), JSON.stringify(lesson));
	const due = PROFILE_IDS.map((p) => score[p].list.find((s) => s.end === last)).filter(Boolean);
	console.log(`\nDiário do robô · ${dateBr(last)} · motor ${engine.version} · ${days.filter((d) => !d.late).length} dia(s) lacrado(s) desde ${dateBr(scoreboard.since)}`);
	if (todayDay?.date === last) {
		for (const p of PROFILE_IDS) {
			const f = todayDay.final[p];
			const shown = apply ? f.top : f.topRaw;
			const buys = f.rows.filter((r) => (apply ? r.b : r.a) === 'COMPRAR').map((r) => r.t);
			console.log(`  Hoje, ${HORIZON_WORD[p]}: ${shown.slice(0, 5).map((t) => { const r = f.rows.find((x) => x.t === t); return `${t} ${Math.round((apply ? r.q : r.p) * 100)}%`; }).join(', ')}…${buys.length ? ` · comprar: ${buys.join(', ')}` : ' · esperar'}`);
		}
	}
	for (const s of due) {
		const top = apply ? s.top : s.topRaw;
		console.log(`  Venceu hoje (${HORIZON_WORD[s.profile]}, de ${dateBr(s.date)}): o Top 10 acertou ${top.beat} de ${top.n} (rendeu mais que a média do grupo) e rendeu ${P(top.mean - s.all.mean, 2)} sobre todos.`);
	}
	if (!due.length) console.log('  Nenhuma aposta do diário venceu hoje.');
	for (const p of PROFILE_IDS) {
		const s = score[p].sum;
		if (s.days) console.log(`  Placar ${HORIZON_WORD[p]}: ${s.days} dia(s) vencido(s), Top 10 ${P(apply ? s.spread : s.spreadRaw, 2)} sobre todos.`);
	}
	console.log(`  A lição ${apply ? 'está em uso no app' : 'não está em uso no app (não passou no teste, ou o teste ainda não foi aberto)'}.`);
	try {
		const { writeJournalReports } = await import('./diario-relatorio.mjs');
		const out = writeJournalReports({ folder, engine: engine.version, scoreboard, lesson, past: pastResults, verdict, today: todayDay, horizons: engine.diario.JOURNAL_HORIZON, placar: scoreboardWords });
		// The site has no journal of its own past: it shows this scoreboard, kept in the project (pushed with it).
		writeFileSync(fileURLToPath(new URL('./diario-placar.json', import.meta.url)), JSON.stringify({ asOf: last, placar: scoreboardWords }, null, 1));
		console.log(`\nRelatórios:\n  ${out.lite}\n  ${out.advanced}`);
	} catch (error) {
		console.log(`Sem os relatórios: ${error.message}`);
	}
}

function check() {
	const past = readPast();
	const days = readDays();
	console.log(`Diário do motor ${engine.version}: passado ${past ? `lacrado (${past.entries.length} pregões)` : 'não vivido'}, ${days.length} dia(s) lacrado(s), todos conferem.`);
}

/**
 * The journal follows the chances, not every line of the engine: when a new engine gives exactly the same chances
 * (checked on three days, one of them the last close), it keeps the old one's sealed past and days. The old seals
 * stay as they were, with the engine that made them.
 */
async function inherit() {
	const from = option('de');
	if (!from) throw new Error('Use: node ferramentas/diario.mjs herdar --de <motor antigo>');
	engine = await frozenEngine();
	const source = join(base, 'diario', from);
	const target = join(base, 'diario', engine.version);
	if (!existsSync(join(source, 'passado', 'lacre.json'))) throw new Error(`O motor ${from} não tem diário.`);
	if (existsSync(join(target, 'passado', 'lacre.json'))) throw new Error(`O motor ${engine.version} já tem diário.`);
	const old = await import(pathToFileURL(join(versionsDir, from, 'motor', 'analise.js')).href);
	if (old.MODEL_LOGIC !== engine.analise.MODEL_LOGIC) throw new Error(`As chances mudaram de lógica (${old.MODEL_LOGIC} → ${engine.analise.MODEL_LOGIC}): o diário não pode ser herdado.`);
	const histories = await loadHistories(engine, DAY_OLD);
	const calendar = histories.HGLG11.candles.map((c) => c.date);
	const days = [calendar.at(-701), calendar.at(-201), calendar.at(-1)];
	for (const date of days) {
		if (JSON.stringify(old.journalEntry(histories, date)) !== JSON.stringify(engine.analise.journalEntry(histories, date))) throw new Error(`As chances mudaram em ${date}: o diário não pode ser herdado.`);
	}
	cpSync(source, target, { recursive: true });
	writeFileSync(join(target, 'herdado.json'), JSON.stringify({ from, engine: engine.version, at: new Date().toISOString(), sameChancesOn: days }, null, 1));
	await open();
	console.log(`O diário de ${from} passou para ${engine.version}: as chances são iguais em ${days.join(', ')}.`);
}

if (step === 'passado') await livePast();
else if (step === 'herdar') await inherit();
else if (step === 'revelar-passado') await revealPast();
else if (step === 'hoje') await today();
else if (step === 'relatorio') {
	await open();
	await refresh(await loadHistories(engine, DAY_OLD));
} else if (step === 'conferir') {
	await open();
	check();
} else console.log('Use: node ferramentas/diario.mjs passado | revelar-passado | hoje | relatorio | conferir [--versao X] [--desde AAAA-MM-DD]');
