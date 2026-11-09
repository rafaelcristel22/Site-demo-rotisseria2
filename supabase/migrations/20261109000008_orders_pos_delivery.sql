-- =====================================================================
-- 0008 PEDIDOS, PDV, CAIXA, VENDAS, PAGAMENTOS, COZINHA E DELIVERY
-- Todas as operações críticas são funções transacionais (uma chamada =
-- uma transação). Preços e totais são SEMPRE recalculados no servidor.
-- =====================================================================
create table public.delivery_drivers (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete set null,
  user_id uuid references public.users(id) on delete set null,
  name text not null,
  phone text,
  vehicle text default 'moto',
  plate text,
  availability text not null default 'disponivel' check (availability in ('disponivel','em_entrega','indisponivel')),
  fee_per_delivery numeric(10,2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.cash_registers (
  id uuid primary key default gen_random_uuid(),
  terminal_name text not null default 'Caixa 1',
  operator_id uuid not null references public.users(id),
  status text not null default 'aberto' check (status in ('aberto','fechado','conferido')),
  opened_at timestamptz not null default now(),
  opening_amount numeric(12,2) not null default 0 check (opening_amount >= 0),
  closed_at timestamptz,
  closed_by uuid,
  expected jsonb,
  counted jsonb,
  difference_total numeric(12,2),
  notes text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_notes text
);
create unique index cash_one_open_per_operator on public.cash_registers(operator_id) where status = 'aberto';
create trigger audit_cash_registers after insert or update on public.cash_registers
  for each row execute function public.tg_audit_row();

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  tracking_code text not null unique default upper(substr(encode(extensions.gen_random_bytes(6),'hex'),1,10)),
  channel text not null check (channel in ('balcao','delivery','retirada')),
  origin text not null default 'pdv' check (origin in ('pdv','site','telefone')),
  status text not null default 'pendente' check (status in
    ('pendente','novo','em_preparo','aguardando_finalizacao','pronto','saiu_entrega','entregue','cancelado')),
  customer_id uuid references public.customers(id),
  customer_name text,
  customer_phone text,
  delivery_address jsonb,
  delivery_zone_id uuid references public.delivery_zones(id),
  scheduled_for timestamptz,
  subtotal numeric(12,2) not null default 0,
  items_discount numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  coupon_id uuid references public.coupons(id),
  coupon_code text,
  loyalty_points_used int not null default 0,
  delivery_fee numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  payment_method_planned text references public.payment_methods(code),
  change_for numeric(12,2),
  payment_status text not null default 'pendente' check (payment_status in ('pendente','pago','estornado')),
  notes text,
  created_by uuid default auth.uid(),
  cash_register_id uuid references public.cash_registers(id),
  discount_authorized_by uuid,
  accepted_at timestamptz,
  preparing_at timestamptz,
  ready_at timestamptz,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_authorized_by uuid,
  cancel_reason text,
  stock_deducted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orders_status_idx on public.orders(status, created_at);
create index orders_created_idx on public.orders(created_at);
create index orders_customer_idx on public.orders(customer_id);
create trigger orders_updated before update on public.orders
  for each row execute function public.tg_set_updated_at();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id),
  product_name text not null,
  category_id uuid references public.categories(id),
  quantity numeric(10,3) not null check (quantity > 0),
  list_price numeric(12,2) not null,
  unit_price numeric(12,2) not null,
  options jsonb not null default '[]'::jsonb,
  notes text,
  discount numeric(12,2) not null default 0,
  total numeric(12,2) not null,
  unit_cost numeric(14,4) not null default 0,
  send_to_kitchen boolean not null default true,
  station text,
  kitchen_status text not null default 'pendente' check (kitchen_status in ('pendente','preparando','pronto','entregue')),
  started_at timestamptz,
  prepared_at timestamptz,
  prepared_by uuid
);
create index order_items_order_idx on public.order_items(order_id);

create table public.order_status_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now(),
  notes text
);
create index osh_order_idx on public.order_status_history(order_id);
create or replace function public.tg_order_status_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.order_status_history(order_id, from_status, to_status)
    values (new.id, case when tg_op = 'UPDATE' then old.status end, new.status);
  end if;
  return new;
end $$;
create trigger orders_status_history after insert or update of status on public.orders
  for each row execute function public.tg_order_status_history();

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  order_id uuid not null unique references public.orders(id),
  cash_register_id uuid references public.cash_registers(id),
  operator_id uuid references public.users(id),
  customer_id uuid references public.customers(id),
  channel text not null,
  sale_date timestamptz not null default now(),
  subtotal numeric(12,2) not null,
  discount numeric(12,2) not null default 0,
  delivery_fee numeric(12,2) not null default 0,
  total numeric(12,2) not null,
  cost_total numeric(12,2) not null default 0,
  fee_total numeric(12,2) not null default 0,
  status text not null default 'concluida' check (status in ('concluida','cancelada')),
  discount_authorized_by uuid,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_authorized_by uuid,
  cancel_reason text,
  print_count int not null default 0
);
create index sales_date_idx on public.sales(sale_date);
create index sales_register_idx on public.sales(cash_register_id);
create trigger audit_sales after insert or update on public.sales
  for each row execute function public.tg_audit_row();

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  order_item_id uuid references public.order_items(id),
  product_id uuid not null references public.products(id),
  product_name text not null,
  category_id uuid references public.categories(id),
  quantity numeric(10,3) not null,
  unit_price numeric(12,2) not null,
  discount numeric(12,2) not null default 0,
  total numeric(12,2) not null,
  unit_cost numeric(14,4) not null default 0,
  total_cost numeric(12,2) generated always as (round(quantity * unit_cost, 2)) stored
);
create index sale_items_sale_idx on public.sale_items(sale_id);
create index sale_items_product_idx on public.sale_items(product_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id),
  order_id uuid references public.orders(id),
  method_code text not null references public.payment_methods(code),
  amount numeric(12,2) not null check (amount > 0),
  tendered_amount numeric(12,2),
  change_amount numeric(12,2) not null default 0,
  fee_amount numeric(12,2) not null default 0,
  net_amount numeric(12,2) not null,
  status text not null default 'confirmado' check (status in ('confirmado','estornado')),
  transaction_id uuid references public.financial_transactions(id),
  receivable_id uuid references public.accounts_receivable(id),
  created_at timestamptz not null default now()
);
create index payments_sale_idx on public.payments(sale_id);
alter table public.accounts_receivable add constraint ar_sale_fk foreign key (sale_id) references public.sales(id);
alter table public.accounts_receivable add constraint ar_order_fk foreign key (order_id) references public.orders(id);
alter table public.coupon_redemptions add constraint cr_order_fk foreign key (order_id) references public.orders(id);
alter table public.loyalty_transactions add constraint lt_order_fk foreign key (order_id) references public.orders(id);

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  cash_register_id uuid not null references public.cash_registers(id),
  movement_type text not null check (movement_type in ('abertura','venda','sangria','suprimento','cancelamento','quebra')),
  method_code text references public.payment_methods(code),
  amount numeric(12,2) not null,          -- efeito no dinheiro da gaveta (com sinal)
  description text,
  sale_id uuid references public.sales(id),
  authorized_by uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index cash_mov_reg_idx on public.cash_movements(cash_register_id);
create trigger audit_cash_movements after insert on public.cash_movements
  for each row execute function public.tg_audit_row();
create trigger cash_mov_immutable before update or delete on public.cash_movements
  for each row execute function public.tg_inv_mov_immutable();

create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  driver_id uuid references public.delivery_drivers(id),
  status text not null default 'aguardando' check (status in ('aguardando','atribuida','em_rota','entregue','falhou','cancelada')),
  fee numeric(10,2) not null default 0,
  assigned_at timestamptz,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  settled boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);
create index deliveries_driver_idx on public.deliveries(driver_id, status);

-- ---------------------------------------------------------------------
-- Funções internas
-- ---------------------------------------------------------------------
create or replace function public._reverse_tx(p_id uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t public.financial_transactions; v_id uuid;
begin
  select * into t from public.financial_transactions where id = p_id for update;
  if not found or t.status <> 'confirmado' then return null; end if;
  update public.financial_transactions set status = 'estornado' where id = p_id;
  insert into public.financial_transactions(account_id, transaction_type, amount, occurred_on, competence_date, category_id,
         description, reference_type, reference_id, reversal_of, status)
  values (t.account_id, case when t.transaction_type = 'entrada' then 'saida' else 'entrada' end, t.amount, current_date,
          t.competence_date, t.category_id, 'Estorno: ' || t.description || ' — ' || p_reason, 'estorno', t.id::text, t.id, 'estornado')
  returning id into v_id;
  return v_id;
end $$;

-- Monta itens do pedido com preço calculado no servidor.
-- p_items: [{"product_id":uuid,"quantity":n,"option_ids":[uuid],"notes":"", "discount": n}]
create or replace function public._build_order_items(p_order uuid, p_items jsonb, p_channel text) returns numeric
language plpgsql security definer set search_path = public as $$
declare it jsonb; p public.products; v_qty numeric; v_price jsonb; v_unit numeric; v_opts jsonb; v_opt_cost numeric;
        g record; v_sel int; v_subtotal numeric := 0; v_line numeric; v_disc numeric; v_cat public.categories;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'O pedido não possui itens'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into p from public.products where id = (it->>'product_id')::uuid;
    if not found or not p.is_active then raise exception 'Produto indisponível'; end if;
    if p.sold_out then raise exception '% está esgotado no momento', p.name; end if;
    if p_channel = 'site' and not p.available_online then raise exception '% não está disponível online', p.name; end if;
    if p_channel = 'pdv' and not p.available_pos then raise exception '% não está disponível no PDV', p.name; end if;
    v_qty := coalesce((it->>'quantity')::numeric, 1);
    if v_qty <= 0 or v_qty > 999 then raise exception 'Quantidade inválida para %', p.name; end if;
    if p.unit = 'un' and v_qty <> trunc(v_qty) then raise exception 'Quantidade de % deve ser inteira', p.name; end if;

    -- opções
    select coalesce(jsonb_agg(jsonb_build_object('option_id', o.id, 'group', gr.name, 'name', o.name, 'price_delta', o.price_delta)
                    order by gr.sort_order, o.sort_order), '[]'::jsonb),
           coalesce(sum(case when o.stock_item_id is not null then o.stock_qty * i.avg_cost else 0 end), 0)
      into v_opts, v_opt_cost
      from public.product_options o
      join public.product_option_groups gr on gr.id = o.group_id
      left join public.ingredients i on i.id = o.stock_item_id
     where gr.product_id = p.id and o.is_active
       and o.id in (select (x)::uuid from jsonb_array_elements_text(coalesce(it->'option_ids','[]'::jsonb)) x);
    if jsonb_array_length(v_opts) <> jsonb_array_length(coalesce(it->'option_ids','[]'::jsonb)) then
      raise exception 'Opção inválida para %', p.name;
    end if;
    for g in select * from public.product_option_groups where product_id = p.id loop
      select count(*) into v_sel from jsonb_array_elements(v_opts) x where x->>'group' = g.name;
      if v_sel < g.min_select then raise exception 'Escolha ao menos % opção(ões) em "%" (%)', g.min_select, g.name, p.name; end if;
      if v_sel > g.max_select then raise exception 'Máximo de % opção(ões) em "%" (%)', g.max_select, g.name, p.name; end if;
    end loop;

    v_price := public.effective_price(p.id, case when p_channel = 'site' then 'site' else 'pdv' end);
    v_unit := (v_price->>'price')::numeric + coalesce((select sum((x->>'price_delta')::numeric) from jsonb_array_elements(v_opts) x), 0);
    v_line := round(v_unit * v_qty, 2);
    v_disc := least(greatest(coalesce((it->>'discount')::numeric, 0), 0), v_line);
    if p_channel = 'site' then v_disc := 0; end if;
    select * into v_cat from public.categories where id = p.category_id;
    insert into public.order_items(order_id, product_id, product_name, category_id, quantity, list_price, unit_price, options,
                                   notes, discount, total, unit_cost, send_to_kitchen, station, kitchen_status)
    values (p_order, p.id, p.name, p.category_id, v_qty, (v_price->>'list_price')::numeric, v_unit, v_opts,
            nullif(left(trim(it->>'notes'), 300), ''), v_disc, v_line - v_disc,
            public.product_unit_cost(p.id) + v_opt_cost, p.send_to_kitchen, coalesce(v_cat.kitchen_station, 'cozinha'),
            case when p.send_to_kitchen then 'pendente' else 'pronto' end);
    v_subtotal := v_subtotal + v_line - v_disc;
  end loop;
  return v_subtotal;
end $$;

create or replace function public._order_stock(p_order uuid, p_reverse boolean) returns void
language plpgsql security definer set search_path = public as $$
declare it record; r record; o record;
begin
  for it in select * from public.order_items where order_id = p_order loop
    for r in select ingredient_id, sum(quantity) q from public.product_stock_requirements(it.product_id, it.quantity) group by 1 loop
      perform public._inventory_apply(r.ingredient_id, null, case when p_reverse then r.q else -r.q end,
              case when p_reverse then 'estorno_venda' else 'consumo_venda' end, null, 'pedido', p_order::text,
              it.product_name, null, null, true);
    end loop;
    for o in select po.stock_item_id, po.stock_qty from jsonb_array_elements(it.options) x
               join public.product_options po on po.id = (x->>'option_id')::uuid
              where po.stock_item_id is not null and po.stock_qty > 0 loop
      perform public._inventory_apply(o.stock_item_id, null, (case when p_reverse then 1 else -1 end) * o.stock_qty * it.quantity,
              case when p_reverse then 'estorno_venda' else 'consumo_venda' end, null, 'pedido', p_order::text,
              it.product_name || ' (opção)', null, null, true);
    end loop;
  end loop;
  update public.orders set stock_deducted = not p_reverse where id = p_order;
end $$;

create or replace function public._order_kitchen_status(p_order uuid) returns text
language sql stable as $$
  select case when not exists (select 1 from public.order_items where order_id = p_order and send_to_kitchen) then 'pronto'
              else 'novo' end
$$;

-- Registra a venda, pagamentos, caixa, financeiro, fidelidade e estatísticas do cliente.
-- p_payments: [{"method":"dinheiro","amount":50,"tendered":100}]
create or replace function public._register_sale(p_order uuid, p_payments jsonb, p_register uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o public.orders; s public.company_settings; v_sale uuid; pay jsonb; pm public.payment_methods;
        v_amount numeric; v_tendered numeric; v_change numeric; v_fee numeric; v_sum numeric := 0; v_total_change numeric := 0;
        v_tx uuid; v_ar uuid; v_cat uuid; v_open numeric; v_cost numeric; v_fees numeric := 0; v_points int;
begin
  select * into o from public.orders where id = p_order for update;
  select * into s from public.company_settings where id = 1;
  if o.payment_status = 'pago' then raise exception 'Pedido já pago'; end if;
  if o.status = 'cancelado' then raise exception 'Pedido cancelado'; end if;
  if p_payments is null or jsonb_array_length(p_payments) = 0 then raise exception 'Informe a forma de pagamento'; end if;
  v_cat := public.category_by_group('receita_vendas', 'receita');

  select coalesce(sum(round(quantity * unit_cost, 2)), 0) into v_cost from public.order_items where order_id = p_order;
  insert into public.sales(order_id, cash_register_id, operator_id, customer_id, channel, subtotal, discount, delivery_fee,
                           total, cost_total, discount_authorized_by)
  values (o.id, p_register, auth.uid(), o.customer_id, o.channel, o.subtotal, o.discount + o.items_discount, o.delivery_fee,
          o.total, v_cost, o.discount_authorized_by)
  returning id into v_sale;
  insert into public.sale_items(sale_id, order_item_id, product_id, product_name, category_id, quantity, unit_price, discount, total, unit_cost)
  select v_sale, id, product_id, product_name, category_id, quantity, unit_price, discount, total, unit_cost
    from public.order_items where order_id = p_order;

  for pay in select * from jsonb_array_elements(p_payments) loop
    select * into pm from public.payment_methods where code = pay->>'method' and is_active;
    if not found then raise exception 'Forma de pagamento inválida: %', pay->>'method'; end if;
    v_amount := round((pay->>'amount')::numeric, 2);
    if v_amount is null or v_amount <= 0 then raise exception 'Valor de pagamento inválido'; end if;
    v_tendered := nullif(pay->>'tendered','')::numeric;
    v_change := 0;
    if v_tendered is not null and v_tendered > v_amount then
      if not pm.allows_change then raise exception '% não permite troco', pm.name; end if;
      v_change := v_tendered - v_amount;
    end if;
    v_fee := round(v_amount * pm.fee_percent / 100 + pm.fee_fixed, 2);
    v_fees := v_fees + v_fee;
    v_tx := null; v_ar := null;

    if pm.method_type = 'dinheiro' then
      if p_register is null then raise exception 'Pagamento em dinheiro exige caixa aberto'; end if;
      insert into public.cash_movements(cash_register_id, movement_type, method_code, amount, description, sale_id)
      values (p_register, 'venda', pm.code, v_amount, 'Venda pedido #' || o.number, v_sale);
      v_tx := public._fin_tx(pm.account_id, 'entrada', v_amount, 'Venda #' || o.number || ' (' || pm.name || ')', v_cat, 'venda', v_sale::text);
    elsif pm.method_type = 'credito_interno' then
      if o.customer_id is null then raise exception 'Crédito interno exige cliente identificado'; end if;
      select coalesce(sum(amount - received_amount), 0) into v_open from public.accounts_receivable
       where customer_id = o.customer_id and status in ('aberto','parcial');
      if not exists (select 1 from public.customers where id = o.customer_id and credit_enabled and not is_blocked
                     and credit_limit >= v_open + v_amount) then
        raise exception 'Cliente sem crédito autorizado ou limite insuficiente';
      end if;
      insert into public.accounts_receivable(customer_id, receivable_type, description, due_date, amount, account_id, category_id,
                                             sale_id, order_id, payment_method_code)
      values (o.customer_id, 'credito_cliente', 'Venda a prazo #' || o.number, current_date + 30, v_amount, pm.account_id, v_cat,
              v_sale, o.id, pm.code) returning id into v_ar;
    elsif pm.settlement_days > 0 then
      insert into public.accounts_receivable(customer_id, receivable_type, description, due_date, amount, account_id, category_id,
                                             sale_id, order_id, payment_method_code)
      values (o.customer_id, 'cartao', pm.name || ' — venda #' || o.number, current_date + pm.settlement_days, v_amount - v_fee,
              pm.account_id, v_cat, v_sale, o.id, pm.code) returning id into v_ar;
    else
      v_tx := public._fin_tx(pm.account_id, 'entrada', v_amount - v_fee, 'Venda #' || o.number || ' (' || pm.name || ')', v_cat, 'venda', v_sale::text);
    end if;

    insert into public.payments(sale_id, order_id, method_code, amount, tendered_amount, change_amount, fee_amount, net_amount, transaction_id, receivable_id)
    values (v_sale, o.id, pm.code, v_amount, v_tendered, v_change, v_fee, v_amount - v_fee, v_tx, v_ar);
    v_sum := v_sum + v_amount; v_total_change := v_total_change + v_change;
  end loop;

  if abs(v_sum - o.total) > 0.009 then
    raise exception 'Soma dos pagamentos (R$ %) difere do total (R$ %)', v_sum, o.total;
  end if;
  update public.sales set fee_total = v_fees where id = v_sale;
  update public.orders set payment_status = 'pago', cash_register_id = coalesce(p_register, cash_register_id) where id = o.id;

  -- cupom
  if o.coupon_id is not null then
    insert into public.coupon_redemptions(coupon_id, order_id, customer_id, discount_amount)
    values (o.coupon_id, o.id, o.customer_id, o.discount);
    update public.coupons set uses_count = uses_count + 1 where id = o.coupon_id;
  end if;

  -- cliente + fidelidade
  if o.customer_id is not null then
    update public.customers set orders_count = orders_count + 1, total_spent = total_spent + o.total,
           first_order_at = coalesce(first_order_at, now()), last_order_at = now() where id = o.customer_id;
    if s.loyalty_enabled then
      v_points := floor((o.total - o.delivery_fee) * s.loyalty_points_per_real);
      if v_points > 0 then
        insert into public.loyalty_transactions(customer_id, points, tx_type, order_id, notes)
        values (o.customer_id, v_points, 'acumulo', o.id, 'Pedido #' || o.number);
      end if;
    end if;
  end if;
  return jsonb_build_object('sale_id', v_sale, 'change', v_total_change);
end $$;

create or replace function public._apply_order_discounts(
  p_order uuid, p_coupon text, p_points int, p_channel text, p_manual_discount numeric default 0
) returns void language plpgsql security definer set search_path = public as $$
declare o public.orders; s public.company_settings; v_c jsonb; v_disc numeric := 0; v_pts_disc numeric := 0; v_total numeric;
begin
  select * into o from public.orders where id = p_order for update;
  select * into s from public.company_settings where id = 1;
  if nullif(trim(p_coupon),'') is not null then
    v_c := public.validate_coupon(p_coupon, o.subtotal, o.customer_id, p_channel, o.delivery_fee);
    if not (v_c->>'valid')::boolean then raise exception '%', v_c->>'message'; end if;
    v_disc := (v_c->>'discount')::numeric;
    update public.orders set coupon_id = (v_c->>'coupon_id')::uuid, coupon_code = v_c->>'code' where id = p_order;
  end if;
  if coalesce(p_points,0) > 0 then
    if not s.loyalty_enabled then raise exception 'Programa de fidelidade desativado'; end if;
    if o.customer_id is null then raise exception 'Resgate de pontos exige cliente identificado'; end if;
    if p_points < s.loyalty_min_redeem_points then raise exception 'Mínimo de % pontos para resgate', s.loyalty_min_redeem_points; end if;
    v_pts_disc := round(p_points * s.loyalty_real_per_point, 2);
    insert into public.loyalty_transactions(customer_id, points, tx_type, order_id, notes)
    values (o.customer_id, -p_points, 'resgate', o.id, 'Resgate no pedido #' || o.number);
  end if;
  v_disc := v_disc + v_pts_disc + coalesce(p_manual_discount, 0);
  v_total := o.subtotal + o.delivery_fee - v_disc;
  if v_total < 0 then raise exception 'Desconto maior que o valor do pedido'; end if;
  update public.orders set discount = round(v_disc, 2), loyalty_points_used = coalesce(p_points,0), total = round(v_total, 2)
   where id = p_order;
end $$;

-- ---------------------------------------------------------------------
-- CAIXA
-- ---------------------------------------------------------------------
create or replace function public.open_cash_register(p_terminal text, p_opening_amount numeric) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.require_perm('pos.operate');
  if exists (select 1 from public.cash_registers where operator_id = auth.uid() and status = 'aberto') then
    raise exception 'Você já possui um caixa aberto';
  end if;
  insert into public.cash_registers(terminal_name, operator_id, opening_amount) values (p_terminal, auth.uid(), p_opening_amount)
  returning id into v_id;
  insert into public.cash_movements(cash_register_id, movement_type, method_code, amount, description)
  values (v_id, 'abertura', 'dinheiro', p_opening_amount, 'Fundo de troco');
  return v_id;
end $$;

create or replace function public.my_open_cash_register() returns public.cash_registers
language sql stable security definer set search_path = public as $$
  select * from public.cash_registers where operator_id = auth.uid() and status = 'aberto'
$$;

create or replace function public.cash_movement(p_register uuid, p_type text, p_amount numeric, p_reason text,
  p_account uuid default null, p_pin text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.cash_registers; s public.company_settings; v_auth uuid; v_id uuid; v_cash_acc uuid; v_bal numeric;
begin
  perform public.require_perm('pos.operate');
  select * into r from public.cash_registers where id = p_register for update;
  select * into s from public.company_settings where id = 1;
  if r.status <> 'aberto' then raise exception 'Caixa não está aberto'; end if;
  if r.operator_id <> auth.uid() and not public.has_perm('pos.manage') then raise exception 'Caixa de outro operador' using errcode='42501'; end if;
  if p_type not in ('sangria','suprimento') then raise exception 'Tipo inválido'; end if;
  if p_amount <= 0 then raise exception 'Valor inválido'; end if;
  if coalesce(length(trim(p_reason)),0) < 3 then raise exception 'Informe o motivo'; end if;
  if p_type = 'sangria' then
    select coalesce(sum(amount),0) into v_bal from public.cash_movements where cash_register_id = p_register;
    select v_bal - coalesce(sum(change_amount),0) into v_bal from public.payments p join public.sales sa on sa.id = p.sale_id
     where sa.cash_register_id = p_register and p.status = 'confirmado';
    if p_amount > v_bal then raise exception 'Sangria maior que o dinheiro em caixa (R$ %)', v_bal; end if;
    if s.pos_require_pin_for_withdrawal then v_auth := public.verify_authorizer(p_pin, 'pos.manage'); end if;
  end if;
  insert into public.cash_movements(cash_register_id, movement_type, method_code, amount, description, authorized_by)
  values (p_register, p_type, 'dinheiro', case when p_type = 'sangria' then -p_amount else p_amount end, p_reason, v_auth)
  returning id into v_id;
  -- reflexo financeiro: transferência entre o caixa físico e a conta indicada (cofre/banco)
  select account_id into v_cash_acc from public.payment_methods where code = 'dinheiro';
  if p_account is not null and v_cash_acc is not null and p_account <> v_cash_acc then
    perform public._fin_tx(case when p_type='sangria' then v_cash_acc else p_account end, 'saida', p_amount,
            initcap(p_type) || ': ' || p_reason, null, p_type, v_id::text, current_date, current_date, v_id);
    perform public._fin_tx(case when p_type='sangria' then p_account else v_cash_acc end, 'entrada', p_amount,
            initcap(p_type) || ': ' || p_reason, null, p_type, v_id::text, current_date, current_date, v_id);
  end if;
  return v_id;
end $$;

create or replace function public.cash_register_summary(p_register uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.cash_registers; v_by_method jsonb; v_cash numeric; v_change numeric;
begin
  select * into r from public.cash_registers where id = p_register;
  if r.operator_id <> auth.uid() and not public.has_perm('pos.manage') then raise exception 'Permissão negada' using errcode = '42501'; end if;
  select coalesce(jsonb_object_agg(method_code, total), '{}'::jsonb) into v_by_method from (
    select p.method_code, sum(p.amount) total from public.payments p join public.sales sa on sa.id = p.sale_id
     where sa.cash_register_id = p_register and p.status = 'confirmado' group by 1) x;
  select coalesce(sum(change_amount),0) into v_change from public.payments p join public.sales sa on sa.id = p.sale_id
   where sa.cash_register_id = p_register and p.status = 'confirmado';
  select coalesce(sum(amount),0) into v_cash from public.cash_movements where cash_register_id = p_register;
  return jsonb_build_object(
    'register', to_jsonb(r),
    'operator', (select full_name from public.users where id = r.operator_id),
    'sales_count', (select count(*) from public.sales where cash_register_id = p_register and status = 'concluida'),
    'sales_total', (select coalesce(sum(total),0) from public.sales where cash_register_id = p_register and status = 'concluida'),
    'cancelled_count', (select count(*) from public.sales where cash_register_id = p_register and status = 'cancelada'),
    'by_method', v_by_method,
    'withdrawals', (select coalesce(-sum(amount),0) from public.cash_movements where cash_register_id = p_register and movement_type = 'sangria'),
    'supplies', (select coalesce(sum(amount),0) from public.cash_movements where cash_register_id = p_register and movement_type = 'suprimento'),
    'expected_cash', v_cash,
    'movements', (select coalesce(jsonb_agg(to_jsonb(m) order by created_at), '[]') from public.cash_movements m where cash_register_id = p_register)
  );
end $$;

-- Fechamento individual por operador. p_counted = {"dinheiro": 350.00, "pix": 120, ...}
create or replace function public.close_cash_register(p_register uuid, p_counted jsonb, p_notes text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.cash_registers; v_sum jsonb; v_expected jsonb; v_diff numeric := 0; k text; v_e numeric; v_c numeric;
        v_cash_acc uuid; v_cash_diff numeric;
begin
  select * into r from public.cash_registers where id = p_register for update;
  if r.status <> 'aberto' then raise exception 'Caixa já fechado'; end if;
  if r.operator_id <> auth.uid() and not public.has_perm('pos.manage') then raise exception 'Permissão negada' using errcode = '42501'; end if;
  v_sum := public.cash_register_summary(p_register);
  v_expected := (v_sum->'by_method') || jsonb_build_object('dinheiro', (v_sum->>'expected_cash')::numeric);
  for k in select jsonb_object_keys(v_expected || coalesce(p_counted,'{}'::jsonb)) loop
    v_e := coalesce((v_expected->>k)::numeric, 0); v_c := coalesce((p_counted->>k)::numeric, 0);
    v_diff := v_diff + (v_c - v_e);
  end loop;
  v_cash_diff := coalesce((p_counted->>'dinheiro')::numeric,0) - coalesce((v_expected->>'dinheiro')::numeric,0);
  if abs(v_cash_diff) >= 0.01 then
    insert into public.cash_movements(cash_register_id, movement_type, method_code, amount, description)
    values (p_register, 'quebra', 'dinheiro', v_cash_diff, case when v_cash_diff > 0 then 'Sobra de caixa' else 'Falta de caixa' end);
    select account_id into v_cash_acc from public.payment_methods where code = 'dinheiro';
    perform public._fin_tx(v_cash_acc, case when v_cash_diff > 0 then 'entrada' else 'saida' end, abs(v_cash_diff),
            'Diferença de caixa — ' || r.terminal_name,
            case when v_cash_diff > 0 then public.category_by_group('outras_receitas','receita') else public.category_by_group('outras_despesas') end,
            'quebra_caixa', p_register::text);
  end if;
  update public.cash_registers set status = 'fechado', closed_at = now(), closed_by = auth.uid(),
         expected = v_expected, counted = p_counted, difference_total = round(v_diff, 2), notes = p_notes
   where id = p_register;
  return jsonb_build_object('expected', v_expected, 'counted', p_counted, 'difference', round(v_diff,2));
end $$;

create or replace function public.review_cash_register(p_register uuid, p_notes text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_perm('pos.manage');
  update public.cash_registers set status = 'conferido', reviewed_by = auth.uid(), reviewed_at = now(), review_notes = p_notes
   where id = p_register and status = 'fechado';
  if not found then raise exception 'Somente caixas fechados podem ser conferidos'; end if;
end $$;

-- ---------------------------------------------------------------------
-- PDV
-- ---------------------------------------------------------------------
-- p = {"cash_register_id", "channel":"balcao|retirada|delivery", "customer_id", "customer_name", "customer_phone",
--      "items":[...], "discount_value": n, "discount_type":"valor|percentual", "authorizer_pin", "coupon_code",
--      "loyalty_points", "payments":[...], "notes", "delivery_address":{...}, "delivery_zone_id", "pay_later": bool}
create or replace function public.pos_checkout(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.cash_registers; s public.company_settings; u public.users; v_order uuid; v_sub numeric; v_disc numeric := 0;
        v_pct numeric; v_auth uuid; v_fee numeric := 0; z public.delivery_zones; v_res jsonb := '{}'::jsonb; o public.orders;
        v_channel text := coalesce(p->>'channel','balcao'); v_items_disc numeric;
begin
  perform public.require_perm('pos.operate');
  select * into s from public.company_settings where id = 1;
  select * into u from public.users where id = auth.uid();
  select * into r from public.cash_registers where id = (p->>'cash_register_id')::uuid;
  if not found or r.status <> 'aberto' then raise exception 'Abra o caixa antes de vender'; end if;
  if r.operator_id <> auth.uid() then raise exception 'Este caixa pertence a outro operador'; end if;

  if v_channel = 'delivery' then
    select * into z from public.delivery_zones where id = (p->>'delivery_zone_id')::uuid and is_active;
    if not found then raise exception 'Selecione o bairro de entrega'; end if;
    v_fee := coalesce((p->>'delivery_fee')::numeric, z.fee);
  end if;

  insert into public.orders(channel, origin, status, customer_id, customer_name, customer_phone, delivery_address, delivery_zone_id,
                            delivery_fee, notes, cash_register_id, payment_method_planned)
  values (v_channel, 'pdv', 'pendente', nullif(p->>'customer_id','')::uuid, nullif(p->>'customer_name',''),
          public.normalize_phone(p->>'customer_phone'), p->'delivery_address', z.id, v_fee, nullif(p->>'notes',''), r.id,
          (p->'payments'->0->>'method'))
  returning id into v_order;

  v_sub := public._build_order_items(v_order, p->'items', 'pdv');
  select coalesce(sum(discount),0) into v_items_disc from public.order_items where order_id = v_order;
  update public.orders set subtotal = v_sub, items_discount = v_items_disc where id = v_order;

  v_disc := coalesce((p->>'discount_value')::numeric, 0);
  if p->>'discount_type' = 'percentual' then v_disc := round(v_sub * v_disc / 100, 2); end if;
  if v_disc < 0 then raise exception 'Desconto inválido'; end if;
  v_pct := case when v_sub + v_items_disc > 0 then (v_disc + v_items_disc) / (v_sub + v_items_disc) * 100 else 0 end;
  if v_pct > greatest(u.max_discount_percent, s.pos_max_discount_without_auth) + 0.001 then
    v_auth := public.verify_authorizer(p->>'authorizer_pin', 'pos.discount');
    update public.orders set discount_authorized_by = v_auth where id = v_order;
    perform public.log_action('DISCOUNT_APPROVED', 'orders', v_order::text, null,
            jsonb_build_object('percent', round(v_pct,2), 'value', v_disc + v_items_disc), null, v_auth);
  end if;

  perform public._apply_order_discounts(v_order, p->>'coupon_code', coalesce((p->>'loyalty_points')::int,0), 'pdv', v_disc);
  perform public._order_stock(v_order, false);
  update public.orders set status = case when v_channel = 'balcao' and public._order_kitchen_status(v_order) = 'pronto' then 'entregue'
                                         else public._order_kitchen_status(v_order) end,
         accepted_at = now(),
         ready_at = case when public._order_kitchen_status(v_order) = 'pronto' then now() end,
         delivered_at = case when v_channel = 'balcao' and public._order_kitchen_status(v_order) = 'pronto' then now() end
   where id = v_order;
  if v_channel = 'delivery' then
    insert into public.deliveries(order_id, fee) values (v_order, v_fee);
  end if;

  if not coalesce((p->>'pay_later')::boolean, false) then
    v_res := public._register_sale(v_order, p->'payments', r.id);
  end if;
  select * into o from public.orders where id = v_order;
  return v_res || jsonb_build_object('order_id', o.id, 'number', o.number, 'total', o.total, 'status', o.status);
end $$;

-- Recebe pedido já existente (site/entregas) — acerto no caixa
create or replace function public.settle_order(p_order uuid, p_payments jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.cash_registers;
begin
  perform public.require_perm('pos.operate');
  select * into r from public.cash_registers where operator_id = auth.uid() and status = 'aberto';
  return public._register_sale(p_order, p_payments, r.id);
end $$;

-- Cancelamento autorizado (estorna venda, pagamentos, estoque, pontos e cupom)
create or replace function public.cancel_order(p_order uuid, p_reason text, p_authorizer_pin text default null) returns void
language plpgsql security definer set search_path = public as $$
declare o public.orders; s public.company_settings; sa public.sales; pay record; v_auth uuid; v_reg uuid; ar public.accounts_receivable;
begin
  select * into s from public.company_settings where id = 1;
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if o.status = 'cancelado' then raise exception 'Pedido já cancelado'; end if;
  if coalesce(length(trim(p_reason)),0) < 5 then raise exception 'Informe o motivo do cancelamento'; end if;

  if o.status = 'pendente' and o.payment_status = 'pendente' and public.has_perm('orders.manage') then
    v_auth := auth.uid();  -- recusar pedido ainda não aceito
  elsif public.has_perm('pos.cancel') and not s.pos_require_pin_for_cancel then
    v_auth := auth.uid();
  else
    v_auth := public.verify_authorizer(p_authorizer_pin, 'pos.cancel');
  end if;

  select * into sa from public.sales where order_id = p_order and status = 'concluida' for update;
  if found then
    select id into v_reg from public.cash_registers where id = sa.cash_register_id and status = 'aberto';
    if v_reg is null then select id into v_reg from public.cash_registers where operator_id = auth.uid() and status = 'aberto'; end if;
    for pay in select p.*, pm.method_type from public.payments p join public.payment_methods pm on pm.code = p.method_code
                where p.sale_id = sa.id and p.status = 'confirmado' loop
      if pay.transaction_id is not null then perform public._reverse_tx(pay.transaction_id, 'Cancelamento pedido #' || o.number); end if;
      if pay.receivable_id is not null then
        select * into ar from public.accounts_receivable where id = pay.receivable_id for update;
        if ar.received_amount > 0 then
          perform public._fin_tx(ar.account_id, 'saida', ar.received_amount, 'Estorno venda #' || o.number, ar.category_id, 'estorno', sa.id::text);
        end if;
        update public.accounts_receivable set status = 'cancelado' where id = ar.id;
      end if;
      if pay.method_type = 'dinheiro' then
        if v_reg is null then raise exception 'Abra um caixa para devolver o valor em dinheiro'; end if;
        insert into public.cash_movements(cash_register_id, movement_type, method_code, amount, description, sale_id, authorized_by)
        values (v_reg, 'cancelamento', 'dinheiro', -pay.amount, 'Cancelamento pedido #' || o.number, sa.id, v_auth);
      end if;
      update public.payments set status = 'estornado' where id = pay.id;
    end loop;
    update public.sales set status = 'cancelada', cancelled_at = now(), cancelled_by = auth.uid(),
           cancel_authorized_by = v_auth, cancel_reason = p_reason where id = sa.id;
    if o.customer_id is not null then
      update public.customers set orders_count = greatest(orders_count - 1, 0), total_spent = greatest(total_spent - sa.total, 0)
       where id = o.customer_id;
      insert into public.loyalty_transactions(customer_id, points, tx_type, order_id, notes)
      select o.customer_id, -sum(points), 'estorno', o.id, 'Cancelamento #' || o.number
        from public.loyalty_transactions where order_id = o.id and tx_type = 'acumulo'
      having coalesce(sum(points),0) > 0;
    end if;
    if o.coupon_id is not null then
      update public.coupons set uses_count = greatest(uses_count - 1, 0) where id = o.coupon_id;
      delete from public.coupon_redemptions where order_id = o.id;
    end if;
  end if;
  -- devolve pontos resgatados
  if o.loyalty_points_used > 0 then
    insert into public.loyalty_transactions(customer_id, points, tx_type, order_id, notes)
    values (o.customer_id, o.loyalty_points_used, 'estorno', o.id, 'Devolução de resgate #' || o.number);
  end if;
  if o.stock_deducted then perform public._order_stock(p_order, true); end if;
  update public.orders set status = 'cancelado', cancelled_at = now(), cancelled_by = auth.uid(), cancel_authorized_by = v_auth,
         cancel_reason = p_reason, payment_status = case when payment_status = 'pago' then 'estornado' else payment_status end
   where id = p_order;
  update public.deliveries set status = 'cancelada' where order_id = p_order;
  perform public.log_action('ORDER_CANCEL', 'orders', p_order::text, to_jsonb(o), null, p_reason, v_auth);
end $$;

-- ---------------------------------------------------------------------
-- SITE PÚBLICO
-- ---------------------------------------------------------------------
create or replace function public.public_menu() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'company', public.public_company_info(),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug,
        'description', c.description, 'image_url', c.image_url) order by c.sort_order, c.name)
        from public.categories c where c.is_active and c.show_online
          and exists (select 1 from public.products p where p.category_id = c.id and p.is_active and p.available_online)), '[]'),
    'products', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'category_id', p.category_id, 'name', p.name, 'description', p.description, 'image_url', p.image_url,
        'price', (public.effective_price(p.id, 'site')->>'price')::numeric, 'list_price', p.price,
        'promotion', public.effective_price(p.id, 'site')->>'promotion',
        'product_type', p.product_type, 'unit', p.unit, 'serves', p.serves, 'tags', p.tags,
        'is_featured', p.is_featured, 'is_popular', p.is_popular, 'sold_out', p.sold_out, 'prep_time_minutes', p.prep_time_minutes,
        'combo_items', (select coalesce(jsonb_agg(jsonb_build_object('name', cp.name, 'quantity', ci.quantity)), '[]')
                          from public.combo_items ci join public.products cp on cp.id = ci.product_id where ci.combo_product_id = p.id),
        'option_groups', (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'min_select', g.min_select,
              'max_select', g.max_select, 'options', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name,
              'price_delta', o.price_delta) order by o.sort_order, o.name), '[]') from public.product_options o where o.group_id = g.id and o.is_active))
              order by g.sort_order), '[]') from public.product_option_groups g where g.product_id = p.id)
      ) order by p.sort_order, p.name)
      from public.products p join public.categories c on c.id = p.category_id
     where p.is_active and p.available_online and c.is_active and c.show_online), '[]'),
    'banners', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'title', b.title, 'subtitle', b.subtitle,
        'image_url', b.image_url, 'link_url', b.link_url, 'product_id', b.product_id, 'category_id', b.category_id) order by b.sort_order)
      from public.banners b where b.is_active and (b.starts_at is null or b.starts_at <= now()) and (b.ends_at is null or b.ends_at > now())), '[]'),
    'delivery_zones', coalesce((select jsonb_agg(jsonb_build_object('id', z.id, 'district', z.district, 'city', z.city, 'fee', z.fee,
        'min_order_value', z.min_order_value, 'free_delivery_above', z.free_delivery_above, 'estimated_minutes', z.estimated_minutes)
        order by z.district) from public.delivery_zones z where z.is_active), '[]'),
    'payment_methods', coalesce((select jsonb_agg(jsonb_build_object('code', m.code, 'name', m.name, 'method_type', m.method_type,
        'allows_change', m.allows_change) order by m.sort_order)
      from public.payment_methods m where m.is_active and m.available_online and m.method_type <> 'credito_interno'), '[]')
  )
$$;

-- Prévia de valores do carrinho (sem gravar)
create or replace function public.public_quote(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_sub numeric := 0; it jsonb; v_price numeric; z public.delivery_zones; v_fee numeric := 0; v_c jsonb; v_disc numeric := 0; v_cust uuid;
begin
  for it in select * from jsonb_array_elements(coalesce(p->'items','[]')) loop
    v_price := (public.effective_price((it->>'product_id')::uuid, 'site')->>'price')::numeric
      + coalesce((select sum(o.price_delta) from public.product_options o
                   where o.id in (select x::uuid from jsonb_array_elements_text(coalesce(it->'option_ids','[]')) x)), 0);
    v_sub := v_sub + round(coalesce(v_price,0) * coalesce((it->>'quantity')::numeric,1), 2);
  end loop;
  if p->>'fulfillment' = 'delivery' and p->>'delivery_zone_id' is not null then
    select * into z from public.delivery_zones where id = (p->>'delivery_zone_id')::uuid and is_active;
    v_fee := case when z.free_delivery_above is not null and v_sub >= z.free_delivery_above then 0 else coalesce(z.fee,0) end;
  end if;
  if nullif(trim(p->>'coupon_code'),'') is not null then
    select id into v_cust from public.customers where phone = public.normalize_phone(p->>'phone');
    v_c := public.validate_coupon(p->>'coupon_code', v_sub, v_cust, 'site', v_fee);
    if (v_c->>'valid')::boolean then v_disc := (v_c->>'discount')::numeric; end if;
  end if;
  return jsonb_build_object('subtotal', v_sub, 'delivery_fee', v_fee, 'discount', v_disc, 'total', greatest(v_sub + v_fee - v_disc, 0),
                            'coupon', v_c, 'min_order_value', greatest(coalesce(z.min_order_value,0),
                            (select min_order_value from public.company_settings where id = 1)));
end $$;

-- Pedido feito pelo cliente no site (anon). Tudo recalculado no servidor.
create or replace function public.place_public_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.company_settings; v_phone text := public.normalize_phone(p->'customer'->>'phone');
        v_name text := trim(p->'customer'->>'name'); v_cust uuid; z public.delivery_zones; v_order uuid; v_sub numeric;
        v_fee numeric := 0; v_sched timestamptz := nullif(p->>'scheduled_for','')::timestamptz; o public.orders;
        v_ful text := p->>'fulfillment'; v_addr jsonb := p->'address'; v_pm public.payment_methods; v_recent int;
begin
  select * into s from public.company_settings where id = 1;
  if not s.online_ordering_enabled then raise exception 'Pedidos online estão temporariamente desativados'; end if;
  if v_name is null or length(v_name) < 2 then raise exception 'Informe seu nome'; end if;
  if v_phone is null or length(v_phone) not between 10 and 11 then raise exception 'Informe um telefone válido com DDD'; end if;
  if not coalesce((p->'consents'->>'privacy')::boolean, false) then
    raise exception 'É necessário aceitar a política de privacidade';
  end if;
  if v_ful not in ('delivery','retirada') then raise exception 'Escolha entrega ou retirada'; end if;
  if v_ful = 'delivery' and not s.delivery_enabled then raise exception 'Entrega indisponível no momento'; end if;
  if v_ful = 'retirada' and not s.pickup_enabled then raise exception 'Retirada indisponível no momento'; end if;

  if v_sched is not null then
    if not s.scheduling_enabled then raise exception 'Agendamento indisponível'; end if;
    if v_sched < now() + interval '30 minutes' then raise exception 'Agende com pelo menos 30 minutos de antecedência'; end if;
    if v_sched > now() + make_interval(days => s.scheduling_max_days) then raise exception 'Agendamento além do limite permitido'; end if;
    if not public.store_is_open(v_sched) then raise exception 'Estamos fechados no horário agendado'; end if;
  elsif not public.store_is_open(now()) then
    raise exception 'Estamos fechados agora. Você pode agendar seu pedido.';
  end if;

  -- anti-abuso: no máximo 5 pedidos por telefone por hora
  select count(*) into v_recent from public.orders where customer_phone = v_phone and created_at > now() - interval '1 hour';
  if v_recent >= 5 then raise exception 'Muitos pedidos em sequência. Fale conosco pelo telefone.'; end if;

  select * into v_pm from public.payment_methods where code = p->>'payment_method' and is_active and available_online
     and method_type <> 'credito_interno';
  if not found then raise exception 'Forma de pagamento inválida'; end if;

  -- cliente (upsert por telefone)
  select id into v_cust from public.customers where phone = v_phone;
  if v_cust is null then
    insert into public.customers(name, phone, source) values (v_name, v_phone, 'site') returning id into v_cust;
  elsif exists (select 1 from public.customers where id = v_cust and is_blocked) then
    raise exception 'Não foi possível concluir o pedido. Entre em contato conosco.';
  end if;
  insert into public.customer_consents(customer_id, consent_type, granted, source, policy_version, ip)
  values (v_cust, 'termos_privacidade', true, 'site', to_char(s.updated_at, 'YYYYMMDD'), public.request_header('x-forwarded-for'));
  if p->'consents' ? 'marketing' then
    insert into public.customer_consents(customer_id, consent_type, granted, source, ip)
    values (v_cust, 'marketing_whatsapp', coalesce((p->'consents'->>'marketing')::boolean, false), 'site', public.request_header('x-forwarded-for'));
  end if;

  if v_ful = 'delivery' then
    select * into z from public.delivery_zones where id = (p->>'delivery_zone_id')::uuid and is_active;
    if not found then raise exception 'Infelizmente não entregamos neste bairro'; end if;
    if coalesce(trim(v_addr->>'street'),'') = '' then raise exception 'Informe o endereço de entrega'; end if;
    v_addr := v_addr || jsonb_build_object('district', z.district, 'city', z.city);
    if not exists (select 1 from public.customer_addresses where customer_id = v_cust
                   and lower(street) = lower(v_addr->>'street') and coalesce(number,'') = coalesce(v_addr->>'number','')) then
      insert into public.customer_addresses(customer_id, street, number, complement, district, city, reference, delivery_zone_id, is_default)
      values (v_cust, v_addr->>'street', v_addr->>'number', v_addr->>'complement', z.district, z.city, v_addr->>'reference', z.id,
              not exists (select 1 from public.customer_addresses where customer_id = v_cust));
    end if;
  end if;

  insert into public.orders(channel, origin, status, customer_id, customer_name, customer_phone, delivery_address, delivery_zone_id,
                            scheduled_for, payment_method_planned, change_for, notes, created_by)
  values (v_ful, 'site', 'pendente', v_cust, v_name, v_phone, case when v_ful = 'delivery' then v_addr end, z.id, v_sched,
          v_pm.code, case when v_pm.allows_change then nullif(p->>'change_for','')::numeric end, nullif(left(trim(p->>'notes'),500),''), null)
  returning id into v_order;

  v_sub := public._build_order_items(v_order, p->'items', 'site');
  if v_ful = 'delivery' then
    v_fee := case when z.free_delivery_above is not null and v_sub >= z.free_delivery_above then 0 else z.fee end;
    if v_sub < z.min_order_value then raise exception 'Pedido mínimo para este bairro: R$ %', z.min_order_value; end if;
  end if;
  if v_sub < s.min_order_value then raise exception 'Pedido mínimo: R$ %', s.min_order_value; end if;
  update public.orders set subtotal = v_sub, delivery_fee = v_fee where id = v_order;
  perform public._apply_order_discounts(v_order, p->>'coupon_code', coalesce((p->>'loyalty_points')::int, 0), 'site', 0);
  select * into o from public.orders where id = v_order;
  if o.change_for is not null and o.change_for < o.total then raise exception 'O troco deve ser para um valor maior que o total'; end if;
  if v_ful = 'delivery' then insert into public.deliveries(order_id, fee) values (v_order, v_fee); end if;

  return jsonb_build_object('order_id', o.id, 'number', o.number, 'tracking_code', o.tracking_code, 'total', o.total,
                            'subtotal', o.subtotal, 'delivery_fee', o.delivery_fee, 'discount', o.discount);
end $$;

create or replace function public.public_order_status(p_tracking text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'number', o.number, 'status', o.status, 'channel', o.channel, 'created_at', o.created_at, 'scheduled_for', o.scheduled_for,
    'subtotal', o.subtotal, 'delivery_fee', o.delivery_fee, 'discount', o.discount, 'total', o.total,
    'payment_method', (select name from public.payment_methods where code = o.payment_method_planned),
    'change_for', o.change_for, 'customer_name', split_part(o.customer_name, ' ', 1),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('name', i.product_name, 'quantity', i.quantity, 'total', i.total,
               'options', i.options, 'notes', i.notes)), '[]') from public.order_items i where i.order_id = o.id),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('status', h.to_status, 'at', h.changed_at) order by h.changed_at), '[]')
                  from public.order_status_history h where h.order_id = o.id),
    'estimated_minutes', coalesce((select estimated_minutes from public.delivery_zones where id = o.delivery_zone_id), 0)
                         + (select avg_prep_minutes from public.company_settings where id = 1)
  ) from public.orders o where o.tracking_code = upper(trim(p_tracking))
$$;

-- ---------------------------------------------------------------------
-- FLUXO DO PEDIDO / COZINHA
-- ---------------------------------------------------------------------
create or replace function public.accept_order(p_order uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o public.orders; v_k text;
begin
  perform public.require_perm('orders.manage');
  select * into o from public.orders where id = p_order for update;
  if o.status <> 'pendente' then raise exception 'Pedido não está pendente'; end if;
  if not o.stock_deducted then perform public._order_stock(p_order, false); end if;
  v_k := public._order_kitchen_status(p_order);
  update public.orders set status = v_k, accepted_at = now(), ready_at = case when v_k = 'pronto' then now() end where id = p_order;
end $$;

create or replace function public.kitchen_set_item_status(p_item uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare it public.order_items; o public.orders; v_all boolean; v_any boolean;
begin
  perform public.require_perm('kitchen.operate');
  if p_status not in ('pendente','preparando','pronto') then raise exception 'Status inválido'; end if;
  select * into it from public.order_items where id = p_item for update;
  select * into o from public.orders where id = it.order_id for update;
  if o.status not in ('novo','em_preparo','aguardando_finalizacao') then raise exception 'Pedido não está em produção'; end if;
  update public.order_items set kitchen_status = p_status,
         started_at = case when p_status in ('preparando','pronto') then coalesce(started_at, now()) else null end,
         prepared_at = case when p_status = 'pronto' then now() else null end,
         prepared_by = case when p_status = 'pronto' then auth.uid() else null end
   where id = p_item;
  select bool_and(kitchen_status = 'pronto'), bool_or(kitchen_status in ('preparando','pronto'))
    into v_all, v_any from public.order_items where order_id = o.id and send_to_kitchen;
  update public.orders set
    status = case when v_all then 'aguardando_finalizacao' when v_any then 'em_preparo' else 'novo' end,
    preparing_at = coalesce(preparing_at, case when v_any then now() end)
  where id = o.id;
end $$;

create or replace function public.order_set_status(p_order uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare o public.orders; v_ok boolean;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'Pedido não encontrado'; end if;
  if p_status in ('em_preparo','aguardando_finalizacao','pronto') then perform public.require_perm('kitchen.operate');
  else perform public.require_perm('orders.manage'); end if;
  v_ok := case o.status
    when 'novo' then p_status in ('em_preparo','pronto')
    when 'em_preparo' then p_status in ('aguardando_finalizacao','pronto','novo')
    when 'aguardando_finalizacao' then p_status in ('pronto','em_preparo')
    when 'pronto' then (p_status = 'saiu_entrega' and o.channel = 'delivery') or (p_status = 'entregue' and o.channel <> 'delivery')
    when 'saiu_entrega' then p_status = 'entregue'
    else false end;
  if not v_ok then raise exception 'Transição de status inválida: % → %', o.status, p_status; end if;
  if p_status = 'pronto' then
    update public.order_items set kitchen_status = 'pronto', prepared_at = coalesce(prepared_at, now()),
           started_at = coalesce(started_at, now()) where order_id = p_order;
  end if;
  update public.orders set status = p_status,
    preparing_at = case when p_status = 'em_preparo' then coalesce(preparing_at, now()) else preparing_at end,
    ready_at = case when p_status = 'pronto' then now() else ready_at end,
    dispatched_at = case when p_status = 'saiu_entrega' then now() else dispatched_at end,
    delivered_at = case when p_status = 'entregue' then now() else delivered_at end
  where id = p_order;
  if p_status = 'entregue' then update public.order_items set kitchen_status = 'entregue' where order_id = p_order; end if;
end $$;

-- ---------------------------------------------------------------------
-- DELIVERY
-- ---------------------------------------------------------------------
create or replace function public.assign_delivery(p_order uuid, p_driver uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_perm('delivery.manage');
  if not exists (select 1 from public.delivery_drivers where id = p_driver and is_active) then raise exception 'Entregador inválido'; end if;
  update public.deliveries set driver_id = p_driver, status = 'atribuida', assigned_at = now()
   where order_id = p_order and status in ('aguardando','atribuida','falhou');
  if not found then raise exception 'Entrega não encontrada ou já em rota'; end if;
end $$;

create or replace function public.dispatch_delivery(p_order uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d public.deliveries;
begin
  if not (public.has_perm('delivery.manage') or public.has_perm('delivery.driver')) then raise exception 'Permissão negada' using errcode='42501'; end if;
  select * into d from public.deliveries where order_id = p_order for update;
  if d.driver_id is null then raise exception 'Atribua um entregador'; end if;
  if not public.has_perm('delivery.manage') and not exists (select 1 from public.delivery_drivers where id = d.driver_id and user_id = auth.uid()) then
    raise exception 'Entrega de outro entregador' using errcode='42501';
  end if;
  if not exists (select 1 from public.orders where id = p_order and status = 'pronto') then raise exception 'Pedido ainda não está pronto'; end if;
  update public.deliveries set status = 'em_rota', dispatched_at = now() where id = d.id;
  update public.delivery_drivers set availability = 'em_entrega' where id = d.driver_id;
  update public.orders set status = 'saiu_entrega', dispatched_at = now() where id = p_order;
end $$;

create or replace function public.finish_delivery(p_order uuid, p_success boolean, p_notes text default null) returns void
language plpgsql security definer set search_path = public as $$
declare d public.deliveries;
begin
  if not (public.has_perm('delivery.manage') or public.has_perm('delivery.driver')) then raise exception 'Permissão negada' using errcode='42501'; end if;
  select * into d from public.deliveries where order_id = p_order for update;
  if d.status <> 'em_rota' then raise exception 'Entrega não está em rota'; end if;
  if not public.has_perm('delivery.manage') and not exists (select 1 from public.delivery_drivers where id = d.driver_id and user_id = auth.uid()) then
    raise exception 'Entrega de outro entregador' using errcode='42501';
  end if;
  update public.deliveries set status = case when p_success then 'entregue' else 'falhou' end,
         delivered_at = case when p_success then now() end, notes = p_notes where id = d.id;
  if p_success then
    update public.orders set status = 'entregue', delivered_at = now() where id = p_order;
    update public.order_items set kitchen_status = 'entregue' where order_id = p_order;
  else
    update public.orders set status = 'pronto' where id = p_order;
  end if;
  update public.delivery_drivers set availability = 'disponivel' where id = d.driver_id
     and not exists (select 1 from public.deliveries where driver_id = d.driver_id and status = 'em_rota');
end $$;
