const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const money = (v: number | string | null | undefined) => brl.format(Number(v ?? 0));
export const num = (v: number | string | null | undefined, d = 0) =>
  Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
export const pct = (v: number | null | undefined, d = 1) => `${num((v ?? 0), d)}%`;
export const dateBR = (v: string | Date | null | undefined) => (v ? new Date(v).toLocaleDateString('pt-BR') : '—');
export const dateTimeBR = (v: string | Date | null | undefined) =>
  v ? new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
export const timeBR = (v: string | Date | null | undefined) =>
  v ? new Date(v).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
export const minutesToHM = (m: number | null | undefined) => {
  const v = Math.round(Number(m ?? 0));
  const s = v < 0 ? '-' : '';
  const a = Math.abs(v);
  return `${s}${Math.floor(a / 60)}h${String(a % 60).padStart(2, '0')}`;
};
export function formatPhone(p: string) {
  const d = p.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
export const isoDate = (d: Date) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};
export const ORDER_STATUS: Record<string, string> = {
  pendente: 'Aguardando confirmação', novo: 'Confirmado', em_preparo: 'Em preparo',
  aguardando_finalizacao: 'Finalizando', pronto: 'Pronto', saiu_entrega: 'Saiu para entrega',
  entregue: 'Entregue', cancelado: 'Cancelado',
};
