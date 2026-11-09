# Progresso do desenvolvimento

## Concluído

| Etapa | Situação |
|---|---|
| 1 — Arquitetura e banco | ✅ 9 migrações, RLS, índices, triggers de auditoria, testes de integração |
| 2 — Login e permissões (banco) | ✅ papéis, permissões, sobreposição por usuário, PIN de autorização, `has_perm` |
| 5 — Ponto eletrônico (banco) | ✅ marcação imutável com NSR e cadeia de hashes, quiosque com PIN, dispositivos autorizados, anti-duplicidade, ajustes com aprovação, cálculo de jornada/extras/atrasos/faltas/noturno, banco de horas |
| 7 — PDV/caixa (banco) | ✅ abertura, venda com desconto autorizado, pagamento dividido, troco, sangria/suprimento, fechamento por operador com diferença, cancelamento com PIN e estornos |
| 8 — Pedidos e cozinha (banco) | ✅ fluxo de status, itens marcados individualmente, histórico, realtime |
| 9 — Estoque e receitas (banco) | ✅ custo médio, lotes FEFO, validade, transferência, inventário, baixa automática por ficha técnica com rendimento/perda |
| 10 — Compras (banco) | ✅ solicitações, cotações, comparação, pedido, recebimento com conferência, contas a pagar, histórico de preços |
| 11 — Financeiro (banco) | ✅ contas, categorias DRE, lançamentos imutáveis com estorno, contas a pagar/receber, recorrência, parcelas |
| 12 — CRM (banco) | ✅ clientes, endereços, consentimentos LGPD, exportação e anonimização, fidelidade, segmentos |
| 13 — Site de pedidos | ✅ **cardápio mobile, opções/adicionais, carrinho, cupom, entrega por bairro, retirada, agendamento, troco, LGPD, acompanhamento do pedido** |
| 14 — Delivery (banco) | ✅ entregadores, atribuição, saída, conclusão, taxas por bairro |
| 15 — Marketing (banco) | ✅ cupons, promoções programadas, campanhas, banners |

## Próximas etapas

- Painel interno (`/admin`): login, dashboard e gráficos, PDV, cozinha em tempo real, RH, ponto, estoque, compras, financeiro, CRM, delivery, marketing, configurações.
- Folha de pagamento (estimativas INSS/IRRF/FGTS com tabelas configuráveis).
- Relatórios/BI (DRE, fluxo de caixa, rentabilidade, ponto de equilíbrio) com exportação PDF/Excel.
- Assistente de IA (Edge Function, somente leitura).
- Impressão térmica 58/80 mm e gaveta (ESC/POS).
- Documentação de implantação, backup e monitoramento.
