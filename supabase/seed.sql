-- =====================================================================
-- SEED DE CONFIGURAÇÃO (não contém vendas, pedidos ou indicadores
-- fictícios). Pode ser reaplicado com segurança (idempotente).
-- =====================================================================
insert into public.roles(code, name, description, is_system) values
  ('admin','Administrador','Acesso total', true),
  ('gerente','Gerente','Gestão operacional, aprovações e relatórios', true),
  ('rh','Recursos Humanos','RH, ponto e folha', true),
  ('financeiro','Financeiro','Financeiro, compras e relatórios', true),
  ('caixa','Operador de caixa','PDV e pedidos', true),
  ('atendente','Atendente','Pedidos e clientes', true),
  ('cozinha','Cozinha','Tela da cozinha', true),
  ('estoque','Estoquista','Estoque e recebimento de compras', true),
  ('entregador','Entregador','Entregas atribuídas', true),
  ('funcionario','Funcionário','Ponto e dados pessoais', true)
on conflict (code) do nothing;

insert into public.permissions(code, module, description) values
  ('dashboard.view','Dashboard','Ver dashboard e indicadores'),
  ('reports.view','Relatórios','Ver relatórios e BI'),
  ('users.manage','Segurança','Gerenciar usuários e permissões'),
  ('audit.view','Segurança','Ver auditoria'),
  ('settings.view','Configurações','Ver configurações'),
  ('settings.manage','Configurações','Alterar configurações'),
  ('hr.view','RH','Ver funcionários e RH'),
  ('hr.manage','RH','Gerenciar funcionários e RH'),
  ('timeclock.view','Ponto','Ver ponto de todos'),
  ('timeclock.manage','Ponto','Aprovar ajustes e gerenciar ponto'),
  ('payroll.view','Folha','Ver folha de pagamento'),
  ('payroll.manage','Folha','Calcular/gerenciar folha'),
  ('pos.operate','PDV','Operar caixa'),
  ('pos.discount','PDV','Autorizar descontos acima do limite'),
  ('pos.cancel','PDV','Autorizar cancelamentos'),
  ('pos.manage','PDV','Gerenciar e conferir caixas'),
  ('sales.view','Vendas','Ver todas as vendas'),
  ('orders.view','Pedidos','Ver pedidos'),
  ('orders.manage','Pedidos','Aceitar e gerenciar pedidos'),
  ('kitchen.operate','Cozinha','Operar tela da cozinha'),
  ('catalog.view','Cardápio','Ver produtos'),
  ('catalog.manage','Cardápio','Gerenciar produtos e preços'),
  ('inventory.view','Estoque','Ver estoque'),
  ('inventory.manage','Estoque','Movimentar estoque e fichas técnicas'),
  ('purchases.view','Compras','Ver compras e fornecedores'),
  ('purchases.manage','Compras','Gerenciar compras'),
  ('finance.view','Financeiro','Ver financeiro'),
  ('finance.manage','Financeiro','Lançar e pagar contas'),
  ('customers.view','Clientes','Ver clientes'),
  ('customers.manage','Clientes','Gerenciar clientes e LGPD'),
  ('marketing.view','Marketing','Ver marketing'),
  ('marketing.manage','Marketing','Gerenciar cupons, promoções e banners'),
  ('delivery.manage','Delivery','Gerenciar entregas'),
  ('delivery.driver','Delivery','Entregador'),
  ('ai.use','IA','Usar assistente de IA')
on conflict (code) do nothing;

insert into public.role_permissions(role_code, permission_code)
select r, p from (values
  ('gerente', array['dashboard.view','reports.view','audit.view','settings.view','hr.view','timeclock.view','timeclock.manage','payroll.view',
     'pos.operate','pos.discount','pos.cancel','pos.manage','sales.view','orders.view','orders.manage','kitchen.operate','catalog.view',
     'catalog.manage','inventory.view','inventory.manage','purchases.view','purchases.manage','finance.view','customers.view',
     'customers.manage','marketing.view','marketing.manage','delivery.manage','ai.use']),
  ('rh', array['dashboard.view','hr.view','hr.manage','timeclock.view','timeclock.manage','payroll.view','payroll.manage','reports.view']),
  ('financeiro', array['dashboard.view','reports.view','finance.view','finance.manage','purchases.view','purchases.manage','sales.view',
     'payroll.view','inventory.view','pos.manage','customers.view','ai.use']),
  ('caixa', array['pos.operate','orders.view','orders.manage','customers.view','catalog.view']),
  ('atendente', array['orders.view','orders.manage','customers.view','customers.manage','catalog.view','pos.operate','delivery.manage']),
  ('cozinha', array['kitchen.operate','orders.view']),
  ('estoque', array['inventory.view','inventory.manage','purchases.view','catalog.view']),
  ('entregador', array['delivery.driver']),
  ('funcionario', array[]::text[])
) t(r, perms), unnest(perms) p
on conflict do nothing;

insert into public.company_settings(id, payroll_tax_tables) values (1, '{
  "_aviso": "Tabelas de referência para ESTIMATIVA. Validar vigência, faixas e incidências com a contabilidade antes de usar.",
  "inss": {"vigencia": "2025-01", "faixas": [
     {"ate": 1518.00, "aliquota": 7.5}, {"ate": 2793.88, "aliquota": 9},
     {"ate": 4190.83, "aliquota": 12}, {"ate": 8157.41, "aliquota": 14}]},
  "irrf": {"vigencia": "2025-05", "deducao_dependente": 189.59, "desconto_simplificado": 607.20, "faixas": [
     {"ate": 2428.80, "aliquota": 0, "deducao": 0}, {"ate": 2826.65, "aliquota": 7.5, "deducao": 182.16},
     {"ate": 3751.05, "aliquota": 15, "deducao": 394.16}, {"ate": 4664.68, "aliquota": 22.5, "deducao": 675.49},
     {"ate": null, "aliquota": 27.5, "deducao": 908.73}]},
  "vale_transporte_percentual": 6
}'::jsonb) on conflict (id) do nothing;

insert into public.departments(code, name) values
  ('ADM','Administração'),('CAIXA','Caixa'),('ATEND','Atendimento'),('COZ','Cozinha'),
  ('PREP','Preparação'),('LIMP','Limpeza'),('ENTR','Entregas'),('EST','Estoque')
on conflict (code) do nothing;

insert into public.schedules(name, schedule_type, days, min_break_minutes) values
  ('Comercial 44h (ter-dom)', 'semanal', '{
    "0":{"start":"09:00","end":"15:00","break_minutes":15},
    "2":{"start":"09:00","end":"17:20","break_minutes":60},
    "3":{"start":"09:00","end":"17:20","break_minutes":60},
    "4":{"start":"09:00","end":"17:20","break_minutes":60},
    "5":{"start":"09:00","end":"17:20","break_minutes":60},
    "6":{"start":"09:00","end":"17:20","break_minutes":60}}', 60)
on conflict (name) do nothing;
insert into public.schedules(name, schedule_type, cycle_reference_date, cycle_start, cycle_end, cycle_break_minutes)
values ('12x36 diurno', '12x36', '2026-01-01', '07:00', '19:00', 60) on conflict (name) do nothing;

insert into public.stock_locations(name, is_default) values ('Estoque principal', true) on conflict (name) do nothing;
insert into public.stock_locations(name) values ('Câmara fria'), ('Cozinha') on conflict (name) do nothing;

insert into public.financial_accounts(name, account_type) values
  ('Caixa físico (gaveta)','caixa'), ('Cofre','caixa'), ('Conta bancária principal','banco'),
  ('Conta Pix','pix'), ('Adquirente de cartões','cartao'), ('Vale / crédito interno','carteira')
on conflict (name) do nothing;

insert into public.financial_categories(name, kind, dre_group, cost_behavior, is_system) values
  ('Vendas de produtos','receita','receita_vendas','variavel',true),
  ('Outras receitas','receita','outras_receitas','variavel',true),
  ('Sobra de caixa','receita','outras_receitas','variavel',true),
  ('Compras de mercadorias e insumos','despesa','cmv','variavel',true),
  ('Salários e encargos','despesa','pessoal','fixo',true),
  ('Benefícios','despesa','pessoal','fixo',false),
  ('Aluguel','despesa','ocupacao','fixo',true),
  ('Energia elétrica','despesa','utilidades','fixo',true),
  ('Água','despesa','utilidades','fixo',true),
  ('Gás','despesa','utilidades','variavel',true),
  ('Internet e telefone','despesa','utilidades','fixo',true),
  ('Impostos e taxas','despesa','impostos','variavel',true),
  ('Taxas de cartão e Pix','despesa','taxas_financeiras','variavel',true),
  ('Marketing e publicidade','despesa','marketing','fixo',true),
  ('Manutenção','despesa','manutencao','fixo',true),
  ('Material de limpeza','despesa','administrativas','variavel',false),
  ('Contabilidade','despesa','administrativas','fixo',false),
  ('Embalagens','despesa','cmv','variavel',false),
  ('Falta de caixa','despesa','outras_despesas','variavel',true),
  ('Outras despesas','despesa','outras_despesas','fixo',true),
  ('Juros e tarifas bancárias','despesa','despesas_financeiras','fixo',false),
  ('Equipamentos (investimento)','despesa','investimentos','fixo',false)
on conflict (name, kind) do nothing;

insert into public.payment_methods(code, name, method_type, account_id, fee_percent, settlement_days, allows_change, sort_order, available_online)
select v.code, v.name, v.mt, (select id from public.financial_accounts where name = v.acc), v.fee, v.days, v.chg, v.ord, v.onl
from (values
  ('dinheiro','Dinheiro','dinheiro','Caixa físico (gaveta)',0,0,true,1,true),
  ('pix','Pix','pix','Conta Pix',0,0,false,2,true),
  ('debito','Cartão de débito','debito','Adquirente de cartões',1.99,1,false,3,true),
  ('credito','Cartão de crédito','credito','Adquirente de cartões',3.49,30,false,4,true),
  ('vale','Vale-refeição','vale','Adquirente de cartões',5.5,30,false,5,true),
  ('credito_interno','Crédito do cliente (fiado autorizado)','credito_interno','Vale / crédito interno',0,30,false,6,false)
) v(code, name, mt, acc, fee, days, chg, ord, onl)
on conflict (code) do nothing;

-- Feriados nacionais 2026 (Lei 662/1949, 6.802/1980, 14.759/2023). Feriados estaduais/municipais: cadastrar.
insert into public.holidays(day, name) values
  ('2026-01-01','Confraternização Universal'),('2026-02-16','Carnaval (ponto facultativo)'),('2026-02-17','Carnaval (ponto facultativo)'),
  ('2026-04-03','Sexta-feira Santa'),('2026-04-21','Tiradentes'),('2026-05-01','Dia do Trabalho'),
  ('2026-06-04','Corpus Christi (ponto facultativo)'),('2026-09-07','Independência'),('2026-10-12','Nossa Senhora Aparecida'),
  ('2026-11-02','Finados'),('2026-11-15','Proclamação da República'),('2026-11-20','Dia da Consciência Negra'),
  ('2026-12-25','Natal'),
  ('2027-01-01','Confraternização Universal'),('2027-03-26','Sexta-feira Santa'),('2027-04-21','Tiradentes'),
  ('2027-05-01','Dia do Trabalho'),('2027-09-07','Independência'),('2027-10-12','Nossa Senhora Aparecida'),
  ('2027-11-02','Finados'),('2027-11-15','Proclamação da República'),('2027-11-20','Dia da Consciência Negra'),('2027-12-25','Natal')
on conflict (day) do nothing;
