import type { MenuProduct, MenuOptionGroup } from './types';

export interface CartLine {
  key: string;
  product_id: string;
  name: string;
  unit_price: number;   // preço exibido; o servidor recalcula no fechamento
  quantity: number;
  option_ids: string[];
  option_labels: string[];
  notes: string;
  image_url: string | null;
  category_id: string;
}

export function lineKey(productId: string, optionIds: string[], notes: string) {
  return [productId, [...optionIds].sort().join(','), notes.trim().toLowerCase()].join('|');
}

/** Valida seleção de opções segundo min/max de cada grupo. Retorna mensagem de erro ou null. */
export function validateOptions(groups: MenuOptionGroup[], selected: string[]): string | null {
  for (const g of groups) {
    const n = g.options.filter((o) => selected.includes(o.id)).length;
    if (n < g.min_select) return `Escolha ${g.min_select === 1 ? 'uma opção' : `${g.min_select} opções`} em "${g.name}"`;
    if (n > g.max_select) return `Máximo de ${g.max_select} em "${g.name}"`;
  }
  return null;
}

export function unitPrice(product: MenuProduct, selected: string[]) {
  const deltas = product.option_groups.flatMap((g) => g.options).filter((o) => selected.includes(o.id))
    .reduce((s, o) => s + Number(o.price_delta), 0);
  return round2(Number(product.price) + deltas);
}

export function addLine(lines: CartLine[], line: CartLine): CartLine[] {
  const existing = lines.find((l) => l.key === line.key);
  if (existing) return lines.map((l) => (l.key === line.key ? { ...l, quantity: Math.min(l.quantity + line.quantity, 99) } : l));
  return [...lines, line];
}

export function setQuantity(lines: CartLine[], key: string, q: number): CartLine[] {
  if (q <= 0) return lines.filter((l) => l.key !== key);
  return lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(q, 99) } : l));
}

export const subtotal = (lines: CartLine[]) => round2(lines.reduce((s, l) => s + l.unit_price * l.quantity, 0));
export const itemCount = (lines: CartLine[]) => lines.reduce((s, l) => s + l.quantity, 0);

export function deliveryFee(sub: number, zone?: { fee: number; free_delivery_above: number | null } | null) {
  if (!zone) return 0;
  if (zone.free_delivery_above != null && sub >= Number(zone.free_delivery_above)) return 0;
  return Number(zone.fee);
}

/** Troco: valor entregue menos total; null se insuficiente. */
export function changeDue(total: number, tendered: number): number | null {
  if (!Number.isFinite(tendered) || tendered < total) return null;
  return round2(tendered - total);
}

export const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
