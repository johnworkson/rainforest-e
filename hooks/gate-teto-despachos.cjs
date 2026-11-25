#!/usr/bin/env node
// @categoria: guia
"use strict";
/* Teto de despachos por fluxo (Tarefa 2 do plano flaky-teto, D5, D9-D12, D15-D17).
 * Protege contra: fluxo gastar despacho de agente sem fim (conta todo despacho do fluxo ativo)
 * Não protege contra: agente despachado fora de fluxo (fora de fluxo passa sem contar; é da portaria)
 *
 * PreToolUse de `Task|Agent`, separado da portaria: a portaria só registra desde a #264
 * e não volta a barrar. Este hook decide só sobre contagem; do prompt só tira o sha256 (P4 da #11, abaixo).
 *
 * Exit 0: admitido (e contado) ou fora de fluxo.
 * Exit 2: negado, motivo no stderr. Nunca exit 1: exit 1 num PreToolUse não barra.
 *
 * O contador mora fora do repo, em `<dados>/fluxos/<slug>/despachos.json` (D11),
 * lido e gravado dentro de `comTrava`. Contador ilegível NEGA (D12): ilegível lido
 * como zero zeraria o teto em silêncio. Despacho que a portaria nega também conta (D17).
 *
 * Sem toggle e sem variável de escape (D15): a única porta acima do teto é o
 * `liberar-teto` (tarefa 4). Teto efetivo (tarefa 7): o declarado no cabeçalho do plano
 * (`teto-despachos: N`, D9; sem a linha, max(40, 1,5 x tarefas do plano), D5 do lote B) mais
 * 10 por liberação gravada no estado (D13).
 * Cabeçalho ou liberação ilegível NEGA (D12).
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { caminhoExecutavel } = require(path.join(__dirname, "lib", "resolver-executavel.cjs"));
const { comTrava } = require(path.join(__dirname, "lib", "trava-jsonl.cjs"));
const { lerTetoDeclarado, tetoPadrao, TETO_MINIMO } = require(path.join(__dirname, "lib", "teto-despachos.cjs"));
const { caminhoDoc } = require(path.join(__dirname, "lib", "pastas-docs.cjs"));

const DESPACHOS_POR_LIBERACAO = 10;
const ESPERA_TRAVA_SEG = 10;

/* Reenvio depois de "a hook changed this call's input" (Issue #11 do fork, P4).
 * Em auto mode, um hook que devolve `updatedInput` no Agent faz o harness recusar o despacho, e o
 * modelo reenvia a entrada ja alterada: o prompt original + o bloco que o hook juntou no fim. Os dois
 * passam por aqui e contavam duas vezes. Desde a 2.3.3 o memoria-assunto-agente nao altera nada em
 * auto mode (P1), entao isto e so a protecao barata para o caso que sobrar (outro hook, modo que nao
 * chega no payload). Regra estreita, para nao abrir o teto:
 * - so perdoa quando o prompt novo = um prompt CONTADO ha menos de JANELA_REENVIO_MS + um bloco que
 *   comeca num dos cabecalhos de MARCAS_BLOCO, com os demais campos da entrada iguais;
 * - cada despacho contado perdoa no maximo um reenvio (a impressao sai da lista ao ser usada);
 * - despacho identico ao anterior continua contando (D17 intacto para o laco que repete a mesma entrada).
 * Guarda so o sha256 da entrada, nunca o texto. Lista ilegivel vale vazia: ela nunca nega nem zera o total. */
const JANELA_REENVIO_MS = 10 * 60 * 1000;
const MAX_RECENTES = 50;
const MARCAS_BLOCO = ["\n\n## Memória do assunto", "\n\n## Glossário do repo"];

function impressao(entrada, prompt) {
  const e = entrada && typeof entrada === "object" ? { ...entrada } : {};
  if (prompt !== undefined) e.prompt = prompt;
  const ordenado = Object.keys(e).sort().map((k) => [k, e[k]]);
  return require("crypto").createHash("sha256").update(JSON.stringify(ordenado)).digest("hex");
}

function recentesValidas(lista, agora) {
  if (!Array.isArray(lista)) return [];
  return lista.filter(
    (r) => r && typeof r.h === "string" && /^[0-9a-f]{64}$/.test(r.h) && Number.isFinite(r.em) && agora - r.em <= JANELA_REENVIO_MS && r.em <= agora
  );
}

// Indice em `recentes` do despacho de que este e o reenvio com bloco, ou -1.
function indiceDoReenvio(entrada, recentes) {
  if (!entrada || typeof entrada !== "object" || typeof entrada.prompt !== "string" || recentes.length === 0) return -1;
  const prompt = entrada.prompt;
  for (const marca of MARCAS_BLOCO) {
    let i = prompt.indexOf(marca);
    while (i > 0) {
      const h = impressao(entrada, prompt.slice(0, i));
      const achou = recentes.findIndex((r) => r.h === h);
      if (achou !== -1) return achou;
      i = prompt.indexOf(marca, i + 1);
    }
  }
  return -1;
}

function dizer(texto) {
  try {
    fs.writeSync(2, texto);
  } catch {
    /* stderr fechado: o exit code ainda decide */
  }
}

function negar(texto) {
  dizer(`teto de despachos: ${texto}\n`);
  process.exit(2);
}

function raizDoProjeto(payload) {
  const caminho = (payload && payload.cwd) || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  try {
    return execFileSync(caminhoExecutavel("git"), ["-C", caminho, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return caminho;
  }
}

function raizDeDados(raiz) {
  try {
    const { resolverRaiz } = require(path.join(__dirname, "lib", "raiz.cjs"));
    const r = resolverRaiz({ cwd: raiz });
    if (r && r.raiz) return r.raiz;
  } catch {
    /* resolvedor quebrado: cai no padrão do projeto */
  }
  return path.join(raiz, ".rainforest");
}

// Contador de tarefas é o `extrairTarefas` da `cobertura`, o mesmo do estado.cjs (D5 do lote B).
// O require fica dentro da função: o conferir-fluxo.cjs já carrega a lib do teto no topo (ciclo).
function carregarExtrairTarefas() {
  return require(path.join(__dirname, "..", "scripts", "conferir-fluxo.cjs")).extrairTarefas;
}

// Teto do fluxo: { teto, declarado, liberacoes, tarefas } ou { erro }. Falha de leitura nunca vira o teto padrão (D12).
function tetoDoFluxo(raiz, slug) {
  const relPlano = caminhoDoc("planos", slug, { raiz });
  const plano = path.join(raiz, relPlano);
  let declarado = TETO_MINIMO;
  let tarefas = 0;
  let st = null;
  try {
    st = fs.statSync(plano);
  } catch (err) {
    if (!err || err.code !== "ENOENT") return { erro: `o plano ${plano} nao pode ser examinado (${err && err.code})` };
  }
  if (st) {
    let texto;
    try {
      if (!st.isFile()) throw new Error("nao e um arquivo");
      texto = fs.readFileSync(plano, "utf8");
    } catch (err) {
      return { erro: `o plano ${plano} existe mas nao e um arquivo legivel (${err && err.message})` };
    }
    try {
      tarefas = carregarExtrairTarefas()(texto).length;
    } catch (err) {
      return { erro: `o plano ${plano} nao pode ter as tarefas contadas (${err && err.message}); nada foi admitido` };
    }
    const lido = lerTetoDeclarado(texto, tetoPadrao(tarefas));
    if (lido.erro) return { erro: `plano ${plano}: ${lido.erro}` };
    declarado = lido.teto;
  }

  const arquivoEstado = path.join(raiz, "docs", "rainforest", "estado", `${slug}.json`);
  let liberacoes = [];
  try {
    const estado = JSON.parse(fs.readFileSync(arquivoEstado, "utf8"));
    const bloco = estado && typeof estado === "object" ? estado.teto_despachos : undefined;
    if (bloco !== undefined && bloco !== null) {
      if (typeof bloco !== "object" || Array.isArray(bloco)) throw new Error("teto_despachos nao e objeto");
      if (bloco.liberacoes !== undefined) {
        if (!Array.isArray(bloco.liberacoes)) throw new Error("liberacoes nao e lista");
        const ruim = bloco.liberacoes.findIndex(
          (l) => !l || typeof l !== "object" || typeof l.motivo !== "string" || !l.motivo.trim()
        );
        if (ruim !== -1) throw new Error(`liberacao ${ruim} sem motivo`);
        liberacoes = bloco.liberacoes;
      }
    }
  } catch (err) {
    return { erro: `as liberacoes do teto em ${arquivoEstado} estao ilegiveis (${err && err.message}); nada foi liberado` };
  }

  const teto = declarado + DESPACHOS_POR_LIBERACAO * liberacoes.length;
  return { teto, declarado, liberacoes: liberacoes.length, tarefas };
}

function lerPayload() {
  let bruto;
  try {
    bruto = fs.readFileSync(0, "utf8");
  } catch {
    process.exit(0); // stdin ilegível: libera, como a portaria
  }
  if (!bruto.trim()) process.exit(0);
  try {
    return JSON.parse(bruto);
  } catch {
    process.exit(0);
  }
}

function main() {
  const payload = lerPayload();
  if (!payload || typeof payload !== "object") process.exit(0);
  if (payload.tool_name !== "Agent" && payload.tool_name !== "Task") process.exit(0);

  const raiz = raizDoProjeto(payload);

  // Resolver que estoura ANTES de achar o fluxo passa com aviso (a portaria já nega
  // esse caso); depois de achar o fluxo, qualquer falha nega.
  let fluxo;
  try {
    fluxo = require(path.join(__dirname, "lib", "estagio-ativo.cjs")).resolver({ cwd: raiz });
  } catch (err) {
    dizer(`teto de despachos: aviso, nao consegui resolver o fluxo (${err && err.message ? err.message : err}); despacho passou sem contar\n`);
    process.exit(0);
  }
  if (!fluxo || !fluxo.slug) process.exit(0);

  const slug = fluxo.slug;
  const daJanela = !Object.prototype.hasOwnProperty.call(payload, "agent_id");
  const decidido = tetoDoFluxo(raiz, slug);
  if (decidido.erro) {
    negar(`o teto do fluxo ${slug} esta ilegivel e o despacho foi NEGADO. ${decidido.erro}. Nada foi contado.`);
  }
  const teto = decidido.teto;
  const dir = path.join(raizDeDados(raiz), "fluxos", slug);
  const arquivo = path.join(dir, "despachos.json");
  fs.mkdirSync(dir, { recursive: true });

  // A decisão sai da trava como texto: `process.exit` dentro dela deixaria o lock no chão.
  const motivo = comTrava(path.join(dir, ".despachos.lock"), () => {
    let obj = { total: 0 }; // arquivo ausente = primeiro despacho do fluxo; arquivo presente e ruim NAO e zero
    if (fs.existsSync(arquivo)) {
      const bruto = fs.readFileSync(arquivo, "utf8");
      try {
        obj = JSON.parse(bruto);
      } catch {
        obj = null;
      }
      if (obj === null || typeof obj !== "object" || Array.isArray(obj)) obj = {};
    }
    const total = Number.isSafeInteger(obj.total) && obj.total >= 0 ? obj.total : null;

    if (total === null) {
      return (
        `o contador de despachos do fluxo ${slug} esta ilegivel (${arquivo}) e o despacho foi NEGADO. ` +
          `Contador ilegivel nao e lido como zero: isso zeraria o teto em silencio. Nada foi reescrito.`
      );
    }
    const agora = Date.now();
    const recentes = recentesValidas(obj.recentes, agora);
    const gravar = (novoTotal, lista) => {
      const tmp = `${arquivo}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify({ total: novoTotal, recentes: lista.slice(-MAX_RECENTES) })}\n`, "utf8");
      fs.renameSync(tmp, arquivo);
    };
    // #11, P4: reenvio do mesmo despacho com o bloco que um hook juntou ao prompt (recusa do auto mode
    // "a hook changed this call's input") e o mesmo despacho: passa sem contar, uma vez por despacho contado.
    const perdoado = indiceDoReenvio(payload.tool_input, recentes);
    if (perdoado !== -1) {
      recentes.splice(perdoado, 1);
      gravar(total, recentes);
      return null;
    }
    if (total >= teto) {
      const saida = daJanela
        ? ` Para destravar, com a palavra do usuario: declarar \`teto-despachos: N\` no cabecalho do plano, ou node scripts/estado.cjs liberar-teto --slug ${slug} --motivo "<motivo>" (+${DESPACHOS_POR_LIBERACAO}).`
        : " A decisao de liberar mais despachos e do usuario, na janela principal; pare e reporte.";
      return (
        `o fluxo ${slug} ja admitiu ${total} despachos (conta cumulativa do fluxo inteiro, nao agentes simultaneos), ` +
          `o teto e ${teto} (tarefas do plano: ${decidido.tarefas}), e este despacho foi NEGADO.${saida}`
      );
    }

    recentes.push({ h: impressao(payload.tool_input), em: agora });
    gravar(total + 1, recentes);
    return null;
  }, ESPERA_TRAVA_SEG);
  if (motivo) negar(motivo);
}

if (require.main === module) {
  // Falha interna NEGA com exit 2 (exit 1 não barra). Rede síncrona e de promessas.
  const negarPorFalhaInterna = (origem, err) => {
    dizer(
      `teto de despachos: falha interna (${origem}), e por isso o despacho foi NEGADO — ${
        err && err.message ? err.message : String(err)
      }\n`
    );
    process.exit(2);
  };
  process.on("uncaughtException", (err) => negarPorFalhaInterna("excecao nao capturada", err));
  process.on("unhandledRejection", (err) => negarPorFalhaInterna("promise rejeitada", err));
  try {
    main();
  } catch (err) {
    negarPorFalhaInterna("main", err);
  }
}
