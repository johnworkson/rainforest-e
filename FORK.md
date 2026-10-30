# Fork rainforest-e

Versão própria do [rainforest-mind](https://github.com/luisfmontes/rainforest-mind), mantida à parte. Nada daqui é enviado ao original. O remoto `upstream` serve só para **trazer** novidades de lá.

Instala como `rainforest-mind@rainforest-e`. Só o marketplace mudou de nome. O plugin continua `rainforest-mind`, para os agentes `rainforest-mind:*` e os gates seguirem iguais e o merge do original não virar conflito.

## O que este fork muda

| Versão | O que | PR |
|---|---|---|
| 2.3.0 | Marketplace `rainforest-e`. Statusline, `/plugins-em-dia` e testes apontam para ele. | #1 |
| 2.3.1 | `/painel` abre só com o **Deixado para depois**. Os outros quadros voltam com `/painel completo`. | #2 |

## Trazer novidades do original

```
git fetch upstream
git merge upstream/main        # num worktree, nunca na main direto
claude plugin test .           # a suíte do mod; as baterias node não pegam tudo
```

Conflito em `plugin.json`, README ou CHANGELOG: fica a versão maior, mais um patch. Conflito em `hooks/mod.tsx`: o painel enxuto é uma linha (`if (!(await read($, painelCompleto)))`) antes do `return` do pane.

Depois do PR mergeado: `claude plugin marketplace update rainforest-e` e `claude plugin update rainforest-mind@rainforest-e`.

## Triagem das skills e comandos (2026-10-30)

| Decisão | Itens |
|---|---|
| **Manter (24)** | /arqueologia, /brainstorm, plano, executar, verificar, fechar, limpar, /foco, /ideia, /issue, /feedback, /saude, /setup, /semear, /regua, /transferir, /ponte, /vigiar, /painel, depurar, modo-dev, analisar, enxugar, montar-corpus |
| **Rever (2)** | divergir, revisar. Conversar antes de mudar, não remover. |
| **Tirar (0)** | nenhum |

## Pendente

- [ ] **Comando de pendências por projeto.** Uma tela só com tudo o que está pendente, separado por projeto, sem abrir um por um. As fontes de hoje estão espalhadas: `FOCO.md`, `ideias.jsonl`, estados de fluxo e o Deixado para depois do `/painel`. Referência de formato: o AnyType, onde o dono já guarda as coisas dele, e que tem MCP. A decidir no brainstorm: ler do AnyType, escrever nele ou só imitar o formato.
- [ ] **Rever `divergir` e `revisar`** (ver triagem).
- [ ] **Injeção de contexto a 86 B do teto** (8014 B no `/saude` de 2026-10-30). É o primeiro alvo de performance.
