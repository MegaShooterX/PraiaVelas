// The two reports of a blind experiment, written by experimento.mjs from its resultados.json:
// - relatorio-lite.html: one screen. The verdict in a sentence, eight numbers, hit rate by profile against
//   "always buy", and the map of every asset.
// - relatorio-avancado.html: everything, in tabs (Resumo, Lado a lado, Ativos, Decisões with filters,
//   Estratégias, Série, Futuro, Regras e lacre).
//
// Laid out like a BI dashboard (Rhuan, 08/11/2026): no margin and no outer edge, 3px of padding, panels touching
// and split by 1px lines, only data and the labels it needs; explanations live in the tooltips. On a wide
// screen the asset map lies down (assets as columns) so no corner of the screen is left empty.
//
// Colour (the dataviz guide): gain and loss are a diverging pair (blue / red, always with sign and arrow); right
// and wrong are status colours with an icon; the two engine versions are told apart by fill (old: hollow grey
// ring, new: filled). Text never wears a data colour. Light and dark themes have their own steps.

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const bold = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');
const P = (v, d = 1) => (Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(d).replace('.', ',')}%` : '—');
const R = (k, n) => (n ? `${Math.round((k / n) * 100)}%` : '—');
const ratio = (k, n) => (n ? k / n : NaN);
const brl = (v) => (Number.isFinite(v) ? v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');
const dateBr = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
const dateShort = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—');
const n2 = (v) => (Number.isFinite(v) ? v.toFixed(2).replace('.', ',').replace('-', '−') : '—');

const ACTION = {
	COMPRAR: { glyph: '▲', word: 'Comprou', cls: 'compra' },
	VENDER: { glyph: '▼', word: 'Vendeu', cls: 'venda' },
	'FICAR DE FORA': { glyph: '•', word: 'De fora', cls: 'fora' }
};
const TREND = { 1: 'em alta', '-1': 'em queda', 0: 'virando' };
const SHORT = { curto: 'Curto', swing: 'Swing', posicao: 'Posição' };
const RESULT = {
	certo: { icon: '✓', word: 'Acertou' },
	errado: { icon: '✗', word: 'Errou' },
	neutro: { icon: '○', word: 'Sem opinião' },
	aguarda: { icon: '◷', word: 'Aguardando' }
};
const resultOf = (d) => (d.pending ? 'aguarda' : d.forcedHit === null || d.forced === 0 ? 'neutro' : d.forcedHit ? 'certo' : 'errado');
const forcedWord = (f) => (f > 0 ? 'compra' : f < 0 ? 'venda' : 'sem opinião');
const glyphOf = (d) => (d.action === 'COMPRAR' ? '▲' : d.action === 'VENDER' ? '▼' : d.forced > 0 ? '↑' : d.forced < 0 ? '↓' : '·');

// ------------------------------------------------------------------------------------------------------ estilo

const DARK = '--page:#0d0d0d;--surface:#1a1a19;--surface-2:#242422;--ink:#f0efec;--ink-2:#c3c2b7;--muted:#898781;--grid:#2c2c2a;--axis:#4a4a46;--gain:#3987e5;--loss:#e66767;--accent:#3987e5;--good-text:#0ca30c;--bad:#e66767';
const CSS = `
:root{color-scheme:light;--page:#f9f9f7;--surface:#fcfcfb;--surface-2:#f0efec;--ink:#0b0b0b;--ink-2:#52514e;--muted:#898781;--grid:#e1e0d9;--axis:#c3c2b7;--gain:#2a78d6;--loss:#e34948;--accent:#2a78d6;--good-text:#006300;--bad:#d03b3b}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])){color-scheme:dark;${DARK}}}
:root[data-theme="dark"]{color-scheme:dark;${DARK}}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:var(--grid);color:var(--ink);font:13px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}
main{display:grid;gap:1px;margin:0;padding:0}
a{color:var(--accent);text-decoration:none}
p,ul,h1,h2,h3{margin:0}
.muted{color:var(--muted)}
.bar{display:flex;flex-wrap:wrap;align-items:baseline;gap:1px 8px;padding:3px 4px;background:var(--surface)}
.bar h1{font-size:14px;font-weight:750}
.bar .sub{font-size:11px;color:var(--ink-2)}
.bar .selo{font-size:11px;color:var(--ink-2);cursor:default}
.bar .selo b{color:var(--good-text)}
.bar .selo.ruim b{color:var(--bad)}
.volta{display:flex;gap:1px;background:var(--grid)}.volta a{flex:1;background:var(--surface);padding:5px 4px;text-align:center;font-size:12px;font-weight:650}.volta a:first-child{text-align:left}.volta a:last-child{text-align:right}
.hero{padding:3px 4px;background:var(--surface);font-size:13px;line-height:1.35}
.tiles{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:1px}
.tile{background:var(--surface);padding:3px 4px;min-width:0;cursor:default}
.tile .rot{font-size:9.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tile .val{font-size:17px;font-weight:700;line-height:1.15;font-variant-numeric:tabular-nums;white-space:nowrap}
.tile .val small{font-size:11px;font-weight:500;color:var(--ink-2)}
.tile .det{font-size:10.5px;color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.g2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px}
.g3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px}
.colunas{column-width:420px;column-gap:1px;column-rule:1px solid var(--grid);background:var(--surface)}
.colunas > .card{break-inside:avoid;border-bottom:1px solid var(--grid)}
.card{background:var(--surface);padding:3px 4px;min-width:0}
.card h2{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:700;margin:0 0 2px;display:flex;gap:8px;align-items:baseline}
.card h2 span{text-transform:none;letter-spacing:0;font-weight:500}
.legenda{display:flex;flex-wrap:wrap;gap:1px 10px;font-size:10.5px;color:var(--ink-2);margin:0 0 2px}
.legenda span{display:inline-flex;align-items:center;gap:4px}
.k{display:inline-block;flex:none}
.k.novo{width:9px;height:9px;border-radius:50%;background:var(--accent)}
.k.velho{width:9px;height:9px;border-radius:50%;border:2px solid var(--muted)}
.k.ref{width:2px;height:11px;background:var(--ink-2)}
.k.ganho{width:10px;height:10px;background:color-mix(in oklab,var(--gain) 45%,var(--surface))}
.k.perda{width:10px;height:10px;background:color-mix(in oklab,var(--loss) 45%,var(--surface))}
/* dot plot */
.dp-row,.dp-axis{display:grid;grid-template-columns:minmax(58px,92px) minmax(0,1fr) 66px;gap:4px;align-items:center}
.dp-row{min-height:24px;border-top:1px solid var(--grid)}
.dp-lab{font-size:12px;line-height:1.15}
.dp-lab small{display:block;color:var(--muted);font-size:9.5px}
.dp-val{font-size:11px;text-align:right;line-height:1.15;font-variant-numeric:tabular-nums;white-space:nowrap}
.dp-val b{font-size:13px}
.dp-val small{display:block;color:var(--muted);font-size:9.5px}
.dp-track{position:relative;height:22px;background:linear-gradient(to right,var(--grid) 1px,transparent 1px) 0 0/25% 100%;border-right:1px solid var(--grid)}
.dp-mid{position:absolute;left:50%;top:0;bottom:0;width:1px;background:var(--axis)}
.mk{position:absolute;top:50%;transform:translate(-50%,-50%)}
.mk::after{content:"";position:absolute;inset:-7px}
.mk.novo{width:10px;height:10px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 2px var(--surface);z-index:2}
.mk.velho{width:10px;height:10px;border-radius:50%;border:2px solid var(--muted);background:var(--surface);z-index:1}
.mk.ref{width:2px;height:16px;background:var(--ink-2)}
.mk:hover,.mk:focus-visible{outline:2px solid var(--ink-2);outline-offset:2px}
.dp-axis{font-size:9.5px;color:var(--muted)}
.dp-axis div{display:flex;justify-content:space-between;font-variant-numeric:tabular-nums}
/* asset map */
.mapa{width:100%;border-collapse:separate;border-spacing:1px;font-size:11.5px;table-layout:fixed}
.mapa th{font-weight:600;color:var(--muted);font-size:10px;text-align:center;padding:1px 0;line-height:1.1}
.mapa th.grupo{text-align:left;color:var(--ink-2);padding:2px 0 0;text-transform:uppercase;letter-spacing:.05em;font-size:9.5px}
.mapa td.tk{font-weight:650;white-space:nowrap;width:58px;padding:0 2px}
.cel{padding:3px 1px;text-align:center;white-space:nowrap;font-variant-numeric:tabular-nums;line-height:1.1;cursor:default;outline-offset:-1px}
.cel:hover,.cel:focus-visible{outline:1px solid var(--ink)}
.cel .g{font-weight:500;color:var(--ink-2);margin-right:3px}
.cel.agiu{box-shadow:inset 0 0 0 2px var(--ink)}
.cel.agiu .g{font-weight:800;color:var(--ink)}
.cel .s{margin-left:2px;font-size:10px;font-weight:800}
.s.certo,.res.certo{color:var(--good-text)}
.s.errado,.res.errado{color:var(--bad)}
.s.neutro,.res.neutro,.s.aguarda,.res.aguarda{color:var(--muted)}
.mapa.deitado{display:none}
.mapa.deitado th{font-size:9.5px;writing-mode:vertical-rl;transform:rotate(180deg);height:46px;padding:1px 0}
.mapa.deitado th.grupo{writing-mode:horizontal-tb;transform:none;height:auto;text-align:left}
.mapa.deitado td.tk{width:44px;font-size:10.5px}
.mapa.deitado .cel{font-size:10.5px;padding:2px 0}
.mapa.deitado .cel .g{display:block;margin:0}
.leg-mapa{display:flex;flex-wrap:wrap;gap:1px 10px;font-size:10.5px;color:var(--ink-2);margin-top:2px}
.leg-mapa span{display:inline-flex;align-items:center;gap:3px}
/* tabs, filters */
nav.abas{position:sticky;top:0;z-index:9;display:flex;gap:1px;overflow-x:auto;scrollbar-width:none;background:var(--grid)}
nav.abas::-webkit-scrollbar{display:none}
nav.abas button,.chip{flex:none;border:0;background:var(--surface);color:var(--ink-2);padding:5px 9px;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
nav.abas button[aria-selected="true"],.chip[aria-pressed="true"]{background:var(--ink);color:var(--page)}
.aba{display:grid;gap:1px}
.aba[hidden]{display:none}
.filtros{display:grid;gap:1px;background:var(--grid)}
.filtros div{display:flex;gap:1px;overflow-x:auto;scrollbar-width:none;align-items:stretch;background:var(--grid)}
.filtros div > span{background:var(--surface);font-size:9.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);padding:5px 4px;min-width:62px;display:flex;align-items:center}
.contagem{background:var(--surface);font-size:11px;color:var(--muted);padding:2px 4px}
/* decision cards */
.grade{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr));gap:1px}
.dec{background:var(--surface);padding:3px 4px;min-width:0}
.dec[hidden]{display:none}
.dec header{display:flex;gap:6px;align-items:baseline;flex-wrap:wrap}
.dec header b{font-size:13px}
.dec .seg{color:var(--muted);font-size:10.5px;flex:1;min-width:70px}
.badge{font-size:10.5px;font-weight:700;padding:1px 5px;border-radius:3px;background:var(--surface-2);white-space:nowrap}
.badge.res{background:transparent;padding:0}
.spark{display:block;width:100%;height:54px;margin:2px 0}
.nums{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:var(--grid)}
.nums div{background:var(--surface-2);padding:1px 4px;min-width:0}
.nums span{display:block;font-size:9.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nums b{font-size:12.5px;font-variant-numeric:tabular-nums}
.frase{font-size:11.5px;color:var(--ink-2);margin-top:2px;line-height:1.3}
details{font-size:11.5px;margin-top:1px}
summary{cursor:pointer;color:var(--accent)}
details ul{padding-left:14px;margin:1px 0}
details li{color:var(--ink-2);margin:1px 0}
/* tables and text */
.rolar{overflow-x:auto}
table.num{border-collapse:collapse;width:100%;font-size:12px;font-variant-numeric:tabular-nums}
table.num th,table.num td{padding:2px 4px;border-top:1px solid var(--grid);text-align:right;white-space:nowrap}
table.num th{color:var(--muted);font-weight:600;font-size:9.5px;text-transform:uppercase;letter-spacing:.03em;border-top:0;white-space:normal;vertical-align:bottom}
table.num td:first-child,table.num th:first-child{text-align:left}
table.num tr.destaque td{font-weight:700}
.texto{font-size:12.5px;line-height:1.35}
.texto p{margin:0 0 2px}.texto ul{margin:0;padding-left:15px}.texto li{margin:1px 0}.texto h3{font-size:12px;margin:3px 0 1px}
code{background:var(--surface-2);padding:0 3px;border-radius:3px;font-size:11px;word-break:break-all}
.rodape{background:var(--surface);color:var(--muted);font-size:10px;padding:2px 4px}
#dica{position:fixed;z-index:20;pointer-events:none;background:var(--ink);color:var(--page);font-size:11.5px;line-height:1.35;padding:3px 6px;border-radius:3px;max-width:260px}
#dica b{font-size:12.5px}
@media (min-width:1200px){.mapa.em-pe.troca{display:none}.mapa.deitado{display:table}}
@media (max-width:900px){.tiles{grid-template-columns:repeat(4,minmax(0,1fr))}.g2,.g3{grid-template-columns:minmax(0,1fr)}}
@media (max-width:420px){.tile .val{font-size:15px}.tile .det{font-size:10px}.mapa td.tk{width:50px;font-size:11px}.mapa{font-size:11px}.dp-row,.dp-axis{grid-template-columns:56px minmax(0,1fr) 54px}}
`;

/** One tooltip for every mark with data-tip: hover, tap or focus shows it; the values are also on screen. */
const TIP_SCRIPT = `
(() => {
	const tip = document.createElement('div');
	tip.id = 'dica';
	tip.hidden = true;
	document.body.append(tip);
	let pinned = null;
	const show = (el, x, y) => {
		const [head, ...rest] = el.dataset.tip.split('|');
		tip.replaceChildren();
		const b = document.createElement('b');
		b.textContent = head;
		tip.append(b);
		for (const line of rest) tip.append(document.createElement('br'), document.createTextNode(line));
		tip.hidden = false;
		const w = tip.offsetWidth, h = tip.offsetHeight;
		tip.style.left = Math.max(2, Math.min(innerWidth - w - 2, x - w / 2)) + 'px';
		tip.style.top = (y - h - 10 < 2 ? y + 16 : y - h - 10) + 'px';
	};
	const hide = () => { tip.hidden = true; pinned = null; };
	document.addEventListener('pointermove', (e) => { const el = e.target.closest('[data-tip]'); if (e.pointerType !== 'mouse') return; if (el) show(el, e.clientX, e.clientY); else if (!pinned) tip.hidden = true; });
	document.addEventListener('click', (e) => { const el = e.target.closest('[data-tip]'); if (el && el !== pinned) { const r = el.getBoundingClientRect(); show(el, r.left + r.width / 2, r.top); pinned = el; } else hide(); });
	document.addEventListener('focusin', (e) => { const el = e.target.closest('[data-tip]'); if (el) { const r = el.getBoundingClientRect(); show(el, r.left + r.width / 2, r.top); } });
	document.addEventListener('focusout', hide);
	addEventListener('scroll', () => { if (!pinned) tip.hidden = true; }, { passive: true });
})();`;

const TABS_SCRIPT = `
(() => {
	const tabs = [...document.querySelectorAll('nav.abas button')];
	const open = (id, push) => {
		for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.aba === id));
		for (const s of document.querySelectorAll('.aba')) s.hidden = s.id !== id;
		if (push) history.replaceState(null, '', '#' + id);
		scrollTo({ top: 0 });
	};
	for (const t of tabs) t.addEventListener('click', () => open(t.dataset.aba, true));
	const start = location.hash.slice(1);
	open(tabs.some((t) => t.dataset.aba === start) ? start : tabs[0]?.dataset.aba, false);
	const state = { perfil: 'todos', acao: 'todas', res: 'todos' };
	const cards = [...document.querySelectorAll('.dec[data-perfil]')];
	const count = document.getElementById('contagem');
	const apply = () => {
		let shown = 0;
		for (const c of cards) {
			const ok = (state.perfil === 'todos' || c.dataset.perfil === state.perfil) && (state.acao === 'todas' || c.dataset.acao === state.acao) && (state.res === 'todos' || c.dataset.res === state.res);
			c.hidden = !ok;
			if (ok) shown++;
		}
		if (count) count.textContent = shown + ' de ' + cards.length + ' decisões';
	};
	for (const chip of document.querySelectorAll('.chip[data-filtro]')) {
		chip.addEventListener('click', () => {
			state[chip.dataset.filtro] = chip.dataset.valor;
			for (const c of document.querySelectorAll('.chip[data-filtro="' + chip.dataset.filtro + '"]')) c.setAttribute('aria-pressed', String(c === chip));
			apply();
		});
	}
	apply();
})();`;

// ------------------------------------------------------------------------------------------------------ peças

function page(title, body, scripts) {
	return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style></head>
<body><main>
${body}
<p class="rodape">PraiaVelas · estudo estatístico e educativo, não é recomendação de investimento. O passado não garante o futuro.</p>
</main>
<script>${scripts.join('\n')}</script>
</body></html>`;
}

const tile = (label, value, detail, tip) =>
	`<div class="tile"${tip ? ` data-tip="${esc(tip)}" tabindex="0"` : ''}><div class="rot">${esc(label)}</div><div class="val">${value}</div><div class="det">${detail ?? '&nbsp;'}</div></div>`;

const card = (title, extra, html, cls = '') => `<section class="card ${cls}"><h2>${esc(title)}${extra ? ` <span>${extra}</span>` : ''}</h2>${html}</section>`;

/** rows: [{ label, note, mine, old, ref, value, valueNote, tipMine, tipOld, tipRef }], mine/old/ref in 0..1. */
function dotPlot(rows, legend) {
	const pos = (v) => `${Math.max(0, Math.min(100, v * 100)).toFixed(1)}%`;
	return `${legend ? `<div class="legenda">${legend}</div>` : ''}${rows
		.map(
			(r) => `<div class="dp-row"><div class="dp-lab">${esc(r.label)}${r.note ? `<small>${esc(r.note)}</small>` : ''}</div><div class="dp-track"><span class="dp-mid"></span>${Number.isFinite(r.ref) ? `<span class="mk ref" style="left:${pos(r.ref)}" data-tip="${esc(r.tipRef)}" tabindex="0"></span>` : ''}${Number.isFinite(r.old) ? `<span class="mk velho" style="left:${pos(r.old)}" data-tip="${esc(r.tipOld)}" tabindex="0"></span>` : ''}${Number.isFinite(r.mine) ? `<span class="mk novo" style="left:${pos(r.mine)}" data-tip="${esc(r.tipMine)}" tabindex="0"></span>` : ''}</div><div class="dp-val">${r.value}${r.valueNote ? `<small>${r.valueNote}</small>` : ''}</div></div>`
		)
		.join('')}<div class="dp-axis"><span></span><div><span>0</span><span>25</span><span>50%</span><span>75</span><span>100</span></div><span></span></div>`;
}

const tint = (ret) => {
	if (!Number.isFinite(ret)) return 'var(--surface-2)';
	const strength = Math.round(10 + Math.min(1, Math.abs(ret) / 0.12) * 45);
	return `color-mix(in oklab, var(${ret >= 0 ? '--gain' : '--loss'}) ${strength}%, var(--surface))`;
};

function spark(d) {
	if (!d.path?.length) return '';
	const W = 320;
	const H = 54;
	const values = d.path;
	const cone = d.cone;
	const lo = Math.min(...values, cone ? cone.p5 : Infinity);
	const hi = Math.max(...values, cone ? cone.p95 : -Infinity);
	const x = (i) => 2 + (i / (values.length - 1)) * (W - 16);
	const y = (v) => 3 + ((hi - v) / (hi - lo || 1)) * (H - 6);
	const line = (from, to) => values.slice(from, to + 1).map((v, k) => `${x(from + k).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
	const k = d.pathDecision;
	const after = d.totalRet >= 0 ? 'var(--gain)' : 'var(--loss)';
	const xe = W - 6;
	const coneSvg = cone
		? `<rect x="${xe - 4}" y="${y(cone.p95).toFixed(1)}" width="8" height="${(y(cone.p5) - y(cone.p95)).toFixed(1)}" fill="var(--accent)" opacity=".18"/><rect x="${xe - 4}" y="${y(cone.p75).toFixed(1)}" width="8" height="${(y(cone.p25) - y(cone.p75)).toFixed(1)}" fill="var(--accent)" opacity=".45"/>`
		: '';
	return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="spark" role="img" aria-label="Preço de ${esc(d.ticker)} antes (cinza) e depois (cor) da decisão; à direita, o cone projetado">
<line x1="${x(k).toFixed(1)}" y1="0" x2="${x(k).toFixed(1)}" y2="${H}" stroke="var(--axis)" stroke-width="1" vector-effect="non-scaling-stroke"/>${coneSvg}
<polyline points="${line(0, k)}" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
<polyline points="${line(k, values.length - 1)}" fill="none" stroke="${after}" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
}

function markdownSections(text) {
	const sections = [];
	let cur = null;
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trimEnd();
		if (line.startsWith('## ')) sections.push((cur = { title: line.slice(3).trim(), lines: [] }));
		else {
			if (!cur) sections.push((cur = { title: '', lines: [] }));
			cur.lines.push(line);
		}
	}
	return sections.filter((s) => s.title || s.lines.some((l) => l.trim()));
}

/**
 * The little Markdown the conclusions use: paragraphs, "### " titles, bold, and lists nested by two spaces. A
 * paragraph indented under an item stays inside that item.
 */
function mdBody(lines) {
	const html = [];
	let depth = -1;
	const itemOpen = [];
	const closeTo = (d) => {
		while (depth > d) {
			if (itemOpen[depth]) html.push('</li>');
			html.push('</ul>');
			itemOpen[depth] = false;
			depth--;
		}
	};
	for (const line of lines) {
		const item = line.match(/^( *)- (.*)$/);
		if (item) {
			const d = Math.min(Math.floor(item[1].length / 2), depth + 1);
			if (d > depth) {
				html.push('<ul>');
				depth = d;
				itemOpen[d] = false;
			} else closeTo(d);
			if (itemOpen[d]) html.push('</li>');
			html.push(`<li>${bold(item[2])}`);
			itemOpen[d] = true;
			continue;
		}
		if (!line.trim()) continue;
		if (/^ {2,}\S/.test(line) && depth >= 0) {
			closeTo(0);
			html.push(`<p>${bold(line.trim())}</p>`);
			continue;
		}
		closeTo(-1);
		if (line.startsWith('### ')) html.push(`<h3>${bold(line.slice(4))}</h3>`);
		else html.push(`<p>${bold(line)}</p>`);
	}
	closeTo(-1);
	return html.join('');
}

// ------------------------------------------------------------------------------------------------------ modelo

function buildModel(res, ctx) {
	const version = res.version ?? ctx.firstVersion;
	const recent = res.decisions.filter((d) => d.group === 'recente' && !d.pending);
	const future = res.decisions.filter((d) => d.group === 'futuro');
	let other = null;
	if (res.comparedWith) {
		const file = join(ctx.base, 'experimentos', res.comparedWith, 'resultados.json');
		if (existsSync(file)) {
			const o = JSON.parse(readFileSync(file, 'utf8'));
			other = { version: o.version ?? ctx.firstVersion, folder: res.comparedWith, recent: o.decisions.filter((d) => d.group === 'recente' && !d.pending) };
		}
	}
	const file = join(ctx.folder, 'conclusoes.md');
	return {
		res,
		ctx,
		version,
		recent,
		future,
		other,
		seriesOn: res.series?.some((s) => s.all.n),
		sections: existsSync(file) ? markdownSections(readFileSync(file, 'utf8')) : [],
		profiles: [...new Set(recent.map((d) => d.profile))],
		dates: [...new Set(recent.map((d) => d.date))].sort(),
		offsets: res.recentConfig?.offsets ?? [...new Set(recent.map((d) => d.offset))],
		summarize: ctx.summarize,
		// 0.0.3+: the test of the top 10 (by profile), and the top 10 sealed for the future.
		rank: (res.ranking?.profiles ?? []).filter((p) => p.periods?.length),
		sealedTops: (res.ranking?.profiles ?? []).filter((p) => p.sealedTop)
	};
}

const titleOf = (m) => (m.recent.length ? `Teste às cegas · ${m.offsets.join(', ')} pregões atrás` : m.future.length ? 'Teste daqui para frente' : m.rank.length ? 'Prova do Top 10' : 'Teste às cegas');

// ------------------------------------------------------------------------------------------------------ top 10

const MAIN = 'swing';
const mainRank = (m) => m.rank.find((p) => p.profile === MAIN) ?? m.rank[0];

/** The numbers of the top 10 test in one profile: did the 10 picked by the bot earn more than all of them? */
function rankTiles(prof) {
	const s = prof.all;
	const t = (v) => (Number.isFinite(v) ? v.toFixed(1).replace('.', ',') : '—');
	return `<div class="tiles">
${tile('Top 10 × CDI', P(s.top, 2), 'por período, média', `Top 10|rendeu ${P(s.top, 2)} acima do CDI por período, na média`)}
${tile('Todos × CDI', P(s.all, 2), `${prof.all.periods} períodos`, `Todos os ativos|${P(s.all, 2)} acima do CDI por período`)}
${tile('Diferença', P(s.spread, 2), `t ${t(s.spreadT)}`, `Top 10 menos todos|${P(s.spread, 2)} por período · t ${t(s.spreadT)} (2 ou mais: difícil ser sorte)`)}
${tile('Top 10 ganhou', R(s.topWon * 100, 100), 'dos períodos', 'Em quantos períodos o top 10 rendeu mais que a média de todos')}
${tile('Top 10 bateu CDI', R(s.topShare * 100, 100), `todos: ${R(s.allShare * 100, 100)}`, 'Dos ativos do top 10, quantos renderam mais que o CDI (contra todos)')}
${tile('Piores 10', P(s.bottom, 2), 'acima do CDI', 'Os 10 com menor chance: se a ordem vale, eles rendem menos')}
${tile('FIIs: top 10', P(s.fiiSpread, 2), `ganhou ${R(s.fiiWon * 100, 100)}`, 'Os 10 melhores FIIs menos todos os FIIs, por período')}
${tile('Ações: top 5', P(s.acaoSpread, 2), `ganhou ${R(s.acaoWon * 100, 100)}`, 'As 5 melhores ações menos todas as ações, por período')}
</div>`;
}

/** The sum over time of what the top 10 and all of them earned above the CDI: two lines that should part ways. */
function rankChart(prof) {
	const ps = prof.periods;
	if (ps.length < 2) return '';
	let a = 0;
	let b = 0;
	let w = 0;
	const top = [];
	const all = [];
	const bot = [];
	for (const x of ps) {
		top.push((a += x.top));
		all.push((b += x.all));
		bot.push((w += x.bottom));
	}
	const W = 640;
	const H = 170;
	const lo = Math.min(0, ...top, ...all, ...bot);
	const hi = Math.max(0, ...top, ...all, ...bot);
	const x = (i) => 30 + (i / (ps.length - 1)) * (W - 40);
	const y = (v) => 8 + ((hi - v) / (hi - lo || 1)) * (H - 26);
	const line = (vs) => vs.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
	const years = [...new Set(ps.map((p) => p.date.slice(0, 4)))];
	const ticks = years.map((yr) => {
		const i = ps.findIndex((p) => p.date.startsWith(yr));
		return `<text x="${x(i).toFixed(1)}" y="${H - 4}" fill="var(--muted)" font-size="10" text-anchor="middle">${yr}</text><line x1="${x(i).toFixed(1)}" y1="6" x2="${x(i).toFixed(1)}" y2="${H - 18}" stroke="var(--grid)"/>`;
	});
	return `<div class="legenda"><span><i class="k novo"></i>Top 10</span><span><i class="k velho"></i>todos</span><span><i class="k ref"></i>piores 10</span><span class="muted">soma do que renderam acima do CDI, período a período</span></div>
<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img" aria-label="Acumulado acima do CDI: top 10, todos e piores 10">
${ticks.join('')}
<line x1="30" y1="${y(0).toFixed(1)}" x2="${W - 10}" y2="${y(0).toFixed(1)}" stroke="var(--axis)"/>
<text x="26" y="${(y(0) + 3).toFixed(1)}" fill="var(--muted)" font-size="10" text-anchor="end">CDI</text>
<polyline points="${line(bot)}" fill="none" stroke="var(--ink-2)" stroke-width="1.2" stroke-dasharray="none" opacity=".55"/>
<polyline points="${line(all)}" fill="none" stroke="var(--muted)" stroke-width="2"/>
<polyline points="${line(top)}" fill="none" stroke="var(--accent)" stroke-width="2"/>
<text x="${W - 8}" y="${(y(top.at(-1)) - 4).toFixed(1)}" fill="var(--ink)" font-size="11" text-anchor="end">${P(top.at(-1), 0)}</text>
<text x="${W - 8}" y="${(y(all.at(-1)) + 12).toFixed(1)}" fill="var(--ink-2)" font-size="11" text-anchor="end">${P(all.at(-1), 0)}</text>
</svg>`;
}

function rankYears(prof) {
	const head = '<tr><th>Ano</th><th>Períodos</th><th>Top 10</th><th>Todos</th><th>Diferença</th><th>t</th><th>Top ganhou</th><th>FIIs top10 − todos</th><th>Ações top5 − todas</th></tr>';
	const row = (label, s, strong) =>
		`<tr${strong ? ' class="destaque"' : ''}><td>${label}</td><td>${s.periods}</td><td>${P(s.top, 2)}</td><td>${P(s.all, 2)}</td><td class="${s.spread > 0 ? 'res certo' : 'res errado'}">${P(s.spread, 2)}</td><td>${Number.isFinite(s.spreadT) ? s.spreadT.toFixed(1).replace('.', ',') : '—'}</td><td>${R(s.topWon * 100, 100)}</td><td>${P(s.fiiSpread, 2)}</td><td>${P(s.acaoSpread, 2)}</td></tr>`;
	return `<div class="rolar"><table class="num">${head}${row('Tudo', prof.all, true)}${prof.byYear.map((y) => row(y.year, y)).join('')}</table></div>`;
}

function rankCalib(prof) {
	return `<div class="rolar"><table class="num"><tr><th>Chance dita</th><th>Decisões</th><th>Média dita</th><th>${prof.target === 'grupo' ? 'Bateu a média do grupo de fato' : 'Bateu o CDI de fato'}</th></tr>${prof.calibration
		.map((c) => `<tr><td>${Math.round(c.lo * 100)}–${Math.min(100, Math.round(c.hi * 100))}%</td><td>${c.n}</td><td>${c.n ? R(c.said * 100, 100) : '—'}</td><td><b>${c.n ? R(c.beat * 100, 100) : '—'}</b></td></tr>`)
		.join('')}</table></div>`;
}

/** The last periods' picks: what the bot would have put in the top 10, and what each did above the CDI. */
function rankPicks(prof, last = 6) {
	const ps = prof.periods.slice(-last).reverse();
	return `<div class="rolar"><table class="num"><tr><th>Data</th><th class="esq">Top 10 escolhido (acima do CDI no prazo)</th><th>Top</th><th>Todos</th></tr>${ps
		.map((x) => `<tr><td>${dateBr(x.date)}</td><td class="esq" style="white-space:normal">${x.picks.map((k) => `<span class="${k.e > 0 ? 'res certo' : 'res errado'}">${k.t} ${P(k.e, 0)}</span>`).join(' · ')}</td><td>${P(x.top, 1)}</td><td>${P(x.all, 1)}</td></tr>`)
		.join('')}</table></div>`;
}

/** The top 10 sealed on the last close: nobody knows yet how it will do. */
function sealedTop(m) {
	return m.sealedTops
		.map((p) => {
			const s = p.sealedTop;
			return card(
				`Top 10 lacrado · ${HORIZON_WORD[p.profile]}`,
				`decidido em ${dateBr(s.date)} · abre ~${dateBr(s.opensAround)}`,
				`<div class="rolar"><table class="num"><tr><th>#</th><th class="esq">Ativo</th><th>Chance</th><th class="esq">Robô</th></tr>${s.top
					.map((k, i) => `<tr><td>${i + 1}</td><td class="esq"><b>${k.t}</b> <small class="muted">${esc(k.segment ?? '')}</small></td><td>${Math.round(k.p * 100)}%</td><td class="esq">${ACTION[k.action]?.word ?? k.action}</td></tr>`)
					.join('')}</table></div>`
			);
		})
		.join('');
}
const HORIZON_WORD = { curto: '1 semana', swing: '1 mês', posicao: '3 meses' };

function topBar(m, link) {
	const r = m.res;
	let sub;
	if (m.recent.length) {
		const end = m.recent.reduce((a, d) => (d.endDate > a ? d.endDate : a), '');
		sub = `motor ${esc(m.version)} · decisões ${m.dates.map(dateShort).join(', ')}/${m.dates[0].slice(0, 4)} · conferidas até ${dateBr(end)} · ${m.recent.length} decisões`;
	} else if (m.future.length) sub = `motor ${esc(m.version)} · fechamento de ${dateBr(m.future[0].date)} · ${m.future.length} decisões lacradas`;
	else if (m.rank.length) {
		const ps = mainRank(m).periods;
		sub = `motor ${esc(m.version)} · uma data a cada 21 pregões de ${dateBr(ps[0].date)} a ${dateBr(ps.at(-1).date)} · ${r.seal.count} decisões`;
	} else sub = `motor ${esc(m.version)} · ${r.seal.count} decisões`;
	const seal = r.engineUnchanged
		? `<span class="selo" data-tip="Lacre conferido|decisões ${esc(r.seal.decisionsSha256.slice(0, 16))}…|motor ${esc(r.engineVersion)} ${esc(r.seal.engineSha256.slice(0, 16))}…" tabindex="0"><b>✓</b> lacre · motor ${esc(r.engineVersion)} congelado</span>`
		: '<span class="selo ruim"><b>!</b> motor mudou depois do lacre</span>';
	// The way back: the list of tests and the app (both served by ferramentas/servidor.mjs), and the other version.
	return `<nav class="volta"><a href="../">← Testes</a><a href="/">App</a>${link}</nav><div class="bar"><h1>${esc(titleOf(m))}</h1><span class="sub">${sub}</span>${seal}</div>`;
}

/** Eight numbers of the recent test. */
function recentTiles(m) {
	const s = m.summarize(m.recent);
	const widest = m.recent.reduce((a, d) => ((d.checkDays ?? 0) > (a?.checkDays ?? -1) ? d : a), null);
	const idx = (kind) => m.recent.find((d) => d.kind === kind && d.date === widest.date && d.endDate === widest.endDate)?.index;
	const fii = idx('FII');
	const acao = idx('Ação');
	const win = `${dateShort(widest.date)} a ${dateShort(widest.endDate)}`;
	return `<div class="tiles">
${tile('Forçado', `${R(s.forcedHits, s.forcedN)}`, `${s.forcedHits} de ${s.forcedN}`, `Veredito forçado|o lado que escolheria se fosse obrigado|${s.forcedHits} acertos em ${s.forcedN} decisões com opinião`)}
${tile('Só comprar', `${R(s.up, s.n)}`, `${s.up} de ${s.n} subiram`, `Sempre comprar|o acerto de quem só compra: a régua justa`)}
${tile('Sem opinião', `${s.noOpinion}`, `de ${s.n} decisões`, 'Sem opinião|nota zero: nenhuma estratégia com peso ligada')}
${tile('Compras', `${s.buys}`, s.buys ? `${s.buyHits} subiram` : 'nenhuma', s.buys ? `Compras do robô|${s.buyHits} de ${s.buys} subiram` : '')}
${tile('Méd. compras', P(s.buyMean), s.buys ? `todos ${P(s.meanAll)}` : '—', s.buys ? `Retorno médio com dividendos|compras ${P(s.buyMean)}|todos os ativos ${P(s.meanAll)}|CDI ${P(s.meanCdi)}` : '')}
${tile('Vendas', `${s.sells}`, s.sells ? `${s.sellHits} caíram · ${P(s.sellMean)}` : 'nenhuma', s.sells ? `Vendas do robô|${s.sellHits} de ${s.sells} caíram depois|média depois da venda ${P(s.sellMean)}` : '')}
${tile('XFIX11', P(fii), win, `IFIX pelo XFIX11|${P(fii)} de ${dateBr(widest.date)} a ${dateBr(widest.endDate)}`)}
${tile('BOVA11', P(acao), win, `Ibovespa pelo BOVA11|${P(acao)} de ${dateBr(widest.date)} a ${dateBr(widest.endDate)}`)}
</div>`;
}

function futureTiles(m) {
	const profiles = [...new Set(m.future.map((d) => d.profile))];
	const acts = (a) => m.future.filter((d) => d.action === a).length;
	const forced = (f) => m.future.filter((d) => d.forced === f).length;
	const mk = m.future.find((d) => d.marketNow && d.kind === 'FII')?.marketNow;
	const mkA = m.future.find((d) => d.marketNow && d.kind === 'Ação')?.marketNow;
	const tiles = [
		tile('Decisões', `${m.future.length}`, acts('COMPRAR') + acts('VENDER') ? `${acts('COMPRAR')} compra · ${acts('VENDER')} venda` : 'nenhuma compra ou venda'),
		tile('De fora', `${acts('FICAR DE FORA')}`, `${forced(1)}↑ ${forced(-1)}↓ ${forced(0)}·`, `Lado que escolheria se fosse obrigado|${forced(1)} compra · ${forced(-1)} venda · ${forced(0)} sem opinião`),
		...profiles.map((p) => {
			const l = m.future.filter((d) => d.profile === p);
			return tile(`${SHORT[p]} abre`, dateShort(l[0].opensAround), `${l.filter((d) => d.pending).length} aguardando`);
		})
	];
	if (mk) tiles.push(tile('XFIX11', TREND[mk.trend], `agitação ${mk.volRatio.toFixed(1).replace('.', ',')}×`));
	if (mkA) tiles.push(tile('BOVA11', TREND[mkA.trend], `agitação ${mkA.volRatio.toFixed(1).replace('.', ',')}×`));
	while (tiles.length < 8) tiles.push(tile('', '&nbsp;', ''));
	return `<div class="tiles">${tiles.slice(0, 8).join('')}</div>`;
}

function hitChart(m) {
	const rows = [];
	for (const [label, keep, p] of [['Todas', () => true, ''], ...m.profiles.map((q) => [SHORT[q], (d) => d.profile === q, q])]) {
		const mine = m.recent.filter(keep);
		if (!mine.length) continue;
		const s = m.summarize(mine);
		const o = m.other ? m.summarize(m.other.recent.filter(keep)) : null;
		rows.push({
			label,
			note: !p ? `${mine.length} dec.` : mine.some((d) => d.partial) ? `${mine[0].checkDays}/${mine[0].horizonDays}p parcial` : `${mine[0].checkDays}p`,
			mine: ratio(s.forcedHits, s.forcedN),
			old: o ? ratio(o.forcedHits, o.forcedN) : NaN,
			ref: ratio(s.up, s.n),
			value: `<b>${R(s.forcedHits, s.forcedN)}</b>${o ? ` <span class="muted">${R(o.forcedHits, o.forcedN)}</span>` : ''}`,
			valueNote: `comprar ${R(s.up, s.n)}`,
			tipMine: `${R(s.forcedHits, s.forcedN)} · versão ${m.version}|${label}: ${s.forcedHits} de ${s.forcedN}${s.noOpinion ? ` (${s.noOpinion} sem opinião)` : ''}`,
			tipOld: o ? `${R(o.forcedHits, o.forcedN)} · versão ${m.other.version}|${label}: ${o.forcedHits} de ${o.forcedN}` : '',
			tipRef: `${R(s.up, s.n)} · sempre comprar|${label}: ${s.up} de ${s.n} subiram`
		});
	}
	return dotPlot(rows, `<span><i class="k novo"></i>${esc(m.version)}</span>${m.other ? `<span><i class="k velho"></i>${esc(m.other.version)}</span>` : ''}<span><i class="k ref"></i>sempre comprar</span>`);
}

/** Every asset at a glance. Standing (one row per asset) for narrow screens, lying down (one column per asset) for wide ones. */
function assetMap(m, list, { showResult = true } = {}) {
	const cols = [];
	for (const p of [...new Set(list.map((d) => d.profile))]) for (const date of [...new Set(list.filter((d) => d.profile === p).map((d) => d.date))].sort()) cols.push({ p, date });
	const multiDate = new Set(cols.map((c) => c.date)).size > 1;
	const multiProfile = new Set(cols.map((c) => c.p)).size > 1;
	const colName = (c) => [multiProfile || !multiDate ? SHORT[c.p] : '', multiDate ? dateShort(c.date) : ''].filter(Boolean).join(' ');
	const kinds = ['FII', 'Ação'].filter((k) => list.some((d) => d.kind === k));
	const tickersOf = (k) => [...new Set(list.filter((d) => d.kind === k).map((d) => d.ticker))];
	const find = (t, c) => list.find((d) => d.ticker === t && d.profile === c.p && d.date === c.date);
	const cell = (d, lying) => {
		if (!d) return '<td></td>';
		const r = resultOf(d);
		const tip = [
			`${d.ticker} · ${SHORT[d.profile]}${multiDate ? ` · ${dateBr(d.date)}` : ''}`,
			`${ACTION[d.action].word}${d.action === 'FICAR DE FORA' ? ` (forçado: ${forcedWord(d.forced)})` : ''} · nota ${n2(d.score)} · ${d.confidence}`,
			d.pending ? `aguarda até ${dateBr(d.opensAround)}` : `com dividendos ${P(d.totalRet)}${d.partial ? ` (${d.checkDays}/${d.horizonDays} pregões)` : ''} · ${RESULT[r].word.toLowerCase()}`,
			d.pending ? '' : `média dos ${d.kind === 'FII' ? 'FIIs' : 'ações'} ${P(d.market)}`
		]
			.filter(Boolean)
			.join('|');
		const bg = d.pending || !showResult ? 'var(--surface-2)' : tint(d.totalRet);
		const mark = showResult && !d.pending ? `<span class="s ${r}">${RESULT[r].icon}</span>` : '';
		const value = d.pending ? `abre ${dateShort(d.opensAround)}` : P(d.totalRet, lying ? 0 : 1);
		return `<td class="cel${d.action === 'FICAR DE FORA' ? '' : ' agiu'}" style="background:${bg}" data-tip="${esc(tip)}" tabindex="0"><span class="g">${glyphOf(d)}${lying ? mark : ''}</span>${value}${lying ? '' : mark}</td>`;
	};
	const standing = `<table class="mapa em-pe${cols.length <= 4 ? ' troca' : ''}"><thead><tr><th></th>${cols.map((c) => `<th>${colName(c)}</th>`).join('')}</tr></thead><tbody>${kinds
		.map((k) => `<tr><th class="grupo" colspan="${cols.length + 1}">${k === 'FII' ? 'FIIs' : 'Ações'}</th></tr>${tickersOf(k).map((t) => `<tr><td class="tk">${t}</td>${cols.map((c) => cell(find(t, c), false)).join('')}</tr>`).join('')}`)
		.join('')}</tbody></table>`;
	// Lying down: only when there are few readings (3 profiles or dates), else the standing table already fills the width.
	const all = kinds.flatMap((k) => tickersOf(k).map((t) => [k, t]));
	const lying =
		cols.length <= 4
			? `<table class="mapa deitado"><thead><tr><th class="grupo"></th>${kinds.map((k) => `<th class="grupo" colspan="${tickersOf(k).length}">${k === 'FII' ? 'FIIs' : 'Ações'}</th>`).join('')}</tr><tr><th></th>${all.map(([, t]) => `<th>${t}</th>`).join('')}</tr></thead><tbody>${cols
					.map((c) => `<tr><td class="tk">${colName(c)}</td>${all.map(([, t]) => cell(find(t, c), true)).join('')}</tr>`)
					.join('')}</tbody></table>`
			: '';
	const legend = `<div class="leg-mapa"><span><b>▲</b>comprou <b>▼</b>vendeu (contorno)</span><span><b>↑↓·</b>de fora, lado forçado</span>${showResult ? `<span><i class="k ganho"></i>subiu <i class="k perda"></i>caiu</span><span class="res certo">✓</span><span class="res errado">✗</span><span class="res neutro">○ sem opinião</span>` : ''}</div>`;
	return standing + lying + legend;
}

function decisionCard(m, d) {
	const a = ACTION[d.action];
	const r = resultOf(d);
	const name = (s) => m.ctx.strategyName(s.id);
	const pushed = d.pending ? [] : d.strategies.filter((s) => s.weight > 0 && s.now !== 0);
	const right = pushed.filter((s) => Math.sign(d.totalRet) === s.now).map(name);
	const wrong = pushed.filter((s) => Math.sign(d.totalRet) !== s.now).map(name);
	const kindWord = d.kind === 'FII' ? 'FIIs' : 'ações';
	const same = Math.sign(d.market) === Math.sign(d.totalRet);
	const why = d.pending
		? `Abre ~${dateBr(d.opensAround)}.`
		: r === 'neutro'
			? 'Nenhuma estratégia com peso ligada.'
			: r === 'certo'
				? `${right.length ? right.join(', ') : 'Acertou'}${same ? '; o mercado foi junto.' : '; contra o mercado.'}`
				: `${wrong.length ? `${wrong.join(', ')} erraram o lado` : 'Errou'}${same ? `; o mercado inteiro foi contra (${P(d.market)}).` : '.'}`;
	const mk = d.marketNow;
	const win = d.pending ? '' : `${d.checkDays ?? d.horizonDays}${d.partial ? `/${d.horizonDays}` : ''}p`;
	return `<article class="dec" data-perfil="${d.profile}" data-acao="${a.cls}" data-res="${r}">
<header><b>${d.ticker}</b><span class="seg">${esc(d.segment)} · ${SHORT[d.profile]} · ${dateShort(d.date)}</span><span class="badge">${a.glyph} ${a.word}${d.action === 'FICAR DE FORA' ? ` ${glyphOf(d)}` : ''}</span><span class="badge res ${r}">${RESULT[r].icon} ${RESULT[r].word}</span></header>
${spark(d)}
<div class="nums"><div><span>${d.pending ? 'Preço' : `Resultado ${win}`}</span><b>${d.pending ? brl(d.price) : P(d.totalRet)}</b></div><div><span>${d.pending ? 'Mercado' : `Média ${kindWord}`}</span><b>${d.pending ? (mk ? `${mk.ticker} ${TREND[mk.trend]}` : '—') : P(d.market)}</b></div><div><span>Nota · ${esc(d.confidence)}</span><b>${n2(d.score)}</b></div></div>
<p class="frase">${esc(why)}${mk ? ` <span class="muted">${mk.ticker} ${TREND[mk.trend]}, ${mk.volRatio.toFixed(2).replace('.', ',')}×.</span>` : ''}</p>
<details><summary>Motivos</summary><ul>${[...(d.blockers ?? []).map((b) => `<li><b>Travou:</b> ${esc(b)}</li>`), ...(d.reasons ?? []).map((x) => `<li>${esc(x)}</li>`)].join('')}</ul></details>
</article>`;
}

function numbersTable(rows) {
	const head = '<tr><th></th><th>n</th><th>Forçado</th><th>Comprar</th><th>Compras ↑</th><th>Méd. compras</th><th>Vendas ↓</th><th>Méd. após vender</th><th>Fora</th><th>Média</th><th>CDI</th><th>Cone 50/90</th></tr>';
	const row = ([label, s, strong]) =>
		`<tr${strong ? ' class="destaque"' : ''}><td>${esc(label)}</td><td>${s.n}</td><td>${R(s.forcedHits, s.forcedN ?? s.n)}${s.noOpinion ? `<small class="muted"> ${s.noOpinion}○</small>` : ''}</td><td>${R(s.up, s.n)}</td><td>${s.buys ?? 0}·${R(s.buyHits, s.buys)}</td><td>${P(s.buyMean)}</td><td>${s.sells ?? 0}·${R(s.sellHits, s.sells)}</td><td>${P(s.sellMean)}</td><td>${s.outs ?? 0}</td><td>${P(s.meanAll)}</td><td>${P(s.meanCdi)}</td><td>${(s.coned ?? 0) > 0 ? `${R(s.cone50 * 100, 100)}/${R(s.cone90 * 100, 100)}` : '—'}</td></tr>`;
	return `<div class="rolar"><table class="num">${head}${rows.map(row).join('')}</table></div>`;
}

function strategyChart(rows) {
	return dotPlot(
		rows.map((s) => ({
			label: s.name.replace('Cruzamento de médias', 'Médias').replace('Padrões de candle', 'Candles').replace('Tendência longa', 'Tendência'),
			note: `${s.n} sinais`,
			mine: s.n ? s.hit : NaN,
			ref: s.baseHit,
			value: `<b>${s.n ? R(s.hit * 100, 100) : '—'}</b>`,
			valueNote: `acaso ${Number.isFinite(s.baseHit) ? R(s.baseHit * 100, 100) : '—'}`,
			tipMine: `${R(s.hit * 100, 100)} de acerto|${s.name}: ${s.n} sinais|com peso: ${s.counted.n}, ${R(s.counted.hit * 100, 100)}`,
			tipRef: `${R(s.baseHit * 100, 100)} · acaso|a mesma mistura de altas e baixas sem estratégia`
		})),
		'<span><i class="k novo"></i>acerto</span><span><i class="k ref"></i>acaso</span>'
	);
}

// ------------------------------------------------------------------------------------------------------ lite

function lite(m) {
	const first = m.sections[0];
	const hero = first ? first.lines.find((l) => l.trim() && !l.startsWith('- ')) : null;
	const bullets = first ? first.lines.filter((l) => l.startsWith('- ')).slice(0, 5) : [];
	const body = [topBar(m, '<a href="relatorio-avancado.html">Versão avançada →</a>')];
	if (hero) body.push(`<p class="hero">${bold(hero)}</p>`);
	if (m.recent.length) {
		body.push(recentTiles(m));
		body.push(`<div class="g2">${card('Acerto do veredito forçado', 'contra sempre comprar', hitChart(m))}${bullets.length ? card('Em poucas palavras', '', `<div class="texto">${mdBody(bullets)}</div>`) : ''}</div>`);
		body.push(card('Cada ativo', 'cor: o que veio depois, com dividendos', assetMap(m, m.recent)));
	} else if (m.future.length) {
		body.push(futureTiles(m));
		if (bullets.length) body.push(card('Em poucas palavras', '', `<div class="texto">${mdBody(bullets)}</div>`));
		if (m.sealedTops.length) body.push(`<div class="g3">${sealedTop(m)}</div>`);
		body.push(card('O que o robô decidiu', 'resultado ainda desconhecido', assetMap(m, m.future, { showResult: m.future.some((d) => !d.pending) })));
	} else if (m.rank.length) {
		const main = mainRank(m);
		body.push(rankTiles(main));
		body.push(`<div class="g2">${card(`Top 10 contra todos · ${HORIZON_WORD[main.profile]}`, 'acumulado acima do CDI', rankChart(main))}${bullets.length ? card('Em poucas palavras', '', `<div class="texto">${mdBody(bullets)}</div>`) : card('Ano a ano', '', rankYears(main))}</div>`);
		body.push(card('Ano a ano', `${HORIZON_WORD[main.profile]} · por período, acima do CDI`, rankYears(main)));
	}
	return page(`${titleOf(m)} · lite`, body.join('\n'), [TIP_SCRIPT]);
}

// ------------------------------------------------------------------------------------------------------ avançado

function advanced(m) {
	const tabs = [];
	const panes = [];
	const add = (id, label, html) => {
		tabs.push(`<button type="button" role="tab" data-aba="${id}" aria-selected="false">${esc(label)}</button>`);
		panes.push(`<section class="aba" id="${id}" role="tabpanel">${html}</section>`);
	};
	const conclusions = m.sections.length ? `<div class="colunas">${m.sections.map((s) => card(s.title || 'Conclusões', '', `<div class="texto">${mdBody(s.lines)}</div>`)).join('')}</div>` : '';

	if (m.recent.length) {
		const rows = [['Todas', m.summarize(m.recent), true], ...m.profiles.map((p) => [SHORT[p], m.summarize(m.recent.filter((d) => d.profile === p))]), ['FIIs', m.summarize(m.recent.filter((d) => d.kind === 'FII'))], ['Ações', m.summarize(m.recent.filter((d) => d.kind === 'Ação'))]];
		if (m.dates.length > 1) for (const date of m.dates) rows.push([dateBr(date), m.summarize(m.recent.filter((d) => d.date === date))]);
		add('resumo', 'Resumo', `${recentTiles(m)}<div class="g2">${card('Acerto do veredito forçado', 'contra sempre comprar', hitChart(m))}${card('Números', 'retorno com dividendos', numbersTable(rows))}</div>${conclusions}`);
	} else if (m.rank.length) {
		const main = mainRank(m);
		add('resumo', 'Resumo', `${rankTiles(main)}<div class="g2">${card(`Top 10 contra todos · ${HORIZON_WORD[main.profile]}`, 'acumulado acima do CDI', rankChart(main))}${card('Ano a ano', '', rankYears(main))}</div>${conclusions}`);
		for (const prof of m.rank) {
			add(
				`top-${prof.profile}`,
				`Top 10 · ${HORIZON_WORD[prof.profile]}`,
				`${rankTiles(prof)}<div class="g2">${card('Acumulado acima do CDI', '', rankChart(prof))}${card('Calibragem', prof.target === 'grupo' ? 'quando disse X%, quantas renderam mais que a média do grupo' : 'quando disse X%, quantas bateram o CDI', rankCalib(prof))}</div>${card('Ano a ano', '', rankYears(prof))}${card('Os últimos top 10', 'verde: rendeu mais que o CDI no prazo', rankPicks(prof, 12))}`
			);
		}
	} else add('resumo', 'Resumo', `${m.future.length ? futureTiles(m) : ''}${m.sealedTops.length ? `<div class="g3">${sealedTop(m)}</div>` : ''}${conclusions}`);

	if (m.other && m.recent.length) {
		const groups = [['Todas', () => true], ...m.profiles.map((p) => [SHORT[p], (d) => d.profile === p]), ['FIIs', (d) => d.kind === 'FII'], ['Ações', (d) => d.kind === 'Ação']];
		const rows = groups.flatMap(([label, keep]) => [
			[`${label} · ${m.other.version}`, m.summarize(m.other.recent.filter(keep))],
			[`${label} · ${m.version}`, m.summarize(m.recent.filter(keep)), true]
		]);
		const changed = m.recent.filter((d) => m.other.recent.some((x) => x.ticker === d.ticker && x.profile === d.profile && x.date === d.date && x.action !== d.action));
		const changedRows = changed
			.map((d) => {
				const o = m.other.recent.find((x) => x.ticker === d.ticker && x.profile === d.profile && x.date === d.date);
				return `<tr><td>${d.ticker}</td><td>${SHORT[d.profile]}</td><td>${ACTION[o.action].glyph} ${ACTION[o.action].word}</td><td>${ACTION[d.action].glyph} ${ACTION[d.action].word}</td><td>${P(d.totalRet)}</td></tr>`;
			})
			.join('');
		add(
			'lado',
			'Lado a lado',
			`<div class="g2">${card(`${m.other.version} × ${m.version}`, 'mesmas datas, ativos e dados', hitChart(m))}${card('Onde mudaram de ação', `${changed.length} de ${m.recent.length}`, `<div class="rolar"><table class="num"><tr><th>Ativo</th><th>Perfil</th><th>${esc(m.other.version)}</th><th>${esc(m.version)}</th><th>Veio</th></tr>${changedRows}</table></div>`)}</div>${card('Números das duas', '', numbersTable(rows))}`
		);
	}

	if (m.recent.length) add('ativos', 'Ativos', card('Cada ativo, cada leitura', 'cor: o que veio depois, com dividendos', assetMap(m, m.recent)));

	if (m.recent.length) {
		const chips = (key, options) => options.map(([v, label], i) => `<button type="button" class="chip" data-filtro="${key}" data-valor="${v}" aria-pressed="${i === 0}">${esc(label)}</button>`).join('');
		const filters = `<div class="filtros">${m.profiles.length > 1 ? `<div><span>Perfil</span>${chips('perfil', [['todos', 'Todos'], ...m.profiles.map((p) => [p, SHORT[p]])])}</div>` : ''}<div><span>Robô</span>${chips('acao', [['todas', 'Tudo'], ['compra', '▲ Comprou'], ['venda', '▼ Vendeu'], ['fora', '• De fora']])}</div><div><span>Resultado</span>${chips('res', [['todos', 'Todos'], ['certo', '✓ Acertou'], ['errado', '✗ Errou'], ['neutro', '○ Sem opinião']])}</div></div><p class="contagem" id="contagem"></p>`;
		const ordered = [...m.recent].sort((a, b) => (a.profile !== b.profile ? m.profiles.indexOf(a.profile) - m.profiles.indexOf(b.profile) : a.action !== b.action ? (a.action === 'FICAR DE FORA' ? 1 : -1) : a.ticker.localeCompare(b.ticker)));
		add('decisoes', 'Decisões', `${filters}<div class="grade">${ordered.map((d) => decisionCard(m, d)).join('')}</div>`);
	}

	if (m.recent.length && m.res.recent?.strategies) add('estrategias', 'Estratégias', card('Cada estratégia nestas decisões', 'acerto do sinal contra o acaso para a mesma mistura', strategyChart(m.res.recent.strategies)));

	if (m.seriesOn) {
		const parts = m.res.series
			.filter((s) => s.all.n)
			.map((s) => {
				const years = s.byYear.map((y) => ({
					label: y.year,
					note: `${y.n} decisões`,
					mine: ratio(y.forcedHits, y.forcedN ?? y.n),
					ref: ratio(y.up, y.n),
					value: `<b>${R(y.forcedHits, y.forcedN ?? y.n)}</b>`,
					valueNote: `comprar ${R(y.up, y.n)}`,
					tipMine: `${R(y.forcedHits, y.forcedN ?? y.n)} · ${y.year}|${y.forcedHits} de ${y.forcedN ?? y.n}`,
					tipRef: `${R(y.up, y.n)} · sempre comprar|${y.up} de ${y.n} subiram`
				}));
				const rows = [['Todas', s.all, true], ...s.byKind.map((b) => [b.kind === 'FII' ? 'FIIs' : 'Ações', b]), ...s.byConfidence.map((b) => [`Conf. ${b.confidence}`, b])];
				const calib = `<table class="num"><tr><th>Chance dita</th><th>n</th><th>Média dita</th><th>Subiu</th></tr>${s.calibration.map((c) => `<tr><td>${Math.round(c.lo * 100)}–${Math.min(100, Math.round(c.hi * 100))}%</td><td>${c.n}</td><td>${R(c.predicted * 100, 100)}</td><td><b>${R(c.realized * 100, 100)}</b></td></tr>`).join('')}</table>`;
				// Since 0.0.3 the chance is about beating the CDI or the group, not about going up: its calibration is in the top 10 tabs.
				const calibCard = m.rank.length ? '' : card('Calibragem da chance de alta', '', calib);
				return `<div class="g3">${card(s.name, 'forçado por ano', dotPlot(years, '<span><i class="k novo"></i>robô</span><span><i class="k ref"></i>sempre comprar</span>'))}${calibCard}${card('Estratégias fora da amostra', '', strategyChart(s.strategies))}</div>${card(`${s.name} · números`, '', numbersTable(rows))}`;
			})
			.join('');
		add('serie', 'Série no passado', parts);
	}

	if (m.future.length) {
		const profiles = [...new Set(m.future.map((d) => d.profile))];
		const parts = profiles
			.map((p) => {
				const list = m.future.filter((d) => d.profile === p);
				const waiting = list.filter((d) => d.pending);
				const open = list.filter((d) => !d.pending);
				const rows = waiting
					.map((d) => `<tr><td><b>${d.ticker}</b></td><td>${glyphOf(d)} ${ACTION[d.action].word}</td><td>${forcedWord(d.forced)}</td><td>${n2(d.score)}</td><td>${esc(d.confidence)}</td><td>${brl(d.price)}</td><td>${d.cone ? `${brl(d.cone.p25)}–${brl(d.cone.p75)}` : '—'}</td></tr>`)
					.join('');
				return card(m.ctx.profileName[p], `${open.length ? `${open.length} abertas · ` : ''}${waiting.length ? `${waiting.length} aguardando · abre ~${dateBr(list[0].opensAround)}` : ''}`, `${open.length ? `<div class="grade">${open.map((d) => decisionCard(m, d)).join('')}</div>` : ''}${waiting.length ? `<div class="rolar"><table class="num"><tr><th>Ativo</th><th>Robô</th><th>Forçado</th><th>Nota</th><th>Conf.</th><th>Preço</th><th>Cone 50%</th></tr>${rows}</table></div>` : ''}`);
			})
			.join('');
		add('futuro', 'Daqui para frente', `${card('O que o robô decidiu', `lacrado em ${dateBr(m.future[0].date)}`, assetMap(m, m.future, { showResult: m.future.some((d) => !d.pending) }))}<div class="g3">${parts}</div>`);
	}

	const r = m.res;
	add(
		'regras',
		'Regras e lacre',
		`<div class="g2">${card(`Regras do robô ${m.version}`, '', `<div class="texto"><ul>${(r.ruleLines ?? []).map((l) => `<li>${bold(l)}</li>`).join('')}<li><b>Acertou</b>: compra (ou veredito de compra) se o retorno com dividendos foi positivo; venda se foi negativo.</li></ul></div>`)}${card(
			'Lacre',
			'',
			`<div class="texto"><p>${r.seal.count} decisões lacradas em ${new Date(r.seal.sealedAt).toLocaleString('pt-BR')}; abertas em ${new Date(r.revealedAt).toLocaleString('pt-BR')}.</p><p>Decisões <code>${esc(r.seal.decisionsSha256)}</code></p><p>Motor <code>${esc(r.seal.engineSha256)}</code> ${r.engineUnchanged ? `· versão ${esc(r.engineVersion)}, congelada em <code>D:\\Projetos\\PraiaVelas\\versoes\\${esc(r.engineVersion)}</code>` : '· <b>mudou depois do lacre</b>'}</p>${m.other ? `<p>Comparado com <code>${esc(m.other.folder)}</code> (${esc(m.other.version)}).</p>` : ''}</div>`
		)}</div>`
	);

	const body = `${topBar(m, '<a href="relatorio-lite.html">Versão lite</a>')}<nav class="abas" role="tablist">${tabs.join('')}</nav>${panes.join('\n')}`;
	return page(`${titleOf(m)} · avançado`, body, [TIP_SCRIPT, TABS_SCRIPT]);
}

/**
 * Writes relatorio-lite.html and relatorio-avancado.html in ctx.folder (and removes the old single relatorio.html).
 * ctx: { folder, base, summarize, profileName, strategyName(id), firstVersion }.
 */
export function writeReports(res, ctx) {
	const m = buildModel(res, ctx);
	writeFileSync(join(ctx.folder, 'relatorio-lite.html'), lite(m));
	writeFileSync(join(ctx.folder, 'relatorio-avancado.html'), advanced(m));
	const old = join(ctx.folder, 'relatorio.html');
	if (existsSync(old)) unlinkSync(old);
	return { lite: join(ctx.folder, 'relatorio-lite.html'), advanced: join(ctx.folder, 'relatorio-avancado.html') };
}
