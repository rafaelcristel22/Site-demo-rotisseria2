-- =====================================================================
-- ROTISSERIA ERP ULTRA — 0001 NÚCLEO
-- Extensões, utilitários, usuários, papéis, permissões, configurações
-- da empresa e auditoria.
-- =====================================================================
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Utilitários
-- ---------------------------------------------------------------------
create or replace function public.tg_set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Arredondamento monetário padrão (2 casas, half-up)
create or replace function public.money(v numeric) returns numeric
language sql immutable as $$ select round(coalesce(v,0), 2) $$;

-- ---------------------------------------------------------------------
-- Papéis e permissões
-- ---------------------------------------------------------------------
create table public.roles (
  code text primary key,
  name text not null,
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.permissions (
  code text primary key,
  module text not null,
  description text not null
);

create table public.role_permissions (
  role_code text not null references public.roles(code) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  primary key (role_code, permission_code)
);

-- users: perfil interno ligado a auth.users (Supabase Auth)
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  role_code text not null default 'funcionario' references public.roles(code),
  is_active boolean not null default true,
  -- PIN de autorização (descontos, cancelamentos, sangrias). Hash bcrypt.
  authorization_pin_hash text,
  max_discount_percent numeric(5,2) not null default 0 check (max_discount_percent between 0 and 100),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index users_role_idx on public.users(role_code);
create trigger users_updated before update on public.users
  for each row execute function public.tg_set_updated_at();

-- Permissões extras/negadas por usuário (sobrepõe o papel)
create table public.user_permission_overrides (
  user_id uuid not null references public.users(id) on delete cascade,
  permission_code text not null references public.permissions(code) on delete cascade,
  granted boolean not null,
  primary key (user_id, permission_code)
);

-- ---------------------------------------------------------------------
-- Funções de autorização (usadas em RLS e RPCs)
-- ---------------------------------------------------------------------
create or replace function public.current_user_id() returns uuid
language sql stable as $$ select auth.uid() $$;

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.users u where u.id = auth.uid() and u.is_active)
$$;

create or replace function public.has_perm(p_code text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.is_active
      and (
        u.role_code = 'admin'
        or exists (select 1 from public.user_permission_overrides o
                   where o.user_id = u.id and o.permission_code = p_code and o.granted)
        or (
          exists (select 1 from public.role_permissions rp
                  where rp.role_code = u.role_code and rp.permission_code = p_code)
          and not exists (select 1 from public.user_permission_overrides o
                          where o.user_id = u.id and o.permission_code = p_code and not o.granted)
        )
      )
  )
$$;

create or replace function public.require_perm(p_code text) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_perm(p_code) then
    raise exception 'Permissão negada: %', p_code using errcode = '42501';
  end if;
end $$;

create or replace function public.my_permissions() returns setof text
language sql stable security definer set search_path = public as $$
  select p.code from public.permissions p where public.has_perm(p.code)
$$;

-- Verifica PIN de autorização de um usuário com determinada permissão.
-- Retorna o id do autorizador ou gera exceção.
create or replace function public.verify_authorizer(p_pin text, p_perm text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  if p_pin is null or length(p_pin) < 4 then
    raise exception 'PIN de autorização obrigatório' using errcode = '42501';
  end if;
  select u.id into v_id
  from public.users u
  where u.is_active and u.authorization_pin_hash is not null
    and u.authorization_pin_hash = extensions.crypt(p_pin, u.authorization_pin_hash)
    and (
      u.role_code = 'admin'
      or exists (select 1 from public.user_permission_overrides o where o.user_id = u.id and o.permission_code = p_perm and o.granted)
      or (exists (select 1 from public.role_permissions rp where rp.role_code = u.role_code and rp.permission_code = p_perm)
          and not exists (select 1 from public.user_permission_overrides o where o.user_id = u.id and o.permission_code = p_perm and not o.granted))
    )
  limit 1;
  if v_id is null then
    raise exception 'PIN inválido ou sem permissão (%)', p_perm using errcode = '42501';
  end if;
  return v_id;
end $$;

create or replace function public.set_my_authorization_pin(p_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode = '42501'; end if;
  if p_pin !~ '^[0-9]{4,8}$' then raise exception 'O PIN deve ter de 4 a 8 dígitos'; end if;
  update public.users set authorization_pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 10))
  where id = auth.uid();
end $$;

-- ---------------------------------------------------------------------
-- Configurações da empresa (linha única)
-- ---------------------------------------------------------------------
create table public.company_settings (
  id smallint primary key default 1 check (id = 1),
  legal_name text not null default 'Minha Rotisseria LTDA',
  trade_name text not null default 'Minha Rotisseria',
  cnpj text,
  state_registration text,
  phone text,
  whatsapp text,
  email text,
  address jsonb not null default '{}'::jsonb,      -- {street, number, district, city, state, zip}
  logo_url text,
  primary_color text not null default '#b45309',
  secondary_color text not null default '#1f2937',
  timezone text not null default 'America/Sao_Paulo',
  opening_hours jsonb not null default '{
    "0":{"open":"10:00","close":"15:00","closed":false},
    "1":{"open":"10:00","close":"22:00","closed":true},
    "2":{"open":"10:00","close":"22:00","closed":false},
    "3":{"open":"10:00","close":"22:00","closed":false},
    "4":{"open":"10:00","close":"22:00","closed":false},
    "5":{"open":"10:00","close":"22:00","closed":false},
    "6":{"open":"10:00","close":"22:00","closed":false}}'::jsonb,
  online_ordering_enabled boolean not null default true,
  delivery_enabled boolean not null default true,
  pickup_enabled boolean not null default true,
  scheduling_enabled boolean not null default true,
  scheduling_max_days int not null default 7,
  min_order_value numeric(12,2) not null default 0,
  avg_prep_minutes int not null default 30,
  kitchen_alert_minutes int not null default 25,
  delivery_alert_minutes int not null default 50,
  -- PDV
  pos_max_discount_without_auth numeric(5,2) not null default 0,
  pos_require_pin_for_cancel boolean not null default true,
  pos_require_pin_for_withdrawal boolean not null default false,
  receipt_footer text default 'Obrigado pela preferência!',
  -- Ponto
  timeclock_tolerance_per_mark_min int not null default 5,   -- CLT art. 58 §1º
  timeclock_tolerance_daily_min int not null default 10,
  timeclock_min_interval_seconds int not null default 60,    -- anti-duplicidade
  timeclock_require_authorized_device boolean not null default false,
  overtime_rate_weekday numeric(5,2) not null default 50,    -- %
  overtime_rate_sunday_holiday numeric(5,2) not null default 100,
  hour_bank_enabled boolean not null default true,
  night_shift_start time not null default '22:00',
  night_shift_end time not null default '05:00',
  night_shift_rate numeric(5,2) not null default 20,
  -- Folha (estimativa; validar com a contabilidade)
  payroll_monthly_hours numeric(6,2) not null default 220,
  payroll_tax_tables jsonb not null default '{}'::jsonb,
  payroll_fgts_rate numeric(5,2) not null default 8,
  payroll_dsr_on_overtime boolean not null default true,
  -- Fidelidade
  loyalty_enabled boolean not null default false,
  loyalty_points_per_real numeric(8,2) not null default 1,
  loyalty_real_per_point numeric(8,4) not null default 0.05,
  loyalty_min_redeem_points int not null default 100,
  -- LGPD
  privacy_policy_url text,
  privacy_policy_text text default 'Seus dados são utilizados exclusivamente para processar pedidos e, se autorizado, enviar ofertas. Você pode solicitar acesso, correção ou exclusão a qualquer momento.',
  -- Impressão
  printers jsonb not null default '[]'::jsonb,  -- [{id,name,role:'receipt|kitchen',paper:58|80,connection:'browser|serial|network',address}]
  ai_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id)
);
create trigger company_settings_updated before update on public.company_settings
  for each row execute function public.tg_set_updated_at();

create table public.holidays (
  day date primary key,
  name text not null,
  is_national boolean not null default true
);

-- Horário de funcionamento
create or replace function public.store_is_open(p_at timestamptz) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  s public.company_settings; v_local timestamp; v_dow text; v_day jsonb;
  v_open time; v_close time; v_t time;
begin
  select * into s from public.company_settings where id = 1;
  if not found then return false; end if;
  v_local := p_at at time zone s.timezone;
  v_dow := extract(dow from v_local)::int::text;
  v_day := s.opening_hours -> v_dow;
  if v_day is null or coalesce((v_day->>'closed')::boolean, false) then return false; end if;
  v_open := (v_day->>'open')::time; v_close := (v_day->>'close')::time; v_t := v_local::time;
  if v_close > v_open then return v_t >= v_open and v_t < v_close; end if;
  return v_t >= v_open or v_t < v_close; -- atravessa a meia-noite
end $$;

-- Configuração pública (sem dados sensíveis) para o site de pedidos
create or replace function public.public_company_info() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'trade_name', trade_name, 'phone', phone, 'whatsapp', whatsapp,
    'address', address, 'logo_url', logo_url, 'primary_color', primary_color,
    'secondary_color', secondary_color, 'opening_hours', opening_hours,
    'online_ordering_enabled', online_ordering_enabled,
    'delivery_enabled', delivery_enabled, 'pickup_enabled', pickup_enabled,
    'scheduling_enabled', scheduling_enabled, 'scheduling_max_days', scheduling_max_days,
    'min_order_value', min_order_value, 'avg_prep_minutes', avg_prep_minutes,
    'loyalty_enabled', loyalty_enabled, 'privacy_policy_text', privacy_policy_text,
    'privacy_policy_url', privacy_policy_url, 'timezone', timezone,
    'is_open_now', public.store_is_open(now())
  ) from public.company_settings where id = 1
$$;

-- ---------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  user_id uuid,
  user_email text,
  action text not null,                -- INSERT/UPDATE/DELETE ou ação de negócio
  entity text not null,                -- tabela / módulo
  entity_id text,
  old_data jsonb,
  new_data jsonb,
  changed_fields text[],
  reason text,
  authorized_by uuid,
  ip text,
  user_agent text
);
create index audit_logs_entity_idx on public.audit_logs(entity, entity_id);
create index audit_logs_user_idx on public.audit_logs(user_id, occurred_at desc);
create index audit_logs_time_idx on public.audit_logs(occurred_at desc);
create index audit_logs_action_idx on public.audit_logs(action);

-- Bloqueia alteração/remoção do log
create or replace function public.tg_audit_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'Registros de auditoria são imutáveis';
end $$;
create trigger audit_logs_no_update before update or delete on public.audit_logs
  for each row execute function public.tg_audit_immutable();

create or replace function public.request_header(p_name text) returns text
language sql stable as $$
  select nullif(current_setting('request.headers', true), '')::jsonb ->> p_name
$$;

create or replace function public.log_action(
  p_action text, p_entity text, p_entity_id text,
  p_old jsonb default null, p_new jsonb default null,
  p_reason text default null, p_authorized_by uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs(user_id, user_email, action, entity, entity_id, old_data, new_data,
                                reason, authorized_by, ip, user_agent)
  values (auth.uid(), (select email from public.users where id = auth.uid()),
          p_action, p_entity, p_entity_id, p_old, p_new, p_reason, p_authorized_by,
          coalesce(public.request_header('x-forwarded-for'), public.request_header('x-real-ip')),
          public.request_header('user-agent'));
end $$;

-- Trigger genérico de auditoria de linhas
create or replace function public.tg_audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb; v_new jsonb; v_changed text[]; v_id text;
begin
  if tg_op in ('UPDATE','DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT','UPDATE') then v_new := to_jsonb(new); end if;
  -- nunca gravar hashes sensíveis
  v_old := v_old - 'authorization_pin_hash' - 'pin_hash' - 'token_hash';
  v_new := v_new - 'authorization_pin_hash' - 'pin_hash' - 'token_hash';
  if tg_op = 'UPDATE' then
    select array_agg(k) into v_changed
    from jsonb_object_keys(v_new) k
    where (v_new -> k) is distinct from (v_old -> k) and k not in ('updated_at');
    if v_changed is null then return new; end if;
  end if;
  v_id := coalesce(v_new ->> 'id', v_old ->> 'id');
  insert into public.audit_logs(user_id, user_email, action, entity, entity_id, old_data, new_data, changed_fields)
  values (auth.uid(), (select email from public.users where id = auth.uid()),
          tg_op, tg_table_name, v_id, v_old, v_new, v_changed);
  return coalesce(new, old);
end $$;

create trigger audit_company_settings after insert or update or delete on public.company_settings
  for each row execute function public.tg_audit_row();
create trigger audit_users after insert or update or delete on public.users
  for each row execute function public.tg_audit_row();
create trigger audit_role_permissions after insert or update or delete on public.role_permissions
  for each row execute function public.tg_audit_row();
create trigger audit_user_overrides after insert or update or delete on public.user_permission_overrides
  for each row execute function public.tg_audit_row();

-- ---------------------------------------------------------------------
-- Criação automática do perfil ao cadastrar no Supabase Auth.
-- O primeiro usuário do sistema torna-se administrador.
-- Contas criadas pelo site público não recebem perfil interno.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role text;
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);   -- editável pelo próprio usuário: só dados de exibição
  v_app  jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);    -- gravável apenas com a chave de serviço (Edge Function)
  v_first boolean := not exists (select 1 from public.users);
begin
  -- contas de clientes do site (se um dia existirem) não recebem perfil interno
  if coalesce(v_app->>'account_type', v_meta->>'account_type', 'staff') <> 'staff' then return new; end if;
  if v_first then
    v_role := 'admin';
  else
    -- papel e liberação NUNCA vêm de user_metadata (o próprio usuário poderia se promover)
    v_role := coalesce(nullif(v_app->>'role_code',''), 'funcionario');
    if v_role = 'admin' or not exists (select 1 from public.roles where code = v_role) then v_role := 'funcionario'; end if;
  end if;
  insert into public.users(id, email, full_name, role_code, is_active)
  values (new.id, new.email, coalesce(nullif(v_meta->>'full_name',''), split_part(new.email,'@',1)), v_role,
          -- contas novas começam inativas até liberação, exceto a primeira e as criadas pela função administrativa
          v_first or coalesce((v_app->>'invited')::boolean, false));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Perfil corrente
create or replace function public.me() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', u.id, 'email', u.email, 'full_name', u.full_name, 'role_code', u.role_code,
    'role_name', r.name, 'is_active', u.is_active, 'has_pin', u.authorization_pin_hash is not null,
    'max_discount_percent', u.max_discount_percent,
    'permissions', coalesce((select jsonb_agg(p) from public.my_permissions() p), '[]'::jsonb)
  )
  from public.users u join public.roles r on r.code = u.role_code
  where u.id = auth.uid()
$$;
