import { useEffect, useState } from 'react';
import { supabase, rpc } from '../../lib/supabase';
import { money, dateTimeBR } from '../../lib/format';
import { Badge, Card, Modal, PageHeader, PeriodPicker, Table, Tabs, presetPeriod, useToast } from '../ui';
import { useAuth } from '../auth';
import { RefName } from './Catalog';
import { OrderDetail } from './Orders';

export default function SalesRegisters() {
  return (
    <div>
      <PageHeader title="Vendas e caixas" subtitle="Histórico de vendas, reimpressão, cancelamentos autorizados e conferência de caixas." />
      <Tabs tabs={[{ key: 'vendas', label: 'Vendas', el: () => <Sales /> }, { key: 'caixas', label: 'Caixas (fechamentos)', el: () => <Registers /> }]} />
    </div>
  );
}

function Sales() {
  const [p, setP] = useState(presetPeriod('hoje')); const [rows, setRows] = useState<any[]>([]); const [open, setOpen] = useState<any | null>(null);
  const load = () => supabase.from('sales').select('*').gte('sale_date', p.start + 'T00:00:00').lte('sale_date', p.end + 'T23:59:59').order('sale_date', { ascending: false }).limit(500).then(({ data }) => setRows(data ?? []));
  useEffect(() => { load(); }, [p]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      <div className="mb-3"><PeriodPicker value={p} onChange={setP} /></div>
      <div className="rounded-md border border-char/10 bg-white dark:bg-stone-900"><Table rows={rows} onRow={async (s) => { const { data } = await supabase.from('orders').select('*').eq('id', s.order_id).maybeSingle(); setOpen(data); }} cols={[
        { key: 'number', label: 'Venda', render: (s) => `#${s.number}` }, { key: 'sale_date', label: 'Data', render: (s) => dateTimeBR(s.sale_date) }, { key: 'channel', label: 'Canal' },
        { key: 'operator_id', label: 'Operador', render: (s) => s.operator_id ? <RefName table="users" id={s.operator_id} col="full_name" /> : '—' },
        { key: 'discount', label: 'Desconto', align: 'right', render: (s) => Number(s.discount) ? money(s.discount) : '' }, { key: 'total', label: 'Total', align: 'right', render: (s) => money(s.total) },
        { key: 'status', label: 'Status', render: (s) => <Badge tone={s.status === 'concluida' ? 'good' : 'bad'}>{s.status}</Badge> }]} /></div>
      {open && <OrderDetail order={open} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); load(); }} />}
    </div>
  );
}

function Registers() {
  const toast = useToast(); const { can } = useAuth();
  const [rows, setRows] = useState<any[]>([]); const [open, setOpen] = useState<any | null>(null); const [sum, setSum] = useState<any>(null);
  const load = () => supabase.from('cash_registers').select('*').order('opened_at', { ascending: false }).limit(100).then(({ data }) => setRows(data ?? []));
  useEffect(() => { load(); }, []);
  useEffect(() => { if (open) rpc('cash_register_summary', { p_register: open.id }).then(setSum).catch((e) => toast(e.message, 'err')); }, [open, toast]);
  return (
    <div>
      <div className="rounded-md border border-char/10 bg-white dark:bg-stone-900"><Table rows={rows} onRow={setOpen} cols={[
        { key: 'terminal_name', label: 'Caixa' }, { key: 'operator_id', label: 'Operador', render: (r) => <RefName table="users" id={r.operator_id} col="full_name" /> },
        { key: 'opened_at', label: 'Abertura', render: (r) => dateTimeBR(r.opened_at) }, { key: 'closed_at', label: 'Fechamento', render: (r) => dateTimeBR(r.closed_at) },
        { key: 'difference_total', label: 'Diferença', align: 'right', render: (r) => r.difference_total == null ? '—' : <span className={Math.abs(Number(r.difference_total)) >= 0.01 ? 'font-semibold text-red-700' : 'text-green-800'}>{money(r.difference_total)}</span> },
        { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'aberto' ? 'warn' : r.status === 'conferido' ? 'good' : 'info'}>{r.status}</Badge> }]} /></div>
      {open && sum && <Modal title={`${open.terminal_name} — ${sum.operator}`} wide onClose={() => { setOpen(null); setSum(null); }} footer={open.status === 'fechado' && can('pos.manage') ? <button className="btn-primary" onClick={async () => {
        const notes = prompt('Observações da conferência:') ?? ''; try { await rpc('review_cash_register', { p_register: open.id, p_notes: notes }); toast('Caixa conferido'); setOpen(null); load(); } catch (e) { toast((e as Error).message, 'err'); } }}>Marcar como conferido</button> : undefined}>
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Resumo"><p className="text-sm">{sum.sales_count} vendas · {money(sum.sales_total)} · {sum.cancelled_count} cancelada(s)</p>
            <p className="text-sm">Sangrias {money(sum.withdrawals)} · Suprimentos {money(sum.supplies)}</p>
            {open.expected && <table className="mt-3 w-full text-sm"><thead><tr className="text-left text-stone-500"><th>Forma</th><th className="text-right">Esperado</th><th className="text-right">Contado</th></tr></thead>
              <tbody>{Object.keys({ ...open.expected, ...open.counted }).map((k) => <tr key={k}><td>{k}</td><td className="text-right">{money(open.expected?.[k] ?? 0)}</td><td className="text-right">{money(open.counted?.[k] ?? 0)}</td></tr>)}</tbody></table>}</Card>
          <Card title="Movimentos de dinheiro"><ul className="text-sm">{sum.movements.map((mv: any) => <li key={mv.id} className="flex justify-between border-b border-char/5 py-1"><span>{dateTimeBR(mv.created_at)} · {mv.movement_type} {mv.description && `— ${mv.description}`}</span><span className={Number(mv.amount) < 0 ? 'text-red-700' : ''}>{money(mv.amount)}</span></li>)}</ul></Card>
        </div>
      </Modal>}
    </div>
  );
}
