// The decision bot: turns the study of an asset into an action, with every reason written down.
//
// Version 0.0.4 (09/11/2026; the rules are the same in the draft of 09/11/2026, whose chance also hears a second
// opinion, the learner of 0.0.3). It uses the chance learned from the group (aprendizado.js) that the asset does
// better than the average of its group over the horizon (all the FIIs, or all the stocks): the question of a
// top 10. The path it follows, and why:
// 1. Buy when that chance is 60% or more: clearly better than a coin toss.
// 2. But not while the whole market of the group is falling (both averages pointing down, no sign of a turn):
//    doing better than the others can still be losing money. When the fall shows the first sign of turning up,
//    buying is allowed again: that is the point the bot is meant to catch.
// 3. Sell (stocks only) when it is 30% or less. A FII is not sold on this: it pays every month, and in the tests
//    of 0.0.1 the funds rose more than average after it sold them. With a low chance the bot waits.
// 4. Act only when the model passed its own check (out of sample inside the window, better than guessing the
//    base rate); otherwise wait, whatever the chance says.
// 5. Otherwise it waits. It still writes down the side it would pick if it had to (chance above or below 50%:
//    better or worse than the others), so every case can be scored.
// The numbers 60% and 30% and the market rule were fixed before any test of this version.

export const RULES = { buyAt: 0.6, sellAt: 0.3, sellsFii: false, notInFallingMarket: true };

/** The rules in words, for the reports. */
export const RULE_LINES = [
	'**O que o robô aprende**: com o último ano de todos os FIIs (ou de todas as ações), a chance de cada ativo render mais que a média do seu grupo no prazo, com dividendos. Ele começa do que valeu nos anos anteriores e o último ano corrige (no prazo de 3 meses, só a lição dos anos anteriores: dois anos têm poucos trimestres para corrigir). Olha 8 medidas, cada uma comparada com os outros ativos no mesmo dia. Uma segunda opinião, o modelo da 0.0.3 (sinais de gráfico, juros e época do ano), puxa a chance para cima ou para baixo conforme ela vê o ativo melhor ou pior que os outros do grupo.',
	'**COMPRAR**: chance de render mais que a média do grupo de 60% ou mais, o modelo passou no próprio teste (acertou melhor que o chute da média, em dados que não usou para aprender) e o mercado do grupo não está caindo (ou já dá sinal de virar para cima).',
	'**VENDER**: só ações, com chance de 30% ou menos, e o modelo passou no próprio teste. Vender = sair da posição (não é venda a descoberto). FII não se vende: com chance baixa, o robô espera.',
	'**ESPERAR**: em todo o resto. Mesmo assim ele registra o **veredito forçado** (o lado que escolheria se fosse obrigado: melhor ou pior que a média do grupo), para todas as decisões serem conferidas.',
	'**Top 10**: os ativos com a maior chance de render mais que a média do seu grupo no prazo, do maior para o menor.'
];

const pctText = (v, d = 0) => `${(v * 100).toFixed(d).replace('.', ',')}%`;
const HORIZON = { curto: '1 semana', swing: '1 mês', posicao: '3 meses' };
/** "a média dos FIIs" / "a média das ações". */
export const averageOf = (group) => `a média ${group?.the === 'as' ? 'das' : 'dos'} ${group?.name ?? 'outros'}`;

export function decide(r) {
	const f = r.forecast;
	const horizon = HORIZON[r.profile?.id] ?? 'no prazo';
	if (!f) {
		return { action: 'FICAR DE FORA', forced: 0, p: NaN, score: 0, probUp: NaN, confidence: 'baixa', expected: NaN, reasons: [], blockers: ['Sem o modelo: não deu para estudar o grupo agora (sem internet?).'], pro: [], con: [] };
	}
	const p = f.p;
	const avg = averageOf(r.group);
	const forced = p >= 0.5 ? 1 : -1;
	const m = r.market;
	const falling = RULES.notInFallingMarket && m && m.trend < 0 && !(m.turn > 0);
	const blockers = [];
	if (f.confidence === 'baixa') blockers.push('O modelo não se mostrou melhor que o acaso no próprio teste: por enquanto ele ordena, mas não manda comprar nem vender.');
	if (p < RULES.buyAt && p > RULES.sellAt) blockers.push(`Chance de render mais que ${avg} em ${horizon}: ${pctText(p)}. Para comprar, precisa de ${pctText(RULES.buyAt)}.`);
	if (p >= RULES.buyAt && falling) blockers.push(`O mercado ${r.group?.the === 'as' ? 'das' : 'dos'} ${r.group?.name ?? 'ativos'} está caindo, sem sinal de virar: ir melhor que os outros ainda pode ser perder dinheiro. O robô espera a virada.`);
	if (p <= RULES.sellAt && r.kind === 'FII' && !RULES.sellsFii) blockers.push('FII não se vende por esse sinal: paga rendimento todo mês. Com chance baixa, o robô espera.');
	const action = blockers.length ? 'FICAR DE FORA' : p >= RULES.buyAt ? 'COMPRAR' : 'VENDER';

	const a = f.analogs;
	const reasons = [
		`Chance de render mais que ${avg} em ${horizon}: ${pctText(p)} (média do último ano: ${pctText(f.base)}).`,
		`Nas ${a.n} situações mais parecidas do último ano, rendeu mais que ${avg} em ${a.beat} (${pctText(a.beat / (a.n || 1))}); em média ${a.mean >= 0 ? '+' : ''}${pctText(a.mean, 1)} de diferença.`,
		...f.drivers.slice(0, 4).map((d) => `${d.effect > 0 ? 'A favor' : 'Contra'}: ${d.text}.`),
		`Modelo aprendido com ${f.rows} situações de ${f.from?.split('-').reverse().join('/')} a ${f.trainedUntil?.split('-').reverse().join('/')}, partindo dos anos anteriores; teste próprio: ${Number.isFinite(f.skill) ? `${f.skill > 0 ? 'melhor' : 'não melhor'} que o chute da média` : 'sem dados'}.`
	];
	return {
		action,
		forced,
		p,
		score: p - 0.5,
		probUp: p,
		confidence: f.confidence,
		expected: a.mean,
		reasons,
		blockers,
		pro: f.drivers.filter((d) => d.effect > 0).map((d) => d.id),
		con: f.drivers.filter((d) => d.effect < 0).map((d) => d.id)
	};
}
