// The quick bench of model variants (10/11/2026, Rhuan: "é mais pra aprimorar o algoritmo msm! mas tem que concluir
// o aprendizado logo"). Each variant is a frozen engine (versoes\rascunho-<hash>); it lives one trading day in five
// since 2019, with every history cut at the day (journalEntry, as in the robot's journal), and its chances are sealed
// before anything is scored. The yardstick is today's model on the same days, from the journal's sealed past.
//
//   node ferramentas/bancada.mjs <pasta> <motor de hoje> <variante,variante,...>
//
// The folder (in D:\Projetos\PraiaVelas\diario) must hold plano.md, written before: the rules decide, once.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useStore } from '../app/motor/armazem.js';
import { fetchHistory } from '../app/motor/dados.js';
import * as diario from '../app/motor/diario.js';
import { GROUPS } from '../app/motor/mercado.js';
import { liveDays, PROFILE_IDS } from './diario-nucleo.mjs';

const base = process.env.PRAIAVELAS_SAIDA ?? 'D:\\Projetos\\PraiaVelas';
const [name, today, list] = process.argv.slice(2);
if (!name || !today || !list) throw new Error('Use: node ferramentas/bancada.mjs <pasta> <motor de hoje> <variante,variante,...>');
const folder = join(base, 'diario', name);
if (!existsSync(join(folder, 'plano.md'))) throw new Error(`Falta o plano em ${folder}: ele é escrito antes.`);
if (existsSync(join(folder, 'veredito.json'))) throw new Error(`A bancada ${name} já foi aberta: ela só vale uma vez.`);
const sha256 = (t) => createHash('sha256').update(t).digest('hex');
const cacheDir = join(base, 'cache');
const fileOf = (key) => join(cacheDir, `${key.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
useStore({ get: (k) => (existsSync(fileOf(k)) ? readFileSync(fileOf(k), 'utf8') : null), set: (k, raw) => writeFileSync(fileOf(k), raw) });

// Today's model: the journal's sealed past.
const pastDir = join(base, 'diario', today, 'passado');
const pastText = readFileSync(join(pastDir, 'entradas.json'), 'utf8');
if (sha256(pastText) !== JSON.parse(readFileSync(join(pastDir, 'lacre.json'), 'utf8')).entriesSha256) throw new Error('O passado do modelo de hoje não confere com o lacre.');
const baseEntries = JSON.parse(pastText).entries.filter((_, k) => k % 5 === 0);
const days = baseEntries.map((e) => e.date);

const histories = {};
for (const g of Object.values(GROUPS)) for (const t of [...g.members, g.market]) histories[t] = await fetchHistory(t, { maxAgeMs: 24 * 3_600_000 });
const calendar = histories.HGLG11.candles.map((c) => c.date);
const place = new Map(calendar.map((d, i) => [d, i]));

// 1. Each variant lives the days, and its chances are sealed before anything is scored.
const variants = {};
for (const v of list.split(',')) {
	const started = Date.now();
	const entries = await liveDays(join(base, 'versoes', v, 'motor'), histories, days);
	const text = JSON.stringify({ engine: v, days: days.length, entries });
	writeFileSync(join(folder, `${v}.json`), text);
	writeFileSync(join(folder, `${v}.lacre.json`), JSON.stringify({ sealedAt: new Date().toISOString(), engine: v, entriesSha256: sha256(text), days: entries.length }, null, 1));
	console.log(`${v}: ${entries.length} datas vividas e lacradas em ${((Date.now() - started) / 1000).toFixed(0)} s.`);
	variants[v] = entries;
}

// 2. Scored: each day, each profile.
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const loss = (p, y) => -Math.log(Math.max(1e-9, y ? p : 1 - p));
function dayScore(entry, profile) {
	const at = place.get(entry.date);
	const rows = [];
	for (const [kind, g] of Object.entries(entry.profiles[profile] ?? {})) {
		const s = diario.scoreDay(g.rows, histories, calendar, at, diario.JOURNAL_HORIZON[profile]);
		if (s) for (const r of s.rows) rows.push({ ...r, kind });
	}
	if (rows.length < 20) return null;
	rows.sort((a, b) => b.p - a.p);
	const fii = rows.filter((r) => r.kind === 'FII');
	return {
		all: mean(rows.map((r) => r.ret)),
		top: mean(rows.slice(0, 10).map((r) => r.ret)),
		fii: fii.length >= 10 ? mean(fii.slice(0, 10).map((r) => r.ret)) - mean(fii.map((r) => r.ret)) : NaN,
		loss: rows.reduce((s, r) => s + loss(r.p, r.y), 0),
		n: rows.length,
		hi: { n: rows.filter((r) => r.p >= 0.6).length, beat: rows.filter((r) => r.p >= 0.6 && r.y).length }
	};
}
const tOf = (xs) => {
	if (xs.length < 3) return NaN;
	const m = mean(xs);
	const sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
	return sd > 0 ? m / (sd / Math.sqrt(xs.length)) : NaN;
};
function summary(entries) {
	const out = {};
	for (const p of PROFILE_IDS) {
		const scored = entries.map((e) => ({ date: e.date, s: dayScore(e, p) })).filter((x) => x.s);
		out[p] = scored;
	}
	return out;
}
const yard = summary(baseEntries);
const results = { madeAt: new Date().toISOString(), today, days: days.length, from: days[0], to: days.at(-1), profiles: {}, variants: {} };
const sum = (sc) => ({
	days: sc.length,
	loss: sc.reduce((a, x) => a + x.s.loss, 0) / sc.reduce((a, x) => a + x.s.n, 0),
	top: mean(sc.map((x) => x.s.top - x.s.all)),
	fii: mean(sc.map((x) => x.s.fii).filter(Number.isFinite)),
	hi: { n: sc.reduce((a, x) => a + x.s.hi.n, 0), beat: sc.reduce((a, x) => a + x.s.hi.beat, 0) }
});
for (const p of PROFILE_IDS) results.profiles[p] = sum(yard[p]);
for (const [v, entries] of Object.entries(variants)) {
	const mine = summary(entries);
	results.variants[v] = {};
	for (const p of PROFILE_IDS) {
		const byDate = new Map(yard[p].map((x) => [x.date, x.s]));
		const both = mine[p].filter((x) => byDate.has(x.date));
		const diffs = both.map((x) => x.s.top - byDate.get(x.date).top);
		// Days one horizon apart: next days share most of their future.
		const step = Math.ceil(diario.JOURNAL_HORIZON[p] / 5);
		const apart = diffs.filter((_, k) => k % step === 0);
		const byYear = [...new Set(both.map((x) => x.date.slice(0, 4)))].map((y) => ({ year: y, diff: mean(both.filter((x) => x.date.startsWith(y)).map((x) => x.s.top - byDate.get(x.date).top)) }));
		results.variants[v][p] = { ...sum(mine[p]), diff: mean(diffs), diffT: tOf(apart), diffDays: apart.length, byYear };
	}
}

// 3. The plan's rules.
const verdicts = Object.entries(results.variants).map(([v, r]) => {
	const better = PROFILE_IDS.filter((p) => r[p].loss < results.profiles[p].loss).length;
	const top = r.swing;
	const criteria = [
		{ text: 'Top 10 de 1 mês melhor que o do modelo de hoje, com t ≥ 1,5', value: `${(top.diff * 100).toFixed(3).replace('.', ',')}% (t ${Number.isFinite(top.diffT) ? top.diffT.toFixed(2).replace('.', ',') : '—'})`, passed: top.diff > 0 && top.diffT >= 1.5 },
		{ text: 'Log-loss menor que o do modelo de hoje em pelo menos 2 dos 3 prazos', value: `${better} de 3`, passed: better >= 2 }
	];
	return { variant: v, passed: criteria.every((c) => c.passed), gain: top.diff, criteria };
});
const winner = verdicts.filter((x) => x.passed).sort((a, b) => b.gain - a.gain)[0]?.variant ?? null;
writeFileSync(join(folder, 'resultados.json'), JSON.stringify(results, null, 1));
writeFileSync(join(folder, 'veredito.json'), JSON.stringify({ madeAt: new Date().toISOString(), winner, verdicts }, null, 1));

const P = (v, d = 2) => (Number.isFinite(v) ? `${v > 0 ? '+' : ''}${(v * 100).toFixed(d).replace('.', ',')}%` : '—');
const W = { curto: '1 semana', swing: '1 mês', posicao: '3 meses' };
console.log(`\n${days.length} datas, de ${days[0]} a ${days.at(-1)}. Modelo de hoje (${today}):`);
for (const p of PROFILE_IDS) {
	const r = results.profiles[p];
	console.log(`  ${W[p].padEnd(8)} log-loss ${r.loss.toFixed(5)} | Top 10 − todos ${P(r.top)} | FIIs top 10 − FIIs ${P(r.fii)} | 60%+ acertou ${r.hi.n ? Math.round((r.hi.beat / r.hi.n) * 100) : '—'}% de ${r.hi.n}`);
}
for (const [v, r] of Object.entries(results.variants)) {
	console.log(`${v}:`);
	for (const p of PROFILE_IDS) console.log(`  ${W[p].padEnd(8)} log-loss ${r[p].loss.toFixed(5)} | Top 10 − todos ${P(r[p].top)} (contra hoje ${P(r[p].diff, 3)}, t ${Number.isFinite(r[p].diffT) ? r[p].diffT.toFixed(2) : '—'}) | FIIs top 10 − FIIs ${P(r[p].fii)} | 60%+ acertou ${r[p].hi.n ? Math.round((r[p].hi.beat / r[p].hi.n) * 100) : '—'}% de ${r[p].hi.n}`);
}
console.log('\nO plano:');
for (const x of verdicts) console.log(`  ${x.variant}: ${x.passed ? 'PASSOU' : 'não passou'} · ${x.criteria.map((c) => `${c.passed ? '✓' : '✗'} ${c.value}`).join(' · ')}`);
console.log(winner ? `Entra no app: ${winner}.` : 'Nenhuma variante passou: o app continua com o modelo de hoje.');
