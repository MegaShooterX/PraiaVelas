// Interest rates from the Central Bank (api.bcb.gov.br, SGS), since 0.0.3: the CDI is what money earns standing
// still, so the bot's question became "will this asset earn more than the CDI over the horizon?"; and the Selic is
// one of the strongest forces on FIIs (when it rises, their prices tend to fall).
//
// - series 12: CDI, % per day;  - series 432: Selic target, % per year.
// The SGS answers at most 10 years per request for daily series, so the history comes in blocks of 5.
// Every lookup uses only values up to the date asked: nothing here can see the future.

import { getJson } from './rede.js';
import { load, save } from './armazem.js';

const HOUR = 3_600_000;
const START = '2016-01-01';

const br = (iso) => iso.split('-').reverse().join('/');
const iso = (d) => d.toISOString().slice(0, 10);

async function fetchSeries(code) {
	const rows = [];
	const end = new Date();
	for (let from = new Date(`${START}T12:00:00Z`); from <= end; ) {
		const to = new Date(from);
		to.setUTCFullYear(to.getUTCFullYear() + 5);
		to.setUTCDate(to.getUTCDate() - 1);
		const last = to > end ? end : to;
		const part = await getJson(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados?formato=json&dataInicial=${br(iso(from))}&dataFinal=${br(iso(last))}`);
		for (const r of part) {
			const [dd, mm, yy] = r.data.split('/');
			rows.push([`${yy}-${mm}-${dd}`, Number(String(r.valor).replace(',', '.'))]);
		}
		from = new Date(last);
		from.setUTCDate(from.getUTCDate() + 1);
	}
	const seen = new Set();
	return rows.filter(([d]) => !seen.has(d) && seen.add(d)).sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

/** The CDI and Selic histories, kept for 12 hours (they change once a day). */
export async function fetchRates({ maxAgeMs = 12 * HOUR, force = false } = {}) {
	const key = 'cache:juros:v1';
	const cached = load(key);
	if (!force && cached?.cdi?.length && Date.now() - cached.fetchedAt < maxAgeMs) return cached;
	try {
		const [cdi, selic] = await Promise.all([fetchSeries(12), fetchSeries(432)]);
		const rates = { fetchedAt: Date.now(), cdi, selic };
		save(key, rates);
		return rates;
	} catch (error) {
		if (cached?.cdi?.length) return { ...cached, stale: true };
		throw new Error(`Não consegui baixar os juros do Banco Central: ${error.message ?? error}`);
	}
}

/** The rates as they were known at the end of `date`. */
export function ratesUntil(rates, date) {
	return { ...rates, cdi: rates.cdi.filter(([d]) => d <= date), selic: rates.selic.filter(([d]) => d <= date) };
}

function lastIndexUntil(dates, date) {
	let lo = 0;
	let hi = dates.length - 1;
	let found = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (dates[mid] <= date) (found = mid), (lo = mid + 1);
		else hi = mid - 1;
	}
	return found;
}

const daysBefore = (date, days) => {
	const t = new Date(`${date}T12:00:00Z`);
	t.setUTCDate(t.getUTCDate() - days);
	return iso(t);
};

/**
 * Lookups over the rates: the CDI earned between two closes, the CDI of the last 12 months, the Selic target on a
 * date and how much it moved in the last ~6 months. Each uses only values up to the dates asked.
 */
export function rateTools(rates) {
	const cdiDates = rates.cdi.map(([d]) => d);
	const index = new Float64Array(cdiDates.length);
	let acc = 1;
	rates.cdi.forEach(([, v], i) => (index[i] = acc *= 1 + v / 100));
	const selicDates = rates.selic.map(([d]) => d);
	const selicValues = rates.selic.map(([, v]) => v);
	// The CDI of a day is earned overnight: from the close of a to the close of b, the days after a up to b.
	const indexAt = (date) => {
		const i = lastIndexUntil(cdiDates, date);
		return i < 0 ? NaN : index[i];
	};
	const cdiBetween = (a, b) => indexAt(b) / indexAt(a) - 1;
	const selicAt = (date) => {
		const i = lastIndexUntil(selicDates, date);
		return i < 0 ? NaN : selicValues[i];
	};
	return {
		until: cdiDates.at(-1),
		cdiBetween,
		cdi12: (date) => cdiBetween(daysBefore(date, 365), date),
		selicAt,
		selicChange: (date, days = 182) => selicAt(date) - selicAt(daysBefore(date, days))
	};
}
