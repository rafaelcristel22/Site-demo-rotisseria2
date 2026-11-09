import { money, dateTimeBR } from '../lib/format';
import { escapeHtml as e, printHTML } from './ui';
import { EscPos, line, center, rule, COLS, sendSerial } from '../lib/escpos';
import { supabase } from '../lib/supabase';

export interface PrintOrder {
  number: number; created_at: string; channel: string; customer_name?: string | null; customer_phone?: string | null;
  delivery_address?: any; notes?: string | null; subtotal: number; discount: number; delivery_fee: number; total: number;
  scheduled_for?: string | null; change_for?: number | null; payment_method_planned?: string | null;
  items: { product_name: string; quantity: number; total: number; options: { name: string }[]; notes?: string | null }[];
  payments?: { method_code: string; amount: number; change_amount: number }[];
}
const CH: Record<string, string> = { balcao: 'BALCÃO', retirada: 'RETIRADA', delivery: 'ENTREGA' };

async function company() {
  const { data } = await supabase.from('company_settings').select('trade_name,cnpj,phone,address,receipt_footer,printers').eq('id', 1).maybeSingle();
  return data ?? { trade_name: 'Rotisseria', printers: [] };
}
function addr(a: any) { return a ? [a.street, a.number, a.complement, a.district, a.reference && `Ref.: ${a.reference}`].filter(Boolean).join(', ') : ''; }

/** Comprovante do cliente (não fiscal) ou comanda da cozinha, pelo navegador (58/80 mm). */
export async function printOrder(o: PrintOrder, kind: 'cliente' | 'cozinha', paper: 58 | 80 = 80) {
  const c: any = await company();
  const items = o.items.map((i) => `<tr><td>${Number(i.quantity)}× ${e(i.product_name)}${i.options?.length ? `<div class="muted">${e(i.options.map((x) => x.name).join(', '))}</div>` : ''}${i.notes ? `<div><b>OBS: ${e(i.notes)}</b></div>` : ''}</td>${kind === 'cliente' ? `<td class="r">${money(i.total)}</td>` : ''}</tr>`).join('');
  const head = kind === 'cozinha'
    ? `<h1 class="c">PEDIDO #${o.number}</h1><p class="c"><b>${CH[o.channel] ?? o.channel}</b> · ${dateTimeBR(o.created_at)}</p>${o.scheduled_for ? `<p class="c"><b>AGENDADO: ${dateTimeBR(o.scheduled_for)}</b></p>` : ''}`
    : `<h1 class="c">${e(c.trade_name)}</h1><p class="c muted">${e(c.cnpj ?? '')} ${e(c.phone ?? '')}</p><hr><p><b>Pedido #${o.number}</b> · ${CH[o.channel] ?? o.channel}<br>${dateTimeBR(o.created_at)}</p>`;
  const cust = o.customer_name ? `<p>${e(o.customer_name)} ${e(o.customer_phone ?? '')}${o.channel === 'delivery' ? `<br>${e(addr(o.delivery_address))}` : ''}</p>` : '';
  const totals = kind === 'cliente' ? `<hr><table>
    <tr><td>Subtotal</td><td class="r">${money(o.subtotal)}</td></tr>
    ${Number(o.discount) ? `<tr><td>Desconto</td><td class="r">-${money(o.discount)}</td></tr>` : ''}
    ${Number(o.delivery_fee) ? `<tr><td>Entrega</td><td class="r">${money(o.delivery_fee)}</td></tr>` : ''}
    <tr><td><b>TOTAL</b></td><td class="r"><b>${money(o.total)}</b></td></tr>
    ${(o.payments ?? []).map((p) => `<tr><td>${e(p.method_code)}</td><td class="r">${money(p.amount)}</td></tr>${Number(p.change_amount) ? `<tr><td>Troco</td><td class="r">${money(p.change_amount)}</td></tr>` : ''}`).join('')}
    </table><hr><p class="c muted">Documento sem valor fiscal.<br>${e(c.receipt_footer ?? '')}</p>` : '';
  printHTML(`Pedido ${o.number}`, `${head}<hr>${cust}<table>${items}</table>${o.notes ? `<p><b>OBS. DO PEDIDO:</b> ${e(o.notes)}</p>` : ''}${totals}`, paper);
}

/** Envio direto ESC/POS por porta serial/USB-serial (impressora configurada como "serial"). */
export async function printOrderEscPos(o: PrintOrder, kind: 'cliente' | 'cozinha', paper: 58 | 80 = 80, openDrawer = false) {
  const c: any = await company(); const cols = COLS[paper]; const p = new EscPos();
  if (kind === 'cozinha') {
    p.align('center').size(true).bold(true).ln(`PEDIDO #${o.number}`).size(false).ln(CH[o.channel] ?? o.channel).bold(false).align('left').ln(rule(cols));
  } else {
    p.align('center').bold(true).ln(c.trade_name).bold(false).ln(c.phone ?? '').align('left').ln(rule(cols)).ln(`Pedido #${o.number}  ${dateTimeBR(o.created_at)}`);
  }
  if (o.customer_name) p.ln(`${o.customer_name} ${o.customer_phone ?? ''}`);
  if (o.channel === 'delivery') p.ln(addr(o.delivery_address));
  p.ln(rule(cols));
  for (const i of o.items) {
    p.bold(kind === 'cozinha').ln(kind === 'cliente' ? line(`${Number(i.quantity)}x ${i.product_name}`, money(i.total), cols) : `${Number(i.quantity)}x ${i.product_name}`).bold(false);
    if (i.options?.length) p.ln('  ' + i.options.map((x) => x.name).join(', '));
    if (i.notes) p.bold(true).ln('  OBS: ' + i.notes).bold(false);
  }
  if (kind === 'cliente') {
    p.ln(rule(cols)).ln(line('Subtotal', money(o.subtotal), cols));
    if (Number(o.discount)) p.ln(line('Desconto', '-' + money(o.discount), cols));
    if (Number(o.delivery_fee)) p.ln(line('Entrega', money(o.delivery_fee), cols));
    p.bold(true).ln(line('TOTAL', money(o.total), cols)).bold(false).ln(center('Documento sem valor fiscal', cols));
  }
  if (openDrawer) p.drawer();
  await sendSerial(p.feed(4).cut().build());
}
