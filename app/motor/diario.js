// The robot's journal ("o diário do robô"), since the draft of 10/11/2026. Rhuan asked for it: "ao fazer o
// relatório, no dia que executar, ele mapeia novamente e diz depois se acertou e errou, com isso melhora a análise e
// tenta de novo no próximo dia ... (que isso poderia também ser treinado do passado pra trás)".
//
// Every trading day the robot writes down the chance it gives each asset (analise.js, journalEntry: the study of
// each group with every history cut at that day). When a day's horizon has passed (1 week, 1 month, 3 months), the
// day is scored (scoreDay): which assets did better than the average of their group, with dividends. From the
// scored days it learns how far to trust its own chances (lessonFor), and that lesson corrects the next ones
// (applyLesson). The past is lived the same way, one day at a time since 2019, with nothing after each day.
//
// The model already learns again every day from the last year of the market (aprendizado.js). What the journal
// adds is learning from the robot's own record: if it has been too sure of itself, it says less; if it has been
// right more often than it said, it says more. It never turns its opinion around: a run of errors is more often
// bad luck than a model that works backwards. Inside a group the order stays the model's; what changes is how
// sure it is (and so when it buys), and how FIIs and stocks sit side by side in the mixed top 10.
//
// The lesson, fixed on 10/11/2026 before any result of it was seen (plano.md of the journal's test):
// - one lesson per group (FIIs, stocks) and horizon, from the robot's scored days: chance p, and whether the asset
//   beat the group's average (y);
// - a logistic regression of y on logit(p): corrected = sigmoid(alpha + beta * (logit(p) - centre)); "change
//   nothing" is alpha = centre, beta = 1;
// - like the model (aprendizado.js), the older days give the starting point and the last year decides (two years
//   for 3 months): the old fit is pulled toward "change nothing", the recent one toward the old fit, lambda 10 in
//   both;
// - each day weighs 1/horizon: next days share most of their future;
// - beta never below 0 (the robot may conclude it does not know, never the opposite of what it says).

/** Trading days each profile looks ahead (13 weeks = 65 trading days), as in the blind tests. */
export const JOURNAL_HORIZON = { curto: 5, swing: 21, posicao: 65 };
/** The recent part of the lesson: the last year of scored days, two for 3 months (as the model's window). */
export const JOURNAL_WINDOW = { curto: 252, swing: 252, posicao: 504 };
const LAMBDA = 10;
const EDGE = 0.01;

const sigmoid = (t) => 1 / (1 + Math.exp(-t));
const logit = (p) => {
	const q = Math.min(1 - EDGE, Math.max(EDGE, p));
	return Math.log(q / (1 - q));
};

/** The last candle at or before `date` (binary search on the dates). */
function lastIndexUntil(candles, date) {
	let lo = 0;
	let hi = candles.length - 1;
	let found = -1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (candles[mid].date <= date) (found = mid), (lo = mid + 1);
		else hi = mid - 1;
	}
	return found;
}

/**
 * What happened after one group's day of the journal: each asset's return with dividends from the close of the day
 * to the close `h` trading days later (calendar: the trading days), the group's average, and who beat it.
 * rows: [[ticker, p], ...]; at: the day's place in the calendar. Null while the horizon has not passed by `until`
 * (a place in the calendar), so nothing that had not happened yet can be scored.
 */
export function scoreDay(rows, histories, calendar, at, h, until = calendar.length - 1) {
	if (at < 0 || at + h > until) return null;
	const from = calendar[at];
	const to = calendar[at + h];
	const out = [];
	for (const [ticker, p] of rows) {
		const cs = histories[ticker]?.candles;
		if (!cs) continue;
		const i0 = lastIndexUntil(cs, from);
		const i1 = lastIndexUntil(cs, to);
		if (i0 < 0 || i1 <= i0) continue;
		out.push({ ticker, p, ret: cs[i1].a / cs[i0].a - 1 });
	}
	if (out.length < 5) return null;
	const mean = out.reduce((s, r) => s + r.ret, 0) / out.length;
	for (const r of out) r.y = r.ret > mean ? 1 : 0;
	return { from, to, mean, rows: out };
}

/** Ridge logistic regression on z = logit(p) - centre, pulled toward `prior` ([alpha, beta]); beta kept >= 0. */
function fitTwo(records, w, centre, prior) {
	let a = prior[0];
	let b = prior[1];
	for (let iter = 0; iter < 50; iter++) {
		let ga = -LAMBDA * (a - prior[0]);
		let gb = -LAMBDA * (b - prior[1]);
		let haa = LAMBDA;
		let hab = 0;
		let hbb = LAMBDA;
		for (const r of records) {
			const z = r.x - centre;
			const s = sigmoid(a + b * z);
			const e = w * (r.y - s);
			const q = w * s * (1 - s);
			ga += e;
			gb += e * z;
			haa += q;
			hab += q * z;
			hbb += q * z * z;
		}
		const det = haa * hbb - hab * hab;
		const da = (hbb * ga - hab * gb) / det;
		const db = (haa * gb - hab * ga) / det;
		a += da;
		b += db;
		if (Math.abs(da) < 1e-9 && Math.abs(db) < 1e-9) break;
	}
	if (b >= 0) return [a, b];
	// The opposite of what the robot says is not learned: beta stays at 0 (it does not know), and only the level moves.
	a = prior[0];
	for (let iter = 0; iter < 50; iter++) {
		let g = -LAMBDA * (a - prior[0]);
		let hh = LAMBDA;
		for (const r of records) {
			const s = sigmoid(a);
			g += w * (r.y - s);
			hh += w * s * (1 - s);
		}
		const step = g / hh;
		a += step;
		if (Math.abs(step) < 1e-9) break;
	}
	return [a, 0];
}

/** How the robot's chances turned out in a set of scored records: what it said, how often it was right. */
function record(records) {
	const hi = records.filter((r) => r.p >= 0.6);
	const lo = records.filter((r) => r.p <= 0.4);
	const mean = (xs) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : NaN);
	return {
		n: records.length,
		said: mean(records.map((r) => r.p)),
		hit: mean(records.map((r) => r.y)),
		hi: { n: hi.length, said: mean(hi.map((r) => r.p)), hit: mean(hi.map((r) => r.y)), days: new Set(hi.map((r) => r.i)).size },
		lo: { n: lo.length, said: mean(lo.map((r) => r.p)), hit: mean(lo.map((r) => r.y)), days: new Set(lo.map((r) => r.i)).size }
	};
}

/**
 * The lesson of one group and profile on the day at place `asOf` of the calendar. records: [{ i, p, y }], each a
 * chance given on the day at place i and what followed; only those whose horizon had passed by asOf are used
 * (i + h <= asOf), so the lesson of a day knows only what had happened by then. Null when there is none yet.
 */
export function lessonFor(records, asOf, profile) {
	const h = JOURNAL_HORIZON[profile];
	const W = JOURNAL_WINDOW[profile];
	if (!h) return null;
	const known = records.filter((r) => r.i + h <= asOf && Number.isFinite(r.p) && (r.y === 0 || r.y === 1));
	if (!known.length) return null;
	for (const r of known) r.x = logit(r.p);
	const w = 1 / h;
	const centre = known.reduce((s, r) => s + r.x, 0) / known.length;
	const recent = known.filter((r) => r.i >= asOf - W);
	const old = known.filter((r) => r.i < asOf - W);
	const start = old.length ? fitTwo(old, w, centre, [centre, 1]) : [centre, 1];
	const [alpha, beta] = recent.length ? fitTwo(recent, w, centre, start) : start;
	return {
		profile,
		alpha,
		beta,
		centre,
		start: { alpha: start[0], beta: start[1] },
		days: new Set(known.map((r) => r.i)).size,
		recentDays: new Set(recent.map((r) => r.i)).size,
		n: known.length,
		recent: record(recent),
		old: record(old)
	};
}

/** A chance corrected by the lesson (unchanged without one). */
export function applyLesson(p, lesson) {
	if (!lesson || !Number.isFinite(p)) return p;
	return sigmoid(lesson.alpha + lesson.beta * (logit(p) - lesson.centre));
}

/** The lesson in a person's words: how sure the robot is of its own differences, and what 60% becomes. */
export function lessonWords(lesson) {
	if (!lesson) return null;
	const sixty = applyLesson(0.6, lesson);
	// Said after "no último ano, ele ...".
	const trust =
		lesson.beta >= 0.9 && lesson.beta <= 1.1
			? 'acertou mais ou menos o que dizia: a chance fica quase como estava'
			: lesson.beta > 1.1
				? 'acertou mais do que dizia: a chance ficou mais forte'
				: lesson.beta < 0.1
					? 'não acertou mais que o acaso: a chance ficou perto da média'
					: 'andou confiante demais: a chance ficou mais modesta';
	return { trust, sixty };
}
