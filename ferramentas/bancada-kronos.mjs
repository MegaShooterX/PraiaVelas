// The bench for Kronos (github.com/shiyu-coder/Kronos), a model pre-trained on candles of 45 exchanges, against
// today's model (13/11/2026; plan in D:\Projetos\PraiaVelas\diario\kronos-2026-11-13\plano.md, written before).
// Kronos runs in Python on the graphics card, outside the project; this tool hands it the data and scores it.
//
//   node ferramentas/bancada-kronos.mjs exportar <pasta>   the bench's days since 01/07/2024 (after Kronos's training
//                                                          data), each asset's last 90 trading days up to each day
//   node ferramentas/bancada-kronos.mjs lacrar <pasta>     seals Kronos's predictions (saida.json) before any score
//   node ferramentas/bancada-kronos.mjs abrir <pasta>      scores both on the same days, by the plan's rules (once)

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useStore } from '../app/motor/armazem.js';
import { fetchHistory, historyUntil } from '../app/motor/dados.js';
import * as diario from '../app/motor/diario.js';
import { GROUPS } from '../app/motor/mercado.js';

const base = process.env.PRAIAVELAS_SAIDA ?? 'D:\\Projetos\\PraiaVelas';
const [step, name] = process.argv.slice(2);
if (!step || !name) throw new Error('Use: node ferramentas/bancada-kronos.mjs exportar|lacrar|abrir <pasta>');
const folder = join(base, 'diario', name);
if (!existsSync(join(folder, 'plano.md'))) throw new Error(`Falta o plano em ${folder}: ele é escrito antes.`);
const sha256 = (t) => createHash('sha256').update(t).digest('hex');
const cacheDir = join(base, 'cache');
const fileOf = (key) => join(cacheDir, `${key.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
useStore({ get: (k) => (existsSync(fileOf(k)) ? readFileSync(fileOf(k), 'utf8') : null), set: (k, raw) => writeFileSync(fileOf(k), raw) });

/** Kronos learned from data up to June 2024: only days after it are a fair test. */
const SINCE = '2024-07-01';
const CONTEXT = 90;
const AHEAD = 21;
const HORIZONS = { curto: 5, swing: 21 };

// Today's model: the chances sealed in the journal's past (the current journal folder).
const current = JSON.parse(readFileSync(join(base, 'diario', 'atual.json'), 'utf8')).folder;
const pastText = readFileSync(join(current, 'passado', 'entradas.json'), 'utf8');
if (sha256(pastText) !== JSON.parse(readFileSync(join(current, 'passado', 'lacre.json'), 'utf8')).entriesSha256) throw new Error('O passado do diário não confere com o lacre.');
const benchEntries = JSON.parse(pastText).entries.filter((_, k) => k % 5 === 0);

const histories = {};
for (const g of Object.values(GROUPS)) for (const t of [...g.members, g.market]) histories[t] = await fetchHistory(t, { maxAgeMs: 24 * 3_600_000 });
const calendar = histories.HGLG11.candles.map((c) => c.date);
const place = new Map(calendar.map((d, i) => [d, i]));
const until = calendar.length - 1;
// Days after Kronos's data whose month has already passed.
const days = benchEntries.filter((e) => e.date >= SINCE && place.has(e.date) && place.get(e.date) + AHEAD <= until);

/** Business days after a date (Kronos reads the weekday, day and month of the candles it predicts). */
function nextDays(date, n) {
	const out = [];
	const t = new Date(`${date}T12:00:00Z`);
	while (out.length < n) {
		t.setUTCDate(t.getUTCDate() + 1);
		if (t.getUTCDay() % 6 !== 0) out.push(t.toISOString().slice(0, 10));
	}
	return out;
}

if (step === 'exportar') {
	const members = Object.values(GROUPS).flatMap((g) => g.members);
	const out = { context: CONTEXT, ahead: AHEAD, days: [] };
	for (const e of days) {
		const series = {};
		for (const t of members) {
			if (!histories[t]) continue;
			// Cut at the day: nothing after it (the same rule as the journal).
			const cs = historyUntil(histories[t], e.date).candles;
			if (cs.length < CONTEXT || cs.at(-1).date < calendar[place.get(e.date) - 5]) continue;
			// Prices with dividends (the day a FII pays is not a real fall): open, high and low in the same proportion.
			series[t] = cs.slice(-CONTEXT).map((c) => {
				const k = c.a / c.c;
				return [c.date, c.o * k, c.h * k, c.l * k, c.a, c.v, c.c * c.v];
			});
		}
		out.days.push({ date: e.date, future: nextDays(e.date, AHEAD), series });
	}
	writeFileSync(join(folder, 'entrada.json'), JSON.stringify(out));
	console.log(`${out.days.length} datas, de ${out.days[0].date} a ${out.days.at(-1).date}, ${Object.keys(out.days[0].series).length} ativos na primeira.`);
} else if (step === 'lacrar') {
	const text = readFileSync(join(folder, 'saida.json'), 'utf8');
	if (existsSync(join(folder, 'lacre.json'))) throw new Error('As previsões já estão lacradas.');
	writeFileSync(join(folder, 'lacre.json'), JSON.stringify({ sealedAt: new Date().toISOString(), saidaSha256: sha256(text) }, null, 1));
	console.log(`Previsões lacradas: ${sha256(text)}`);
} else if (step === 'abrir') {
	if (existsSync(join(folder, 'veredito.json'))) throw new Error('O teste já foi aberto: ele só vale uma vez.');
	const text = readFileSync(join(folder, 'saida.json'), 'utf8');
	if (sha256(text) !== JSON.parse(readFileSync(join(folder, 'lacre.json'), 'utf8')).saidaSha256) throw new Error('As previsões não conferem com o lacre.');
	const kronos = JSON.parse(text);
	const mean = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : NaN);
	const sd = (xs) => {
		const m = mean(xs);
		return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, xs.length - 1));
	};
	const ranks = (xs) => {
		const order = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
		const r = new Array(xs.length);
		order.forEach(([, i], k) => (r[i] = k));
		return r;
	};
	const spearman = (a, b) => {
		const ra = ranks(a);
		const rb = ranks(b);
		const ma = mean(ra);
		const mb = mean(rb);
		let num = 0;
		let da = 0;
		let db = 0;
		for (let i = 0; i < a.length; i++) {
			num += (ra[i] - ma) * (rb[i] - mb);
			da += (ra[i] - ma) ** 2;
			db += (rb[i] - mb) ** 2;
		}
		return num / Math.sqrt(da * db);
	};
	const tOf = (xs) => (xs.length > 2 ? mean(xs) / (sd(xs) / Math.sqrt(xs.length)) : NaN);
	const results = { madeAt: new Date().toISOString(), days: days.length, from: days[0].date, to: days.at(-1).date, profiles: {} };
	for (const [p, h] of Object.entries(HORIZONS)) {
		const key = h === 5 ? 'r5' : 'r21';
		const perDay = [];
		const hits = { kronos: {}, hoje: {} };
		for (const e of days) {
			const at = place.get(e.date);
			const preds = kronos[e.date] ?? {};
			const rows = [];
			for (const [kind, g] of Object.entries(e.profiles[p] ?? {})) {
				// Only the assets both scored, so both order the same set.
				const both = g.rows.filter(([t]) => Number.isFinite(preds[t]?.[key]));
				if (both.length < 5) continue;
				const s = diario.scoreDay(both, histories, calendar, at, h);
				if (!s) continue;
				const scores = s.rows.map((r) => preds[r.ticker][key]);
				const m = mean(scores);
				const d = sd(scores) || 1;
				s.rows.forEach((r, i) => rows.push({ kind, t: r.ticker, p: r.p, k: (scores[i] - m) / d, kr: scores[i], ret: r.ret, y: r.y }));
			}
			if (rows.length < 20) continue;
			const top = (by) => mean([...rows].sort((a, b) => b[by] - a[by]).slice(0, 10).map((r) => r.ret));
			const ic = {};
			for (const kind of ['FII', 'Ação']) {
				const g = rows.filter((r) => r.kind === kind);
				if (g.length < 5) continue;
				ic[kind] = { kronos: spearman(g.map((r) => r.kr), g.map((r) => r.ret)), hoje: spearman(g.map((r) => r.p), g.map((r) => r.ret)) };
				for (const [who, by] of [['kronos', 'k'], ['hoje', 'p']]) {
					const sorted = [...g].sort((a, b) => b[by] - a[by]);
					const c = (hits[who][kind] ??= { first: [0, 0], top3: [0, 0], top10: [0, 0], all: [0, 0] });
					sorted.forEach((r, i) => {
						c.all[0] += r.y;
						c.all[1]++;
						if (i === 0) (c.first[0] += r.y), c.first[1]++;
						if (i < 3) (c.top3[0] += r.y), c.top3[1]++;
						if (i < 10) (c.top10[0] += r.y), c.top10[1]++;
					});
				}
			}
			perDay.push({ date: e.date, all: mean(rows.map((r) => r.ret)), kronos: top('k'), hoje: top('p'), ic });
		}
		const step5 = Math.ceil(h / 5);
		const diffs = perDay.map((x) => x.kronos - x.hoje);
		const apart = diffs.filter((_, i) => i % step5 === 0);
		const icMean = (who) => mean(perDay.flatMap((x) => Object.values(x.ic).map((v) => v[who])).filter(Number.isFinite));
		const rate = (c) => Object.fromEntries(Object.entries(c).map(([kind, v]) => [kind, Object.fromEntries(Object.entries(v).map(([k, [y, n]]) => [k, n ? y / n : null]))]));
		results.profiles[p] = {
			days: perDay.length,
			kronosTop: mean(perDay.map((x) => x.kronos - x.all)),
			hojeTop: mean(perDay.map((x) => x.hoje - x.all)),
			diff: mean(diffs),
			diffT: tOf(apart),
			diffDays: apart.length,
			icKronos: icMean('kronos'),
			icHoje: icMean('hoje'),
			hits: { kronos: rate(hits.kronos), hoje: rate(hits.hoje) }
		};
	}
	const sw = results.profiles.swing;
	const icBetter = Object.values(results.profiles).every((x) => x.icKronos > x.icHoje);
	const criteria = [
		{ text: 'Top 10 de 1 mês melhor que o do modelo de hoje, com t ≥ 1,5', value: `${(sw.diff * 100).toFixed(2).replace('.', ',')}% (t ${Number.isFinite(sw.diffT) ? sw.diffT.toFixed(2).replace('.', ',') : '—'} em ${sw.diffDays})`, passed: sw.diff > 0 && sw.diffT >= 1.5 },
		{ text: 'Ordena melhor (RankIC maior) em 1 semana e em 1 mês', value: Object.entries(results.profiles).map(([p, x]) => `${p === 'curto' ? '1 semana' : '1 mês'}: ${x.icKronos.toFixed(3)} × ${x.icHoje.toFixed(3)}`).join(' · '), passed: icBetter }
	];
	const verdict = { madeAt: new Date().toISOString(), passed: criteria.every((c) => c.passed), criteria };
	writeFileSync(join(folder, 'resultados.json'), JSON.stringify(results, null, 1));
	writeFileSync(join(folder, 'veredito.json'), JSON.stringify(verdict, null, 1));
	const P = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2).replace('.', ',')}%`;
	const pc = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
	console.log(`\nKronos × modelo de hoje, ${results.days} datas de ${results.from} a ${results.to} (depois dos dados de treino do Kronos):`);
	for (const [p, x] of Object.entries(results.profiles)) {
		console.log(`  ${p === 'curto' ? '1 semana' : '1 mês   '} ${x.days} datas | Top 10 − todos: Kronos ${P(x.kronosTop)} × hoje ${P(x.hojeTop)} (diferença ${P(x.diff)}, t ${Number.isFinite(x.diffT) ? x.diffT.toFixed(2) : '—'}) | RankIC Kronos ${x.icKronos.toFixed(3)} × hoje ${x.icHoje.toFixed(3)}`);
		for (const kind of ['FII', 'Ação']) {
			const k = x.hits.kronos[kind];
			const hj = x.hits.hoje[kind];
			if (k && hj) console.log(`      ${kind.padEnd(4)} bateu a média do grupo: 1º ${pc(k.first)} × ${pc(hj.first)} | top 3 ${pc(k.top3)} × ${pc(hj.top3)} | top 10 ${pc(k.top10)} × ${pc(hj.top10)} | todos ${pc(k.all)}`);
		}
	}
	console.log(`\nO plano: ${verdict.passed ? 'PASSOU: vale converter o Kronos para JavaScript' : 'NÃO PASSOU: o Kronos não entra'}.`);
	for (const c of criteria) console.log(`  ${c.passed ? '✓' : '✗'} ${c.text}: ${c.value}`);
}
