import { useMemo, useState } from 'react';
import { Minus, Plus, X, Users, Clock } from 'lucide-react';
import type { MenuProduct } from '../lib/types';
import { lineKey, unitPrice, validateOptions } from '../lib/cart';
import { money } from '../lib/format';
import FoodArt from './FoodArt';
import { useCart } from './CartContext';

export default function ProductSheet({ product, slug, onClose }: { product: MenuProduct; slug?: string; onClose: () => void }) {
  const { add } = useCart();
  const [selected, setSelected] = useState<string[]>(() =>
    product.option_groups.filter((g) => g.min_select === 1 && g.max_select === 1 && g.options[0]).map((g) => g.options[0].id));
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');
  const [touched, setTouched] = useState(false);
  const price = useMemo(() => unitPrice(product, selected), [product, selected]);
  const error = validateOptions(product.option_groups, selected);

  function toggle(groupId: string, optionId: string) {
    const g = product.option_groups.find((x) => x.id === groupId)!;
    const inGroup = g.options.map((o) => o.id);
    setSelected((s) => {
      if (g.max_select === 1) return [...s.filter((id) => !inGroup.includes(id)), optionId];
      if (s.includes(optionId)) return s.filter((id) => id !== optionId);
      if (s.filter((id) => inGroup.includes(id)).length >= g.max_select) return s;
      return [...s, optionId];
    });
  }

  function submit() {
    setTouched(true);
    if (error) return;
    const labels = product.option_groups.flatMap((g) => g.options.filter((o) => selected.includes(o.id)).map((o) => o.name));
    add({ key: lineKey(product.id, selected, notes), product_id: product.id, name: product.name, unit_price: price, quantity: qty,
      option_ids: selected, option_labels: labels, notes: notes.trim(), image_url: product.image_url, category_id: product.category_id });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={product.name}>
      <div className="animate-fade-in absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="animate-slide-up relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-cream sm:rounded-3xl">
        <button onClick={onClose} aria-label="Fechar" className="absolute right-3 top-3 z-10 rounded-full bg-black/40 p-2 text-white backdrop-blur"><X size={18} /></button>
        <div className="overflow-y-auto">
          <FoodArt src={product.image_url} slug={slug} alt={product.name} className="h-56 w-full" iconSize={72} />
          <div className="px-5 pb-4 pt-5">
            <h2 className="font-display text-[26px] font-bold leading-tight">{product.name}</h2>
            {product.description && <p className="mt-2 text-[15px] leading-relaxed text-stone-600">{product.description}</p>}
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-stone-500">
              {product.serves ? <span className="inline-flex items-center gap-1"><Users size={14} /> Serve {product.serves} {product.serves > 1 ? 'pessoas' : 'pessoa'}</span> : null}
              {product.prep_time_minutes ? <span className="inline-flex items-center gap-1"><Clock size={14} /> ~{product.prep_time_minutes} min de preparo</span> : null}
            </div>
            {product.combo_items.length > 0 && (
              <div className="mt-4 rounded-2xl bg-white p-4 shadow-card">
                <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">O combo inclui</p>
                <ul className="mt-2 space-y-1 text-sm">{product.combo_items.map((c, i) => <li key={i}>{Number(c.quantity)}× {c.name}</li>)}</ul>
              </div>
            )}
          </div>

          {product.option_groups.map((g) => {
            const count = g.options.filter((o) => selected.includes(o.id)).length;
            const bad = touched && count < g.min_select;
            return (
              <fieldset key={g.id} className="border-t border-black/5">
                <legend className="sr-only">{g.name}</legend>
                <div className={`flex items-center justify-between px-5 py-3 ${bad ? 'bg-ember-500/10' : 'bg-stone-100/70'}`}>
                  <div>
                    <p className="font-semibold">{g.name}</p>
                    <p className="text-xs text-stone-500">{g.max_select === 1 ? 'Escolha 1' : `Escolha até ${g.max_select}`}</p>
                  </div>
                  {g.min_select > 0 && <span className={`chip ${bad ? 'bg-ember-500 text-white' : 'bg-char text-white'}`}>Obrigatório</span>}
                </div>
                {g.options.map((o) => {
                  const on = selected.includes(o.id);
                  return (
                    <label key={o.id} className="flex cursor-pointer items-center justify-between gap-3 px-5 py-3.5 active:bg-black/5">
                      <span className="text-[15px]">{o.name}{Number(o.price_delta) > 0 && <span className="ml-2 text-sm text-stone-500">+ {money(o.price_delta)}</span>}</span>
                      <input type={g.max_select === 1 ? 'radio' : 'checkbox'} name={g.id} checked={on} onChange={() => toggle(g.id, o.id)}
                        className="h-5 w-5 accent-brand-600" />
                    </label>
                  );
                })}
              </fieldset>
            );
          })}

          <div className="border-t border-black/5 px-5 py-4">
            <label className="label" htmlFor="notes">Alguma observação?</label>
            <textarea id="notes" className="input min-h-[72px] resize-none" maxLength={300} placeholder="Ex.: sem cebola, bem passado…"
              value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <div className="flex items-center gap-3 border-t border-black/5 bg-white px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          <div className="flex items-center rounded-xl border border-black/10">
            <button className="p-3 text-brand-700 disabled:opacity-30" disabled={qty <= 1} onClick={() => setQty((q) => q - 1)} aria-label="Diminuir"><Minus size={18} /></button>
            <span className="w-7 text-center font-semibold tabular-nums">{qty}</span>
            <button className="p-3 text-brand-700" onClick={() => setQty((q) => Math.min(q + 1, 99))} aria-label="Aumentar"><Plus size={18} /></button>
          </div>
          <button className="btn-primary flex-1 justify-between py-3.5 text-[15px]" onClick={submit} disabled={product.sold_out}>
            <span>{product.sold_out ? 'Esgotado' : 'Adicionar'}</span><span className="tabular-nums">{money(price * qty)}</span>
          </button>
        </div>
        {touched && error && <p className="bg-ember-500 px-4 py-2 text-center text-sm font-medium text-white">{error}</p>}
      </div>
    </div>
  );
}
