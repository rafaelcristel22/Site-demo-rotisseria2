import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { addLine, itemCount, setQuantity, subtotal, type CartLine } from '../lib/cart';
import { rpc } from '../lib/supabase';
import type { PublicMenu } from '../lib/types';

interface Ctx {
  menu: PublicMenu | null; menuError: string | null; reloadMenu: () => void;
  lines: CartLine[]; add: (l: CartLine) => void; setQty: (key: string, q: number) => void; clear: () => void;
  count: number; subtotal: number; cartOpen: boolean; setCartOpen: (v: boolean) => void;
}
const CartCtx = createContext<Ctx | null>(null);
const KEY = 'rotisseria.cart.v1'; // conveniência por navegador; o pedido real fica no banco

function load(): CartLine[] {
  try { return JSON.parse(sessionStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(load);
  const [menu, setMenu] = useState<PublicMenu | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify(lines)); } catch { /* ignore */ } }, [lines]);
  useEffect(() => {
    let alive = true;
    rpc<PublicMenu>('public_menu').then((m) => {
      if (!alive) return;
      setMenu(m); setMenuError(null);
      // remove do carrinho itens que deixaram de existir/estão esgotados
      const ok = new Set(m.products.filter((p) => !p.sold_out).map((p) => p.id));
      setLines((ls) => ls.filter((l) => ok.has(l.product_id)));
    }).catch((e) => alive && setMenuError(e.message));
    return () => { alive = false; };
  }, [tick]);

  const value = useMemo<Ctx>(() => ({
    menu, menuError, reloadMenu: () => setTick((t) => t + 1),
    lines, add: (l) => setLines((ls) => addLine(ls, l)), setQty: (k, q) => setLines((ls) => setQuantity(ls, k, q)),
    clear: () => setLines([]), count: itemCount(lines), subtotal: subtotal(lines), cartOpen, setCartOpen,
  }), [menu, menuError, lines, cartOpen]);
  return <CartCtx.Provider value={value}>{children}</CartCtx.Provider>;
}

export function useCart() {
  const c = useContext(CartCtx);
  if (!c) throw new Error('useCart fora do CartProvider');
  return c;
}
