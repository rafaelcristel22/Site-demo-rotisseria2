-- =====================================================================
-- 0003 PONTO ELETRÔNICO
-- Marcações imutáveis (encadeadas por hash + NSR), dispositivos
-- autorizados, quiosque com PIN, solicitações de ajuste com aprovação,
-- cálculo diário (horas, atrasos, extras, faltas, noturno), horas extras
-- e banco de horas.
-- Referências: CLT art. 58 §1º (tolerância 5/10 min), art. 71 (intervalo),
-- art. 73 (adicional noturno), art. 59 (horas extras / banco de horas),
-- Portaria MTP 671/2021 (REP-P: NSR, imutabilidade, espelho de ponto).
-- Regras são configuráveis em company_settings — validar com a contabilidade.
-- =====================================================================
alter table public.company_settings add column hour_bank_start_date date;

create sequence public.time_clock_nsr_seq;

create table public.time_clock_devices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  device_type text not null default 'tablet_compartilhado'
    check (device_type in ('tablet_compartilhado','computador','celular')),
  token_hash text not null unique,
  is_active boolean not null default true,
  location_note text,
  registered_by uuid default auth.uid(),
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create trigger audit_tc_devices after insert or update or delete on public.time_clock_devices
  for each row execute function public.tg_audit_row();

create table public.time_clock_records (
  id uuid primary key default gen_random_uuid(),
  nsr bigint not null unique default nextval('public.time_clock_nsr_seq'),
  employee_id uuid not null references public.employees(id),
  work_date date not null,
  punched_at timestamptz not null,
  punch_type text not null check (punch_type in ('entrada','intervalo_inicio','intervalo_fim','saida')),
  source text not null check (source in ('painel','quiosque','computador','ajuste')),
  device_id uuid references public.time_clock_devices(id),
  ip text,
  user_agent text,
  status text not null default 'valido' check (status in ('valido','anulado')),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  adjustment_id uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  prev_hash text,
  record_hash text not null
);
create index tcr_emp_date_idx on public.time_clock_records(employee_id, work_date);
create index tcr_emp_time_idx on public.time_clock_records(employee_id, punched_at desc);
create unique index tcr_no_dup_idx on public.time_clock_records(employee_id, punched_at, punch_type) where status = 'valido';

-- Imutabilidade: nada é apagado; só a anulação via ajuste aprovado é permitida.
create or replace function public.tg_tcr_protect() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Marcações de ponto não podem ser excluídas';
  end if;
  if coalesce(current_setting('app.timeclock_adjust', true), '') <> 'on' then
    raise exception 'Marcações de ponto só podem ser alteradas por ajuste aprovado';
  end if;
  if new.employee_id <> old.employee_id or new.punched_at <> old.punched_at
     or new.punch_type <> old.punch_type or new.nsr <> old.nsr or new.record_hash <> old.record_hash
     or new.work_date <> old.work_date then
    raise exception 'Somente a anulação de marcações é permitida; dados originais são preservados';
  end if;
  return new;
end $$;
create trigger tcr_protect before update or delete on public.time_clock_records
  for each row execute function public.tg_tcr_protect();
create trigger audit_tcr after insert or update on public.time_clock_records
  for each row execute function public.tg_audit_row();

create table public.time_adjustments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  adjustment_type text not null check (adjustment_type in ('incluir','alterar','anular')),
  target_record_id uuid references public.time_clock_records(id),
  work_date date not null,
  punch_type text check (punch_type in ('entrada','intervalo_inicio','intervalo_fim','saida')),
  requested_time timestamptz,
  justification text not null check (length(trim(justification)) >= 10),
  attachment_path text,
  status text not null default 'pendente' check (status in ('pendente','aprovado','rejeitado','cancelado')),
  requested_by uuid not null default auth.uid(),
  requested_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_notes text,
  check ((adjustment_type = 'incluir' and requested_time is not null and punch_type is not null)
      or (adjustment_type = 'alterar' and requested_time is not null and target_record_id is not null)
      or (adjustment_type = 'anular' and target_record_id is not null))
);
create index tadj_status_idx on public.time_adjustments(status, requested_at);
create index tadj_emp_idx on public.time_adjustments(employee_id);
create trigger audit_tadj after insert or update or delete on public.time_adjustments
  for each row execute function public.tg_audit_row();
alter table public.time_clock_records add constraint tcr_adjustment_fk
  foreign key (adjustment_id) references public.time_adjustments(id);

create table public.timeclock_auth_failures (
  id bigint generated always as identity primary key,
  employee_code text,
  device_id uuid,
  attempted_at timestamptz not null default now()
);
create index tcaf_idx on public.timeclock_auth_failures(employee_code, attempted_at);

-- Horas extras apuradas e destinação (pagamento ou banco de horas)
create table public.overtime_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  work_date date not null,
  minutes int not null check (minutes > 0),
  rate_percent numeric(5,2) not null,
  destination text not null default 'pagamento' check (destination in ('pagamento','banco_horas')),
  status text not null default 'pendente' check (status in ('pendente','aprovado','rejeitado')),
  approved_by uuid,
  approved_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  unique (employee_id, work_date)
);
create trigger audit_overtime after insert or update or delete on public.overtime_records
  for each row execute function public.tg_audit_row();

-- Lançamentos manuais no banco de horas (compensações, pagamentos, saldo inicial)
create table public.hour_bank_entries (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  entry_date date not null default current_date,
  minutes int not null,                       -- positivo = crédito, negativo = débito
  entry_type text not null check (entry_type in ('saldo_inicial','compensacao','pagamento','ajuste')),
  notes text not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create trigger audit_hbe after insert or update or delete on public.hour_bank_entries
  for each row execute function public.tg_audit_row();

-- ---------------------------------------------------------------------
-- Registro interno de marcação (validações centrais)
-- ---------------------------------------------------------------------
create or replace function public.timeclock_next_types(p_employee uuid, p_at timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r public.time_clock_records;
begin
  select * into r from public.time_clock_records
   where employee_id = p_employee and status = 'valido' and punched_at <= p_at
   order by punched_at desc limit 1;
  if not found or r.punch_type = 'saida' or p_at - r.punched_at > interval '18 hours' then
    return jsonb_build_object('allowed', jsonb_build_array('entrada'), 'last', to_jsonb(r), 'open_work_date', null);
  elsif r.punch_type in ('entrada','intervalo_fim') then
    return jsonb_build_object('allowed', jsonb_build_array('intervalo_inicio','saida'), 'last', to_jsonb(r), 'open_work_date', r.work_date);
  else -- intervalo_inicio
    return jsonb_build_object('allowed', jsonb_build_array('intervalo_fim'), 'last', to_jsonb(r), 'open_work_date', r.work_date);
  end if;
end $$;

create or replace function public._timeclock_insert(
  p_employee uuid, p_type text, p_source text, p_device uuid, p_at timestamptz,
  p_work_date date, p_adjustment uuid default null
) returns public.time_clock_records
language plpgsql security definer set search_path = public, extensions as $$
declare v_prev text; v_rec public.time_clock_records; v_nsr bigint;
begin
  -- serializa marcações por funcionário
  perform pg_advisory_xact_lock(hashtext('tc:' || p_employee::text));
  select record_hash into v_prev from public.time_clock_records order by nsr desc limit 1;
  v_nsr := nextval('public.time_clock_nsr_seq');
  insert into public.time_clock_records(nsr, employee_id, work_date, punched_at, punch_type, source, device_id,
         ip, user_agent, adjustment_id, prev_hash, record_hash)
  values (v_nsr, p_employee, p_work_date, p_at, p_type, p_source, p_device,
          coalesce(public.request_header('x-forwarded-for'), public.request_header('x-real-ip')),
          public.request_header('user-agent'), p_adjustment, v_prev,
          encode(extensions.digest(coalesce(v_prev,'') || '|' || v_nsr || '|' || p_employee || '|' ||
                 to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '|' || p_type, 'sha256'), 'hex'))
  returning * into v_rec;
  return v_rec;
end $$;

create or replace function public._timeclock_punch(
  p_employee uuid, p_type text, p_source text, p_device uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.company_settings; e public.employees; v_next jsonb; v_last timestamptz;
  v_type text := p_type; v_work_date date; v_rec public.time_clock_records; v_now timestamptz := now();
begin
  select * into s from public.company_settings where id = 1;
  select * into e from public.employees where id = p_employee;
  if not found then raise exception 'Funcionário não encontrado'; end if;
  if e.status = 'desligado' then raise exception 'Funcionário desligado não pode registrar ponto'; end if;

  perform pg_advisory_xact_lock(hashtext('tc:' || p_employee::text));

  select max(punched_at) into v_last from public.time_clock_records where employee_id = p_employee and status = 'valido';
  if v_last is not null and v_now - v_last < make_interval(secs => s.timeclock_min_interval_seconds) then
    raise exception 'Marcação duplicada: aguarde % segundos entre registros', s.timeclock_min_interval_seconds;
  end if;

  v_next := public.timeclock_next_types(p_employee, v_now);
  if v_type is null then v_type := v_next->'allowed'->>0; end if;
  if not (v_next->'allowed') ? v_type then
    raise exception 'Sequência inválida: a próxima marcação permitida é %', v_next->'allowed';
  end if;

  v_work_date := coalesce((v_next->>'open_work_date')::date, (v_now at time zone s.timezone)::date);
  v_rec := public._timeclock_insert(p_employee, v_type, p_source, p_device, v_now, v_work_date);
  if p_device is not null then update public.time_clock_devices set last_used_at = v_now where id = p_device; end if;

  return jsonb_build_object('id', v_rec.id, 'nsr', v_rec.nsr, 'employee', e.full_name, 'punch_type', v_type,
                            'punched_at', v_rec.punched_at, 'work_date', v_work_date, 'hash', v_rec.record_hash);
end $$;

create or replace function public._device_from_token(p_token text) returns public.time_clock_devices
language plpgsql security definer set search_path = public, extensions as $$
declare d public.time_clock_devices;
begin
  if p_token is null then return null; end if;
  select * into d from public.time_clock_devices
   where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and is_active;
  if not found then raise exception 'Dispositivo de ponto não autorizado' using errcode = '42501'; end if;
  return d;
end $$;

-- Marcação pelo painel do próprio funcionário (ou computador autorizado)
create or replace function public.clock_punch(p_type text default null, p_device_token text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_emp uuid := public.my_employee_id(); d public.time_clock_devices; s public.company_settings;
begin
  if v_emp is null then raise exception 'Seu usuário não está vinculado a um funcionário' using errcode = '42501'; end if;
  select * into s from public.company_settings where id = 1;
  if p_device_token is not null then d := public._device_from_token(p_device_token);
  elsif s.timeclock_require_authorized_device then
    raise exception 'O registro de ponto exige um dispositivo autorizado' using errcode = '42501';
  end if;
  return public._timeclock_punch(v_emp, p_type, case when d.id is null then 'painel' else 'computador' end, d.id);
end $$;

-- Marcação pelo tablet compartilhado (quiosque): token do dispositivo + matrícula + PIN
create or replace function public.kiosk_punch(p_device_token text, p_employee_code text, p_pin text, p_type text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare d public.time_clock_devices; e public.employees; v_fail int;
begin
  d := public._device_from_token(p_device_token);
  if d.id is null then raise exception 'Token do dispositivo obrigatório' using errcode = '42501'; end if;
  select count(*) into v_fail from public.timeclock_auth_failures
   where employee_code = p_employee_code and attempted_at > now() - interval '15 minutes';
  if v_fail >= 5 then
    raise exception 'Muitas tentativas inválidas. Aguarde 15 minutos ou procure o gestor.' using errcode = '42501';
  end if;
  select * into e from public.employees where code = p_employee_code;
  if not found or e.pin_hash is null or e.pin_hash <> extensions.crypt(coalesce(p_pin,''), e.pin_hash) then
    insert into public.timeclock_auth_failures(employee_code, device_id) values (p_employee_code, d.id);
    -- grava a falha mesmo com a exceção: usa retorno em vez de raise
    return jsonb_build_object('ok', false, 'error', 'Matrícula ou PIN inválidos');
  end if;
  return public._timeclock_punch(e.id, p_type, 'quiosque', d.id) || jsonb_build_object('ok', true);
end $$;

-- Identifica funcionário no quiosque e mostra o próximo tipo (sem registrar)
create or replace function public.kiosk_identify(p_device_token text, p_employee_code text, p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare d public.time_clock_devices; e public.employees; v_fail int;
begin
  d := public._device_from_token(p_device_token);
  select count(*) into v_fail from public.timeclock_auth_failures
   where employee_code = p_employee_code and attempted_at > now() - interval '15 minutes';
  if v_fail >= 5 then return jsonb_build_object('ok', false, 'error', 'Muitas tentativas inválidas. Aguarde 15 minutos.'); end if;
  select * into e from public.employees where code = p_employee_code and status <> 'desligado';
  if not found or e.pin_hash is null or e.pin_hash <> extensions.crypt(coalesce(p_pin,''), e.pin_hash) then
    insert into public.timeclock_auth_failures(employee_code, device_id) values (p_employee_code, d.id);
    return jsonb_build_object('ok', false, 'error', 'Matrícula ou PIN inválidos');
  end if;
  return jsonb_build_object('ok', true, 'employee', e.full_name, 'photo_url', e.photo_url,
                            'next', public.timeclock_next_types(e.id));
end $$;

create or replace function public.register_timeclock_device(p_name text, p_type text, p_location text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_token text := encode(extensions.gen_random_bytes(32), 'hex'); v_id uuid;
begin
  perform public.require_perm('timeclock.manage');
  insert into public.time_clock_devices(name, device_type, token_hash, location_note)
  values (p_name, p_type, encode(extensions.digest(v_token, 'sha256'), 'hex'), p_location) returning id into v_id;
  -- o token é exibido uma única vez
  return jsonb_build_object('id', v_id, 'token', v_token);
end $$;

create or replace function public.my_timeclock_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_emp uuid := public.my_employee_id();
begin
  if v_emp is null then return jsonb_build_object('linked', false); end if;
  return jsonb_build_object('linked', true, 'employee_id', v_emp,
    'next', public.timeclock_next_types(v_emp),
    'today', coalesce((select jsonb_agg(to_jsonb(r) - 'prev_hash' order by punched_at)
                         from public.time_clock_records r
                        where employee_id = v_emp and status = 'valido'
                          and work_date >= current_date - 1), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------
-- Ajustes: solicitação e aprovação
-- ---------------------------------------------------------------------
create or replace function public.request_time_adjustment(
  p_employee uuid, p_type text, p_work_date date, p_punch_type text,
  p_requested_time timestamptz, p_target uuid, p_justification text, p_attachment text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not (p_employee = public.my_employee_id() or public.has_perm('timeclock.manage')) then
    raise exception 'Você só pode solicitar ajustes do seu próprio ponto' using errcode = '42501';
  end if;
  if p_requested_time is not null and p_requested_time > now() then
    raise exception 'Não é possível registrar marcações futuras';
  end if;
  if p_target is not null and not exists (select 1 from public.time_clock_records
       where id = p_target and employee_id = p_employee and status = 'valido') then
    raise exception 'Marcação de referência inválida';
  end if;
  insert into public.time_adjustments(employee_id, adjustment_type, target_record_id, work_date, punch_type,
                                      requested_time, justification, attachment_path)
  values (p_employee, p_type, p_target, p_work_date, p_punch_type, p_requested_time, p_justification, p_attachment)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.review_time_adjustment(p_id uuid, p_approve boolean, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a public.time_adjustments; t public.time_clock_records; v_type text;
begin
  perform public.require_perm('timeclock.manage');
  select * into a from public.time_adjustments where id = p_id for update;
  if not found then raise exception 'Solicitação não encontrada'; end if;
  if a.status <> 'pendente' then raise exception 'Solicitação já analisada'; end if;
  if a.employee_id = public.my_employee_id() and not exists (select 1 from public.users where id = auth.uid() and role_code = 'admin') then
    raise exception 'Você não pode aprovar ajustes do seu próprio ponto' using errcode = '42501';
  end if;
  if not p_approve and coalesce(length(trim(p_notes)),0) < 3 then
    raise exception 'Informe o motivo da rejeição';
  end if;

  update public.time_adjustments set status = case when p_approve then 'aprovado' else 'rejeitado' end,
         reviewed_by = auth.uid(), reviewed_at = now(), review_notes = p_notes where id = p_id;
  if not p_approve then
    perform public.log_action('TIMECLOCK_ADJUST_REJECT', 'time_adjustments', p_id::text, null, to_jsonb(a), p_notes);
    return;
  end if;

  perform set_config('app.timeclock_adjust', 'on', true);
  if a.target_record_id is not null then
    select * into t from public.time_clock_records where id = a.target_record_id;
    update public.time_clock_records set status = 'anulado', voided_at = now(), voided_by = auth.uid(),
           void_reason = 'Ajuste ' || p_id::text || ': ' || a.justification
     where id = a.target_record_id and status = 'valido';
  end if;
  if a.adjustment_type in ('incluir','alterar') then
    v_type := coalesce(a.punch_type, t.punch_type);
    perform public._timeclock_insert(a.employee_id, v_type, 'ajuste', null, a.requested_time, a.work_date, a.id);
  end if;
  perform set_config('app.timeclock_adjust', 'off', true);
  perform public.log_action('TIMECLOCK_ADJUST_APPROVE', 'time_adjustments', p_id::text, to_jsonb(t), to_jsonb(a), p_notes);
end $$;

-- Verificação de integridade da cadeia de hashes
create or replace function public.timeclock_verify_chain() returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare r record; v_prev text := null; v_bad int := 0; v_total int := 0; v_first_bad bigint;
begin
  perform public.require_perm('timeclock.manage');
  for r in select * from public.time_clock_records order by nsr loop
    v_total := v_total + 1;
    if r.prev_hash is distinct from v_prev or r.record_hash <> encode(extensions.digest(coalesce(r.prev_hash,'') || '|' || r.nsr || '|' || r.employee_id || '|' ||
         to_char(r.punched_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '|' || r.punch_type, 'sha256'), 'hex') then
      v_bad := v_bad + 1; v_first_bad := coalesce(v_first_bad, r.nsr);
    end if;
    v_prev := r.record_hash;
  end loop;
  return jsonb_build_object('total', v_total, 'invalid', v_bad, 'first_invalid_nsr', v_first_bad, 'ok', v_bad = 0);
end $$;

-- ---------------------------------------------------------------------
-- Cálculo da jornada
-- ---------------------------------------------------------------------
create or replace function public.night_minutes(p_a timestamptz, p_b timestamptz, p_tz text, p_start time, p_end time)
returns int language plpgsql immutable as $$
declare v_total numeric := 0; d date; ws timestamptz; we timestamptz;
begin
  if p_b <= p_a then return 0; end if;
  for d in select generate_series((p_a at time zone p_tz)::date - 1, (p_b at time zone p_tz)::date, interval '1 day')::date loop
    ws := (d + p_start) at time zone p_tz;
    we := (d + 1 + p_end) at time zone p_tz;
    v_total := v_total + greatest(0, extract(epoch from (least(p_b, we) - greatest(p_a, ws))));
  end loop;
  return floor(v_total / 60)::int;
end $$;

-- Jornada prevista para um funcionário num dia
create or replace function public.expected_shift(p_employee uuid, p_date date)
returns table(expected_minutes int, start_time time, end_time time, break_minutes int, reason text)
language plpgsql stable security definer set search_path = public as $$
declare e public.employees; sc public.schedules; sa public.shift_assignments; v_day jsonb; v_leave text;
        v_start time; v_end time; v_break int; v_min int;
begin
  select * into e from public.employees where id = p_employee;
  if p_date < e.hire_date or (e.termination_date is not null and p_date > e.termination_date) then
    return query select 0, null::time, null::time, 0, 'fora_contrato'; return;
  end if;
  select leave_type into v_leave from public.employee_leaves
   where employee_id = p_employee and status in ('aprovado','concluido') and p_date between start_date and end_date
     and leave_type <> 'falta_injustificada'
   limit 1;
  if v_leave is not null then return query select 0, null::time, null::time, 0, v_leave; return; end if;

  select * into sa from public.shift_assignments where employee_id = p_employee and work_date = p_date;
  if found then
    if sa.is_day_off then return query select 0, null::time, null::time, 0, 'folga'; return; end if;
    v_start := sa.start_time; v_end := sa.end_time; v_break := sa.break_minutes;
  else
    if exists (select 1 from public.holidays where day = p_date) then
      return query select 0, null::time, null::time, 0, 'feriado'; return;
    end if;
    select * into sc from public.schedules where id = e.schedule_id;
    if not found then return query select 0, null::time, null::time, 0, 'sem_jornada'; return; end if;
    if sc.schedule_type = '12x36' and sc.cycle_reference_date is not null then
      if ((p_date - sc.cycle_reference_date) % 2) <> 0 then
        return query select 0, null::time, null::time, 0, 'folga'; return;
      end if;
      v_start := sc.cycle_start; v_end := sc.cycle_end; v_break := coalesce(sc.cycle_break_minutes, 60);
    else
      v_day := sc.days -> extract(dow from p_date)::int::text;
      if v_day is null or coalesce((v_day->>'off')::boolean, false) then
        return query select 0, null::time, null::time, 0, 'folga'; return;
      end if;
      v_start := (v_day->>'start')::time; v_end := (v_day->>'end')::time;
      v_break := coalesce((v_day->>'break_minutes')::int, 0);
    end if;
  end if;
  v_min := (extract(epoch from (v_end - v_start)) / 60)::int;
  if v_min <= 0 then v_min := v_min + 1440; end if; -- turno que vira a noite
  return query select greatest(v_min - v_break, 0), v_start, v_end, v_break, 'jornada';
end $$;

create or replace function public.timeclock_calc(p_employee uuid, p_start date, p_end date)
returns table(
  work_date date, weekday int, day_reason text, expected_minutes int, scheduled_start time, scheduled_end time,
  first_in timestamptz, last_out timestamptz, worked_minutes int, break_minutes int, late_minutes int,
  early_leave_minutes int, overtime_minutes int, overtime_rate numeric, deficit_minutes int,
  absence boolean, night_minutes int, incomplete boolean, punches jsonb
) language plpgsql stable security definer set search_path = public as $$
declare
  s public.company_settings; d date; ex record; r record;
  v_in timestamptz; v_bstart timestamptz; v_worked numeric; v_break numeric; v_night int;
  v_first timestamptz; v_last timestamptz; v_late int; v_early int; v_diff int; v_count int;
  v_punches jsonb; v_incomplete boolean; v_sched_start timestamptz; v_sched_end timestamptz;
  v_is_special boolean;
begin
  if not (public.has_perm('timeclock.view') or p_employee = public.my_employee_id()) then
    raise exception 'Permissão negada' using errcode = '42501';
  end if;
  select * into s from public.company_settings where id = 1;
  for d in select generate_series(p_start, p_end, interval '1 day')::date loop
    select * into ex from public.expected_shift(p_employee, d);
    v_in := null; v_bstart := null; v_worked := 0; v_break := 0; v_night := 0;
    v_first := null; v_last := null; v_count := 0; v_incomplete := false;
    select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'type', t.punch_type, 'at', t.punched_at, 'source', t.source, 'nsr', t.nsr)
                    order by t.punched_at), '[]'::jsonb)
      into v_punches from public.time_clock_records t
     where t.employee_id = p_employee and t.work_date = d and t.status = 'valido';
    for r in select * from public.time_clock_records t
              where t.employee_id = p_employee and t.work_date = d and t.status = 'valido' order by t.punched_at loop
      v_count := v_count + 1;
      if r.punch_type = 'entrada' then v_first := coalesce(v_first, r.punched_at); v_in := r.punched_at;
      elsif r.punch_type = 'intervalo_inicio' then
        if v_in is not null then
          v_worked := v_worked + extract(epoch from r.punched_at - v_in);
          v_night := v_night + public.night_minutes(v_in, r.punched_at, s.timezone, s.night_shift_start, s.night_shift_end);
        end if;
        v_in := null; v_bstart := r.punched_at;
      elsif r.punch_type = 'intervalo_fim' then
        if v_bstart is not null then v_break := v_break + extract(epoch from r.punched_at - v_bstart); end if;
        v_bstart := null; v_in := r.punched_at;
      elsif r.punch_type = 'saida' then
        if v_in is not null then
          v_worked := v_worked + extract(epoch from r.punched_at - v_in);
          v_night := v_night + public.night_minutes(v_in, r.punched_at, s.timezone, s.night_shift_start, s.night_shift_end);
        end if;
        v_in := null; v_last := r.punched_at;
      end if;
    end loop;
    v_incomplete := v_in is not null or v_bstart is not null;

    work_date := d; weekday := extract(dow from d)::int; day_reason := ex.reason;
    expected_minutes := ex.expected_minutes; scheduled_start := ex.start_time; scheduled_end := ex.end_time;
    first_in := v_first; last_out := v_last;
    worked_minutes := floor(v_worked / 60)::int; break_minutes := floor(v_break / 60)::int;
    night_minutes := v_night; incomplete := v_incomplete; punches := v_punches;

    v_late := 0; v_early := 0;
    if ex.start_time is not null and v_first is not null then
      v_sched_start := (d + ex.start_time) at time zone s.timezone;
      v_late := greatest(0, floor(extract(epoch from v_first - v_sched_start) / 60)::int);
      if v_late <= s.timeclock_tolerance_per_mark_min then v_late := 0; end if;
    end if;
    if ex.end_time is not null and v_last is not null then
      v_sched_end := (d + ex.end_time) at time zone s.timezone;
      if ex.end_time <= ex.start_time then v_sched_end := v_sched_end + interval '1 day'; end if;
      v_early := greatest(0, floor(extract(epoch from v_sched_end - v_last) / 60)::int);
      if v_early <= s.timeclock_tolerance_per_mark_min then v_early := 0; end if;
    end if;
    late_minutes := v_late; early_leave_minutes := v_early;

    absence := ex.expected_minutes > 0 and v_count = 0 and d < (now() at time zone s.timezone)::date;
    v_is_special := extract(dow from d) = 0 or exists (select 1 from public.holidays h where h.day = d);

    if v_incomplete or (d >= (now() at time zone s.timezone)::date and v_count > 0 and v_last is null) then
      overtime_minutes := 0; deficit_minutes := 0; overtime_rate := 0;
    else
      v_diff := worked_minutes - ex.expected_minutes;
      if abs(v_diff) <= s.timeclock_tolerance_daily_min and ex.expected_minutes > 0 then v_diff := 0; end if;
      if d >= (now() at time zone s.timezone)::date and v_count = 0 then v_diff := 0; end if;
      overtime_minutes := greatest(v_diff, 0);
      -- faltas integrais são tratadas à parte (absence), sem duplicar no déficit
      deficit_minutes := case when absence then 0 else greatest(-v_diff, 0) end;
      overtime_rate := case when overtime_minutes = 0 then 0
                            when v_is_special and ex.expected_minutes = 0 then s.overtime_rate_sunday_holiday
                            else s.overtime_rate_weekday end;
    end if;
    return next;
  end loop;
end $$;

create or replace function public.timeclock_summary(p_employee uuid, p_start date, p_end date) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'expected_minutes', coalesce(sum(expected_minutes),0),
    'worked_minutes', coalesce(sum(worked_minutes),0),
    'break_minutes', coalesce(sum(break_minutes),0),
    'overtime_minutes', coalesce(sum(overtime_minutes),0),
    'overtime_50_minutes', coalesce(sum(overtime_minutes) filter (where overtime_rate < 100),0),
    'overtime_100_minutes', coalesce(sum(overtime_minutes) filter (where overtime_rate >= 100),0),
    'deficit_minutes', coalesce(sum(deficit_minutes),0),
    'late_minutes', coalesce(sum(late_minutes),0),
    'early_leave_minutes', coalesce(sum(early_leave_minutes),0),
    'absences', count(*) filter (where absence),
    'night_minutes', coalesce(sum(night_minutes),0),
    'incomplete_days', count(*) filter (where incomplete),
    'worked_days', count(*) filter (where worked_minutes > 0),
    'balance_minutes', coalesce(sum(overtime_minutes),0) - coalesce(sum(deficit_minutes),0)
                       - coalesce(sum(expected_minutes) filter (where absence),0)
  ) from public.timeclock_calc(p_employee, p_start, p_end)
$$;

-- Banco de horas: saldo = (extras destinadas ao banco) − (débitos/faltas no período) + lançamentos manuais
create or replace function public.hour_bank_balance(p_employee uuid, p_until date default current_date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.company_settings; e public.employees; v_from date; v_sum jsonb; v_manual int; v_paid_ot int;
begin
  if not (public.has_perm('timeclock.view') or p_employee = public.my_employee_id()) then
    raise exception 'Permissão negada' using errcode = '42501';
  end if;
  select * into s from public.company_settings where id = 1;
  select * into e from public.employees where id = p_employee;
  v_from := greatest(e.hire_date, coalesce(s.hour_bank_start_date, e.hire_date), p_until - 365);
  v_sum := public.timeclock_summary(p_employee, v_from, p_until);
  select coalesce(sum(minutes),0) into v_manual from public.hour_bank_entries
   where employee_id = p_employee and entry_date between v_from and p_until;
  -- extras aprovadas para pagamento saem do banco
  select coalesce(sum(minutes),0) into v_paid_ot from public.overtime_records
   where employee_id = p_employee and work_date between v_from and p_until and status = 'aprovado' and destination = 'pagamento';
  return jsonb_build_object('from', v_from, 'until', p_until, 'enabled', s.hour_bank_enabled,
    'calculated_minutes', (v_sum->>'balance_minutes')::int,
    'paid_overtime_minutes', v_paid_ot,
    'manual_minutes', v_manual,
    'balance_minutes', case when s.hour_bank_enabled then (v_sum->>'balance_minutes')::int - v_paid_ot + v_manual else 0 end);
end $$;

-- Apura horas extras do período em overtime_records (pendentes de aprovação)
create or replace function public.generate_overtime_records(p_start date, p_end date, p_destination text default 'pagamento')
returns int language plpgsql security definer set search_path = public as $$
declare e record; c record; v_n int := 0;
begin
  perform public.require_perm('timeclock.manage');
  for e in select id from public.employees where status <> 'desligado' or termination_date >= p_start loop
    for c in select * from public.timeclock_calc(e.id, p_start, p_end) where overtime_minutes > 0 loop
      insert into public.overtime_records(employee_id, work_date, minutes, rate_percent, destination)
      values (e.id, c.work_date, c.overtime_minutes, c.overtime_rate, p_destination)
      on conflict (employee_id, work_date) do update set minutes = excluded.minutes, rate_percent = excluded.rate_percent
        where public.overtime_records.status = 'pendente';
      v_n := v_n + 1;
    end loop;
  end loop;
  return v_n;
end $$;

create or replace function public.review_overtime(p_ids uuid[], p_approve boolean, p_destination text default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  perform public.require_perm('timeclock.manage');
  update public.overtime_records set status = case when p_approve then 'aprovado' else 'rejeitado' end,
         destination = coalesce(p_destination, destination), approved_by = auth.uid(), approved_at = now()
   where id = any(p_ids) and status = 'pendente';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Quem está trabalhando agora
create or replace function public.employees_presence() returns table(
  employee_id uuid, full_name text, department text, state text, since timestamptz
) language sql stable security definer set search_path = public as $$
  select e.id, e.full_name, d.name,
    case
      when e.status in ('ferias','afastado') then e.status
      when lr.punch_type in ('entrada','intervalo_fim') and now() - lr.punched_at < interval '18 hours' then 'trabalhando'
      when lr.punch_type = 'intervalo_inicio' and now() - lr.punched_at < interval '18 hours' then 'intervalo'
      when (select es.expected_minutes from public.expected_shift(e.id, (now() at time zone (select timezone from public.company_settings where id=1))::date) es) > 0
           and (lr.work_date is null or lr.work_date < (now() at time zone (select timezone from public.company_settings where id=1))::date) then 'ausente'
      else 'fora_do_turno'
    end, lr.punched_at
  from public.employees e
  left join public.departments d on d.id = e.department_id
  left join lateral (select * from public.time_clock_records t where t.employee_id = e.id and t.status = 'valido'
                     order by t.punched_at desc limit 1) lr on true
  where e.status <> 'desligado' and (public.has_perm('hr.view') or public.has_perm('dashboard.view') or public.has_perm('timeclock.view'))
$$;
