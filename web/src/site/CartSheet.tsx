import { Minus, Plus, ShoppingBag, Trash2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { money } from '../lib/format';
import { useCart } from './CartContext';
import FoodArt from './FoodArt';

export default function CartSheet() {
  const { lines, setQty, subtotal, cartOpen, setCartOpen, menu, clear } = useCart();
  const nav = useNavigate();
  if (!cartOpen) return null;
  const slugOf = (cid: string) => menu?.categories.find((c) => c.id === cid)?.slug;
  const min = Number(menu?.company.min_order_value ?? 0);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Carrinho">
      <div className="animate-fade-in absolute inset-0 bg-black/50" onClick={() => setCartOpen(false)} />
      <div className="animate-slide-up relative flex max-h-[88vh] w-full max-w-lg flex-col rounded-t-3xl bg-cream sm:rounded-3xl">
        <div className="flex items-center justify-between px-5 pb-2 pt-5">
          <h2 className="font-display text-2xl font-bold">Seu pedido</h2>
          <button onClick={() => setCartOpen(false)} className="btn-ghost p-2" aria-label="Fechar"><X size={20} /></button>
        </div>
        {lines.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-14 text-center text-stone-500">
            <ShoppingBag size={44} strokeWidth={1.4} />
            <p className="mt-3 font-medium text-stone-700">Seu carrinho está vazio</p>
            <p className="text-sm">Escolha algo delicioso no cardápio.</p>
          </div>
        ) : (
          <>
            <ul className="flex-1 divide-y divide-black/5 overflow-y-auto px-5">
              {lines.map((l) => (
                <li key={l.key} className="flex gap-3 py-4">
                  <FoodArt src={l.image_url} slug={slugOf(l.category_id)} alt={l.name} className="h-16 w-16 shrink-0 rounded-xl" iconSize={24} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold leading-snug">{l.name}</p>
                    {l.option_labels.length > 0 && <p className="text-xs text-stone-500">{l.option_labels.join(' · ')}</p>}
                    {l.notes && <p className="text-xs italic text-stone-500">“{l.notes}”</p>}
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex items-center rounded-lg border border-black/10 bg-white">
                        <button className="p-1.5 text-brand-700" onClick={() => setQty(l.key, l.quantity - 1)} aria-label="Diminuir">
                          {l.quantity === 1 ? <Trash2 size={15} /> : <Minus size={15} />}
                        </button>
                        <span className="w-6 text-center text-sm font-semibold tabular-nums">{l.quantity}</span>
                        <button className="p-1.5 text-brand-700" onClick={() => setQty(l.key, l.quantity + 1)} aria-label="Aumentar"><Plus size={15} /></button>
                      </div>
                      <span className="font-semibold tabular-nums">{money(l.unit_price * l.quantity)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="border-t border-black/5 bg-white px-5 py-4 pb-[max(16px,env(safe-area-inset-bottom))]">
              <div className="flex justify-between text-sm"><span className="text-stone-500">Subtotal</span><span className="font-semibold tabular-nums">{money(subtotal)}</span></div>
              <p className="mt-0.5 text-xs text-stone-500">Entrega e cupom calculados na próxima etapa.</p>
              {subtotal < min && <p className="mt-2 rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-900">Pedido mínimo de {money(min)}.</p>}
              <div className="mt-3 flex gap-2">
                <button className="btn-outline" onClick={clear}>Limpar</button>
                <button className="btn-primary flex-1 py-3.5 text-[15px]" disabled={subtotal < min}
                  onClick={() => { setCartOpen(false); nav('/checkout'); }}>Continuar</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
