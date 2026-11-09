import { useCallback, useEffect, useRef, useState } from 'react';
import { Printer } from 'lucide-react';
import { supabase, rpc, cleanError } from '../../lib/supabase';
import { money, ORDER_STATUS, timeBR, dateTimeBR, formatPhone } from '../../lib/format';
import { Badge, Field, Modal, PageHeader, PinModal, Table, useToast } from '../ui';
import { useLive, beep, minutesSince } from '../live';
import { printOrder } from '../print';
import { useAuth } from '../auth';

const ACTIVE = ['pendente', 'novo', 'em_preparo', 'aguardando_finalizacao', 'pronto', 'saiu_entrega'];
const CH: Record<string, string> = { balcao: 'Balcão', retirada: 'Retirada', delivery: 'Entrega' };
const tone = (s: string) => (s === 'pendente' ? 'warn' : s === 'cancelado' ? 'bad' : s === 'entregue' ? 'good' : s === 'pronto' ? 'info' : 'neutral') as any;

export default function Orders() {
  const toast = useToast();
  const [tab, setTab] = useState<'ativos' | 'hoje' | 'cancelados' | 'a_receber'>('ativos');
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState<any | null>(null);
  const seen = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    let q = supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(200);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (tab === 'ativos') q = q.in('status', ACTIVE);
    else if (tab === 'hoje') q = q.gte('created_at', today.toISOString()).eq('status', 'entregue');
    else if (tab === 'cancelados') q = q.eq('status', 'cancelado').gte('created_at', new Date(Date.now() - 7 * 864e5).toISOString());
    else q = q.eq('payment_status', 'pendente').neq('status', 'cancelado');
    const { data, error } = await q;
    if (error) return toast(cleanError(error.message), 'err');
    const pend = (data ?? []).filter((o) => o.status === 'pendente').map((o) => o.id);
    if (seen.current && pend.some((id) => !seen.current!.has(id))) { beep(); toast('Novo pedido recebido!'); }
    seen.current = new Set(pend);
    setRows(data ?? []);
  }, [tab, toast]);
  useLive(['orders'], load, 10000);

  return (
    <div>
      <PageHeader title="Pedidos" subtitle="Pedidos do site, balcão e telefone. Novos pedidos tocam um aviso." />
      <div className="mb-3 flex gap-1 border-b border-char/10 dark:border-white/10">
        {([['ativos', 'Em andamento'], ['a_receber', 'A receber'], ['hoje', 'Entregues hoje'], ['cancelados', 'Cancelados (7 dias)']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? 'border-red-600' : 'border-transparent text-stone-500'}`}>{l}</button>
        ))}
      </div>
      <div className="rounded-md border border-char/10 bg-white dark:border-white/10 dark:bg-stone-900">
        <Table rows={rows} onRow={setOpen} cols={[
          { key: 'number', label: 'Nº', render: (o) => <b>#{o.number}</b> },
          { key: 'created_at', label: 'Hora', render: (o) => <>{timeBR(o.created_at)} <span className="text-xs text-stone-400">({minutesSince(o.created_at)} min)</span></> },
          { key: 'channel', label: 'Canal', render: (o) => `${CH[o.channel]}${o.origin === 'site' ? ' · site' : ''}` },
          { key: 'customer_name', label: 'Cliente', render: (o) => o.customer_name ?? '—' },
          { key: 'scheduled_for', label: 'Agendado', render: (o) => (o.scheduled_for ? dateTimeBR(o.scheduled_for) : '—') },
          { key: 'total', label: 'Total', align: 'right', render: (o) => money(o.total) },
          { key: 'payment_status', label: 'Pagamento', render: (o) => <Badge tone={o.payment_status === 'pago' ? 'good' : o.payment_status === 'estornado' ? 'bad' : 'warn'}>{o.payment_status}</Badge> },
          { key: 'status', label: 'Status', render: (o) => <Badge tone={tone(o.status)}>{ORDER_STATUS[o.status]}</Badge> },
        ]} empty="Nenhum pedido aqui." />
      </div>
      {open && <OrderDetail order={open} onClose={() => setOpen(null)} onChanged={() => { load(); setOpen(null); }} />}
    </div>
  );
}

export function OrderDetail({ order, onClose, onChanged }: { order: any; onClose: () => void; onChanged: () => void }) {
  const toast = useToast(); const { can } = useAuth();
  const [items, setItems] = useState<any[] | null>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [cancel, setCancel] = useState(false);
  const [settle, setSettle] = useState(false);
  useEffect(() => {
    supabase.from('order_items').select('*').eq('order_id', order.id).then(({ data }) => setItems(data ?? []));
    supabase.from('order_status_history').select('*').eq('order_id', order.id).order('changed_at').then(({ data }) => setHistory(data ?? []));
    supabase.from('payments').select('*').eq('order_id', order.id).then(({ data }) => setPayments(data ?? []));
  }, [order.id]);

  const act = async (fn: string, args: Record<string, unknown>, ok: string) => {
    try { await rpc(fn, args); toast(ok); onChanged(); } catch (e) { toast((e as Error).message, 'err'); }
  };
  const a = order.delivery_address;
  const po = { ...order, items: items ?? [], payments };
  const next: Record<string, [string, string] | undefined> = {
    novo: ['em_preparo', 'Iniciar preparo'], em_preparo: ['pronto', 'Marcar como pronto'], aguardando_finalizacao: ['pronto', 'Finalizar (pronto)'],
    pronto: order.channel === 'delivery' ? undefined : ['entregue', 'Entregue ao cliente'],
  };

  return (
    <Modal title={`Pedido #${order.number}`} onClose={onClose} wide footer={<>
      <button className="btn-outline mr-auto" onClick={() => printOrder(po, 'cozinha')}><Printer size={15} /> Comanda</button>
      <button className="btn-outline" onClick={() => printOrder(po, 'cliente')}><Printer size={15} /> Comprovante</button>
      {order.status !== 'cancelado' && order.status !== 'entregue' && <button className="btn-ghost text-red-700" onClick={() => setCancel(true)}>{order.status === 'pendente' ? 'Recusar' : 'Cancelar'}</button>}
      {order.status === 'entregue' && order.payment_status === 'pago' && can('pos.cancel') && <button className="btn-ghost text-red-700" onClick={() => setCancel(true)}>Cancelar venda</button>}
      {order.payment_status === 'pendente' && order.status !== 'cancelado' && can('pos.operate') && <button className="btn-outline" onClick={() => setSettle(true)}>Receber pagamento</button>}
      {order.status === 'pendente' && <button className="btn-primary" onClick={() => act('accept_order', { p_order: order.id }, 'Pedido aceito e enviado à cozinha')}>Aceitar pedido</button>}
      {next[order.status] && <button className="btn-dark" onClick={() => act('order_set_status', { p_order: order.id, p_status: next[order.status]![0] }, 'Status atualizado')}>{next[order.status]![1]}</button>}
    </>}>
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <p className="text-sm"><Badge>{CH[order.channel]}</Badge> <Badge>{ORDER_STATUS[order.status]}</Badge> <Badge tone={order.payment_status === 'pago' ? 'good' : 'warn'}>{order.payment_status}</Badge></p>
          <dl className="mt-3 space-y-1 text-sm">
            <div><dt className="inline text-stone-500">Cliente: </dt><dd className="inline">{order.customer_name ?? '—'} {order.customer_phone && <a className="underline" href={`https://wa.me/55${order.customer_phone}`} target="_blank" rel="noreferrer">{formatPhone(order.customer_phone)}</a>}</dd></div>
            {a && <div><dt className="inline text-stone-500">Endereço: </dt><dd className="inline">{[a.street, a.number, a.complement, a.district].filter(Boolean).join(', ')}{a.reference && ` (ref.: ${a.reference})`}</dd></div>}
            {order.scheduled_for && <div><dt className="inline text-stone-500">Agendado: </dt><dd className="inline font-semibold">{dateTimeBR(order.scheduled_for)}</dd></div>}
            <div><dt className="inline text-stone-500">Pagamento previsto: </dt><dd className="inline">{order.payment_method_planned ?? '—'}{order.change_for && ` · troco para ${money(order.change_for)}`}</dd></div>
            {order.notes && <div className="border-l-4 border-amber-500 bg-amber-50 px-2 py-1 dark:bg-transparent"><b>Obs.:</b> {order.notes}</div>}
            {order.cancel_reason && <div className="text-red-700"><b>Cancelado:</b> {order.cancel_reason}</div>}
          </dl>
          <h3 className="mt-4 text-sm font-semibold">Histórico</h3>
          <ul className="mt-1 text-sm text-stone-600">{history.map((h) => <li key={h.id}>{timeBR(h.changed_at)} — {ORDER_STATUS[h.to_status]}</li>)}</ul>
        </div>
        <div>
          <ul className="divide-y divide-char/10 text-sm">
            {(items ?? []).map((i) => <li key={i.id} className="flex justify-between gap-3 py-2">
              <span>{Number(i.quantity)}× {i.product_name}{i.options?.length > 0 && <span className="block text-xs text-stone-500">{i.options.map((o: any) => o.name).join(', ')}</span>}
                {i.notes && <span className="block text-xs font-semibold">Obs.: {i.notes}</span>}</span>
              <span className="tabular-nums">{money(i.total)}</span></li>)}
          </ul>
          <dl className="mt-2 space-y-0.5 border-t border-char/10 pt-2 text-sm">
            <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(order.subtotal)}</dd></div>
            {Number(order.discount) > 0 && <div className="flex justify-between"><dt>Desconto {order.coupon_code && `(${order.coupon_code})`}</dt><dd>− {money(order.discount)}</dd></div>}
            {Number(order.delivery_fee) > 0 && <div className="flex justify-between"><dt>Entrega</dt><dd>{money(order.delivery_fee)}</dd></div>}
            <div className="flex justify-between text-base font-bold"><dt>Total</dt><dd>{money(order.total)}</dd></div>
          </dl>
        </div>
      </div>
      {cancel && <PinModal title={`Cancelar pedido #${order.number}`} reason onClose={() => setCancel(false)}
        onConfirm={async (pin, reason) => { await rpc('cancel_order', { p_order: order.id, p_reason: reason, p_authorizer_pin: pin || null }); toast('Pedido cancelado'); onChanged(); }} />}
      {settle && <SettleModal order={order} onClose={() => setSettle(false)} onDone={onChanged} />}
    </Modal>
  );
}

function SettleModal({ order, onClose, onDone }: { order: any; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [method, setMethod] = useState(order.payment_method_planned ?? 'dinheiro');
  const [tendered, setTendered] = useState(order.change_for ? String(order.change_for) : '');
  const [methods, setMethods] = useState<any[]>([]);
  useEffect(() => { supabase.from('payment_methods').select('code,name,allows_change').eq('is_active', true).order('sort_order').then(({ data }) => setMethods(data ?? [])); }, []);
  const m = methods.find((x) => x.code === method);
  return (
    <Modal title={`Receber pedido #${order.number} — ${money(order.total)}`} onClose={onClose} footer={<>
      <button className="btn-outline" onClick={onClose}>Voltar</button>
      <button className="btn-primary" onClick={async () => {
        try {
          const r = await rpc<{ change: number }>('settle_order', { p_order: order.id, p_payments: [{ method, amount: Number(order.total), tendered: m?.allows_change && tendered ? Number(tendered) : null }] });
          toast(`Pagamento registrado${Number(r.change) ? ` · troco ${money(r.change)}` : ''}`); onDone();
        } catch (e) { toast((e as Error).message, 'err'); }
      }}>Confirmar recebimento</button></>}>
      <Field label="Forma de pagamento"><select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
        {methods.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></Field>
      {m?.allows_change && <Field label="Valor recebido" className="mt-3"><input className="input" type="number" step="0.01" value={tendered} onChange={(e) => setTendered(e.target.value)} /></Field>}
      {m?.allows_change && Number(tendered) > Number(order.total) && <p className="mt-2 text-sm">Troco: <b>{money(Number(tendered) - Number(order.total))}</b></p>}
      <p className="mt-3 text-xs text-stone-500">Pagamentos em dinheiro entram no seu caixa aberto.</p>
    </Modal>
  );
}
