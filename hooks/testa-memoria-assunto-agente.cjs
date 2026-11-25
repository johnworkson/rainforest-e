#!/usr/bin/env node
'use strict';
console.log('ramo: updatedInput');
// Bateria hermetica de hooks/memoria-assunto-agente.cjs (PreToolUse, ferramenta Agent).
// Sandbox temporario com RFM_ROOT proprio; banco criado pelo criarSchema REAL; o hook roda como
// processo filho recebendo no stdin o JSON no formato da fixture real scripts/fixtures/memoria-assunto/
// agente-pai.jsonl (tool_input do Agent: description, subagent_type, prompt) + session_id/cwd/transcript_path.
// Limiar: 400 memorias de enchimento + alvos de termos raros repetidos, entao os alvos passam do
// LIMIAR_BM25 de verdade; nenhuma variavel de ambiente afrouxa o limiar.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const { criarSchema } = require(path.join(__dirname, '..', 'scripts', 'memoria.cjs'));
const { slugDoCaminho } = require(path.join(__dirname, '..', 'scripts', 'lib', 'projeto-canonico.cjs'));

const HOOK = path.join(__dirname, 'memoria-assunto-agente.cjs');
const PORTARIA = path.join(__dirname, 'portaria.cjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'testa-memoria-assunto-agente-'));
const raiz = path.join(tmp, 'raiz');
const cwdSessao = path.join(tmp, 'projeto-teste');
// O projeto atual da sessão é o canônico do cwd (#435): sem .git, o slug da própria pasta.
const PROJ_ATUAL = slugDoCaminho(cwdSessao);
// Segundo projeto (#11, P2): o canal subagente so serve memoria do projeto da sessao.
const cwdOutro = path.join(tmp, 'outro-projeto');
const PROJ_OUTRO = slugDoCaminho(cwdOutro);
fs.mkdirSync(raiz);
fs.mkdirSync(cwdSessao);
fs.mkdirSync(cwdOutro);

// ---- corpus ----
const caminhoDb = path.join(raiz, 'rainforest.db');
const db = new DatabaseSync(caminhoDb);
criarSchema(db);
const ins = db.prepare('INSERT INTO observacoes (projeto, conteudo, criada_em, origem) VALUES (?, ?, ?, ?)');
// Uma transacao: fora dela cada INSERT e um fsync, e no runner Windows os 400 levam de 14 s a 140 s (#541).
db.exec('BEGIN');
for (let i = 0; i < 400; i++) {
  ins.run(PROJ_ATUAL, 'Registro generico ' + i + '\n\nrotina comum de trabalho numero ' + i + ' sem relevancia', '2026-10-01T10:00:00.000Z', 'f' + i);
}
db.exec('COMMIT');
let n = 0;
for (const nome of ['Alfa', 'Bravo', 'Charlie', 'Delta']) {
  ins.run(
    nome === 'Alfa' ? PROJ_ATUAL : PROJ_OUTRO,
    'Reconciliacao ' + nome + ' zarquon flibbertigibbet\n\n' + ('zarquon flibbertigibbet zarquon flibbertigibbet quasar ' + nome + ' ').repeat(3),
    '2026-10-0' + (2 + n++) + 'T10:00:00.000Z', 'alvo-' + nome);
}
db.close();

const transcrito = path.join(tmp, 'sem-abertura.jsonl');
fs.writeFileSync(transcrito, JSON.stringify({ type: 'user', message: { role: 'user', content: 'oi' } }) + '\n');

const PEDIDO = 'Instrucao: investigue a reconciliacao zarquon flibbertigibbet quasar e responda.\nFIM-DO-BRIEFING';

// ---- infraestrutura ----
function spawnar(alvo, stdin, raizAmbiente = raiz) {
  const env = { ...process.env, RFM_ROOT: raizAmbiente };
  delete env.CLAUDE_PROJECT_DIR;
  const r = spawnSync(process.execPath, [alvo], { input: stdin, env, encoding: 'utf8', timeout: 20000 });
  return { codigo: r.status, saida: r.stdout, erro: r.stderr };
}
const rodar = (stdin, raizAmbiente) => spawnar(HOOK, stdin, raizAmbiente);
function entradaAgente(extra) {
  return Object.assign({
    description: 'Repetir ultima linha do briefing', subagent_type: 'general-purpose',
    model: 'haiku', run_in_background: false, prompt: PEDIDO,
  }, extra);
}
function payload(o, extraEntrada) {
  return JSON.stringify(Object.assign({
    session_id: 'sessao-padrao', transcript_path: transcrito, cwd: cwdSessao,
    hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: entradaAgente(extraEntrada),
  }, o));
}
function saidaJson(saida) { return JSON.parse(saida).hookSpecificOutput; }
function blocoDe(prompt) { return prompt.slice(prompt.indexOf('\n\n## Memória do assunto') + 2); }

let ok = 0, falha = 0;
function caso(nome, fn) {
  let passou = false;
  try { passou = fn() === true; } catch (e) { passou = false; }
  if (passou) { ok++; console.log('ok ' + nome); } else { falha++; console.log('FALHA ' + nome); }
}
const vazioSaiu0 = (r) => r.codigo === 0 && r.saida === '';

// ---- casos ----
caso('updatedInput preserva description, subagent_type, model e qualquer campo extra', () => {
  const extra = { campo_futuro: { a: [1, 2] }, isolation: 'worktree' };
  const r = rodar(payload({ session_id: 'sessao-a' }, extra));
  const h = saidaJson(r.saida);
  const u = h.updatedInput;
  const o = entradaAgente(extra);
  return r.codigo === 0 && h.hookEventName === 'PreToolUse' &&
    u.description === o.description && u.subagent_type === o.subagent_type && u.model === o.model &&
    u.run_in_background === false && u.isolation === 'worktree' &&
    JSON.stringify(u.campo_futuro) === JSON.stringify(extra.campo_futuro) &&
    Object.keys(u).sort().join() === Object.keys(o).sort().join();
});
caso('prompt = original + \\n\\n + bloco "## Memória do assunto" (ate 3 linhas)', () => {
  const r = rodar(payload({ session_id: 'sessao-b' }));
  const p = saidaJson(r.saida).updatedInput.prompt;
  const i = p.indexOf('\n\n## Memória do assunto');
  const linhas = p.slice(i + 2).split('\n').slice(1);
  return i === PEDIDO.length && p.startsWith(PEDIDO + '\n\n## Memória do assunto') &&
    linhas.length >= 1 && linhas.length <= 3 && linhas.every((l) => l.startsWith('['));
});
caso('nao emite permissionDecision', () => {
  const r = rodar(payload({ session_id: 'sessao-c' }));
  const h = saidaJson(r.saida);
  return !('permissionDecision' in h) && !/permissionDecision/.test(r.saida) && Object.keys(h).sort().join() === 'hookEventName,updatedInput';
});
caso('sem candidata nao emite nada', () =>
  vazioSaiu0(rodar(payload({ session_id: 'sessao-d' }, { prompt: 'qual a previsao do tempo amanha cedo' }))));
caso('segunda chamada na sessao recebe as mesmas memorias (subagente nao deduplica)', () => {
  const r1 = rodar(payload({ session_id: 'sessao-e' }));
  const r2 = rodar(payload({ session_id: 'sessao-e' }));
  const l1 = blocoDe(saidaJson(r1.saida).updatedInput.prompt).split('\n').slice(1);
  const l2 = blocoDe(saidaJson(r2.saida).updatedInput.prompt).split('\n').slice(1);
  return l1.length >= 1 && l1.join('\n') === l2.join('\n');
});
caso('pedido e depois Agent do mesmo assunto: o subagente recebe as memorias do pedido e o arquivo da sessao nao muda', () => {
  const PROMPT_HOOK = path.join(__dirname, 'memoria-assunto-prompt.cjs');
  const rp = spawnar(PROMPT_HOOK, JSON.stringify({
    session_id: 'sessao-k', transcript_path: transcrito, cwd: cwdSessao, hook_event_name: 'UserPromptSubmit',
    prompt: 'investigue a reconciliacao zarquon flibbertigibbet quasar e responda',
  }));
  const lp = JSON.parse(rp.saida).hookSpecificOutput.additionalContext.split('\n').slice(1);
  const arq = path.join(raiz, 'memoria-assunto', 'sessao-k.json');
  const antes = fs.readFileSync(arq, 'utf8');
  const ra = rodar(payload({ session_id: 'sessao-k' }));
  const la = blocoDe(saidaJson(ra.saida).updatedInput.prompt).split('\n').slice(1);
  const depois = fs.readFileSync(arq, 'utf8');
  // O pedido mostra outros projetos de proposito; o subagente recebe so as do projeto da sessao (#11, P2).
  const doAtual = lp.filter((l) => l.includes('(' + PROJ_ATUAL + ')'));
  return lp.length === 3 && doAtual.length >= 1 && la.join('\n') === doAtual.join('\n') && antes === depois;
});
caso('subagente nao cria o arquivo da sessao', () => {
  rodar(payload({ session_id: 'sessao-l' }));
  return !fs.existsSync(path.join(raiz, 'memoria-assunto', 'sessao-l.json'));
});
caso('prompt vazio nao emite nada', () => vazioSaiu0(rodar(payload({ session_id: 'sessao-f' }, { prompt: '   ' }))));
caso('tool_name diferente nao injeta', () => {
  return vazioSaiu0(rodar(payload({ session_id: 'sessao-g', tool_name: 'Bash' }))) &&
    vazioSaiu0(rodar(payload({ session_id: 'sessao-g', tool_name: 'Read' })));
});
caso('tool_name Task (nome antigo do Agent) tambem injeta', () => {
  const r = rodar(payload({ session_id: 'sessao-h', tool_name: 'Task' }));
  return r.codigo === 0 && saidaJson(r.saida).updatedInput.prompt.includes('## Memória do assunto');
});
caso('falha sai 0 e calada (banco ausente)', () => {
  const vazia = path.join(tmp, 'raiz-sem-banco');
  fs.mkdirSync(vazia);
  return vazioSaiu0(rodar(payload({ session_id: 'sessao-i' }), vazia));
});
caso('stdin invalido sai 0 e calado', () => vazioSaiu0(rodar('isto nao e json {')) && vazioSaiu0(rodar('')));
caso('session_id fora do padrao nao escreve fora da raiz e sai calado', () => {
  const r = rodar(payload({ session_id: '../fuga' }));
  return vazioSaiu0(r) && !fs.existsSync(path.join(raiz, 'fuga.json')) && !fs.existsSync(path.join(tmp, 'fuga.json'));
});
caso('a portaria decide igual com o original e com o updatedInput', () => {
  const orig = payload({ session_id: 'sessao-j-portaria' });
  const r = rodar(orig);
  const atualizado = JSON.stringify(Object.assign(JSON.parse(orig), { tool_input: saidaJson(r.saida).updatedInput }));
  const p1 = spawnar(PORTARIA, orig);
  const p2 = spawnar(PORTARIA, atualizado);
  console.log('  portaria(original):     exit=' + p1.codigo + ' stdout=' + JSON.stringify(p1.saida));
  console.log('  portaria(updatedInput): exit=' + p2.codigo + ' stdout=' + JSON.stringify(p2.saida));
  return p1.codigo === p2.codigo && p1.saida === p2.saida;
});

// ---- #11 P1: auto mode nao altera a entrada do Agent ----
caso('auto mode (permission_mode "auto") nao emite updatedInput nenhum', () =>
  vazioSaiu0(rodar(payload({ session_id: 'sessao-auto', permission_mode: 'auto' }))));
caso('auto mode tambem segura o glossario (qualquer entrada alterada derruba o veredito)', () => {
  const cwdG = path.join(tmp, 'projeto-glossario');
  fs.mkdirSync(cwdG);
  fs.mkdirSync(path.join(cwdG, '.git')); // acharGlossario so le o GLOSSARIO.md da raiz de um repo
  fs.writeFileSync(path.join(cwdG, 'GLOSSARIO.md'),
    '# Glossário do repo\n\n## zarquon\nDefinição: termo de teste do glossário.\nOnde mora: lugar nenhum.\nCenário: o briefing cita zarquon.\nEvite: nada\n');
  const comAuto = rodar(payload({ session_id: 'sessao-auto-g', cwd: cwdG, permission_mode: 'auto' }));
  const semAuto = rodar(payload({ session_id: 'sessao-auto-g2', cwd: cwdG, permission_mode: 'default' }));
  return vazioSaiu0(comAuto) && semAuto.codigo === 0 && saidaJson(semAuto.saida).updatedInput.prompt.includes('## Glossário do repo');
});
caso('modos fora do auto seguem injetando (default, acceptEdits, bypassPermissions, ausente)', () =>
  ['default', 'acceptEdits', 'bypassPermissions', undefined].every((m) => {
    const r = rodar(payload({ session_id: 'sessao-modo', permission_mode: m }));
    return r.codigo === 0 && saidaJson(r.saida).updatedInput.prompt.includes('## Memória do assunto');
  }));

// ---- #11 P2: so memoria do projeto da sessao ----
function linhasServidas(r) {
  if (!r.saida) return [];
  return blocoDe(saidaJson(r.saida).updatedInput.prompt).split('\n').slice(1).filter((l) => l.startsWith('['));
}
caso('sessao do projeto A recebe so memoria de A (nada do projeto B)', () => {
  const l = linhasServidas(rodar(payload({ session_id: 'sessao-p2a' })));
  return l.length >= 1 && l.every((x) => x.includes('(' + PROJ_ATUAL + ')')) && !l.some((x) => x.includes(PROJ_OUTRO));
});
caso('sessao do projeto B recebe so memoria de B (nada do projeto A)', () => {
  const l = linhasServidas(rodar(payload({ session_id: 'sessao-p2b', cwd: cwdOutro })));
  return l.length === 3 && l.every((x) => x.includes('(' + PROJ_OUTRO + ')'));
});
caso('briefing que cita o outro projeto pelo nome traz memoria dele', () => {
  const p = PEDIDO + '\nCompare com o que foi feito em outro-projeto.';
  const l = linhasServidas(rodar(payload({ session_id: 'sessao-p2c' }, { prompt: p })));
  return l.some((x) => x.includes('(' + PROJ_OUTRO + ')'));
});
caso('briefing que cita o caminho do outro projeto traz memoria dele', () => {
  const p = PEDIDO + '\nVeja ' + cwdOutro + ' para o caso antigo.';
  const l = linhasServidas(rodar(payload({ session_id: 'sessao-p2d' }, { prompt: p })));
  return l.some((x) => x.includes('(' + PROJ_OUTRO + ')'));
});
caso('palavra solta que so casa o fim do nome ("projeto") nao destrava outro projeto', () => {
  const p = PEDIDO + '\nNo projeto, outro detalhe importa.';
  const l = linhasServidas(rodar(payload({ session_id: 'sessao-p2e' }, { prompt: p })));
  return l.length >= 1 && !l.some((x) => x.includes(PROJ_OUTRO));
});
caso('projeto da sessao sem memoria do assunto: nada entra, mesmo havendo de outro projeto', () => {
  const cwdVazio = path.join(tmp, 'projeto-sem-memoria');
  fs.mkdirSync(cwdVazio);
  return vazioSaiu0(rodar(payload({ session_id: 'sessao-p2f', cwd: cwdVazio })));
});

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* melhor esforco */ }
console.log(`${ok} ok, ${falha} falha(s)`);
process.exit(falha > 0 ? 1 : 0);
