// The screen. PraiaVelas is for people who do not read charts (Rhuan, 08-09/11/2026): the first thing they see is
// the "Top 10 de agora", the assets with the highest chance, learned from the group, of doing better than the
// others of their group (FIIs against FIIs, stocks against stocks), with what the bot would do and why, in plain words. One asset opens into
// the bot's advice, its place in the ranking, what to expect and a simple chart; the numbers for those who
// understand them stay folded under "Detalhes técnicos". All the study is done by motor/; this file only shows it
// and keeps the choices of the person.

// First: on the GitHub Pages site, it answers the data requests from the files published with the page.
import { explainOnline, ONLINE, siteInfo } from './estatico.js';
import { analyzeTicker, DEFAULT_WATCHLIST, ENGINE_DRAFT, ENGINE_VERSION, groupStudy, MODEL_LOGIC, MODES, PROFILES, ranking } from './motor/analise.js';
import { cleanTicker, looksLikeTicker } from './motor/dados.js';
import { getText } from './motor/rede.js';
import { load, save } from './motor/armazem.js';
import { compactMoney, dateBr, money, num, pct, points } from './motor/formato.js';
import { GROUPS } from './motor/mercado.js';
import { averageOf, decide } from './motor/robo.js';
import { CandleChart } from './grafico.js';

// A draft (changes not yet given a number, Rhuan 09/11/2026) shows as the last number with a "+".
const VERSION = ENGINE_DRAFT ? `${ENGINE_VERSION}+` : ENGINE_VERSION;
const $ = (id) => document.getElementById(id);
const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const tone = (v) => (v > 0 ? 'sobe' : v < 0 ? 'desce' : '');
const row = (label, value) => `<tr><td>${label}</td><td>${value}</td></tr>`;
const panel = (title, aside, body) => `<section class="cartao"><h2>${title}${aside ? `<span>${aside}</span>` : ''}</h2>${body}</section>`;
const chance = (p) => `${Math.round(p * 100)}%`;

// ------------------------------------------------------------------------------------------- plain words

/** The reading's horizon, as a person says it. */
const HORIZON = { curto: '1 semana', swing: '1 mês', posicao: '3 meses' };
const VERDICT = { COMPRAR: { word: 'Comprar', cls: 'v-compra' }, VENDER: { word: 'Vender', cls: 'v-venda' }, 'FICAR DE FORA': { word: 'Esperar', cls: 'v-espera' } };
const groupWords = (kind) => (kind === 'FII' ? 'fundos imobiliários' : 'ações');
/** What the study is doing now: the quotes of the group, or (FIIs, 0.0.5) the funds' reports at the CVM. */
const progressWords = (kind, k, n, who) =>
	who === 'CVM' ? `Baixando os relatórios dos fundos na CVM (${k} de ${n} anos; só da primeira vez demora)…` : `O robô está estudando ${kind ? `${GROUPS[kind]?.the ?? 'os'} ${groupWords(kind)}` : 'o grupo'} (${k} de ${n})…`;
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
/** "2026-09-01" → "set/2026". */
const monthBr = (ref) => `${MONTHS[Number(ref.slice(5, 7)) - 1]}/${ref.slice(0, 4)}`;

/** The market in words, with the first sign of a turn when there is one. */
function marketWords(m) {
	if (!m) return 'sem leitura';
	const way = m.trend > 0 ? 'subindo' : m.trend < 0 ? 'caindo' : m.turn > 0 ? 'começando a virar para cima' : m.turn < 0 ? 'começando a virar para baixo' : 'sem direção clara';
	return `${way} e ${m.agitated ? 'instável' : 'calmo'}`;
}

/** "Cshg Logistica - Fundo De Investimento Imobiliario" → "Cshg Logistica". */
function shortName(name, ticker) {
	const s = String(name ?? '')
		.replace(/fundos?\s+(de\s+)?investimentos?(\s+imobili\p{L}*)?/giu, '')
		.replace(/fundo\s+de\s+[íi]ndice/giu, 'ETF')
		.replace(/(^|\s)(fii|fund|cota\s+fund|responsabilidade\s+limitada|s\.a\.?)(?=\s|$)/giu, ' ')
		.replace(/\s*-\s*/g, ' ')
		.replace(/\s{2,}/g, ' ')
		.trim();
	return s || ticker;
}

/** What to do, in one sentence, for someone who does not own it and someone who does. */
function adviceOf(r, d) {
	if (d.action === 'COMPRAR') return 'O robô compraria agora. Se você já tem, pode manter.';
	if (d.action === 'VENDER') return 'O robô venderia agora (sairia da posição).';
	if (d.forced < 0 && r.kind !== 'FII') return 'Não compre agora. Se você já tem, o robô ainda não mandaria vender.';
	return 'Não compre agora. Se você já tem, pode manter.';
}

/** The bot's reasons told without jargon: what blocked it, the similar situations, what weighed for and against. */
function plainReasons(r, d) {
	const f = r.forecast;
	const out = [];
	for (const b of d.blockers) {
		if (b.startsWith('O modelo não se mostrou')) out.push('O robô ainda não acertou bem no último ano, no teste que ele faz consigo mesmo. Por isso ele mostra a ordem, mas não manda comprar.');
		else if (b.startsWith('Chance de render')) out.push(`A chance de render mais que ${averageOf(r.group)} em ${HORIZON[r.profile.id]} é de ${chance(f.p)}. Para mandar comprar, o robô pede 60%.`);
		else if (b.startsWith('FII não se vende')) out.push('Fundos imobiliários pagam rendimento todo mês: o robô não manda vender por esse sinal.');
		else if (b.startsWith('Sem o modelo')) out.push('Não deu para estudar o grupo agora (sem internet?). Sem isso, o robô não decide.');
		else out.push(b);
	}
	if (f) {
		const a = f.analogs;
		if (f.journal) out.push(`A chance foi corrigida pelo diário do robô: o modelo dizia ${chance(f.beforeJournal)}; no último ano, ele ${f.journal.trust}.`);
		out.push(`Nas ${a.n} situações mais parecidas do último ano, ${a.beat} renderam mais que ${averageOf(r.group)}.`);
		for (const x of f.drivers.slice(0, 3)) out.push(`${x.effect > 0 ? 'Ajuda' : 'Pesa contra'}: ${x.text}.`);
	}
	return out;
}

// ------------------------------------------------------------------------------------------- errors

/**
 * An error in a person's words, never the browser's English: on 10/11/2026 the screen said "Não consegui baixar
 * KNHY11: Failed to fetch" when the computer's server had been closed. context: what was being done, for errors
 * that are not about the connection.
 */
function friendly(message, context = '') {
	const m = String(message ?? '');
	if (/Failed to fetch|NetworkError|Load failed|sem resposta|tempo esgotado|HTTP 50\d/i.test(m)) {
		const here = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !globalThis.Capacitor?.isNativePlatform?.();
		return here
			? 'O PraiaVelas não está respondendo neste computador: o programa que serve o app foi fechado. Abra de novo com "npm run app", ou use o site no ar (megashooterx.github.io/PraiaVelas).'
			: 'Sem conexão agora: não deu para baixar os dados. Confira a internet e toque em ↻ para tentar de novo.';
	}
	const said = explainOnline(m);
	return context ? `${context}: ${said}` : said;
}

// ------------------------------------------------------------------------------------------- the journal

/**
 * The robot's journal (motor/diario.js, since 10/11/2026): every trading day it writes its chances down, checks them
 * when the horizon passes, and learns from its own record how far to trust them. Its file says how the last bets
 * that came due turned out and, when the lesson passed its test (apply), the lesson that corrects today's chances.
 * On this computer it comes from ferramentas/servidor.mjs (/diario/licao.json, the journal sealed here); on the site,
 * from dados/diario.json (made by GitHub every weekday); in the phone app, from the site. Without it, nothing changes.
 */
const JOURNAL_ONLINE = 'https://megashooterx.github.io/PraiaVelas/dados/diario.json';
let journal;
async function loadJournal() {
	if (journal !== undefined) return journal;
	try {
		if (globalThis.Capacitor?.isNativePlatform?.()) journal = JSON.parse(await getText(JOURNAL_ONLINE));
		else {
			const r = await fetch(ONLINE ? new URL('dados/diario.json', document.baseURI).href : '/diario/licao.json', { cache: 'no-store' });
			journal = r.ok ? await r.json() : null;
		}
	} catch {
		journal = null;
	}
	return journal;
}

/** How the robot did in the last bet of this horizon that came due: a line for the start screen. */
function journalLine(j, profile) {
	const last = j?.last?.[profile];
	if (!last?.n) return '';
	const sign = last.spread >= 0 ? 'a mais' : 'a menos';
	const redone = last.refeito ? ' (refeito com os dados até aquele dia)' : '';
	const fixed = j.apply ? ' As chances de hoje já vêm corrigidas pelo que ele acertou e errou.' : '';
	return `<p class="mercado-linha">Como o robô foi: no Top 10 de ${HORIZON[profile]} de ${dateBr(last.date)}${redone}, <b>${last.beat} de ${last.n}</b> renderam mais que a média do grupo até ${dateBr(last.end)}, e o Top 10 rendeu <b class="${tone(last.spread)}">${pct(Math.abs(last.spread), 1, false)} ${sign}</b> que todos.${fixed}</p>`;
}

/**
 * Is the robot right or wrong, in one line (Rhuan, 10/11/2026): the verdict of its bets in this horizon (the sealed
 * ones once there are enough, the past lived day by day until then), and how often the 1st of each group beat the
 * group's average, beside all of them.
 */
function scoreLine(j, profile) {
	const x = j?.placar?.[profile];
	const v = x?.sealed?.n >= 8 ? x.sealed : x?.past;
	if (!v) return '';
	const who = v === x.sealed ? 'nas apostas lacradas' : `refeito dia a dia desde ${String(x.past.from).slice(0, 4)}`;
	const word = { acerta: 'acerta mais que a sorte', erra: 'erra mais que a sorte', sorte: 'igual à sorte', cedo: 'ainda cedo para dizer' }[v.word];
	const f = x.precision?.FII;
	const a = x.precision?.Ação;
	const groups = f && a ? ` O 1º dos FIIs bateu a média dos FIIs em ${chance(f.first)} das vezes (todos: ${chance(f.all)}); a 1ª das ações, em ${chance(a.first)} (todas: ${chance(a.all)}).` : '';
	return `<p class="mercado-linha diario-linha">Placar do robô em ${HORIZON[profile]} (${who}): <b class="${v.word === 'acerta' ? 'sobe' : v.word === 'erra' ? 'desce' : ''}">${word}</b>: o Top 10 ganhou da média em ${v.won} de ${v.n}.${groups}</p>`;
}

const HONEST ='O robô está em teste. Nos testes às cegas feitos até agora, nenhuma versão provou que escolhe melhor que o resto: a ordem do Top 10 ainda pode ser sorte. Use como estudo, não como ordem.';

// ------------------------------------------------------------------------------------------- state

/** Chart ranges, in trading days. */
const RANGES = { '3M': 63, '6M': 126, '1A': 252, '2A': 504, Tudo: Infinity };
const LAYERS = [
	['medias', 'Médias'],
	['bandas', 'Bollinger'],
	['padroes', 'Padrões'],
	['projecao', 'Projeção']
];
const SIGNAL = { 1: 'ALTA', '-1': 'BAIXA', 0: '—' };

const settings = {
	ticker: 'HGLG11',
	profile: 'swing',
	mode: 'ponderada',
	range: '6M',
	...load('ajustes', {})
};
// A plain chart by default: only the price and the range where it may go. The rest is in the technical details.
if (settings.layersV !== 2) settings.layers = { medias: false, bandas: false, padroes: false, projecao: true };
settings.layersV = 2;
settings.layers = { medias: false, bandas: false, padroes: false, projecao: true, ...(settings.layers ?? {}) };
if (!PROFILES[settings.profile]) settings.profile = 'swing';
if (!MODES[settings.mode]) settings.mode = 'ponderada';
// A group study kept by another logic of the chances (a draft that changed it, within its 6 hours) is not this
// one's: on 09/11/2026 the screen showed the package's chances, kept an hour before, under the same key.
try {
	if (load('logica-estudo') !== MODEL_LOGIC) {
		for (const k of Object.keys(globalThis.localStorage ?? {})) if (k.startsWith('cache:estudo:')) localStorage.removeItem(k);
		save('logica-estudo', MODEL_LOGIC);
	}
} catch {
	// No storage: nothing kept to clear.
}
let watchlist = load('lista', DEFAULT_WATCHLIST);
let scope = load('varredura', 'todos');
if (!['todos', 'FII', 'Ação', 'lista'].includes(scope)) scope = 'todos';
/** 'lista': the top 10 (the start); 'ativo': one asset. */
let view = 'lista';
let chart = null;
let current = null;
let request = 0;
/** The code that just failed to load: never offered to keep. */
let broken = null;

const persist = () => save('ajustes', settings);

function barsFor(range, profile) {
	const days = RANGES[range] ?? 126;
	if (!Number.isFinite(days)) return 1e9;
	return Math.round(days / (PROFILES[profile].timeframe === 'W' ? 5 : 1));
}

/** On the site: which close its data is from (it is downloaded once a day, the app on the phone downloads it live). */
async function showSiteData() {
	const info = await siteInfo();
	if (!info?.dadosAte) return;
	const note = document.createElement('p');
	note.className = 'aviso';
	note.textContent = `Site online: dados do fechamento de ${dateBr(info.dadosAte)}, baixados todo dia útil depois do fechamento da B3. No app do celular, os dados vêm na hora.`;
	document.querySelector('.aviso')?.before(note);
}

function renderControls() {
	$('versao').textContent = VERSION;
	// The reports of the blind tests live on this computer (ferramentas/servidor.mjs), not in the phone app.
	// Inside the APK the page is also served from "localhost", so the native app is checked first.
	$('testes').hidden = Boolean(globalThis.Capacitor?.isNativePlatform?.()) || !/^(localhost|127\.0\.0\.1)$/.test(location.hostname);
	$('perfis').innerHTML = Object.values(PROFILES)
		.map((p) => `<button type="button" data-perfil="${p.id}" class="${p.id === settings.profile ? 'ativo' : ''}" title="${escape(p.about)}">${HORIZON[p.id]}</button>`)
		.join('');
}

/**
 * One line above the result: what is loading, or what went wrong. It never replaces what is on screen: a typo or
 * a code Yahoo does not know must not wipe what the person was looking at.
 */
function status(text, error = false) {
	const line = $('r-status');
	if (line) {
		line.innerHTML = text ? `<div class="alerta${error ? ' erro' : ''}">${escape(text)}</div>` : '';
		return;
	}
	$('resultado').innerHTML = text ? `<div class="${error ? 'alerta erro' : 'carregando'}">${escape(text)}</div>` : '';
}

// ------------------------------------------------------------------------------------------- start: the top 10

const SCOPES = { todos: 'Todos', FII: 'FIIs', Ação: 'Ações', lista: 'Minha lista' };

/**
 * The robot's chance in words: how it sees the asset against the others of its group. A "52%" reads as precise to a
 * beginner, and the journal showed it is about a coin (10/11/2026): the words say so, the number stays beside them.
 */
function chanceWords(p) {
	if (p >= 0.6) return 'bem melhor que os outros';
	if (p >= 0.55) return 'melhor que os outros';
	if (p >= 0.52) return 'um pouco melhor que os outros';
	if (p > 0.48) return 'igual aos outros';
	if (p > 0.45) return 'um pouco pior que os outros';
	return 'pior que os outros';
}

/** What a beginner looks at first: what it pays, its price against what the fund owns, and the last month. */
function facts(r) {
	const out = [];
	if (r.kind === 'FII' && r.dy12 > 0) out.push(`paga ~${money((r.dy12 * r.price) / 12)} por mês por cota (${pct(r.dy12, 1, false)} ao ano)`);
	else if (r.dy12 > 0) out.push(`dividendos de ${pct(r.dy12, 1, false)} ao ano`);
	else out.push('sem dividendos no último ano');
	const pvp = r.book?.pvp;
	if (Number.isFinite(pvp)) out.push(Math.abs(pvp - 1) < 0.03 ? 'preço igual ao patrimônio' : `preço ${pct(Math.abs(pvp - 1), 0, false)} ${pvp < 1 ? 'abaixo' : 'acima'} do patrimônio`);
	if (Number.isFinite(r.change1m)) out.push(`<span class="${tone(r.change1m)}">${pct(r.change1m)}</span> no mês`);
	return out.join(' · ');
}

/**
 * One asset of the list, for a beginner (Rhuan, 10/11/2026: "algo realmente útil e info relevante para o analista
 * iniciante"): the price today, what it pays, its price against its assets, the month, and the robot's view in
 * words. The strong colour only when the robot acts (Comprar, Vender): ten yellow "Esperar" said nothing.
 */
function item(x, position) {
	const { r, d } = x;
	const v = VERDICT[d.action];
	const p = r.forecast.p;
	const act = d.action === 'FICAR DE FORA' ? '<span class="item-acao">esperar</span>' : `<span class="selo-v ${v.cls}">${v.word}</span>`;
	return `<button type="button" class="item" data-abrir="${r.ticker}">
		<span class="pos">${position}</span>
		<span class="item-ativo"><b>${r.ticker}</b><small>${escape(r.segment ?? shortName(r.name, r.ticker))}</small></span>
		<span class="item-preco"><b>${money(r.price)}</b><small class="${tone(r.dayChange)}">${pct(r.dayChange)} hoje</small></span>
		<span class="item-fatos">${facts(r)}</span>
		<span class="item-robo"><span>Robô: <b>${chanceWords(p)}</b> (${chance(p)})</span>${act}</span>
	</button>`;
}

function renderList(rows, markets, loading, j = null) {
	const P = PROFILES[settings.profile];
	const buy = rows.filter((x) => x.d.action === 'COMPRAR').length;
	const anyProven = rows.some((x) => x.r.forecast.confidence !== 'baixa');
	const strong = rows.filter((x) => x.r.forecast.p >= 0.6 && x.r.forecast.confidence !== 'baixa').length;
	const headline = loading
		? 'O robô está estudando o mercado…'
		: buy
			? `Hoje o robô compraria ${buy} ${buy === 1 ? 'ativo' : 'ativos'}.`
			: strong
				? 'Alguns ativos passaram de 60% de chance, mas o mercado deles está caindo: o robô espera a virada para comprar.'
				: anyProven
					? 'Hoje nenhum ativo chegou a 60% de chance: a recomendação é esperar.'
					: 'Hoje o robô não manda comprar: ele ainda não acertou bem no próprio teste. Abaixo, a ordem que ele acha mais provável.';
	$('v-resumo').innerHTML = `<p class="manchete">${escape(headline)}</p>
		<p class="mercado-linha">Chance de render mais que a média do grupo em <b>${HORIZON[P.id]}</b>, com dividendos (FIIs contra FIIs, ações contra ações).</p>
		${Object.entries(markets)
			.map(([kind, m]) => `<p class="mercado-linha">Mercado de ${groupWords(kind)}: <b class="${m ? tone(m.trend || m.turn) : ''}">${marketWords(m)}</b></p>`)
			.join('')}
		${loading ? '' : scoreLine(j, P.id) + journalLine(j, P.id)}`;
	const top = rows.slice(0, 10);
	const rest = rows.slice(10);
	$('v-lista').innerHTML = top.length
		? `${top.map((x, i) => item(x, i + 1)).join('')}${rest.length ? `<details class="outros"><summary>Os outros ${rest.length}</summary><div class="lista-robo">${rest.map((x, i) => item(x, i + 11)).join('')}</div></details>` : ''}`
		: loading
			? ''
			: '<p class="honesto">Nenhum ativo para mostrar aqui.</p>';
}

/** The start screen: the study of the groups (downloaded once per session, summary kept for hours) and the top 10. */
async function showList() {
	view = 'lista';
	current = null;
	chart = null;
	const id = ++request;
	$('resultado').innerHTML = `
		<div id="r-status"></div>
		<div class="escopo">${Object.entries(SCOPES)
			.map(([k, label]) => `<button type="button" data-escopo="${k}" class="${k === scope ? 'ativo' : ''}">${label}</button>`)
			.join('')}</div>
		<section class="resumo-robo" id="v-resumo"></section>
		<div class="lista-robo" id="v-lista"></div>
		<p class="honesto">${HONEST}</p>`;
	const kinds = scope === 'FII' ? ['FII'] : scope === 'Ação' ? ['Ação'] : ['FII', 'Ação'];
	$('recarregar').classList.add('girando');
	renderList([], {}, true);
	const rows = [];
	const markets = {};
	const j = await loadJournal();
	for (const kind of kinds) {
		if (id !== request) return;
		try {
			const study = await groupStudy(kind, { onProgress: (k, n, who) => id === request && k < n && status(progressWords(kind, k, n, who)) });
			if (id !== request) return;
			status('');
			markets[kind] = study?.studies?.[settings.profile]?.market ?? null;
			for (const r of ranking(study, settings.profile, j)) rows.push({ r, d: decide(r) });
		} catch (error) {
			status(friendly(error.message, `Não deu para estudar os ${groupWords(kind)}`), true);
		}
	}
	if (id !== request) return;
	const shown = (scope === 'lista' ? rows.filter((x) => watchlist.includes(x.r.ticker)) : rows).sort((a, b) => b.r.forecast.p - a.r.forecast.p);
	renderList(shown, markets, false, j);
	$('recarregar').classList.remove('girando');
}

// ------------------------------------------------------------------------------------------- one asset

/** The parts of the asset screen: the chart stays the same canvas between analyses, the rest is redrawn. */
function skeleton() {
	$('resultado').innerHTML = `
		<div id="r-status"></div>
		<div id="r-topo"></div>
		<div id="r-veredito"></div>
		<div id="r-esperar"></div>
		<section id="r-grafico">
			<div class="grafico-barra"><div class="mini" id="faixas"></div></div>
			<div class="area-grafico"><canvas id="grafico"></canvas><div class="legenda" id="legenda"></div><div id="dica" class="dica" hidden></div></div>
		</section>
		<p class="honesto">${HONEST}</p>
		<details class="tecnico" id="r-tecnico"><summary>Detalhes técnicos <small>para quem entende de gráfico</small></summary>
			<div id="r-alertas"></div>
			<div id="r-kpis"></div>
			<div class="grafico-barra"><div class="mini" id="camadas"></div></div>
			<div id="r-resto"></div>
			<p class="rodape" id="r-rodape"></p>
		</details>`;
	chart = new CandleChart($('grafico'), $('dica'));
	for (const [k, on] of Object.entries(settings.layers)) chart.layers[k] = on;
}

function renderTop(r) {
	const c = r.context;
	const kept = watchlist.includes(r.ticker);
	return `<div class="ativo-topo">
		<button type="button" class="voltar" data-voltar title="Voltar para o Top 10">←</button>
		<div class="ativo-nome"><h1>${r.ticker}</h1><small>${escape(r.segment ?? shortName(r.name, r.ticker))} · ${r.kind === 'FII' ? 'fundo imobiliário' : 'ação'}</small></div>
		<div class="ativo-preco"><b>${money(c.last)}</b><small class="${tone(c.dayChange)}">${pct(c.dayChange)} hoje</small></div>
		<button type="button" class="guardar${kept ? ' guardado' : ''}" data-${kept ? 'tirar' : 'guardar'}="${r.ticker}">${kept ? '★ Na lista' : '☆ Guardar'}</button>
	</div>`;
}

function renderVerdict(r, d, place) {
	const v = VERDICT[d.action];
	const f = r.forecast;
	const reasons = plainReasons(r, d).slice(0, 4);
	return `<section class="veredito-grande ${v.cls}">
		<div class="vg-topo"><small>O robô diz, para ${HORIZON[r.profile.id]}</small><b>${v.word}</b>${f ? `<small>${chance(f.p)} de chance de render mais que ${averageOf(r.group)}${place ? ` · ${place}` : ''}</small>` : ''}</div>
		<p class="vg-conselho">${escape(adviceOf(r, d))}</p>
		<ul class="vg-porque">${reasons.map((x) => `<li>${escape(x)}</li>`).join('')}</ul>
	</section>`;
}

function renderExpect(r) {
	const f = r.projection?.final;
	const c = r.context;
	const monthly = c.dividends12 / 12;
	const items = [];
	// How often the price really ended inside the range, in the blind test of 2023 to 2026: said in counts, not as
	// "most of the scenarios". 1 week and 1 month with the calibrated width (10/11/2026); 3 months with the old one.
	const inside = { curto: 'em cerca de metade das vezes', swing: 'em cerca de metade das vezes', posicao: 'em cerca de 5 a 6 de cada 10 vezes' }[r.profile.id];
	if (f) items.push(`<div><small>Preço daqui a ${HORIZON[r.profile.id]}</small><b>${money(f.p25)} a ${money(f.p75)}</b><small>onde o preço terminou ${inside} no passado; quase sempre (9 em 10) entre ${money(f.p5)} e ${money(f.p95)} · hoje ${money(c.last)}</small></div>`);
	items.push(
		monthly > 0
			? `<div><small>Rendimento</small><b>~${money(monthly)} por mês</b><small>por cota · ${pct(c.dy12, 1, false)} ao ano</small></div>`
			: `<div><small>Rendimento</small><b>não paga mensal</b><small>sem dividendos nos últimos 12 meses</small></div>`
	);
	items.push(`<div><small>Último ano</small><b class="${tone(c.total12m)}">${pct(c.total12m)}</b><small>com os rendimentos</small></div>`);
	// FIIs (0.0.5): the price against what the fund owns per share, from its own report to the CVM.
	const b = r.book;
	if (b && Number.isFinite(b.pvp)) {
		const gap = b.pvp - 1;
		const words = Math.abs(gap) < 0.03 ? 'custa o mesmo que o patrimônio por cota' : `custa ${pct(Math.abs(gap), 0, false)} ${gap < 0 ? 'menos' : 'mais'} que o patrimônio por cota`;
		items.push(`<div><small>Preço × patrimônio</small><b>P/VP ${num(b.pvp, 2)}</b><small>${words} · CVM ${monthBr(b.ref)}</small></div>`);
	}
	return `<section class="esperar${items.length === 4 ? ' quatro' : ''}">${items.join('')}</section>`;
}

// ---- the technical details, folded

function renderKpis(r) {
	const c = r.context;
	const v = r.verdict;
	const P = r.profile;
	const m = r.market;
	const f = r.forecast;
	const kpi = (label, value, detail, cls = '') => `<div class="kpi"><span>${label}</span><b class="${cls}">${value}</b><small>${detail}</small></div>`;
	return `<div class="kpis">
		${kpi('Chance > grupo', f ? chance(f.p) : '—', f ? (f.journal ? `modelo ${chance(f.beforeJournal)} · com o diário` : `modelo ${chance(f.raw)} · média ${chance(f.base)}`) : 'sem modelo')}
		${kpi('Teste do modelo', f ? f.confidence : '—', f && Number.isFinite(f.skill) ? `skill ${num(f.skill, 3)}` : 'sem dados')}
		${kpi('Viés (estratégias)', v.label, `nota ${num(v.score, 2)}`, `t-${v.tone}`)}
		${kpi(r.group.market, m ? (m.trend > 0 ? 'em alta' : m.trend < 0 ? 'em queda' : 'virando') : '—', m ? `agitação ${num(m.volRatio, 2)}×` : 'sem dado', m ? tone(m.trend) : '')}
		${kpi(`Média ${P.horizon}${P.timeframe === 'W' ? 's' : 'p'}`, pct(r.expected.base), 'histórica c/ div.', tone(r.expected.base))}
		${kpi('DY 12m', pct(c.dy12, 1, false), `${money(c.dividends12)}/cota`)}
		${kpi('1 mês', pct(c.change1m), `3m ${pct(c.change3m)}`, tone(c.change1m))}
		${kpi('12 meses', pct(c.change12m), `c/ div. ${pct(c.total12m)}`, tone(c.change12m))}
	</div>`;
}

const evidenceWhere = (r) => (r.evidenceFrom.kind === 'grupo' ? `${r.group.inThe ?? 'nos'} ${r.evidenceFrom.assets} ${r.group.name}` : 'neste ativo');

function renderRobot(r, d) {
	return panel(
		d.blockers.length ? `Travas do robô (${d.blockers.length})` : 'Regras do robô',
		`versão ${VERSION} · em teste`,
		`${d.blockers.length ? `<ul class="lista-texto">${d.blockers.map((b) => `<li>${escape(b)}</li>`).join('')}</ul>` : '<p class="apagado">Nenhuma trava: todas as regras passaram.</p>'}
		<details class="motivos"><summary>Motivos</summary><ul class="lista-texto">${d.reasons.map((x) => `<li>${escape(x)}</li>`).join('')}</ul></details>`
	);
}

function renderLearned(r) {
	const f = r.forecast;
	if (!f) return panel('O que o robô aprendeu', '', '<p class="apagado">Sem o modelo (não deu para estudar o grupo).</p>');
	const ex = f.analogs.examples.map((e) => `<tr><td>${e.t}</td><td>${dateBr(e.d)}</td><td class="${tone(e.r)}">${pct(e.r)}</td></tr>`).join('');
	return panel(
		'O que o robô aprendeu',
		`${f.rows} situações · ${dateBr(f.from)} a ${dateBr(f.trainedUntil)}`,
		`<table class="tabela"><tr><th>Peso agora</th><th>Sinal</th></tr>${f.drivers
			.slice(0, 8)
			.map((x) => `<tr><td class="esq">${escape(x.text)}</td><td class="${x.effect > 0 ? 'sobe' : 'desce'}">${x.effect > 0 ? '+' : ''}${num(x.effect, 2)}</td></tr>`)
			.join('')}</table>
		<table class="tabela"><tr><th>Situação parecida</th><th>Data</th><th>Contra a média</th></tr>${ex}</table>
		${f.journal ? `<p class="apagado">Diário do robô: o modelo dizia ${chance(f.beforeJournal)}, a chance mostrada é ${chance(f.p)}. Com os dias conferidos até ${dateBr(f.journal.asOf)}, ele ${escape(f.journal.trust)} (60% vira ${chance(f.journal.sixty)}).</p>` : ''}`
	);
}

function renderMarket(r) {
	const m = r.market;
	if (!m) return panel('Mercado', escape(r.group.market), '<p class="apagado">Sem a leitura do mercado.</p>');
	const { slow, mid } = r.profile.periods;
	return panel(
		'Mercado',
		escape(r.group.marketName),
		`<table class="tabela">
			${row('Direção', `<b class="${tone(m.trend || m.turn)}">${marketWords(m)}</b>`)}
			${row(`Preço × médias ${slow} / ${mid}`, `${m.short > 0 ? 'acima' : 'abaixo'} / ${m.medium > 0 ? 'acima' : 'abaixo'}`)}
			${row('5 dias / 1 mês / 3 meses', `<span class="${tone(m.change5d)}">${pct(m.change5d)}</span> / <span class="${tone(m.change1m)}">${pct(m.change1m)}</span> / <span class="${tone(m.change3m)}">${pct(m.change3m)}</span>`)}
			${row('Agitação', `<b class="${m.agitated ? 'desce' : ''}">${num(m.volRatio, 2)}×</b>${m.agitated ? ' agitado' : ''}`)}
		</table>`
	);
}

function renderChartBar(r) {
	$('faixas').innerHTML = Object.keys(RANGES)
		.map((k) => `<button type="button" data-faixa="${k}" class="${k === settings.range ? 'ativo' : ''}">${k}</button>`)
		.join('');
	$('camadas').innerHTML = `<span class="rotulo">Gráfico:</span>${LAYERS.map(([k, label]) => `<button type="button" data-camada="${k}" class="${settings.layers[k] ? 'ativo' : ''}">${label}</button>`).join('')}`;
	const { fast, slow } = r.profile.periods;
	const parts = [];
	if (settings.layers.medias) parts.push(`<span><i style="background:var(--accent)"></i>Média ${fast}</span><span><i style="background:var(--gold)"></i>Média ${slow}</span>`);
	if (settings.layers.projecao) parts.push(`<span><i style="background:var(--cone)"></i>Para onde o preço pode ir em ${HORIZON[r.profile.id]}</span>`);
	if (settings.layers.padroes) parts.push('<span><b class="sobe">▲</b><b class="desce">▼</b> padrões</span>');
	$('legenda').innerHTML = parts.join('');
}

function renderProjection(r) {
	const p = r.projection;
	const P = r.profile;
	if (!p) return '';
	const f = p.final;
	const dividends = (r.context.dividends12 / P.perYear) * P.horizon;
	return panel(
		'Projeção',
		`${P.horizon} ${P.unit} · sem inclinação`,
		`<table class="tabela">
			${row('Mediana', `<b>${money(f.p50)}</b> <span class="${tone(f.p50 / p.last - 1)}">${pct(f.p50 / p.last - 1)}</span>`)}
			${row('Faixa 50%', `${money(f.p25)} – ${money(f.p75)}`)}
			${row('Faixa 90%', `${money(f.p5)} – ${money(f.p95)}`)}
			${row('Largura', p.scale > 1.05 ? `${num(p.scale, 1)}× (mês agitado)` : 'normal')}
			${row('Dividendos no período', `${money(dividends)}/cota`)}
		</table>`
	);
}

function renderHistory(r) {
	const c = r.context;
	return panel(
		'Histórico',
		`até ${dateBr(c.date)}`,
		`<table class="tabela">
			${row('1 mês / 3 meses', `<span class="${tone(c.change1m)}">${pct(c.change1m)}</span> / <span class="${tone(c.change3m)}">${pct(c.change3m)}</span>`)}
			${row('12 meses / c/ dividendos', `<span class="${tone(c.change12m)}">${pct(c.change12m)}</span> / <span class="${tone(c.total12m)}">${pct(c.total12m)}</span>`)}
			${row('Da máxima de 52 semanas', `<span class="${tone(c.fromHigh)}">${pct(c.fromHigh)}</span>`)}
			${row('Máx / mín 52 semanas', `${money(c.high52)} / ${money(c.low52)}`)}
			${row('Negociado por dia', compactMoney(c.liquidity))}
		</table>`
	);
}

function renderStrategies(r) {
	const pooled = r.evidenceFrom.kind === 'grupo';
	const rows = r.strategies
		.map((s) => {
			const st = s.stats;
			const tip = `${s.about} Evidência ${st.evidence}; vantagem ${points(st.edge, 2)}.${pooled && s.own.n ? ` Só neste ativo: ${pct(s.own.hit, 0, false)} contra ${pct(s.own.baseHit, 0, false)}.` : ''}`;
			return `<tr title="${escape(tip)}"><td><span class="sinal s${s.now}">${SIGNAL[s.now]}</span></td><td class="esq">${escape(s.name)}<small>${escape(s.reading)}</small></td><td>${st.n ? pct(st.hit, 0, false) : '—'}</td><td>${st.n ? pct(st.baseHit, 0, false) : '—'}</td><td>${pct(s.weight, 0, false)}<span class="peso" style="width:${Math.round(s.weight * 24)}px"></span></td></tr>`;
		})
		.join('');
	return panel(
		'Estratégias',
		`prova ${escape(evidenceWhere(r))} · ${r.profile.horizon} ${r.profile.unit}`,
		`<table class="tabela"><tr><th>Sinal</th><th>Estratégia · leitura</th><th>Acerto</th><th>Acaso</th><th>Peso</th></tr>${rows}</table>`
	);
}

function renderCandles(r) {
	const unit = `${r.profile.horizon}${r.profile.timeframe === 'W' ? 's' : 'p'}`;
	const recent = r.patterns.recent.length
		? `<ul class="lista-texto">${r.patterns.recent
				.map((p) => `<li><b class="${p.dir > 0 ? 'sobe' : 'desce'}">${p.dir > 0 ? '▲' : '▼'} ${escape(p.name)}</b> ${dateBr(p.date)}${p.study ? ` · ${p.study.n}× · acerto ${pct(p.study.hit, 0, false)}` : ''}</li>`)
				.join('')}</ul>`
		: '<p class="apagado">Nenhum padrão nos últimos 5 candles.</p>';
	const study = r.patterns.study
		.map((s) => `<tr><td><span class="${s.dir > 0 ? 'sobe' : 'desce'}">${s.dir > 0 ? '▲' : '▼'}</span> ${escape(s.name)}</td><td>${s.n}</td><td>${pct(s.hit, 0, false)}</td><td class="${tone(s.mean)}">${pct(s.mean)}</td></tr>`)
		.join('');
	return panel('Candles', `neste ativo · ${unit}`, `${recent}${study ? `<table class="tabela"><tr><th>Padrão</th><th>Vezes</th><th>Acerto</th><th>Retorno</th></tr>${study}</table>` : ''}`);
}

function renderDividends(r) {
	const c = r.context;
	const series = c.dividendSeries;
	const max = Math.max(...series.map((d) => d.amount), 0);
	const bars = series.map((d) => `<div style="height:${max ? Math.round((d.amount / max) * 100) : 0}%" title="${dateBr(d.date)}: ${money(d.amount, 3)}"></div>`).join('');
	return panel(
		'Dividendos',
		series.length ? `últimos ${series.length}` : '',
		`<table class="tabela">
			${row('DY 12 meses', `<b>${pct(c.dy12, 2, false)}</b>`)}
			${row('Pago em 12 meses', `${money(c.dividends12)}/cota`)}
			${row('Último', c.lastDividend ? `${money(c.lastDividend.amount, 3)} · ${dateBr(c.lastDividend.date)}` : '—')}
		</table>${series.length ? `<div class="barras" aria-label="Últimos dividendos">${bars}</div>` : ''}`
	);
}

function render(r, place) {
	if (!chart) skeleton();
	const d = decide(r);
	$('r-topo').innerHTML = renderTop(r);
	$('r-veredito').innerHTML = renderVerdict(r, d, place);
	$('r-esperar').innerHTML = renderExpect(r);
	renderChartBar(r);
	chart.setData({ ...r.chart, projection: r.projection }, barsFor(settings.range, settings.profile));
	$('r-alertas').innerHTML = r.warnings.map((w) => `<div class="alerta">${escape(w)}</div>`).join('');
	$('r-kpis').innerHTML = renderKpis(r);
	$('r-resto').innerHTML = [renderRobot(r, d), renderLearned(r), renderMarket(r), renderProjection(r), renderStrategies(r), renderHistory(r), renderDividends(r), renderCandles(r)].join('');
	$('r-rodape').textContent = `PraiaVelas ${VERSION} · Yahoo Finance, Banco Central${r.book ? ' e CVM' : ''} · baixado ${new Date(r.fetchedAt).toLocaleString('pt-BR')}`;
}

/** "3º de 41 FIIs no Top", from the group's study (already in memory or kept). */
async function placeOf(r) {
	try {
		const study = await groupStudy(r.kind);
		const list = ranking(study, settings.profile, await loadJournal());
		const i = list.findIndex((x) => x.ticker === r.ticker);
		return i >= 0 ? `${i + 1}º de ${list.length} ${groupWords(r.kind)}` : '';
	} catch {
		return '';
	}
}

async function run(force = false) {
	if (view !== 'ativo') {
		view = 'ativo';
		current = null;
		chart = null;
		$('resultado').innerHTML = '';
	}
	const ticker = settings.ticker;
	const id = ++request;
	const before = current;
	$('recarregar').classList.add('girando');
	$('resultado').classList.toggle('esperando', Boolean(before));
	status(`Abrindo ${ticker}…`);
	const onProgress = (done, total, who) => {
		if (id === request && done < total) status(progressWords(null, done, total, who));
	};
	try {
		const result = await analyzeTicker(ticker, { profile: settings.profile, mode: settings.mode, force, onProgress, journal: await loadJournal() });
		if (id !== request) return;
		const place = await placeOf(result);
		if (id !== request) return;
		current = result;
		broken = null;
		render(result, place);
		status('');
	} catch (error) {
		if (id !== request) return;
		broken = ticker;
		if (before) {
			if (before.ticker !== ticker) {
				settings.ticker = before.ticker;
				persist();
			}
			status(friendly(error.message), true);
		} else {
			// Nothing else on screen: the error and the way back, never a dead end.
			chart = null;
			$('resultado').innerHTML = `<div class="alerta erro">${escape(friendly(error.message))}</div><button type="button" class="botao-texto voltar-erro" data-voltar>← Voltar ao Top 10</button>`;
		}
	} finally {
		if (id === request) {
			$('recarregar').classList.remove('girando');
			$('resultado').classList.remove('esperando');
		}
	}
}

function open(ticker) {
	settings.ticker = ticker;
	persist();
	run();
	scrollTo({ top: 0 });
}

/** The same choice (horizon, reload) redoes whatever is on screen. */
const refresh = (force = false) => (view === 'lista' ? showList() : run(force));

// ------------------------------------------------------------------------------------------- events

$('busca').addEventListener('submit', (e) => {
	e.preventDefault();
	const field = $('codigo');
	const typed = field.value.trim();
	if (!typed) {
		field.focus();
		return;
	}
	const ticker = cleanTicker(typed);
	if (!looksLikeTicker(ticker)) {
		field.classList.add('invalido');
		status(`“${typed}” não parece um código da B3. Exemplo: HGLG11, PETR4.`, true);
		field.focus();
		return;
	}
	field.value = '';
	field.blur();
	open(ticker);
});

$('codigo').addEventListener('input', () => {
	$('codigo').classList.remove('invalido');
	if ($('r-status')?.querySelector('.erro')) status('');
});

$('inicio').addEventListener('click', () => showList());

$('perfis').addEventListener('click', (e) => {
	const b = e.target.closest('[data-perfil]');
	if (!b || b.dataset.perfil === settings.profile) return;
	settings.profile = b.dataset.perfil;
	persist();
	renderControls();
	refresh();
});

$('recarregar').addEventListener('click', () => refresh(true));

// ------------------------------------------------------------------------------------------- install as an app

// The site can go on the phone's home screen like an app (manifest.webmanifest, sw.js). The phone's browser says
// when it can (beforeinstallprompt); then the "Instalar" button appears. Not in the Android app (APK), which is one.
if ('serviceWorker' in navigator && !globalThis.Capacitor?.isNativePlatform?.()) {
	navigator.serviceWorker.register('sw.js').catch(() => {
		// Without it the site still works; it only cannot be installed.
	});
	let offer = null;
	addEventListener('beforeinstallprompt', (event) => {
		event.preventDefault();
		offer = event;
		$('instalar').hidden = false;
	});
	$('instalar').addEventListener('click', async () => {
		if (!offer) return;
		offer.prompt();
		await offer.userChoice.catch(() => null);
		offer = null;
		$('instalar').hidden = true;
	});
	addEventListener('appinstalled', () => {
		$('instalar').hidden = true;
	});
}

$('resultado').addEventListener('click', (e) => {
	const go = (sel) => e.target.closest(sel);
	if (go('[data-voltar]')) return showList();
	const it = go('[data-abrir]');
	if (it) return open(it.dataset.abrir);
	const sc = go('[data-escopo]');
	if (sc) {
		scope = sc.dataset.escopo;
		save('varredura', scope);
		return showList();
	}
	const keep = go('[data-guardar]');
	if (keep) {
		if (keep.dataset.guardar !== broken && !watchlist.includes(keep.dataset.guardar)) watchlist = [...watchlist, keep.dataset.guardar];
		save('lista', watchlist);
		if (current) $('r-topo').innerHTML = renderTop(current);
		return;
	}
	const drop = go('[data-tirar]');
	if (drop) {
		watchlist = watchlist.filter((t) => t !== drop.dataset.tirar);
		save('lista', watchlist);
		if (current) $('r-topo').innerHTML = renderTop(current);
		return;
	}
	const range = go('[data-faixa]');
	if (range) {
		settings.range = range.dataset.faixa;
		persist();
		chart.setCount(barsFor(settings.range, settings.profile));
		$('faixas').querySelectorAll('button').forEach((b) => b.classList.toggle('ativo', b === range));
		return;
	}
	const layer = go('[data-camada]');
	if (layer) {
		const k = layer.dataset.camada;
		settings.layers[k] = !settings.layers[k];
		persist();
		chart.setLayer(k, settings.layers[k]);
		layer.classList.toggle('ativo', settings.layers[k]);
		if (current) renderChartBar(current);
	}
});

renderControls();
persist();
showList();
if (ONLINE) showSiteData();
