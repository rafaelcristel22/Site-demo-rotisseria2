import { useCallback, useEffect, useState } from 'react';
import { Check, Maximize2 } from 'lucide-react';
import { supabase, rpc, cleanError } from '../../lib/supabase';
import { timeBR, dateTimeBR } from '../../lib/format';
import { useToast } from '../ui';
import { useLive, minutesSince, beep } from '../live';
import { printOrder } from '../print';

const COLS = [
  { key: 'novo', label: 'Novos' }, { key: 'em_preparo', label: 'Em preparo' },
  { key: 'aguardando_finalizacao', label: 'Aguardando finalização' }, { key: 'pronto', label: 'Prontos' }, { key: 'entregue', label: 'Entregues (1h)' },
];
const CH: Record<string, string> = { balcao: 'BALCÃO', retirada: 'RETIRADA', delivery: 'ENTREGA' };

export default function Kitchen() {
  const toast = useToast();
  const [orders, setOrders] = useState<any[]>([]);
  const [items, setItems] = useState<Record<string, any[]>>({});
  const [alertMin, setAlertMin] = useState(25);
  const [, tick] = useState(0);
  const [known, setKnown] = useState<Set<string> | null>(null);

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 3600e3).toISOString();
    const [act, done] = await Promise.all([
      supabase.from('orders').select('*').in('status', ['novo', 'em_preparo', 'aguardando_finalizacao', 'pronto']).order('accepted_at', { ascending: true }).limit(150),
      supabase.from('orders').select('*').eq('status', 'entregue').gte('delivered_at', since).order('delivered_at', { ascending: false }).limit(30),
    ]);
    if (act.error || done.error) return toast(cleanError((act.error ?? done.error)!.message), 'err');
    setOrders([...(act.data ?? []), ...(done.data ?? [])]);
  }, [toast]);
  useLive(['orders', 'order_items'], load, 10000);

  useEffect(() => {
    const ids = orders.map((o) => o.id);
    if (!ids.length) { setItems({}); return; }
    supabase.from('order_items').select('*').in('order_id', ids).then(({ data }) => {
      const g: Record<string, any[]> = {}; (data ?? []).forEach((i) => (g[i.order_id] ??= []).push(i)); setItems(g);
    });
    const novos = orders.filter((o) => o.status === 'novo').map((o) => o.id);
    if (known && novos.some((id) => !known.has(id))) beep();
    setKnown(new Set(novos));
  }, [orders]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    supabase.from('company_settings').select('kitchen_alert_minutes').eq('id', 1).maybeSingle().then(({ data }) => data && setAlertMin(data.kitchen_alert_minutes));
    const t = setInterval(() => tick((x) => x + 1), 30000); return () => clearInterval(t);
  }, []);

  const act = async (fn: string, args: Record<string, unknown>) => { try { await rpc(fn, args); load(); } catch (e) { toast((e as Error).message, 'err'); } };

  return (
    <div className="-m-4 min-h-[calc(100vh-0px)] bg-stone-900 p-3 text-stone-100 sm:-m-6">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="heading text-2xl text-white">Cozinha</h1>
        <div className="flex items-center gap-3 text-sm text-stone-400">
          <span>Alerta de atraso: {alertMin} min</span>
          <button className="rounded border border-white/20 px-2 py-1" onClick={() => document.documentElement.requestFullscreen?.()} aria-label="Tela cheia"><Maximize2 size={15} /></button>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-5">
        {COLS.map((col) => {
          const list = orders.filter((o) => o.status === col.key);
          return (
            <section key={col.key} className="min-h-[60vh] rounded bg-stone-800/60 p-2">
              <h2 className="mb-2 flex justify-between px-1 text-sm font-semibold uppercase tracking-wide text-stone-300">{col.label}<span>{list.length}</span></h2>
              <div className="space-y-2">
                {list.map((o) => {
                  const mins = minutesSince(o.accepted_at ?? o.created_at);
                  const late = col.key !== 'entregue' && col.key !== 'pronto' && mins >= alertMin;
                  return (
                    <article key={o.id} className={`rounded bg-white p-3 text-char ${late ? 'ring-4 ring-red-600' : ''}`}>
                      <header className="flex items-baseline justify-between">
                        <span className="heading text-2xl">#{o.number}</span>
                        <span className={`text-sm font-semibold tabular-nums ${late ? 'text-red-700' : 'text-stone-500'}`}>{mins} min</span>
                      </header>
                      <p className="text-xs text-stone-500">{CH[o.channel]} · entrou {timeBR(o.accepted_at ?? o.created_at)}{o.scheduled_for && <b className="text-char"> · para {dateTimeBR(o.scheduled_for)}</b>}</p>
                      {late && <p className="mt-1 text-xs font-bold uppercase text-red-700">Atrasado</p>}
                      <ul className="mt-2 space-y-1.5">
                        {(items[o.id] ?? []).filter((i) => i.send_to_kitchen).map((i) => (
                          <li key={i.id} className="flex items-start gap-2">
                            {['novo', 'em_preparo', 'aguardando_finalizacao'].includes(o.status) ? (
                              <button onClick={() => act('kitchen_set_item_status', { p_item: i.id, p_status: i.kitchen_status === 'pronto' ? 'preparando' : i.kitchen_status === 'preparando' ? 'pronto' : 'preparando' })}
                                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border-2 ${i.kitchen_status === 'pronto' ? 'border-green-700 bg-green-700 text-white' : i.kitchen_status === 'preparando' ? 'border-amber-500 bg-amber-100' : 'border-stone-300'}`}
                                aria-label={`Item ${i.product_name}: ${i.kitchen_status}`} title="Toque: preparando → pronto">
                                {i.kitchen_status === 'pronto' && <Check size={14} />}{i.kitchen_status === 'preparando' && <span className="h-2 w-2 rounded-full bg-amber-500" />}
                              </button>) : null}
                            <div className={i.kitchen_status === 'pronto' && o.status !== 'pronto' ? 'text-stone-400 line-through' : ''}>
                              <p className="text-[15px] font-semibold leading-tight">{Number(i.quantity)}× {i.product_name}</p>
                              {i.options?.length > 0 && <p className="text-xs text-stone-600">{i.options.map((x: any) => x.name).join(', ')}</p>}
                              {i.notes && <p className="text-xs font-bold text-red-700">OBS: {i.notes}</p>}
                            </div>
                          </li>))}
                      </ul>
                      {o.notes && <p className="mt-2 border-l-4 border-amber-500 pl-2 text-xs"><b>Pedido:</b> {o.notes}</p>}
                      <div className="mt-3 flex gap-2">
                        {o.status === 'novo' && <button className="btn-dark flex-1 py-2 text-sm" onClick={() => act('order_set_status', { p_order: o.id, p_status: 'em_preparo' })}>Iniciar</button>}
                        {['em_preparo', 'aguardando_finalizacao'].includes(o.status) && <button className="btn-primary flex-1 py-2 text-sm" onClick={() => act('order_set_status', { p_order: o.id, p_status: 'pronto' })}>Pronto</button>}
                        {o.status === 'pronto' && o.channel !== 'delivery' && <button className="btn-outline flex-1 py-2 text-sm" onClick={() => act('order_set_status', { p_order: o.id, p_status: 'entregue' })}>Entregue</button>}
                        <button className="btn-outline px-2 py-2 text-xs" onClick={() => printOrder({ ...o, items: items[o.id] ?? [] }, 'cozinha')}>Imprimir</button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
