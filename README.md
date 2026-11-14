# PraiaVelas

Um robô que estuda **fundos imobiliários (FIIs)** e ações e diz, em português simples, se compraria, esperaria ou venderia, e por quê. Feito para quem não entende de gráfico.

## Como funciona

- **Início: o Top 10 de agora.**
  - Assim que o app abre, o robô estuda 41 FIIs e 22 ações.
  - Ele mostra, em ordem, os que têm mais chance de **render mais que a média do seu grupo** no prazo escolhido, com os dividendos: FIIs contra FIIs, ações contra ações.
  - Para cada um aparecem a chance, **Comprar**, **Esperar** ou **Vender**, e o motivo em poucas palavras.
  - No topo, uma frase resume o dia e diz como está o mercado, inclusive quando ele começa a virar para cima.
- **Como ele aprende:**
  - O robô compara cada ativo com os outros do grupo, no mesmo dia: quem paga mais dividendos, quem caiu mais da máxima, quem subiu mais, quem está mais agitado, quem dá sinal de virar para cima.
  - Com o último ano, ele aprende quais dessas diferenças costumam vir antes de render mais que os outros.
  - Ele começa do que valeu nos anos anteriores, e o último ano corrige.
- **Toque num ativo** para ver:
  - a recomendação grande e o que fazer, para quem não tem e para quem já tem;
  - até três motivos, sem jargão;
  - o que esperar: a faixa onde o preço costuma ficar no prazo escolhido, quanto o ativo rende por mês e como foi o último ano;
  - nos FIIs, o P/VP: quanto a cota custa perto do patrimônio que ela representa, pelo último relatório do fundo à CVM;
  - um gráfico simples, com o preço e a faixa para onde ele pode ir.
- **Prazo:** 1 semana, 1 mês ou 3 meses. A recomendação muda conforme o prazo.
- **Detalhes técnicos**, dobrados no fim da página, para quem entende: o que o robô aprendeu, as situações mais parecidas do passado, o mercado, as estratégias de gráfico, padrões de candle e dividendos.

## Como o robô decide

Ele só manda comprar quando três coisas acontecem juntas:
- a chance de render mais que a média do grupo é de 60% ou mais;
- o modelo passou no próprio teste, com dados que não usou para aprender;
- o mercado do grupo (o IFIX para FIIs, o Ibovespa para ações) não está caindo, ou já dá sinal de virar para cima. Ir melhor que os outros num mercado em queda ainda pode ser perder dinheiro.

Ação ele manda vender com 30% ou menos. FII ele não manda vender: fundo imobiliário paga rendimento todo mês. Em todo o resto, ele espera.

## O diário do robô: ele confere as próprias apostas

- **Quando o diário é atualizado** (`node ferramentas/diario.mjs hoje`, ou o botão "Atualizar o diário" na página de testes do PC), o robô anota e lacra a chance que deu a cada ativo nos três prazos. Nada roda sozinho no computador: os dias em que ninguém atualizou são vividos depois, marcados como refeitos.
- **Quando o prazo vence** (1 semana, 1 mês ou 3 meses depois), ele confere: quantos do Top 10 renderam mais que a média do grupo, e quanto o Top 10 rendeu a mais (ou a menos) que todos. A tela inicial mostra a última aposta que venceu.
- **Ele aprende com isso.** O modelo já reaprende todo dia com o último ano do mercado. O diário acrescenta outra lição: quanto confiar nas próprias chances. Se ele andou confiante demais (dizia 60% e acertava 52%), a chance mostrada fica mais modesta; se acertou mais do que dizia, fica mais forte. Nunca inverte a opinião: uma sequência de erros costuma ser azar.
- **Treinado do passado para trás:** o robô viveu todos os pregões de 2019 até hoje, um de cada vez, cada um só com os dados até ele, como se rodasse todo dia desde então. A lição de hoje já vem desses anos.
- **A correção só entra no app se passar no teste dela**, com regras escritas antes de ver o resultado. **Não passou** (10/11/2026): deixou as chances mais honestas só no prazo de 3 meses, e a regra pedia 2 dos 3. Por isso o app mostra a chance do modelo, e o diário continua anotando as duas para o futuro julgar.
- O teste mostrou outra coisa importante: as chances do robô ainda quase não dizem nada. Na média dos 1.954 pregões, elas erraram o que aconteceu tanto quanto um cara ou coroa.
- **Melhorar o modelo (10/11/2026):** três jeitos de ele aprender com mais calma (passos mais curtos, todos os anos com peso, os dois juntos) foram testados com regras escritas antes. Deixaram a chance mais modesta e honesta, mas nenhum ordenou melhor o Top 10: o app continua com o modelo de antes. Para ordenar melhor, o robô precisa de informação nova.
- **O Kronos (14/11/2026):** um modelo de inteligência artificial treinado com candles de 45 bolsas foi testado nos anos que ele nunca viu (julho de 2024 em diante). Ordenou pior que o nosso modelo, e por isso não entrou.

O relatório do diário fica em `D:\Projetos\PraiaVelas\diario` e, com o app aberto no PC, em http://localhost:5190/diario/: o lite numa tela (o que venceu hoje, o que ele diz hoje, o placar e o que aprendeu) e o avançado em abas.

## O robô está em teste

Cada versão do robô é testada **às cegas**:
- ele decide em datas passadas vendo só os dados até ali;
- as decisões são lacradas;
- só depois se abre o que aconteceu.

Cada correção vira uma versão nova (0.0.1, 0.0.2, ...), com teste novo. Também há decisões de hoje lacradas, para conferir quando o futuro chegar.

**Até agora, nenhuma versão provou que escolhe melhor que o resto.**
- Na versão atual (0.0.4), o Top 10 de 1 mês rendeu um pouco mais que a média em 2019–2026, mas pouco demais para separar de sorte.
- No teste de uma data por mês, quem teve 60% ou mais rendeu mais que o grupo em 63% das vezes. Vivido todo pregão desde 2019 (o diário), foram 49%: a amostra mensal teve sorte, e a chance ainda não vale o que diz.
- A 0.0.5 olhava também o preço contra o patrimônio dos FIIs (P/VP), dos relatórios que eles mandam à CVM. Não foi melhor que a 0.0.4.
- Depois, um pacote com as ideias que faltavam (uma segunda opinião, o modelo da 0.0.3, e o prazo de 3 meses só com a lição dos anos antigos) também não passou nas regras combinadas antes do teste.
- Por isso o app decide como a 0.0.4 (aparece como 0.0.4+). O que entrou foi o **P/VP na página de cada FII**: quanto a cota custa perto do patrimônio que ela representa, pelo relatório do fundo à CVM. É só informação: o robô não usa.
- **A prova que vale é a do futuro:** as decisões lacradas no próprio dia do fechamento, conferidas quando o prazo vence. A soma delas dirá se o robô escolhe melhor que o resto.

Os resultados ficam em `D:\Projetos\PraiaVelas\experimentos`. Com o app aberto no computador, eles aparecem em http://localhost:5190/experimentos/, cada um com um relatório lite (uma tela) e um avançado (em abas).

> É um estudo estatístico e educativo, não uma recomendação de investimento. O passado não garante o futuro.

## Online

O app está no ar em **https://megashooterx.github.io/PraiaVelas/**, com os dados do último fechamento da B3: o GitHub baixa tudo de novo todo dia útil, por volta das 19h30. No site aparecem só os 63 ativos que o robô estuda. O código está em https://github.com/MegaShooterX/PraiaVelas.

**Na tela do celular, como um app:** abra o site no Chrome do Android e toque em **Instalar**, no alto da tela (ou, no menu do Chrome, em "Instalar app"). O ícone, as velas do gráfico como velas de barco no mar, foi desenhado pelo Codex.

## No celular

Instale o `PraiaVelas.apk` desta pasta (pelo Google Drive do celular; o Android pede para permitir instalar de fontes desconhecidas). Um APK novo, gerado com `npm run apk`, instala por cima do anterior.

## Como abrir

No computador, com o Node instalado, dentro desta pasta:

```bash
npm run app
```

e abra http://localhost:5190 no navegador. Os dados vêm do Yahoo Finance.

O robô no terminal, para todos os ativos de uma vez:

```bash
npm run robo -- --perfil swing
```

O estudo completo de um ativo no terminal:

```bash
npm run analisar -- HGLG11 MXRF11 --perfil swing
```

## O que vem depois

- Notícias.
- No futuro, ligação com corretoras para comprar e vender.

A parte técnica e a lista completa estão em [docs/TECNICO.md](docs/TECNICO.md).
