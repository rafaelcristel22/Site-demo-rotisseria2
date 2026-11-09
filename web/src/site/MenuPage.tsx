import { useEffect, useMemo, useRef, useState } from 'react';
import { Clock, Flame, MapPin, Phone, Search, ShoppingBag, Star, Tag, X } from 'lucide-react';
import { useCart } from './CartContext';
import FoodArt from './FoodArt';
import ProductSheet from './ProductSheet';
import { money } from '../lib/format';
import type { MenuProduct } from '../lib/types';

const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export default function MenuPage() {
  const { menu, menuError, reloadMenu, count, subtotal, setCartOpen } = useCart();
  const [open, setOpen] = useState<MenuProduct | null>(null);
  const [q, setQ] = useState('');
  const [active, setActive] = useState<string>('');
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const chipsRef = useRef<HTMLDivElement>(null);

  const slugById = useMemo(() => Object.fromEntries((menu?.categories ?? []).map((c) => [c.id, c.slug])), [menu]);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!menu) return [];
    return t ? menu.products.filter((p) => (p.name + ' ' + (p.description ?? '')).toLowerCase().includes(t)) : menu.products;
  }, [menu, q]);
  const featured = useMemo(() => (menu?.products ?? []).filter((p) => p.is_featured && !p.sold_out).slice(0, 8), [menu]);

  useEffect(() => {
    if (!menu) return;
    const obs = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (vis) setActive(vis.target.id);
    }, { rootMargin: '-120px 0px -65% 0px' });
    Object.values(sectionRefs.current).forEach((el) => el && obs.observe(el));
    return () => obs.disconnect();
  }, [menu, q]);
  useEffect(() => {
    const chip = chipsRef.current?.querySelector<HTMLElement>(`[data-slug="${active}"]`);
    chip?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [active]);

  if (menuError) return (
    <div className="mx-auto max-w-md p-8 text-center">
      <p className="font-display text-xl font-bold">Não foi possível carregar o cardápio</p>
      <p className="mt-2 text-sm text-stone-500">{menuError}</p>
      <button className="btn-primary mt-4" onClick={reloadMenu}>Tentar novamente</button>
    </div>
  );
  if (!menu) return <MenuSkeleton />;

  const c = menu.company;
  const today = c.opening_hours?.[String(new Date().getDay())];
  const addr = [c.address?.street, c.address?.number, c.address?.district].filter(Boolean).join(', ');

  return (
    <div className="mx-auto max-w-3xl pb-28">
      {/* HERO */}
      <header className="relative overflow-hidden bg-char text-white">
        <div className="absolute inset-0 opacity-90" style={{ background: 'radial-gradient(90% 120% at 100% 0%, #ea5f06 0%, rgba(234,95,6,0) 55%), radial-gradient(80% 100% at 0% 100%, #7c2f10 0%, rgba(124,47,16,0) 60%)' }} />
        <div className="grain absolute inset-0 opacity-40" />
        <div className="relative px-5 pb-6 pt-[max(20px,env(safe-area-inset-top))]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {c.logo_url ? <img src={c.logo_url} alt="" className="h-10 w-10 rounded-xl object-cover" /> :
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500"><Flame size={22} /></div>}
              <span className="text-sm font-medium text-white/80">Peça online</span>
            </div>
            <button onClick={() => setCartOpen(true)} className="relative rounded-full bg-white/10 p-2.5 backdrop-blur" aria-label="Abrir carrinho">
              <ShoppingBag size={20} />
              {count > 0 && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-500 px-1 text-[11px] font-bold">{count}</span>}
            </button>
          </div>
          <h1 className="mt-6 font-display text-[34px] font-extrabold leading-[1.05] tracking-tight">{c.trade_name}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
            <span className={`chip px-3 py-1 text-xs ${c.is_open_now ? 'bg-emerald-500/90' : 'bg-white/15'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${c.is_open_now ? 'bg-white' : 'bg-red-400'}`} />
              {c.is_open_now ? 'Aberto agora' : c.scheduling_enabled ? 'Fechado · agende seu pedido' : 'Fechado agora'}
            </span>
            {today && !today.closed && <span className="inline-flex items-center gap-1 text-white/75"><Clock size={14} /> Hoje {today.open}–{today.close}</span>}
            <span className="inline-flex items-center gap-1 text-white/75"><Clock size={14} /> ~{c.avg_prep_minutes} min</span>
          </div>
          {addr && <p className="mt-2 flex items-center gap-1 text-[13px] text-white/65"><MapPin size={14} /> {addr}</p>}
        </div>
      </header>

      {/* BANNERS */}
      {menu.banners.length > 0 && !q && (
        <div className="no-scrollbar -mt-1 flex snap-x snap-mandatory gap-3 overflow-x-auto bg-char px-5 pb-5">
          {menu.banners.map((b, i) => (
            <a key={b.id} href={b.link_url ?? '#'} onClick={(e) => {
                const p = menu.products.find((x) => x.id === b.product_id); if (p) { e.preventDefault(); setOpen(p); } }}
              className="relative flex h-36 w-[85%] shrink-0 snap-center flex-col justify-end overflow-hidden rounded-2xl p-4 text-white sm:w-[60%]">
              {b.image_url ? <img src={b.image_url} alt="" className="absolute inset-0 h-full w-full object-cover" /> :
                <div className="absolute inset-0" style={{ background: i % 2 ? 'linear-gradient(135deg,#b92a14,#431505)' : 'linear-gradient(135deg,#f97b10,#9a370f)' }}>
                  <div className="grain absolute inset-0 opacity-50" />
                  {i % 2 ? <Tag className="absolute right-4 top-4 text-white/25" size={64} /> : <Flame className="absolute right-4 top-4 text-white/25" size={64} />}
                </div>}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              <p className="relative font-display text-xl font-bold leading-tight">{b.title}</p>
              {b.subtitle && <p className="relative mt-0.5 text-[13px] text-white/85">{b.subtitle}</p>}
            </a>
          ))}
        </div>
      )}

      {/* BUSCA + CATEGORIAS */}
      <div className="sticky top-0 z-30 border-b border-black/5 bg-cream/95 backdrop-blur">
        <div className="px-5 pt-3">
          <div className="relative">
            <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" />
            <input className="input rounded-full pl-10 pr-10" placeholder="Buscar no cardápio" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar no cardápio" />
            {q && <button onClick={() => setQ('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400" aria-label="Limpar busca"><X size={18} /></button>}
          </div>
        </div>
        <div ref={chipsRef} className="no-scrollbar flex gap-2 overflow-x-auto px-5 py-3">
          {menu.categories.map((cat) => (
            <button key={cat.id} data-slug={cat.slug}
              onClick={() => sectionRefs.current[cat.slug]?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition ${active === cat.slug ? 'bg-char text-white' : 'bg-white text-stone-700 shadow-card'}`}>
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      {/* DESTAQUES */}
      {!q && featured.length > 0 && (
        <section className="pt-6">
          <h2 className="flex items-center gap-2 px-5 font-display text-xl font-bold"><Star size={18} className="fill-brand-500 text-brand-500" /> Destaques da casa</h2>
          <div className="no-scrollbar mt-3 flex snap-x gap-3 overflow-x-auto px-5 pb-2">
            {featured.map((p) => (
              <button key={p.id} onClick={() => setOpen(p)} className="w-44 shrink-0 snap-start overflow-hidden rounded-2xl bg-white text-left shadow-card">
                <FoodArt src={p.image_url} slug={slugById[p.category_id]} alt={p.name} className="h-28 w-full" />
                <div className="p-3">
                  <p className="line-clamp-2 text-[14px] font-semibold leading-snug">{p.name}</p>
                  <Price p={p} className="mt-1" />
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* CATEGORIAS */}
      {menu.categories.map((cat) => {
        const items = filtered.filter((p) => p.category_id === cat.id);
        if (!items.length) return null;
        return (
          <section key={cat.id} id={cat.slug} ref={(el) => { sectionRefs.current[cat.slug] = el; }} className="scroll-mt-32 px-5 pt-7">
            <h2 className="font-display text-2xl font-bold">{cat.name}</h2>
            {cat.description && <p className="text-sm text-stone-500">{cat.description}</p>}
            <div className="mt-3 divide-y divide-black/5 overflow-hidden rounded-2xl bg-white shadow-card">
              {items.map((p) => (
                <button key={p.id} onClick={() => setOpen(p)} disabled={p.sold_out}
                  className="flex w-full gap-3 p-4 text-left transition active:bg-stone-50 disabled:opacity-60">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-[15px] font-semibold leading-snug">{p.name}</p>
                      {p.is_popular && <span className="chip bg-brand-100 text-brand-800"><Flame size={11} /> Popular</span>}
                      {p.sold_out && <span className="chip bg-stone-200 text-stone-600">Esgotado</span>}
                    </div>
                    {p.description && <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-stone-500">{p.description}</p>}
                    <Price p={p} className="mt-2" />
                  </div>
                  <FoodArt src={p.image_url} slug={cat.slug} alt={p.name} className="h-24 w-24 shrink-0 rounded-xl" iconSize={30} />
                </button>
              ))}
            </div>
          </section>
        );
      })}
      {q && filtered.length === 0 && <p className="px-5 py-16 text-center text-stone-500">Nenhum item encontrado para “{q}”.</p>}

      {/* RODAPÉ */}
      <footer className="mt-12 px-5 text-center text-xs text-stone-500">
        {c.phone && <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 font-medium text-stone-700"><Phone size={13} /> {c.phone}</a>}
        <div className="mx-auto mt-4 grid max-w-xs grid-cols-7 gap-1">
          {DAYS.map((d, i) => { const h = c.opening_hours?.[String(i)]; return (
            <div key={d} className="rounded-lg bg-white p-1.5 shadow-card"><p className="font-semibold text-stone-700">{d}</p>
              <p className="text-[10px] leading-tight">{h && !h.closed ? <>{h.open}<br />{h.close}</> : 'Fechado'}</p></div>); })}
        </div>
        <p className="mt-4">{c.privacy_policy_text}</p>
        <a href="/admin" className="mt-3 inline-block text-stone-400 underline">Acesso da equipe</a>
      </footer>

      {/* BARRA DO CARRINHO */}
      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-3xl px-4 pb-[max(14px,env(safe-area-inset-bottom))]">
          <button onClick={() => setCartOpen(true)} className="flex w-full items-center justify-between rounded-2xl bg-brand-600 px-5 py-4 text-white shadow-2xl shadow-brand-900/30 active:scale-[.99]">
            <span className="flex items-center gap-2 font-semibold"><span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-white/25 px-1.5 text-xs">{count}</span> Ver carrinho</span>
            <span className="font-semibold tabular-nums">{money(subtotal)}</span>
          </button>
        </div>
      )}
      {open && <ProductSheet product={open} slug={slugById[open.category_id]} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Price({ p, className = '' }: { p: MenuProduct; className?: string }) {
  const promo = Number(p.price) < Number(p.list_price);
  return (
    <div className={`flex items-baseline gap-2 ${className}`}>
      <span className={`font-semibold tabular-nums ${promo ? 'text-emerald-700' : 'text-char'}`}>{money(p.price)}</span>
      {promo && <span className="text-xs text-stone-400 line-through tabular-nums">{money(p.list_price)}</span>}
      {p.unit === 'kg' && <span className="text-xs text-stone-400">/kg</span>}
    </div>
  );
}

function MenuSkeleton() {
  return (
    <div className="mx-auto max-w-3xl animate-pulse">
      <div className="h-52 bg-char" />
      <div className="space-y-3 p-5">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-24 rounded-2xl bg-stone-200" />)}</div>
    </div>
  );
}
