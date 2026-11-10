// The two reports of the robot's journal, written by ferramentas/diario.mjs every day after the close:
// - relatorio-lite.html: one screen. What came due today (the bets whose horizon passed: right or wrong), what the
//   robot says today, the scoreboard of the sealed days, and what it learned from its own errors.
// - relatorio-avancado.html: everything, in tabs (Resumo, Hoje, Placar, Passado, Lição, Lacres, Plano).
//
// The same look as the blind tests' reports (relatorio.mjs: no margin, panels touching, 1px lines, 3px corners),
// and the same rule as the whole project: a hit rate is always shown beside its base (all the assets).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { card, esc, markdownSections, mdBody, page, TABS_SCRIPT, TIP_SCRIPT, tile } from './relatorio.mjs';

const P = (v, d = 1) => (Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(d).replace('.', ',')}%` : '—');
const R = (k, n) => (n ? `${Math.round((k / n) * 100)}%` : '—');
const pc = (v) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—');
const n2 = (v) => (Number.isFinite(v) ? v.toFixed(2).replace('.', ',').replace('-', '−') : '—');
const dateBr = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
const dateShort = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—');
const WORD = { curto: '1 semana', swing: '1 mês', posicao: '3 meses' };
/** For the tiles, where room is short on a phone. */
const SHORTW = { curto: '1 sem', swing: '1 mês', posicao: '3 mês' };
const PROFILES = ['curto', 'swing', 'posicao'];
const SAY = { COMPRAR: 'Comprar', VENDER: 'Vender', 'FICAR DE FORA': 'Esperar' };
const KIND = { FII: 'FIIs', Ação: 'ações' };

/** Business days after a date (holidays not counted): when a bet sealed today comes due, roughly. */
function roughlyAfter(date, days) {
	const t = new Date(`${date}T12:00:00Z`);
	while (days > 0) {
		t.setUTCDate(t.getUTCDate() + 1);
		if (t.getUTCDay() % 6 !== 0) days--;
	}
	return t.toISOString().slice(0, 10);
}

const EXTRA_CSS = `
.hoje{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}
.hoje td,.hoje th{padding:2px 4px;border-top:1px solid var(--grid);text-align:right;white-space:nowrap}
.hoje th{color:var(--muted);font-weight:600;font-size:9.5px;text-transform:uppercase;letter-spacing:.03em;border-top:0}
.hoje td:nth-child(2),.hoje th:nth-child(2){text-align:left}
.hoje td.acao{font-weight:700}
.hoje td.acao.compra{color:var(--good-text)}
.picks{display:flex;flex-wrap:wrap;gap:1px 8px;font-size:12px;font-variant-numeric:tabular-nums}
.picks span{white-space:nowrap}
.res.certo{color:var(--good-text)}
.res.errado{color:var(--bad)}
.licao{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:var(--grid)}
.licao div{background:var(--surface);padding:3px 4px;font-size:12px;line-height:1.3;min-width:0}
.licao .lrot{display:block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
.licao p{margin:0}
@media (max-width:900px){.licao{grid-template-columns:minmax(0,1fr)}}
.placar{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:var(--grid)}
.placar > div{background:var(--surface);padding:3px 4px;min-width:0;font-size:12px;line-height:1.35}
.placar h3{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:0 0 1px}
.veredito{font-weight:750;font-size:13px}
.veredito.acerta{color:var(--good-text)}.veredito.erra{color:var(--bad)}.veredito.sorte,.veredito.cedo{color:var(--ink-2)}
.fita{display:flex;flex-wrap:wrap;gap:1px;margin:2px 0}
.fita i{width:8px;height:12px;display:block;border-radius:1px}
.fita i.g{background:var(--good-text)}.fita i.p{background:var(--bad)}
.precisao{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;font-size:11.5px;margin-top:2px}
.precisao td,.precisao th{padding:1px 3px;text-align:right;border-top:1px solid var(--grid)}
.precisao th{font-size:9.5px;color:var(--muted);font-weight:600;border-top:0}
.precisao td:first-child,.precisao th:first-child{text-align:left}
.precisao td.mais{color:var(--good-text);font-weight:700}
@media (max-width:900px){.placar{grid-template-columns:minmax(0,1fr)}}
`;

/** The top 10 the app showed on a scored day: corrected by the lesson when it is in use, the model's otherwise. */
let APPLY = false;
const shownTop = (s) => (APPLY ? s.top : s.topRaw);
const otherTop = (s) => (APPLY ? s.topRaw : s.top);
const shownPicks = (s) => (APPLY ? s.picks : (s.picksRaw ?? null));

/** One day's top 10 in a line: each pick with a tick or a cross (beat its group's average or not) and by how much. */
const picksLine = (picks) =>
	`<div class="picks">${picks.map((x) => `<span class="res ${x.y ? 'certo' : 'errado'}" data-tip="${esc(x.t)}|${x.y ? 'rendeu mais' : 'rendeu menos'} que a média do grupo: ${esc(P(x.vs, 1))}" tabindex="0">${x.y ? '✓' : '✗'} ${esc(x.t)} ${P(x.vs, 1)}</span>`).join('')}</div>`;

/** The sum, day after day, of what the top 10 earned above all (each day weighs 1/horizon, as one period of it). */
function cumulative(series, h, { W = 640, H = 160 } = {}) {
	if (!series?.length || series.length < 2) return '<p class="muted">Ainda sem dias conferidos.</p>';
	let a = 0;
	let b = 0;
	const withL = [];
	const without = [];
	for (const [, s, r] of series) {
		withL.push((a += s / h));
		without.push((b += r / h));
	}
	const lo = Math.min(0, ...withL, ...without);
	const hi = Math.max(0, ...withL, ...without);
	const x = (i) => 30 + (i / (series.length - 1)) * (W - 40);
	const y = (v) => 8 + ((hi - v) / (hi - lo || 1)) * (H - 26);
	const line = (vs) => vs.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
	const years = [...new Set(series.map((s) => s[0].slice(0, 4)))];
	const ticks = years.map((yr) => {
		const i = series.findIndex((s) => s[0].startsWith(yr));
		return `<text x="${x(i).toFixed(1)}" y="${H - 4}" fill="var(--muted)" font-size="10" text-anchor="middle">${yr}</text><line x1="${x(i).toFixed(1)}" y1="6" x2="${x(i).toFixed(1)}" y2="${H - 18}" stroke="var(--grid)"/>`;
	});
	return `<div class="legenda"><span><i class="k novo"></i>com a lição</span><span><i class="k velho"></i>sem a lição</span><span class="muted">soma do que o Top 10 rendeu acima de todos, por período</span></div>
<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img" aria-label="Top 10 contra todos, acumulado, com e sem a lição">
${ticks.join('')}
<line x1="30" y1="${y(0).toFixed(1)}" x2="${W - 10}" y2="${y(0).toFixed(1)}" stroke="var(--axis)"/>
<text x="26" y="${(y(0) + 3).toFixed(1)}" fill="var(--muted)" font-size="10" text-anchor="end">0</text>
<polyline points="${line(without)}" fill="none" stroke="var(--muted)" stroke-width="2"/>
<polyline points="${line(withL)}" fill="none" stroke="var(--accent)" stroke-width="2"/>
<text x="${W - 8}" y="${(y(withL.at(-1)) - 4).toFixed(1)}" fill="var(--ink)" font-size="11" text-anchor="end">${P(withL.at(-1), 0)}</text>
<text x="${W - 8}" y="${(y(without.at(-1)) + 12).toFixed(1)}" fill="var(--ink-2)" font-size="11" text-anchor="end">${P(without.at(-1), 0)}</text>
</svg>`;
}

/** How sure of itself the lesson let the robot be, month by month (1 = as the model says, 0 = it does not know). */
function trustChart(path, { W = 640, H = 120 } = {}) {
	const fii = path?.FII ?? [];
	const acao = path?.Ação ?? [];
	const all = [...fii, ...acao];
	if (all.length < 2) return '<p class="muted">Sem lição ainda.</p>';
	const dates = [...new Set(all.map((p) => p.d))].sort();
	const hi = Math.max(1.4, ...all.map((p) => p.beta));
	const x = (d) => 30 + (dates.indexOf(d) / Math.max(1, dates.length - 1)) * (W - 40);
	const y = (v) => 6 + ((hi - v) / hi) * (H - 24);
	const line = (ps) => ps.map((p) => `${x(p.d).toFixed(1)},${y(p.beta).toFixed(1)}`).join(' ');
	const years = [...new Set(dates.map((d) => d.slice(0, 4)))];
	return `<div class="legenda"><span><i class="k novo"></i>FIIs</span><span><i class="k velho"></i>ações</span><span class="muted">1 = confia na chance como o modelo diz · 0 = não sabe</span></div>
<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img" aria-label="A confiança da lição ao longo do tempo">
${years.map((yr) => `<text x="${x(dates.find((d) => d.startsWith(yr))).toFixed(1)}" y="${H - 4}" fill="var(--muted)" font-size="10" text-anchor="middle">${yr}</text>`).join('')}
<line x1="30" y1="${y(1).toFixed(1)}" x2="${W - 10}" y2="${y(1).toFixed(1)}" stroke="var(--axis)" stroke-dasharray="3 3"/>
<line x1="30" y1="${y(0).toFixed(1)}" x2="${W - 10}" y2="${y(0).toFixed(1)}" stroke="var(--axis)"/>
<text x="26" y="${(y(1) + 3).toFixed(1)}" fill="var(--muted)" font-size="10" text-anchor="end">1</text>
<text x="26" y="${(y(0) + 3).toFixed(1)}" fill="var(--muted)" font-size="10" text-anchor="end">0</text>
${acao.length > 1 ? `<polyline points="${line(acao)}" fill="none" stroke="var(--muted)" stroke-width="2"/>` : ''}
${fii.length > 1 ? `<polyline points="${line(fii)}" fill="none" stroke="var(--accent)" stroke-width="2"/>` : ''}
</svg>`;
}

/** What 60% becomes with a lesson (the same formula as app/motor/diario.js applyLesson). */
function sixty(L) {
	if (!L) return NaN;
	const x = Math.log(0.6 / 0.4);
	return 1 / (1 + Math.exp(-(L.alpha + L.beta * (x - L.centre))));
}

/** The lesson of one group and horizon, in a person's words. */
function lessonText(L, kind, profile) {
	if (!L) return `<p class="muted">Sem dias conferidos ainda para ${KIND[kind]} em ${WORD[profile]}.</p>`;
	const hi = L.recent?.hi;
	const said = hi?.n ? `Quando disse 60% ou mais (em ${hi.days} dia${hi.days === 1 ? '' : 's'} do último ${profile === 'posicao' ? 'biênio' : 'ano'}), acertou <b>${pc(hi.hit)}</b> das vezes.` : `No último ${profile === 'posicao' ? 'biênio' : 'ano'}, não disse 60% ou mais nenhuma vez.`;
	const base = `Na média, disse ${pc(L.recent?.said)} e acertou ${pc(L.recent?.hit)}.`;
	const trust = L.beta >= 0.9 && L.beta <= 1.1 ? 'confia nas próprias chances como estão' : L.beta > 1.1 ? 'acertou mais do que dizia: as chances ficam mais fortes' : L.beta < 0.1 ? 'não acertou mais que o acaso: as chances ficam perto da média' : 'andou confiante demais: as chances ficam mais modestas';
	return `<p>${said} ${base}</p><p>Lição: ${trust}. <b>60% vira ${pc(sixty(L))}</b> (confiança ${n2(L.beta)}, de ${L.days} dias conferidos).</p>`;
}

function lessonGrid(lessons) {
	return `<div class="licao">${PROFILES.map((p) => `<div><span class="lrot">${WORD[p]} · FIIs</span>${lessonText(lessons?.[p]?.FII, 'FII', p)}</div>`).join('')}${PROFILES.map((p) => `<div><span class="lrot">${WORD[p]} · ações</span>${lessonText(lessons?.[p]?.Ação, 'Ação', p)}</div>`).join('')}</div>`;
}

/** Today's top 10 of one horizon: the corrected chance, the model's, and what the robot does. */
function todayTable(day, profile, apply, all = false) {
	const f = day?.final?.[profile];
	if (!f) return '<p class="muted">Sem o dia de hoje.</p>';
	const order = apply ? f.rows : [...f.rows].sort((a, b) => b.p - a.p);
	const rows = all ? order : order.slice(0, 10);
	return `<div class="rolar"><table class="hoje"><tr><th>#</th><th>Ativo</th><th>${apply ? 'Chance' : 'Chance'}</th><th>${apply ? 'Do modelo' : 'Com a lição'}</th><th>Robô</th></tr>${rows
		.map((r, i) => {
			const shown = apply ? r.q : r.p;
			const other = apply ? r.p : r.q;
			const act = apply ? r.b : r.a;
			return `<tr><td>${i + 1}</td><td><b>${esc(r.t)}</b> <span class="muted">${r.kind === 'FII' ? 'FII' : 'ação'}</span></td><td><b>${pc(shown)}</b></td><td class="muted">${pc(other)}</td><td class="acao ${act === 'COMPRAR' ? 'compra' : ''}">${SAY[act]}</td></tr>`;
		})
		.join('')}</table></div>`;
}

/** The bets scored in the journal, newest first: date, when it came due, the top 10 and all. */
function scoredTable(list, h, limit = 40) {
	if (!list?.length) return '<p class="muted">Nenhuma aposta lacrada venceu ainda.</p>';
	return `<div class="rolar"><table class="num"><tr><th>Lacrado em</th><th>Venceu</th><th>Top 10 acertou</th><th>Top 10 − todos</th><th>${APPLY ? 'Sem a lição' : 'Com a lição'}</th><th>Compras</th><th class="esq">Top 10 (contra a média do grupo)</th></tr>${[...list]
		.reverse()
		.slice(0, limit)
		.map((s) => `<tr><td>${dateBr(s.date)}</td><td>${dateBr(s.end)}</td><td>${shownTop(s).beat} de ${shownTop(s).n} <span class="muted">(todos ${R(s.all.beat, s.all.n)})</span></td><td class="${shownTop(s).mean > s.all.mean ? 'res certo' : 'res errado'}">${P(shownTop(s).mean - s.all.mean, 2)}</td><td>${P(otherTop(s).mean - s.all.mean, 2)}</td><td>${(APPLY ? s.buys : s.buysRaw).n ? `${(APPLY ? s.buys : s.buysRaw).beat} de ${(APPLY ? s.buys : s.buysRaw).n}` : '—'}</td><td class="esq" style="white-space:normal;min-width:320px">${shownPicks(s) ? picksLine(shownPicks(s)) : ''}</td></tr>`)
		.join('')}</table></div>`;
}

/** The past (2019 to the day before the journal started), whole and by year, with and without the lesson. */
function pastTable(prof) {
	const head = '<tr><th>Ano</th><th>Dias</th><th>Top 10 − todos, com a lição</th><th>Sem a lição</th><th>t</th><th>Top ganhou</th><th>Log-loss com</th><th>Sem</th></tr>';
	const row = (label, s, strong) =>
		`<tr${strong ? ' class="destaque"' : ''}><td>${label}</td><td>${s.days}</td><td class="${s.spread > 0 ? 'res certo' : 'res errado'}">${P(s.spread, 2)}</td><td>${P(s.spreadRaw, 2)}</td><td>${n2(s.t)}</td><td>${R(s.won, s.days)}</td><td>${Number.isFinite(s.lossLesson) ? s.lossLesson.toFixed(4) : '—'}</td><td>${Number.isFinite(s.lossRaw) ? s.lossRaw.toFixed(4) : '—'}</td></tr>`;
	return `<div class="rolar"><table class="num">${head}${row('Tudo', prof.all, true)}${prof.byYear.map((y) => row(y.year, y)).join('')}</table></div>`;
}

function verdictTable(verdict) {
	if (!verdict) return '<p class="muted">O teste do passado ainda não foi aberto.</p>';
	return `<div class="rolar"><table class="num"><tr><th>Regra do plano</th><th>Resultado</th><th></th></tr>${verdict.criteria
		.map((c) => `<tr><td style="white-space:normal;text-align:left">${esc(c.text)}</td><td>${esc(c.value)}</td><td class="res ${c.passed ? 'certo' : 'errado'}">${c.passed ? '✓ passou' : '✗ não passou'}</td></tr>`)
		.join('')}</table></div><p class="texto"><b>${verdict.passed ? 'Passou: o app mostra a chance corrigida pela lição.' : 'Não passou: o app continua com a chance do modelo; o diário segue anotando as duas para o futuro julgar.'}</b></p>`;
}

/** The sentence at the top: what came due today, or when the first sealed bet comes due; and whether the lesson is in use. */
function headline(ctx) {
	const { scoreboard: sb, lesson, verdict, horizons } = ctx;
	const due = PROFILES.map((p) => sb.profiles[p].list.find((s) => s.end === sb.asOf)).filter(Boolean);
	const parts = [];
	if (due.length) {
		for (const s of due) {
			const t = shownTop(s);
			parts.push(`Hoje venceu a aposta de **${WORD[s.profile]}** feita em ${dateBr(s.date)}: **${t.beat} dos ${t.n}** do Top 10 renderam mais que a média do grupo, e o Top 10 rendeu **${P(Math.abs(t.mean - s.all.mean), 2)}** ${t.mean >= s.all.mean ? 'a mais' : 'a menos'} que todos.`);
		}
	} else {
		const first = sb.since;
		parts.push(first ? `Nenhuma aposta lacrada venceu hoje. A primeira de 1 semana (lacrada em ${dateBr(first)}) vence por volta de ${dateBr(roughlyAfter(first, horizons.curto))}; a de 1 mês, por volta de ${dateBr(roughlyAfter(first, horizons.swing))}.` : 'O diário ainda não tem dias lacrados.');
	}
	if (verdict) parts.push(verdict.passed ? 'A lição tirada de 2019 a 2026 passou no teste: o app mostra a chance já corrigida pelo que o robô errou e acertou.' : 'A lição tirada de 2019 a 2026 não passou no teste: o app mostra a chance do modelo, e o diário segue conferindo as duas.');
	else if (lesson?.apply === false) parts.push('O teste da lição ainda não foi aberto.');
	return parts.join(' ').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

/**
 * Is the robot right or wrong? (Rhuan, 10/11/2026.) For each horizon: the verdict of the sealed bets and of the past
 * lived day by day, a strip of the last bets (green: the top 10 beat all of them; red: it did not), and how often
 * the 1st, the top 3 and the top 10 of each group beat its average, beside all of them (the base).
 */
function rightOrWrong(ctx) {
	const pl = ctx.placar;
	if (!pl) return '';
	const cols = PROFILES.map((p) => {
		const x = pl[p];
		if (!x) return '';
		const sealed = x.sealed.days ? `<p><span class="veredito ${x.sealed.word}">Lacradas: ${esc(x.sealed.text)}</span></p>` : `<p class="muted">Lacradas: nenhuma venceu ainda (a primeira vence por volta de ${dateBr(roughlyAfter(ctx.scoreboard.since ?? ctx.scoreboard.asOf, ctx.horizons[p]))}).</p>`;
		const past = x.past ? `<p><span class="veredito ${x.past.word}">Passado: ${esc(x.past.text)}</span> <span class="muted">(${x.past.from?.slice(0, 4)}–${x.past.to?.slice(0, 4)}, refeito dia a dia)</span></p>` : '';
		const strip = x.strip?.length ? `<div class="fita" role="img" aria-label="Últimas ${x.strip.length} apostas: ${x.strip.filter(Boolean).length} ganharam">${x.strip.map((w) => `<i class="${w ? 'g' : 'p'}" title="${w ? 'ganhou da média' : 'perdeu da média'}"></i>`).join('')}</div><p class="muted">As últimas ${x.strip.length} apostas ${x.stripSealed ? 'lacradas' : 'do passado'}: verde, o Top 10 rendeu mais que todos.</p>` : '';
		const row = (label, q) => (q ? `<tr><td>${label}</td>${['first', 'top3', 'top10'].map((k) => `<td class="${q[k] - q.all >= 0.03 ? 'mais' : ''}">${pc(q[k])}</td>`).join('')}<td>${pc(q.all)}</td></tr>` : '');
		const table = `<table class="precisao"><tr><th>Bateu a média do grupo</th><th>1º</th><th>Top 3</th><th>Top 10</th><th>Todos</th></tr>${row('FIIs', x.precision?.FII)}${row('Ações', x.precision?.Ação)}</table>`;
		return `<div><h3>${WORD[p]}</h3>${sealed}${past}${strip}${table}</div>`;
	});
	return card('O robô está acertando?', 'a sorte daria metade; em verde, 3 pontos ou mais acima de todos', `<div class="placar">${cols.join('')}</div>`);
}

function topBar(ctx, link) {
	const sb = ctx.scoreboard;
	return `<nav class="volta"><a href="/experimentos/">← Testes</a><a href="/">App</a>${link}</nav><div class="bar"><h1>Diário do robô</h1><span class="sub">fechamento de ${dateBr(sb.asOf)} · motor ${esc(ctx.engine)} · ${sb.sealed - sb.late} dia${sb.sealed - sb.late === 1 ? '' : 's'} lacrado${sb.sealed - sb.late === 1 ? '' : 's'} desde ${dateBr(sb.since)}</span><span class="selo" data-tip="Cada dia é lacrado no próprio dia (SHA-256)|e só é aberto quando o prazo vence" tabindex="0"><b>✓</b> lacres conferidos</span></div>`;
}

function tiles(ctx) {
	const sb = ctx.scoreboard;
	const out = [];
	for (const p of PROFILES) {
		const s = sb.profiles[p].sum;
		out.push(tile(`Lacrado ${SHORTW[p]}`, s.days ? P(APPLY ? s.spread : s.spreadRaw, 2) : '—', s.days ? `${s.won} de ${s.days} dias · Top acertou ${pc(s.topBeat)}` : `vence ~${dateShort(roughlyAfter(sb.since ?? sb.asOf, ctx.horizons[p]))}`, `Os dias lacrados no próprio dia, de ${WORD[p]}|Top 10 menos todos, na média dos dias vencidos`));
	}
	for (const p of PROFILES) {
		const s = ctx.past?.profiles?.[p]?.all;
		out.push(tile(`Passado ${SHORTW[p]}`, s ? P(s.spread, 2) : '—', s ? `sem a lição ${P(s.spreadRaw, 2)} · t ${n2(s.t)}` : 'não aberto', `2019 a 2026, vivido um dia de cada vez|Top 10 menos todos, por período, com a lição de cada dia`));
	}
	const L = ctx.lesson?.lessons?.swing;
	out.push(tile('Lição FIIs', L?.FII ? `60%→${pc(sixty(L.FII))}` : '—', L?.FII ? `1 mês · confiança ${n2(L.FII.beta)}` : '', 'Com o que o robô acertou e errou|o que uma chance de 60% vira'));
	out.push(tile('Lição ações', L?.Ação ? `60%→${pc(sixty(L.Ação))}` : '—', L?.Ação ? `1 mês · confiança ${n2(L.Ação.beta)}` : '', 'Com o que o robô acertou e errou|o que uma chance de 60% vira'));
	return `<div class="tiles">${out.join('')}</div>`;
}

/** The last bets that came due (sealed, or from the past while none sealed has), one per horizon. */
function lastScored(ctx) {
	const out = [];
	for (const p of PROFILES) {
		const own = ctx.scoreboard.profiles[p].list.at(-1);
		const s = own ?? ctx.past?.profiles?.[p]?.last?.at(-1);
		if (!s) continue;
		const t = shownTop(s);
		out.push(`<div class="card"><h2>${WORD[p]} · de ${dateBr(s.date)} a ${dateBr(s.end)} <span>${own ? 'lacrado' : 'do passado vivido'}</span></h2><p class="texto">Top 10: <b>${t.beat} de ${t.n}</b> acima da média do grupo (todos: ${R(s.all.beat, s.all.n)}) · <b>${P(t.mean - s.all.mean, 2)}</b> sobre todos</p>${shownPicks(s) ? picksLine(shownPicks(s)) : ''}</div>`);
	}
	return out.length ? `<div class="g3">${out.join('')}</div>` : '';
}

function lite(ctx) {
	const apply = ctx.lesson?.apply === true;
	const body = [topBar(ctx, '<a href="relatorio-avancado.html">Versão avançada →</a>')];
	body.push(`<p class="hero">${headline(ctx)}</p>`);
	body.push(rightOrWrong(ctx));
	body.push(tiles(ctx));
	body.push(lastScored(ctx));
	body.push(`<div class="g3">${PROFILES.map((p) => card(`Hoje · ${WORD[p]}`, apply ? 'chance corrigida pela lição' : 'chance do modelo', todayTable(ctx.today, p, apply))).join('')}</div>`);
	body.push(card('O que ele aprendeu com os próprios erros', `até ${dateBr(ctx.lesson?.asOf)}`, lessonGrid(ctx.lesson?.lessons)));
	if (ctx.past) body.push(card('O passado vivido um dia de cada vez · 1 mês', `${dateBr(ctx.past.from)} a ${dateBr(ctx.past.to)}`, cumulative(ctx.past.profiles.swing.series, ctx.horizons.swing)));
	return page('Diário do robô · lite', `<style>${EXTRA_CSS}</style>${body.join('\n')}`, [TIP_SCRIPT]);
}

function advanced(ctx) {
	const apply = ctx.lesson?.apply === true;
	const tabs = [];
	const panes = [];
	const add = (id, label, html) => {
		tabs.push(`<button type="button" role="tab" data-aba="${id}" aria-selected="false">${esc(label)}</button>`);
		panes.push(`<section class="aba" id="${id}" role="tabpanel">${html}</section>`);
	};
	add('resumo', 'Resumo', `<p class="hero">${headline(ctx)}</p>${rightOrWrong(ctx)}${tiles(ctx)}${lastScored(ctx)}${card('O teste da lição', 'regras fixadas antes, no plano', verdictTable(ctx.verdict))}`);
	add('hoje', 'Hoje', `<div class="g3">${PROFILES.map((p) => card(`${WORD[p]} · todos`, apply ? 'chance corrigida' : 'chance do modelo', todayTable(ctx.today, p, apply, true))).join('')}</div>`);
	add(
		'placar',
		'Placar',
		PROFILES.map((p) => {
			const s = ctx.scoreboard.profiles[p];
			const sum = s.sum;
			return card(`Lacrado · ${WORD[p]}`, sum.days ? `${sum.days} dias · Top 10 ${P(sum.spread, 2)} sobre todos (sem a lição ${P(sum.spreadRaw, 2)}) · t ${n2(sum.t)} em ${sum.tDays} dias separados · compras ${sum.buys ? `${pc(sum.buysBeat)} de ${sum.buys}` : '—'}` : 'nenhum vencido', scoredTable(s.list, ctx.horizons[p]));
		}).join('')
	);
	if (ctx.past) {
		add(
			'passado',
			'Passado',
			`${card('O teste da lição', '', verdictTable(ctx.verdict))}${PROFILES.map((p) => {
				const s = ctx.past.profiles[p];
				const hi = `60% ou mais: ${R(s.hi.beat, s.hi.n)} de ${s.hi.n} com a lição, ${R(s.hiRaw.beat, s.hiRaw.n)} de ${s.hiRaw.n} sem · compras ${R(s.buys.beat, s.buys.n)} de ${s.buys.n} com, ${R(s.buysRaw.beat, s.buysRaw.n)} de ${s.buysRaw.n} sem`;
				return `${card(`${WORD[p]} · acumulado`, hi, cumulative(s.series, ctx.horizons[p]))}${card(`${WORD[p]} · ano a ano`, 'por período; o t usa dias separados por um prazo', pastTable(s))}${card(`${WORD[p]} · as últimas apostas do passado`, '', scoredTable(s.last, ctx.horizons[p], 30))}`;
			}).join('')}`
		);
	}
	add('licao', 'Lição', `${card('Hoje', `até ${dateBr(ctx.lesson?.asOf)}`, lessonGrid(ctx.lesson?.lessons))}${ctx.past ? PROFILES.map((p) => card(`A confiança ao longo do tempo · ${WORD[p]}`, 'no começo de cada mês, no passado vivido', trustChart(ctx.past.profiles[p].path))).join('') : ''}`);
	add('lacres', 'Lacres', seals(ctx));
	const plan = existsSync(join(ctx.folder, 'plano.md')) ? readFileSync(join(ctx.folder, 'plano.md'), 'utf8') : '';
	if (plan) add('plano', 'Plano', `<div class="colunas">${markdownSections(plan).map((s) => card(s.title || 'Plano', '', `<div class="texto">${mdBody(s.lines)}</div>`)).join('')}</div>`);
	const body = `${topBar(ctx, '<a href="relatorio-lite.html">Versão lite →</a>')}<nav class="abas" role="tablist">${tabs.join('')}</nav>${panes.join('')}`;
	return page('Diário do robô · avançado', `<style>${EXTRA_CSS}</style>${body}`, [TIP_SCRIPT, TABS_SCRIPT]);
}

function seals(ctx) {
	const past = existsSync(join(ctx.folder, 'passado', 'lacre.json')) ? JSON.parse(readFileSync(join(ctx.folder, 'passado', 'lacre.json'), 'utf8')) : null;
	const registry = existsSync(join(ctx.folder, 'lacres.jsonl')) ? readFileSync(join(ctx.folder, 'lacres.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
	const pastHtml = past ? `<p class="texto">${past.days} pregões de ${dateBr(past.from)} a ${dateBr(past.to)}, lacrados em ${esc(new Date(past.sealedAt).toLocaleString('pt-BR'))}.<br>Chances: <code>${esc(past.entriesSha256)}</code><br>Motor ${esc(past.engine)}: <code>${esc(past.engineSha256)}</code></p>` : '<p class="muted">Não vivido.</p>';
	const days = registry.length
		? `<div class="rolar"><table class="num"><tr><th>Dia</th><th>Lacrado em</th><th>SHA-256</th><th>Conta na prova</th></tr>${[...registry]
				.reverse()
				.map((r) => `<tr><td>${dateBr(r.date)}</td><td>${esc(new Date(r.sealedAt).toLocaleString('pt-BR'))}</td><td><code>${esc(r.sha256.slice(0, 24))}…</code></td><td>${r.late ? 'não (refeito depois)' : 'sim'}</td></tr>`)
				.join('')}</table></div>`
		: '<p class="muted">Nenhum dia lacrado.</p>';
	return `${card('O passado', 'vivido de uma vez, lacrado antes de qualquer resultado', pastHtml)}${card('Os dias', 'cada um lacrado no próprio dia, depois do fechamento', days)}`;
}

/** Writes relatorio-lite.html and relatorio-avancado.html in ctx.folder. */
export function writeJournalReports(ctx) {
	APPLY = ctx.lesson?.apply === true;
	const lite_ = join(ctx.folder, 'relatorio-lite.html');
	const adv = join(ctx.folder, 'relatorio-avancado.html');
	writeFileSync(lite_, lite(ctx));
	writeFileSync(adv, advanced(ctx));
	return { lite: lite_, advanced: adv };
}
