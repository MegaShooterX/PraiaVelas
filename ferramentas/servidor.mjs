// Serves the app on this computer, to use it in the browser while it is made.
//
//   node ferramentas/servidor.mjs        http://localhost:5190
//
// It also lends the page a door to the data (/proxy?u=...): Yahoo and Google News do not let a web page read
// them directly. Only the hosts in ALLOWED_HOSTS go through. In the Android app this is not needed: the phone
// downloads them itself.
//
// /experimentos/<pasta>/relatorio-lite.html (or -avancado) shows the reports of the blind tests, read-only, from
// D:\Projetos\PraiaVelas\experimentos (PRAIAVELAS_SAIDA changes it): they are kept off the Google Drive.
//
// /diario/ shows the robot's journal (ferramentas/diario.mjs): its two reports and licao.json, which the app on this
// computer reads to correct the chances when the journal's lesson is in use. From D:\Projetos\PraiaVelas\diario.
//
// /experimentos/ also has buttons for a new study (POST /acoes/<nome>): only the fixed actions in ACTIONS run, one
// at a time, and only when asked from this computer by a page of this server (not from the network, not from
// another site).
//
//   node ferramentas/servidor.mjs --site D:\Projetos\PraiaVelas\site     the site built by ferramentas/site.mjs, as GitHub
//                                                                   Pages serves it: under /PraiaVelas/, with no proxy
//                                                                   (port 5191; open it with ?estatico at the end)

import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALLOWED_HOSTS } from '../app/motor/rede.js';

const project = fileURLToPath(new URL('../', import.meta.url));
const tool = (args) => [join(project, 'ferramentas', 'experimento.mjs'), ...args];
const journalTool = (args) => [join(project, 'ferramentas', 'diario.mjs'), ...args];

/** The studies the buttons may start. Each is a list of node runs of the project's own tools. */
const ACTIONS = {
	'lacrar-hoje': {
		label: 'Lacrar as decisões de hoje',
		// The weekly proof's two series: the logic of 0.0.4 (the app's chances) and the package beside it. The app's own
		// engine is sealed every day by the robot's journal.
		runs: async () => [tool(['lacrar-futuro', '--versao', 'rascunho-8f266276']), tool(['lacrar-futuro', '--versao', 'rascunho-fbd2177e'])]
	},
	atualizar: {
		label: 'Atualizar os resultados',
		// Every test with something still open (a horizon not reached, or measured only in part) is opened again, and
		// the future tests of each engine are added up (experimento.mjs atualizar, acumulado).
		runs: async () => [tool(['atualizar']), tool(['acumulado'])]
	},
	diario: {
		label: 'Atualizar o diário',
		// The day of the last close in the robot's journal (sealed once), and what came due.
		runs: async () => [journalTool(['hoje'])]
	}
};
let job = null;

function startAction(name) {
	if (job && !job.done) return;
	const action = ACTIONS[name];
	job = { name, label: action.label, startedAt: new Date(), done: false, ok: true, log: [] };
	(async () => {
		for (const args of await action.runs()) {
			const result = await new Promise((resolve) =>
				execFile(process.execPath, args, { cwd: project, timeout: 20 * 60_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ error, text: `${stdout}${stderr}` }))
			);
			job.log.push(result.text.trim().split('\n').slice(-12).join('\n'));
			if (result.error) job.ok = false;
		}
		if (!job.log.length) job.log.push('Nada para atualizar: nenhum teste com resultado em aberto.');
		job.done = true;
	})().catch((error) => {
		job.ok = false;
		job.log.push(String(error?.message ?? error));
		job.done = true;
	});
}

/** A button press counts only from this computer and from a page of this server. */
function allowed(req) {
	const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
	const origin = req.headers.origin;
	return local && (!origin || origin === `http://localhost:${port}` || origin === `http://127.0.0.1:${port}`);
}

const root = fileURLToPath(new URL('../app/', import.meta.url));
const experiments = join(process.env.PRAIAVELAS_SAIDA ?? 'D:\\Projetos\\PraiaVelas', 'experimentos');
const journals = join(process.env.PRAIAVELAS_SAIDA ?? 'D:\\Projetos\\PraiaVelas', 'diario');
/** The folder of the current engine's journal (written by diario.mjs), or null before it exists. */
async function journalFolder() {
	try {
		return JSON.parse(await readFile(join(journals, 'atual.json'), 'utf8')).folder;
	} catch {
		return null;
	}
}
const port = Number(process.env.PORT ?? 5190);
const AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const types = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json',
	'.png': 'image/png',
	'.svg': 'image/svg+xml'
};

async function proxy(target, res) {
	let url;
	try {
		url = new URL(target);
	} catch {
		res.writeHead(400).end('endereço inválido');
		return;
	}
	if (url.protocol !== 'https:' || !ALLOWED_HOSTS.includes(url.hostname)) {
		res.writeHead(403).end('fora da lista');
		return;
	}
	try {
		const upstream = await fetch(url, { headers: { 'user-agent': AGENT } });
		const body = Buffer.from(await upstream.arrayBuffer());
		res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'text/plain', 'cache-control': 'no-store' });
		res.end(body);
	} catch (error) {
		res.writeHead(502).end(String(error.message ?? error));
	}
}

/**
 * /experimentos/: one line per blind test, newest first, with its result and the links to its two reports.
 * Same dashboard look as the reports: no margin, 1px lines, only the numbers.
 */
async function experimentsIndex(res) {
	const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
	const pct = (k, n) => (n ? `${Math.round((k / n) * 100)}%` : '—');
	let folders = [];
	try {
		folders = (await readdir(experiments, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
	} catch {
		// No experiment yet.
	}
	const rows = [];
	for (const name of folders) {
		let r = null;
		try {
			r = JSON.parse(await readFile(join(experiments, name, 'resultados.json'), 'utf8'));
		} catch {
			// Sealed and not opened yet: still listed.
		}
		const decisions = r?.decisions ?? [];
		const recent = decisions.filter((d) => d.group === 'recente' && !d.pending);
		const series = decisions.filter((d) => d.group === 'serie' && !d.pending);
		const future = decisions.filter((d) => d.group === 'futuro');
		const opened = [...recent, ...series, ...future.filter((d) => !d.pending)];
		const withOpinion = opened.filter((d) => d.forced !== 0);
		const hits = withOpinion.filter((d) => d.forcedHit).length;
		const up = opened.filter((d) => d.totalRet > 0).length;
		const waiting = future.filter((d) => d.pending);
		const when = decisions.length ? [...new Set(decisions.map((d) => d.date))].sort() : [];
		const years = [...new Set(series.map((d) => d.date.slice(0, 4)))].sort();
		const kind = future.length ? 'Daqui para frente' : series.length ? `${recent.length ? 'Recente + série' : 'Série'} ${years[0]}–${years.at(-1)}` : 'Recente';
		const state = waiting.length ? `${waiting.length} aguardando · abre ~${esc((waiting[0].opensAround ?? '').split('-').reverse().join('/'))}` : r ? 'aberto' : 'lacrado';
		rows.push({
			name,
			sort: r?.seal?.sealedAt ?? name,
			html: `<tr><td>${r ? `<a href="${encodeURIComponent(name)}/relatorio-lite.html"><b>${esc(name)}</b></a>` : `<b>${esc(name)}</b>`}<small>${esc(kind)} · ${when.length === 1 ? esc(when[0].split('-').reverse().join('/')) : `${when.length} datas`}${r ? ` · <a href="${encodeURIComponent(name)}/relatorio-avancado.html">avançado</a>` : ''}</small></td><td>${esc(r?.version ?? '—')}</td><td>${decisions.length}</td><td><b>${withOpinion.length ? pct(hits, withOpinion.length) : '—'}</b></td><td>${opened.length ? pct(up, opened.length) : '—'}</td><td class="esq">${state}</td></tr>`
		});
	}
	rows.sort((a, b) => (a.sort < b.sort ? 1 : -1));
	const running = job && !job.done;
	const status = !job
		? ''
		: running
			? `<p class="job">Rodando: ${esc(job.label)}… (esta página se atualiza sozinha)</p>`
			: `<details class="job ${job.ok ? '' : 'erro'}"><summary>${job.ok ? 'Pronto' : 'Deu erro'}: ${esc(job.label)} · ${job.startedAt.toLocaleTimeString('pt-BR')}</summary><pre>${esc(job.log.join('\n\n'))}</pre></details>`;
	const actions = Object.entries(ACTIONS)
		.map(([id, a]) => `<form method="post" action="/acoes/${id}"><button type="submit"${running ? ' disabled' : ''}>${esc(a.label)}</button></form>`)
		.join('');
	const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Testes às cegas</title>${running ? '<meta http-equiv="refresh" content="3">' : ''}
<style>
.acoes{display:flex;gap:1px;background:var(--line);border-bottom:1px solid var(--line)}.acoes form{flex:1;margin:0}.acoes button{width:100%;height:34px;border:0;background:var(--card);color:var(--accent);font:inherit;font-size:13px;font-weight:650;cursor:pointer}.acoes button:hover{background:#18233a}.acoes button:disabled{color:var(--muted);cursor:wait}
.ajuda{color:var(--muted);font-size:11px;padding:2px 4px;border-bottom:1px solid var(--line)}
.job{margin:0;padding:3px 4px;border-bottom:1px solid var(--line);color:#fde3a7;background:#2a2414;font-size:12px}.job.erro{color:#fecaca;background:#2a1416}.job summary{cursor:pointer}.job pre{white-space:pre-wrap;font-size:11px;color:var(--muted);margin:2px 0}
:root{color-scheme:dark;--bg:#0b1220;--card:#121b2e;--line:#22304a;--text:#e6edf7;--muted:#8b9bb4;--accent:#38bdf8}
*{box-sizing:border-box}html,body{margin:0}body{background:var(--card);color:var(--text);font:13px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.bar{display:flex;gap:8px;align-items:baseline;padding:3px 4px;border-bottom:1px solid var(--line)}.bar h1{font-size:14px;margin:0}.bar span{color:var(--muted);font-size:11px}.bar a{margin-left:auto;font-size:12px}
a{color:var(--accent);text-decoration:none}
.rolar{overflow-x:auto}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{padding:2px 4px;border-top:1px solid var(--line);text-align:right;white-space:nowrap;vertical-align:top}
th{color:var(--muted);font-size:9.5px;text-transform:uppercase;letter-spacing:.04em;font-weight:600;border-top:0;white-space:normal;vertical-align:bottom}
td:first-child,th:first-child,.esq{text-align:left}td small{display:block;color:var(--muted);font-size:10.5px}
p{margin:0;padding:2px 4px;color:var(--muted);font-size:10.5px;border-top:1px solid var(--line)}
</style></head><body>
<div class="bar"><h1>Testes às cegas</h1><span>${rows.length} testes · toque no nome para o relatório</span><a href="/diario/">Diário do robô →</a><a href="/" style="margin-left:8px">← App</a></div>
<div class="acoes">${actions}</div>
<div class="ajuda"><b>Lacrar as decisões de hoje</b>: o robô decide agora, para 1 semana, 1 mês e 3 meses, e o resultado só abre quando cada prazo passar. <b>Atualizar os resultados</b>: abre os testes cujo prazo já venceu e refaz os relatórios.</div>
${status}
<div class="rolar"><table><tr><th>Teste</th><th>Motor</th><th>Decisões</th><th>Forçado</th><th>Só comprar</th><th class="esq">Situação</th></tr>${rows.map((r) => r.html).join('')}</table></div>
<p>"Forçado acertou": o lado que o robô escolheria, nas decisões já abertas e com opinião. "Sempre comprar": quantas subiram, a régua justa. Estudo educativo, não é recomendação de investimento.</p>
</body></html>`;
	res.writeHead(200, { 'content-type': types['.html'], 'cache-control': 'no-store' });
	res.end(html);
}

/** The built site, served as GitHub Pages does (under /PraiaVelas/, no proxy, no buttons), to try it before it goes up. */
const siteArg = process.argv.indexOf('--site');
if (siteArg > 0) {
	const site = normalize(process.argv[siteArg + 1] ?? '');
	const sitePort = Number(process.env.PORT ?? 5191);
	createServer(async (req, res) => {
		const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
		if (!path.startsWith('/PraiaVelas/')) return res.writeHead(302, { location: '/PraiaVelas/' }).end();
		const rest = path.slice('/PraiaVelas'.length);
		const file = normalize(join(site, rest === '/' ? 'index.html' : rest));
		if (!file.startsWith(site)) return res.writeHead(403).end();
		try {
			const body = await readFile(file);
			res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
			res.end(body);
		} catch {
			res.writeHead(404).end('não achei');
		}
	}).listen(sitePort, () => console.log(`Site em http://localhost:${sitePort}/PraiaVelas/?estatico`));
} else
	createServer(async (req, res) => {
	const address = new URL(req.url, 'http://x');
	if (address.pathname === '/proxy') return proxy(address.searchParams.get('u') ?? '', res);
	if (address.pathname === '/experimentos' || address.pathname === '/experimentos/') return experimentsIndex(res);
	if (address.pathname.startsWith('/acoes/')) {
		const name = address.pathname.slice('/acoes/'.length);
		if (req.method !== 'POST' || !ACTIONS[name]) return res.writeHead(404).end('não achei');
		if (!allowed(req)) return res.writeHead(403).end('só deste computador');
		startAction(name);
		return res.writeHead(303, { location: '/experimentos/' }).end();
	}
	const path = decodeURIComponent(address.pathname);
	if (path === '/diario' || path === '/diario/') return res.writeHead(302, { location: '/diario/relatorio-lite.html' }).end();
	const journal = path.startsWith('/diario/') ? await journalFolder() : null;
	if (path.startsWith('/diario/') && !journal) return res.writeHead(404, { 'content-type': types['.json'] }).end('{"erro":"o diário ainda não existe"}');
	const [base, rest] = path.startsWith('/experimentos/') ? [experiments, path.slice('/experimentos'.length)] : journal ? [journal, path.slice('/diario'.length)] : [root, path];
	const file = normalize(join(base, rest === '/' ? 'index.html' : rest));
	if (!file.startsWith(normalize(base))) {
		res.writeHead(403).end();
		return;
	}
	try {
		const body = await readFile(file);
		res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
		res.end(body);
	} catch {
		res.writeHead(404).end('não achei');
	}
}).listen(port, () => console.log(`PraiaVelas em http://localhost:${port}`));
