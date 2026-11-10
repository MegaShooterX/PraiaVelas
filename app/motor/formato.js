// How numbers are shown to people: the Brazilian way (1.234,56), with a sign when it means up or down.

export function num(value, digits = 2) {
	if (!Number.isFinite(value)) return '—';
	return value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function money(value, digits = 2) {
	return Number.isFinite(value) ? `R$ ${num(value, digits)}` : '—';
}

/** 0.0123 → "+1,2%". */
export function pct(value, digits = 1, signed = true) {
	if (!Number.isFinite(value)) return '—';
	return `${signed && value > 0 ? '+' : ''}${num(value * 100, digits)}%`;
}

/** A difference between two percentages, in points: 0.012 → "+1,2 p.p.". */
export function points(value, digits = 1) {
	if (!Number.isFinite(value)) return '—';
	return `${value > 0 ? '+' : ''}${num(value * 100, digits)} p.p.`;
}

/** Big amounts of money, short: 1 234 567 → "R$ 1,2 mi". */
export function compactMoney(value) {
	if (!Number.isFinite(value)) return '—';
	if (Math.abs(value) >= 1e9) return `R$ ${num(value / 1e9, 1)} bi`;
	if (Math.abs(value) >= 1e6) return `R$ ${num(value / 1e6, 1)} mi`;
	if (Math.abs(value) >= 1e3) return `R$ ${num(value / 1e3, 0)} mil`;
	return money(value, 0);
}

/** "2026-11-06" → "06/11/2026". */
export function dateBr(iso) {
	if (!iso) return '—';
	const [y, m, d] = iso.slice(0, 10).split('-');
	return `${d}/${m}/${y}`;
}

export function ago(time, now = Date.now()) {
	if (!Number.isFinite(time)) return '';
	const hours = Math.max(0, (now - time) / 3_600_000);
	if (hours < 1) return 'agora há pouco';
	if (hours < 24) return `há ${Math.round(hours)} h`;
	const days = Math.round(hours / 24);
	return days === 1 ? 'ontem' : `há ${days} dias`;
}
