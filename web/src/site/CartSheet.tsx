import { Minus, Plus, Trash2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { money } from '../lib/format';
import { useCart } from './CartContext';
import FoodArt from './FoodArt';

export default function CartSheet() {
  const { lines, setQty, subtotal, cartOpen, setCartOpen, menu, clear } = useCart();
  const nav = useNavigate();
  if (!cartOpen) return null;
  const min = Number(menu?.company.min_order_value ?? 0);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Carrinho">
      <div className="animate-fade-in absolute inset-0 bg-black/40" onClick={() => setCartOpen(false)} />
      <div className="animate-slide-up relative flex max-h-[88vh] w-full max-w-lg flex-col rounded-t-lg bg-paper sm:rounded-lg">
        <div className="flex items-center justify-between px-5 pb-2 pt-5">
          <h2 className="heading text-[26px]">Sua sacola</h2>
          <button onClick={() => setCartOpen(false)} className="btn-ghost p-2" aria-label="Fechar"><X size={20} /></button>
        </div>
        {lines.length === 0 ? (
          <p className="px-5 pb-10 pt-4 text-stone-600">Sua sacola está vazia.</p>
        ) : (
          <>
            <ul className="flex-1 divide-y divide-char/10 overflow-y-auto px-5">
              {lines.map((l) => (
                <li key={l.key} className="flex gap-3 py-4">
                  <FoodArt src={l.image_url} alt={l.name} className="h-14 w-14 shrink-0 rounded" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[16px] font-semibold leading-snug">{l.name}</p>
                    {l.option_labels.length > 0 && <p className="text-[14px] text-stone-600">{l.option_labels.join(' · ')}</p>}
                    {l.notes && <p className="text-[14px] text-stone-600">Obs.: {l.notes}</p>}
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex items-center rounded-md border border-char/20">
                        <button className="p-1.5 text-char" onClick={() => setQty(l.key, l.quantity - 1)} aria-label="Diminuir">
                          {l.quantity === 1 ? <Trash2 size={15} /> : <Minus size={15} />}
                        </button>
                        <span className="w-6 text-center text-sm font-semibold tabular-nums">{l.quantity}</span>
                        <button className="p-1.5 text-char" onClick={() => setQty(l.key, l.quantity + 1)} aria-label="Aumentar"><Plus size={15} /></button>
                      </div>
                      <span className="font-semibold tabular-nums">{money(l.unit_price * l.quantity)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="border-t border-char/10 bg-paper px-5 py-4 pb-[max(16px,env(safe-area-inset-bottom))]">
              <div className="flex justify-between text-sm"><span className="text-stone-500">Subtotal</span><span className="font-semibold tabular-nums">{money(subtotal)}</span></div>
              <p className="mt-0.5 text-[13px] text-stone-500">Taxa de entrega e cupom na próxima tela.</p>
              {subtotal < min && <p className="mt-2 border-l-4 border-red-600 bg-white px-3 py-2 text-[14px]">Pedido mínimo de {money(min)}.</p>}
              <div className="mt-3 flex gap-2">
                <button className="btn-outline" onClick={clear}>Limpar</button>
                <button className="btn-primary flex-1 py-3.5" disabled={subtotal < min}
                  onClick={() => { setCartOpen(false); nav('/checkout'); }}>Continuar</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
