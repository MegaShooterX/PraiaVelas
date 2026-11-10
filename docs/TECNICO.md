# PraiaVelas: parte técnica

## Por que JavaScript puro

O sistema tem que rodar no celular (APK), no navegador e no PC. JavaScript puro, sem etapa de montagem, roda nos três com o mesmo código: o que está em `app/` é o que vai para o APK (Capacitor, como o PraiaPuzzle), e as ferramentas de terminal (`ferramentas/`) usam o mesmo motor pelo Node. Python foi descartado por isso (08/11/2026).

## Pastas

| Pasta | O que tem |
|---|---|
| `app/` | O aplicativo inteiro: `index.html`, `estilo.css`, `principal.js` (a tela), `grafico.js` (gráfico de candles em canvas, sem biblioteca) |
| `app/motor/` | O estudo, sem nada de tela: dados, juros (Banco Central), indicadores, candles, estratégias, backtest, mercado, aprendizado (o modelo que ordena o Top 10), projeção, robô, diário (a lição que o robô tira dos próprios acertos e erros) e `analise.js`, que junta tudo |
| `ferramentas/` | Os programas de terminal:<br>• `bancada.mjs`: o teste rápido de variantes do modelo (uma data a cada 5 pregões, minutos).<br>• `diario.mjs`: o diário do robô (lacra cada pregão, confere o que venceu, aprende); usa `diario-nucleo.mjs`, `diario-trabalho.mjs` (um por núcleo do PC) e `diario-relatorio.mjs`.<br>• `site.mjs`: monta o site do GitHub Pages com os dados do dia.<br>• `servidor.mjs`: serve o app em http://localhost:5190, faz o papel de porta para o Yahoo e o Banco Central, e mostra os testes em `/experimentos/`, com os botões de novo estudo.<br>• `robo.mjs`: o robô no terminal.<br>• `analisar.mjs`: o estudo de um ativo.<br>• `experimento.mjs`: o teste às cegas.<br>• `relatorio.mjs`: os relatórios lite e avançado.<br>• `causalidade.mjs`: a prova de que o motor não olha o futuro, rodada antes de congelar.<br>• `apk.mjs`: o APK. |
| `celular/` | A configuração do app Android (`capacitor.config.json`) |
| `docs/` | Esta parte técnica |

Fora do Drive, em `D:\Projetos\PraiaVelas` (`PRAIAVELAS_SAIDA` muda a pasta): `cache` (cotações do terminal), `versoes` (motores congelados), `experimentos` (lacres e resultados) e `diario` (o diário do robô, uma pasta por motor). No app, o cache é o `localStorage` (6 horas).

## Versões

Sobem de 0.0.1 em 0.0.1, até 0.0.99, e **só quando o Rhuan pedir** (09/11/2026). `ENGINE_VERSION` fica em `app/motor/analise.js`. Enquanto não há número novo, o que muda é um **rascunho** (`ENGINE_DRAFT = true`): o app mostra o último número com "+" (0.0.4+), e o teste congela o rascunho pelo hash do código (`versoes\rascunho-<hash>`).

| Versão | O que é | Congelada em |
|---|---|---|
| 0.0.1 | O MVP: cada ativo estudado sozinho | `versoes\0.0.1` (hash a8eed58…) |
| 0.0.2 | As correções propostas depois do teste da 0.0.1 (08/11/2026) | `versoes\0.0.2` (hash 9b3c6c…) |
| 0.0.3 | O robô que aprende com o último ano e ordena o Top 10 (09/11/2026); 41 FIIs e 22 ações | `versoes\0.0.3` (hash 09ab2d…) |
| 0.0.4 | A chance de render mais que a média do grupo, com 8 medidas comparadas entre os ativos e os anos antigos como ponto de partida (09/11/2026) | `versoes\0.0.4` (hash 5febf4…) |
| 0.0.5 | A 0.0.4 mais, nos FIIs, duas medidas dos relatórios mensais à CVM: P/VP e a mudança do patrimônio por cota em 12 meses (09/11/2026). Testada e não adotada: não foi melhor que a 0.0.4 e baixa 10 MB da CVM. | `versoes\0.0.5` (hash ac66ec…) |
| rascunho | O pacote de 09/11/2026: a 0.0.4 com a segunda opinião da 0.0.3 e o prazo de 3 meses só com a lição dos anos antigos, e o P/VP na tela. Testado; as duas mudanças do robô não passaram nas suas regras. Lacrado toda sexta ao lado do app. | `versoes\rascunho-fbd2177e` |
| rascunho | A lógica da 0.0.4 com o P/VP na tela (as duas mudanças do pacote desligadas, `SECOND_OPINION` e `OLD_LESSON` em `analise.js`). Era o app até 10/11/2026; segue lacrado toda sexta. | `versoes\rascunho-8f266276` |
| rascunho | **O que o app usa (0.0.4+, desde 10/11/2026):** o mesmo, mais o diário do robô (`diario.js`, `journalEntry` em `analise.js`). A chance do modelo é a mesma da 0.0.4; a lição do diário a corrige só se passou no teste dela. | `versoes\rascunho-caf39bc4` |

Mudou o motor depois de congelar? Congela de novo: é outro rascunho, sem número novo. Teste nunca roda do `app/motor`, só de uma cópia congelada.

O app roda o que provou mais, não o mais novo. Uma mudança testada que não passou na sua regra sai do app (ou fica desligada no código) e segue no teste do futuro.

## Os relatórios dos FIIs na CVM (`cvm.js`)

No app, só para **mostrar** o P/VP na página do fundo; o robô não usa. Na 0.0.5 eles entraram no modelo e não ajudaram (veja o resultado abaixo).
- **Fonte:** o informe mensal de cada FII em dados.cvm.gov.br, um zip por ano. O app baixa os últimos 16 meses (uns 3 MB da primeira vez); a 0.0.5 lia desde 2016 (uns 10 MB). O zip é aberto com o `DecompressionStream` do próprio navegador, sem biblioteca. No celular, o arquivo vem pelo HTTP do Capacitor em base64.
- **Cada fundo pelo CNPJ, não pelo código:** outros fundos entregam com o ISIN do XPML11 e do TRXF11, e três mudaram de código (PCIP11 era CVBI11, BTCI11 era FEXC11, e o KNUQ11 entrega com outro ISIN). A tabela `FUND_IDS` foi conferida pelo P/VP perto de 1.
- **Sem olhar o futuro:** um relatório só vale do dia seguinte à entrega (`Data_Entrega`), que leva uns 45 dias do começo do mês. A prova (`causalidade.mjs`) entrega os relatórios ao motor sem o corte, embaralhados depois dele e com relatórios falsos a mais, e o estudo sai igual. Conferido também que ela pega um motor que lê pelo mês.
- **Desdobramentos:** o Yahoo divide os preços antigos pelos desdobramentos posteriores. O patrimônio por cota é dividido do mesmo jeito, com os desdobramentos que aparecem nos relatórios: no mesmo mês, o VP cai k vezes e as cotas sobem k vezes, com o patrimônio total igual. É troca de unidade e não diz nada do retorno.
- **Vacância e inadimplência ficaram de fora** (relatório trimestral): o HSML11 informa 91% de vacância desde o fim de 2025, o KNRI11 0% em todos os trimestres, o BRCR11 pula de 12% para 51% e volta, e a inadimplência é zero em 89% dos imóveis.
- **Resultado:** os dados não ajudaram. Nos FIIs, no prazo de 1 mês, os 10 de maior chance ficaram iguais aos da 0.0.4 (+0,11% contra +0,12% por mês acima de todos os FIIs, t pareado de −0,08).

## O diário do robô (desde 10/11/2026)

- **O pedido:** "ao fazer o relatório, no dia que executar, ele mapeia novamente e diz depois se acertou e errou, com isso melhora a análise e tenta de novo no próximo dia... (que isso poderia também ser treinado do passado pra trás)" (Rhuan, 10/11/2026).
- **Cada dia** (`journalEntry` em `analise.js`): a chance do modelo para os 63 ativos nos três prazos, com todos os históricos cortados naquele dia. É a mesma chance do app e dos testes lacrados (no máximo 0,0002 de diferença para o `2026-11-09-top10-app`, das revisões do Yahoo).
- **A conferência** (`scoreDay` em `diario.js`): quando o prazo vence (5, 21 ou 65 pregões), quem rendeu mais que a média do seu grupo, com dividendos. Nunca antes do prazo.
- **A lição** (`lessonFor` e `applyLesson`): uma por grupo e prazo, aprendida só com os dias já conferidos.
  - Regressão logística do acerto sobre o logit da chance: corrigida = sigmoide(alfa + beta × (logit(chance) − centro)). Beta 1 é "confia como está"; 0 é "não sabe"; nunca negativo.
  - Como o modelo: os dias antigos dão o ponto de partida, o último ano decide (2 anos no prazo de 3 meses), lambda 10, cada dia pesando 1/prazo.
  - Dentro de um grupo a ordem não muda. Muda o quanto ele tem certeza (e por isso quando compra) e a mistura de FIIs e ações no Top 10.
- **O passado vivido** (`diario.mjs passado`): os 1.954 pregões de 02/01/2019 a 06/11/2026, cada um com o motor congelado `rascunho-caf39bc4` e só os dados até ele, em 7,6 minutos com 14 ajudantes em paralelo (`diario-trabalho.mjs`). Lacre `7d697c…`.
- **O teste** (`revelar-passado`, regras no `plano.md`, escrito antes): **não passou.** A lição entraria no app com as chances mais honestas em 2 dos 3 prazos e o Top 10 de 1 mês sem piorar.

  | Prazo | Dias | Log-loss com a lição × sem | Top 10 − todos, com × sem | 60% ou mais acertou, com × sem |
  |---|---|---|---|---|
  | 1 semana | 1.950 | 0,69232 × 0,69208 (pior) | +0,031% × +0,043% | 52% de 317 × 61% de 117 |
  | 1 mês | 1.934 | 0,69331 × 0,69318 (pior) | +0,098% × −0,072% | 44% de 411 × 49% de 1.318 |
  | 3 meses | 1.890 | 0,69536 × 0,69624 (melhor) | +0,276% × +0,177% | 33% de 834 × 36% de 1.227 |

  - Ficou em 1 de 3 prazos (a regra pedia 2). O Top 10 de 1 mês melhorou (+0,17%), mas uma regra só não basta.
  - **O que o teste mostrou além da regra:**
    - **As chances quase não dizem nada:** o log-loss ficou perto do de uma moeda (0,6931) nos três prazos, com ou sem a lição. Não há o que calibrar.
    - **A calibragem de 63% era sorte da amostra:** no teste de uma data por mês, quem teve 60% ou mais em 1 mês bateu o grupo em 63% das vezes (65 casos). Vivido todo pregão, foram 49% (1.318 casos, uns 63 independentes).
    - A lição ajudou em 3 meses e no Top 10 de 1 mês, e atrapalhou em 1 semana. Usar só onde ajudou seria escolher olhando o resultado: fica para o futuro julgar.
- **Todo dia útil** (`diario.mjs hoje`, pela tarefa "PraiaVelas: robô do dia"):
  - vive o dia do fechamento (se o Yahoo ainda não tem o fechamento de mais de 5 ativos, espera 10 minutos, até 2 vezes);
  - corrige com a lição do dia e lacra as duas chances, a do modelo e a corrigida, com o que o robô faria com cada uma e os dois Top 10 (`dias\<data>.json`, SHA-256 em `lacres.jsonl`);
  - confere os dias lacrados cujo prazo venceu (`placar.json`), escreve `licao.json` (o que o app lê) e os dois relatórios.
  - Um dia lacrado nunca é reescrito. Dia perdido é vivido depois e marcado como refeito: entra na lição, não na prova.
- **No app:** a tela inicial mostra a última aposta que venceu ("Como o robô foi: no Top 10 de 1 semana de 30/10, 6 de 10 renderam mais que a média do grupo..."). A chance corrigida só aparece com `apply: true` no `licao.json`, e só sobre a mesma lógica de chance (`MODEL_LOGIC` em `analise.js`). Hoje é `false`.
  - No PC, o app lê `/diario/licao.json` (o diário lacrado aqui); no site, `dados/diario.json`; no celular, o do site.
- **No site:** o `site.mjs` vive só os 3 dias que a tela mostra (1 semana, 1 mês e 3 meses atrás), em segundos. Só viveria todos os dias desde 2019 se a lição estivesse em uso; o veredito vem de `ferramentas/diario-veredito.json`, cópia do veredito do PC.
- **Relatórios** (`diario-relatorio.mjs`), em `D:\Projetos\PraiaVelas\diario\<motor>` e em http://localhost:5190/diario/:
  - **lite:** o que venceu hoje (acertou ou errou, ativo por ativo), o placar dos dias lacrados, o passado, o que o robô diz hoje nos três prazos e o que ele aprendeu;
  - **avançado:** abas Resumo, Hoje, Placar, Passado (ano a ano, com e sem a lição), Lição (a confiança ao longo do tempo), Lacres e Plano.
- **A prova de que não olha o futuro** (`causalidade.mjs`) confere também o diário: cada dia recebe os históricos inteiros, embaralhados depois do dia, e as chances saem iguais; a lição recebe dias ainda não vencidos, embaralhados, e não muda. Conferido que ela pega um diário que lê 5 dias à frente e uma lição que usa dias não vencidos.
- **Comandos:** `node ferramentas/diario.mjs passado | revelar-passado | hoje | relatorio | conferir`. Motor novo (outro hash) começa outro diário, em outra pasta, com o passado vivido de novo.

## As melhorias do modelo de 10/11/2026 (testadas, nenhuma entrou)

- **Por quê:** o diário mostrou o modelo confiante demais em todos os grupos e prazos, com chances de moeda. As duas coisas apontam para um modelo que segue o barulho de um ano só (um ano tem uns 12 períodos de 1 mês).
- **As variantes** (só muda `LEARNING` em `aprendizado.js`, congeladas em `versoes`; plano em `D:\Projetos\PraiaVelas\diario\melhorias-2026-11-10\plano.md`, escrito antes):
  - **firme** (`rascunho-52cd2161`): lambda 30 em vez de 10;
  - **anos** (`rascunho-e1ffccc2`): um ajuste com todos os anos desde 2017, cada ano pesando metade do seguinte;
  - **ambos** (`rascunho-54c6c7ee`).
- **A bancada** (`ferramentas/bancada.mjs`): cada variante vive uma data a cada 5 pregões desde 2019 (391 datas, cerca de 1 minuto cada) e é comparada com as chances lacradas do modelo de hoje nas mesmas datas.
- **Resultado: nenhuma passou.** A regra pedia o Top 10 de 1 mês melhor que o de hoje com t de pelo menos 1,5, e chances mais honestas em 2 dos 3 prazos.

  | Variante | Top 10 de 1 mês contra o de hoje | Log-loss menor | Top 10 de 3 meses contra o de hoje |
  |---|---|---|---|
  | firme | −0,07% (t 0,39) | 3 de 3 | −0,53% (t −1,90) |
  | anos | −0,02% (t 0,48) | 3 de 3 | −0,37% (t −1,14) |
  | ambos | −0,16% (t −0,74) | 3 de 3 | −1,32% (t −2,21) |

- **O que isso ensina:** aprender com mais calma deixa a chance mais modesta (e por isso mais honesta), mas não ordena melhor. O limite está no que as 8 medidas sabem, não em como o modelo aprende com elas. Melhorar a ordem pede informação nova, testada do mesmo jeito.
- **O que se repetiu nas quatro versões:** os 10 melhores FIIs no prazo de 1 semana renderam mais que todos os FIIs (+0,04% a +0,09% por semana). É a mesma pista da 0.0.4, da 0.0.5 e do pacote; o diário vai conferi-la daqui para frente.

## O site no GitHub Pages

- **Endereço:** https://megashooterx.github.io/PraiaVelas/ (código em https://github.com/MegaShooterX/PraiaVelas, público).
- **Por que não é só copiar o app:** no navegador, o app busca o Yahoo e a CVM pelo proxy do PC (`servidor.mjs`), porque eles não deixam uma página de outro site ler direto. No GitHub Pages não há proxy.
- **Como funciona:**
  - `.github/workflows/site.yml` roda todo dia útil às 22h30 UTC (19h30 em Brasília) e a cada push;
  - `ferramentas/site.mjs` faz o que o app faz ao abrir (o estudo dos FIIs e das ações), guarda cada resposta do Yahoo e da CVM e monta o site com `app/` e `dados/`;
  - no site, `app/estatico.js` responde os pedidos de `/proxy?u=...` com o arquivo de `dados/` daquele endereço (`snapshotName`). O Banco Central deixa qualquer site ler, então vai direto.
- **O motor não muda:** `estatico.js` fica fora de `app/motor`. No PC e no celular ele não faz nada.
- **Se o Yahoo recusar mais de 3 ativos**, o trabalho falha e o GitHub mantém o site do dia anterior.
- **Instalável no celular (10/11/2026):** `app/manifest.webmanifest` e `app/sw.js` deixam o Chrome do Android instalar o site como app; o botão "Instalar" aparece quando o navegador oferece (`beforeinstallprompt`). O service worker não guarda nada: só mostra um aviso quando não há internet. Os ícones estão em `app/icones`, cortados do desenho de 1024 px que o Codex gerou (`D:\Projetos\PraiaVelas\icone`).
- **Limites:** só os 63 ativos do robô (uma busca de outro código explica isso); dados de uma vez por dia; sem a página de testes. O GitHub desliga trabalhos agendados de um repositório sem commit por 60 dias: um push religa.
- **Testar antes de subir:** `node ferramentas/site.mjs D:\Projetos\PraiaVelas\site` e `node ferramentas/servidor.mjs --site D:\Projetos\PraiaVelas\site` (http://localhost:5191/PraiaVelas/?estatico).
- **Git:** o banco fica em `D:\Projetos\PraiaVelas\git` (`git init --separate-git-dir`); na raiz do Drive há só o arquivo `.git` que aponta para lá. Os commits usam o e-mail privado do GitHub.

## O pacote de 09/11/2026 (testado, desligado no app)

- **Segunda opinião** (`aprendizado-cdi.js`, o modelo da 0.0.3 sem nenhuma mudança): a distância da chance dele para a média do grupo, em log-odds, puxa a chance da 0.0.4 pela metade (`SECOND` = 0,5 em `aprendizado.js`). Precisa do CDI e da Selic do Banco Central.
- **3 meses com a lição antiga** (`recentFit: false` em `trainModel`): o modelo é o dos anos antes da janela, conferido nos últimos 30% da janela, que ele nunca viu.
- **Resultado** (`2026-11-09-top10-pacote`, regras fixadas antes no `plano.md`):
  - no prazo de 1 mês, ordenar com a segunda opinião deu o mesmo que sem ela (−0,0009% por mês): saiu;
  - no prazo de 3 meses, a lição antiga melhorou a calibragem (46% contra 36%), mas o Top 10 piorou (−0,12% contra −0,03%): saiu.
- **O que o futuro vai julgar:** com a segunda opinião, o robô comprou o dobro de vezes no prazo de 1 mês (45 contra 22), com o mesmo acerto contra o grupo, e ordenou melhor no de 3 meses (+0,40%, t de 1,66). Isso não estava na regra.
- **Comparação justa:** o Yahoo revisa pouca coisa do histórico de um dia para o outro. Por isso, o pacote foi comparado com a lógica da 0.0.4 rodada nos mesmos dados (`2026-11-09-top10-app`). Nos mesmos dados, a 0.0.4 e o app atual dão chances idênticas (1.021 comparadas).

## O robô que aprende (0.0.4)

- **A pergunta:** no prazo (1 semana, 1 mês ou 3 meses), este ativo vai render mais que a média do seu grupo, com os dividendos? FIIs contra os 41 FIIs, ações contra as 22 ações. É o que um Top 10 precisa saber, e tira da conta o movimento do mercado inteiro, que na 0.0.3 decidia quase tudo.
- **A foto de cada dia** (`aprendizado.js`, `dataset`): para cada candle de cada ativo, 8 medidas, todas só com o que existia até ali:
  - dividendos de 12 meses sobre o preço;
  - distância da máxima do ano;
  - movimento em 6 meses e no prazo;
  - o repique dos últimos dias;
  - a agitação do último mês contra o normal do próprio ativo;
  - o "virando para cima": acima da média curta, ainda abaixo da do meio;
  - o volume negociado.
- **Comparada com os outros** (`relativize`): em cada dia, cada medida vira "quantos desvios acima ou abaixo da média do grupo naquele dia". O alvo também: o retorno menos a média do grupo no mesmo prazo. Dias com menos de 5 ativos ficam de fora. Um ativo buscado fora do grupo é comparado com o último dia do grupo (`compare`).
- **O que aprende:**
  - O **último ano** decide (2 anos no prazo de 3 meses), porque o mercado antigo é outro (Rhuan, 09/11/2026).
  - Os anos mais antigos dão o **ponto de partida**: primeiro um modelo com eles, puxado para o zero; depois o do último ano, puxado para esse ponto de partida (λ = 10 nos dois). Um ano que diz pouco deixa a lição antiga; um ano que diz algo claro a corrige.
- **Como aprende:** regressão logística em que cada foto pesa 1/prazo, porque fotos vizinhas dividem o mesmo futuro.
- **O teste próprio:** aprende nos primeiros 70% da janela e confere nos últimos 30%, contra chutar a média. Sem melhora, a confiança é "baixa" e o robô não manda comprar nem vender.
- **A chance mostrada:** é modesta de propósito, a meio caminho entre o que o modelo diz e a média da janela. Ela ordena o Top 10, misturando FIIs e ações.
- **As explicações:**
  - as medidas que mais pesaram ("Ajuda: paga mais dividendos que os outros");
  - as 50 situações mais parecidas do último ano e quantas renderam mais que a média do grupo.
- **O robô** (`robo.js`):
  - compra com chance de 60% ou mais, mas não com o mercado do grupo caindo sem sinal de virada (ir melhor que os outros ainda pode ser perder dinheiro);
  - vende ação com 30% ou menos;
  - não vende FII;
  - espera em todo o resto, ou quando o modelo não passou no próprio teste.
- **No app:** a tela inicial é o "Top 10 de agora". O estudo dos grupos baixa os 63 ativos uma vez por sessão e guarda só o resumo por 6 horas (`groupStudy`, `ranking`). A 0.0.4 não precisa dos juros do Banco Central; o experimento ainda os usa para medir o retorno acima do CDI.
- **Prova de que não olha o futuro** (`ferramentas/causalidade.mjs`): com preços, volumes e dividendos embaralhados depois de cada data de corte, o modelo, as fotos e as chances saem idênticos (19.442 conferências em 5 datas, 09/11/2026).
- **O que mudou da 0.0.3:** a 0.0.3 perguntava "mais que o CDI?", com 23 medidas (as de cima, os 7 sinais de gráfico, o IFR, juros, Selic, o mercado e a sazonalidade do mês) e aprendia do zero com o último ano. Está congelada em `versoes\0.0.3`.

## Como o estudo funciona (0.0.2)

1. **Dados** (`dados.js`): Yahoo Finance, `query1` e, se recusar, `query2` (`/v8/finance/chart/<CÓDIGO>.SA`, 10 anos diários, com dividendos).
   - Os preços já vêm ajustados a desdobramentos.
   - A coluna `a` (fechamento com dividendos, onde se mede retorno) é calculada aqui (`withDividends`), não vem do Yahoo: o ajuste dele quebra onde o preço está errado.
   - Dias registrados num nível errado que voltam em até 5 pregões (salto de mais de 30% que volta a menos de 3%) são descartados (`dropBadTicks`). Casos achados: XPML11 em janeiro de 2026 e RECR11 em novembro de 2025.
   - O Yahoo recusa (429) o nome de navegador de celular: `rede.js` usa um de computador.
2. **Leitura** (`analise.js`, `PROFILES`): Curto (diário, 5 pregões à frente), Swing (diário, 21) e Posição (semanal, 13 semanas). Os candles diários viram semanais em `candles.js`.
3. **Estratégias** (`estrategias.js`): cada uma dá +1, -1 ou 0 por candle, usando só o passado até ele. Para acrescentar uma, é uma entrada a mais em `STRATEGIES`, com `signal()` e `read()`.
4. **Prova do grupo** (`backtest.js`, `pooledEvaluate`): cada estratégia é testada em todos os FIIs juntos (ou em todas as ações juntas), cada ativo contra a sua própria média.
   - Em cada data, os ativos que deram sinal viram um número só (a média do que renderam a mais): FIIs andam juntos, e vinte sinais no mesmo dia valem quase como um.
   - A estatística t sai dessa série de datas, contada uma vez por horizonte.
   - O acerto vem sempre ao lado da **base** (o quanto os ativos subiam sozinhos).
   - Sem o grupo (sem internet), volta para a prova do próprio ativo, com aviso.
5. **Viés**: modo *ponderada* (peso = t de cada estratégia no grupo, zero abaixo de 0,5) ou *simples* (um voto cada). Abaixo de peso total 4, a nota encolhe para o neutro.
6. **Teste fora da amostra** (`pooledOutOfSample`): pesos aprendidos nos primeiros 70% do calendário do grupo (parando um horizonte antes), conferidos nos últimos 30%. Dá a **confiança**.
7. **Mercado** (`mercado.js`): XFIX11 para FIIs, BOVA11 para ações.
   - **Em alta / em queda**: o preço do índice está acima (abaixo) das médias de 21 e de 50 dias (13 e 26 semanas no Posição). **Virando**: está entre as duas.
   - **Agitado**: o último mês oscilou 1,5 vez ou mais o tamanho normal do ano.
8. **Projeção** (`projecao.js`): 2.000 futuros por reamostragem em blocos de 5 candles do passado recente do ativo, sem inclinação (centrados no preço do dia), com os movimentos alargados quando o ativo ou o mercado oscilou mais que o normal no último mês.
9. **Robô** (`robo.js`): COMPRAR com nota ≥ 0,20, confiança média ou alta, mercado em alta e sem agitação. VENDER só ações, com nota ≤ −0,50 e mercado em queda; FII não se vende por sinal técnico. Nota zero = sem opinião. Em todo o resto, FICAR DE FORA, com os motivos escritos e o veredito forçado.

O app junta a prova do grupo baixando os 20 FIIs (ou as 8 ações) na primeira vez. Guarda só o resumo (`cache:grupo:<versão>:<tipo>`), não as cotações, que não caberiam no celular.

## O experimento às cegas

- `node ferramentas/experimento.mjs congelar`: copia `app/motor` para `versoes\<versão>`, ou `versoes\rascunho-<hash>` enquanto é rascunho. Sem `--versao`, os outros comandos usam a cópia congelada do `app/motor`.
- `lacrar --versao X [--pregoes 40,30,20] [--perfis swing] [--sem-serie]`: decide em datas passadas com `historyUntil` (só os dados até a data, do ativo, do grupo e do mercado) e grava as decisões com o SHA-256 delas e do motor congelado.
  - O motor nunca vê o que veio depois: com a história inteira ou cortada, sinais, prova do grupo, mercado e decisão saem iguais até a data do corte (conferido na 0.0.2 com 2 milhões de comparações).
- `lacrar-futuro [--versao X]`: as decisões do último fechamento, para abrir quando cada horizonte passar. Baixa os preços na hora: com a cópia de até 24 horas, em 09/11/2026, 21 FIIs foram decididos com o fechamento de 06/11 (esses lacres foram para `experimentos-descartados`, antes de qualquer resultado).
- `revelar [--comparar <pasta>]`: confere o lacre e só então mede o que aconteceu: retorno com dividendos, CDI do Banco Central (série 12), cone, a média dos outros ativos do mesmo tipo e o índice (XFIX11 ou BOVA11).
  - Uma decisão do teste recente cujo horizonte ainda não chegou é medida até o último fechamento e marcada como parcial. Rodar `revelar` de novo depois atualiza.
  - Uma decisão do futuro fica lacrada até o horizonte passar.
- `atualizar`: `revelar` em todo teste com algo ainda lacrado ou parcial.
- `acumulado`: soma os testes do futuro de cada motor: em cada data, o Top 10 contra todos e os 10 melhores FIIs contra todos os FIIs (`experimentos\futuro-acumulado.json`).
- `relatorio [--comparar <pasta>]`: redesenha os dois relatórios com as `conclusoes.md` da pasta.
  - **Lite** (`relatorio-lite.html`): uma tela, com o veredito, 4 números, o acerto por perfil contra "sempre comprar" e o mapa dos ativos.
  - **Avançado** (`relatorio-avancado.html`): em abas (Resumo, Lado a lado, Ativos, Decisões com filtros, Estratégias, Série, Futuro, Regras e lacre).
  - O lite mostra só a primeira seção das conclusões.
- Universo: até a 0.0.2, 20 FIIs de 6 segmentos e 8 ações; desde a 0.0.3, os 41 FIIs e 22 ações dos grupos. O período de 2019 a 2026 já foi olhado (provas da 0.0.3 e da 0.0.4): um teste nele é de desenho, não prova limpa. A prova limpa é a do futuro.

## Resultados até agora (em `D:\Projetos\PraiaVelas\experimentos`)

| Pasta | Motor | O que mostrou |
|---|---|---|
| `2026-11-08-lacre1-original` | código antes da limpeza de dados | O oficial da 0.0.1: veredito forçado de 45% a 50%, abaixo de "sempre comprar". As vendas foram sinal ao contrário, a "chance de alta" foi otimista demais, e só a largura do cone foi honesta em mercado calmo. A lista de correções está nas conclusões. |
| `2026-11-08-lacre2-dados-limpos` | 0.0.1 | O mesmo com os dados limpos: praticamente igual. |
| `2026-11-08-15pregoes-v0.0.1` e `-v0.0.2` | 0.0.1 e 0.0.2 | 15/10/2026, com tudo caindo depois de 21/10. A 0.0.2 comprou 5 ações com o mercado "em alta e calmo" (agitação de 1,498, contra o limite de 1,5) e perdeu. A 0.0.1 se saiu melhor nessa janela, pelas vendas. Uma janela só: não prova nada. Há correções propostas para a 0.0.3, nenhuma aplicada. |
| `2026-11-09-top10-v0.0.3` | 0.0.3 | A prova do Top 10: uma data a cada 21 pregões, de 2019 a 2026, com plano registrado antes (`plano.md`). Não provou: no prazo de 1 mês, o Top 10 rendeu +0,26% por mês a mais que todos, com t de 0,78 (o plano pedia 2). Em 2019–2022 perdeu; em 2023–2026 ganhou (t 1,74). As chances não estão calibradas: quem tinha 60% ou mais bateu o CDI em 46% das vezes. |
| `2026-11-09-top10-v0.0.4` | 0.0.4 | A mesma prova, com a mesma régua (`plano.md`). Também não provou: no prazo de 1 mês, o Top 10 rendeu +0,13% por mês a mais que todos, com t de 0,63, e ganhou em 52% dos meses. Foi positivo nos dois pedaços (2019–2022 e 2023–2026). A chance ficou honesta: quem teve 60% ou mais rendeu mais que a média do grupo em 63% das vezes (65 casos), e as faixas sobem em ordem (42%, 47%, 53%, 63%). Nas mesmas datas desde 2022, a ordem da 0.0.3 foi melhor no prazo de 1 mês. O período já tinha sido visto: é teste de desenho, não prova limpa. |
| `2026-11-09-top10-v0.0.5` | 0.0.5 | A mesma prova e a mesma régua, mais a pergunta "os dados da CVM ajudam?" (`plano.md`). Não passou em nada: no prazo de 1 mês, o Top 10 rendeu −0,08% por mês contra todos (t de −0,38); quem teve 60% ou mais bateu o grupo em 53% das vezes (79 casos, a régua pedia 55%); 2019–2022 negativo. Os dados da CVM não ajudaram: nos FIIs, diferença de 0,00% para a 0.0.4 nas mesmas datas (t pareado de −0,08). Pista fora da régua: nos FIIs, no prazo de 1 semana, os 10 de maior chance renderam mais que todos os FIIs nas duas versões (t de 3,2 e 2,6). |
| `futuro-2026-11-06`, `-v0.0.2`, `-v0.0.3` e `-v0.0.4` | 0.0.1 a 0.0.4 | O teste que conta. São decisões do fechamento de 06/11/2026: Curto abre por volta de 13/11, Swing por volta de 07/12, Posição em fevereiro de 2027. A 0.0.3 e a 0.0.4 lacraram o Top 10 de cada prazo. |
| `2026-11-09-top10-pacote` | rascunho-fbd2177e | O pacote (veja acima). Não provou: no prazo de 1 mês, +0,15% por mês contra todos (t de 0,73); calibragem de 60% ou mais em 63% (156 casos). As duas mudanças do robô não passaram nas suas regras. |
| `2026-11-09-top10-app` | rascunho-8f266276 | O motor do app (a lógica da 0.0.4 com o P/VP na tela), rodado nos mesmos dados do pacote: +0,15% por mês (t de 0,71), calibragem de 63% (65 casos). |
| `D:\Projetos\PraiaVelas\diario\rascunho-caf39bc4` | rascunho-caf39bc4 | O diário do robô: os 1.954 pregões de 2019 a 2026 vividos um a um, e a lição tirada dos próprios acertos e erros. A lição não passou (chances mais honestas só em 3 meses; a regra pedia 2 dos 3 prazos) e não entra no app. Mostrou que as chances do modelo quase não dizem nada (log-loss de moeda) e que, vivido todo dia, quem teve 60% ou mais em 1 mês bateu o grupo em 49% das vezes, não 63%. Desde 09/11/2026, um dia lacrado por pregão. |
| `futuro-2026-11-09-v0.0.5`, `-rascunho-8f266276` e `-rascunho-fbd2177e` | 0.0.5, app e pacote | As decisões do fechamento de 09/11/2026: Curto abre por volta de 16/11, Swing por volta de 08/12, Posição em fevereiro de 2027. |

**A prova semanal:** toda sexta-feira, a tarefa "PraiaVelas: robô do dia" lacra as decisões do fechamento da lógica da 0.0.4 (`rascunho-8f266276`) e do pacote (`lacrar-futuro --versao`), abre o que venceu (`atualizar`) e soma tudo (`acumulado`). É a prova limpa, que cresce uma semana por vez. O diário do robô soma a ela um dia lacrado por pregão.

Novos estudos também saem pela página http://localhost:5190/experimentos/ (com o app aberto no PC):
- **Lacrar as decisões de hoje:** `lacrar-futuro` com o motor atual congelado.
- **Atualizar os resultados:** `atualizar` e `acumulado`.

Para a prova de uma versão nova:
```
node ferramentas/experimento.mjs lacrar --versao X --sem-recente --desde 2019-01-02 --pasta <nome>
```

## Próximos passos

- Notícias: Google News RSS (`news.google.com/rss/search?q=<CÓDIGO>`) com sentimento por palavras, peso pequeno e avisado, porque não dá para testar no histórico.
- Melhorar a ordem do Top 10 pede informação nova (as variantes de como aprender não ajudaram, 10/11/2026). Cada ideia passa pela `bancada.mjs`, com plano escrito antes.
- O diário: a lição volta a ser julgada pelo futuro (cada dia lacra as duas chances). Proposta para um teste novo, só com o aval do Rhuan: a lição só no prazo de 3 meses, onde ajudou no passado.
- Os FIIs no prazo de 1 semana: foi onde a 0.0.4, a 0.0.5 e o pacote mais separaram os FIIs (t de 2,6, 3,2 e 2,8, fora da régua). A prova semanal do futuro diz se é de verdade.
- A segunda opinião volta ao app se, na prova semanal, o pacote for melhor que o app.
- Mais estratégias: estocástico, ADX, Heikin-Ashi, DY contra a própria média, força relativa contra o IFIX.
- Corretoras: um contrato único (`saldo`, `posições`, `enviar ordem`, `cancelar`).
  - Primeiro uma corretora **simulada**, para testar os sinais sem dinheiro.
  - Depois, uma ponte no PC para corretoras que operam B3 pelo MetaTrader 5.
  - Toda ordem real com confirmação de quem usa.
