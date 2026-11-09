-- =====================================================================
-- 0012 FUNÇÕES DE APOIO AO PAINEL
-- =====================================================================
-- Preços efetivos (com promoções programadas) para o PDV
create or replace function public.pos_catalog() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.has_perm('pos.operate') then jsonb_build_object(
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.sort_order, c.name)
                              from public.categories c where c.is_active), '[]'),
    'products', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'category_id', p.category_id, 'name', p.name, 'sku', p.sku, 'barcode', p.barcode, 'unit', p.unit,
        'price', (public.effective_price(p.id, 'pdv')->>'price')::numeric, 'list_price', p.price, 'sold_out', p.sold_out,
        'option_groups', (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'min_select', g.min_select, 'max_select', g.max_select,
            'options', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'price_delta', o.price_delta) order by o.sort_order), '[]')
                          from public.product_options o where o.group_id = g.id and o.is_active)) order by g.sort_order), '[]')
            from public.product_option_groups g where g.product_id = p.id)
      ) order by p.sort_order, p.name) from public.products p where p.is_active and p.available_pos), '[]'),
    'payment_methods', coalesce((select jsonb_agg(jsonb_build_object('code', m.code, 'name', m.name, 'method_type', m.method_type, 'allows_change', m.allows_change) order by m.sort_order)
                                   from public.payment_methods m where m.is_active and m.available_pos), '[]'),
    'delivery_zones', coalesce((select jsonb_agg(jsonb_build_object('id', z.id, 'district', z.district, 'fee', z.fee) order by z.district)
                                  from public.delivery_zones z where z.is_active), '[]')
  ) end
$$;

-- Busca rápida de clientes para o PDV/atendimento
create or replace function public.search_customers(p_term text) returns table(id uuid, name text, phone text, credit_enabled boolean, loyalty_points int)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.phone, c.credit_enabled, c.loyalty_points from public.customers c
   where (public.has_perm('pos.operate') or public.has_perm('customers.view')) and c.anonymized_at is null
     and (c.phone like '%' || public.normalize_phone(p_term) || '%' or lower(c.name) like '%' || lower(trim(p_term)) || '%')
   order by c.last_order_at desc nulls last limit 15
$$;

create or replace function public.quick_customer(p_name text, p_phone text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not (public.has_perm('pos.operate') or public.has_perm('customers.manage')) then raise exception 'Permissão negada' using errcode = '42501'; end if;
  select id into v from public.customers where phone = public.normalize_phone(p_phone);
  if v is null then insert into public.customers(name, phone, source) values (p_name, p_phone, 'balcao') returning id into v; end if;
  return v;
end $$;

-- Usuários (lista para administração, com dados do Auth)
create or replace function public.admin_list_users() returns table(id uuid, email text, full_name text, role_code text, is_active boolean,
  has_pin boolean, max_discount_percent numeric, created_at timestamptz, employee_name text)
language sql stable security definer set search_path = public as $$
  select u.id, u.email, u.full_name, u.role_code, u.is_active, u.authorization_pin_hash is not null, u.max_discount_percent, u.created_at,
         (select e.full_name from public.employees e where e.user_id = u.id)
    from public.users u where public.has_perm('users.manage') order by u.is_active desc, u.full_name
$$;

create or replace function public.admin_update_user(p_user uuid, p_role text, p_active boolean, p_max_discount numeric, p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_perm('users.manage');
  if p_user = auth.uid() and (not p_active or p_role <> 'admin') and (select role_code from public.users where id = auth.uid()) = 'admin'
     and (select count(*) from public.users where role_code = 'admin' and is_active) <= 1 then
    raise exception 'Não é possível remover o último administrador ativo';
  end if;
  update public.users set role_code = p_role, is_active = p_active, max_discount_percent = coalesce(p_max_discount, 0),
         full_name = coalesce(nullif(trim(p_name), ''), full_name) where id = p_user;
end $$;

create or replace function public.admin_set_role_permissions(p_role text, p_perms text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_perm('users.manage');
  if p_role = 'admin' then raise exception 'O papel administrador sempre tem todas as permissões'; end if;
  delete from public.role_permissions where role_code = p_role and permission_code <> all(p_perms);
  insert into public.role_permissions(role_code, permission_code) select p_role, unnest(p_perms) on conflict do nothing;
end $$;

-- Insights automáticos (regras determinísticas sobre dados reais; base do assistente)
create or replace function public.business_insights(p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tz text; r jsonb := '[]'::jsonb; v record; s public.company_settings; cur numeric; prev numeric;
begin
  if not (public.has_perm('reports.view') or public.has_perm('ai.use') or public.has_perm('dashboard.view')) then
    raise exception 'Permissão negada' using errcode = '42501';
  end if;
  select * into s from public.company_settings where id = 1; tz := s.timezone;
  -- tendência de faturamento
  select coalesce(sum(total) filter (where sale_date >= now() - make_interval(days => p_days)),0),
         coalesce(sum(total) filter (where sale_date < now() - make_interval(days => p_days) and sale_date >= now() - make_interval(days => 2 * p_days)),0)
    into cur, prev from public.sales where status = 'concluida';
  if prev > 0 then
    r := r || jsonb_build_object('type', case when cur >= prev then 'positivo' else 'atencao' end, 'area', 'vendas',
      'text', format('Faturamento dos últimos %s dias: %s (%s%% vs. os %s dias anteriores).', p_days, to_char(cur, 'FM999G999G990D00'),
              round((cur - prev) / prev * 100, 1), p_days));
  end if;
  -- horário de pico
  select extract(hour from sale_date at time zone tz)::int h, count(*) n into v from public.sales
   where status = 'concluida' and sale_date >= now() - make_interval(days => p_days) group by 1 order by 2 desc limit 1;
  if found then r := r || jsonb_build_object('type', 'info', 'area', 'operacao', 'text', format('Horário de maior movimento: %sh (%s vendas no período).', v.h, v.n)); end if;
  -- produto mais vendido e de menor margem
  select si.product_name, sum(si.quantity) q into v from public.sale_items si join public.sales sa on sa.id = si.sale_id
   where sa.status = 'concluida' and sa.sale_date >= now() - make_interval(days => p_days) group by 1 order by 2 desc limit 1;
  if found then r := r || jsonb_build_object('type', 'info', 'area', 'vendas', 'text', format('Produto mais vendido: %s (%s unidades).', v.product_name, v.q)); end if;
  for v in select si.product_name, round(sum(si.total - si.total_cost) / nullif(sum(si.total),0) * 100, 1) m, sum(si.total) t
             from public.sale_items si join public.sales sa on sa.id = si.sale_id
            where sa.status = 'concluida' and sa.sale_date >= now() - make_interval(days => p_days) and si.unit_cost > 0
            group by 1 having sum(si.total) > 0 order by 2 limit 3 loop
    if v.m < 40 then r := r || jsonb_build_object('type', 'atencao', 'area', 'custos', 'text', format('Margem baixa em %s: %s%% (revise preço ou ficha técnica).', v.product_name, v.m)); end if;
  end loop;
  -- produtos vendidos sem ficha técnica (CMV subestimado)
  select count(distinct si.product_id) n into v from public.sale_items si join public.sales sa on sa.id = si.sale_id
   where sa.sale_date >= now() - make_interval(days => p_days) and si.unit_cost = 0;
  if v.n > 0 then r := r || jsonb_build_object('type', 'inconsistencia', 'area', 'estoque', 'text', format('%s produto(s) vendidos sem custo (sem ficha técnica ou item de estoque): o lucro está superestimado.', v.n)); end if;
  -- estoque
  for v in select name, quantity, min_stock, unit from public.v_stock_levels where is_active and min_stock > 0 and quantity <= min_stock order by quantity / nullif(min_stock,0) limit 5 loop
    r := r || jsonb_build_object('type', 'atencao', 'area', 'estoque', 'text', format('Repor %s: %s %s em estoque (mínimo %s).', v.name, v.quantity, v.unit, v.min_stock));
  end loop;
  select count(*) n into v from public.inventory where quantity < 0;
  if v.n > 0 then r := r || jsonb_build_object('type', 'inconsistencia', 'area', 'estoque', 'text', format('%s item(ns) com estoque negativo: registre as entradas de compra ou faça inventário.', v.n)); end if;
  -- diferenças de caixa
  select count(*) n, coalesce(sum(difference_total),0) d into v from public.cash_registers where closed_at >= now() - make_interval(days => p_days) and abs(difference_total) >= 1;
  if v.n > 0 then r := r || jsonb_build_object('type', 'inconsistencia', 'area', 'caixa', 'text', format('%s fechamento(s) de caixa com diferença (total %s).', v.n, to_char(v.d, 'FM999G990D00'))); end if;
  -- cancelamentos
  select count(*) n into v from public.orders where status = 'cancelado' and cancelled_at >= now() - make_interval(days => p_days);
  if v.n > 0 then r := r || jsonb_build_object('type', 'info', 'area', 'vendas', 'text', format('%s pedido(s) cancelados no período — veja motivos e responsáveis em Relatórios.', v.n)); end if;
  -- contas vencidas
  select count(*) n, coalesce(sum(amount - paid_amount),0) a into v from public.accounts_payable where status in ('aberto','parcial') and due_date < current_date;
  if v.n > 0 then r := r || jsonb_build_object('type', 'atencao', 'area', 'financeiro', 'text', format('%s conta(s) vencida(s), somando %s.', v.n, to_char(v.a, 'FM999G990D00'))); end if;
  -- maior despesa
  select c.name, sum(t.amount) a into v from public.financial_transactions t join public.financial_categories c on c.id = t.category_id
   where t.transaction_type = 'saida' and t.status = 'confirmado' and c.dre_group not in ('investimentos') and t.occurred_on >= current_date - p_days group by 1 order by 2 desc limit 1;
  if found then r := r || jsonb_build_object('type', 'info', 'area', 'financeiro', 'text', format('Maior despesa no período: %s (%s). Avalie renegociação ou alternativas.', v.name, to_char(v.a, 'FM999G990D00'))); end if;
  -- ajustes de ponto pendentes
  select count(*) n into v from public.time_adjustments where status = 'pendente';
  if v.n > 0 then r := r || jsonb_build_object('type', 'atencao', 'area', 'rh', 'text', format('%s ajuste(s) de ponto aguardando aprovação.', v.n)); end if;
  return r;
end $$;

grant execute on all functions in schema public to authenticated;
do $$ declare f record; begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like '\_%' loop
    execute format('revoke execute on function %s from authenticated, anon, public', f.sig);
  end loop;
end $$;
