import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { BarChart3, Bike, Boxes, ChefHat, ClipboardList, Clock, Cog, FileSearch, Landmark, LayoutDashboard, LogOut, Megaphone,
  Menu, Moon, ReceiptText, ShoppingCart, Sparkles, Sun, Truck, UserRound, Users, UtensilsCrossed, Wallet, X } from 'lucide-react';
import { useAuth } from './auth';

interface Item { to: string; label: string; icon: typeof Menu; perm?: string | string[] }
const NAV: { group: string; items: Item[] }[] = [
  { group: 'Visão geral', items: [
    { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, perm: 'dashboard.view' },
    { to: '/admin/relatorios', label: 'Relatórios', icon: BarChart3, perm: 'reports.view' },
    { to: '/admin/assistente', label: 'Assistente', icon: Sparkles, perm: 'ai.use' },
  ] },
  { group: 'Operação', items: [
    { to: '/admin/pedidos', label: 'Pedidos', icon: ClipboardList, perm: 'orders.view' },
    { to: '/admin/pdv', label: 'Caixa (PDV)', icon: ShoppingCart, perm: 'pos.operate' },
    { to: '/admin/cozinha', label: 'Cozinha', icon: ChefHat, perm: 'kitchen.operate' },
    { to: '/admin/entregas', label: 'Entregas', icon: Bike, perm: ['delivery.manage', 'delivery.driver'] },
  ] },
  { group: 'Gestão', items: [
    { to: '/admin/cardapio', label: 'Cardápio', icon: UtensilsCrossed, perm: 'catalog.view' },
    { to: '/admin/estoque', label: 'Estoque', icon: Boxes, perm: 'inventory.view' },
    { to: '/admin/compras', label: 'Compras', icon: Truck, perm: 'purchases.view' },
    { to: '/admin/clientes', label: 'Clientes', icon: UserRound, perm: 'customers.view' },
    { to: '/admin/marketing', label: 'Marketing', icon: Megaphone, perm: 'marketing.view' },
    { to: '/admin/financeiro', label: 'Financeiro', icon: Landmark, perm: 'finance.view' },
  ] },
  { group: 'Pessoas', items: [
    { to: '/admin/ponto', label: 'Ponto', icon: Clock },
    { to: '/admin/rh', label: 'Funcionários', icon: Users, perm: 'hr.view' },
    { to: '/admin/folha', label: 'Folha', icon: Wallet, perm: 'payroll.view' },
  ] },
  { group: 'Sistema', items: [
    { to: '/admin/vendas', label: 'Vendas e caixas', icon: ReceiptText, perm: ['sales.view', 'pos.manage'] },
    { to: '/admin/auditoria', label: 'Auditoria', icon: FileSearch, perm: 'audit.view' },
    { to: '/admin/configuracoes', label: 'Configurações', icon: Cog, perm: 'settings.view' },
  ] },
];

export function useTheme() {
  const [dark, setDark] = useState(() => { try { return localStorage.getItem('erp.theme') === 'dark'; } catch { return false; } });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('erp.theme', dark ? 'dark' : 'light'); } catch { /* ignore */ }
  }, [dark]);
  return [dark, setDark] as const;
}

export default function Layout({ children }: { children: ReactNode }) {
  const { me, can, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useTheme();
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const allowed = (i: Item) => !i.perm || (Array.isArray(i.perm) ? i.perm.some(can) : can(i.perm));

  const nav = (
    <nav className="flex h-full flex-col">
      <div className="px-5 pb-4 pt-5">
        <p className="heading text-xl leading-none text-white">Rotisseria ERP</p>
        <p className="mt-1 truncate text-xs text-white/50">{me?.full_name} · {me?.role_name}</p>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {NAV.map((g) => {
          const items = g.items.filter(allowed);
          if (!items.length) return null;
          return (
            <div key={g.group} className="mb-3">
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-white/35">{g.group}</p>
              {items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.to === '/admin'}
                  className={({ isActive }) => `flex items-center gap-2.5 rounded px-3 py-2 text-[14px] ${isActive ? 'bg-white/10 font-semibold text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'}`}>
                  <i.icon size={16} strokeWidth={1.75} /> {i.label}
                </NavLink>
              ))}
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-1 border-t border-white/10 p-2">
        <button onClick={() => setDark(!dark)} className="flex flex-1 items-center gap-2 rounded px-3 py-2 text-[13px] text-white/70 hover:bg-white/5" aria-label="Alternar tema">
          {dark ? <Sun size={15} /> : <Moon size={15} />} {dark ? 'Tema claro' : 'Tema escuro'}</button>
        <button onClick={signOut} className="rounded px-3 py-2 text-white/70 hover:bg-white/5" aria-label="Sair" title="Sair"><LogOut size={15} /></button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen bg-cream text-char dark:bg-stone-950 dark:text-stone-100">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 bg-char lg:block">{nav}</aside>
      {open && <div className="fixed inset-0 z-50 lg:hidden"><div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
        <aside className="relative h-full w-64 bg-char">{nav}<button className="absolute right-2 top-4 p-1 text-white" onClick={() => setOpen(false)} aria-label="Fechar menu"><X size={20} /></button></aside></div>}
      <div className="lg:pl-60">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-char/10 bg-cream/95 px-4 py-2.5 backdrop-blur lg:hidden dark:border-white/10 dark:bg-stone-950/95">
          <button onClick={() => setOpen(true)} aria-label="Abrir menu"><Menu size={22} /></button>
          <span className="heading text-lg">Rotisseria ERP</span>
        </header>
        <main className="mx-auto max-w-[1400px] p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
