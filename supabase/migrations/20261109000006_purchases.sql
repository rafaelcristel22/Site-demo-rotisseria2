-- =====================================================================
-- 0006 COMPRAS — solicitações, cotações, pedidos de compra,
-- recebimento/conferência e histórico de preços.
-- =====================================================================
create table public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  requested_by uuid default auth.uid(),
  department_id uuid references public.departments(id),
  needed_by date,
  status text not null default 'aberta' check (status in ('aberta','em_cotacao','aprovada','rejeitada','atendida','cancelada')),
  notes text,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.purchase_request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.purchase_requests(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id),
  quantity numeric(14,3) not null check (quantity > 0),
  notes text
);

create table public.purchase_quotations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.purchase_requests(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id),
  quoted_on date not null default current_date,
  valid_until date,
  delivery_days int,
  payment_terms text,
  freight numeric(12,2) not null default 0,
  status text not null default 'recebida' check (status in ('solicitada','recebida','escolhida','descartada')),
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create table public.purchase_quotation_items (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.purchase_quotations(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,4) not null check (unit_price >= 0)
);

-- purchases = pedido de compra
create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  supplier_id uuid not null references public.suppliers(id),
  request_id uuid references public.purchase_requests(id),
  quotation_id uuid references public.purchase_quotations(id),
  status text not null default 'rascunho' check (status in ('rascunho','enviado','recebido_parcial','recebido','cancelado')),
  order_date date not null default current_date,
  expected_date date,
  invoice_number text,
  freight numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  total numeric(14,2) not null default 0,
  location_id uuid references public.stock_locations(id),
  notes text,
  created_by uuid default auth.uid(),
  received_by uuid,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index purchases_supplier_idx on public.purchases(supplier_id, order_date);
create trigger purchases_updated before update on public.purchases
  for each row execute function public.tg_set_updated_at();
create trigger audit_purchases after insert or update or delete on public.purchases
  for each row execute function public.tg_audit_row();
alter table public.accounts_payable add constraint ap_purchase_fk foreign key (purchase_id) references public.purchases(id);

create table public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,4) not null check (unit_price >= 0),
  received_quantity numeric(14,3) not null default 0,
  total numeric(14,2) generated always as (round(quantity * unit_price, 2)) stored
);
create index purchase_items_purchase_idx on public.purchase_items(purchase_id);
alter table public.inventory_lots add constraint lots_purchase_item_fk foreign key (purchase_item_id) references public.purchase_items(id);

create table public.receiving_checks (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id),
  checked_by uuid default auth.uid(),
  checked_at timestamptz not null default now(),
  temperature_ok boolean,
  packaging_ok boolean,
  invoice_matches boolean,
  divergences jsonb not null default '[]'::jsonb,
  notes text
);

create table public.ingredient_price_history (
  id bigint generated always as identity primary key,
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  supplier_id uuid references public.suppliers(id),
  unit_price numeric(14,4) not null,
  source text not null check (source in ('compra','cotacao')),
  reference_id uuid,
  recorded_on date not null default current_date
);
create index iph_idx on public.ingredient_price_history(ingredient_id, recorded_on);

create or replace function public.tg_quote_price_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.ingredient_price_history(ingredient_id, supplier_id, unit_price, source, reference_id, recorded_on)
  select new.ingredient_id, q.supplier_id, new.unit_price, 'cotacao', q.id, q.quoted_on
    from public.purchase_quotations q where q.id = new.quotation_id;
  return new;
end $$;
create trigger quote_items_price_history after insert on public.purchase_quotation_items
  for each row execute function public.tg_quote_price_history();

create or replace function public.purchase_recalc_total(p_purchase uuid) returns numeric
language sql security definer set search_path = public as $$
  update public.purchases p set total = coalesce((select sum(total) from public.purchase_items where purchase_id = p.id), 0)
         + p.freight - p.discount
   where p.id = p_purchase returning total
$$;
create or replace function public.tg_purchase_items_total() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.purchase_recalc_total(coalesce(new.purchase_id, old.purchase_id));
  return null;
end $$;
create trigger purchase_items_total after insert or update or delete on public.purchase_items
  for each row execute function public.tg_purchase_items_total();

-- Comparação de cotações: menor preço por item
create or replace function public.compare_quotations(p_request uuid) returns table(
  ingredient_id uuid, ingredient_name text, quantity numeric, supplier_id uuid, supplier_name text,
  unit_price numeric, total numeric, is_best boolean, savings_vs_worst numeric
) language sql stable security definer set search_path = public as $$
  with q as (
    select qi.ingredient_id, i.name ingredient_name, qi.quantity, s.id supplier_id, s.name supplier_name, qi.unit_price,
           round(qi.quantity * qi.unit_price, 2) total,
           min(qi.unit_price) over (partition by qi.ingredient_id) best,
           max(qi.unit_price) over (partition by qi.ingredient_id) worst
      from public.purchase_quotations pq
      join public.purchase_quotation_items qi on qi.quotation_id = pq.id
      join public.suppliers s on s.id = pq.supplier_id
      join public.ingredients i on i.id = qi.ingredient_id
     where pq.request_id = p_request and pq.status <> 'descartada' and public.has_perm('purchases.view')
  )
  select ingredient_id, ingredient_name, quantity, supplier_id, supplier_name, unit_price, total,
         unit_price = best, round((worst - unit_price) * quantity, 2)
    from q order by ingredient_name, unit_price
$$;

-- Gera pedidos de compra (um por fornecedor) a partir dos melhores preços
create or replace function public.purchase_from_best_quotes(p_request uuid) returns int
language plpgsql security definer set search_path = public as $$
declare r record; v_po uuid; v_n int := 0; v_sup uuid := null;
begin
  perform public.require_perm('purchases.manage');
  for r in select distinct on (c.ingredient_id) c.* from public.compare_quotations(p_request) c
            where c.is_best order by c.ingredient_id, c.unit_price loop
    select id into v_po from public.purchases where request_id = p_request and supplier_id = r.supplier_id and status = 'rascunho';
    if v_po is null then
      insert into public.purchases(supplier_id, request_id, location_id) values (r.supplier_id, p_request, public.default_location_id())
      returning id into v_po; v_n := v_n + 1;
    end if;
    insert into public.purchase_items(purchase_id, ingredient_id, quantity, unit_price) values (v_po, r.ingredient_id, r.quantity, r.unit_price);
    v_po := null;
  end loop;
  update public.purchase_requests set status = 'aprovada', approved_by = auth.uid(), approved_at = now() where id = p_request;
  update public.purchase_quotations set status = 'escolhida' where request_id = p_request
     and supplier_id in (select supplier_id from public.purchases where request_id = p_request);
  return v_n;
end $$;

-- Recebimento: atualiza estoque, custo médio, lotes, preços e gera contas a pagar
-- p_items = [{"item_id": uuid, "received_quantity": n, "unit_price": n?, "lot_code": "", "expiry_date": "YYYY-MM-DD"}]
create or replace function public.receive_purchase(
  p_purchase uuid, p_items jsonb, p_invoice text default null,
  p_create_payable boolean default true, p_due_date date default null, p_installments int default 1,
  p_check jsonb default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.purchases; it jsonb; pi public.purchase_items; v_qty numeric; v_price numeric;
        v_total numeric := 0; v_all boolean; v_cat uuid; v_supplier text;
begin
  perform public.require_perm('purchases.manage');
  select * into p from public.purchases where id = p_purchase for update;
  if not found then raise exception 'Pedido de compra não encontrado'; end if;
  if p.status in ('recebido','cancelado') then raise exception 'Pedido já %', p.status; end if;

  for it in select * from jsonb_array_elements(p_items) loop
    select * into pi from public.purchase_items where id = (it->>'item_id')::uuid and purchase_id = p_purchase for update;
    if not found then raise exception 'Item inválido no recebimento'; end if;
    v_qty := coalesce((it->>'received_quantity')::numeric, 0);
    if v_qty < 0 then raise exception 'Quantidade recebida inválida'; end if;
    continue when v_qty = 0;
    v_price := coalesce((it->>'unit_price')::numeric, pi.unit_price);
    perform public._inventory_apply(pi.ingredient_id, coalesce(p.location_id, public.default_location_id()), v_qty, 'entrada',
            v_price, 'compra', p_purchase::text, 'Recebimento pedido #' || p.number,
            nullif(it->>'lot_code',''), nullif(it->>'expiry_date','')::date, false, null, pi.id);
    update public.purchase_items set received_quantity = received_quantity + v_qty, unit_price = v_price where id = pi.id;
    insert into public.ingredient_price_history(ingredient_id, supplier_id, unit_price, source, reference_id)
    values (pi.ingredient_id, p.supplier_id, v_price, 'compra', p_purchase);
    v_total := v_total + round(v_qty * v_price, 2);
  end loop;

  select bool_and(received_quantity >= quantity) into v_all from public.purchase_items where purchase_id = p_purchase;
  update public.purchases set status = case when v_all then 'recebido' else 'recebido_parcial' end,
         invoice_number = coalesce(p_invoice, invoice_number), received_by = auth.uid(), received_at = now()
   where id = p_purchase;

  if p_check is not null then
    insert into public.receiving_checks(purchase_id, temperature_ok, packaging_ok, invoice_matches, divergences, notes)
    values (p_purchase, (p_check->>'temperature_ok')::boolean, (p_check->>'packaging_ok')::boolean,
            (p_check->>'invoice_matches')::boolean, coalesce(p_check->'divergences','[]'::jsonb), p_check->>'notes');
  end if;

  if p_create_payable and v_total > 0 then
    select name into v_supplier from public.suppliers where id = p.supplier_id;
    v_cat := public.category_by_group('cmv');
    -- frete/desconto aplicados no primeiro recebimento
    if not exists (select 1 from public.accounts_payable where purchase_id = p_purchase) then
      v_total := v_total + p.freight - p.discount;
    end if;
    perform public.create_payable('Compra #' || p.number || ' — ' || v_supplier, v_total,
            coalesce(p_due_date, current_date + 28), v_cat, p.supplier_id, 'fornecedor', greatest(p_installments,1),
            coalesce(p_invoice, p.invoice_number), current_date, 'nenhuma', null, p_purchase);
  end if;
  return jsonb_build_object('received_total', v_total, 'complete', v_all);
end $$;

-- Sugestão de reposição: abaixo do mínimo, considerando consumo médio dos últimos 30 dias
create or replace function public.restock_suggestions(p_days_coverage int default 7) returns table(
  ingredient_id uuid, name text, unit text, quantity numeric, min_stock numeric, avg_daily_use numeric,
  days_left numeric, suggested_quantity numeric, last_cost numeric, supplier_id uuid, supplier_name text
) language sql stable security definer set search_path = public as $$
  with use30 as (
    select m.ingredient_id, -sum(m.quantity) / 30.0 as daily
      from public.inventory_movements m
     where m.created_at > now() - interval '30 days' and m.movement_type in ('consumo_venda','saida','perda','producao')
       and m.quantity < 0
     group by m.ingredient_id
  )
  select s.ingredient_id, s.name, s.unit, s.quantity, s.min_stock, round(coalesce(u.daily,0), 3),
         case when coalesce(u.daily,0) > 0 then round(s.quantity / u.daily, 1) end,
         greatest(round(greatest(s.min_stock, coalesce(u.daily,0) * p_days_coverage) - s.quantity + coalesce(u.daily,0) * p_days_coverage, 3), 0),
         s.last_cost, i.default_supplier_id, sup.name
    from public.v_stock_levels s
    join public.ingredients i on i.id = s.ingredient_id
    left join use30 u on u.ingredient_id = s.ingredient_id
    left join public.suppliers sup on sup.id = i.default_supplier_id
   where public.has_perm('inventory.view') and s.is_active
     and (s.quantity <= s.min_stock or (u.daily > 0 and s.quantity / u.daily < p_days_coverage))
   order by case when u.daily > 0 then s.quantity / u.daily end nulls last
$$;
