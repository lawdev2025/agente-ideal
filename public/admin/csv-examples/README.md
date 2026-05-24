# Modelos CSV para Importação

Arquivos de referência para a função **Importar CSV** do painel admin.

## Arquivos

| Arquivo | Tabela Supabase | Notas |
|---|---|---|
| `modelo_unidades.csv` | `school_units` | Cadastre PRIMEIRO. O `id` (texto) é usado por `school_products.unit_id`. |
| `modelo_produtos.csv` | `school_products` | Depende de unidades já existentes. Campo `unit_id` deve casar com `school_units.id`. |
| `modelo_contatos.csv` | `school_contacts` | Setores da escola (secretaria, financeiro, etc). |
| `modelo_mensalidades.csv` | `school_levels` | Tabela legada de mensalidades por nível. Opcional se você usa só `school_products`. |

## Regras de formato

- **UTF-8 com BOM** (o painel adiciona automaticamente no download).
- **Separador:** vírgula.
- **Aspas duplas** envolvem campos que contêm vírgula, aspas ou quebra de linha. Aspas internas devem ser duplicadas (`""`).
- **Primeira linha** = cabeçalho com nomes EXATOS das colunas (case-sensitive).
- **Colunas obrigatórias** precisam estar presentes; opcionais podem ficar em branco.

## Ordem de importação recomendada

1. `school_units` — sem dependências
2. `school_contacts` — sem dependências
3. `school_levels` — sem dependências
4. `school_products` — **requer** `school_units` cadastradas (FK lógica via `unit_id`)

## Dicas

- Antes de importar produtos: confira no painel o `id` de cada unidade (coluna ID na aba Unidades). O CSV usa esse mesmo valor em `unit_id`.
- O botão **"Baixar Exemplo"** no painel gera um CSV adaptado às SUAS unidades reais (puxa os IDs do Supabase).
- Erros de importação aparecem dentro do modal — leia a mensagem do Supabase, geralmente diz a coluna problemática.
