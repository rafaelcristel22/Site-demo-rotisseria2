\set ON_ERROR_STOP 1
begin;
insert into auth.users(id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1','adm2@teste.local','{"full_name":"Admin"}') on conflict do nothing;
-- garante admin (se outro teste já criou o primeiro usuário)
update public.users set role_code = 'admin', is_active = true where id = '00000000-0000-0000-0000-0000000000a1';

do $$ begin
  assert public.calc_inss(2200, (select payroll_tax_tables->'inss' from public.company_settings)) = 175.23, 'INSS progressivo 2200';
  assert public.calc_inss(10000, (select payroll_tax_tables->'inss' from public.company_settings)) = 951.63, 'INSS no teto: ' || public.calc_inss(10000, (select payroll_tax_tables->'inss' from public.company_settings));
  assert public.calc_irrf(2200, 175.23, 0, (select payroll_tax_tables->'irrf' from public.company_settings)) = 0, 'IRRF isento';
  assert public.calc_irrf(6000, 693.31, 1, (select payroll_tax_tables->'irrf' from public.company_settings)) > 0, 'IRRF devido';
end $$;

insert into public.employees(code, full_name, hire_date, salary) values ('2001', 'Folha Teste', '2026-01-01', 2200);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
do $$
declare v_p uuid; r public.payroll_records; d jsonb;
begin
  v_p := public.payroll_open_period('2026-02-01');
  perform public.calculate_payroll(v_p);
  select * into r from public.payroll_records where period_id = v_p and employee_id = (select id from public.employees where code = '2001');
  assert r.base_salary = 2200 and r.inss = 175.23 and r.fgts = 176.00, 'folha: base/INSS/FGTS';
  -- sem jornada cadastrada não há faltas: líquido = bruto − INSS
  assert r.net = 2200 - 175.23, 'líquido ' || r.net;
  perform public.payroll_review(v_p, '2026-03-05');
  assert (select count(*) from public.accounts_payable where payroll_period_id = v_p) = 3, 'contas a pagar da folha';
  d := public.report_dre('2026-01-01', '2026-12-31');
  assert d ? 'receita_liquida' and d ? 'ponto_equilibrio', 'DRE';
  assert (select count(*) from public.report_sales_series('2026-11-01', '2026-11-30', 'day')) = 30, 'série diária';
  assert (select count(*) from public.report_sales_by_hour('2026-11-01', '2026-11-30')) = 24, 'por hora';
end $$;
reset role;
do $$ begin raise notice 'RELATÓRIOS E FOLHA OK'; end $$;
rollback;
