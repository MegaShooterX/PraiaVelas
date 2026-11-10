// What the FIIs themselves report to the CVM: the book value of each share (valor patrimonial da cota, "VP"), month
// by month, from the monthly report (informe mensal) every FII files, published at dados.cvm.gov.br. Price over VP
// (P/VP) says whether the market pays more or less than what the fund owns; the change of the VP in 12 months says
// whether what each share owns grew or shrank.
//
// Only SHOWN to the person (fund page), not used by the robot: version 0.0.5 put these two measures in the model and
// its blind test of 09/11/2026 showed they did not help (D:\Projetos\PraiaVelas\experimentos\2026-11-09-top10-v0.0.5).
// So the app downloads only the last year or two (about 3 MB the first time), enough for today's P/VP and its
// change in 12 months.
//
// No look-ahead: a report counts from the day after it was filed (Data_Entrega), never from the month it is about.
// The report of a month is filed about 45 days after the month began (median of the 41 FIIs, measured 09/11/2026),
// and a report sent again later counts only from the day it was sent again.
//
// Units: Yahoo divides every past price by the splits that came later (HGLG11 split 1:10 in 2018), so the VP of the
// past is divided by the same splits, found in the reports themselves (in one month the VP falls k times and the
// number of shares grows k times, the fund's total unchanged). Price and VP then speak of the same share, and P/VP is
// the one a person saw on that day. The splits are a change of units, like Yahoo's: they say nothing about returns.
//
// Left out on purpose (09/11/2026): vacancy and default, from the quarterly report. Checked before any test: HSML11
// reports 91% vacancy since the end of 2025, KNRI11 0% in every quarter, BRCR11 jumps from 12% to 51% and back, and
// default is zero in 89% of the properties. Wrong data would teach the bot wrong things.
//
// The files are zips (about 1 MB a year): opened here with the browser's own DecompressionStream, no library.

import { getBytes } from './rede.js';
import { load, save } from './armazem.js';

const HOUR = 3_600_000;
/** The model of 0.0.5 read from 2016; to show today's P/VP, 16 months back are enough (the newest report and the one 12 months before it). */
const MONTHS_BACK = 16;
const URL_OF = (year) => `https://dados.cvm.gov.br/dados/FII/DOC/INF_MENSAL/DADOS/inf_mensal_fii_${year}.zip`;
/** A report older than this (from the month it is about) no longer says what the fund has now. */
const STALE_DAYS = 150;

/**
 * The CNPJ each FII reports under (checked 09/11/2026 against the ISIN of the reports and the price: P/VP near 1).
 * By code alone would go wrong: other funds file with XPML11's and TRXF11's ISIN, and three changed their code
 * (PCIP11 was CVBI11, BTCI11 was FEXC11, KNUQ11 files with another ISIN).
 */
export const FUND_IDS = {
	HGLG11: '11.728.688/0001-47',
	BTLG11: '11.839.593/0001-09',
	XPLG11: '26.502.794/0001-85',
	VILG11: '24.853.044/0001-22',
	LVBI11: '30.629.603/0001-18',
	BRCO11: '20.748.515/0001-81',
	GGRC11: '26.614.291/0001-00',
	GARE11: '37.295.919/0001-60',
	XPML11: '28.757.546/0001-00',
	VISC11: '17.554.274/0001-25',
	HSML11: '32.892.018/0001-31',
	HGBS11: '08.431.747/0001-06',
	KNRI11: '12.005.956/0001-65',
	ALZR11: '28.737.771/0001-85',
	HGRU11: '29.641.226/0001-53',
	TRXF11: '28.548.288/0001-52',
	RBVA11: '15.576.907/0001-70',
	PVBI11: '35.652.102/0001-76',
	JSRE11: '13.371.132/0001-71',
	BRCR11: '08.924.783/0001-01',
	TGAR11: '25.032.881/0001-53',
	RZTR11: '36.501.128/0001-86',
	MXRF11: '97.521.225/0001-25',
	KNCR11: '16.706.958/0001-32',
	KNIP11: '24.960.430/0001-13',
	CPTS11: '18.979.895/0001-13',
	RECR11: '28.152.272/0001-26',
	VGIR11: '29.852.732/0001-91',
	HGCR11: '11.160.521/0001-22',
	RBRR11: '29.467.977/0001-03',
	KNSC11: '35.864.448/0001-38',
	KNHY11: '30.130.708/0001-28',
	MCCI11: '23.648.935/0001-84',
	VRTA11: '11.664.201/0001-00',
	RBRY11: '30.166.700/0001-11',
	XPCI11: '28.516.301/0001-91',
	VGHF11: '36.771.692/0001-19',
	KNUQ11: '42.754.362/0001-18',
	PCIP11: '28.729.197/0001-13',
	BTCI11: '09.552.812/0001-14',
	HFOF11: '18.307.582/0001-19'
};

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (date, days) => {
	const t = new Date(`${date}T12:00:00Z`);
	t.setUTCDate(t.getUTCDate() + days);
	return iso(t);
};
const dayNumber = (date) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

// ------------------------------------------------------------------------------------------------------------ zip

async function inflateRaw(bytes) {
	const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The files of a zip whose name passes `wanted`, as bytes. Only "stored" and "deflate", the two the CVM uses. */
export async function unzip(bytes, wanted = () => true) {
	const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
	let end = -1;
	for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65_557); i--) {
		if (dv.getUint32(i, true) === 0x06054b50) {
			end = i;
			break;
		}
	}
	if (end < 0) throw new Error('arquivo zip sem índice');
	const count = dv.getUint16(end + 10, true);
	let p = dv.getUint32(end + 16, true);
	const out = {};
	for (let k = 0; k < count; k++) {
		if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('arquivo zip quebrado');
		const method = dv.getUint16(p + 10, true);
		const size = dv.getUint32(p + 20, true);
		const nameLength = dv.getUint16(p + 28, true);
		const skip = nameLength + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
		const local = dv.getUint32(p + 42, true);
		const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLength));
		p += 46 + skip;
		if (!wanted(name)) continue;
		const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
		const data = u8.subarray(start, start + size);
		if (method === 0) out[name] = data.slice();
		else if (method === 8) out[name] = await inflateRaw(data);
	}
	return out;
}

// ------------------------------------------------------------------------------------------------------------ csv

/** The rows of a CVM table (";" between columns, Latin-1) whose CNPJ is one of ours, as objects of the columns asked. */
function rowsOf(bytes, columns, cnpjs) {
	const text = new TextDecoder('latin1').decode(bytes);
	const lines = text.split(/\r?\n/);
	const head = lines[0].split(';');
	// The column of the CNPJ was renamed in 2023 (CNPJ_Fundo → CNPJ_Fundo_Classe), and other columns came before it.
	const at = Object.fromEntries(columns.map((c) => [c, head.indexOf(c)]));
	const id = head.indexOf('CNPJ_Fundo_Classe') >= 0 ? head.indexOf('CNPJ_Fundo_Classe') : head.indexOf('CNPJ_Fundo');
	const out = [];
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i];
		if (!line) continue;
		const cells = line.split(';');
		if (!cnpjs.has(cells[id])) continue;
		const row = { cnpj: cells[id] };
		for (const c of columns) row[c] = at[c] >= 0 ? cells[at[c]] : '';
		out.push(row);
	}
	return out;
}

/** One year of monthly reports of our FIIs: ticker → [[month, filed on, VP per share, shares, net worth]]. */
export async function readYear(zipBytes) {
	const tickerOf = new Map(Object.entries(FUND_IDS).map(([t, c]) => [c, t]));
	const cnpjs = new Set(tickerOf.keys());
	const files = await unzip(zipBytes, (name) => /_(geral|complemento)_\d{4}\.csv$/.test(name));
	const general = Object.entries(files).find(([n]) => /_geral_/.test(n))?.[1];
	const extra = Object.entries(files).find(([n]) => /_complemento_/.test(n))?.[1];
	if (!general || !extra) throw new Error('relatório mensal da CVM incompleto');
	const filed = new Map(rowsOf(general, ['Data_Referencia', 'Data_Entrega'], cnpjs).map((r) => [`${r.cnpj}|${r.Data_Referencia}`, r.Data_Entrega]));
	const out = {};
	for (const r of rowsOf(extra, ['Data_Referencia', 'Valor_Patrimonial_Cotas', 'Cotas_Emitidas', 'Patrimonio_Liquido'], cnpjs)) {
		const ticker = tickerOf.get(r.cnpj);
		const vp = Number(r.Valor_Patrimonial_Cotas);
		if (!(vp > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(r.Data_Referencia)) continue;
		const on = filed.get(`${r.cnpj}|${r.Data_Referencia}`);
		(out[ticker] ??= []).push([r.Data_Referencia, /^\d{4}-\d{2}-\d{2}$/.test(on ?? '') ? on : '', vp, Number(r.Cotas_Emitidas) || 0, Number(r.Patrimonio_Liquido) || 0]);
	}
	return out;
}

// ------------------------------------------------------------------------------------------------------- reports

/**
 * The reports of one FII, oldest month first, as { ref, known, vp }: known is the first day the report could be
 * read (the day after it was filed; 75 days after the month began when the filing date is missing), vp is in the
 * units of today's share (see the top of this file).
 */
export function toReports(rows) {
	const byRef = new Map();
	for (const r of rows) byRef.set(r[0], r);
	const list = [...byRef.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
	const factor = new Array(list.length).fill(1);
	let f = 1;
	for (let i = list.length - 1; i >= 0; i--) {
		factor[i] = f;
		if (i === 0) break;
		const [, , vp1, shares1, worth1] = list[i];
		const [, , vp0, shares0, worth0] = list[i - 1];
		const sameFund = worth0 > 0 && worth1 > 0 && Math.abs(worth1 / worth0 - 1) < 0.25;
		const down = vp0 / vp1;
		const up = vp1 / vp0;
		const k = Math.round(down >= 1 ? down : up);
		const sharesMoved = down >= 1 ? shares1 / shares0 : shares0 / shares1;
		if (sameFund && k >= 2 && Math.abs((down >= 1 ? down : up) / k - 1) < 0.05 && Math.abs(sharesMoved / k - 1) < 0.1) f = down >= 1 ? f * k : f / k;
	}
	return list.map((r, i) => ({ ref: r[0], known: r[1] ? addDays(r[1], 1) : addDays(r[0], 75), vp: r[2] / factor[i] }));
}

/** The reports as they could be read at the end of `date`: nothing filed after it. */
export function fundamentalsUntil(fundamentals, date) {
	if (!fundamentals) return null;
	const funds = {};
	for (const [t, reports] of Object.entries(fundamentals.funds)) funds[t] = reports.filter((r) => r.known <= date);
	return { ...fundamentals, funds, until: date };
}

const monthsBefore = (ref, months) => {
	const [y, m] = ref.split('-').map(Number);
	const t = y * 12 + (m - 1) - months;
	return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01`;
};

/**
 * For each date (oldest first): the VP of the newest report that could be read on it, and the VP of the report of
 * 12 months before that one (NaN when unknown, or when the newest is older than STALE_DAYS). Uses, for each date,
 * only reports whose `known` is on or before it.
 */
export function bookSeries(reports, dates) {
	const n = dates.length;
	const vp = new Float64Array(n).fill(NaN);
	const vp12 = new Float64Array(n).fill(NaN);
	const ref = new Array(n).fill(null);
	if (!reports?.length) return { vp, vp12, ref };
	const byKnown = [...reports].sort((a, b) => (a.known < b.known ? -1 : a.known > b.known ? 1 : 0));
	const read = new Map();
	let newest = null;
	let k = 0;
	for (let i = 0; i < n; i++) {
		while (k < byKnown.length && byKnown[k].known <= dates[i]) {
			const r = byKnown[k++];
			read.set(r.ref, r.vp);
			if (!newest || r.ref > newest.ref) newest = r;
		}
		if (!newest || dayNumber(dates[i]) - dayNumber(newest.ref) > STALE_DAYS) continue;
		vp[i] = newest.vp;
		ref[i] = newest.ref;
		vp12[i] = read.get(monthsBefore(newest.ref, 12)) ?? NaN;
	}
	return { vp, vp12, ref };
}

// -------------------------------------------------------------------------------------------------------- download

/** One year, kept: a past year is downloaded again once a month (a fund may send a report again), the last two twice a day. */
async function yearOf(year, { force, now }) {
	const key = `cvm:mensal:${year}`;
	const cached = load(key);
	const current = new Date(now).getUTCFullYear();
	const maxAge = year >= current - 1 ? 12 * HOUR : 30 * 24 * HOUR;
	if (!force && cached?.v === 1 && now - cached.fetchedAt < maxAge) return cached;
	try {
		const funds = await readYear(await getBytes(URL_OF(year), { timeoutMs: 60_000 }));
		const out = { v: 1, year, fetchedAt: now, funds };
		save(key, out);
		return out;
	} catch (error) {
		if (cached?.v === 1) return { ...cached, stale: true };
		// The year just begun may have no file yet.
		if (year === current && /HTTP 404/.test(String(error?.message))) return { v: 1, year, fetchedAt: now, funds: {} };
		throw error;
	}
}

/**
 * The monthly reports of our FIIs of the last MONTHS_BACK months (by year): { fetchedAt, until, funds: { ticker:
 * [{ ref, known, vp }] } }. About 3 MB the first time; then each year is kept, and only the last two come again.
 * onProgress(done, total) tells the screen how far it got.
 */
export async function fetchFundamentals({ force = false, onProgress, now = Date.now() } = {}) {
	const last = new Date(now).getUTCFullYear();
	const start = new Date(now);
	start.setUTCMonth(start.getUTCMonth() - MONTHS_BACK);
	const FIRST_YEAR = start.getUTCFullYear();
	const rows = {};
	let stale = false;
	for (let y = FIRST_YEAR; y <= last; y++) {
		onProgress?.(y - FIRST_YEAR, last - FIRST_YEAR + 1);
		const year = await yearOf(y, { force, now });
		stale ||= Boolean(year.stale);
		for (const [t, list] of Object.entries(year.funds)) (rows[t] ??= []).push(...list);
	}
	onProgress?.(last - FIRST_YEAR + 1, last - FIRST_YEAR + 1);
	const funds = Object.fromEntries(Object.entries(rows).map(([t, list]) => [t, toReports(list)]));
	const until = Object.values(funds).reduce((m, list) => list.reduce((mm, r) => (r.known > mm ? r.known : mm), m), '');
	return { fetchedAt: now, until, stale, funds };
}

/** What a person sees: today's P/VP and how the VP per share changed in 12 months, from the newest report readable. */
export function bookNow(reports, date, price) {
	const s = bookSeries(reports, [date]);
	if (!Number.isFinite(s.vp[0])) return null;
	return { ref: s.ref[0], vp: s.vp[0], pvp: price / s.vp[0], change12: Number.isFinite(s.vp12[0]) ? s.vp[0] / s.vp12[0] - 1 : NaN };
}
