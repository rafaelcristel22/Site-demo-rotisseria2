import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, ShoppingBag, X } from 'lucide-react';
import { useCart } from './CartContext';
import FoodArt from './FoodArt';
import ProductSheet from './ProductSheet';
import { money } from '../lib/format';
import type { MenuProduct } from '../lib/types';

const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export default function MenuPage() {
  const { menu, menuError, reloadMenu, count, subtotal, setCartOpen } = useCart();
  const [open, setOpen] = useState<MenuProduct | null>(null);
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState('');
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const tabsRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!menu) return [];
    return t ? menu.products.filter((p) => (p.name + ' ' + (p.description ?? '')).toLowerCase().includes(t)) : menu.products;
  }, [menu, q]);
  const suggestions = useMemo(() => (menu?.products ?? []).filter((p) => p.is_popular && !p.sold_out).slice(0, 6), [menu]);

  useEffect(() => {
    if (!menu) return;
    setActive((a) => a || menu.categories[0]?.slug || '');
    const obs = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (vis) setActive(vis.target.id);
    }, { rootMargin: '-110px 0px -65% 0px' });
    Object.values(sectionRefs.current).forEach((el) => el && obs.observe(el));
    return () => obs.disconnect();
  }, [menu, q]);
  useEffect(() => {
    tabsRef.current?.querySelector<HTMLElement>(`[data-slug="${active}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [active]);

  if (menuError) return (
    <div className="mx-auto max-w-md p-8 text-center">
      <p className="heading text-2xl">Não conseguimos abrir o cardápio</p>
      <p className="mt-2 text-sm text-stone-600">{menuError}</p>
      <button className="btn-primary mt-4" onClick={reloadMenu}>Tentar de novo</button>
    </div>
  );
  if (!menu) return <div className="mx-auto max-w-2xl p-5 text-stone-500">Carregando cardápio…</div>;

  const c = menu.company;
  const today = c.opening_hours?.[String(new Date().getDay())];
  const addr = [[c.address?.street, c.address?.number].filter(Boolean).join(', '), c.address?.district].filter(Boolean).join(' — ');
  const status = c.is_open_now
    ? `Aberto${today && !today.closed ? ` até ${today.close.replace(':00', 'h')}` : ''}`
    : 'Fechado agora';
  const photoBanners = menu.banners.filter((b) => b.image_url);
  const textNotice = menu.banners.find((b) => !b.image_url);

  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-paper pb-28 sm:border-x sm:border-char/10">
      {/* CABEÇALHO */}
      <header className="px-5 pb-4 pt-[max(18px,env(safe-area-inset-top))]">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            {c.logo_url && <img src={c.logo_url} alt="" className="h-12 w-12 rounded object-cover" />}
            <div>
              <h1 className="heading text-[30px] leading-none">{c.trade_name}</h1>
              {addr && <p className="mt-1 text-[14px] text-stone-600">{addr}</p>}
            </div>
          </div>
          <button onClick={() => setCartOpen(true)} className="relative -mr-2 p-2" aria-label="Abrir sacola">
            <ShoppingBag size={24} strokeWidth={1.75} />
            {count > 0 && <span className="absolute right-0.5 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white">{count}</span>}
          </button>
        </div>
        <p className="mt-3 text-[15px]">
          <span className={`font-semibold ${c.is_open_now ? 'text-green-800' : 'text-red-700'}`}>{status}</span>
          <span className="text-stone-500"> · preparo em ~{c.avg_prep_minutes} min</span>
          {!c.is_open_now && c.scheduling_enabled && <span className="text-stone-500"> · aceitamos agendamento</span>}
        </p>
        {c.phone && <p className="text-[14px] text-stone-500">Pedidos por telefone: <a className="underline" href={`tel:${c.phone}`}>{c.phone}</a></p>}
      </header>

      {textNotice && !q && (
        <div className="mx-5 mb-4 border-l-4 border-red-600 bg-white px-4 py-3">
          <p className="font-semibold">{textNotice.title}</p>
          {textNotice.subtitle && <p className="text-[14px] text-stone-600">{textNotice.subtitle}</p>}
        </div>
      )}
      {photoBanners.length > 0 && !q && (
        <div className="no-scrollbar mb-4 flex snap-x gap-3 overflow-x-auto px-5">
          {photoBanners.map((b) => (
            <a key={b.id} href={b.link_url ?? '#'} className="relative block h-40 w-[88%] shrink-0 snap-center overflow-hidden rounded-md">
              <img src={b.image_url!} alt={b.title} className="h-full w-full object-cover" />
            </a>
          ))}
        </div>
      )}

      {/* NAVEGAÇÃO */}
      <nav className="sticky top-0 z-30 border-y border-char/10 bg-paper/95 backdrop-blur">
        {searching ? (
          <div className="flex items-center gap-2 px-3 py-2">
            <Search size={18} className="ml-2 shrink-0 text-stone-500" />
            <input autoFocus className="w-full bg-transparent py-1.5 text-[16px] outline-none" placeholder="O que você procura?"
              value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar no cardápio" />
            <button onClick={() => { setQ(''); setSearching(false); }} className="p-2" aria-label="Fechar busca"><X size={18} /></button>
          </div>
        ) : (
          <div className="flex items-stretch">
            <button onClick={() => setSearching(true)} className="shrink-0 border-r border-char/10 px-4" aria-label="Buscar"><Search size={18} /></button>
            <div ref={tabsRef} className="no-scrollbar flex overflow-x-auto">
              {menu.categories.map((cat) => (
                <button key={cat.id} data-slug={cat.slug}
                  onClick={() => sectionRefs.current[cat.slug]?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className={`shrink-0 border-b-2 px-3.5 py-3 text-[15px] font-semibold transition ${active === cat.slug ? 'border-red-600 text-char' : 'border-transparent text-stone-500'}`}>
                  {cat.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </nav>

      {/* MAIS PEDIDOS */}
      {!q && suggestions.length > 0 && (
        <section className="px-5 pt-6">
          <h2 className="heading text-[22px]">Sugestões da casa</h2>
          <ul className="mt-1">
            {suggestions.map((p) => (
              <li key={p.id}>
                <button onClick={() => setOpen(p)} className="flex w-full items-baseline gap-3 py-2 text-left">
                  <span className="font-medium">{p.name}</span>
                  <span className="mb-1 flex-1 border-b border-dotted border-char/30" />
                  <span className="font-semibold tabular-nums">{money(p.price)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* CARDÁPIO */}
      {menu.categories.map((cat) => {
        const items = filtered.filter((p) => p.category_id === cat.id);
        if (!items.length) return null;
        return (
          <section key={cat.id} id={cat.slug} ref={(el) => { sectionRefs.current[cat.slug] = el; }} className="scroll-mt-14 pt-8">
            <div className="px-5">
              <h2 className="heading text-[26px] leading-none">{cat.name}</h2>
              {cat.description && <p className="mt-1 text-[14px] text-stone-500">{cat.description}</p>}
            </div>
            <ul className="mt-2">
              {items.map((p) => <ProductRow key={p.id} p={p} onOpen={() => setOpen(p)} />)}
            </ul>
          </section>
        );
      })}
      {q && filtered.length === 0 && <p className="px-5 py-16 text-center text-stone-500">Nada encontrado para “{q}”.</p>}

      {/* RODAPÉ */}
      <footer className="mx-5 mt-12 border-t border-char/10 pt-6 text-[14px] text-stone-600">
        <h3 className="heading text-lg text-char">Horário</h3>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-6 gap-y-0.5">
          {DAYS.map((d, i) => { const h = c.opening_hours?.[String(i)]; return (
            <div key={d} className={`contents ${i === new Date().getDay() ? 'font-semibold text-char' : ''}`}>
              <dt>{d}</dt><dd>{h && !h.closed ? `${h.open} às ${h.close}` : 'Fechado'}</dd>
            </div>); })}
        </dl>
        <p className="mt-6 text-[13px] leading-relaxed text-stone-500">{c.privacy_policy_text}</p>
        <a href="/admin" className="mt-4 inline-block text-[13px] text-stone-400">Área da equipe</a>
      </footer>

      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-2xl px-4 pb-[max(12px,env(safe-area-inset-bottom))]">
          <button onClick={() => setCartOpen(true)} className="flex w-full items-center justify-between rounded-md bg-red-600 px-5 py-3.5 text-white active:bg-red-700">
            <span className="font-semibold">Ver sacola ({count} {count === 1 ? 'item' : 'itens'})</span>
            <span className="font-semibold tabular-nums">{money(subtotal)}</span>
          </button>
        </div>
      )}
      {open && <ProductSheet product={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ProductRow({ p, onOpen }: { p: MenuProduct; onOpen: () => void }) {
  const promo = Number(p.price) < Number(p.list_price);
  return (
    <li className="border-b border-char/10 last:border-0">
      <button onClick={onOpen} disabled={p.sold_out} className="flex w-full gap-4 px-5 py-4 text-left active:bg-black/[.03] disabled:opacity-50">
        <div className="min-w-0 flex-1">
          <p className="text-[17px] font-semibold leading-snug">
            {p.name}
            {p.sold_out && <span className="ml-2 text-[13px] font-medium text-stone-500">— esgotado</span>}
          </p>
          {p.description && <p className="mt-0.5 line-clamp-2 text-[14px] leading-snug text-stone-600">{p.description}</p>}
          <p className="mt-1.5 text-[15px]">
            <span className={`font-semibold tabular-nums ${promo ? 'text-red-700' : ''}`}>{money(p.price)}</span>
            {p.unit === 'kg' && <span className="text-stone-500"> o kg</span>}
            {promo && <span className="ml-2 text-[13px] text-stone-400 line-through tabular-nums">{money(p.list_price)}</span>}
            {p.serves && p.serves > 1 ? <span className="text-[13px] text-stone-500"> · serve {p.serves}</span> : null}
          </p>
        </div>
        {p.image_url && <FoodArt src={p.image_url} alt={p.name} className="h-20 w-20 shrink-0 rounded" />}
      </button>
    </li>
  );
}
