// The site on GitHub Pages: the app as it is (app/), plus dados/ with everything it asks for when it opens.
//
//   node ferramentas/site.mjs <pasta de saída>
//
// Run by .github/workflows/site.yml every weekday after the B3 closes (and on each push). It does what the app does
// when it opens (the study of the FIIs and of the stocks, with the engine of app/motor), keeps every answer it got
// from Yahoo and the CVM, and writes each one where app/estatico.js will look for it. If too many assets did not
// download (Yahoo now and then refuses), it fails, and GitHub keeps the site of the day before.
//
// The output never goes to the Google Drive: on GitHub it is a folder of the job; on the computer, use
// D:\Projetos\PraiaVelas\site.

import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useStore } from '../app/motor/armazem.js';
import { ENGINE_DRAFT, ENGINE_VERSION, groupStudy } from '../app/motor/analise.js';
import { fetchHistory } from '../app/motor/dados.js';
import { GROUPS } from '../app/motor/mercado.js';
import { snapshotName } from '../app/estatico.js';

const out = resolve(process.argv[2] ?? '_site');
if (/^[A-Z]:\\Meu Drive|\\Meu Drive\\/i.test(out)) throw new Error('A saída do site não vai para o Google Drive: use D:\\Projetos\\PraiaVelas\\site.');
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
// GitHub Pages must not treat the folder as a Jekyll site.
writeFileSync(join(out, '.nojekyll'), '');
console.log(`Site em ${out}: ${saved.size} arquivos de dados (${(bytes / 1048576).toFixed(1)} MB), fechamento de ${lastClose}.`);
