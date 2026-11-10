// The decision bot in the terminal: the "Top 10 de agora", the same as the app's start screen (app/motor): the
// assets with the highest chance, learned from the group, of doing better than the average of their group (FIIs
// against FIIs, stocks against stocks) over the horizon, with what the bot would do. Also used by the daily run.
//
//   node ferramentas/robo.mjs                          the 41 FIIs and 22 stocks of the study
//   node ferramentas/robo.mjs HGLG11 PETR4             only these (from the same ranking)
//   [--perfil curto|swing|posicao]
//
// Quotes are kept in D:\Projetos\PraiaVelas\cache (PRAIAVELAS_SAIDA changes it), never in the Google Drive. The
// robot's journal (ferramentas/diario.mjs) is read from D:\Projetos\PraiaVelas\diario: when its lesson is in use, the
// chances come corrected, as in the app.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useStore } from '../app/motor/armazem.js';
import { ENGINE_VERSION, groupStudy, PROFILES, ranking } from '../app/motor/analise.js';
import { cleanTicker } from '../app/motor/dados.js';
import { GROUPS } from '../app/motor/mercado.js';
import { decide } from '../app/motor/robo.js';

const out = process.env.PRAIAVELAS_SAIDA ?? 'D:\\Projetos\\PraiaVelas';
const folder = join(out, 'cache');
mkdirSync(folder, { recursive: true });
const fileOf = (key) => join(folder, `${key.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
useStore({ get: (k) => (existsSync(fileOf(k)) ? readFileSync(fileOf(k), 'utf8') : null), set: (k, raw) => writeFileSync(fileOf(k), raw) });

const args = process.argv.slice(2);
const option = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args.splice(i, 2)[1] : fallback;
};
const profile = option('perfil', 'swing');
if (!PROFILES[profile]) throw new Error(`Perfil desconhecido: ${profile} (curto, swing ou posicao).`);
const only = args.map(cleanTicker);
const HORIZON = { curto: '1 semana', swing: '1 mês', posicao: '3 meses' };
const SAY = { COMPRAR: 'COMPRAR', VENDER: 'VENDER', 'FICAR DE FORA': 'ESPERAR' };
const pct = (v) => `${Math.round(v * 100)}%`;
const marketWords = (m) => (!m ? 'sem leitura' : `${m.trend > 0 ? 'subindo' : m.trend < 0 ? 'caindo' : m.turn > 0 ? 'começando a virar para cima' : m.turn < 0 ? 'começando a virar para baixo' : 'sem direção clara'} e ${m.agitated ? 'instável' : 'calmo'}`);

/** The journal of this computer (null before it exists). */
const journal = (() => {
	try {
		const current = JSON.parse(readFileSync(join(out, 'diario', 'atual.json'), 'utf8'));
		return JSON.parse(readFileSync(join(current.folder, 'licao.json'), 'utf8'));
	} catch {
		return null;
	}
})();

const rows = [];
const markets = {};
let date = null;
for (const kind of Object.keys(GROUPS)) {
	const study = await groupStudy(kind, { force: true });
	markets[kind] = study?.studies?.[profile]?.market ?? null;
	for (const r of ranking(study, profile, journal)) {
		rows.push({ r, d: decide(r) });
		date = date && date > r.date ? date : r.date;
	}
}
rows.sort((a, b) => b.r.forecast.p - a.r.forecast.p);
const shown = only.length ? rows.filter((x) => only.includes(x.r.ticker)) : rows;

console.log(`\nRobô PraiaVelas ${ENGINE_VERSION} · Top 10 de agora · chance de render mais que a média do grupo em ${HORIZON[profile]} · dados até ${(date ?? '—').split('-').reverse().join('/')}`);
for (const [kind, m] of Object.entries(markets)) console.log(`Mercado de ${kind === 'FII' ? 'fundos imobiliários' : 'ações'}: ${marketWords(m)}${m ? ` (agitação ${m.volRatio.toFixed(2).replace('.', ',')}× o normal)` : ''}`);
const count = (a) => rows.filter((x) => x.d.action === a).length;
console.log(`Comprar: ${count('COMPRAR')} · Vender: ${count('VENDER')} · Esperar: ${count('FICAR DE FORA')} (de ${rows.length})`);
if (rows.length && rows.every((x) => x.r.forecast.confidence === 'baixa')) console.log('O modelo ainda não passou no próprio teste: ele ordena, mas não manda comprar.');
const last = journal?.last?.[profile];
if (last?.n) console.log(`Diário: no Top 10 de ${HORIZON[profile]} de ${last.date.split('-').reverse().join('/')}${last.refeito ? ' (refeito)' : ''}, ${last.beat} de ${last.n} renderam mais que a média do grupo até ${last.end.split('-').reverse().join('/')} (Top 10 ${last.spread >= 0 ? '+' : ''}${(last.spread * 100).toFixed(2).replace('.', ',')}% sobre todos).${journal.apply ? ' Chances corrigidas pela lição do diário.' : ''}`);
console.log('');
for (const [i, { r, d }] of (only.length ? shown : shown.slice(0, 10)).entries()) {
	const top = r.forecast.drivers[0];
	console.log(`  ${String(only.length ? rows.indexOf(rows.find((x) => x.r.ticker === r.ticker)) + 1 : i + 1).padStart(2)}. ${r.ticker.padEnd(7)} ${pct(r.forecast.p).padStart(4)}  ${SAY[d.action].padEnd(8)} ${(r.segment ?? '').padEnd(28)} ${top ? `${top.effect > 0 ? '↑' : '↓'} ${top.text}` : ''}`);
}
console.log('\nRobô em teste às cegas: ainda não provou que acerta. Estudo educativo, não é recomendação de investimento.');
