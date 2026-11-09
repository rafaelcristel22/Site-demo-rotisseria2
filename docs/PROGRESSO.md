# Progresso do desenvolvimento

## Concluído

| Etapa | Situação |
|---|---|
| 1. Arquitetura e banco | 12 migrações, RLS em todas as tabelas, índices, auditoria, testes de integração |
| 2. Login e permissões | Supabase Auth, papéis × permissões editáveis, sobreposição por usuário, PIN de autorização, recuperação de senha, liberação de novos usuários |
| 3. Dashboard e gráficos | Indicadores de hoje/semana/mês/ano e do período com comparação com o período anterior, 12 gráficos com dados reais |
| 4. RH | Funcionários, departamentos, cargos, jornadas/escalas (inclusive 12x36), férias com saldo CLT, afastamentos, ocorrências, avaliações, treinamentos, calendário, histórico salarial e de cargos |
| 5. Ponto eletrônico | Painel do funcionário, computador autorizado, quiosque em tablet com PIN, NSR + cadeia de hash, anti-duplicidade, ajustes com aprovação, espelho com PDF/CSV, horas extras, atrasos, faltas, noturno e banco de horas |
| 6. Folha | Estimativa com INSS/IRRF progressivos configuráveis, extras aprovadas, DSR, noturno, comissões, lançamentos, FGTS, provisões, demonstrativo, contas a pagar e exportação para a contabilidade |
| 7. Caixa (PDV) | Abertura, busca e leitor de código de barras, opções, desconto com PIN, pagamento dividido, troco, sangria/suprimento, fechamento por operador com diferença, conferência, reimpressão, cancelamento autorizado |
| 8. Pedidos e cozinha | Fila com aviso sonoro, aceite, tela da cozinha em tempo real com itens marcados individualmente, alerta de atraso, comanda |
| 9. Estoque e receitas | Posição, movimentos imutáveis, custo médio, lotes FEFO, validade, transferência, inventário, ficha técnica com rendimento e perda, baixa automática |
| 10. Compras | Fornecedores, cotações comparadas, pedidos, recebimento com conferência, contas a pagar, reposição sugerida, evolução de preços |
| 11. Financeiro | Contas, saldos, lançamentos com estorno, transferências, contas a pagar/receber com parcelas e recorrência, despesas, fluxo de caixa, DRE gerencial com margem de contribuição e ponto de equilíbrio |
| 12. Clientes e CRM | Cadastro, endereços, histórico, ranking, segmentos, atendimentos, fidelidade, consentimentos LGPD, exportação e anonimização |
| 13. Site de pedidos | Cardápio mobile, opções, carrinho, cupom, entrega/retirada/agendamento, troco, LGPD, acompanhamento |
| 14. Delivery | Painel de entregas, entregadores, bairros/taxas, desempenho |
| 15. Marketing | Cupons, promoções por dia/horário, campanhas com resultado, banners |
| 16. Inteligência artificial | Alertas automáticos (regras sobre dados reais), perguntas rápidas e assistente Claude somente leitura (Edge Function) |
| 17. Relatórios e BI | 20 relatórios + cozinha + DRE, filtros por período, comparação, CSV (Excel) e PDF |
| 18. Segurança e auditoria | Ver docs/SEGURANCA.md |
| 19. Impressão | Comprovante 58/80 mm, comanda, ESC/POS via Web Serial, gaveta, leitor — docs/HARDWARE.md |
| 20. Testes e publicação | Testes SQL e de frontend, CI, documentação de implantação, backup e monitoramento |

## Como foi verificado
- `scripts/test-db.sh`: aplica as migrações em PostgreSQL 16 e roda os testes de integração (pedido online como anônimo, preços recalculados, PDV com troco, desconto com PIN, cancelamento com estorno, fechamento de caixa com diferença, imutabilidade, ponto com cálculo de extras e atrasos, autopromoção bloqueada, INSS/IRRF, DRE).
- `npm test` (web): carrinho, opções, frete, troco, ESC/POS.
- Passeio automatizado no navegador (Playwright) pelo site e pelo painel contra o banco local, incluindo login, venda no PDV, aceite de pedido e cozinha.

## Limitações conhecidas / próximos passos
- Emissão fiscal (NFC-e/SAT) não incluída — integrar emissor homologado.
- Folha é estimativa gerencial: não gera eSocial/DCTFWeb.
- Integração com iFood/marketplaces e pagamento online (Pix dinâmico) não incluídos.
- O assistente de IA requer chave da Anthropic e ser habilitado em Configurações.
