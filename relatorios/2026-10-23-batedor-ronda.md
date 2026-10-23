# Batedor — ronda de 2026-10-23

**Âncora:** dados-batedor-repos.js. Fila de repos: 0 utilizável, 0 recusada. Sem candidato com trilha declarada, nada entrou na avaliação.

## Busca ancorada (3 problemas, de 196 ideias abertas; 193 ficaram de fora)

| Problema ancorado | Busca | Resultado |
|---|---|---|
| Gramática tree-sitter de ADVPL/TLPP (71d) | "tree-sitter grammar ADVPL TLPP" | Nenhuma gramática encontrada. Busca voltou sem qualquer resultado sobre a linguagem. |
| Hook que pendura e mata o prompt; deadline com force-exit (58d) | "Claude Code hook timeout ... force exit" | Achados de issues de terceiros (anthropics/claude-code e claudeissues): timeout não aplicado a hook que não começa, processos suspensos no Windows, SIGTERM pula Stop hook. Nenhum repo com solução; são bugs do harness. |
| Subagente escritor com worktree git por filho (54d) | "Claude Code subagent git worktree per child" | Coberto pela própria documentação do Claude Code (`isolation: worktree`). Não é repo de terceiro. A regra 11 do rainforest-mind já usa isso. |

Os três problemas voltaram de mãos vazias em repo, e isso se declara. O único achado com potencial é o de hooks, e ele é issue de harness, não repo a instalar.

## Avaliação de repos novos

Nenhum. A fila não tem candidato com trilha, e nenhum repo encontrado foi declarado na fila. Achados sem trilha ficam como não avaliados.

## Revisita dirigida (gatilho duplo: 60+ dias e push posterior)

| Repo | Trilha final | Pergunta | Situação | Saída |
|---|---|---|---|---|
| `vercel-labs/agent-browser` | Instalar, não instala | "a reprovação caiu?" | Gatilho: #43, #171, #1498 fechadas; **#1270 aberta** (open no Git Bash trava). | (a) segue reprovado. Linha nova no livro, push 2026-10-23. |
| `headroomlabs-ai/headroom` | Instalar, não instala | "a reprovação caiu?" | #1466 (Windows) **fechada** desde a avaliação de 08-09. Push 10-22. | (b) mudou: candidato à ronda 3 da próxima semana. Não reavaliado nesta ronda. |
| `garrytan/gstack` | Instalar, não instala | "a reprovação caiu?" | #1375 e #2478 (Windows) **fechadas**. Push 10-23. | (b) mudou: candidato à ronda 3 da próxima semana. Não reavaliado nesta ronda. |

Revisitas devidas que ficaram de fora do teto de 3, ou sem pergunta mapeada na tabela:
- `obsidian-skills` (adotado, push 09-15 > 06-08): "ainda vale o que custa?" é a pergunta, mas o teto de 3 foi usado.
- `Understand-Anything`, `strix`, `hermes-agent`, `last30days-skill` (Instalar, não instala, push posterior, 60+ dias): devidas e fora do teto.
- `SuperClaude_Framework` (Instalar, não instala, push 09-27 > 07-22): devida e fora do teto.
- `meetily` (trilha sem mapeamento na tabela de revisita): não revisitado.
- `codeburn` ("testar, custo zero", sem trilha mapeada) e `claude-plugins-official` / `awesome-claude-code` ("referência", "índice"): sem pergunta na tabela de revisita.
- `ralph`, `gsd-build/get-shit-done` (arquivado), `evolution-api`, `find-skill`: sem push posterior, não devidas.

Observação: `claude-code-orchestrator-kit` consta com push visto 2026-08-04 no livro, mas a API devolve último push em 2026-03-05. A divergência não foi tratada aqui.

## Veredito

Ronda sem candidato novo. Uma revisita (agent-browser) segue reprovada. Duas (headroom, gstack) mudaram e vão para reavaliação na próxima semana. Nenhum achado vira ideia nesta ronda.
