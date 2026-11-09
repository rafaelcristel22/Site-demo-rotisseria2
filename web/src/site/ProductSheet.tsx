import { useMemo, useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import type { MenuProduct } from '../lib/types';
import { lineKey, unitPrice, validateOptions } from '../lib/cart';
import { money } from '../lib/format';
import FoodArt from './FoodArt';
import { useCart } from './CartContext';

export default function ProductSheet({ product, onClose }: { product: MenuProduct; onClose: () => void }) {
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
      <div className="animate-fade-in absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="animate-slide-up relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-lg bg-paper sm:rounded-lg">
        <button onClick={onClose} aria-label="Fechar" className={`absolute right-2 top-2 z-10 rounded-full p-2 ${product.image_url ? 'bg-white/90' : ''}`}><X size={20} /></button>
        <div className="overflow-y-auto">
          <FoodArt src={product.image_url} alt={product.name} className="h-60 w-full" />
          <div className="px-5 pb-4 pt-5">
            <h2 className="heading pr-8 text-[28px] leading-tight">{product.name}</h2>
            <p className="mt-1 text-lg font-semibold tabular-nums">{money(product.price)}{product.unit === 'kg' && <span className="font-normal text-stone-500"> o kg</span>}</p>
            {product.description && <p className="mt-2 text-[16px] leading-relaxed text-stone-700">{product.description}</p>}
            <div className="mt-3 flex flex-wrap gap-3 text-sm text-stone-500">
              {product.serves ? <span>Serve {product.serves} {product.serves > 1 ? 'pessoas' : 'pessoa'}</span> : null}
              {product.prep_time_minutes ? <span>Preparo: ~{product.prep_time_minutes} min</span> : null}
            </div>
            {product.combo_items.length > 0 && (
              <div className="mt-4 border-l-4 border-char/20 pl-4">
                <p className="font-semibold">Vem no combo:</p>
                <ul className="mt-2 space-y-1 text-sm">{product.combo_items.map((c, i) => <li key={i}>{Number(c.quantity)}× {c.name}</li>)}</ul>
              </div>
            )}
          </div>

          {product.option_groups.map((g) => {
            const count = g.options.filter((o) => selected.includes(o.id)).length;
            const bad = touched && count < g.min_select;
            return (
              <fieldset key={g.id} className="border-t border-char/10">
                <legend className="sr-only">{g.name}</legend>
                <div className={`flex items-center justify-between px-5 py-3 ${bad ? 'bg-red-600/10' : 'bg-cream'}`}>
                  <div>
                    <p className="font-semibold">{g.name}</p>
                    <p className="text-[13px] text-stone-500">{g.max_select === 1 ? 'Escolha 1' : `Escolha até ${g.max_select}`}</p>
                  </div>
                  {g.min_select > 0 && <span className={`text-[13px] font-semibold ${bad ? 'text-red-700' : 'text-stone-500'}`}>obrigatório</span>}
                </div>
                {g.options.map((o) => {
                  const on = selected.includes(o.id);
                  return (
                    <label key={o.id} className="flex cursor-pointer items-center justify-between gap-3 px-5 py-3.5 active:bg-black/5">
                      <span className="text-[15px]">{o.name}{Number(o.price_delta) > 0 && <span className="ml-2 text-[15px] text-stone-500">+ {money(o.price_delta)}</span>}</span>
                      <input type={g.max_select === 1 ? 'radio' : 'checkbox'} name={g.id} checked={on} onChange={() => toggle(g.id, o.id)}
                        className="h-5 w-5 accent-red-600" />
                    </label>
                  );
                })}
              </fieldset>
            );
          })}

          <div className="border-t border-char/10 px-5 py-4">
            <label className="label" htmlFor="notes">Observação para a cozinha</label>
            <textarea id="notes" className="input min-h-[72px] resize-none" maxLength={300} placeholder="Ex.: sem cebola"
              value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <div className="flex items-center gap-3 border-t border-char/10 bg-paper px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          <div className="flex items-center rounded-md border border-char/20">
            <button className="p-3 text-char disabled:opacity-30" disabled={qty <= 1} onClick={() => setQty((q) => q - 1)} aria-label="Diminuir"><Minus size={18} /></button>
            <span className="w-7 text-center font-semibold tabular-nums">{qty}</span>
            <button className="p-3 text-char" onClick={() => setQty((q) => Math.min(q + 1, 99))} aria-label="Aumentar"><Plus size={18} /></button>
          </div>
          <button className="btn-primary flex-1 justify-between py-3.5" onClick={submit} disabled={product.sold_out}>
            <span>{product.sold_out ? 'Esgotado' : 'Adicionar'}</span><span className="tabular-nums">{money(price * qty)}</span>
          </button>
        </div>
        {touched && error && <p className="bg-red-700 px-4 py-2 text-center text-sm font-medium text-white">{error}</p>}
      </div>
    </div>
  );
}
