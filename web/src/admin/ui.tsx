import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { X, Loader2 } from 'lucide-react';
import { isoDate } from '../lib/format';

// ---------------- Toasts ----------------
interface Toast { id: number; text: string; kind: 'ok' | 'err' }
const ToastCtx = createContext<(text: string, kind?: 'ok' | 'err') => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, kind }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === 'err' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[80] flex max-w-sm flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`rounded-md border-l-4 bg-white px-4 py-3 text-sm shadow-lg dark:bg-stone-800 ${t.kind === 'err' ? 'border-red-600' : 'border-green-700'}`}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------------- Modal ----------------
export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[6vh]" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0" onClick={onClose} />
      <div className={`relative w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} rounded-md bg-white shadow-xl dark:bg-stone-900`}>
        <div className="flex items-center justify-between border-b border-char/10 px-5 py-3 dark:border-white/10">
          <h2 className="heading text-xl">{title}</h2>
          <button onClick={onClose} className="btn-ghost p-1.5" aria-label="Fechar"><X size={18} /></button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-char/10 px-5 py-3 dark:border-white/10">{footer}</div>}
      </div>
    </div>
  );
}

// ---------------- Formulário ----------------
export function Field({ label, children, hint, className = '' }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return <label className={`block ${className}`}><span className="label">{label}</span>{children}{hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}</label>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="heading text-[28px] leading-none">{title}</h1>{subtitle && <p className="mt-1 text-sm text-stone-500">{subtitle}</p>}</div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, actions, className = '' }: { title?: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-md border border-char/10 bg-white dark:border-white/10 dark:bg-stone-900 ${className}`}>
      {title && <div className="flex items-center justify-between border-b border-char/10 px-4 py-2.5 dark:border-white/10"><h2 className="text-[15px] font-semibold">{title}</h2>{actions}</div>}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: ReactNode; tone?: 'good' | 'bad' | 'warn' }) {
  return (
    <div className="rounded-md border border-char/10 bg-white px-4 py-3 dark:border-white/10 dark:bg-stone-900">
      <p className="text-[13px] text-stone-500">{label}</p>
      <p className={`mt-0.5 text-[22px] font-semibold tabular-nums ${tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : ''}`}>{value}</p>
      {sub && <div className="mt-0.5 text-xs text-stone-500">{sub}</div>}
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'bad' | 'warn' | 'info' }) {
  const t = { neutral: 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300', good: 'bg-green-100 text-green-900', bad: 'bg-red-100 text-red-900',
    warn: 'bg-amber-100 text-amber-900', info: 'bg-sky-100 text-sky-900' }[tone];
  return <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${t}`}>{children}</span>;
}

export function Spinner() { return <Loader2 className="animate-spin text-stone-400" size={20} />; }
export function Empty({ children }: { children: ReactNode }) { return <p className="py-8 text-center text-sm text-stone-500">{children}</p>; }

// ---------------- Tabela ----------------
export interface Col<T> { key: string; label: string; render?: (r: T) => ReactNode; align?: 'right' | 'center'; className?: string }
export function Table<T extends Record<string, any>>({ cols, rows, onRow, empty = 'Nenhum registro.', rowKey = 'id' }: {
  cols: Col<T>[]; rows: T[]; onRow?: (r: T) => void; empty?: string; rowKey?: string;
}) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-char/10 text-left text-[12px] uppercase tracking-wide text-stone-500 dark:border-white/10">
          {cols.map((c) => <th key={c.key} className={`whitespace-nowrap px-3 py-2 font-medium ${c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : ''}`}>{c.label}</th>)}
        </tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r[rowKey] ?? i} onClick={onRow ? () => onRow(r) : undefined}
              className={`border-b border-char/5 dark:border-white/5 ${onRow ? 'cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-800' : ''}`}>
              {cols.map((c) => <td key={c.key} className={`px-3 py-2 ${c.align === 'right' ? 'text-right tabular-nums' : c.align === 'center' ? 'text-center' : ''} ${c.className ?? ''}`}>
                {c.render ? c.render(r) : String(r[c.key] ?? '—')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------- Período ----------------
export interface Period { start: string; end: string }
export function presetPeriod(kind: string): Period {
  const t = new Date(); const d = (x: Date) => isoDate(x);
  const y = t.getFullYear(), m = t.getMonth();
  switch (kind) {
    case 'hoje': return { start: d(t), end: d(t) };
    case '7d': return { start: d(new Date(t.getTime() - 6 * 864e5)), end: d(t) };
    case '30d': return { start: d(new Date(t.getTime() - 29 * 864e5)), end: d(t) };
    case 'mes_anterior': return { start: d(new Date(y, m - 1, 1)), end: d(new Date(y, m, 0)) };
    case 'ano': return { start: d(new Date(y, 0, 1)), end: d(t) };
    default: return { start: d(new Date(y, m, 1)), end: d(t) };
  }
}
/** Período imediatamente anterior, de mesma duração. */
export function previousPeriod(p: Period): Period {
  const s = new Date(p.start + 'T12:00:00'), e = new Date(p.end + 'T12:00:00');
  const days = Math.round((e.getTime() - s.getTime()) / 864e5) + 1;
  // mês fechado → mês anterior fechado
  const isFullMonth = s.getDate() === 1 && new Date(e.getFullYear(), e.getMonth() + 1, 0).getDate() === e.getDate() && s.getMonth() === e.getMonth();
  if (isFullMonth) return { start: isoDate(new Date(s.getFullYear(), s.getMonth() - 1, 1)), end: isoDate(new Date(s.getFullYear(), s.getMonth(), 0)) };
  return { start: isoDate(new Date(s.getTime() - days * 864e5)), end: isoDate(new Date(s.getTime() - 864e5)) };
}
export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className="input w-auto py-2 text-sm" onChange={(e) => e.target.value && onChange(presetPeriod(e.target.value))} defaultValue="" aria-label="Período rápido">
        <option value="">Período…</option><option value="hoje">Hoje</option><option value="7d">Últimos 7 dias</option>
        <option value="30d">Últimos 30 dias</option><option value="mes">Este mês</option><option value="mes_anterior">Mês anterior</option><option value="ano">Este ano</option>
      </select>
      <input type="date" className="input w-auto py-2 text-sm" value={value.start} onChange={(e) => onChange({ ...value, start: e.target.value })} aria-label="Início" />
      <span className="text-stone-400">até</span>
      <input type="date" className="input w-auto py-2 text-sm" value={value.end} onChange={(e) => onChange({ ...value, end: e.target.value })} aria-label="Fim" />
    </div>
  );
}

// ---------------- PIN de autorização ----------------
export function PinModal({ title, reason, onConfirm, onClose }: { title: string; reason?: boolean; onConfirm: (pin: string, reason: string) => Promise<void>; onClose: () => void }) {
  const [pin, setPin] = useState(''); const [why, setWhy] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button className="btn-outline" onClick={onClose}>Voltar</button>
      <button className="btn-primary" disabled={busy || (reason && why.trim().length < 5)} onClick={async () => {
        setBusy(true); setErr('');
        try { await onConfirm(pin, why); onClose(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
      }}>Confirmar</button></>}>
      {reason && <Field label="Motivo" className="mb-3"><textarea className="input min-h-[70px]" value={why} onChange={(e) => setWhy(e.target.value)} /></Field>}
      <Field label="PIN de um responsável autorizado" hint="Necessário quando a operação exige aprovação.">
        <input className="input tracking-[.4em]" type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
      </Field>
      {err && <p className="mt-3 text-sm text-red-700">{err}</p>}
    </Modal>
  );
}

// ---------------- Exportação ----------------
/** CSV com BOM e ponto-e-vírgula (abre direto no Excel em pt-BR). */
export function exportCSV(filename: string, rows: Record<string, unknown>[], headers?: Record<string, string>) {
  if (!rows.length) return;
  const keys = headers ? Object.keys(headers) : Object.keys(rows[0]);
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'number' ? String(v).replace('.', ',') : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + [keys.map((k) => esc(headers?.[k] ?? k)).join(';'), ...rows.map((r) => keys.map((k) => esc(r[k])).join(';'))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
}

/** Abre uma janela de impressão (o navegador permite salvar em PDF). */
export function printHTML(title: string, bodyHtml: string, widthMm?: number) {
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return;
  const page = widthMm ? `@page { size: ${widthMm}mm auto; margin: 2mm; } body { width: ${widthMm - 4}mm; font-size: ${widthMm <= 58 ? 10 : 12}px; }` : '@page { margin: 14mm; }';
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${title}</title><style>
    body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0} h1{font-size:18px;margin:0 0 4px} h2{font-size:14px;margin:14px 0 6px}
    table{border-collapse:collapse;width:100%} th,td{border-bottom:1px solid #ddd;padding:4px 6px;text-align:left;font-size:12px} td.r,th.r{text-align:right}
    .muted{color:#666;font-size:11px} .c{text-align:center} hr{border:0;border-top:1px dashed #000;margin:6px 0} ${page}
  </style></head><body>${bodyHtml}<script>window.onload=()=>{window.print();}</script></body></html>`);
  w.document.close();
}
export const escapeHtml = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

// ---------------- Abas ----------------
export function Tabs({ tabs, initial }: { tabs: { key: string; label: string; el: () => ReactNode; hidden?: boolean }[]; initial?: string }) {
  const visible = tabs.filter((t) => !t.hidden);
  const [k, setK] = useState(() => { try { return sessionStorage.getItem('tab:' + location.pathname) ?? initial ?? visible[0]?.key; } catch { return initial ?? visible[0]?.key; } });
  const cur = visible.find((t) => t.key === k) ?? visible[0];
  return (
    <div>
      <div className="no-scrollbar mb-4 flex gap-1 overflow-x-auto border-b border-char/10 dark:border-white/10">
        {visible.map((t) => <button key={t.key} onClick={() => { setK(t.key); try { sessionStorage.setItem('tab:' + location.pathname, t.key); } catch { /* */ } }}
          className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${cur?.key === t.key ? 'border-red-600' : 'border-transparent text-stone-500 hover:text-char'}`}>{t.label}</button>)}
      </div>
      {cur?.el()}
    </div>
  );
}
