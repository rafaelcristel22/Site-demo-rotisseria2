-- =====================================================================
-- 0002 RH — departamentos, cargos, escalas, funcionários e históricos
-- =====================================================================
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  description text,
  manager_employee_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger departments_updated before update on public.departments
  for each row execute function public.tg_set_updated_at();

create table public.positions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  department_id uuid references public.departments(id),
  cbo text,                                 -- Classificação Brasileira de Ocupações
  base_salary numeric(12,2) not null default 0 check (base_salary >= 0),
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, department_id)
);
create trigger positions_updated before update on public.positions
  for each row execute function public.tg_set_updated_at();

-- Jornadas/escalas: dias da semana 0=domingo … 6=sábado
-- days = {"1":{"start":"08:00","end":"17:00","break_minutes":60}, ...}; dia ausente = folga
create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  schedule_type text not null default 'semanal' check (schedule_type in ('semanal','12x36','personalizada')),
  days jsonb not null default '{}'::jsonb,
  -- 12x36: data de referência de um dia trabalhado
  cycle_reference_date date,
  cycle_start time,
  cycle_end time,
  cycle_break_minutes int default 60,
  min_break_minutes int not null default 60,  -- CLT art. 71: jornadas > 6h exigem 1h
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger schedules_updated before update on public.schedules
  for each row execute function public.tg_set_updated_at();

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references public.users(id) on delete set null,
  code text unique not null,                  -- matrícula (usada no quiosque de ponto)
  full_name text not null,
  photo_url text,
  cpf text unique,
  rg text,
  birth_date date,
  phone text,
  email text,
  address jsonb not null default '{}'::jsonb,
  department_id uuid references public.departments(id),
  position_id uuid references public.positions(id),
  schedule_id uuid references public.schedules(id),
  hire_date date not null default current_date,
  termination_date date,
  contract_type text not null default 'clt' check (contract_type in ('clt','experiencia','temporario','intermitente','estagio','pj','autonomo')),
  salary numeric(12,2) not null default 0 check (salary >= 0),
  salary_type text not null default 'mensal' check (salary_type in ('mensal','horista','diarista')),
  commission_percent numeric(5,2) not null default 0,
  dependents int not null default 0,
  status text not null default 'ativo' check (status in ('ativo','ferias','afastado','desligado')),
  emergency_contact jsonb not null default '{}'::jsonb,  -- {name, phone, relationship}
  bank_info jsonb not null default '{}'::jsonb,
  pis text,
  ctps text,
  pin_hash text,                              -- PIN do ponto (bcrypt)
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cpf_format check (cpf is null or cpf ~ '^[0-9]{11}$')
);
create index employees_dept_idx on public.employees(department_id);
create index employees_status_idx on public.employees(status);
create trigger employees_updated before update on public.employees
  for each row execute function public.tg_set_updated_at();
create trigger audit_employees after insert or update or delete on public.employees
  for each row execute function public.tg_audit_row();

alter table public.departments add constraint departments_manager_fk
  foreign key (manager_employee_id) references public.employees(id) on delete set null;

create or replace function public.my_employee_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.employees where user_id = auth.uid()
$$;

create or replace function public.my_department_id() returns uuid
language sql stable security definer set search_path = public as $$
  select department_id from public.employees where user_id = auth.uid()
$$;

-- Validação de CPF (dígitos verificadores)
create or replace function public.cpf_is_valid(p text) returns boolean
language plpgsql immutable as $$
declare d int[]; s int; r int; i int;
begin
  if p is null or p !~ '^[0-9]{11}$' or p ~ '^(.)\1{10}$' then return false; end if;
  d := array(select substr(p, g, 1)::int from generate_series(1,11) g);
  s := 0; for i in 1..9 loop s := s + d[i] * (11 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  if r <> d[10] then return false; end if;
  s := 0; for i in 1..10 loop s := s + d[i] * (12 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  return r = d[11];
end $$;

create or replace function public.tg_employee_validate() returns trigger
language plpgsql as $$
begin
  if new.cpf is not null and not public.cpf_is_valid(new.cpf) then
    raise exception 'CPF inválido';
  end if;
  if new.termination_date is not null and new.termination_date < new.hire_date then
    raise exception 'Data de desligamento anterior à admissão';
  end if;
  if new.termination_date is not null and new.status <> 'desligado' then new.status := 'desligado'; end if;
  return new;
end $$;
create trigger employees_validate before insert or update on public.employees
  for each row execute function public.tg_employee_validate();

-- Histórico de cargos e salários (preenchido automaticamente)
create table public.employee_position_history (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  position_id uuid references public.positions(id),
  department_id uuid references public.departments(id),
  started_at date not null default current_date,
  ended_at date,
  changed_by uuid,
  notes text,
  created_at timestamptz not null default now()
);
create table public.employee_salary_history (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  old_salary numeric(12,2),
  new_salary numeric(12,2) not null,
  effective_date date not null default current_date,
  reason text,
  changed_by uuid,
  created_at timestamptz not null default now()
);
create index eph_emp_idx on public.employee_position_history(employee_id);
create index esh_emp_idx on public.employee_salary_history(employee_id);

create or replace function public.tg_employee_history() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.employee_position_history(employee_id, position_id, department_id, started_at, changed_by)
    values (new.id, new.position_id, new.department_id, new.hire_date, auth.uid());
    insert into public.employee_salary_history(employee_id, old_salary, new_salary, effective_date, reason, changed_by)
    values (new.id, null, new.salary, new.hire_date, 'Admissão', auth.uid());
  else
    if new.position_id is distinct from old.position_id or new.department_id is distinct from old.department_id then
      update public.employee_position_history set ended_at = current_date
       where employee_id = new.id and ended_at is null;
      insert into public.employee_position_history(employee_id, position_id, department_id, changed_by)
      values (new.id, new.position_id, new.department_id, auth.uid());
    end if;
    if new.salary is distinct from old.salary then
      insert into public.employee_salary_history(employee_id, old_salary, new_salary, reason, changed_by)
      values (new.id, old.salary, new.salary, coalesce(current_setting('app.salary_reason', true), 'Alteração salarial'), auth.uid());
    end if;
  end if;
  return new;
end $$;
create trigger employees_history after insert or update on public.employees
  for each row execute function public.tg_employee_history();

-- Contratos
create table public.employee_contracts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  contract_type text not null,
  start_date date not null,
  end_date date,
  weekly_hours numeric(5,2),
  salary numeric(12,2),
  document_path text,
  status text not null default 'vigente' check (status in ('vigente','encerrado','rescindido')),
  notes text,
  created_at timestamptz not null default now()
);

-- Férias e afastamentos
create table public.employee_leaves (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  leave_type text not null check (leave_type in ('ferias','atestado','licenca_maternidade','licenca_paternidade','afastamento_inss','falta_justificada','falta_injustificada','folga','suspensao','outro')),
  start_date date not null,
  end_date date not null,
  days int generated always as (end_date - start_date + 1) stored,
  -- férias: período aquisitivo
  acquisition_start date,
  acquisition_end date,
  sell_days int not null default 0,          -- abono pecuniário
  paid boolean not null default true,        -- remunerado?
  status text not null default 'solicitado' check (status in ('solicitado','aprovado','rejeitado','cancelado','concluido')),
  document_path text,
  notes text,
  requested_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index leaves_emp_idx on public.employee_leaves(employee_id, start_date);
create trigger audit_leaves after insert or update or delete on public.employee_leaves
  for each row execute function public.tg_audit_row();

-- Advertências e ocorrências
create table public.employee_occurrences (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  occurrence_type text not null check (occurrence_type in ('advertencia_verbal','advertencia_escrita','suspensao','elogio','ocorrencia','acidente')),
  occurred_on date not null default current_date,
  description text not null,
  acknowledged boolean not null default false,
  document_path text,
  registered_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create trigger audit_occurrences after insert or update or delete on public.employee_occurrences
  for each row execute function public.tg_audit_row();

-- Documentos (arquivos no bucket privado employee-documents)
create table public.employee_documents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  document_type text not null,
  title text not null,
  storage_path text not null,
  expires_on date,
  uploaded_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- Avaliação de desempenho
create table public.employee_evaluations (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  period_label text not null,
  evaluated_on date not null default current_date,
  evaluator_id uuid default auth.uid(),
  scores jsonb not null default '{}'::jsonb,   -- {pontualidade:4, qualidade:5, ...} (1..5)
  overall_score numeric(4,2),
  strengths text,
  improvements text,
  goals text,
  created_at timestamptz not null default now()
);
create or replace function public.tg_eval_score() returns trigger language plpgsql as $$
begin
  select round(avg(value::numeric), 2) into new.overall_score from jsonb_each_text(new.scores);
  return new;
end $$;
create trigger eval_score before insert or update on public.employee_evaluations
  for each row execute function public.tg_eval_score();

-- Treinamentos
create table public.trainings (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  is_mandatory boolean not null default false,
  validity_months int,
  created_at timestamptz not null default now()
);
create table public.employee_trainings (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  training_id uuid not null references public.trainings(id) on delete cascade,
  completed_on date,
  expires_on date,
  certificate_path text,
  status text not null default 'pendente' check (status in ('pendente','concluido','vencido')),
  created_at timestamptz not null default now(),
  unique (employee_id, training_id, completed_on)
);

-- Escalas específicas (sobrepõe a jornada num dia)
create table public.shift_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  work_date date not null,
  start_time time,
  end_time time,
  break_minutes int not null default 0,
  is_day_off boolean not null default false,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (employee_id, work_date)
);

-- Calendário de RH (férias, afastamentos, aniversários, escalas, treinamentos)
create or replace function public.hr_calendar(p_start date, p_end date) returns table(
  event_date date, end_date date, event_type text, title text, employee_id uuid, employee_name text
) language sql stable security definer set search_path = public as $$
  select l.start_date, l.end_date, l.leave_type, initcap(replace(l.leave_type,'_',' ')) || ' — ' || e.full_name, e.id, e.full_name
    from public.employee_leaves l join public.employees e on e.id = l.employee_id
   where public.has_perm('hr.view') and l.status in ('aprovado','concluido','solicitado')
     and l.start_date <= p_end and l.end_date >= p_start
  union all
  select make_date(extract(year from d)::int, extract(month from e.birth_date)::int, extract(day from e.birth_date)::int),
         null::date, 'aniversario', 'Aniversário — ' || e.full_name, e.id, e.full_name
    from public.employees e
    cross join generate_series(date_trunc('year', p_start), date_trunc('year', p_end), interval '1 year') d
   where public.has_perm('hr.view') and e.birth_date is not null and e.status <> 'desligado'
     and not (extract(month from e.birth_date) = 2 and extract(day from e.birth_date) = 29)
     and make_date(extract(year from d)::int, extract(month from e.birth_date)::int, extract(day from e.birth_date)::int) between p_start and p_end
  union all
  select s.work_date, null, case when s.is_day_off then 'folga' else 'escala' end,
         case when s.is_day_off then 'Folga — ' else 'Escala ' || to_char(s.start_time,'HH24:MI') || '-' || to_char(s.end_time,'HH24:MI') || ' — ' end || e.full_name,
         e.id, e.full_name
    from public.shift_assignments s join public.employees e on e.id = s.employee_id
   where public.has_perm('hr.view') and s.work_date between p_start and p_end
  union all
  select h.day, null, 'feriado', h.name, null, null from public.holidays h where h.day between p_start and p_end
  union all
  select t.expires_on, null, 'treinamento_vencendo', 'Treinamento vence: ' || tr.title || ' — ' || e.full_name, e.id, e.full_name
    from public.employee_trainings t join public.trainings tr on tr.id = t.training_id join public.employees e on e.id = t.employee_id
   where public.has_perm('hr.view') and t.expires_on between p_start and p_end
  order by 1
$$;

-- Saldo de férias (CLT: 30 dias por período aquisitivo de 12 meses)
create or replace function public.vacation_balance(p_employee uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e public.employees; v_periods int; v_taken int; v_months int;
begin
  if not (public.has_perm('hr.view') or p_employee = public.my_employee_id()) then
    raise exception 'Permissão negada' using errcode = '42501';
  end if;
  select * into e from public.employees where id = p_employee;
  v_months := (extract(year from age(coalesce(e.termination_date, current_date), e.hire_date)) * 12
             + extract(month from age(coalesce(e.termination_date, current_date), e.hire_date)))::int;
  v_periods := v_months / 12;
  select coalesce(sum(days + sell_days), 0) into v_taken from public.employee_leaves
   where employee_id = p_employee and leave_type = 'ferias' and status in ('aprovado','concluido');
  return jsonb_build_object(
    'months_worked', v_months,
    'complete_periods', v_periods,
    'days_earned', v_periods * 30,
    'days_taken', v_taken,
    'days_available', v_periods * 30 - v_taken,
    'next_period_complete_on', (e.hire_date + make_interval(months => (v_periods + 1) * 12))::date,
    'proportional_days', round(((v_months % 12) * 2.5)::numeric, 1)
  );
end $$;

create or replace function public.set_employee_pin(p_employee uuid, p_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not (public.has_perm('hr.manage') or public.has_perm('timeclock.manage') or p_employee = public.my_employee_id()) then
    raise exception 'Permissão negada' using errcode = '42501';
  end if;
  if p_pin !~ '^[0-9]{4,8}$' then raise exception 'O PIN deve ter de 4 a 8 dígitos'; end if;
  update public.employees set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 10)) where id = p_employee;
  perform public.log_action('SET_PIN', 'employees', p_employee::text);
end $$;

create or replace function public.update_employee_salary(p_employee uuid, p_salary numeric, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_perm('hr.manage');
  if p_reason is null or length(trim(p_reason)) < 3 then raise exception 'Informe o motivo da alteração salarial'; end if;
  perform set_config('app.salary_reason', p_reason, true);
  update public.employees set salary = p_salary where id = p_employee;
end $$;
