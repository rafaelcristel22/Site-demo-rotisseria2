-- =====================================================================
-- 0004 CATÁLOGO, ESTOQUE E FICHA TÉCNICA
-- =====================================================================
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  description text,
  image_url text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  show_online boolean not null default true,
  kitchen_station text default 'cozinha',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger categories_updated before update on public.categories
  for each row execute function public.tg_set_updated_at();

create table public.stock_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index stock_locations_one_default on public.stock_locations(is_default) where is_default;

create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sku text unique,
  barcode text,
  ingredient_type text not null default 'ingrediente' check (ingredient_type in
    ('ingrediente','carne','frango','massa','tempero','bebida','embalagem','revenda','limpeza','hortifruti','laticinio','outro')),
  unit text not null default 'kg' check (unit in ('kg','g','l','ml','un','cx','pct','dz')),
  min_stock numeric(14,3) not null default 0,
  max_stock numeric(14,3),
  avg_cost numeric(14,4) not null default 0,
  last_cost numeric(14,4) not null default 0,
  default_supplier_id uuid,
  shelf_life_days int,
  track_lots boolean not null default false,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger ingredients_updated before update on public.ingredients
  for each row execute function public.tg_set_updated_at();
create trigger audit_ingredients after insert or update or delete on public.ingredients
  for each row execute function public.tg_audit_row();

create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id),
  sku text unique,
  barcode text unique,
  name text not null,
  description text,
  image_url text,
  price numeric(12,2) not null check (price >= 0),
  promotional_price numeric(12,2) check (promotional_price is null or promotional_price >= 0),
  product_type text not null default 'preparado' check (product_type in ('preparado','revenda','combo','servico')),
  unit text not null default 'un' check (unit in ('un','kg','porcao','litro')),
  stock_item_id uuid references public.ingredients(id),     -- para revenda: item de estoque baixado 1:1
  stock_item_qty numeric(14,4) not null default 1,
  prep_time_minutes int not null default 15,
  send_to_kitchen boolean not null default true,
  is_active boolean not null default true,
  available_pos boolean not null default true,
  available_online boolean not null default true,
  sold_out boolean not null default false,
  is_featured boolean not null default false,
  is_popular boolean not null default false,
  tags text[] not null default '{}',
  sort_order int not null default 0,
  serves int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_category_idx on public.products(category_id);
create index products_name_trgm_idx on public.products using btree (lower(name));
create trigger products_updated before update on public.products
  for each row execute function public.tg_set_updated_at();
create trigger audit_products after insert or update or delete on public.products
  for each row execute function public.tg_audit_row();

create table public.product_price_history (
  id bigint generated always as identity primary key,
  product_id uuid not null references public.products(id) on delete cascade,
  old_price numeric(12,2),
  new_price numeric(12,2) not null,
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now()
);
create or replace function public.tg_product_price_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.price is distinct from old.price then
    insert into public.product_price_history(product_id, old_price, new_price)
    values (new.id, case when tg_op = 'UPDATE' then old.price end, new.price);
  end if;
  return new;
end $$;
create trigger products_price_history after insert or update of price on public.products
  for each row execute function public.tg_product_price_history();

create table public.product_option_groups (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null,
  min_select int not null default 0,
  max_select int not null default 1,
  sort_order int not null default 0,
  check (max_select >= min_select and max_select >= 1)
);
create table public.product_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.product_option_groups(id) on delete cascade,
  name text not null,
  price_delta numeric(12,2) not null default 0,
  stock_item_id uuid references public.ingredients(id),
  stock_qty numeric(14,4) not null default 0,
  is_active boolean not null default true,
  sort_order int not null default 0
);
create index product_options_group_idx on public.product_options(group_id);

create table public.combo_items (
  id uuid primary key default gen_random_uuid(),
  combo_product_id uuid not null references public.products(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity numeric(10,3) not null default 1 check (quantity > 0),
  check (combo_product_id <> product_id)
);

-- Ficha técnica
create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid unique references public.products(id) on delete cascade,
  name text not null,
  yield_quantity numeric(12,3) not null default 1 check (yield_quantity > 0), -- porções produzidas por receita
  loss_percent numeric(5,2) not null default 0 check (loss_percent >= 0 and loss_percent < 100),
  prep_time_minutes int,
  instructions text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger recipes_updated before update on public.recipes
  for each row execute function public.tg_set_updated_at();
create trigger audit_recipes after insert or update or delete on public.recipes
  for each row execute function public.tg_audit_row();

create table public.recipe_items (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id),
  quantity numeric(14,4) not null check (quantity > 0),     -- na unidade do ingrediente, por receita inteira
  notes text,
  unique (recipe_id, ingredient_id)
);
create trigger audit_recipe_items after insert or update or delete on public.recipe_items
  for each row execute function public.tg_audit_row();

-- Estoque
create table public.inventory (
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  location_id uuid not null references public.stock_locations(id),
  quantity numeric(14,3) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (ingredient_id, location_id)
);

create table public.inventory_lots (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  location_id uuid not null references public.stock_locations(id),
  lot_code text,
  expiry_date date,
  quantity numeric(14,3) not null default 0,
  initial_quantity numeric(14,3) not null default 0,
  unit_cost numeric(14,4) not null default 0,
  received_at timestamptz not null default now(),
  purchase_item_id uuid
);
create index inventory_lots_fefo_idx on public.inventory_lots(ingredient_id, location_id, expiry_date nulls last, received_at);

create table public.inventory_movements (
  id bigint generated always as identity primary key,
  ingredient_id uuid not null references public.ingredients(id),
  location_id uuid not null references public.stock_locations(id),
  movement_type text not null check (movement_type in
    ('entrada','saida','ajuste','perda','transferencia_saida','transferencia_entrada','inventario','consumo_venda','estorno_venda','producao')),
  quantity numeric(14,3) not null,               -- com sinal
  unit_cost numeric(14,4) not null default 0,
  total_cost numeric(14,2) generated always as (round(abs(quantity) * unit_cost, 2)) stored,
  balance_after numeric(14,3) not null,
  lot_id uuid references public.inventory_lots(id),
  reference_type text,
  reference_id text,
  transfer_group uuid,
  reason text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index inv_mov_ing_idx on public.inventory_movements(ingredient_id, created_at desc);
create index inv_mov_ref_idx on public.inventory_movements(reference_type, reference_id);
create index inv_mov_time_idx on public.inventory_movements(created_at desc);
create or replace function public.tg_inv_mov_immutable() returns trigger language plpgsql as $$
begin raise exception 'Movimentações de estoque são imutáveis; registre um estorno/ajuste'; end $$;
create trigger inv_mov_immutable before update or delete on public.inventory_movements
  for each row execute function public.tg_inv_mov_immutable();

create table public.inventory_counts (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.stock_locations(id),
  status text not null default 'aberto' check (status in ('aberto','finalizado','cancelado')),
  notes text,
  started_by uuid default auth.uid(),
  started_at timestamptz not null default now(),
  finished_by uuid,
  finished_at timestamptz
);
create table public.inventory_count_items (
  count_id uuid not null references public.inventory_counts(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id),
  system_quantity numeric(14,3) not null,
  counted_quantity numeric(14,3),
  primary key (count_id, ingredient_id)
);

create or replace function public.default_location_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.stock_locations where is_default limit 1
$$;

-- ---------------------------------------------------------------------
-- Núcleo transacional de estoque
-- ---------------------------------------------------------------------
create or replace function public._inventory_apply(
  p_ingredient uuid, p_location uuid, p_qty numeric, p_type text,
  p_unit_cost numeric default null, p_ref_type text default null, p_ref_id text default null,
  p_reason text default null, p_lot_code text default null, p_expiry date default null,
  p_allow_negative boolean default false, p_transfer_group uuid default null, p_purchase_item uuid default null
) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  v_loc uuid := coalesce(p_location, public.default_location_id());
  v_ing public.ingredients; v_cur numeric; v_total numeric; v_new numeric; v_cost numeric;
  v_lot uuid; v_rem numeric; l record; v_take numeric;
begin
  if p_qty = 0 then return null; end if;
  if v_loc is null then raise exception 'Nenhum local de estoque padrão configurado'; end if;
  select * into v_ing from public.ingredients where id = p_ingredient for update;
  if not found then raise exception 'Item de estoque não encontrado'; end if;

  insert into public.inventory(ingredient_id, location_id, quantity) values (p_ingredient, v_loc, 0)
  on conflict do nothing;
  select quantity into v_cur from public.inventory where ingredient_id = p_ingredient and location_id = v_loc for update;
  select coalesce(sum(quantity),0) into v_total from public.inventory where ingredient_id = p_ingredient;

  v_new := v_cur + p_qty;
  if v_new < 0 and not p_allow_negative then
    raise exception 'Estoque insuficiente de % (disponível: %, solicitado: %)', v_ing.name, v_cur, abs(p_qty);
  end if;

  v_cost := coalesce(p_unit_cost, v_ing.avg_cost);
  if p_qty > 0 and p_type = 'entrada' and p_unit_cost is not null then
    -- custo médio ponderado
    update public.ingredients set
      avg_cost = case when greatest(v_total,0) + p_qty > 0
                      then round((greatest(v_total,0) * avg_cost + p_qty * p_unit_cost) / (greatest(v_total,0) + p_qty), 4)
                      else p_unit_cost end,
      last_cost = p_unit_cost
    where id = p_ingredient;
  end if;

  update public.inventory set quantity = v_new, updated_at = now() where ingredient_id = p_ingredient and location_id = v_loc;

  -- Lotes
  if p_qty > 0 and (v_ing.track_lots or p_lot_code is not null or p_expiry is not null) then
    insert into public.inventory_lots(ingredient_id, location_id, lot_code, expiry_date, quantity, initial_quantity, unit_cost, purchase_item_id)
    values (p_ingredient, v_loc, p_lot_code,
            coalesce(p_expiry, case when v_ing.shelf_life_days is not null then current_date + v_ing.shelf_life_days end),
            p_qty, p_qty, v_cost, p_purchase_item)
    returning id into v_lot;
  elsif p_qty < 0 then
    v_rem := -p_qty;  -- consome lotes por FEFO (vence primeiro, sai primeiro)
    for l in select id, quantity from public.inventory_lots
              where ingredient_id = p_ingredient and location_id = v_loc and quantity > 0
              order by expiry_date nulls last, received_at for update loop
      exit when v_rem <= 0;
      v_take := least(l.quantity, v_rem);
      update public.inventory_lots set quantity = quantity - v_take where id = l.id;
      v_rem := v_rem - v_take;
      v_lot := coalesce(v_lot, l.id);
    end loop;
  end if;

  insert into public.inventory_movements(ingredient_id, location_id, movement_type, quantity, unit_cost, balance_after,
                                         lot_id, reference_type, reference_id, reason, transfer_group)
  values (p_ingredient, v_loc, p_type, p_qty, v_cost, v_new, v_lot, p_ref_type, p_ref_id, p_reason, p_transfer_group);
  return v_new;
end $$;

-- RPC: movimentação manual
create or replace function public.inventory_move(
  p_ingredient uuid, p_type text, p_quantity numeric, p_location uuid default null,
  p_unit_cost numeric default null, p_reason text default null, p_lot_code text default null, p_expiry date default null
) returns numeric language plpgsql security definer set search_path = public as $$
declare v_qty numeric;
begin
  perform public.require_perm('inventory.manage');
  if p_type not in ('entrada','saida','ajuste','perda','producao') then raise exception 'Tipo de movimentação inválido'; end if;
  if p_type <> 'ajuste' and p_quantity <= 0 then raise exception 'Quantidade deve ser positiva'; end if;
  if p_type in ('saida','perda','ajuste') and coalesce(length(trim(p_reason)),0) < 3 then
    raise exception 'Informe o motivo da movimentação';
  end if;
  v_qty := case when p_type in ('saida','perda') then -p_quantity else p_quantity end;
  return public._inventory_apply(p_ingredient, p_location, v_qty, p_type, p_unit_cost, 'manual', null, p_reason, p_lot_code, p_expiry);
end $$;

create or replace function public.inventory_transfer(p_ingredient uuid, p_from uuid, p_to uuid, p_quantity numeric, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare g uuid := gen_random_uuid();
begin
  perform public.require_perm('inventory.manage');
  if p_from = p_to then raise exception 'Origem e destino iguais'; end if;
  if p_quantity <= 0 then raise exception 'Quantidade deve ser positiva'; end if;
  perform public._inventory_apply(p_ingredient, p_from, -p_quantity, 'transferencia_saida', null, 'transferencia', g::text, p_reason, null, null, false, g);
  perform public._inventory_apply(p_ingredient, p_to, p_quantity, 'transferencia_entrada', null, 'transferencia', g::text, p_reason, null, null, false, g);
end $$;

create or replace function public.inventory_count_start(p_location uuid, p_notes text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.require_perm('inventory.manage');
  if exists (select 1 from public.inventory_counts where location_id = p_location and status = 'aberto') then
    raise exception 'Já existe um inventário aberto para este local';
  end if;
  insert into public.inventory_counts(location_id, notes) values (p_location, p_notes) returning id into v_id;
  insert into public.inventory_count_items(count_id, ingredient_id, system_quantity)
  select v_id, i.id, coalesce(inv.quantity, 0)
    from public.ingredients i
    left join public.inventory inv on inv.ingredient_id = i.id and inv.location_id = p_location
   where i.is_active;
  return v_id;
end $$;

create or replace function public.inventory_count_finish(p_count uuid) returns int
language plpgsql security definer set search_path = public as $$
declare c public.inventory_counts; it record; v_cur numeric; v_n int := 0;
begin
  perform public.require_perm('inventory.manage');
  select * into c from public.inventory_counts where id = p_count for update;
  if c.status <> 'aberto' then raise exception 'Inventário não está aberto'; end if;
  for it in select * from public.inventory_count_items where count_id = p_count and counted_quantity is not null loop
    select coalesce(quantity,0) into v_cur from public.inventory where ingredient_id = it.ingredient_id and location_id = c.location_id;
    v_cur := coalesce(v_cur, 0);
    if it.counted_quantity <> v_cur then
      perform public._inventory_apply(it.ingredient_id, c.location_id, it.counted_quantity - v_cur, 'inventario', null,
                                      'inventario', p_count::text, 'Contagem de inventário', null, null, true);
      v_n := v_n + 1;
    end if;
  end loop;
  update public.inventory_counts set status = 'finalizado', finished_by = auth.uid(), finished_at = now() where id = p_count;
  return v_n;
end $$;

-- ---------------------------------------------------------------------
-- Custos e consumo por ficha técnica
-- ---------------------------------------------------------------------
create or replace function public.recipe_unit_factor(p_recipe uuid) returns numeric
language sql stable as $$
  -- quantas "receitas" são consumidas para produzir 1 unidade vendável
  select 1.0 / (r.yield_quantity * (1 - r.loss_percent / 100.0)) from public.recipes r where r.id = p_recipe
$$;

create or replace function public.product_unit_cost(p_product uuid, p_depth int default 0) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare p public.products; r public.recipes; v numeric := 0;
begin
  if p_depth > 5 then return 0; end if;
  select * into p from public.products where id = p_product;
  if not found then return 0; end if;
  if p.product_type = 'combo' then
    select coalesce(sum(ci.quantity * public.product_unit_cost(ci.product_id, p_depth + 1)), 0) into v
      from public.combo_items ci where ci.combo_product_id = p_product;
    return round(v, 4);
  end if;
  select * into r from public.recipes where product_id = p_product and is_active;
  if found then
    select coalesce(sum(ri.quantity * i.avg_cost), 0) * public.recipe_unit_factor(r.id) into v
      from public.recipe_items ri join public.ingredients i on i.id = ri.ingredient_id where ri.recipe_id = r.id;
  elsif p.stock_item_id is not null then
    select p.stock_item_qty * avg_cost into v from public.ingredients where id = p.stock_item_id;
  end if;
  return round(coalesce(v, 0), 4);
end $$;

-- Explode o produto em itens de estoque (quantidade por unidade vendida)
create or replace function public.product_stock_requirements(p_product uuid, p_qty numeric, p_depth int default 0)
returns table(ingredient_id uuid, quantity numeric)
language plpgsql stable security definer set search_path = public as $$
declare p public.products; r public.recipes; ci record;
begin
  if p_depth > 5 then return; end if;
  select * into p from public.products where id = p_product;
  if p.product_type = 'combo' then
    for ci in select * from public.combo_items where combo_product_id = p_product loop
      return query select * from public.product_stock_requirements(ci.product_id, p_qty * ci.quantity, p_depth + 1);
    end loop;
    return;
  end if;
  select * into r from public.recipes where product_id = p_product and is_active;
  if found then
    return query select ri.ingredient_id, ri.quantity * public.recipe_unit_factor(r.id) * p_qty
                   from public.recipe_items ri where ri.recipe_id = r.id;
  elsif p.stock_item_id is not null then
    return query select p.stock_item_id, p.stock_item_qty * p_qty;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Visões de estoque
-- ---------------------------------------------------------------------
create or replace view public.v_stock_levels with (security_invoker = true) as
select i.id as ingredient_id, i.name, i.ingredient_type, i.unit, i.min_stock, i.max_stock, i.avg_cost, i.last_cost,
       coalesce(sum(inv.quantity), 0) as quantity,
       round(coalesce(sum(inv.quantity), 0) * i.avg_cost, 2) as stock_value,
       case when coalesce(sum(inv.quantity),0) <= 0 then 'zerado'
            when coalesce(sum(inv.quantity),0) <= i.min_stock then 'baixo'
            else 'ok' end as status,
       i.is_active
  from public.ingredients i
  left join public.inventory inv on inv.ingredient_id = i.id
 group by i.id;

create or replace view public.v_expiring_lots with (security_invoker = true) as
select l.*, i.name as ingredient_name, i.unit, sl.name as location_name,
       (l.expiry_date - current_date) as days_to_expire
  from public.inventory_lots l
  join public.ingredients i on i.id = l.ingredient_id
  join public.stock_locations sl on sl.id = l.location_id
 where l.quantity > 0 and l.expiry_date is not null and l.expiry_date <= current_date + 7;
