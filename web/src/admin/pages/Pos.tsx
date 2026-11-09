import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, Printer, Trash2, UserRound, X } from 'lucide-react';
import { rpc } from '../../lib/supabase';
import { money, formatPhone, dateTimeBR } from '../../lib/format';
import { lineKey, round2, unitPrice, validateOptions, type CartLine } from '../../lib/cart';
import type { MenuProduct } from '../../lib/types';
import { Field, Modal, PinModal, useToast } from '../ui';
import { printOrder, printOrderEscPos } from '../print';
import { supabase } from '../../lib/supabase';

interface Cat { categories: { id: string; name: string }[]; products: (MenuProduct & { sku: string; barcode: string })[];
  payment_methods: { code: string; name: string; method_type: string; allows_change: boolean }[]; delivery_zones: { id: string; district: string; fee: number }[] }
interface Pay { method: string; amount: string; tendered: string }

export default function Pos() {
  const toast = useToast();
  const [reg, setReg] = useState<any | null | undefined>(undefined);
  const [cat, setCat] = useState<Cat | null>(null);
  const loadReg = useCallback(() => rpc<any>('my_open_cash_register').then((r) => setReg(r?.id ? r : null)).catch((e) => toast(e.message, 'err')), [toast]);
  useEffect(() => { loadReg(); rpc<Cat>('pos_catalog').then(setCat).catch((e) => toast(e.message, 'err')); }, [loadReg, toast]);

  if (reg === undefined || !cat) return <p className="text-stone-500">Carregando caixa…</p>;
  if (!reg) return <OpenRegister onOpened={loadReg} />;
  return <Register reg={reg} cat={cat} onClosed={loadReg} />;
}

function OpenRegister({ onOpened }: { onOpened: () => void }) {
  const toast = useToast();
  const [terminal, setTerminal] = useState('Caixa 1'); const [amount, setAmount] = useState('');
  return (
    <div className="mx-auto mt-10 max-w-sm rounded-md border border-char/10 bg-white p-6 dark:bg-stone-900">
      <h1 className="heading text-2xl">Abrir caixa</h1>
      <p className="mt-1 text-sm text-stone-500">Conte o dinheiro da gaveta (fundo de troco) antes de abrir.</p>
      <Field label="Terminal" className="mt-4"><input className="input" value={terminal} onChange={(e) => setTerminal(e.target.value)} /></Field>
      <Field label="Fundo de troco (R$)" className="mt-3"><input className="input" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field>
      <button className="btn-dark mt-5 w-full py-3" onClick={async () => {
        try { await rpc('open_cash_register', { p_terminal: terminal, p_opening_amount: Number(amount || 0) }); toast('Caixa aberto'); onOpened(); }
        catch (e) { toast((e as Error).message, 'err'); }
      }}>Abrir caixa</button>
    </div>
  );
}

function Register({ reg, cat, onClosed }: { reg: any; cat: Cat; onClosed: () => void }) {
  const toast = useToast();
  const [lines, setLines] = useState<CartLine[]>([]);
  const [q, setQ] = useState(''); const [catId, setCatId] = useState<string>('');
  const [optProduct, setOptProduct] = useState<Cat['products'][number] | null>(null);
  const [customer, setCustomer] = useState<{ id: string; name: string; phone: string; loyalty_points: number } | null>(null);
  const [custOpen, setCustOpen] = useState(false);
  const [channel, setChannel] = useState<'balcao' | 'retirada' | 'delivery'>('balcao');
  const [zone, setZone] = useState(''); const [address, setAddress] = useState({ street: '', number: '', complement: '', reference: '' });
  const [discType, setDiscType] = useState<'valor' | 'percentual'>('valor'); const [disc, setDisc] = useState('');
  const [coupon, setCoupon] = useState(''); const [notes, setNotes] = useState('');
  const [pays, setPays] = useState<Pay[]>([{ method: 'dinheiro', amount: '', tendered: '' }]);
  const [pin, setPin] = useState(false); const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<any | null>(null);
  const [cashOp, setCashOp] = useState<'sangria' | 'suprimento' | 'fechar' | null>(null);
  const search = useRef<HTMLInputElement>(null);

  const sub = round2(lines.reduce((s, l) => s + l.unit_price * l.quantity, 0));
  const fee = channel === 'delivery' ? Number(cat.delivery_zones.find((z) => z.id === zone)?.fee ?? 0) : 0;
  const discount = Math.min(discType === 'percentual' ? round2(sub * Number(disc || 0) / 100) : Number(disc || 0), sub);
  const total = round2(sub + fee - discount);
  const paid = round2(pays.reduce((s, p) => s + Number(p.amount || 0), 0));
  const remaining = round2(total - paid);
  const change = round2(pays.reduce((s, p) => {
    const m = cat.payment_methods.find((x) => x.code === p.method);
    return s + (m?.allows_change && Number(p.tendered) > Number(p.amount) ? Number(p.tendered) - Number(p.amount) : 0);
  }, 0));

  const products = useMemo(() => {
    const t = q.trim().toLowerCase();
    return cat.products.filter((p) => (!catId || p.category_id === catId) && (!t || p.name.toLowerCase().includes(t) || p.sku?.toLowerCase() === t || p.barcode === t));
  }, [cat, q, catId]);

  function add(p: Cat['products'][number], optionIds: string[] = [], notes = '') {
    if (p.sold_out) return toast(`${p.name} está esgotado`, 'err');
    if (p.option_groups.length && !optionIds.length && p.option_groups.some((g) => g.options.length)) { setOptProduct(p); return; }
    const labels = p.option_groups.flatMap((g) => g.options.filter((o) => optionIds.includes(o.id)).map((o) => o.name));
    const key = lineKey(p.id, optionIds, notes);
    setLines((ls) => ls.some((l) => l.key === key) ? ls.map((l) => l.key === key ? { ...l, quantity: l.quantity + 1 } : l)
      : [...ls, { key, product_id: p.id, name: p.name, unit_price: unitPrice(p, optionIds), quantity: 1, option_ids: optionIds, option_labels: labels, notes, image_url: null, category_id: p.category_id }]);
  }
  // leitor de código de barras: digita o código + Enter
  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    const t = q.trim(); const exact = cat.products.find((p) => p.barcode === t || p.sku?.toLowerCase() === t.toLowerCase());
    if (exact) { add(exact); setQ(''); } else if (products.length === 1) { add(products[0]); setQ(''); }
  }
  useEffect(() => { search.current?.focus(); }, [done]);
  // quando há um único pagamento, acompanha o total
  useEffect(() => { setPays((ps) => ps.length === 1 ? [{ ...ps[0], amount: total ? total.toFixed(2) : '' }] : ps); }, [total]);

  function reset() {
    setLines([]); setCustomer(null); setChannel('balcao'); setZone(''); setAddress({ street: '', number: '', complement: '', reference: '' });
    setDisc(''); setCoupon(''); setNotes(''); setPays([{ method: 'dinheiro', amount: '', tendered: '' }]);
  }

  async function checkout(authorizer?: string) {
    if (!lines.length) return toast('Adicione itens', 'err');
    if (Math.abs(remaining) > 0.009) return toast(remaining > 0 ? `Faltam ${money(remaining)}` : `Pagamentos excedem o total em ${money(-remaining)}`, 'err');
    setBusy(true);
    try {
      const r = await rpc<any>('pos_checkout', { p: {
        cash_register_id: reg.id, channel, customer_id: customer?.id ?? null, customer_name: customer?.name ?? null, customer_phone: customer?.phone ?? null,
        items: lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity, option_ids: l.option_ids, notes: l.notes })),
        discount_type: discType, discount_value: Number(disc || 0), authorizer_pin: authorizer ?? null, coupon_code: coupon || null,
        notes, delivery_zone_id: channel === 'delivery' ? zone : null, delivery_address: channel === 'delivery' ? address : null,
        payments: pays.filter((p) => Number(p.amount) > 0).map((p) => ({ method: p.method, amount: Number(p.amount), tendered: p.tendered ? Number(p.tendered) : null })),
      } });
      if (Math.abs(Number(r.total) - total) > 0.009) toast(`Total recalculado pelo servidor: ${money(r.total)}`, 'err');
      const { data: o } = await supabase.from('orders').select('*').eq('id', r.order_id).maybeSingle();
      const { data: it } = await supabase.from('order_items').select('*').eq('order_id', r.order_id);
      const { data: py } = await supabase.from('payments').select('*').eq('order_id', r.order_id);
      setDone({ ...r, order: { ...(o ?? {}), items: it ?? [], payments: py ?? [] }, hasCash: pays.some((p) => p.method === 'dinheiro') });
      reset();
    } catch (e) {
      const m = (e as Error).message;
      if (/PIN/.test(m)) setPin(true); else toast(m, 'err');
    } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
      {/* PRODUTOS */}
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div><h1 className="heading text-2xl leading-none">{reg.terminal_name}</h1><p className="text-xs text-stone-500">Aberto em {dateTimeBR(reg.opened_at)}</p></div>
          <div className="flex gap-2">
            <button className="btn-outline py-2 text-sm" onClick={() => setCashOp('sangria')}>Sangria</button>
            <button className="btn-outline py-2 text-sm" onClick={() => setCashOp('suprimento')}>Suprimento</button>
            <button className="btn-dark py-2 text-sm" onClick={() => setCashOp('fechar')}>Fechar caixa</button>
          </div>
        </div>
        <input ref={search} className="input text-lg" placeholder="Buscar produto ou ler código de barras (Enter)" value={q}
          onChange={(e) => setQ(e.target.value)} onKeyDown={onSearchKey} aria-label="Buscar produto" />
        <div className="no-scrollbar mt-3 flex gap-1 overflow-x-auto border-b border-char/10">
          <button className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${!catId ? 'border-red-600' : 'border-transparent text-stone-500'}`} onClick={() => setCatId('')}>Todos</button>
          {cat.categories.map((c) => <button key={c.id} onClick={() => setCatId(c.id)} className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${catId === c.id ? 'border-red-600' : 'border-transparent text-stone-500'}`}>{c.name}</button>)}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((p) => (
            <button key={p.id} onClick={() => add(p)} disabled={p.sold_out}
              className="flex min-h-[78px] flex-col justify-between rounded-md border border-char/10 bg-white p-3 text-left hover:border-char/40 active:bg-stone-50 disabled:opacity-40 dark:bg-stone-900">
              <span className="text-[14px] font-semibold leading-tight">{p.name}</span>
              <span className="mt-1 text-[13px] tabular-nums text-stone-600">{money(p.price)}{p.unit === 'kg' ? '/kg' : ''}{p.sold_out ? ' · esgotado' : ''}</span>
            </button>
          ))}
        </div>
      </div>

      {/* CUPOM */}
      <aside className="flex flex-col rounded-md border border-char/10 bg-white dark:bg-stone-900 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)]">
        <div className="flex items-center gap-2 border-b border-char/10 p-3">
          {(['balcao', 'retirada', 'delivery'] as const).map((c) => (
            <button key={c} onClick={() => setChannel(c)} className={`flex-1 rounded px-2 py-1.5 text-sm font-medium ${channel === c ? 'bg-char text-white' : 'border border-char/15'}`}>
              {c === 'balcao' ? 'Balcão' : c === 'retirada' ? 'Retirada' : 'Entrega'}</button>))}
        </div>
        <button className="flex items-center gap-2 border-b border-char/10 px-3 py-2 text-left text-sm" onClick={() => setCustOpen(true)}>
          <UserRound size={16} /> {customer ? <span><b>{customer.name}</b> · {formatPhone(customer.phone ?? '')}{customer.loyalty_points ? ` · ${customer.loyalty_points} pts` : ''}</span> : <span className="text-stone-500">Identificar cliente (opcional)</span>}
          {customer && <X size={14} className="ml-auto" onClick={(e) => { e.stopPropagation(); setCustomer(null); }} />}
        </button>
        {channel === 'delivery' && (
          <div className="grid grid-cols-2 gap-2 border-b border-char/10 p-3">
            <select className="input col-span-2 py-2 text-sm" value={zone} onChange={(e) => setZone(e.target.value)}><option value="">Bairro…</option>
              {cat.delivery_zones.map((z) => <option key={z.id} value={z.id}>{z.district} · {money(z.fee)}</option>)}</select>
            <input className="input py-2 text-sm" placeholder="Rua" value={address.street} onChange={(e) => setAddress({ ...address, street: e.target.value })} />
            <input className="input py-2 text-sm" placeholder="Nº / compl." value={address.number} onChange={(e) => setAddress({ ...address, number: e.target.value })} />
          </div>
        )}
        <ul className="min-h-[120px] flex-1 divide-y divide-char/10 overflow-y-auto">
          {lines.length === 0 && <li className="p-6 text-center text-sm text-stone-400">Nenhum item.</li>}
          {lines.map((l) => (
            <li key={l.key} className="px-3 py-2">
              <div className="flex justify-between gap-2 text-sm"><span className="font-medium">{l.name}</span><span className="tabular-nums">{money(l.unit_price * l.quantity)}</span></div>
              {l.option_labels.length > 0 && <p className="text-xs text-stone-500">{l.option_labels.join(', ')}</p>}
              <div className="mt-1 flex items-center gap-1">
                <button className="rounded border border-char/15 p-1" onClick={() => setLines((ls) => ls.map((x) => x.key === l.key ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x))} aria-label="Menos"><Minus size={13} /></button>
                <span className="w-7 text-center text-sm tabular-nums">{l.quantity}</span>
                <button className="rounded border border-char/15 p-1" onClick={() => setLines((ls) => ls.map((x) => x.key === l.key ? { ...x, quantity: x.quantity + 1 } : x))} aria-label="Mais"><Plus size={13} /></button>
                <input className="ml-2 flex-1 border-b border-transparent bg-transparent text-xs outline-none focus:border-char/30" placeholder="observação" value={l.notes}
                  onChange={(e) => setLines((ls) => ls.map((x) => x.key === l.key ? { ...x, notes: e.target.value } : x))} />
                <button className="p-1 text-stone-400 hover:text-red-700" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label="Remover"><Trash2 size={14} /></button>
              </div>
            </li>
          ))}
        </ul>
        <div className="space-y-2 border-t border-char/10 p-3 text-sm">
          <div className="flex gap-2">
            <select className="input w-24 py-1.5 text-sm" value={discType} onChange={(e) => setDiscType(e.target.value as any)} aria-label="Tipo de desconto"><option value="valor">R$</option><option value="percentual">%</option></select>
            <input className="input py-1.5 text-sm" type="number" min="0" step="0.01" placeholder="Desconto" value={disc} onChange={(e) => setDisc(e.target.value)} aria-label="Desconto" />
            <input className="input py-1.5 text-sm uppercase" placeholder="Cupom" value={coupon} onChange={(e) => setCoupon(e.target.value)} aria-label="Cupom" />
          </div>
          <input className="input py-1.5 text-sm" placeholder="Observação do pedido" value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Observação do pedido" />
          <dl className="space-y-0.5 pt-1">
            <div className="flex justify-between"><dt>Subtotal</dt><dd className="tabular-nums">{money(sub)}</dd></div>
            {discount > 0 && <div className="flex justify-between"><dt>Desconto</dt><dd className="tabular-nums">− {money(discount)}</dd></div>}
            {fee > 0 && <div className="flex justify-between"><dt>Entrega</dt><dd className="tabular-nums">{money(fee)}</dd></div>}
            <div className="flex justify-between text-2xl font-bold"><dt>Total</dt><dd className="tabular-nums">{money(total)}</dd></div>
          </dl>
          {pays.map((p, i) => {
            const m = cat.payment_methods.find((x) => x.code === p.method);
            return (
              <div key={i} className="flex gap-1.5">
                <select className="input py-1.5 text-sm" value={p.method} onChange={(e) => setPays((ps) => ps.map((x, j) => j === i ? { ...x, method: e.target.value } : x))} aria-label="Forma de pagamento">
                  {cat.payment_methods.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}</select>
                <input className="input w-28 py-1.5 text-sm" type="number" step="0.01" value={p.amount} onChange={(e) => setPays((ps) => ps.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} aria-label="Valor" />
                {m?.allows_change && <input className="input w-28 py-1.5 text-sm" type="number" step="0.01" placeholder="Recebido" value={p.tendered} onChange={(e) => setPays((ps) => ps.map((x, j) => j === i ? { ...x, tendered: e.target.value } : x))} aria-label="Valor recebido" />}
                {pays.length > 1 && <button className="px-1 text-stone-400" onClick={() => setPays((ps) => ps.filter((_, j) => j !== i))} aria-label="Remover pagamento"><X size={14} /></button>}
              </div>
            );
          })}
          <div className="flex items-center justify-between text-sm">
            <button className="text-stone-600 underline" onClick={() => setPays((ps) => [...ps, { method: 'pix', amount: remaining > 0 ? remaining.toFixed(2) : '', tendered: '' }])}>+ dividir pagamento</button>
            <span className={remaining > 0.009 ? 'text-red-700' : ''}>{remaining > 0.009 ? `Faltam ${money(remaining)}` : change > 0 ? <b>Troco: {money(change)}</b> : 'Pago'}</span>
          </div>
          <button className="btn-primary w-full py-3.5 text-lg" disabled={busy || !lines.length} onClick={() => checkout()}>{busy ? 'Registrando…' : `Finalizar ${money(total)}`}</button>
        </div>
      </aside>

      {optProduct && <OptionsModal p={optProduct} onClose={() => setOptProduct(null)} addRaw={(ids) => {
        const labels = optProduct.option_groups.flatMap((g) => g.options.filter((o) => ids.includes(o.id)).map((o) => o.name));
        const key = lineKey(optProduct.id, ids, '');
        setLines((ls) => ls.some((l) => l.key === key) ? ls.map((l) => l.key === key ? { ...l, quantity: l.quantity + 1 } : l)
          : [...ls, { key, product_id: optProduct.id, name: optProduct.name, unit_price: unitPrice(optProduct, ids), quantity: 1, option_ids: ids, option_labels: labels, notes: '', image_url: null, category_id: optProduct.category_id }]);
        setOptProduct(null);
      }} />}
      {custOpen && <CustomerPicker onClose={() => setCustOpen(false)} onPick={(c) => { setCustomer(c); setCustOpen(false); }} />}
      {pin && <PinModal title="Desconto acima do seu limite" onClose={() => setPin(false)} onConfirm={async (p) => { setPin(false); await checkout(p); }} />}
      {done && <DoneModal r={done} onClose={() => setDone(null)} />}
      {cashOp && <CashOpModal op={cashOp} reg={reg} onClose={() => setCashOp(null)} onDone={() => { setCashOp(null); if (cashOp === 'fechar') onClosed(); }} />}
    </div>
  );
}

function OptionsModal({ p, onClose, addRaw }: { p: Cat['products'][number]; onClose: () => void; addRaw: (ids: string[]) => void }) {
  const [sel, setSel] = useState<string[]>(() => p.option_groups.filter((g) => g.min_select === 1 && g.max_select === 1).map((g) => g.options[0]?.id).filter(Boolean) as string[]);
  const err = validateOptions(p.option_groups, sel);
  return (
    <Modal title={p.name} onClose={onClose} footer={<><button className="btn-outline" onClick={onClose}>Cancelar</button>
      <button className="btn-primary" disabled={!!err} onClick={() => addRaw(sel)}>Adicionar {money(unitPrice(p, sel))}</button></>}>
      {p.option_groups.map((g) => (
        <fieldset key={g.id} className="mb-4"><legend className="mb-1 font-semibold">{g.name} <span className="text-xs font-normal text-stone-500">{g.min_select ? 'obrigatório' : 'opcional'} · até {g.max_select}</span></legend>
          <div className="grid grid-cols-2 gap-2">{g.options.map((o) => {
            const on = sel.includes(o.id);
            return <button key={o.id} onClick={() => setSel((s) => {
              const ids = g.options.map((x) => x.id);
              if (g.max_select === 1) return [...s.filter((x) => !ids.includes(x)), o.id];
              return on ? s.filter((x) => x !== o.id) : s.filter((x) => ids.includes(x)).length >= g.max_select ? s : [...s, o.id];
            })} className={`rounded border px-3 py-2 text-left text-sm ${on ? 'border-char bg-char text-white' : 'border-char/15'}`}>{o.name}{Number(o.price_delta) > 0 && ` +${money(o.price_delta)}`}</button>;
          })}</div></fieldset>))}
      {err && <p className="text-sm text-red-700">{err}</p>}
    </Modal>
  );
}

function CustomerPicker({ onClose, onPick }: { onClose: () => void; onPick: (c: any) => void }) {
  const [t, setT] = useState(''); const [res, setRes] = useState<any[]>([]); const [name, setName] = useState('');
  useEffect(() => { if (t.trim().length < 2) { setRes([]); return; } const h = setTimeout(() => rpc<any[]>('search_customers', { p_term: t }).then(setRes).catch(() => {}), 250); return () => clearTimeout(h); }, [t]);
  return (
    <Modal title="Cliente" onClose={onClose}>
      <input className="input" autoFocus placeholder="Telefone ou nome" value={t} onChange={(e) => setT(e.target.value)} />
      <ul className="mt-2 divide-y divide-char/10">{res.map((c) => <li key={c.id}><button className="w-full py-2 text-left text-sm" onClick={() => onPick(c)}><b>{c.name}</b> · {formatPhone(c.phone ?? '')}</button></li>)}</ul>
      <div className="mt-4 border-t border-char/10 pt-3"><p className="mb-2 text-sm font-semibold">Cadastrar rapidamente</p>
        <div className="flex gap-2"><input className="input" placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn-dark shrink-0" disabled={name.trim().length < 2 || t.replace(/\D/g, '').length < 10} onClick={async () => {
            const id = await rpc<string>('quick_customer', { p_name: name, p_phone: t }); onPick({ id, name, phone: t.replace(/\D/g, ''), loyalty_points: 0 });
          }}>Salvar</button></div>
        <p className="mt-1 text-xs text-stone-500">Digite o telefone no campo acima.</p></div>
    </Modal>
  );
}

function DoneModal({ r, onClose }: { r: any; onClose: () => void }) {
  const toast = useToast();
  return (
    <Modal title={`Venda registrada — pedido #${r.number}`} onClose={onClose} footer={<>
      {r.hasCash && <button className="btn-outline mr-auto" onClick={() => printOrderEscPos(r.order, 'cliente', 80, true).catch((e) => toast(e.message, 'err'))}>Abrir gaveta + imprimir (ESC/POS)</button>}
      <button className="btn-outline" onClick={() => printOrder(r.order, 'cliente', 80)}><Printer size={15} /> Comprovante 80 mm</button>
      <button className="btn-outline" onClick={() => printOrder(r.order, 'cliente', 58)}>58 mm</button>
      <button className="btn-dark" onClick={onClose} autoFocus>Nova venda</button></>}>
      <p className="text-lg">Total: <b>{money(r.total)}</b></p>
      {Number(r.change) > 0 && <p className="mt-2 text-3xl font-bold">Troco: {money(r.change)}</p>}
      <p className="mt-2 text-sm text-stone-500">{r.status === 'entregue' ? 'Venda concluída.' : 'Pedido enviado para a cozinha.'}</p>
    </Modal>
  );
}

function CashOpModal({ op, reg, onClose, onDone }: { op: 'sangria' | 'suprimento' | 'fechar'; reg: any; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState(''); const [reason, setReason] = useState(''); const [account, setAccount] = useState(''); const [pinV, setPinV] = useState('');
  const [accounts, setAccounts] = useState<any[]>([]); const [summary, setSummary] = useState<any>(null);
  const [counted, setCounted] = useState<Record<string, string>>({}); const [result, setResult] = useState<any>(null);
  useEffect(() => {
    supabase.from('financial_accounts').select('id,name').eq('is_active', true).then(({ data }) => setAccounts(data ?? []));
    if (op === 'fechar') rpc<any>('cash_register_summary', { p_register: reg.id }).then(setSummary).catch((e) => toast(e.message, 'err'));
  }, [op, reg.id, toast]);
  const methods = summary ? Array.from(new Set(['dinheiro', ...Object.keys(summary.by_method ?? {})])) : [];

  if (op === 'fechar') return (
    <Modal title="Fechar caixa" onClose={onClose} footer={result ? <button className="btn-dark" onClick={onDone}>Concluir</button> : <>
      <button className="btn-outline" onClick={onClose}>Voltar</button>
      <button className="btn-primary" onClick={async () => {
        try { setResult(await rpc('close_cash_register', { p_register: reg.id, p_counted: Object.fromEntries(methods.map((m) => [m, Number(counted[m] || 0)])), p_notes: reason || null })); }
        catch (e) { toast((e as Error).message, 'err'); }
      }}>Confirmar fechamento</button></>}>
      {!result ? <>
        <p className="mb-3 text-sm text-stone-600">Informe os valores <b>contados</b> por forma de pagamento (dinheiro na gaveta, comprovantes de cartão, Pix recebidos). O sistema compara com o esperado.</p>
        {summary && <p className="mb-3 text-sm">{summary.sales_count} venda(s) · {money(summary.sales_total)} · sangrias {money(summary.withdrawals)} · suprimentos {money(summary.supplies)}</p>}
        {methods.map((m) => <Field key={m} label={`Contado — ${m}`} className="mb-2"><input className="input" type="number" step="0.01" value={counted[m] ?? ''} onChange={(e) => setCounted({ ...counted, [m]: e.target.value })} /></Field>)}
        <Field label="Observações"><textarea className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </> : <table className="w-full text-sm"><thead><tr className="text-left text-stone-500"><th>Forma</th><th className="text-right">Esperado</th><th className="text-right">Contado</th><th className="text-right">Diferença</th></tr></thead>
        <tbody>{Object.keys({ ...result.expected, ...result.counted }).map((k) => { const d = Number(result.counted?.[k] ?? 0) - Number(result.expected?.[k] ?? 0); return (
          <tr key={k} className="border-t border-char/10"><td className="py-1">{k}</td><td className="text-right">{money(result.expected?.[k] ?? 0)}</td><td className="text-right">{money(result.counted?.[k] ?? 0)}</td>
            <td className={`text-right font-semibold ${Math.abs(d) >= 0.01 ? 'text-red-700' : 'text-green-800'}`}>{money(d)}</td></tr>); })}</tbody>
        <tfoot><tr className="border-t border-char/20 font-bold"><td colSpan={3}>Diferença total</td><td className="text-right">{money(result.difference)}</td></tr></tfoot></table>}
    </Modal>
  );
  return (
    <Modal title={op === 'sangria' ? 'Sangria (retirada de dinheiro)' : 'Suprimento (entrada de dinheiro)'} onClose={onClose} footer={<>
      <button className="btn-outline" onClick={onClose}>Voltar</button>
      <button className="btn-primary" onClick={async () => {
        try { await rpc('cash_movement', { p_register: reg.id, p_type: op, p_amount: Number(amount), p_reason: reason, p_account: account || null, p_pin: pinV || null }); toast('Registrado'); onDone(); }
        catch (e) { toast((e as Error).message, 'err'); }
      }}>Registrar</button></>}>
      <Field label="Valor (R$)"><input className="input" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field>
      <Field label="Motivo" className="mt-3"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <Field label={op === 'sangria' ? 'Destino do dinheiro' : 'Origem do dinheiro'} className="mt-3" hint="Gera a transferência no financeiro (ex.: Cofre).">
        <select className="input" value={account} onChange={(e) => setAccount(e.target.value)}><option value="">Somente registrar no caixa</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
      {op === 'sangria' && <Field label="PIN do gerente (se exigido)" className="mt-3"><input className="input" type="password" inputMode="numeric" value={pinV} onChange={(e) => setPinV(e.target.value.replace(/\D/g, ''))} /></Field>}
    </Modal>
  );
}
