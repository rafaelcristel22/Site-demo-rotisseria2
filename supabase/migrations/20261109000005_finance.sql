-- =====================================================================
-- 0005 FINANCEIRO — contas, categorias (DRE), formas de pagamento,
-- fornecedores, lançamentos, contas a pagar/receber e despesas.
-- =====================================================================
create table public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  account_type text not null check (account_type in ('caixa','banco','pix','cartao','carteira','outro')),
  bank_name text,
  agency text,
  account_number text,
  pix_key text,
  initial_balance numeric(14,2) not null default 0,
  initial_balance_date date not null default current_date,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create trigger audit_fin_accounts after insert or update or delete on public.financial_accounts
  for each row execute function public.tg_audit_row();

create table public.financial_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('receita','despesa')),
  dre_group text not null check (dre_group in ('receita_vendas','outras_receitas','deducoes','cmv','pessoal','ocupacao',
    'utilidades','administrativas','marketing','impostos','taxas_financeiras','manutencao','despesas_financeiras','investimentos','outras_despesas')),
  cost_behavior text not null default 'fixo' check (cost_behavior in ('fixo','variavel')),
  is_system boolean not null default false,
  is_active boolean not null default true,
  unique (name, kind)
);

create table public.payment_methods (
  code text primary key,
  name text not null,
  method_type text not null check (method_type in ('dinheiro','pix','credito','debito','vale','credito_interno','outro')),
  account_id uuid references public.financial_accounts(id),
  fee_percent numeric(6,3) not null default 0,
  fee_fixed numeric(10,2) not null default 0,
  settlement_days int not null default 0,
  available_pos boolean not null default true,
  available_online boolean not null default true,
  allows_change boolean not null default false,
  is_active boolean not null default true,
  sort_order int not null default 0
);
create trigger audit_payment_methods after insert or update or delete on public.payment_methods
  for each row execute function public.tg_audit_row();

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  trade_name text,
  document text unique,                 -- CNPJ/CPF somente dígitos
  state_registration text,
  contact_name text,
  phone text,
  whatsapp text,
  email text,
  address jsonb not null default '{}'::jsonb,
  payment_terms text,
  delivery_days int,
  categories text[] not null default '{}',
  rating numeric(3,1),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger suppliers_updated before update on public.suppliers
  for each row execute function public.tg_set_updated_at();
create trigger audit_suppliers after insert or update or delete on public.suppliers
  for each row execute function public.tg_audit_row();
alter table public.ingredients add constraint ingredients_supplier_fk
  foreign key (default_supplier_id) references public.suppliers(id) on delete set null;

create table public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.financial_accounts(id),
  transaction_type text not null check (transaction_type in ('entrada','saida')),
  amount numeric(14,2) not null check (amount > 0),
  occurred_on date not null default current_date,
  competence_date date not null default current_date,
  category_id uuid references public.financial_categories(id),
  description text not null,
  reference_type text,              -- venda, conta_pagar, conta_receber, despesa, sangria, transferencia, manual, estorno
  reference_id text,
  transfer_group uuid,
  status text not null default 'confirmado' check (status in ('confirmado','estornado')),
  reversal_of uuid references public.financial_transactions(id),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index fin_tx_account_idx on public.financial_transactions(account_id, occurred_on);
create index fin_tx_ref_idx on public.financial_transactions(reference_type, reference_id);
create index fin_tx_date_idx on public.financial_transactions(occurred_on);
create trigger audit_fin_tx after insert or update or delete on public.financial_transactions
  for each row execute function public.tg_audit_row();
create or replace function public.tg_fin_tx_protect() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Lançamentos financeiros não podem ser excluídos; utilize estorno'; end if;
  if new.amount <> old.amount or new.account_id <> old.account_id or new.transaction_type <> old.transaction_type
     or new.occurred_on <> old.occurred_on then
    raise exception 'Lançamentos financeiros são imutáveis; utilize estorno';
  end if;
  return new;
end $$;
create trigger fin_tx_protect before update or delete on public.financial_transactions
  for each row execute function public.tg_fin_tx_protect();

create table public.accounts_payable (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references public.suppliers(id),
  category_id uuid references public.financial_categories(id),
  payable_type text not null default 'outros' check (payable_type in
    ('fornecedor','aluguel','energia','agua','internet','gas','salarios','impostos','manutencao','servicos','outros')),
  description text not null,
  document_number text,
  issue_date date not null default current_date,
  due_date date not null,
  competence_date date not null default current_date,
  amount numeric(14,2) not null check (amount > 0),
  discount numeric(14,2) not null default 0,
  interest numeric(14,2) not null default 0,
  paid_amount numeric(14,2) not null default 0,
  status text not null default 'aberto' check (status in ('aberto','parcial','pago','cancelado')),
  paid_at date,
  account_id uuid references public.financial_accounts(id),
  installment_number int not null default 1,
  installment_total int not null default 1,
  group_id uuid,
  purchase_id uuid,
  payroll_period_id uuid,
  recurrence text not null default 'nenhuma' check (recurrence in ('nenhuma','semanal','mensal','anual')),
  attachment_path text,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ap_due_idx on public.accounts_payable(status, due_date);
create trigger ap_updated before update on public.accounts_payable
  for each row execute function public.tg_set_updated_at();
create trigger audit_ap after insert or update or delete on public.accounts_payable
  for each row execute function public.tg_audit_row();

create table public.accounts_receivable (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid,
  receivable_type text not null default 'outros' check (receivable_type in ('venda','pedido','credito_cliente','cartao','outros')),
  description text not null,
  issue_date date not null default current_date,
  due_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  received_amount numeric(14,2) not null default 0,
  status text not null default 'aberto' check (status in ('aberto','parcial','recebido','cancelado')),
  received_at date,
  account_id uuid references public.financial_accounts(id),
  category_id uuid references public.financial_categories(id),
  sale_id uuid,
  order_id uuid,
  payment_method_code text references public.payment_methods(code),
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ar_due_idx on public.accounts_receivable(status, due_date);
create trigger ar_updated before update on public.accounts_receivable
  for each row execute function public.tg_set_updated_at();
create trigger audit_ar after insert or update or delete on public.accounts_receivable
  for each row execute function public.tg_audit_row();

-- Despesas pagas à vista (gera lançamento financeiro)
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.financial_categories(id),
  supplier_id uuid references public.suppliers(id),
  account_id uuid not null references public.financial_accounts(id),
  description text not null,
  amount numeric(14,2) not null check (amount > 0),
  expense_date date not null default current_date,
  competence_date date not null default current_date,
  document_number text,
  attachment_path text,
  transaction_id uuid references public.financial_transactions(id),
  status text not null default 'confirmada' check (status in ('confirmada','estornada')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create trigger audit_expenses after insert or update or delete on public.expenses
  for each row execute function public.tg_audit_row();

create or replace function public.category_by_group(p_group text, p_kind text default 'despesa') returns uuid
language sql stable as $$
  select id from public.financial_categories where dre_group = p_group and kind = p_kind and is_active
  order by is_system desc, name limit 1
$$;

-- ---------------------------------------------------------------------
-- RPCs financeiras (todas transacionais)
-- ---------------------------------------------------------------------
create or replace function public._fin_tx(
  p_account uuid, p_type text, p_amount numeric, p_description text, p_category uuid,
  p_ref_type text, p_ref_id text, p_date date default current_date, p_competence date default null, p_group uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_amount is null or p_amount <= 0 then return null; end if;
  insert into public.financial_transactions(account_id, transaction_type, amount, occurred_on, competence_date,
         category_id, description, reference_type, reference_id, transfer_group)
  values (p_account, p_type, round(p_amount, 2), coalesce(p_date, current_date), coalesce(p_competence, p_date, current_date),
          p_category, p_description, p_ref_type, p_ref_id, p_group)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.register_transaction(
  p_account uuid, p_type text, p_amount numeric, p_description text, p_category uuid default null,
  p_date date default current_date, p_competence date default null
) returns uuid language plpgsql security definer set search_path = public as $$
begin
  perform public.require_perm('finance.manage');
  if p_type not in ('entrada','saida') then raise exception 'Tipo inválido'; end if;
  return public._fin_tx(p_account, p_type, p_amount, p_description, p_category, 'manual', null, p_date, p_competence);
end $$;

create or replace function public.transfer_between_accounts(p_from uuid, p_to uuid, p_amount numeric, p_description text, p_date date default current_date)
returns uuid language plpgsql security definer set search_path = public as $$
declare g uuid := gen_random_uuid();
begin
  perform public.require_perm('finance.manage');
  if p_from = p_to then raise exception 'Contas de origem e destino iguais'; end if;
  perform public._fin_tx(p_from, 'saida', p_amount, 'Transferência: ' || p_description, null, 'transferencia', g::text, p_date, p_date, g);
  perform public._fin_tx(p_to, 'entrada', p_amount, 'Transferência: ' || p_description, null, 'transferencia', g::text, p_date, p_date, g);
  return g;
end $$;

create or replace function public.reverse_transaction(p_id uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t public.financial_transactions; v_id uuid;
begin
  perform public.require_perm('finance.manage');
  if coalesce(length(trim(p_reason)),0) < 5 then raise exception 'Informe o motivo do estorno'; end if;
  select * into t from public.financial_transactions where id = p_id for update;
  if t.status <> 'confirmado' then raise exception 'Lançamento já estornado'; end if;
  if t.reversal_of is not null then raise exception 'Não é possível estornar um estorno'; end if;
  update public.financial_transactions set status = 'estornado' where id = p_id;
  insert into public.financial_transactions(account_id, transaction_type, amount, occurred_on, competence_date, category_id,
         description, reference_type, reference_id, reversal_of, status)
  values (t.account_id, case when t.transaction_type = 'entrada' then 'saida' else 'entrada' end, t.amount, current_date,
          t.competence_date, t.category_id, 'Estorno: ' || t.description || ' — ' || p_reason, 'estorno', t.id::text, t.id, 'estornado')
  returning id into v_id;
  perform public.log_action('FIN_REVERSAL', 'financial_transactions', p_id::text, to_jsonb(t), null, p_reason);
  return v_id;
end $$;

create or replace function public.create_payable(
  p_description text, p_amount numeric, p_due date, p_category uuid, p_supplier uuid default null,
  p_type text default 'outros', p_installments int default 1, p_document text default null,
  p_competence date default null, p_recurrence text default 'nenhuma', p_notes text default null,
  p_purchase uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare g uuid := gen_random_uuid(); i int; v_part numeric; v_last numeric;
begin
  if not (public.has_perm('finance.manage') or (p_purchase is not null and public.has_perm('purchases.manage'))) then
    raise exception 'Permissão negada: finance.manage' using errcode = '42501';
  end if;
  if p_installments < 1 or p_installments > 48 then raise exception 'Número de parcelas inválido'; end if;
  v_part := trunc(p_amount / p_installments, 2);
  v_last := p_amount - v_part * (p_installments - 1);
  for i in 1..p_installments loop
    insert into public.accounts_payable(supplier_id, category_id, payable_type, description, document_number, due_date,
           competence_date, amount, installment_number, installment_total, group_id, recurrence, notes, purchase_id)
    values (p_supplier, p_category, p_type,
            p_description || case when p_installments > 1 then ' (' || i || '/' || p_installments || ')' else '' end,
            p_document, (p_due + make_interval(months => i - 1))::date, coalesce(p_competence, p_due),
            case when i = p_installments then v_last else v_part end, i, p_installments, g, p_recurrence, p_notes, p_purchase);
  end loop;
  return g;
end $$;

create or replace function public.pay_payable(
  p_id uuid, p_account uuid, p_amount numeric default null, p_paid_on date default current_date,
  p_interest numeric default 0, p_discount numeric default 0
) returns void language plpgsql security definer set search_path = public as $$
declare ap public.accounts_payable; v_amount numeric; v_due numeric;
begin
  perform public.require_perm('finance.manage');
  select * into ap from public.accounts_payable where id = p_id for update;
  if ap.status in ('pago','cancelado') then raise exception 'Conta já % ', ap.status; end if;
  v_due := ap.amount + ap.interest + coalesce(p_interest,0) - ap.discount - coalesce(p_discount,0) - ap.paid_amount;
  v_amount := coalesce(p_amount, v_due);
  if v_amount <= 0 or v_amount > v_due + 0.001 then raise exception 'Valor de pagamento inválido (saldo: %)', v_due; end if;
  perform public._fin_tx(p_account, 'saida', v_amount, 'Pagamento: ' || ap.description, ap.category_id,
                         'conta_pagar', ap.id::text, p_paid_on, ap.competence_date);
  update public.accounts_payable set
    paid_amount = paid_amount + v_amount,
    interest = interest + coalesce(p_interest,0), discount = discount + coalesce(p_discount,0),
    status = case when abs(v_due - v_amount) < 0.005 then 'pago' else 'parcial' end,
    paid_at = p_paid_on, account_id = p_account
  where id = p_id;
  -- recorrência: gera a próxima ao quitar
  if ap.recurrence <> 'nenhuma' and abs(v_due - v_amount) < 0.005 then
    insert into public.accounts_payable(supplier_id, category_id, payable_type, description, document_number, due_date,
           competence_date, amount, recurrence, notes)
    values (ap.supplier_id, ap.category_id, ap.payable_type, ap.description, null,
            (ap.due_date + case ap.recurrence when 'semanal' then interval '7 days' when 'mensal' then interval '1 month' else interval '1 year' end)::date,
            (ap.competence_date + case ap.recurrence when 'semanal' then interval '7 days' when 'mensal' then interval '1 month' else interval '1 year' end)::date,
            ap.amount, ap.recurrence, ap.notes);
  end if;
end $$;

create or replace function public.cancel_payable(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_perm('finance.manage');
  if coalesce(length(trim(p_reason)),0) < 5 then raise exception 'Informe o motivo do cancelamento'; end if;
  update public.accounts_payable set status = 'cancelado', notes = coalesce(notes || E'\n', '') || 'Cancelada: ' || p_reason
   where id = p_id and status in ('aberto') ;
  if not found then raise exception 'Somente contas em aberto sem pagamentos podem ser canceladas'; end if;
end $$;

create or replace function public.receive_receivable(p_id uuid, p_account uuid, p_amount numeric default null, p_received_on date default current_date)
returns void language plpgsql security definer set search_path = public as $$
declare ar public.accounts_receivable; v_amount numeric; v_due numeric;
begin
  perform public.require_perm('finance.manage');
  select * into ar from public.accounts_receivable where id = p_id for update;
  if ar.status in ('recebido','cancelado') then raise exception 'Título já %', ar.status; end if;
  v_due := ar.amount - ar.received_amount;
  v_amount := coalesce(p_amount, v_due);
  if v_amount <= 0 or v_amount > v_due + 0.001 then raise exception 'Valor inválido (saldo: %)', v_due; end if;
  perform public._fin_tx(coalesce(p_account, ar.account_id), 'entrada', v_amount, 'Recebimento: ' || ar.description,
                         coalesce(ar.category_id, public.category_by_group('receita_vendas','receita')),
                         'conta_receber', ar.id::text, p_received_on, ar.issue_date);
  update public.accounts_receivable set received_amount = received_amount + v_amount,
    status = case when abs(v_due - v_amount) < 0.005 then 'recebido' else 'parcial' end,
    received_at = p_received_on, account_id = coalesce(p_account, account_id)
  where id = p_id;
end $$;

create or replace function public.create_receivable(p_description text, p_amount numeric, p_due date,
  p_customer uuid default null, p_type text default 'outros', p_category uuid default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.require_perm('finance.manage');
  insert into public.accounts_receivable(customer_id, receivable_type, description, due_date, amount, category_id, notes)
  values (p_customer, p_type, p_description, p_due, p_amount, coalesce(p_category, public.category_by_group('outras_receitas','receita')), p_notes)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.register_expense(
  p_category uuid, p_account uuid, p_description text, p_amount numeric,
  p_date date default current_date, p_supplier uuid default null, p_document text default null, p_competence date default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_tx uuid; v_id uuid := gen_random_uuid();
begin
  perform public.require_perm('finance.manage');
  v_tx := public._fin_tx(p_account, 'saida', p_amount, p_description, p_category, 'despesa', v_id::text, p_date, p_competence);
  insert into public.expenses(id, category_id, supplier_id, account_id, description, amount, expense_date, competence_date, document_number, transaction_id)
  values (v_id, p_category, p_supplier, p_account, p_description, p_amount, p_date, coalesce(p_competence, p_date), p_document, v_tx);
  return v_id;
end $$;

create or replace function public.account_balances(p_until date default current_date) returns table(
  account_id uuid, name text, account_type text, balance numeric, inflow_month numeric, outflow_month numeric
) language sql stable security definer set search_path = public as $$
  select a.id, a.name, a.account_type,
    a.initial_balance + coalesce(sum(case when t.transaction_type = 'entrada' then t.amount else -t.amount end)
                                  filter (where t.occurred_on <= p_until and t.occurred_on >= a.initial_balance_date), 0),
    coalesce(sum(t.amount) filter (where t.transaction_type = 'entrada' and date_trunc('month', t.occurred_on) = date_trunc('month', p_until::timestamp)), 0),
    coalesce(sum(t.amount) filter (where t.transaction_type = 'saida' and date_trunc('month', t.occurred_on) = date_trunc('month', p_until::timestamp)), 0)
  from public.financial_accounts a
  left join public.financial_transactions t on t.account_id = a.id
  where public.has_perm('finance.view') and a.is_active
  group by a.id order by a.name
$$;
