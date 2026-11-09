import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { rpc } from '../lib/supabase';
import { money, ORDER_STATUS, timeBR, dateTimeBR } from '../lib/format';

interface Status {
  number: number; status: string; channel: string; created_at: string; scheduled_for: string | null; subtotal: number;
  delivery_fee: number; discount: number; total: number; payment_method: string; change_for: number | null; customer_name: string;
  items: { name: string; quantity: number; total: number; options: { name: string }[]; notes: string | null }[];
  history: { status: string; at: string }[]; estimated_minutes: number;
}

export default function TrackingPage() {
  const { code = '' } = useParams();
  const [s, setS] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => rpc<Status | null>('public_order_status', { p_tracking: code })
      .then((r) => { if (!alive) return; if (!r) setErr('Pedido não encontrado'); else { setS(r); setErr(null); } })
      .catch((e) => alive && setErr(e.message));
    load();
    const t = setInterval(load, 15000);
    return () => { alive = false; clearInterval(t); };
  }, [code]);

  if (err) return <div className="mx-auto max-w-md p-8 text-center"><p className="heading text-2xl">{err}</p><Link to="/" className="btn-primary mt-4">Voltar ao cardápio</Link></div>;
  if (!s) return <div className="mx-auto max-w-md p-6 text-stone-500">Carregando pedido…</div>;

  const delivery = s.channel === 'delivery';
  const steps = [
    { key: 'pendente', label: 'Recebemos seu pedido' },
    { key: 'novo', label: 'Pedido confirmado' },
    { key: 'em_preparo', label: 'Na cozinha' },
    { key: 'pronto', label: delivery ? 'Pronto, aguardando o entregador' : 'Pronto para retirar' },
    ...(delivery ? [{ key: 'saiu_entrega', label: 'Saiu para entrega' }] : []),
    { key: 'entregue', label: delivery ? 'Entregue' : 'Retirado' },
  ];
  const order = ['pendente', 'novo', 'em_preparo', 'aguardando_finalizacao', 'pronto', 'saiu_entrega', 'entregue'];
  const cur = order.indexOf(s.status);
  const reached = (k: string) => cur >= order.indexOf(k);
  const at = (k: string) => s.history.find((h) => h.status === k)?.at;
  const eta = new Date(new Date(s.scheduled_for ?? s.created_at).getTime() + (s.scheduled_for ? 0 : s.estimated_minutes * 60000));

  return (
    <div className="mx-auto min-h-screen max-w-lg bg-paper px-5 pb-16 pt-[max(20px,env(safe-area-inset-top))] sm:border-x sm:border-char/10">
      <p className="text-[15px] text-stone-600">{s.customer_name}, seu pedido</p>
      <h1 className="heading text-[44px] leading-none">Nº {s.number}</h1>
      {s.status === 'cancelado' ? (
        <p className="mt-3 border-l-4 border-red-600 bg-white px-3 py-2 font-semibold text-red-800">Este pedido foi cancelado.</p>
      ) : (
        <p className="mt-2 text-[17px]"><b>{ORDER_STATUS[s.status]}</b>
          {s.status !== 'entregue' && <span className="text-stone-600"> · {s.scheduled_for ? `agendado para ${dateTimeBR(s.scheduled_for)}` : `previsão ${timeBR(eta)}`}</span>}</p>
      )}

      {s.status !== 'cancelado' && (
        <ol className="mt-6 border-l-2 border-char/15">
          {steps.map((st) => {
            const done = reached(st.key); const t = at(st.key);
            return (
              <li key={st.key} className="relative pb-4 pl-5 last:pb-0">
                <span className={`absolute -left-[7px] top-1.5 h-3 w-3 rounded-full border-2 ${done ? 'border-red-600 bg-red-600' : 'border-char/25 bg-paper'}`} />
                <p className={`text-[16px] ${done ? 'font-semibold' : 'text-stone-400'}`}>{st.label}{t && <span className="ml-2 text-[14px] font-normal text-stone-500">{timeBR(t)}</span>}</p>
              </li>
            );
          })}
        </ol>
      )}

      <section className="mt-8 border-t border-char/15 pt-5">
        <h2 className="heading text-[20px]">O que você pediu</h2>
        <ul className="mt-2 space-y-2 text-[15px]">
          {s.items.map((it, i) => (
            <li key={i} className="flex justify-between gap-3">
              <span>{Number(it.quantity)}× {it.name}{it.options?.length ? <span className="block text-[14px] text-stone-500">{it.options.map((o) => o.name).join(', ')}</span> : null}</span>
              <span className="tabular-nums">{money(it.total)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 space-y-0.5 border-t border-dashed border-char/20 pt-3 text-[15px] text-stone-600">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(s.subtotal)}</dd></div>
          {delivery && <div className="flex justify-between"><dt>Entrega</dt><dd>{money(s.delivery_fee)}</dd></div>}
          {Number(s.discount) > 0 && <div className="flex justify-between text-green-800"><dt>Desconto</dt><dd>− {money(s.discount)}</dd></div>}
          <div className="flex justify-between text-lg font-bold text-char"><dt>Total</dt><dd>{money(s.total)}</dd></div>
          <div className="flex justify-between"><dt>Pagamento</dt><dd>{s.payment_method}{s.change_for ? `, troco para ${money(s.change_for)}` : ''}</dd></div>
        </dl>
      </section>
      <p className="mt-6 text-[14px] text-stone-500">Esta página se atualiza sozinha. Guarde o link para acompanhar.
        <button onClick={() => { navigator.clipboard?.writeText(location.href).then(() => setCopied(true)).catch(() => {}); }} className="ml-1 underline">{copied ? 'Copiado.' : 'Copiar link'}</button></p>
      <Link to="/" className="btn-outline mt-6 w-full py-3">Voltar ao cardápio</Link>
    </div>
  );
}
