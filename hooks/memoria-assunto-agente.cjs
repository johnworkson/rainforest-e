#!/usr/bin/env node
// @categoria: guia
// PreToolUse (Agent): acrescenta ao prompt do subagente os verbetes do GLOSSARIO.md do repo (D1, D9 do
// design 2026-10-08-glossario-compartilhado) e as memorias do projeto da sessao (P2 da #11, abaixo) que tratam do assunto dele
// (design 2026-10-08-memoria-por-assunto, D5/D6). Ramo updatedInput: o harness aceita updatedInput sem
// permissionDecision (tarefa 1), entao este hook nao decide permissao — a portaria segue sendo a unica que
// decide. Somente leitura no banco; nao escreve arquivo nenhum (o arquivo da sessao e so do hook do prompt:
// cada subagente e contexto novo).
// O glossario sai antes e isolado: nao depende do banco nem da raiz de dados. Sem banco, o verbete entra.
// D6: qualquer falha -> stdout vazio e exit 0. O despacho do agente nunca espera nem quebra por isto.
//
// Issue #11 (fork):
// - P1: em auto mode (`permission_mode: "auto"`) nada sai. O classificador do auto mode avalia a
//   entrada que o modelo escreveu; um `updatedInput` sem `permissionDecision` faz o harness recusar o
//   despacho ("a hook changed this call's input after auto mode reviewed it") e o modelo reenvia tudo.
//   Nao ha canal que leve texto ao subagente sem mudar a entrada: `additionalContext` do PreToolUse vai
//   para o pai, e o SubagentStart nao recebe o prompt (nem como casar o agente com este despacho quando
//   ha varios em paralelo). Decidir `allow` para o updatedInput passar pularia o classificador e a
//   portaria, que este hook nunca faz. O glossario sai junto: qualquer mudanca na entrada derruba o veredito.
// - P2: so memoria do projeto da sessao, mais a de outro projeto que o briefing cita (projetosPermitidos).
//   O hook do pedido (UserPromptSubmit) segue mostrando todos os projetos, de proposito.
const fs = require('fs');
const path = require('path');
const { resolverRaiz } = require('./lib/raiz.cjs');
const { buscarPorAssunto, montarBlocoAssunto, projetosPermitidos } = require('./lib/memoria-assunto.cjs');
const { acharGlossario, lerVerbetes, casarVerbetes, montarBlocoGlossario } = require('./lib/glossario.cjs');
const { abrirBancoSomenteLeitura, resolverCaminhos } = require(path.join(__dirname, '..', 'scripts', 'memoria.cjs'));

// Bloco do GLOSSARIO.md casado com o pedido do subagente, ou '' quando nada entra. Nunca lanca.
function blocoGlossarioDoPedido(cwd, original) {
  try {
    const arq = acharGlossario(cwd);
    if (!arq) return '';
    const verbetes = lerVerbetes(fs.readFileSync(arq, 'utf8'));
    const blocoGlossario = montarBlocoGlossario(casarVerbetes(verbetes, original.prompt));
    return blocoGlossario;
  } catch (e) {
    return '';
  }
}

// Bloco de memorias por assunto, ou '' quando nao ha banco, raiz ou candidata. Nunca lanca.
function blocoMemoriaDoSubagente(cwd, prompt) {
  let conexao = null;
  try {
    const { raiz } = resolverRaiz({ cwd, plugin: path.resolve(__dirname, '..') });
    if (!raiz) return '';
    const { caminhoDb, canonico, projeto } = resolverCaminhos(cwd);
    if (!fs.existsSync(caminhoDb)) return '';
    conexao = abrirBancoSomenteLeitura(caminhoDb);
    if (!conexao) return '';
    // Subagente e contexto isolado: nao recebeu o que o pai recebeu, entao nao ha dedupe da sessao
    // (nao le nem grava o arquivo da sessao; o pedido seguinte nao perde nada por causa dele).
    const projetos = projetosPermitidos(conexao, prompt, { canonico, curto: projeto });
    const achadas = buscarPorAssunto(conexao, prompt, { projetoAtual: canonico, jaServidos: new Set(), max: 3, projetos });
    return montarBlocoAssunto(achadas) || '';
  } catch (e) {
    return '';
  } finally {
    if (conexao) {
      try { conexao.close(); } catch (e) { /* melhor esforco */ }
    }
  }
}

// Devolve o JSON a imprimir, ou '' quando nao ha o que injetar. Lanca so em session_id invalido ou stdin ruim.
function executar() {
  const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (payload.tool_name !== 'Agent' && payload.tool_name !== 'Task') return '';
  if (payload.permission_mode === 'auto') return ''; // #11, P1: ver o cabecalho
  const original = payload.tool_input;
  if (!original || typeof original !== 'object' || typeof original.prompt !== 'string' || !original.prompt.trim()) return '';
  const sessao = String(payload.session_id || '');
  if (!/^[A-Za-z0-9_-]+$/.test(sessao)) throw new Error('session_id invalido');

  const cwd = payload.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const blocoGlossario = blocoGlossarioDoPedido(cwd, original);
  const blocoMemoria = blocoMemoriaDoSubagente(cwd, original.prompt);
  const blocos = [blocoGlossario, blocoMemoria].filter(Boolean);
  if (blocos.length === 0) return '';

  const novoPrompt = [original.prompt, ...blocos].join('\n\n');
  const entrada = { ...original, prompt: novoPrompt };
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: entrada } });
}

try {
  const saida = executar();
  if (saida) process.stdout.write(saida + '\n');
} catch (e) {
  process.exitCode = 0;
}
