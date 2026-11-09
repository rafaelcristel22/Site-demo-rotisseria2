import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useCart } from './CartContext';
import { rpc } from '../lib/supabase';
import { formatPhone, money } from '../lib/format';
import { changeDue, deliveryFee } from '../lib/cart';

interface Quote { subtotal: number; delivery_fee: number; discount: number; total: number; coupon?: { valid: boolean; message: string } | null; min_order_value: number }
const PROFILE_KEY = 'rotisseria.profile.v1'; // apenas conveniência para preencher o formulário

function loadProfile() { try { return JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '{}'); } catch { return {}; } }

export default function CheckoutPage() {
  const { menu, lines, subtotal, clear } = useCart();
  const nav = useNavigate();
  const saved = useMemo(loadProfile, []);
  const c = menu?.company;
  const [ful, setFul] = useState<'delivery' | 'retirada'>(c?.delivery_enabled === false ? 'retirada' : 'delivery');
  const [when, setWhen] = useState<'agora' | 'agendar'>(c && !c.is_open_now ? 'agendar' : 'agora');
  const [schedDate, setSchedDate] = useState('');
  const [schedTime, setSchedTime] = useState('');
  const [name, setName] = useState(saved.name ?? '');
  const [phone, setPhone] = useState(saved.phone ?? '');
  const [zoneId, setZoneId] = useState(saved.zoneId ?? '');
  const [street, setStreet] = useState(saved.street ?? '');
  const [number, setNumber] = useState(saved.number ?? '');
  const [complement, setComplement] = useState(saved.complement ?? '');
  const [reference, setReference] = useState(saved.reference ?? '');
  const [pay, setPay] = useState('');
  const [changeFor, setChangeFor] = useState('');
  const [coupon, setCoupon] = useState('');
  const [couponApplied, setCouponApplied] = useState('');
  const [notes, setNotes] = useState('');
  const [privacy, setPrivacy] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const zone = menu?.delivery_zones.find((z) => z.id === zoneId);
  const method = menu?.payment_methods.find((m) => m.code === pay);
  const localFee = ful === 'delivery' ? deliveryFee(subtotal, zone) : 0;
  const shown = quote ?? { subtotal, delivery_fee: localFee, discount: 0, total: subtotal + localFee, min_order_value: 0 };

  useEffect(() => {
    if (!lines.length) return;
    const t = setTimeout(() => {
      rpc<Quote>('public_quote', { p: {
        items: lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity, option_ids: l.option_ids })),
        fulfillment: ful, delivery_zone_id: zoneId || null, coupon_code: couponApplied || null, phone,
      } }).then(setQuote).catch(() => setQuote(null));
    }, 250);
    return () => clearTimeout(t);
  }, [lines, ful, zoneId, couponApplied, phone]);

  if (!menu || !c) return null;
  if (!lines.length) return (
    <div className="mx-auto max-w-md p-8 text-center">
      <p className="heading text-2xl">Sua sacola está vazia</p>
      <Link to="/" className="btn-primary mt-4">Ver cardápio</Link>
    </div>
  );

  const today = new Date();
  const maxDate = new Date(today.getTime() + c.scheduling_max_days * 86400000);
  const change = method?.allows_change && changeFor ? changeDue(shown.total, Number(changeFor.replace(',', '.'))) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!privacy) { setError('Para concluir, aceite a política de privacidade.'); return; }
    if (!pay) { setError('Escolha a forma de pagamento.'); return; }
    if (when === 'agendar' && (!schedDate || !schedTime)) { setError('Informe a data e o horário do agendamento.'); return; }
    if (method?.allows_change && changeFor && change === null) { setError('O troco deve ser para um valor maior que o total.'); return; }
    setSending(true);
    try {
      const scheduled = when === 'agendar' ? new Date(`${schedDate}T${schedTime}:00`).toISOString() : null;
      const r = await rpc<{ tracking_code: string }>('place_public_order', { p: {
        customer: { name, phone },
        fulfillment: ful, delivery_zone_id: ful === 'delivery' ? zoneId : null,
        address: ful === 'delivery' ? { street, number, complement, reference } : null,
        scheduled_for: scheduled,
        items: lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity, option_ids: l.option_ids, notes: l.notes })),
        payment_method: pay, change_for: method?.allows_change && changeFor ? Number(changeFor.replace(',', '.')) : null,
        coupon_code: couponApplied || null, notes,
        consents: { privacy: true, marketing },
      } });
      try { localStorage.setItem(PROFILE_KEY, JSON.stringify({ name, phone, zoneId, street, number, complement, reference })); } catch { /* ignore */ }
      clear();
      nav(`/pedido/${r.tracking_code}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally { setSending(false); }
  }

  return (
    <form onSubmit={submit} className="mx-auto min-h-screen max-w-lg bg-paper pb-44 sm:border-x sm:border-char/10">
      <header className="sticky top-0 z-20 flex items-center gap-1 border-b border-char/10 bg-paper px-2 py-2">
        <Link to="/" className="btn-ghost p-2" aria-label="Voltar"><ArrowLeft size={20} /></Link>
        <h1 className="heading text-[22px]">Fechar pedido</h1>
      </header>

      <Section title="Entrega ou retirada">
        <div className="grid grid-cols-2 gap-2">
          {c.delivery_enabled && <Choice active={ful === 'delivery'} onClick={() => setFul('delivery')} title="Entregar" sub={zone ? `~${zone.estimated_minutes + c.avg_prep_minutes} min` : 'no seu endereço'} />}
          {c.pickup_enabled && <Choice active={ful === 'retirada'} onClick={() => setFul('retirada')} title="Retirar no balcão" sub={`~${c.avg_prep_minutes} min, sem taxa`} />}
        </div>
        {c.scheduling_enabled && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Choice active={when === 'agora'} disabled={!c.is_open_now} onClick={() => setWhen('agora')} title="Agora" sub={c.is_open_now ? 'assim que ficar pronto' : 'estamos fechados'} />
            <Choice active={when === 'agendar'} onClick={() => setWhen('agendar')} title="Agendar" sub={`até ${c.scheduling_max_days} dias`} />
          </div>
        )}
        {when === 'agendar' && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div><label className="label" htmlFor="sd">Data</label>
              <input id="sd" type="date" className="input" required value={schedDate} onChange={(e) => setSchedDate(e.target.value)}
                min={today.toISOString().slice(0, 10)} max={maxDate.toISOString().slice(0, 10)} /></div>
            <div><label className="label" htmlFor="st">Horário</label>
              <input id="st" type="time" className="input" required value={schedTime} onChange={(e) => setSchedTime(e.target.value)} step={900} /></div>
          </div>
        )}
      </Section>

      <Section title="Quem vai receber">
        <div className="space-y-3">
          <div><label className="label" htmlFor="nm">Nome</label>
            <input id="nm" className="input" required minLength={2} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label className="label" htmlFor="ph">Telefone (WhatsApp)</label>
            <input id="ph" className="input" required inputMode="tel" autoComplete="tel" placeholder="(00) 00000-0000"
              value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} pattern="\(\d{2}\) \d{4,5}-\d{4}" /></div>
        </div>
      </Section>

      {ful === 'delivery' && (
        <Section title="Endereço">
          <div className="space-y-3">
            <div><label className="label" htmlFor="zn">Bairro</label>
              <select id="zn" className="input" required value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
                <option value="">Selecione o bairro</option>
                {menu.delivery_zones.map((z) => <option key={z.id} value={z.id}>{z.district}{z.city ? ` — ${z.city}` : ''} · {Number(z.fee) === 0 ? 'grátis' : money(z.fee)}</option>)}
              </select>
              {menu.delivery_zones.length === 0 && <p className="mt-1 text-[14px] text-red-700">Ainda não há bairros de entrega cadastrados. Escolha retirada.</p>}
              {zone?.free_delivery_above != null && <p className="mt-1 text-[14px] text-green-800">Entrega grátis acima de {money(zone.free_delivery_above)}</p>}
            </div>
            <div className="grid grid-cols-[1fr_96px] gap-2">
              <div><label className="label" htmlFor="sr">Rua</label><input id="sr" className="input" required autoComplete="address-line1" value={street} onChange={(e) => setStreet(e.target.value)} /></div>
              <div><label className="label" htmlFor="nb">Número</label><input id="nb" className="input" required value={number} onChange={(e) => setNumber(e.target.value)} /></div>
            </div>
            <div><label className="label" htmlFor="cp">Complemento</label><input id="cp" className="input" placeholder="Apto, bloco…" value={complement} onChange={(e) => setComplement(e.target.value)} /></div>
            <div><label className="label" htmlFor="rf">Ponto de referência</label><input id="rf" className="input" value={reference} onChange={(e) => setReference(e.target.value)} /></div>
          </div>
        </Section>
      )}

      <Section title="Pagamento">
        <p className="-mt-1 mb-2 text-[14px] text-stone-600">Você paga na {ful === 'delivery' ? 'entrega' : 'retirada'}.</p>
        <div className="divide-y divide-char/10 border-y border-char/10">
          {menu.payment_methods.map((m) => (
            <label key={m.code} className="flex cursor-pointer items-center gap-3 py-3">
              <input type="radio" name="pay" className="h-5 w-5 accent-red-600" checked={pay === m.code} onChange={() => setPay(m.code)} />
              <span className="text-[16px]">{m.name}</span>
            </label>
          ))}
        </div>
        {method?.allows_change && (
          <div className="mt-3"><label className="label" htmlFor="tr">Troco para quanto? (opcional)</label>
            <input id="tr" className="input" inputMode="decimal" placeholder="Ex.: 100" value={changeFor} onChange={(e) => setChangeFor(e.target.value.replace(/[^\d,.]/g, ''))} />
            {change !== null && <p className="mt-1 text-[14px] text-stone-700">Troco: <b>{money(change)}</b></p>}
          </div>
        )}
      </Section>

      <Section title="Cupom e observação">
        <div className="flex gap-2">
          <input className="input flex-1 uppercase" placeholder="Código do cupom" value={coupon} onChange={(e) => setCoupon(e.target.value)} aria-label="Cupom" />
          <button type="button" className="btn-outline" onClick={() => setCouponApplied(coupon.trim())} disabled={!coupon.trim()}>Aplicar</button>
        </div>
        {couponApplied && quote?.coupon && <p className={`mt-1.5 text-[14px] ${quote.coupon.valid ? 'text-green-800' : 'text-red-700'}`}>{quote.coupon.message}</p>}
        <textarea className="input mt-3 min-h-[70px] resize-none" placeholder="Observação (opcional)" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Observações" />
      </Section>

      <Section title="Seus dados">
        <label className="flex gap-3 text-sm"><input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-red-600" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} />
          <span>Autorizo o uso do meu nome, telefone e endereço para este pedido. <span className="text-stone-500">{c.privacy_policy_text}</span>
          {c.privacy_policy_url && <> <a className="underline" href={c.privacy_policy_url} target="_blank" rel="noreferrer">Política de privacidade</a></>}</span></label>
        <label className="mt-3 flex gap-3 text-sm"><input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-red-600" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
          <span>Pode me mandar promoções pelo WhatsApp. <span className="text-stone-500">(opcional)</span></span></label>
      </Section>

      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-lg border-t border-char/15 bg-paper px-5 pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
        <dl className="space-y-0.5 text-[15px]">
          <Row k="Subtotal" v={money(shown.subtotal)} />
          {ful === 'delivery' && <Row k="Entrega" v={zone ? (Number(shown.delivery_fee) === 0 ? 'Grátis' : money(shown.delivery_fee)) : 'Selecione o bairro'} />}
          {Number(shown.discount) > 0 && <Row k="Desconto" v={`− ${money(shown.discount)}`} green />}
          <div className="flex justify-between pt-1 text-lg font-bold"><dt>Total</dt><dd className="tabular-nums">{money(shown.total)}</dd></div>
        </dl>
        {error && <p role="alert" className="mt-2 border-l-4 border-red-600 bg-white px-3 py-2 text-[14px] text-red-800">{error}</p>}
        <button type="submit" disabled={sending} className="btn-primary mt-3 w-full py-3.5 text-[17px]">
          {sending ? <><Loader2 size={18} className="animate-spin" /> Enviando…</> : 'Enviar pedido'}
        </button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="border-b border-char/10 px-5 py-5"><h2 className="heading mb-3 text-[19px]">{title}</h2>{children}</section>;
}
function Choice({ active, onClick, title, sub, disabled }: { active: boolean; onClick: () => void; title: string; sub: string; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} aria-pressed={active}
      className={`rounded-md border px-3 py-2.5 text-left transition disabled:opacity-40 ${active ? 'border-char bg-char text-white' : 'border-char/20'}`}>
      <span className="block text-[16px] font-semibold leading-tight">{title}</span>
      <span className={`text-[13px] ${active ? 'text-white/75' : 'text-stone-500'}`}>{sub}</span>
    </button>
  );
}
function Row({ k, v, green }: { k: string; v: string; green?: boolean }) {
  return <div className={`flex justify-between ${green ? 'text-green-800' : 'text-stone-600'}`}><dt>{k}</dt><dd className="tabular-nums">{v}</dd></div>;
}
