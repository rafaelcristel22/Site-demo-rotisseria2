import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Check, ChefHat, Bike, PackageCheck, Clock, XCircle, Store, Copy } from 'lucide-react';
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

  if (err) return <div className="mx-auto max-w-md p-8 text-center"><p className="font-display text-xl font-bold">{err}</p><Link to="/" className="btn-primary mt-4">Voltar ao cardápio</Link></div>;
  if (!s) return <div className="mx-auto max-w-md animate-pulse p-6"><div className="h-40 rounded-3xl bg-stone-200" /></div>;

  const delivery = s.channel === 'delivery';
  const steps = [
    { key: 'pendente', label: 'Recebido', icon: Clock },
    { key: 'novo', label: 'Confirmado', icon: Check },
    { key: 'em_preparo', label: 'Em preparo', icon: ChefHat },
    { key: 'pronto', label: delivery ? 'Pronto' : 'Pronto para retirada', icon: delivery ? PackageCheck : Store },
    ...(delivery ? [{ key: 'saiu_entrega', label: 'Saiu para entrega', icon: Bike }] : []),
    { key: 'entregue', label: delivery ? 'Entregue' : 'Retirado', icon: PackageCheck },
  ];
  const order = ['pendente', 'novo', 'em_preparo', 'aguardando_finalizacao', 'pronto', 'saiu_entrega', 'entregue'];
  const cur = order.indexOf(s.status);
  const reached = (k: string) => cur >= order.indexOf(k);
  const at = (k: string) => s.history.find((h) => h.status === k)?.at;
  const eta = new Date(new Date(s.scheduled_for ?? s.created_at).getTime() + (s.scheduled_for ? 0 : s.estimated_minutes * 60000));

  return (
    <div className="mx-auto max-w-lg px-5 pb-16 pt-[max(20px,env(safe-area-inset-top))]">
      <div className="overflow-hidden rounded-3xl bg-char p-6 text-white">
        <p className="text-sm text-white/70">Olá, {s.customer_name}! Pedido</p>
        <p className="font-display text-4xl font-extrabold">#{s.number}</p>
        {s.status === 'cancelado' ? (
          <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-red-500/90 px-3 py-1 text-sm font-semibold"><XCircle size={16} /> Pedido cancelado</p>
        ) : (
          <>
            <p className="mt-3 text-lg font-semibold">{ORDER_STATUS[s.status]}</p>
            {s.status !== 'entregue' && <p className="text-sm text-white/70">{s.scheduled_for ? `Agendado para ${dateTimeBR(s.scheduled_for)}` : `Previsão: ${timeBR(eta)}`}</p>}
          </>
        )}
        <button onClick={() => { navigator.clipboard?.writeText(location.href).then(() => setCopied(true)).catch(() => {}); }}
          className="mt-4 inline-flex items-center gap-1.5 text-xs text-white/70 underline"><Copy size={13} /> {copied ? 'Link copiado' : 'Copiar link de acompanhamento'}</button>
      </div>

      {s.status !== 'cancelado' && (
        <ol className="mt-6 space-y-0">
          {steps.map((st, i) => {
            const done = reached(st.key); const Icon = st.icon; const t = at(st.key);
            return (
              <li key={st.key} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <span className={`flex h-9 w-9 items-center justify-center rounded-full ${done ? 'bg-brand-600 text-white' : 'bg-stone-200 text-stone-400'}`}><Icon size={17} /></span>
                  {i < steps.length - 1 && <span className={`h-8 w-0.5 ${reached(steps[i + 1].key) ? 'bg-brand-600' : 'bg-stone-200'}`} />}
                </div>
                <div className="pt-1.5"><p className={`font-semibold ${done ? '' : 'text-stone-400'}`}>{st.label}</p>{t && <p className="text-xs text-stone-500">{timeBR(t)}</p>}</div>
              </li>
            );
          })}
        </ol>
      )}

      <div className="mt-6 rounded-3xl bg-white p-5 shadow-card">
        <h2 className="font-display text-lg font-bold">Resumo</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {s.items.map((it, i) => (
            <li key={i} className="flex justify-between gap-3">
              <span>{Number(it.quantity)}× {it.name}{it.options?.length ? <span className="block text-xs text-stone-500">{it.options.map((o) => o.name).join(' · ')}</span> : null}</span>
              <span className="tabular-nums">{money(it.total)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-4 space-y-1 border-t border-black/5 pt-3 text-sm text-stone-600">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(s.subtotal)}</dd></div>
          {delivery && <div className="flex justify-between"><dt>Entrega</dt><dd>{money(s.delivery_fee)}</dd></div>}
          {Number(s.discount) > 0 && <div className="flex justify-between text-emerald-700"><dt>Desconto</dt><dd>− {money(s.discount)}</dd></div>}
          <div className="flex justify-between text-base font-bold text-char"><dt>Total</dt><dd>{money(s.total)}</dd></div>
          <div className="flex justify-between"><dt>Pagamento</dt><dd>{s.payment_method}{s.change_for ? ` · troco p/ ${money(s.change_for)}` : ''}</dd></div>
        </dl>
      </div>
      <Link to="/" className="btn-outline mt-6 w-full py-3">Fazer outro pedido</Link>
    </div>
  );
}
