// The study of one or more funds in the terminal, with the same engine as the app.
//
//   node ferramentas/analisar.mjs HGLG11 MXRF11 [--perfil curto|swing|posicao] [--modo ponderada|simples]
//
// The quotes it downloads are kept in D:\Projetos\PraiaVelas\cache (PRAIAVELAS_SAIDA changes the folder):
// a cache is never kept in the Google Drive.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useStore } from '../app/motor/armazem.js';
import { analyzeTicker, DEFAULT_WATCHLIST } from '../app/motor/analise.js';
import { cleanTicker } from '../app/motor/dados.js';
import { money, pct, points } from '../app/motor/formato.js';

const folder = join(process.env.PRAIAVELAS_SAIDA ?? 'D:\\Projetos\\PraiaVelas', 'cache');
mkdirSync(folder, { recursive: true });
const fileOf = (key) => join(folder, `${key.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
useStore({
	get: (key) => (existsSync(fileOf(key)) ? readFileSync(fileOf(key), 'utf8') : null),
	set: (key, raw) => writeFileSync(fileOf(key), raw)
});

const args = process.argv.slice(2);
const option = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args.splice(i, 2)[1] : fallback;
};
const profile = option('perfil', 'swing');
const mode = option('modo', 'ponderada');
const tickers = (args.length ? args : DEFAULT_WATCHLIST).map(cleanTicker);

for (const ticker of tickers) {
	try {
		const r = await analyzeTicker(ticker, { profile, mode });
		const c = r.context;
		console.log(`\n${r.ticker} — ${r.name}`);
		console.log(`  ${money(c.last)} em ${r.asOf} | dia ${pct(c.dayChange)} | DY 12m ${pct(c.dy12, 1, false)} | perfil ${r.profile.name} (${r.profile.horizon} ${r.profile.unit})`);
		for (const line of c.narrative) console.log(`  · ${line}`);
		console.log(`  VIÉS: ${r.verdict.label} (nota ${r.verdict.score.toFixed(2)}, confiança ${r.verdict.confidence})`);
		const v = r.validation;
		console.log(`  Fora da amostra: acerto ${pct(v.hit, 0, false)} contra ${pct(v.baseHit, 0, false)} da base, vantagem ${points(v.edge, 2)} (${v.n} sinais)`);
		if (r.projection) {
			const f = r.projection.final;
			console.log(`  Projeção: mediana ${money(f.p50)} | 50%: ${money(f.p25)}–${money(f.p75)} | 90%: ${money(f.p5)}–${money(f.p95)} | chance de alta ${pct(r.projection.probUp, 0, false)} | esperado c/ div. ${pct(r.expected.total)}`);
		}
		for (const s of r.strategies) {
			const st = s.stats;
			const now = s.now === 1 ? 'ALTA ' : s.now === -1 ? 'BAIXA' : '  —  ';
			console.log(`   ${now} ${s.name.padEnd(22)} acerto ${pct(st.hit, 0, false).padStart(4)} (base ${pct(st.baseHit, 0, false)}) vant. ${points(st.edge, 2).padStart(10)} t=${st.tStat.toFixed(1).padStart(5)} peso ${pct(s.weight, 0, false).padStart(4)} | ${s.reading}`);
		}
		if (r.patterns.recent.length) console.log(`  Padrões recentes: ${r.patterns.recent.map((p) => `${p.name} (${p.date})`).join(', ')}`);
		for (const w of r.warnings) console.log(`  ! ${w}`);
	} catch (error) {
		console.log(`\n${ticker}: ${error.message}`);
	}
}
