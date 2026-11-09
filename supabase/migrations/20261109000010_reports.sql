-- =====================================================================
-- 0010 RELATÓRIOS E BI — todas as funções leem dados reais do banco.
-- Datas em horário local da empresa. Permissão: reports.view ou dashboard.view.
-- =====================================================================
create or replace function public._report_guard() returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.has_perm('reports.view') or public.has_perm('dashboard.view')) then
    raise exception 'Permissão negada: reports.view' using errcode = '42501';
  end if;
  return (select timezone from public.company_settings where id = 1);
end $$;

create or replace function public.report_sales_series(p_start date, p_end date, p_granularity text default 'day')
returns table(period date, revenue numeric, orders bigint, avg_ticket numeric, cost numeric, gross_profit numeric)
language plpgsql stable security definer set search_path = public as $$
declare tz text := public._report_guard(); g text := case when p_granularity in ('day','week','month','year') then p_granularity else 'day' end;
begin
  return query
  with s as (
    select date_trunc(g, (sale_date at time zone tz))::date p, total, cost_total, delivery_fee
      from public.sales where status = 'concluida' and (sale_date at time zone tz)::date between p_start and p_end
  ), periods as (
    select generate_series(date_trunc(g, p_start::timestamp), date_trunc(g, p_end::timestamp), ('1 ' || g)::interval)::date p
  )
  select pr.p, coalesce(sum(s.total),0), count(s.total), coalesce(round(avg(s.total),2),0), coalesce(sum(s.cost_total),0),
         coalesce(sum(s.total - s.delivery_fee - s.cost_total),0)
    from periods pr left join s on s.p = pr.p group by pr.p order by pr.p;
end $$;

create or replace function public.report_sales_by_hour(p_start date, p_end date)
returns table(hour int, revenue numeric, orders bigint)
language plpgsql stable security definer set search_path = public as $$
declare tz text := public._report_guard();
begin
  return query select h.h, coalesce(sum(s.total),0), count(s.id)
    from generate_series(0,23) h(h)
    left join public.sales s on s.status = 'concluida' and extract(hour from s.sale_date at time zone tz)::int = h.h
     and (s.sale_date at time zone tz)::date between p_start and p_end
   group by h.h order by h.h;
end $$;

create or replace function public.report_sales_by_category(p_start date, p_end date)
returns table(category text, quantity numeric, revenue numeric, cost numeric, margin numeric, margin_pct numeric)
language plpgsql stable security definer set search_path = public as $$
declare tz text := public._report_guard();
begin
  return query select coalesce(c.name, 'Sem categoria'), sum(si.quantity), sum(si.total), sum(si.total_cost),
         sum(si.total - si.total_cost), case when sum(si.total) > 0 then round(sum(si.total - si.total_cost) / sum(si.total) * 100, 1) else 0 end
    from public.sale_items si join public.sales s on s.id = si.sale_id
    left join public.categories c on c.id = si.category_id
   where s.status = 'concluida' and (s.sale_date at time zone tz)::date between p_start and p_end
   group by 1 order by 3 desc;
end $$;

create or replace function public.report_product_ranking(p_start date, p_end date)
returns table(product_id uuid, product text, quantity numeric, revenue numeric, cost numeric, margin numeric, margin_pct numeric)
language plpgsql stable security definer set search_path = public as $$
declare tz text := public._report_guard();
begin
  return query select si.product_id, max(si.product_name), sum(si.quantity), sum(si.total), sum(si.total_cost),
         sum(si.total - si.total_cost), case when sum(si.total) > 0 then round(sum(si.total - si.total_cost) / sum(si.total) * 100, 1) else 0 end
    from public.sale_items si join public.sales s on s.id = si.sale_id
   where s.status = 'concluida' and (s.sale_date at time zone tz)::date between p_start and p_end
   group by si.product_id order by 4 desc;
end $$;

create or replace function public.report_payment_methods(p_start date, p_end date)
returns table(method text, amount numeric, payments bigint, fees numeric)
language plpgsql stable security definer set search_path = public as $$
declare tz text := public._report_guard();
begin
  return query select pm.name, sum(p.amount), count(*), sum(p.fee_amount)
    from public.payments p join public.sales s on s.id = p.sale_id join public.payment_methods pm on pm.code = p.method_code
   where p.status = 'confirmado' and (s.sale_date at time zone tz)::date between p_start and p_end
   group by pm.name order by 2 desc;
end $$;

create or replace function public.report_orders_by_status(p_start date, p_end date)
returns table(status text, orders bigint, total numeric)
language plpgsql stable security definer set search_path = public as $$
declare tz text := public._report_guard();
begin
  return query select o.status, count(*), sum(o.total) from public.orders o
   where (o.created_at at time zone tz)::date between p_start and p_end group by 1 order by 2 desc;
end $$;

create or replace function public.report_channels(p_start date, p_end date)
returns table(channel text, origin text, sales bigint, revenue numeric, avg_ticket numeric)
language plpgsql stable security definer set search_path = public as $$
declare tz text := public._report_guard();
begin
  return query select s.channel, o.origin, count(*), sum(s.total), round(avg(s.total),2)
    from public.sales s join public.orders o on o.id = s.order_id
   where s.status = 'concluida' and (s.sale_date at time zone tz)::date between p_start and p_end
   group by 1, 2 order by 4 desc;
end $$;

create or replace function public.report_sales_by_operator(p_start date, p_end date)
returns table(operator text, sales bigint, revenue numeric, avg_ticket numeric, cancelled bigint, discounts numeric)
language plpgsql stable security definer set search_path = public as $$
declare tz text := public._report_guard();
begin
  return query select coalesce(u.full_name, 'Site (online)'), count(*) filter (where s.status = 'concluida'),
         coalesce(sum(s.total) filter (where s.status = 'concluida'),0), coalesce(round(avg(s.total) filter (where s.status = 'concluida'),2),0),
         count(*) filter (where s.status = 'cancelada'), coalesce(sum(s.discount) filter (where s.status = 'concluida'),0)
    from public.sales s left join public.users u on u.id = s.operator_id
   where (s.sale_date at time zone tz)::date between p_start and p_end
   group by 1 order by 3 desc;
end $$;

create or replace function public.report_cash_registers(p_start date, p_end date)
returns table(register_id uuid, terminal text, operator text, opened_at timestamptz, closed_at timestamptz, status text,
              sales_total numeric, difference numeric)
language plpgsql stable security definer set search_path = public as $$
declare tz text := public._report_guard();
begin
  return query select r.id, r.terminal_name, u.full_name, r.opened_at, r.closed_at, r.status,
         coalesce((select sum(total) from public.sales s where s.cash_register_id = r.id and s.status = 'concluida'),0), r.difference_total
    from public.cash_registers r join public.users u on u.id = r.operator_id
   where (r.opened_at at time zone tz)::date between p_start and p_end order by r.opened_at desc;
end $$;

create or replace function public.report_expenses_by_category(p_start date, p_end date)
returns table(category text, dre_group text, amount numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._report_guard();
  return query select coalesce(c.name, 'Sem categoria'), coalesce(c.dre_group, 'outras_despesas'), sum(t.amount)
    from public.financial_transactions t left join public.financial_categories c on c.id = t.category_id
   where t.transaction_type = 'saida' and t.status = 'confirmado' and t.reference_type not in ('transferencia','sangria','suprimento')
     and t.competence_date between p_start and p_end
   group by 1, 2 order by 3 desc;
end $$;

-- DRE gerencial (regime de competência simplificado)
create or replace function public.report_dre(p_start date, p_end date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tz text := public._report_guard(); v_gross numeric; v_disc numeric; v_fee_rev numeric; v_cmv numeric; v_fees numeric;
        v_exp jsonb; v_other_rev numeric; v_fixed numeric; v_variable numeric; v_net_rev numeric; v_result numeric; v_mc numeric;
        v_canc numeric; v_purchases numeric;
begin
  select coalesce(sum(subtotal),0), coalesce(sum(discount),0), coalesce(sum(delivery_fee),0), coalesce(sum(cost_total),0), coalesce(sum(fee_total),0)
    into v_gross, v_disc, v_fee_rev, v_cmv, v_fees
    from public.sales where status = 'concluida' and (sale_date at time zone tz)::date between p_start and p_end;
  select coalesce(sum(total),0) into v_canc from public.sales where status = 'cancelada' and (sale_date at time zone tz)::date between p_start and p_end;
  select coalesce(sum(t.amount),0) into v_other_rev from public.financial_transactions t join public.financial_categories c on c.id = t.category_id
   where t.transaction_type = 'entrada' and t.status = 'confirmado' and c.dre_group = 'outras_receitas' and t.competence_date between p_start and p_end;
  -- compras de insumos (caixa) — informativo; o CMV vem da ficha técnica das vendas
  select coalesce(sum(t.amount),0) into v_purchases from public.financial_transactions t join public.financial_categories c on c.id = t.category_id
   where t.transaction_type = 'saida' and t.status = 'confirmado' and c.dre_group = 'cmv' and t.competence_date between p_start and p_end;
  select coalesce(jsonb_object_agg(g, a), '{}'::jsonb) into v_exp from (
    select c.dre_group g, sum(t.amount) a from public.financial_transactions t join public.financial_categories c on c.id = t.category_id
     where t.transaction_type = 'saida' and t.status = 'confirmado' and t.reference_type not in ('transferencia','sangria','suprimento')
       and c.dre_group not in ('cmv','investimentos') and t.competence_date between p_start and p_end
     group by c.dre_group) x;
  select coalesce(sum(t.amount) filter (where c.cost_behavior = 'fixo'),0), coalesce(sum(t.amount) filter (where c.cost_behavior = 'variavel'),0)
    into v_fixed, v_variable
    from public.financial_transactions t join public.financial_categories c on c.id = t.category_id
   where t.transaction_type = 'saida' and t.status = 'confirmado' and c.dre_group not in ('cmv','investimentos')
     and t.reference_type not in ('transferencia','sangria','suprimento') and t.competence_date between p_start and p_end;
  v_net_rev := v_gross + v_fee_rev - v_disc;
  v_mc := v_net_rev - v_cmv - v_fees - v_variable;
  v_result := v_net_rev - v_cmv - v_fees + v_other_rev - (select coalesce(sum(value::numeric),0) from jsonb_each_text(v_exp));
  return jsonb_build_object(
    'period', jsonb_build_object('start', p_start, 'end', p_end),
    'receita_bruta', v_gross, 'taxas_entrega', v_fee_rev, 'descontos', v_disc, 'cancelamentos_info', v_canc,
    'receita_liquida', v_net_rev, 'cmv', v_cmv, 'lucro_bruto', v_net_rev - v_cmv,
    'margem_bruta_pct', case when v_net_rev > 0 then round((v_net_rev - v_cmv) / v_net_rev * 100, 1) else 0 end,
    'taxas_pagamento', v_fees, 'despesas_por_grupo', v_exp, 'outras_receitas', v_other_rev,
    'despesas_fixas', v_fixed, 'despesas_variaveis', v_variable,
    'margem_contribuicao', v_mc,
    'margem_contribuicao_pct', case when v_net_rev > 0 then round(v_mc / v_net_rev * 100, 1) else 0 end,
    'ponto_equilibrio', case when v_net_rev > 0 and v_mc > 0 then round(v_fixed / (v_mc / v_net_rev), 2) end,
    'resultado', v_result,
    'margem_liquida_pct', case when v_net_rev > 0 then round(v_result / v_net_rev * 100, 1) else 0 end,
    'compras_insumos_caixa', v_purchases,
    'aviso', 'DRE gerencial: CMV estimado pela ficha técnica (custo médio). Não substitui a contabilidade oficial.'
  );
end $$;

create or replace function public.report_cash_flow(p_start date, p_end date)
returns table(day date, inflow numeric, outflow numeric, net numeric, projected_in numeric, projected_out numeric, cumulative numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._report_guard();
  return query
  with d as (select generate_series(p_start, p_end, interval '1 day')::date as dd),
  t as (select occurred_on, sum(amount) filter (where transaction_type='entrada') i, sum(amount) filter (where transaction_type='saida') o
          from public.financial_transactions where occurred_on between p_start and p_end and reference_type not in ('transferencia','sangria','suprimento')
         group by 1),
  pin as (select due_date, sum(amount - received_amount) a from public.accounts_receivable where status in ('aberto','parcial') group by 1),
  pout as (select due_date, sum(amount + interest - discount - paid_amount) a from public.accounts_payable where status in ('aberto','parcial') group by 1)
  select d.dd, coalesce(t.i,0), coalesce(t.o,0), coalesce(t.i,0) - coalesce(t.o,0), coalesce(pin.a,0), coalesce(pout.a,0),
         sum(coalesce(t.i,0) - coalesce(t.o,0) + case when d.dd >= current_date then coalesce(pin.a,0) - coalesce(pout.a,0) else 0 end) over (order by d.dd)
    from d left join t on t.occurred_on = d.dd left join pin on pin.due_date = d.dd left join pout on pout.due_date = d.dd
   order by d.dd;
end $$;

create or replace function public.report_kitchen(p_start date, p_end date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tz text := public._report_guard(); s public.company_settings;
begin
  select * into s from public.company_settings where id = 1;
  return jsonb_build_object(
    'orders', (select count(*) from public.orders where ready_at is not null and (created_at at time zone tz)::date between p_start and p_end),
    'avg_minutes', (select round(avg(extract(epoch from ready_at - coalesce(accepted_at, created_at)) / 60)::numeric, 1) from public.orders
                     where ready_at is not null and (created_at at time zone tz)::date between p_start and p_end),
    'late_orders', (select count(*) from public.orders where ready_at is not null and (created_at at time zone tz)::date between p_start and p_end
                     and ready_at - coalesce(accepted_at, created_at) > make_interval(mins => s.kitchen_alert_minutes)),
    'alert_minutes', s.kitchen_alert_minutes,
    'by_product', (select coalesce(jsonb_agg(x order by x.avg_minutes desc), '[]') from (
        select product_name product, count(*) items, round(avg(extract(epoch from prepared_at - started_at) / 60)::numeric, 1) avg_minutes
          from public.order_items oi join public.orders o on o.id = oi.order_id
         where oi.prepared_at is not null and oi.started_at is not null and (o.created_at at time zone tz)::date between p_start and p_end
         group by product_name) x),
    'by_hour', (select coalesce(jsonb_agg(x order by x.hour), '[]') from (
        select extract(hour from created_at at time zone tz)::int as hour, count(*) as orders,
               round(avg(extract(epoch from ready_at - coalesce(accepted_at, created_at)) / 60)::numeric, 1) avg_minutes
          from public.orders where ready_at is not null and (created_at at time zone tz)::date between p_start and p_end group by 1) x)
  );
end $$;

create or replace function public.report_delivery(p_start date, p_end date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tz text := public._report_guard();
begin
  return jsonb_build_object(
    'deliveries', (select count(*) from public.deliveries d join public.orders o on o.id = d.order_id where d.status = 'entregue' and (o.created_at at time zone tz)::date between p_start and p_end),
    'failed', (select count(*) from public.deliveries d join public.orders o on o.id = d.order_id where d.status = 'falhou' and (o.created_at at time zone tz)::date between p_start and p_end),
    'avg_route_minutes', (select round(avg(extract(epoch from d.delivered_at - d.dispatched_at) / 60)::numeric, 1) from public.deliveries d join public.orders o on o.id = d.order_id
                           where d.status = 'entregue' and (o.created_at at time zone tz)::date between p_start and p_end),
    'avg_total_minutes', (select round(avg(extract(epoch from o.delivered_at - o.created_at) / 60)::numeric, 1) from public.orders o
                           where o.channel = 'delivery' and o.status = 'entregue' and (o.created_at at time zone tz)::date between p_start and p_end),
    'by_driver', (select coalesce(jsonb_agg(x order by x.deliveries desc), '[]') from (
        select dr.name driver, count(*) deliveries, round(avg(extract(epoch from d.delivered_at - d.dispatched_at) / 60)::numeric, 1) avg_minutes,
               sum(d.fee) fees
          from public.deliveries d join public.delivery_drivers dr on dr.id = d.driver_id join public.orders o on o.id = d.order_id
         where d.status = 'entregue' and (o.created_at at time zone tz)::date between p_start and p_end group by dr.name) x),
    'by_zone', (select coalesce(jsonb_agg(x order by x.orders desc), '[]') from (
        select z.district, count(*) orders, sum(o.total) revenue from public.orders o join public.delivery_zones z on z.id = o.delivery_zone_id
         where o.status <> 'cancelado' and (o.created_at at time zone tz)::date between p_start and p_end group by z.district) x)
  );
end $$;

create or replace function public.report_cancellations(p_start date, p_end date)
returns table(order_number bigint, cancelled_at timestamptz, total numeric, reason text, cancelled_by text, authorized_by text)
language plpgsql stable security definer set search_path = public as $$
declare tz text := public._report_guard();
begin
  return query select o.number, o.cancelled_at, o.total, o.cancel_reason, u1.full_name, u2.full_name
    from public.orders o left join public.users u1 on u1.id = o.cancelled_by left join public.users u2 on u2.id = o.cancel_authorized_by
   where o.status = 'cancelado' and (o.cancelled_at at time zone tz)::date between p_start and p_end order by o.cancelled_at desc;
end $$;

create or replace function public.report_waste(p_start date, p_end date)
returns table(ingredient text, unit text, quantity numeric, cost numeric)
language plpgsql stable security definer set search_path = public as $$
declare tz text := public._report_guard();
begin
  return query select i.name, i.unit, -sum(m.quantity), sum(m.total_cost)
    from public.inventory_movements m join public.ingredients i on i.id = m.ingredient_id
   where m.movement_type = 'perda' and (m.created_at at time zone tz)::date between p_start and p_end
   group by i.name, i.unit order by 4 desc;
end $$;

create or replace function public.report_ingredient_costs(p_start date, p_end date)
returns table(ingredient text, unit text, consumed numeric, cost numeric, avg_cost numeric)
language plpgsql stable security definer set search_path = public as $$
declare tz text := public._report_guard();
begin
  return query select i.name, i.unit, -sum(m.quantity), sum(m.total_cost), i.avg_cost
    from public.inventory_movements m join public.ingredients i on i.id = m.ingredient_id
   where m.movement_type = 'consumo_venda' and (m.created_at at time zone tz)::date between p_start and p_end
   group by i.id order by 4 desc;
end $$;

create or replace function public.report_ingredient_price_history(p_ingredient uuid)
returns table(recorded_on date, unit_price numeric, supplier text, source text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._report_guard();
  return query select h.recorded_on, h.unit_price, s.name, h.source from public.ingredient_price_history h
    left join public.suppliers s on s.id = h.supplier_id where h.ingredient_id = p_ingredient order by h.recorded_on, h.id;
end $$;

create or replace function public.report_hours_by_department(p_start date, p_end date)
returns table(department text, employees bigint, worked_minutes bigint, overtime_minutes bigint, late_minutes bigint, absences bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._report_guard();
  if not public.has_perm('timeclock.view') then raise exception 'Permissão negada: timeclock.view' using errcode = '42501'; end if;
  return query
  with per as (
    select e.id, coalesce(d.name, 'Sem departamento') dep, public.timeclock_summary(e.id, greatest(p_start, e.hire_date), p_end) s
      from public.employees e left join public.departments d on d.id = e.department_id
     where e.hire_date <= p_end and (e.termination_date is null or e.termination_date >= p_start)
  )
  select dep, count(*), sum((s->>'worked_minutes')::bigint), sum((s->>'overtime_minutes')::bigint),
         sum((s->>'late_minutes')::bigint), sum((s->>'absences')::bigint)
    from per group by dep order by 3 desc;
end $$;

create or replace function public.report_stock_value_history(p_days int default 30)
returns table(day date, value numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._report_guard();
  -- reconstitui o valor do estoque (ao custo médio atual) a partir das movimentações
  return query
  with days as (select generate_series(current_date - p_days, current_date, interval '1 day')::date d),
  cur as (select ingredient_id, sum(quantity) q from public.inventory group by 1)
  select days.d, round(sum(greatest(cur.q - coalesce((select sum(m.quantity) from public.inventory_movements m
                         where m.ingredient_id = cur.ingredient_id and m.created_at::date > days.d), 0), 0) * i.avg_cost), 2)
    from days cross join cur join public.ingredients i on i.id = cur.ingredient_id group by days.d order by days.d;
end $$;

grant execute on all functions in schema public to authenticated;
do $$ declare f record; begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like '\_%' loop
    execute format('revoke execute on function %s from authenticated, anon, public', f.sig);
  end loop;
end $$;
