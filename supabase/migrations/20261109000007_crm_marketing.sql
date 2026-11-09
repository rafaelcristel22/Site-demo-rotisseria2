-- =====================================================================
-- 0007 CLIENTES / CRM / LGPD / MARKETING
-- =====================================================================
create or replace function public.normalize_phone(p text) returns text
language sql immutable as $$
  select nullif(regexp_replace(regexp_replace(coalesce(p,''), '\D', '', 'g'), '^55(\d{10,11})$', '\1'), '')
$$;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text unique,
  email text,
  cpf text,
  birth_date date,
  source text not null default 'balcao' check (source in ('balcao','site','telefone','whatsapp','ifood','outro')),
  preferences text,
  notes text,
  tags text[] not null default '{}',
  credit_enabled boolean not null default false,
  credit_limit numeric(12,2) not null default 0,
  loyalty_points int not null default 0,
  is_blocked boolean not null default false,
  first_order_at timestamptz,
  last_order_at timestamptz,
  orders_count int not null default 0,
  total_spent numeric(14,2) not null default 0,
  anonymized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customers_name_idx on public.customers(lower(name));
create index customers_last_order_idx on public.customers(last_order_at);
create trigger customers_updated before update on public.customers
  for each row execute function public.tg_set_updated_at();
create trigger audit_customers after update or delete on public.customers
  for each row execute function public.tg_audit_row();
create or replace function public.tg_customer_normalize() returns trigger language plpgsql as $$
begin
  new.phone := public.normalize_phone(new.phone);
  new.cpf := nullif(regexp_replace(coalesce(new.cpf,''), '\D', '', 'g'), '');
  return new;
end $$;
create trigger customers_normalize before insert or update on public.customers
  for each row execute function public.tg_customer_normalize();
alter table public.accounts_receivable add constraint ar_customer_fk foreign key (customer_id) references public.customers(id);

create table public.delivery_zones (
  id uuid primary key default gen_random_uuid(),
  district text not null,
  city text not null default '',
  fee numeric(10,2) not null default 0 check (fee >= 0),
  min_order_value numeric(10,2) not null default 0,
  free_delivery_above numeric(10,2),
  estimated_minutes int not null default 45,
  is_active boolean not null default true,
  unique (district, city)
);
create trigger audit_delivery_zones after insert or update or delete on public.delivery_zones
  for each row execute function public.tg_audit_row();

create table public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  label text default 'Casa',
  street text not null,
  number text,
  complement text,
  district text not null,
  city text,
  state text,
  zip text,
  reference text,
  delivery_zone_id uuid references public.delivery_zones(id),
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index customer_addresses_customer_idx on public.customer_addresses(customer_id);

create table public.customer_consents (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  consent_type text not null check (consent_type in ('termos_privacidade','marketing_whatsapp','marketing_email','marketing_sms','programa_fidelidade')),
  granted boolean not null,
  policy_version text,
  source text not null default 'site',
  ip text,
  recorded_by uuid default auth.uid(),
  recorded_at timestamptz not null default now()
);
create index consents_customer_idx on public.customer_consents(customer_id, consent_type, recorded_at desc);

-- consentimento vigente = último registro por tipo
create or replace view public.v_customer_current_consents with (security_invoker = true) as
select distinct on (customer_id, consent_type) customer_id, consent_type, granted, recorded_at, source
  from public.customer_consents order by customer_id, consent_type, recorded_at desc;

create table public.customer_interactions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  channel text not null default 'telefone' check (channel in ('telefone','whatsapp','balcao','email','site','instagram','outro')),
  interaction_type text not null default 'atendimento' check (interaction_type in ('atendimento','reclamacao','elogio','sugestao','contato_marketing','cobranca')),
  description text not null,
  resolved boolean not null default true,
  user_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.loyalty_transactions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  points int not null,
  tx_type text not null check (tx_type in ('acumulo','resgate','ajuste','expiracao','estorno')),
  order_id uuid,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create or replace function public.tg_loyalty_balance() returns trigger
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  update public.customers set loyalty_points = loyalty_points + new.points where id = new.customer_id
  returning loyalty_points into v;
  if v < 0 then raise exception 'Saldo de pontos insuficiente'; end if;
  return new;
end $$;
create trigger loyalty_balance after insert on public.loyalty_transactions
  for each row execute function public.tg_loyalty_balance();

-- Marketing ------------------------------------------------------------
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  objective text,
  channel text not null default 'whatsapp' check (channel in ('whatsapp','instagram','facebook','email','sms','site','panfleto','outro')),
  starts_on date not null default current_date,
  ends_on date,
  budget numeric(12,2) not null default 0,
  status text not null default 'planejada' check (status in ('planejada','ativa','encerrada','cancelada')),
  target_segment text,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text,
  discount_type text not null check (discount_type in ('percentual','valor_fixo','frete_gratis')),
  discount_value numeric(12,2) not null default 0 check (discount_value >= 0),
  min_order_value numeric(12,2) not null default 0,
  max_discount numeric(12,2),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  max_uses int,
  max_uses_per_customer int default 1,
  uses_count int not null default 0,
  customer_id uuid references public.customers(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  channels text[] not null default '{pdv,site}',
  first_order_only boolean not null default false,
  is_active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (discount_type <> 'percentual' or discount_value <= 100)
);
create or replace function public.tg_coupon_upper() returns trigger language plpgsql as $$
begin new.code := upper(trim(new.code)); return new; end $$;
create trigger coupons_upper before insert or update on public.coupons
  for each row execute function public.tg_coupon_upper();
create trigger audit_coupons after insert or update or delete on public.coupons
  for each row execute function public.tg_audit_row();

create table public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons(id),
  order_id uuid,
  customer_id uuid references public.customers(id),
  discount_amount numeric(12,2) not null,
  created_at timestamptz not null default now()
);
create index coupon_red_idx on public.coupon_redemptions(coupon_id, customer_id);

create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  promo_type text not null check (promo_type in ('percentual','valor_fixo','preco_fixo')),
  value numeric(12,2) not null check (value >= 0),
  product_id uuid references public.products(id) on delete cascade,
  category_id uuid references public.categories(id) on delete cascade,
  days_of_week int[] not null default '{0,1,2,3,4,5,6}',
  start_time time,
  end_time time,
  starts_on date not null default current_date,
  ends_on date,
  channels text[] not null default '{pdv,site}',
  campaign_id uuid references public.campaigns(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (product_id is not null or category_id is not null)
);
create trigger audit_promotions after insert or update or delete on public.promotions
  for each row execute function public.tg_audit_row();

create table public.banners (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subtitle text,
  image_url text,
  link_url text,
  product_id uuid references public.products(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  sort_order int not null default 0,
  starts_at timestamptz,
  ends_at timestamptz,
  campaign_id uuid references public.campaigns(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Preço efetivo (promoções programadas)
-- ---------------------------------------------------------------------
create or replace function public.effective_price(p_product uuid, p_channel text default 'pdv', p_at timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p public.products; s public.company_settings; v_local timestamp; v_best numeric; v_promo record; v_price numeric; v_name text;
begin
  select * into p from public.products where id = p_product;
  if not found then return null; end if;
  select * into s from public.company_settings where id = 1;
  v_local := p_at at time zone coalesce(s.timezone, 'America/Sao_Paulo');
  v_best := coalesce(p.promotional_price, p.price);
  v_name := case when p.promotional_price is not null then 'Preço promocional' end;
  for v_promo in
    select * from public.promotions pr
     where pr.is_active and (pr.product_id = p.id or (pr.product_id is null and pr.category_id = p.category_id))
       and p_channel = any(pr.channels)
       and v_local::date >= pr.starts_on and (pr.ends_on is null or v_local::date <= pr.ends_on)
       and extract(dow from v_local)::int = any(pr.days_of_week)
       and (pr.start_time is null or v_local::time >= pr.start_time)
       and (pr.end_time is null or v_local::time < pr.end_time)
  loop
    v_price := case v_promo.promo_type
      when 'percentual' then p.price * (1 - v_promo.value / 100)
      when 'valor_fixo' then p.price - v_promo.value
      else v_promo.value end;
    v_price := greatest(round(v_price, 2), 0);
    if v_price < v_best then v_best := v_price; v_name := v_promo.name; end if;
  end loop;
  return jsonb_build_object('price', v_best, 'list_price', p.price, 'promotion', v_name);
end $$;

-- Validação de cupom (não consome; o consumo ocorre no fechamento do pedido)
create or replace function public.validate_coupon(
  p_code text, p_subtotal numeric, p_customer uuid default null, p_channel text default 'site', p_delivery_fee numeric default 0
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c public.coupons; v_disc numeric; v_uses int;
begin
  select * into c from public.coupons where code = upper(trim(p_code));
  if not found or not c.is_active then return jsonb_build_object('valid', false, 'message', 'Cupom inválido'); end if;
  if now() < c.starts_at or (c.ends_at is not null and now() > c.ends_at) then
    return jsonb_build_object('valid', false, 'message', 'Cupom fora do período de validade'); end if;
  if not (p_channel = any(c.channels)) then return jsonb_build_object('valid', false, 'message', 'Cupom não válido neste canal'); end if;
  if c.max_uses is not null and c.uses_count >= c.max_uses then return jsonb_build_object('valid', false, 'message', 'Cupom esgotado'); end if;
  if p_subtotal < c.min_order_value then
    return jsonb_build_object('valid', false, 'message', 'Pedido mínimo para este cupom: R$ ' || to_char(c.min_order_value, 'FM999990D00')); end if;
  if c.customer_id is not null and c.customer_id is distinct from p_customer then
    return jsonb_build_object('valid', false, 'message', 'Cupom exclusivo de outro cliente'); end if;
  if p_customer is not null and c.max_uses_per_customer is not null then
    select count(*) into v_uses from public.coupon_redemptions where coupon_id = c.id and customer_id = p_customer;
    if v_uses >= c.max_uses_per_customer then return jsonb_build_object('valid', false, 'message', 'Limite de uso do cupom atingido'); end if;
  end if;
  if c.first_order_only and p_customer is not null and exists (select 1 from public.customers where id = p_customer and orders_count > 0) then
    return jsonb_build_object('valid', false, 'message', 'Cupom válido somente para o primeiro pedido'); end if;
  v_disc := case c.discount_type
    when 'percentual' then round(p_subtotal * c.discount_value / 100, 2)
    when 'valor_fixo' then least(c.discount_value, p_subtotal)
    else coalesce(p_delivery_fee, 0) end;
  if c.max_discount is not null then v_disc := least(v_disc, c.max_discount); end if;
  return jsonb_build_object('valid', true, 'coupon_id', c.id, 'code', c.code, 'discount_type', c.discount_type,
                            'discount', v_disc, 'message', coalesce(c.description, 'Cupom aplicado'));
end $$;

-- ---------------------------------------------------------------------
-- CRM: segmentos, ranking, LGPD
-- ---------------------------------------------------------------------
create or replace function public.customer_data_export(p_customer uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_perm('customers.manage');
  perform public.log_action('LGPD_EXPORT', 'customers', p_customer::text);
  return jsonb_build_object(
    'customer', (select to_jsonb(c) from public.customers c where id = p_customer),
    'addresses', (select coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.customer_addresses a where customer_id = p_customer),
    'consents', (select coalesce(jsonb_agg(to_jsonb(x) order by recorded_at), '[]') from public.customer_consents x where customer_id = p_customer),
    'interactions', (select coalesce(jsonb_agg(to_jsonb(i)), '[]') from public.customer_interactions i where customer_id = p_customer),
    'loyalty', (select coalesce(jsonb_agg(to_jsonb(l)), '[]') from public.loyalty_transactions l where customer_id = p_customer),
    'orders', (select coalesce(jsonb_agg(jsonb_build_object('number', o.number, 'created_at', o.created_at, 'total', o.total, 'status', o.status)), '[]')
                 from public.orders o where o.customer_id = p_customer),
    'exported_at', now()
  );
end $$;

-- Anonimização (direito de eliminação). Mantém registros fiscais/financeiros sem dados pessoais.
create or replace function public.anonymize_customer(p_customer uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_perm('customers.manage');
  if coalesce(length(trim(p_reason)),0) < 5 then raise exception 'Informe o motivo/protocolo da solicitação'; end if;
  update public.customers set name = 'Cliente anonimizado', phone = null, email = null, cpf = null, birth_date = null,
         preferences = null, notes = null, tags = '{}', anonymized_at = now(), credit_enabled = false
   where id = p_customer;
  delete from public.customer_addresses where customer_id = p_customer;
  update public.orders set customer_name = 'Cliente anonimizado', customer_phone = null, delivery_address = null where customer_id = p_customer;
  insert into public.customer_consents(customer_id, consent_type, granted, source)
  select p_customer, t, false, 'anonimizacao' from unnest(array['marketing_whatsapp','marketing_email','marketing_sms']) t;
  perform public.log_action('LGPD_ANONYMIZE', 'customers', p_customer::text, null, null, p_reason);
end $$;

create or replace function public.set_customer_consent(p_customer uuid, p_type text, p_granted boolean, p_source text default 'painel')
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_perm('customers.manage');
  insert into public.customer_consents(customer_id, consent_type, granted, source) values (p_customer, p_type, p_granted, p_source);
end $$;

create or replace function public.loyalty_adjust(p_customer uuid, p_points int, p_notes text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_perm('customers.manage');
  if coalesce(length(trim(p_notes)),0) < 3 then raise exception 'Informe o motivo'; end if;
  insert into public.loyalty_transactions(customer_id, points, tx_type, notes) values (p_customer, p_points, 'ajuste', p_notes);
end $$;
