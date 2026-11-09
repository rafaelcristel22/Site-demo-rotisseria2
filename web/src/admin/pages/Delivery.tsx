import { useCallback, useEffect, useState } from 'react';
import { supabase, rpc } from '../../lib/supabase';
import { money, timeBR, dateBR } from '../../lib/format';
import Crud, { r } from '../Crud';
import { Badge, Card, PageHeader, PeriodPicker, Stat, Tabs, presetPeriod, useToast } from '../ui';
import { useAuth } from '../auth';
import { useLive, minutesSince } from '../live';
import { HBars } from '../charts';

export default function Delivery() {
  const { can } = useAuth();
  return (
    <div>
      <PageHeader title="Entregas" subtitle="Atribuição de entregadores, acompanhamento e desempenho." />
      <Tabs tabs={[
        { key: 'painel', label: 'Painel de entregas', el: () => <Board /> },
        { key: 'entregadores', label: 'Entregadores', el: () => <Crud cfg={{ table: 'delivery_drivers', title: 'Entregadores', perm: 'delivery.manage', embedded: true, order: 'name.asc',
          fields: [{ name: 'name', label: 'Nome', required: true }, { name: 'phone', label: 'Telefone', type: 'tel' }, { name: 'vehicle', label: 'Veículo', default: 'moto' }, { name: 'plate', label: 'Placa' },
            { name: 'fee_per_delivery', label: 'Valor por entrega (R$)', type: 'money', default: 0 }, { name: 'employee_id', label: 'Funcionário', type: 'ref', ref: { table: 'employees', label: 'full_name' } },
            { name: 'user_id', label: 'Usuário (app do entregador)', type: 'ref', ref: { table: 'users', label: 'full_name' } },
            { name: 'availability', label: 'Disponibilidade', type: 'select', default: 'disponivel', options: [{ value: 'disponivel', label: 'Disponível' }, { value: 'em_entrega', label: 'Em entrega' }, { value: 'indisponivel', label: 'Indisponível' }] },
            { name: 'is_active', label: 'Ativo', type: 'bool', default: true }],
          columns: [{ key: 'name', label: 'Entregador' }, { key: 'phone', label: 'Telefone' }, { key: 'vehicle', label: 'Veículo' }, { key: 'availability', label: 'Situação', render: (d) => <Badge tone={d.availability === 'disponivel' ? 'good' : d.availability === 'em_entrega' ? 'info' : 'neutral'}>{d.availability}</Badge> }] }} />, hidden: !can('delivery.manage') },
        { key: 'bairros', label: 'Bairros e taxas', el: () => <Crud cfg={{ table: 'delivery_zones', title: 'Bairros', perm: 'delivery.manage', embedded: true, order: 'district.asc', search: ['district'],
          fields: [{ name: 'district', label: 'Bairro', required: true }, { name: 'city', label: 'Cidade', default: '' }, { name: 'fee', label: 'Taxa (R$)', type: 'money', required: true },
            { name: 'min_order_value', label: 'Pedido mínimo (R$)', type: 'money', default: 0 }, { name: 'free_delivery_above', label: 'Grátis acima de (R$)', type: 'money' },
            { name: 'estimated_minutes', label: 'Tempo estimado (min)', type: 'number', default: 45 }, { name: 'is_active', label: 'Ativo', type: 'bool', default: true }],
          columns: [{ key: 'district', label: 'Bairro' }, { key: 'fee', label: 'Taxa', align: 'right', render: r.money('fee') }, { key: 'free_delivery_above', label: 'Grátis acima', align: 'right', render: (z) => z.free_delivery_above ? money(z.free_delivery_above) : '—' },
            { key: 'estimated_minutes', label: 'Tempo', align: 'right', render: (z) => `${z.estimated_minutes} min` }, { key: 'is_active', label: '', render: r.active }] }} />, hidden: !can('delivery.manage') },
        { key: 'desempenho', label: 'Desempenho', el: () => <Performance />, hidden: !can('reports.view') },
      ]} />
    </div>
  );
}

function Board() {
  const toast = useToast(); const { can } = useAuth();
  const [dels, setDels] = useState<any[]>([]); const [orders, setOrders] = useState<Record<string, any>>({}); const [drivers, setDrivers] = useState<any[]>([]);
  const load = useCallback(async () => {
    const { data } = await supabase.from('deliveries').select('*').in('status', ['aguardando', 'atribuida', 'em_rota', 'falhou']).order('created_at');
    setDels(data ?? []);
    const ids = (data ?? []).map((d) => d.order_id);
    if (ids.length) { const { data: os } = await supabase.from('orders').select('*').in('id', ids); setOrders(Object.fromEntries((os ?? []).map((o) => [o.id, o]))); }
    if (can('delivery.manage')) supabase.from('delivery_drivers').select('*').eq('is_active', true).order('name').then(({ data: d }) => setDrivers(d ?? []));
  }, [can]);
  useLive(['deliveries', 'orders'], load, 15000);
  const act = async (fn: string, args: any) => { try { await rpc(fn, args); load(); } catch (e) { toast((e as Error).message, 'err'); } };
  const cols = [['aguardando', 'Aguardando entregador'], ['atribuida', 'Atribuídas'], ['em_rota', 'Em rota'], ['falhou', 'Não entregues']] as const;
  return (
    <div className="grid gap-3 lg:grid-cols-4">
      {cols.map(([k, l]) => (
        <section key={k} className="rounded-md border border-char/10 bg-white p-2 dark:bg-stone-900">
          <h2 className="mb-2 px-1 text-sm font-semibold uppercase tracking-wide text-stone-500">{l} ({dels.filter((d) => d.status === k).length})</h2>
          {dels.filter((d) => d.status === k).map((d) => { const o = orders[d.order_id]; if (!o) return null; const a = o.delivery_address ?? {};
            return (
              <article key={d.id} className="mb-2 rounded border border-char/10 p-3 text-sm">
                <p className="flex justify-between"><b>#{o.number}</b><span className="text-stone-500">{minutesSince(o.created_at)} min</span></p>
                <p>{o.customer_name} · <a className="underline" href={`tel:${o.customer_phone}`}>{o.customer_phone}</a></p>
                <p className="text-stone-600">{[a.street, a.number, a.complement, a.district].filter(Boolean).join(', ')}</p>
                {a.street && <a className="text-xs underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([a.street, a.number, a.district, a.city].filter(Boolean).join(', '))}`}>abrir no mapa</a>}
                <p className="mt-1 text-xs">Cozinha: <b>{o.status}</b> · {o.payment_status === 'pago' ? 'pago' : `cobrar ${money(o.total)} (${o.payment_method_planned ?? '?'})${o.change_for ? ` troco p/ ${money(o.change_for)}` : ''}`}</p>
                {can('delivery.manage') && ['aguardando', 'atribuida', 'falhou'].includes(k) && <select className="input mt-2 py-1 text-xs" value={d.driver_id ?? ''} onChange={(e) => act('assign_delivery', { p_order: o.id, p_driver: e.target.value })}>
                  <option value="">Atribuir entregador…</option>{drivers.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.availability})</option>)}</select>}
                <div className="mt-2 flex gap-1">
                  {k === 'atribuida' && <button className="btn-dark flex-1 py-1 text-xs" disabled={o.status !== 'pronto'} onClick={() => act('dispatch_delivery', { p_order: o.id })}>{o.status === 'pronto' ? 'Saiu para entrega' : 'Aguardando cozinha'}</button>}
                  {k === 'em_rota' && <><button className="btn-primary flex-1 py-1 text-xs" onClick={() => act('finish_delivery', { p_order: o.id, p_success: true })}>Entregue</button>
                    <button className="btn-outline py-1 text-xs" onClick={() => { const why = prompt('O que aconteceu?'); if (why) act('finish_delivery', { p_order: o.id, p_success: false, p_notes: why }); }}>Não entregue</button></>}
                </div>
                {d.assigned_at && <p className="mt-1 text-xs text-stone-500">atribuída {timeBR(d.assigned_at)}{d.dispatched_at && ` · saiu ${timeBR(d.dispatched_at)}`}</p>}
              </article>); })}
        </section>
      ))}
    </div>
  );
}

function Performance() {
  const [p, setP] = useState(presetPeriod('mes')); const [d, setD] = useState<any>(null);
  useEffect(() => { rpc('report_delivery', { p_start: p.start, p_end: p.end }).then(setD).catch(() => {}); }, [p]);
  return (
    <div className="space-y-4">
      <PeriodPicker value={p} onChange={setP} />
      {d && <><div className="grid grid-cols-2 gap-3 md:grid-cols-4"><Stat label="Entregas" value={String(d.deliveries)} /><Stat label="Não entregues" value={String(d.failed)} tone={d.failed ? 'warn' : undefined} />
        <Stat label="Tempo médio em rota" value={d.avg_route_minutes ? `${d.avg_route_minutes} min` : '—'} /><Stat label="Do pedido à entrega" value={d.avg_total_minutes ? `${d.avg_total_minutes} min` : '—'} /></div>
        <div className="grid gap-4 md:grid-cols-2"><Card title="Por entregador"><HBars data={d.by_driver} label="driver" value="deliveries" fmt="number" sub={(x) => `· ${x.avg_minutes ?? '—'} min`} /></Card>
          <Card title="Por bairro"><HBars data={d.by_zone} label="district" value="revenue" sub={(x) => `(${x.orders})`} /></Card></div>
        <p className="text-xs text-stone-500">Período {dateBR(p.start + 'T12:00')} a {dateBR(p.end + 'T12:00')}</p></>}
    </div>
  );
}
