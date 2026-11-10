// The site on GitHub Pages: the app as it is (app/), plus dados/ with everything it asks for when it opens.
//
//   node ferramentas/site.mjs <pasta de saída>
//
// Run by .github/workflows/site.yml every weekday after the B3 closes (and on each push). It does what the app does
// when it opens (the study of the FIIs and of the stocks, with the engine of app/motor), keeps every answer it got
// from Yahoo and the CVM, and writes each one where app/estatico.js will look for it. If too many assets did not
// download (Yahoo now and then refuses), it fails, and GitHub keeps the site of the day before.
//
// It also writes dados/diario.json, the robot's journal for the app (ferramentas/diario-nucleo.mjs): how the last bet
// of each horizon that came due turned out (the three days 1 week, 1 month and 3 months back, each lived with the
// histories cut at it: a few seconds). Only if the journal's lesson passed its test (ferramentas/diario-veredito.json,
// decided once on the computer) does it live every day since 2019 to learn it; it did not (10/11/2026).
//
// The output never goes to the Google Drive: on GitHub it is a folder of the job; on the computer, use
// D:\Projetos\PraiaVelas\site.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useStore } from '../app/motor/armazem.js';
import { ENGINE_DRAFT, ENGINE_VERSION, groupStudy, MODEL_LOGIC } from '../app/motor/analise.js';
import { expandHistory, fetchHistory, parseYahooChart } from '../app/motor/dados.js';
import * as diario from '../app/motor/diario.js';
import { decide } from '../app/motor/robo.js';
import { journalForApp, liveDays } from './diario-nucleo.mjs';
import { GROUPS } from '../app/motor/mercado.js';
import { snapshotName } from '../app/estatico.js';

const out = resolve(process.argv[2] ?? '_site');
for (const p of [out]) if (/^[A-Z]:\\Meu Drive|\\Meu Drive\\/i.test(p)) throw new Error('A saída do site não vai para o Google Drive: use D:\\Projetos\\PraiaVelas\\site.');
const app = fileURLToPath(new URL('../app/', import.meta.url));

// Every answer the engine gets, kept as bytes by address.
const saved = new Map();
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
	const url = typeof input === 'string' ? input : input.url;
	const response = await realFetch(input, init);
	if (response.ok) saved.set(url, new Uint8Array(await response.clone().arrayBuffer()));
	return response;
};
// A store in memory: everything comes fresh from the internet.
const memory = new Map();
useStore({ get: (k) => memory.get(k) ?? null, set: (k, v) => memory.set(k, v) });

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const yahooHas = (ticker) => [...saved.keys()].some((u) => u.includes(`/chart/${encodeURIComponent(ticker)}.SA?`));

const studies = {};
for (const kind of Object.keys(GROUPS)) {
	studies[kind] = await groupStudy(kind, { force: true, onProgress: (k, n, who) => k === n && console.log(`${kind}: ${n} ${who === 'CVM' ? 'anos da CVM' : 'ativos'}`) });
}
// The ones Yahoo refused, once more, slowly.
const everyone = Object.values(GROUPS).flatMap((g) => [...g.members, g.market]);
for (const t of everyone.filter((x) => !yahooHas(x))) {
	await pause(3000);
	await fetchHistory(t, { force: true, keep: false }).catch(() => null);
}
const missing = everyone.filter((t) => !yahooHas(t));
console.log(`Yahoo: ${everyone.length - missing.length} de ${everyone.length} ativos${missing.length ? ` (faltam ${missing.join(', ')})` : ''}.`);
if (missing.length > 3) {
	console.error('Faltam ativos demais: o site do dia anterior continua no ar.');
	process.exit(1);
}

// ----------------------------------------------------------------------------------------- the robot's journal
const motorDir = fileURLToPath(new URL('../app/motor/', import.meta.url));
/** The histories as the study got them, from the answers kept (no second download). */
const histories = {};
for (const t of everyone) {
	for (const [url, data] of saved) {
		if (!url.includes(`/chart/${encodeURIComponent(t)}.SA?`)) continue;
		try {
			histories[t] = expandHistory(parseYahooChart(JSON.parse(Buffer.from(data).toString('utf8')), t));
		} catch {
			// Another answer for the same asset may still be good.
		}
	}
}
const calendar = histories.HGLG11.candles.map((c) => c.date);
const verdictFile = fileURLToPath(new URL('./diario-veredito.json', import.meta.url));
const verdict = existsSync(verdictFile) ? JSON.parse(readFileSync(verdictFile, 'utf8')) : null;
const apply = verdict?.passed === true;
const days = apply ? calendar.filter((d) => d >= '2019-01-02') : [...new Set(Object.values(diario.JOURNAL_HORIZON).map((h) => calendar[calendar.length - 1 - h]))].sort();
const entries = await liveDays(motorDir, histories, days);
const journalFile = journalForApp({ entries, histories, calendar, engine: { decide, GROUPS, diario }, logic: MODEL_LOGIC, apply, test: verdict ? { passed: verdict.passed, madeAt: verdict.madeAt } : null });
console.log(`Diário: ${entries.length} dia(s) vividos, lição ${apply ? 'em uso' : 'fora do app'}.`);

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'dados'), { recursive: true });
cpSync(app, out, { recursive: true });
let bytes = 0;
for (const [url, data] of saved) {
	writeFileSync(join(out, 'dados', snapshotName(url)), data);
	bytes += data.length;
}
const lastClose = Object.values(studies)
	.flatMap((s) => Object.values(s?.studies?.swing?.today ?? {}))
	.reduce((m, t) => (t.date > m ? t.date : m), '');
const about = { geradoEm: new Date().toISOString(), dadosAte: lastClose, motor: `${ENGINE_VERSION}${ENGINE_DRAFT ? '+' : ''}`, arquivos: saved.size, faltam: missing };
writeFileSync(join(out, 'dados', 'sobre.json'), JSON.stringify(about, null, 1));
writeFileSync(join(out, 'dados', 'diario.json'), JSON.stringify(journalFile));
// GitHub Pages must not treat the folder as a Jekyll site.
writeFileSync(join(out, '.nojekyll'), '');
console.log(`Site em ${out}: ${saved.size} arquivos de dados (${(bytes / 1048576).toFixed(1)} MB), fechamento de ${lastClose}.`);
