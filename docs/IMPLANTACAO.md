# Implantação em produção

Arquitetura: **frontend estático** (React, hospedado em CDN) + **Supabase** (PostgreSQL, Auth, Realtime, Storage, Edge Functions). Não há servidor próprio para manter.

```
 clientes (celular) ──► site de pedidos  ┐
 equipe (PC/tablet) ──► painel /admin    ├─► mesmo app estático (CDN, HTTPS) ──► Supabase (API + RLS) ──► PostgreSQL
 tablet do ponto    ──► /ponto           ┘                                         └─ Edge Functions (admin-users, ai-assistant)
```

## 1. Banco de dados (Supabase)

1. Crie o projeto em supabase.com (região **São Paulo – sa-east-1**).
2. Instale o Supabase CLI e vincule: `supabase link --project-ref SEU_REF`.
3. Aplique as migrações: `supabase db push` (aplica `supabase/migrations/*` em ordem).
4. Aplique a configuração inicial: `psql "$DATABASE_URL" -f supabase/seed.sql`.
5. (Opcional) cardápio inicial editável: `psql "$DATABASE_URL" -f supabase/seed_catalog_demo.sql`.
6. Em **Authentication → Providers → Email**: desative “Allow new users to sign up”. A equipe é criada pelo painel.
7. Em **Authentication → URL configuration**: `Site URL = https://admin.seudominio.com.br` e adicione `https://admin.seudominio.com.br/admin/redefinir-senha` em Redirect URLs.
8. Crie o **primeiro administrador** em Authentication → Users → *Add user* (com senha). O primeiro usuário do sistema vira administrador automaticamente.
9. Configure SMTP próprio (Authentication → SMTP) para os e-mails de recuperação de senha.

## 2. Edge Functions

```bash
supabase functions deploy admin-users
supabase functions deploy ai-assistant            # opcional
supabase secrets set ALLOWED_ORIGIN=https://admin.seudominio.com.br
supabase secrets set ANTHROPIC_API_KEY=...        # opcional: assistente de IA (habilite em Configurações)
```

## 3. Frontend

```bash
cd web
npm ci
VITE_SUPABASE_URL=https://SEU_REF.supabase.co VITE_SUPABASE_ANON_KEY=CHAVE_ANON npm run build
```

Publique a pasta `web/dist` em Vercel, Netlify ou Cloudflare Pages com **fallback de SPA** (todas as rotas → `index.html`):

- Vercel: `vercel.json` → `{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }`
- Netlify: arquivo `web/public/_redirects` com `/* /index.html 200` (já incluído).
- Cloudflare Pages: SPA é automático.

### Domínio próprio e HTTPS

- Aponte `pedidos.seudominio.com.br` (site) e `admin.seudominio.com.br` (painel) para o mesmo deploy. O painel fica em `/admin`; o quiosque de ponto em `/ponto`.
- O certificado HTTPS é emitido automaticamente pela hospedagem (Let's Encrypt). Ative o redirecionamento HTTP → HTTPS.

## 4. Backup

- **Supabase**: backups diários automáticos (plano Pro) e PITR opcional (recuperação a qualquer instante dos últimos dias). Recomendado ativar o PITR.
- **Cópia externa**: `scripts/backup.sh` gera `pg_dump` com checksum e retenção de 30 cópias. Agende em outro servidor/nuvem (ex.: cron diário às 3h) e guarde fora do Supabase.
- **Teste de restauração** mensal em um projeto separado (`pg_restore`), registrando data e resultado.
- Arquivos (fotos, documentos) ficam no Storage: inclua os buckets na política de backup (supabase CLI `storage` ou rclone).

## 5. Monitoramento

- Supabase → **Reports** (uso de API, banco, Auth) e **Logs Explorer** (erros de PostgREST, Edge Functions).
- Alertas de uso de disco/CPU do banco em Settings → Billing/Usage.
- Monitor externo de disponibilidade (UptimeRobot, Better Stack) para `https://pedidos…` e `https://admin…`.
- No próprio sistema: Auditoria (operações sensíveis), Ponto → Dispositivos → *Verificar cadeia de assinaturas*, Vendas e caixas (diferenças de fechamento), Assistente → Alertas.

## 6. Atualizações

1. Desenvolva e teste localmente (`scripts/test-db.sh`, `npm test`, `npm run build`). O CI (`.github/workflows/ci.yml`) roda o mesmo a cada push.
2. Novas alterações de banco sempre como **nova migração** em `supabase/migrations` (nunca editar migração já aplicada).
3. `supabase db push` → deploy do frontend → deploy das functions alteradas.
4. Faça backup antes de migrações que alteram dados.

## 7. Checklist de entrada em produção

- [ ] Cadastro público do Auth desativado e SMTP configurado
- [ ] Primeiro administrador criado; PIN de autorização definido (Configurações → Usuários)
- [ ] Empresa, horários, bairros de entrega, formas de pagamento e taxas conferidos
- [ ] Tabelas de INSS/IRRF validadas com a contabilidade (Configurações → Tabelas da folha)
- [ ] Regras de ponto (tolerâncias, banco de horas, adicional noturno) validadas com a contabilidade/sindicato
- [ ] Cardápio com fotos, fichas técnicas e estoque inicial lançados
- [ ] Impressoras testadas (Configurações → Impressoras)
- [ ] Texto de privacidade/LGPD revisado
- [ ] Backup externo agendado e restauração testada
