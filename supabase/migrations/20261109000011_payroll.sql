-- =====================================================================
-- 0011 FOLHA DE PAGAMENTO — ESTIMATIVA GERENCIAL
-- Calcula salário bruto, horas extras (aprovadas), DSR, adicional noturno,
-- faltas, INSS e IRRF progressivos (tabelas em company_settings), FGTS e
-- provisões. Não fecha folha legal: status máximo é "conferido" e o
-- resultado deve ser validado pela contabilidade (eSocial/DCTFWeb fora do escopo).
-- =====================================================================
create table public.payroll_periods (
  id uuid primary key default gen_random_uuid(),
  reference_month date not null unique check (extract(day from reference_month) = 1),
  start_date date not null,
  end_date date not null,
  status text not null default 'rascunho' check (status in ('rascunho','calculado','conferido','exportado')),
  calculated_at timestamptz,
  reviewed_by uuid,
  reviewed_at timestamptz,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.payroll_entries (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.payroll_periods(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  entry_type text not null check (entry_type in ('adicional','desconto','adiantamento','beneficio','comissao','vale_transporte','outro')),
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  taxable boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create trigger audit_payroll_entries after insert or update or delete on public.payroll_entries
  for each row execute function public.tg_audit_row();

create table public.payroll_records (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.payroll_periods(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  base_salary numeric(12,2) not null default 0,
  contract_days int not null default 30,
  overtime_50_minutes int not null default 0,
  overtime_100_minutes int not null default 0,
  overtime_amount numeric(12,2) not null default 0,
  dsr_amount numeric(12,2) not null default 0,
  night_minutes int not null default 0,
  night_amount numeric(12,2) not null default 0,
  commission numeric(12,2) not null default 0,
  additions numeric(12,2) not null default 0,
  benefits numeric(12,2) not null default 0,
  gross numeric(12,2) not null default 0,
  absences int not null default 0,
  absence_deduction numeric(12,2) not null default 0,
  late_minutes int not null default 0,
  late_deduction numeric(12,2) not null default 0,
  inss numeric(12,2) not null default 0,
  irrf numeric(12,2) not null default 0,
  advances numeric(12,2) not null default 0,
  other_deductions numeric(12,2) not null default 0,
  total_deductions numeric(12,2) not null default 0,
  net numeric(12,2) not null default 0,
  fgts numeric(12,2) not null default 0,
  provision_vacation numeric(12,2) not null default 0,
  provision_13th numeric(12,2) not null default 0,
  employer_cost numeric(12,2) not null default 0,
  details jsonb not null default '{}'::jsonb,
  calculated_at timestamptz not null default now(),
  unique (period_id, employee_id)
);
create trigger audit_payroll_records after update or delete on public.payroll_records
  for each row execute function public.tg_audit_row();

-- INSS progressivo
create or replace function public.calc_inss(p_base numeric, p_table jsonb) returns numeric
language plpgsql immutable as $$
declare f jsonb; v_prev numeric := 0; v_tax numeric := 0; v_top numeric;
begin
  for f in select * from jsonb_array_elements(p_table->'faixas') loop
    v_top := (f->>'ate')::numeric;
    if p_base > v_prev then
      v_tax := v_tax + (least(p_base, v_top) - v_prev) * (f->>'aliquota')::numeric / 100;
    end if;
    v_prev := v_top;
  end loop;
  return round(v_tax, 2);
end $$;

-- IRRF mensal (escolhe o mais vantajoso entre deduções legais e desconto simplificado)
create or replace function public.calc_irrf(p_gross numeric, p_inss numeric, p_dependents int, p_table jsonb) returns numeric
language plpgsql immutable as $$
declare v_ded numeric; v_base numeric; f jsonb; v_tax numeric := 0;
begin
  v_ded := greatest(p_inss + p_dependents * coalesce((p_table->>'deducao_dependente')::numeric, 0),
                    coalesce((p_table->>'desconto_simplificado')::numeric, 0));
  v_base := greatest(p_gross - v_ded, 0);
  for f in select * from jsonb_array_elements(p_table->'faixas') loop
    if f->>'ate' is null or v_base <= (f->>'ate')::numeric then
      v_tax := v_base * (f->>'aliquota')::numeric / 100 - (f->>'deducao')::numeric;
      exit;
    end if;
  end loop;
  -- redutor opcional configurável (ex.: regras de isenção ampliada vigentes)
  if p_table ? 'redutor' then
    if p_gross <= (p_table->'redutor'->>'isento_ate')::numeric then v_tax := 0;
    elsif p_gross <= (p_table->'redutor'->>'faixa_ate')::numeric then
      v_tax := v_tax - greatest(0, (p_table->'redutor'->>'a')::numeric - (p_table->'redutor'->>'b')::numeric * p_gross);
    end if;
  end if;
  return round(greatest(v_tax, 0), 2);
end $$;

create or replace function public.payroll_open_period(p_month date) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_m date := date_trunc('month', p_month)::date; v_id uuid;
begin
  perform public.require_perm('payroll.manage');
  insert into public.payroll_periods(reference_month, start_date, end_date)
  values (v_m, v_m, (v_m + interval '1 month - 1 day')::date)
  on conflict (reference_month) do update set notes = public.payroll_periods.notes returning id into v_id;
  return v_id;
end $$;

create or replace function public.calculate_payroll(p_period uuid) returns int
language plpgsql security definer set search_path = public as $$
declare pp public.payroll_periods; s public.company_settings; e record; ts jsonb; v_n int := 0;
        v_hourly numeric; v_base numeric; v_days int; v_from date; v_to date; v_ot50 int; v_ot100 int; v_ot_amt numeric;
        v_dsr numeric; v_rest_days int; v_work_days int; v_night numeric; v_comm numeric; v_add numeric; v_ben numeric;
        v_adv numeric; v_other numeric; v_abs numeric; v_late numeric; v_gross numeric; v_inss numeric; v_irrf numeric;
        v_taxable numeric; v_ded numeric; v_fgts numeric; v_vac numeric; v_13 numeric; v_late_min int;
begin
  perform public.require_perm('payroll.manage');
  select * into pp from public.payroll_periods where id = p_period for update;
  if pp.status in ('conferido','exportado') then raise exception 'Período já conferido; reabra para recalcular'; end if;
  select * into s from public.company_settings where id = 1;
  delete from public.payroll_records where period_id = p_period;

  select count(*) filter (where extract(dow from d) = 0 or exists (select 1 from public.holidays h where h.day = d::date)),
         count(*) filter (where not (extract(dow from d) = 0 or exists (select 1 from public.holidays h where h.day = d::date)))
    into v_rest_days, v_work_days
    from generate_series(pp.start_date, pp.end_date, interval '1 day') d;

  for e in select * from public.employees where hire_date <= pp.end_date and (termination_date is null or termination_date >= pp.start_date)
             and contract_type not in ('pj','autonomo') loop
    v_from := greatest(pp.start_date, e.hire_date); v_to := least(pp.end_date, coalesce(e.termination_date, pp.end_date));
    v_days := least(30, v_to - v_from + 1);
    if v_from = pp.start_date and v_to = pp.end_date then v_days := 30; end if;
    v_hourly := case e.salary_type when 'horista' then e.salary when 'diarista' then e.salary / 8 else e.salary / s.payroll_monthly_hours end;
    ts := public.timeclock_summary(e.id, v_from, v_to);

    v_base := case e.salary_type
      when 'mensal' then round(e.salary * v_days / 30, 2)
      when 'horista' then round(e.salary * (ts->>'worked_minutes')::numeric / 60, 2)
      else round(e.salary * (ts->>'worked_days')::numeric, 2) end;

    select coalesce(sum(minutes) filter (where rate_percent < 100), 0), coalesce(sum(minutes) filter (where rate_percent >= 100), 0),
           coalesce(sum(minutes / 60.0 * v_hourly * (1 + rate_percent / 100)), 0)
      into v_ot50, v_ot100, v_ot_amt
      from public.overtime_records where employee_id = e.id and status = 'aprovado' and destination = 'pagamento'
       and work_date between v_from and v_to;
    v_ot_amt := round(v_ot_amt, 2);
    v_dsr := case when s.payroll_dsr_on_overtime and v_work_days > 0 then round(v_ot_amt / v_work_days * v_rest_days, 2) else 0 end;
    -- hora noturna reduzida (52min30s) + adicional
    v_night := round((ts->>'night_minutes')::numeric * (60 / 52.5) / 60 * v_hourly * s.night_shift_rate / 100, 2);

    select coalesce(sum(s2.total), 0) * e.commission_percent / 100 into v_comm
      from public.sales s2 where e.user_id is not null and s2.operator_id = e.user_id and s2.status = 'concluida'
       and (s2.sale_date at time zone s.timezone)::date between v_from and v_to;
    v_comm := round(v_comm, 2);

    select coalesce(sum(amount) filter (where entry_type in ('adicional','comissao','outro') and taxable), 0),
           coalesce(sum(amount) filter (where entry_type in ('adicional','comissao','outro') and not taxable), 0)
         + coalesce(sum(amount) filter (where entry_type = 'beneficio'), 0),
           coalesce(sum(amount) filter (where entry_type = 'adiantamento'), 0),
           coalesce(sum(amount) filter (where entry_type in ('desconto','vale_transporte')), 0)
      into v_add, v_ben, v_adv, v_other
      from public.payroll_entries where period_id = p_period and employee_id = e.id;

    v_abs := round((ts->>'absences')::numeric * (case when e.salary_type = 'mensal' then e.salary / 30 else 0 end), 2);
    v_late_min := (ts->>'late_minutes')::int + (ts->>'early_leave_minutes')::int;
    v_late := case when s.hour_bank_enabled then 0 else round(v_late_min / 60.0 * v_hourly, 2) end;

    v_gross := v_base + v_ot_amt + v_dsr + v_night + v_comm + v_add;
    v_taxable := greatest(v_gross - v_abs - v_late, 0);
    v_inss := public.calc_inss(v_taxable, s.payroll_tax_tables->'inss');
    v_irrf := public.calc_irrf(v_taxable, v_inss, e.dependents, s.payroll_tax_tables->'irrf');
    v_ded := v_inss + v_irrf + v_adv + v_other + v_abs + v_late;
    v_fgts := round(v_taxable * s.payroll_fgts_rate / 100, 2);
    v_vac := round(v_taxable / 12 * 4 / 3, 2);
    v_13 := round(v_taxable / 12, 2);

    insert into public.payroll_records(period_id, employee_id, base_salary, contract_days, overtime_50_minutes, overtime_100_minutes,
      overtime_amount, dsr_amount, night_minutes, night_amount, commission, additions, benefits, gross, absences, absence_deduction,
      late_minutes, late_deduction, inss, irrf, advances, other_deductions, total_deductions, net, fgts, provision_vacation,
      provision_13th, employer_cost, details)
    values (p_period, e.id, v_base, v_days, v_ot50, v_ot100, v_ot_amt, v_dsr, (ts->>'night_minutes')::int, v_night, v_comm, v_add, v_ben,
      v_gross, (ts->>'absences')::int, v_abs, v_late_min, v_late, v_inss, v_irrf, v_adv, v_other, v_ded,
      v_gross + v_ben - v_ded, v_fgts, v_vac, v_13,
      v_gross + v_ben + v_fgts + v_vac + v_13 + round((v_vac + v_13) * s.payroll_fgts_rate / 100, 2),
      jsonb_build_object('timeclock', ts, 'hourly_rate', round(v_hourly, 4), 'work_days', v_work_days, 'rest_days', v_rest_days,
                         'aviso', 'Estimativa gerencial — validar com a contabilidade.'));
    v_n := v_n + 1;
  end loop;
  update public.payroll_periods set status = 'calculado', calculated_at = now() where id = p_period;
  perform public.log_action('PAYROLL_CALCULATE', 'payroll_periods', p_period::text);
  return v_n;
end $$;

-- Conferência: marca como conferido e gera contas a pagar (líquido, FGTS e INSS estimados)
create or replace function public.payroll_review(p_period uuid, p_due date, p_generate_payables boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare pp public.payroll_periods; v_net numeric; v_fgts numeric; v_inss numeric; v_cat uuid := public.category_by_group('pessoal');
begin
  perform public.require_perm('payroll.manage');
  select * into pp from public.payroll_periods where id = p_period for update;
  if pp.status <> 'calculado' then raise exception 'Calcule a folha antes de conferir'; end if;
  update public.payroll_periods set status = 'conferido', reviewed_by = auth.uid(), reviewed_at = now() where id = p_period;
  if p_generate_payables then
    select sum(net), sum(fgts), sum(inss) into v_net, v_fgts, v_inss from public.payroll_records where period_id = p_period;
    if coalesce(v_net,0) > 0 then
      insert into public.accounts_payable(category_id, payable_type, description, due_date, competence_date, amount, payroll_period_id)
      values (v_cat, 'salarios', 'Salários líquidos ' || to_char(pp.reference_month, 'MM/YYYY') || ' (estimativa)', p_due, pp.reference_month, v_net, p_period);
    end if;
    if coalesce(v_fgts,0) > 0 then
      insert into public.accounts_payable(category_id, payable_type, description, due_date, competence_date, amount, payroll_period_id)
      values (v_cat, 'impostos', 'FGTS ' || to_char(pp.reference_month, 'MM/YYYY') || ' (estimativa)', p_due, pp.reference_month, v_fgts, p_period);
    end if;
    if coalesce(v_inss,0) > 0 then
      insert into public.accounts_payable(category_id, payable_type, description, due_date, competence_date, amount, payroll_period_id)
      values (v_cat, 'impostos', 'INSS retido ' || to_char(pp.reference_month, 'MM/YYYY') || ' (estimativa)', p_due, pp.reference_month, v_inss, p_period);
    end if;
  end if;
  perform public.log_action('PAYROLL_REVIEW', 'payroll_periods', p_period::text);
end $$;

create or replace function public.payroll_reopen(p_period uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_perm('payroll.manage');
  if coalesce(length(trim(p_reason)),0) < 5 then raise exception 'Informe o motivo'; end if;
  update public.payroll_periods set status = 'rascunho' where id = p_period;
  update public.accounts_payable set status = 'cancelado', notes = 'Folha reaberta: ' || p_reason
   where payroll_period_id = p_period and status = 'aberto';
  perform public.log_action('PAYROLL_REOPEN', 'payroll_periods', p_period::text, null, null, p_reason);
end $$;

alter table public.accounts_payable add constraint ap_payroll_fk foreign key (payroll_period_id) references public.payroll_periods(id);

do $$ declare t text; begin
  foreach t in array array['payroll_periods','payroll_entries','payroll_records'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.has_perm(%L))', t || '_read', t, 'payroll.view');
  end loop;
  execute 'grant insert, update, delete on public.payroll_entries to authenticated';
  execute $p$create policy payroll_entries_write on public.payroll_entries for all to authenticated
    using (public.has_perm('payroll.manage')) with check (public.has_perm('payroll.manage'))$p$;
end $$;
create policy payroll_records_self on public.payroll_records for select to authenticated using (employee_id = public.my_employee_id());

grant execute on all functions in schema public to authenticated;
do $$ declare f record; begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like '\_%' loop
    execute format('revoke execute on function %s from authenticated, anon, public', f.sig);
  end loop;
end $$;
