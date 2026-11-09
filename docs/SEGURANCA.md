# Segurança, permissões, auditoria e LGPD

## Autenticação
- Supabase Auth (senhas com bcrypt, sessões JWT de 1 h com refresh rotativo, recuperação de senha por e-mail).
- Cadastro público desativado. Usuários são criados pela Edge Function `admin-users` (chave de serviço só no servidor), por quem tem `users.manage`.
- O papel e a liberação de um novo usuário vêm de `app_metadata` (gravável só pelo servidor). Um cadastro feito por fora começa **inativo** e como `funcionario` — há teste automatizado para isso.

## Autorização
- Papéis (`roles`) com permissões (`role_permissions`), sobreposições por usuário (`user_permission_overrides`) e a função `has_perm()` usada em **todas** as políticas RLS e funções.
- RLS ativo em todas as tabelas. O papel `anon` (site) não lê nenhuma tabela: usa apenas `public_menu`, `public_quote`, `place_public_order`, `public_order_status` e as funções do quiosque.
- Funções internas (prefixo `_`) não podem ser chamadas pela API.
- Operações críticas (venda, cancelamento, caixa, estoque, compras, pagamentos, ponto, folha) só acontecem por funções transacionais que validam permissão e recalculam valores.
- Aprovações de terceiros (desconto acima do limite, cancelamento, sangria) exigem **PIN de autorização** de quem tem a permissão; o autorizador fica gravado.

## Integridade e histórico
- `audit_logs` é imutável (gatilho bloqueia UPDATE/DELETE) e registra quem, quando, o quê (antes/depois), IP e motivo.
- Movimentações de estoque, de caixa e lançamentos financeiros são imutáveis; correções geram estorno.
- Marcações de ponto: NSR sequencial, cadeia de hash SHA-256 (verificável em Ponto → Dispositivos), proibição de exclusão/edição; ajustes só por solicitação justificada aprovada por outra pessoa com `timeclock.manage`. Proteção contra marcações duplicadas e bloqueio após 5 PINs errados em 15 min no quiosque.
- Histórico de preços (`product_price_history`), salários e cargos gravados automaticamente.

## LGPD
- Consentimentos versionados (`customer_consents`): aceite obrigatório para o pedido e opt-in separado para marketing, com data, origem e IP.
- Direitos do titular em Clientes → Ficha: exportação dos dados (JSON) e anonimização (mantém registros fiscais/financeiros sem dados pessoais). Ambas ficam na auditoria.
- Minimização: o site só recebe o primeiro nome no acompanhamento do pedido; custos e dados internos nunca são expostos.

## Recomendações operacionais
- Ative MFA para administradores no Supabase.
- Restrinja `ALLOWED_ORIGIN` das Edge Functions ao domínio do painel.
- Revise mensalmente a auditoria (filtros: cancelamentos, descontos, estornos, ajustes de ponto).
