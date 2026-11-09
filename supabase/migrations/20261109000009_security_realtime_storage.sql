-- =====================================================================
-- 0009 SEGURANÇA (RLS), REALTIME, STORAGE, CRM e INDICADORES
-- Política geral: nenhuma tabela é acessível a anon. O site público usa
-- apenas funções SECURITY DEFINER (public_menu, public_quote,
-- place_public_order, public_order_status). Usuários internos leem/escrevem
-- conforme permissões (has_perm). Operações críticas só via RPC.
-- =====================================================================
create or replace function public.customer_segments(p_frequent_orders int default 4, p_frequent_days int default 60, p_inactive_days int default 45)
returns table(customer_id uuid, name text, phone text, orders_count int, total_spent numeric, avg_ticket numeric,
              last_order_at timestamptz, days_since_last int, segment text, rank_position bigint)
language sql stable security definer set search_path = public as $$
  with recent as (
    select o.customer_id, count(*) n from public.orders o
     where o.status <> 'cancelado' and o.created_at > now() - make_interval(days => p_frequent_days) and o.customer_id is not null
     group by 1
  )
  select c.id, c.name, c.phone, c.orders_count, c.total_spent,
         case when c.orders_count > 0 then round(c.total_spent / c.orders_count, 2) else 0 end,
         c.last_order_at, (current_date - c.last_order_at::date),
         case when c.orders_count = 0 then 'sem_compras'
              when coalesce(r.n,0) >= p_frequent_orders then 'frequente'
              when c.last_order_at < now() - make_interval(days => p_inactive_days) then 'inativo'
              when c.orders_count = 1 then 'novo'
              else 'ocasional' end,
         rank() over (order by c.total_spent desc)
    from public.customers c left join recent r on r.customer_id = c.id
   where public.has_perm('customers.view') and c.anonymized_at is null
   order by c.total_spent desc
$$;


-- ---------------------------------------------------------------------
-- RLS: mapeamento tabela → (permissão de leitura, permissão de escrita direta)
-- escrita NULL = somente via RPC (sem insert/update/delete direto)
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select * from (values
    ('roles','settings.view','settings.manage'),
    ('permissions','settings.view',null),
    ('role_permissions','settings.view','settings.manage'),
    ('users','settings.view','users.manage'),
    ('user_permission_overrides','settings.view','users.manage'),
    ('company_settings','settings.view','settings.manage'),
    ('holidays','hr.view','hr.manage'),
    ('audit_logs','audit.view',null),
    ('departments','hr.view','hr.manage'),
    ('positions','hr.view','hr.manage'),
    ('schedules','hr.view','hr.manage'),
    ('employees','hr.view','hr.manage'),
    ('employee_position_history','hr.view',null),
    ('employee_salary_history','payroll.view',null),
    ('employee_contracts','hr.view','hr.manage'),
    ('employee_leaves','hr.view','hr.manage'),
    ('employee_occurrences','hr.view','hr.manage'),
    ('employee_documents','hr.view','hr.manage'),
    ('employee_evaluations','hr.view','hr.manage'),
    ('trainings','hr.view','hr.manage'),
    ('employee_trainings','hr.view','hr.manage'),
    ('shift_assignments','hr.view','hr.manage'),
    ('time_clock_devices','timeclock.manage',null),
    ('time_clock_records','timeclock.view',null),
    ('time_adjustments','timeclock.view',null),
    ('timeclock_auth_failures','timeclock.manage',null),
    ('overtime_records','timeclock.view',null),
    ('hour_bank_entries','timeclock.view','timeclock.manage'),
    ('categories','catalog.view','catalog.manage'),
    ('products','catalog.view','catalog.manage'),
    ('product_price_history','catalog.view',null),
    ('product_option_groups','catalog.view','catalog.manage'),
    ('product_options','catalog.view','catalog.manage'),
    ('combo_items','catalog.view','catalog.manage'),
    ('stock_locations','inventory.view','inventory.manage'),
    ('ingredients','inventory.view','inventory.manage'),
    ('recipes','inventory.view','inventory.manage'),
    ('recipe_items','inventory.view','inventory.manage'),
    ('inventory','inventory.view',null),
    ('inventory_lots','inventory.view',null),
    ('inventory_movements','inventory.view',null),
    ('inventory_counts','inventory.view',null),
    ('inventory_count_items','inventory.view','inventory.manage'),
    ('financial_accounts','finance.view','finance.manage'),
    ('financial_categories','finance.view','finance.manage'),
    ('payment_methods','pos.operate','settings.manage'),
    ('suppliers','purchases.view','purchases.manage'),
    ('financial_transactions','finance.view',null),
    ('accounts_payable','finance.view',null),
    ('accounts_receivable','finance.view',null),
    ('expenses','finance.view',null),
    ('purchase_requests','purchases.view','purchases.manage'),
    ('purchase_request_items','purchases.view','purchases.manage'),
    ('purchase_quotations','purchases.view','purchases.manage'),
    ('purchase_quotation_items','purchases.view','purchases.manage'),
    ('purchases','purchases.view','purchases.manage'),
    ('purchase_items','purchases.view','purchases.manage'),
    ('receiving_checks','purchases.view',null),
    ('ingredient_price_history','purchases.view',null),
    ('customers','customers.view','customers.manage'),
    ('delivery_zones','orders.view','delivery.manage'),
    ('customer_addresses','customers.view','customers.manage'),
    ('customer_consents','customers.view',null),
    ('customer_interactions','customers.view','customers.manage'),
    ('loyalty_transactions','customers.view',null),
    ('campaigns','marketing.view','marketing.manage'),
    ('coupons','marketing.view','marketing.manage'),
    ('coupon_redemptions','marketing.view',null),
    ('promotions','marketing.view','marketing.manage'),
    ('banners','marketing.view','marketing.manage'),
    ('delivery_drivers','orders.view','delivery.manage'),
    ('cash_registers','pos.manage',null),
    ('orders','orders.view',null),
    ('order_items','orders.view',null),
    ('order_status_history','orders.view',null),
    ('sales','sales.view',null),
    ('sale_items','sales.view',null),
    ('payments','sales.view',null),
    ('cash_movements','pos.manage',null),
    ('deliveries','orders.view',null)
  ) t(tbl, rperm, wperm) loop
    execute format('alter table public.%I enable row level security', r.tbl);
    execute format('revoke all on public.%I from anon', r.tbl);
    execute format('grant select on public.%I to authenticated', r.tbl);
    execute format('create policy %I on public.%I for select to authenticated using (public.has_perm(%L))',
                   r.tbl || '_read', r.tbl, r.rperm);
    if r.wperm is not null then
      execute format('grant insert, update, delete on public.%I to authenticated', r.tbl);
      execute format('create policy %I on public.%I for insert to authenticated with check (public.has_perm(%L))', r.tbl || '_ins', r.tbl, r.wperm);
      execute format('create policy %I on public.%I for update to authenticated using (public.has_perm(%L)) with check (public.has_perm(%L))', r.tbl || '_upd', r.tbl, r.wperm, r.wperm);
      execute format('create policy %I on public.%I for delete to authenticated using (public.has_perm(%L))', r.tbl || '_del', r.tbl, r.wperm);
    end if;
  end loop;
end $$;

-- Acessos complementares (o próprio usuário / departamento)
create policy users_self on public.users for select to authenticated using (id = auth.uid());
create policy employees_self on public.employees for select to authenticated using (user_id = auth.uid());
create policy tcr_self on public.time_clock_records for select to authenticated using (employee_id = public.my_employee_id());
create policy tadj_self on public.time_adjustments for select to authenticated using (employee_id = public.my_employee_id());
create policy ot_self on public.overtime_records for select to authenticated using (employee_id = public.my_employee_id());
create policy hbe_self on public.hour_bank_entries for select to authenticated using (employee_id = public.my_employee_id());
create policy leaves_self on public.employee_leaves for select to authenticated using (employee_id = public.my_employee_id());
create policy leaves_self_req on public.employee_leaves for insert to authenticated
  with check (employee_id = public.my_employee_id() and status = 'solicitado');
create policy cash_self on public.cash_registers for select to authenticated using (operator_id = auth.uid());
create policy cashmov_self on public.cash_movements for select to authenticated
  using (exists (select 1 from public.cash_registers r where r.id = cash_register_id and r.operator_id = auth.uid()));
create policy sales_self on public.sales for select to authenticated using (operator_id = auth.uid());
create policy deliveries_driver on public.deliveries for select to authenticated
  using (exists (select 1 from public.delivery_drivers d where d.id = driver_id and d.user_id = auth.uid()));
create policy orders_driver on public.orders for select to authenticated
  using (exists (select 1 from public.deliveries de join public.delivery_drivers d on d.id = de.driver_id
                 where de.order_id = orders.id and d.user_id = auth.uid()));
create policy orders_kitchen on public.orders for select to authenticated using (public.has_perm('kitchen.operate'));
create policy order_items_kitchen on public.order_items for select to authenticated using (public.has_perm('kitchen.operate'));
create policy roles_all on public.roles for select to authenticated using (true);
create policy permissions_all on public.permissions for select to authenticated using (true);
create policy categories_pos on public.categories for select to authenticated using (public.has_perm('pos.operate'));
create policy products_pos on public.products for select to authenticated using (public.has_perm('pos.operate'));
create policy pog_pos on public.product_option_groups for select to authenticated using (public.has_perm('pos.operate'));
create policy po_pos on public.product_options for select to authenticated using (public.has_perm('pos.operate'));
create policy customers_pos on public.customers for select to authenticated using (public.has_perm('pos.operate'));
create policy zones_pos on public.delivery_zones for select to authenticated using (public.has_perm('pos.operate'));
create policy company_all on public.company_settings for select to authenticated using (public.is_active_user());

-- Funções: execução revogada de PUBLIC e concedida explicitamente
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
-- funções internas (prefixo _) nunca são chamáveis diretamente
do $$ declare f record; begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like '\_%' loop
    execute format('revoke execute on function %s from authenticated, anon, public', f.sig);
  end loop;
end $$;
grant execute on function public.public_menu() to anon;
grant execute on function public.public_company_info() to anon;
grant execute on function public.public_quote(jsonb) to anon;
grant execute on function public.place_public_order(jsonb) to anon;
grant execute on function public.public_order_status(text) to anon;
grant execute on function public.kiosk_identify(text, text, text) to anon;
grant execute on function public.kiosk_punch(text, text, text, text) to anon;
grant execute on function public.store_is_open(timestamptz) to anon;
-- helpers usados dentro das políticas
grant execute on function public.has_perm(text) to anon;
grant execute on function public.my_employee_id() to anon;

grant select on public.v_stock_levels, public.v_expiring_lots, public.v_customer_current_consents to authenticated;

-- ---------------------------------------------------------------------
-- Realtime (cozinha, pedidos, delivery)
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table public.orders, public.order_items, public.deliveries;
alter table public.orders replica identity full;
alter table public.order_items replica identity full;

-- ---------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------
insert into storage.buckets(id, name, public) values
  ('product-images','product-images', true),
  ('company-assets','company-assets', true),
  ('employee-photos','employee-photos', false),
  ('employee-documents','employee-documents', false),
  ('finance-attachments','finance-attachments', false)
on conflict (id) do nothing;

create policy "imagens publicas leitura" on storage.objects for select
  using (bucket_id in ('product-images','company-assets'));
create policy "catalogo envia imagens" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and (public.has_perm('catalog.manage') or public.has_perm('marketing.manage')));
create policy "catalogo altera imagens" on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and (public.has_perm('catalog.manage') or public.has_perm('marketing.manage')));
create policy "catalogo remove imagens" on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and (public.has_perm('catalog.manage') or public.has_perm('marketing.manage')));
create policy "empresa assets" on storage.objects for all to authenticated
  using (bucket_id = 'company-assets' and public.has_perm('settings.manage'))
  with check (bucket_id = 'company-assets' and public.has_perm('settings.manage'));
create policy "rh arquivos" on storage.objects for all to authenticated
  using (bucket_id in ('employee-photos','employee-documents') and public.has_perm('hr.manage'))
  with check (bucket_id in ('employee-photos','employee-documents') and public.has_perm('hr.manage'));
create policy "rh leitura" on storage.objects for select to authenticated
  using (bucket_id in ('employee-photos','employee-documents') and public.has_perm('hr.view'));
create policy "financeiro anexos" on storage.objects for all to authenticated
  using (bucket_id = 'finance-attachments' and public.has_perm('finance.manage'))
  with check (bucket_id = 'finance-attachments' and public.has_perm('finance.manage'));

-- ---------------------------------------------------------------------
-- INDICADORES DO DASHBOARD (dados reais; período configurável)
-- ---------------------------------------------------------------------
create or replace function public.dashboard_kpis(p_start date, p_end date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.company_settings; v_tz text; v_today date; r jsonb;
begin
  perform public.require_perm('dashboard.view');
  select * into s from public.company_settings where id = 1;
  v_tz := s.timezone; v_today := (now() at time zone v_tz)::date;
  with sv as (
    select sa.*, (sa.sale_date at time zone v_tz)::date d from public.sales sa where sa.status = 'concluida'
  ), period as (select * from sv where d between p_start and p_end)
  select jsonb_build_object(
    'revenue_today', (select coalesce(sum(total),0) from sv where d = v_today),
    'revenue_week', (select coalesce(sum(total),0) from sv where d >= date_trunc('week', v_today)::date and d <= v_today),
    'revenue_month', (select coalesce(sum(total),0) from sv where d >= date_trunc('month', v_today)::date and d <= v_today),
    'revenue_year', (select coalesce(sum(total),0) from sv where d >= date_trunc('year', v_today)::date and d <= v_today),
    'revenue_period', (select coalesce(sum(total),0) from period),
    'cost_period', (select coalesce(sum(cost_total),0) from period),
    'fees_period', (select coalesce(sum(fee_total),0) from period),
    'gross_profit', (select coalesce(sum(total - delivery_fee - cost_total),0) from period),
    'expenses_period', (select coalesce(sum(t.amount),0) from public.financial_transactions t
                          left join public.financial_categories c on c.id = t.category_id
                         where t.transaction_type = 'saida' and t.status = 'confirmado' and t.reference_type in ('conta_pagar','despesa','manual')
                           and coalesce(c.dre_group,'') not in ('cmv','investimentos')
                           and t.competence_date between p_start and p_end),
    'sales_count', (select count(*) from period),
    'orders_count', (select count(*) from public.orders o where (o.created_at at time zone v_tz)::date between p_start and p_end),
    'cancelled_count', (select count(*) from public.orders o where o.status = 'cancelado' and (o.created_at at time zone v_tz)::date between p_start and p_end),
    'avg_ticket', (select coalesce(round(avg(total),2),0) from period),
    'items_sold', (select coalesce(sum(si.quantity),0) from public.sale_items si join period p on p.id = si.sale_id),
    'orders_pending', (select count(*) from public.orders where status in ('pendente','novo')),
    'orders_preparing', (select count(*) from public.orders where status in ('em_preparo','aguardando_finalizacao')),
    'orders_ready', (select count(*) from public.orders where status in ('pronto','saiu_entrega')),
    'employees_working', (select count(*) from public.employees_presence() where state in ('trabalhando','intervalo')),
    'employees_absent', (select count(*) from public.employees_presence() where state = 'ausente'),
    'low_stock', (select count(*) from public.v_stock_levels where is_active and status <> 'ok' and min_stock > 0),
    'expiring_lots', (select count(*) from public.v_expiring_lots),
    'payables_open', (select coalesce(sum(amount + interest - discount - paid_amount),0) from public.accounts_payable where status in ('aberto','parcial')),
    'payables_overdue', (select coalesce(sum(amount + interest - discount - paid_amount),0) from public.accounts_payable where status in ('aberto','parcial') and due_date < v_today),
    'payables_due_7d', (select coalesce(sum(amount + interest - discount - paid_amount),0) from public.accounts_payable where status in ('aberto','parcial') and due_date between v_today and v_today + 7),
    'receivables_open', (select coalesce(sum(amount - received_amount),0) from public.accounts_receivable where status in ('aberto','parcial'))
  ) into r;
  return r || jsonb_build_object('net_profit_estimate',
     (r->>'gross_profit')::numeric - (r->>'fees_period')::numeric - (r->>'expenses_period')::numeric);
end $$;
grant execute on function public.dashboard_kpis(date, date) to authenticated;
