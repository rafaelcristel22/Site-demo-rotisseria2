# Rotisseria ERP Ultra

ERP completo para rotisseria: **painel interno** (gestão, PDV, cozinha, RH, ponto, estoque, financeiro…) e **site de pedidos mobile**, ligados ao mesmo banco PostgreSQL (Supabase).

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `supabase/migrations/` | Esquema completo, regras de negócio em funções transacionais, RLS, realtime e storage |
| `supabase/seed.sql` | Configuração inicial (papéis, permissões, departamentos, contas, categorias financeiras, formas de pagamento, feriados). Sem dados fictícios de vendas |
| `supabase/seed_catalog_demo.sql` | Cardápio inicial **opcional** e editável |
| `supabase/tests/` | Testes de integração das operações críticas |
| `web/` | Frontend React + TypeScript + Tailwind: site de pedidos em `/`, painel em `/admin`, quiosque de ponto em `/ponto` |
| `supabase/functions/` | Edge Functions: `admin-users` (criação segura de usuários) e `ai-assistant` (assistente Claude, somente leitura) |
| `scripts/test-db.sh` | Cria banco limpo, aplica migrações e roda os testes |
| `scripts/local-api/` | API RPC local para desenvolvimento sem Supabase (não usar em produção) |
| `docs/IMPLANTACAO.md` | Produção: Supabase, domínio, HTTPS, backup, monitoramento, atualizações |
| `docs/SEGURANCA.md` | Permissões, RLS, auditoria, ponto, LGPD |
| `docs/HARDWARE.md` | Impressoras 58/80 mm, gaveta, leitor, tablets |
| `docs/PROGRESSO.md` | Etapas concluídas, como foi verificado e limitações |

## Rodando localmente

```bash
# 1) Banco (PostgreSQL 15+): aplica shim do Supabase, migrações, seeds e testes
PGPASSWORD=postgres scripts/test-db.sh

# 2) API local compatível com o Supabase (login, tabelas, RPC) — apenas desenvolvimento
cd scripts/local-api && npm install && node server.mjs      # http://localhost:54321
# primeiro usuário (vira administrador):
curl -X POST localhost:54321/auth/v1/signup -H 'content-type: application/json' \
  -d '{"email":"voce@exemplo.com","password":"uma-senha-forte","data":{"full_name":"Seu Nome"}}'

# 3) Frontend
cd web && npm install
echo "VITE_SUPABASE_URL=http://localhost:54321" > .env.local
echo "VITE_SUPABASE_ANON_KEY=local-dev" >> .env.local
npm run dev                    # site: http://localhost:5173  ·  painel: /admin  ·  ponto: /ponto
npm test                                                     # testes do carrinho/troco
```

## Produção (Supabase)

Guia completo em **docs/IMPLANTACAO.md**. Resumo:


1. Crie um projeto no Supabase e rode `supabase db push` (ou aplique os arquivos de `supabase/migrations` em ordem) e depois `supabase/seed.sql`.
2. Em `web/.env.local`, informe `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` do projeto.
3. `npm run build` e publique `web/dist` (Vercel, Netlify, Cloudflare Pages…) com fallback SPA para `index.html`.
4. O **primeiro usuário** cadastrado no Supabase Auth vira administrador; os demais começam inativos até liberação.

## Segurança

- RLS ativo em todas as tabelas; visitantes (anon) não leem tabela nenhuma — o site usa apenas funções `public_menu`, `public_quote`, `place_public_order`, `public_order_status`.
- Preços, descontos, taxas e totais são sempre recalculados no servidor.
- Movimentos de estoque, caixa, auditoria e marcações de ponto são imutáveis; correções geram estorno/ajuste com autorização registrada.
