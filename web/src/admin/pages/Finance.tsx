import { useCallback, useEffect, useState } from 'react';
import { supabase, rpc } from '../../lib/supabase';
import { money, dateBR, isoDate, pct } from '../../lib/format';
import Crud, { r, FormModal, useRefs, type FieldDef } from '../Crud';
import { Badge, Card, Modal, PageHeader, PeriodPicker, Stat, Table, Tabs, exportCSV, presetPeriod, printHTML, escapeHtml, useToast, Field } from '../ui';
import { useAuth } from '../auth';
import { RefName } from './Catalog';
import { Bars } from '../charts';

const PT: Record<string, string> = { fornecedor: 'Fornecedor', aluguel: 'Aluguel', energia: 'Energia', agua: 'Água', internet: 'Internet', gas: 'Gás', salarios: 'Salários',
  impostos: 'Impostos', manutencao: 'Manutenção', servicos: 'Serviços', outros: 'Outros' };
const d = (v: string | null) => (v ? dateBR(v + 'T12:00') : '—');

export default function Finance() {
  return (
    <div>
      <PageHeader title="Financeiro" subtitle="Contas, lançamentos, contas a pagar e a receber, despesas, fluxo de caixa e DRE." />
      <Tabs tabs={[
        { key: 'visao', label: 'Visão geral', el: () => <Overview /> },
        { key: 'pagar', label: 'Contas a pagar', el: () => <Payables /> },
        { key: 'receber', label: 'Contas a receber', el: () => <Receivables /> },
        { key: 'lancamentos', label: 'Lançamentos', el: () => <Transactions /> },
        { key: 'despesas', label: 'Despesas à vista', el: () => <Expenses /> },
        { key: 'dre', label: 'DRE gerencial', el: () => <Dre /> },
        { key: 'contas', label: 'Contas', el: () => <Crud cfg={{ table: 'financial_accounts', title: 'Contas', perm: 'finance.manage', embedded: true, order: 'name.asc',
          fields: [{ name: 'name', label: 'Nome', required: true }, { name: 'account_type', label: 'Tipo', type: 'select', required: true, options: ['caixa', 'banco', 'pix', 'cartao', 'carteira', 'outro'].map((x) => ({ value: x, label: x })) },
            { name: 'bank_name', label: 'Banco' }, { name: 'agency', label: 'Agência' }, { name: 'account_number', label: 'Conta' }, { name: 'pix_key', label: 'Chave Pix' },
            { name: 'initial_balance', label: 'Saldo inicial', type: 'money', default: 0 }, { name: 'initial_balance_date', label: 'Data do saldo inicial', type: 'date' },
            { name: 'is_active', label: 'Ativa', type: 'bool', default: true }],
          columns: [{ key: 'name', label: 'Conta' }, { key: 'account_type', label: 'Tipo' }, { key: 'bank_name', label: 'Banco' }, { key: 'is_active', label: '', render: r.active }] }} /> },
        { key: 'categorias', label: 'Categorias', el: () => <Crud cfg={{ table: 'financial_categories', title: 'Categorias', perm: 'finance.manage', embedded: true, order: 'name.asc',
          fields: [{ name: 'name', label: 'Nome', required: true }, { name: 'kind', label: 'Tipo', type: 'select', options: [{ value: 'despesa', label: 'Despesa' }, { value: 'receita', label: 'Receita' }], required: true },
            { name: 'dre_group', label: 'Grupo no DRE', type: 'select', required: true, options: ['receita_vendas', 'outras_receitas', 'cmv', 'pessoal', 'ocupacao', 'utilidades', 'administrativas', 'marketing', 'impostos', 'taxas_financeiras', 'manutencao', 'despesas_financeiras', 'investimentos', 'outras_despesas'].map((x) => ({ value: x, label: x })) },
            { name: 'cost_behavior', label: 'Comportamento', type: 'select', options: [{ value: 'fixo', label: 'Fixo' }, { value: 'variavel', label: 'Variável' }] }, { name: 'is_active', label: 'Ativa', type: 'bool', default: true }],
          columns: [{ key: 'name', label: 'Categoria' }, { key: 'kind', label: 'Tipo' }, { key: 'dre_group', label: 'DRE' }, { key: 'cost_behavior', label: 'Custo' }] }} /> },
      ]} />
    </div>
  );
}

function Overview() {
  const [acc, setAcc] = useState<any[]>([]); const [flow, setFlow] = useState<any[]>([]);
  useEffect(() => {
    rpc<any[]>('account_balances', { p_until: isoDate(new Date()) }).then(setAcc).catch(() => {});
    rpc<any[]>('report_cash_flow', { p_start: isoDate(new Date(Date.now() - 15 * 864e5)), p_end: isoDate(new Date(Date.now() + 30 * 864e5)) }).then(setFlow).catch(() => {});
  }, []);
  const total = acc.reduce((s, a) => s + Number(a.balance), 0);
  const fut = flow.filter((f) => f.day >= isoDate(new Date()));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Saldo total das contas" value={money(total)} tone={total < 0 ? 'bad' : undefined} />
        <Stat label="A receber (30 dias)" value={money(fut.reduce((s, f) => s + Number(f.projected_in), 0))} />
        <Stat label="A pagar (30 dias)" value={money(fut.reduce((s, f) => s + Number(f.projected_out), 0))} />
        <Stat label="Saldo projetado em 30 dias" value={money(total + fut.reduce((s, f) => s + Number(f.projected_in) - Number(f.projected_out), 0))} />
      </div>
      <Card title="Saldos por conta"><Table rows={acc} rowKey="account_id" cols={[{ key: 'name', label: 'Conta' }, { key: 'account_type', label: 'Tipo' },
        { key: 'inflow_month', label: 'Entradas no mês', align: 'right', render: (a) => money(a.inflow_month) }, { key: 'outflow_month', label: 'Saídas no mês', align: 'right', render: (a) => money(a.outflow_month) },
        { key: 'balance', label: 'Saldo', align: 'right', render: (a) => <b className={Number(a.balance) < 0 ? 'text-red-700' : ''}>{money(a.balance)}</b> }]} /></Card>
      <Card title="Fluxo de caixa: realizado (últimos 15 dias) e previsto (próximos 30 dias)">
        <Bars data={flow.map((f) => ({ dia: f.day, saldo: Number(f.net) + (f.day >= isoDate(new Date()) ? Number(f.projected_in) - Number(f.projected_out) : 0) }))} x="dia" y="saldo" name="Saldo do dia"
          labelFmt={(v) => v ? new Date(v + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : ''} />
        <button className="btn-outline mt-2 py-1.5 text-sm" onClick={() => exportCSV('fluxo-de-caixa', flow, { day: 'Dia', inflow: 'Entradas', outflow: 'Saídas', net: 'Líquido', projected_in: 'A receber', projected_out: 'A pagar', cumulative: 'Acumulado' })}>Exportar CSV</button>
      </Card>
    </div>
  );
}

const payFields: FieldDef[] = [
  { name: 'description', label: 'Descrição', required: true, wide: true },
  { name: 'amount', label: 'Valor total (R$)', type: 'money', required: true }, { name: 'due', label: '1º vencimento', type: 'date', required: true },
  { name: 'type', label: 'Tipo', type: 'select', default: 'outros', options: Object.entries(PT).map(([value, label]) => ({ value, label })) },
  { name: 'category', label: 'Categoria', type: 'ref', ref: { table: 'financial_categories', label: 'name', filter: { kind: 'despesa' } }, required: true },
  { name: 'supplier', label: 'Fornecedor', type: 'ref', ref: { table: 'suppliers', label: 'name' } },
  { name: 'installments', label: 'Parcelas', type: 'number', default: 1 }, { name: 'document', label: 'Nº do documento' },
  { name: 'competence', label: 'Competência', type: 'date', hint: 'Mês a que a despesa pertence (DRE)' },
  { name: 'recurrence', label: 'Recorrência', type: 'select', default: 'nenhuma', options: [{ value: 'nenhuma', label: 'Não repete' }, { value: 'mensal', label: 'Mensal' }, { value: 'semanal', label: 'Semanal' }, { value: 'anual', label: 'Anual' }] },
  { name: 'notes', label: 'Observações', type: 'textarea' },
];

function Payables() {
  const toast = useToast(); const { can } = useAuth();
  const [rows, setRows] = useState<any[]>([]); const [st, setSt] = useState('abertas'); const [nw, setNw] = useState(false); const [pay, setPay] = useState<any | null>(null);
  const refs = useRefs(payFields);
  const load = useCallback(() => {
    let q = supabase.from('accounts_payable').select('*').order('due_date').limit(500);
    q = st === 'abertas' ? q.in('status', ['aberto', 'parcial']) : st === 'pagas' ? q.eq('status', 'pago') : q.eq('status', 'cancelado');
    q.then(({ data }) => setRows(data ?? []));
  }, [st]);
  useEffect(() => { load(); }, [load]);
  const today = isoDate(new Date());
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <select className="input w-auto py-2 text-sm" value={st} onChange={(e) => setSt(e.target.value)}><option value="abertas">Em aberto</option><option value="pagas">Pagas</option><option value="canceladas">Canceladas</option></select>
        <button className="btn-outline ml-auto py-2 text-sm" onClick={() => exportCSV('contas-a-pagar', rows)}>Exportar CSV</button>
        {can('finance.manage') && <button className="btn-primary py-2 text-sm" onClick={() => setNw(true)}>Nova conta a pagar</button>}
      </div>
      <div className="rounded-md border border-char/10 bg-white dark:bg-stone-900"><Table rows={rows} onRow={can('finance.manage') && st === 'abertas' ? setPay : undefined} cols={[
        { key: 'due_date', label: 'Vencimento', render: (a) => <span className={a.due_date < today && a.status !== 'pago' ? 'font-semibold text-red-700' : ''}>{d(a.due_date)}</span> },
        { key: 'description', label: 'Descrição' }, { key: 'payable_type', label: 'Tipo', render: r.label(PT, 'payable_type') },
        { key: 'supplier_id', label: 'Fornecedor', render: (a) => a.supplier_id ? <RefName table="suppliers" id={a.supplier_id} /> : '—' },
        { key: 'amount', label: 'Valor', align: 'right', render: (a) => money(a.amount) }, { key: 'paid_amount', label: 'Pago', align: 'right', render: (a) => money(a.paid_amount) },
        { key: 'status', label: 'Status', render: (a) => <Badge tone={a.status === 'pago' ? 'good' : a.status === 'cancelado' ? 'neutral' : a.due_date < today ? 'bad' : 'warn'}>{a.status === 'aberto' && a.due_date < today ? 'vencida' : a.status}</Badge> }]} /></div>
      {nw && <FormModal title="Nova conta a pagar" fields={payFields} refs={refs} initial={{ type: 'outros', installments: 1, recurrence: 'nenhuma' }} onClose={() => setNw(false)}
        onSave={async (x) => { await rpc('create_payable', { p_description: x.description, p_amount: Number(x.amount), p_due: x.due, p_category: x.category, p_supplier: x.supplier || null,
          p_type: x.type, p_installments: Number(x.installments || 1), p_document: x.document || null, p_competence: x.competence || null, p_recurrence: x.recurrence, p_notes: x.notes || null }); toast('Conta criada'); setNw(false); load(); }} />}
      {pay && <PayModal title={`Pagar: ${pay.description}`} due={Number(pay.amount) + Number(pay.interest) - Number(pay.discount) - Number(pay.paid_amount)} withInterest onClose={() => setPay(null)}
        onCancel={async (reason) => { await rpc('cancel_payable', { p_id: pay.id, p_reason: reason }); toast('Conta cancelada'); setPay(null); load(); }}
        onPay={async (account, amount, date, interest, discount) => { await rpc('pay_payable', { p_id: pay.id, p_account: account, p_amount: amount, p_paid_on: date, p_interest: interest, p_discount: discount }); toast('Pagamento registrado'); setPay(null); load(); }} />}
    </div>
  );
}

function PayModal({ title, due, onClose, onPay, onCancel, withInterest }: { title: string; due: number; onClose: () => void; withInterest?: boolean;
  onPay: (acc: string, amount: number, date: string, interest: number, discount: number) => Promise<void>; onCancel?: (reason: string) => Promise<void> }) {
  const toast = useToast();
  const [acc, setAcc] = useState(''); const [amount, setAmount] = useState(due.toFixed(2)); const [date, setDate] = useState(isoDate(new Date()));
  const [interest, setInterest] = useState('0'); const [discount, setDiscount] = useState('0'); const [accounts, setAccounts] = useState<any[]>([]);
  useEffect(() => { supabase.from('financial_accounts').select('id,name').eq('is_active', true).order('name').then(({ data }) => setAccounts(data ?? [])); }, []);
  return (
    <Modal title={title} onClose={onClose} footer={<>
      {onCancel && <button className="btn-ghost mr-auto text-red-700" onClick={async () => { const why = prompt('Motivo do cancelamento:'); if (why) await onCancel(why).catch((e) => toast(e.message, 'err')); }}>Cancelar conta</button>}
      <button className="btn-outline" onClick={onClose}>Voltar</button>
      <button className="btn-primary" disabled={!acc} onClick={() => onPay(acc, Number(amount), date, Number(interest), Number(discount)).catch((e) => toast(e.message, 'err'))}>Confirmar</button></>}>
      <p className="mb-3 text-sm">Saldo devedor: <b>{money(due)}</b></p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Conta"><select className="input" value={acc} onChange={(e) => setAcc(e.target.value)}><option value="">—</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <Field label="Data"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Valor"><input className="input" type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        {withInterest && <><Field label="Juros/multa"><input className="input" type="number" step="0.01" value={interest} onChange={(e) => setInterest(e.target.value)} /></Field>
          <Field label="Desconto obtido"><input className="input" type="number" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} /></Field></>}
      </div>
    </Modal>
  );
}

function Receivables() {
  const toast = useToast(); const { can } = useAuth();
  const [rows, setRows] = useState<any[]>([]); const [st, setSt] = useState('abertas'); const [rec, setRec] = useState<any | null>(null); const [nw, setNw] = useState(false);
  const fields: FieldDef[] = [{ name: 'description', label: 'Descrição', required: true }, { name: 'amount', label: 'Valor', type: 'money', required: true },
    { name: 'due', label: 'Vencimento', type: 'date', required: true }, { name: 'customer', label: 'Cliente', type: 'ref', ref: { table: 'customers', label: 'name' } },
    { name: 'type', label: 'Tipo', type: 'select', default: 'outros', options: [{ value: 'outros', label: 'Outros' }, { value: 'credito_cliente', label: 'Crédito de cliente' }, { value: 'pedido', label: 'Pedido' }] }];
  const refs = useRefs(fields);
  const load = useCallback(() => {
    let q = supabase.from('accounts_receivable').select('*').order('due_date').limit(500);
    q = st === 'abertas' ? q.in('status', ['aberto', 'parcial']) : q.eq('status', st === 'recebidas' ? 'recebido' : 'cancelado');
    q.then(({ data }) => setRows(data ?? []));
  }, [st]);
  useEffect(() => { load(); }, [load]);
  return (
    <div>
      <div className="mb-3 flex gap-2"><select className="input w-auto py-2 text-sm" value={st} onChange={(e) => setSt(e.target.value)}><option value="abertas">Em aberto</option><option value="recebidas">Recebidas</option><option value="canceladas">Canceladas</option></select>
        {can('finance.manage') && <button className="btn-primary ml-auto py-2 text-sm" onClick={() => setNw(true)}>Novo título a receber</button>}</div>
      <p className="mb-2 text-xs text-stone-500">Vendas no cartão com prazo de repasse e vendas “fiado” autorizadas entram aqui automaticamente.</p>
      <div className="rounded-md border border-char/10 bg-white dark:bg-stone-900"><Table rows={rows} onRow={can('finance.manage') && st === 'abertas' ? setRec : undefined} cols={[
        { key: 'due_date', label: 'Vencimento', render: (a) => d(a.due_date) }, { key: 'description', label: 'Descrição' }, { key: 'receivable_type', label: 'Tipo' },
        { key: 'customer_id', label: 'Cliente', render: (a) => a.customer_id ? <RefName table="customers" id={a.customer_id} /> : '—' },
        { key: 'amount', label: 'Valor', align: 'right', render: (a) => money(a.amount) }, { key: 'received_amount', label: 'Recebido', align: 'right', render: (a) => money(a.received_amount) },
        { key: 'status', label: 'Status', render: (a) => <Badge tone={a.status === 'recebido' ? 'good' : 'warn'}>{a.status}</Badge> }]} /></div>
      {nw && <FormModal title="Novo título a receber" fields={fields} refs={refs} initial={{ type: 'outros' }} onClose={() => setNw(false)} onSave={async (x) => {
        await rpc('create_receivable', { p_description: x.description, p_amount: Number(x.amount), p_due: x.due, p_customer: x.customer || null, p_type: x.type }); toast('Título criado'); setNw(false); load(); }} />}
      {rec && <PayModal title={`Receber: ${rec.description}`} due={Number(rec.amount) - Number(rec.received_amount)} onClose={() => setRec(null)}
        onPay={async (acc, amount, date) => { await rpc('receive_receivable', { p_id: rec.id, p_account: acc, p_amount: amount, p_received_on: date }); toast('Recebimento registrado'); setRec(null); load(); }} />}
    </div>
  );
}

function Transactions() {
  const toast = useToast(); const { can } = useAuth();
  const [p, setP] = useState(presetPeriod('mes')); const [rows, setRows] = useState<any[]>([]); const [nw, setNw] = useState<'manual' | 'transf' | null>(null);
  const fields: FieldDef[] = nw === 'transf'
    ? [{ name: 'from', label: 'De (conta)', type: 'ref', ref: { table: 'financial_accounts', label: 'name' }, required: true }, { name: 'to', label: 'Para (conta)', type: 'ref', ref: { table: 'financial_accounts', label: 'name' }, required: true },
       { name: 'amount', label: 'Valor', type: 'money', required: true }, { name: 'description', label: 'Descrição', required: true }, { name: 'date', label: 'Data', type: 'date' }]
    : [{ name: 'account', label: 'Conta', type: 'ref', ref: { table: 'financial_accounts', label: 'name' }, required: true },
       { name: 'type', label: 'Tipo', type: 'select', default: 'saida', options: [{ value: 'entrada', label: 'Entrada' }, { value: 'saida', label: 'Saída' }] },
       { name: 'amount', label: 'Valor', type: 'money', required: true }, { name: 'description', label: 'Descrição', required: true },
       { name: 'category', label: 'Categoria', type: 'ref', ref: { table: 'financial_categories', label: 'name' } }, { name: 'date', label: 'Data', type: 'date' }, { name: 'competence', label: 'Competência', type: 'date' }];
  const refs = useRefs(fields);
  const load = useCallback(() => supabase.from('financial_transactions').select('*').gte('occurred_on', p.start).lte('occurred_on', p.end).order('created_at', { ascending: false }).limit(1000).then(({ data }) => setRows(data ?? [])), [p]);
  useEffect(() => { load(); }, [load]);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2"><PeriodPicker value={p} onChange={setP} />
        <button className="btn-outline ml-auto py-2 text-sm" onClick={() => exportCSV('lancamentos', rows)}>Exportar CSV</button>
        {can('finance.manage') && <><button className="btn-outline py-2 text-sm" onClick={() => setNw('transf')}>Transferência</button><button className="btn-primary py-2 text-sm" onClick={() => setNw('manual')}>Lançamento manual</button></>}</div>
      <div className="rounded-md border border-char/10 bg-white dark:bg-stone-900"><Table rows={rows} cols={[
        { key: 'occurred_on', label: 'Data', render: (t) => d(t.occurred_on) }, { key: 'account_id', label: 'Conta', render: (t) => <RefName table="financial_accounts" id={t.account_id} /> },
        { key: 'description', label: 'Descrição' }, { key: 'category_id', label: 'Categoria', render: (t) => t.category_id ? <RefName table="financial_categories" id={t.category_id} /> : '—' },
        { key: 'amount', label: 'Valor', align: 'right', render: (t) => <span className={t.transaction_type === 'entrada' ? 'text-green-800' : 'text-red-700'}>{t.transaction_type === 'entrada' ? '+' : '−'} {money(t.amount)}</span> },
        { key: 'status', label: '', render: (t) => t.status === 'estornado' ? <Badge>estornado</Badge> : can('finance.manage') && !t.reversal_of ? <button className="text-xs underline" onClick={async () => {
          const why = prompt('Motivo do estorno:'); if (!why) return; try { await rpc('reverse_transaction', { p_id: t.id, p_reason: why }); toast('Estornado'); load(); } catch (e) { toast((e as Error).message, 'err'); } }}>estornar</button> : null }]} /></div>
      {nw && <FormModal title={nw === 'transf' ? 'Transferência entre contas' : 'Lançamento manual'} fields={fields} refs={refs} initial={{ type: 'saida', date: isoDate(new Date()) }} onClose={() => setNw(null)}
        onSave={async (x) => {
          if (nw === 'transf') await rpc('transfer_between_accounts', { p_from: x.from, p_to: x.to, p_amount: Number(x.amount), p_description: x.description, p_date: x.date || isoDate(new Date()) });
          else await rpc('register_transaction', { p_account: x.account, p_type: x.type, p_amount: Number(x.amount), p_description: x.description, p_category: x.category || null, p_date: x.date || isoDate(new Date()), p_competence: x.competence || null });
          toast('Registrado'); setNw(null); load(); }} />}
    </div>
  );
}

function Expenses() {
  const toast = useToast(); const { can } = useAuth();
  const [rows, setRows] = useState<any[]>([]); const [nw, setNw] = useState(false);
  const fields: FieldDef[] = [{ name: 'description', label: 'Descrição', required: true }, { name: 'amount', label: 'Valor', type: 'money', required: true },
    { name: 'category', label: 'Categoria', type: 'ref', ref: { table: 'financial_categories', label: 'name', filter: { kind: 'despesa' } }, required: true },
    { name: 'account', label: 'Pago com (conta)', type: 'ref', ref: { table: 'financial_accounts', label: 'name' }, required: true },
    { name: 'supplier', label: 'Fornecedor', type: 'ref', ref: { table: 'suppliers', label: 'name' } }, { name: 'date', label: 'Data', type: 'date' }, { name: 'document', label: 'Documento' }];
  const refs = useRefs(fields);
  const load = useCallback(() => supabase.from('expenses').select('*').order('expense_date', { ascending: false }).limit(300).then(({ data }) => setRows(data ?? [])), []);
  useEffect(() => { load(); }, [load]);
  return (
    <div>
      {can('finance.manage') && <button className="btn-primary mb-3" onClick={() => setNw(true)}>Registrar despesa paga</button>}
      <div className="rounded-md border border-char/10 bg-white dark:bg-stone-900"><Table rows={rows} cols={[{ key: 'expense_date', label: 'Data', render: (x) => d(x.expense_date) }, { key: 'description', label: 'Descrição' },
        { key: 'category_id', label: 'Categoria', render: (x) => <RefName table="financial_categories" id={x.category_id} /> }, { key: 'amount', label: 'Valor', align: 'right', render: (x) => money(x.amount) }]} /></div>
      {nw && <FormModal title="Despesa paga" fields={fields} refs={refs} initial={{ date: isoDate(new Date()) }} onClose={() => setNw(false)} onSave={async (x) => {
        await rpc('register_expense', { p_category: x.category, p_account: x.account, p_description: x.description, p_amount: Number(x.amount), p_date: x.date || isoDate(new Date()), p_supplier: x.supplier || null, p_document: x.document || null });
        toast('Despesa registrada'); setNw(false); load(); }} />}
    </div>
  );
}

const DRE_LABEL: Record<string, string> = { pessoal: 'Pessoal', ocupacao: 'Ocupação (aluguel)', utilidades: 'Energia, água, gás, internet', administrativas: 'Administrativas', marketing: 'Marketing',
  impostos: 'Impostos e taxas', taxas_financeiras: 'Taxas de cartão/Pix (lançadas)', manutencao: 'Manutenção', despesas_financeiras: 'Despesas financeiras', outras_despesas: 'Outras despesas' };
export function Dre() {
  const [p, setP] = useState(presetPeriod('mes')); const [d, setD] = useState<any>(null);
  useEffect(() => { rpc('report_dre', { p_start: p.start, p_end: p.end }).then(setD).catch(() => {}); }, [p]);
  if (!d) return <PeriodPicker value={p} onChange={setP} />;
  const rows: [string, number, boolean?, boolean?][] = [
    ['Receita bruta de vendas', d.receita_bruta, true], ['(+) Taxas de entrega', d.taxas_entrega], ['(−) Descontos', -d.descontos],
    ['= Receita líquida', d.receita_liquida, true, true], ['(−) CMV (ficha técnica)', -d.cmv], ['= Lucro bruto', d.lucro_bruto, true, true],
    ['(−) Taxas de pagamento (adquirente)', -d.taxas_pagamento],
    ...Object.entries(d.despesas_por_grupo ?? {}).map(([k, v]) => [`(−) ${DRE_LABEL[k] ?? k}`, -Number(v)] as [string, number]),
    ['(+) Outras receitas', d.outras_receitas], ['= Resultado do período', d.resultado, true, true],
  ];
  const html = `<h1>DRE gerencial</h1><p class="muted">${dateBR(p.start + 'T12:00')} a ${dateBR(p.end + 'T12:00')}</p><table>${rows.map(([l, v, b]) => `<tr><td>${b ? `<b>${escapeHtml(l)}</b>` : escapeHtml(l)}</td><td class="r">${money(v)}</td></tr>`).join('')}</table>
    <h2>Indicadores</h2><table><tr><td>Margem bruta</td><td class="r">${pct(d.margem_bruta_pct)}</td></tr><tr><td>Margem de contribuição</td><td class="r">${money(d.margem_contribuicao)} (${pct(d.margem_contribuicao_pct)})</td></tr>
    <tr><td>Ponto de equilíbrio (receita)</td><td class="r">${d.ponto_equilibrio != null ? money(d.ponto_equilibrio) : '—'}</td></tr><tr><td>Margem líquida</td><td class="r">${pct(d.margem_liquida_pct)}</td></tr></table><p class="muted">${escapeHtml(d.aviso)}</p>`;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><PeriodPicker value={p} onChange={setP} />
        <button className="btn-outline ml-auto py-2 text-sm" onClick={() => printHTML('DRE', html)}>PDF / imprimir</button>
        <button className="btn-outline py-2 text-sm" onClick={() => exportCSV('dre', rows.map(([l, v]) => ({ Linha: l, Valor: v })))}>Excel (CSV)</button></div>
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card title="Demonstração do resultado (gerencial)">
          <table className="w-full text-sm"><tbody>{rows.map(([l, v, b, line], i) => <tr key={i} className={line ? 'border-t border-char/20' : ''}>
            <td className={`py-1.5 ${b ? 'font-semibold' : 'pl-3 text-stone-600'}`}>{l}</td><td className={`text-right tabular-nums ${b ? 'font-semibold' : ''} ${v < 0 ? 'text-red-700' : ''}`}>{money(v)}</td></tr>)}</tbody></table>
          <p className="mt-3 text-xs text-stone-500">{d.aviso} Cancelamentos no período: {money(d.cancelamentos_info)}. Compras de insumos pagas: {money(d.compras_insumos_caixa)}.</p>
        </Card>
        <div className="space-y-3">
          <Stat label="Margem bruta" value={pct(d.margem_bruta_pct)} />
          <Stat label="Margem de contribuição" value={money(d.margem_contribuicao)} sub={`${pct(d.margem_contribuicao_pct)} da receita líquida`} />
          <Stat label="Ponto de equilíbrio" value={d.ponto_equilibrio != null ? money(d.ponto_equilibrio) : '—'} sub={`despesas fixas ${money(d.despesas_fixas)}`} />
          <Stat label="Margem líquida" value={pct(d.margem_liquida_pct)} tone={d.resultado < 0 ? 'bad' : undefined} />
        </div>
      </div>
    </div>
  );
}
