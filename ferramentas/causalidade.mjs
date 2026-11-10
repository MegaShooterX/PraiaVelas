// The proof that the engine does not look ahead: on several cut dates, every history (prices, dividends, the
// markets) is scrambled after the cut, and the study of each group is made again on the cut histories. If anything
// after the cut reached the model, today's pictures or the chances, they would differ. Run before freezing a
// version (it is what docs/TECNICO.md quotes).
//
// The FIIs' CVM reports (0.0.5+) are handed to the second study WITHOUT the cut: every report filed after the cut is
// scrambled, and false ones are added. The study must still come out the same, which proves that each picture uses a
// report only from the day it could be read, not from the month it is about. The CDI and the Selic (for the second
// opinion, since the draft of 09/11/2026) go to it the same way: uncut, scrambled after the cut.
//
//   node ferramentas/causalidade.mjs
//
// Uses the quotes already kept in D:\Projetos\PraiaVelas\cache (PRAIAVELAS_SAIDA changes it).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useStore } from '../app/motor/armazem.js';
import * as engine from '../app/motor/analise.js';
import { fetchHistory, historyUntil } from '../app/motor/dados.js';
import { forecast } from '../app/motor/aprendizado.js';
import { GROUPS } from '../app/motor/mercado.js';
// The CVM reports exist only in engines that read them (0.0.5, frozen in D:\Projetos\PraiaVelas\versoes): without them the check runs as before.
const cvm = await import('../app/motor/cvm.js').catch(() => null);

const folder = join(process.env.PRAIAVELAS_SAIDA ?? 'D:\\Projetos\\PraiaVelas', 'cache');
mkdirSync(folder, { recursive: true });
const fileOf = (key) => join(folder, `${key.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
useStore({ get: (k) => (existsSync(fileOf(k)) ? readFileSync(fileOf(k), 'utf8') : null), set: (k, raw) => writeFileSync(fileOf(k), raw) });

const CUTS = ['2019-06-03', '2021-03-01', '2023-08-01', '2025-05-02', '2026-09-01'];
const TOLERANCE = 1e-9;

// A fixed-seed generator, so a failure can be run again the same way.
let seed = 20261109;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

/** The same history with everything after `date` replaced by noise: other prices, other volumes, other dividends. */
function scrambled(h, date) {
	const raw = h.raw.map((c) => {
		if (c.date <= date) return c;
		const k = 0.5 + random();
		return { ...c, o: c.o * k, h: c.h * k * 1.01, l: c.l * k * 0.99, c: c.c * k, v: Math.round(c.v * (0.2 + 2 * random())) };
	});
	const dividends = h.dividends.map((d) => (d.date <= date ? d : { ...d, amount: d.amount * (3 * random()) }));
	dividends.push({ date: raw.at(-1).date, amount: raw.at(-1).c * 0.05 });
	return { ...h, raw, dividends };
}

/** The CVM reports with every one filed after `date` scrambled, and a false report for each fund every month after it. */
function scrambledFunds(F, date) {
	const funds = {};
	for (const [t, reports] of Object.entries(F.funds)) {
		const list = reports.map((r) => (r.known <= date ? r : { ...r, vp: r.vp * (0.3 + 2 * random()) }));
		for (let k = 1; k <= 24; k++) {
			const d = new Date(`${date}T12:00:00Z`);
			d.setUTCMonth(d.getUTCMonth() - 6 + k, 1);
			// Months before the cut, filed after it (as if sent late): they must stay unread too.
			list.push({ ref: d.toISOString().slice(0, 10), known: new Date(Date.parse(`${date}T12:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10), vp: 1 + 300 * random() });
		}
		funds[t] = list;
	}
	return { ...F, funds };
}

const FUNDS = cvm ? await cvm.fetchFundamentals() : null;
if (FUNDS) console.log(`Relatórios da CVM de ${Object.keys(FUNDS.funds).length} FIIs, lidos até ${FUNDS.until}.`);

const { ENGINE_VERSION, PROFILES, studyGroup } = engine;
/** The CDI and the Selic with every value after `date` scrambled (engines that read them). */
function scrambledRates(r, date) {
	return { ...r, cdi: r.cdi.map(([d, v]) => (d <= date ? [d, v] : [d, v * 3 * random()])), selic: r.selic.map(([d, v]) => (d <= date ? [d, v] : [d, v + 10 * random() - 5])) };
}
const RATES = engine.fetchRates ? await engine.fetchRates() : null;

const histories = {};
for (const g of Object.values(GROUPS)) for (const t of [...g.members, g.market]) histories[t] = await fetchHistory(t, { maxAgeMs: 30 * 24 * 3_600_000 });

let checks = 0;
/** How many pictures had a second opinion: the check must have something to check. */
let seconds = 0;
let worst = 0;
const differ = [];
const same = (a, b, what) => {
	checks++;
	const bothBad = !Number.isFinite(a) && !Number.isFinite(b) && String(a) === String(b);
	const d = bothBad ? 0 : Math.abs(a - b);
	if (!(d <= TOLERANCE)) differ.push(`${what}: ${a} × ${b}`);
	else worst = Math.max(worst, d);
};

for (const date of CUTS) {
	for (const [kind, g] of Object.entries(GROUPS)) {
		const plain = g.members.map((t) => historyUntil(histories[t], date)).filter((h) => h.candles.length);
		const noisy = g.members.map((t) => historyUntil(scrambled(histories[t], date), date)).filter((h) => h.candles.length);
		const marketA = historyUntil(histories[g.market], date);
		const marketB = historyUntil(scrambled(histories[g.market], date), date);
		for (const profile of Object.keys(PROFILES)) {
			const A = studyGroup(plain, { profile, market: marketA, rates: RATES ? engine.ratesUntil(RATES, date) : null, fundamentals: FUNDS ? cvm.fundamentalsUntil(FUNDS, date) : null });
			const B = studyGroup(noisy, { profile, market: marketB, rates: RATES ? scrambledRates(RATES, date) : null, fundamentals: FUNDS ? scrambledFunds(FUNDS, date) : null });
			const tag = `${date} ${kind} ${profile}`;
			if (!A.model !== !B.model) {
				differ.push(`${tag}: modelo em um e não no outro`);
				continue;
			}
			if (!A.model) continue;
			if (A.model.trainedUntil > date) differ.push(`${tag}: treinado até ${A.model.trainedUntil}, depois do corte`);
			A.model.beta.forEach((v, j) => same(v, B.model.beta[j], `${tag} beta ${j}`));
			(A.model.prior ?? []).forEach((v, j) => same(v, B.model.prior?.[j], `${tag} prior ${j}`));
			same(A.model.base, B.model.base, `${tag} base`);
			same(A.model.validation.skill, B.model.validation.skill, `${tag} skill`);
			same(A.model.bank.length, B.model.bank.length, `${tag} banco`);
			A.model.bank.forEach((b, k) => same(b.r, B.model.bank[k]?.r, `${tag} banco ${k}`));
			for (const [t, x] of Object.entries(A.today)) {
				const y = B.today[t];
				if (!x.x !== !y?.x) {
					differ.push(`${tag} ${t}: foto em um e não no outro`);
					continue;
				}
				if (!x.x) continue;
				x.x.forEach((v, j) => same(v, y.x[j], `${tag} ${t} medida ${j}`));
				if ('second' in x) same(x.second ?? NaN, y.second ?? NaN, `${tag} ${t} segunda opinião`);
				if (x.book || y.book) same(x.book?.pvp ?? NaN, y.book?.pvp ?? NaN, `${tag} ${t} P/VP`);
				same(forecast(A.model, x.x, x.second).p, forecast(B.model, y.x, y.second).p, `${tag} ${t} chance`);
				if (Number.isFinite(x.second)) seconds++;
			}
		}
	}
	console.log(`${date}: ${checks} conferências até aqui, ${differ.length} diferenças`);
}

console.log(`\nMotor ${ENGINE_VERSION}${engine.ENGINE_DRAFT ? ' (rascunho)' : ''}: ${checks} conferências em ${CUTS.length} datas de corte (${seconds} com a segunda opinião), maior diferença ${worst.toExponential(1)}.`);
if (differ.length) {
	console.log(`OLHOU O FUTURO: ${differ.length} diferenças. As primeiras:\n${differ.slice(0, 20).join('\n')}`);
	process.exit(1);
}
console.log('Nada depois do corte chegou ao modelo, às fotos ou às chances.');
