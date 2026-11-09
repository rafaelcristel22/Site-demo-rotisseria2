import { useEffect, useState } from 'react';
import { rpc } from '../../lib/supabase';
import { money, num, pct, dateBR, dateTimeBR, minutesToHM, ORDER_STATUS } from '../../lib/format';
import { Card, PageHeader, PeriodPicker, Table, exportCSV, presetPeriod, previousPeriod, printHTML, escapeHtml, type Period, type Col, useToast } from '../ui';
import { Bars, HBars, LineCompare } from '../charts';
import { Dre } from './Finance';

interface Rep { key: string; label: string; fn: string; cols: Col<any>[]; chart?: (rows: any[], prev?: any[]) => JSX.Element; args?: (p: Period) => any; compare?: boolean; transform?: (x: any) => any[] }
const m = (k: string) => (x: any) => money(x[k]);
const day = (v: any) => (v ? new Date(v + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '');
const REPORTS: Rep[] = [
  { key: 'diario', label: '1. Faturamento diário', fn: 'report_sales_series', args: (p) => ({ p_start: p.start, p_end: p.end, p_granularity: 'day' }), compare: true,
    cols: [{ key: 'period', label: 'Dia', render: (x) => dateBR(x.period + 'T12:00') }, { key: 'orders', label: 'Vendas', align: 'right' }, { key: 'revenue', label: 'Faturamento', align: 'right', render: m('revenue') }, { key: 'avg_ticket', label: 'Ticket', align: 'right', render: m('avg_ticket') }, { key: 'gross_profit', label: 'Lucro bruto', align: 'right', render: m('gross_profit') }],
    chart: (r, p) => <LineCompare data={r.map((x, i) => ({ d: x.period, atual: Number(x.revenue), anterior: p?.[i] ? Number(p[i].revenue) : null }))} x="d" cur="atual" prev="anterior" labelFmt={day} /> },
  { key: 'mensal', label: '2. Faturamento mensal', fn: 'report_sales_series', args: (p) => ({ p_start: p.start, p_end: p.end, p_granularity: 'month' }),
    cols: [{ key: 'period', label: 'Mês', render: (x) => new Date(x.period + 'T12:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) }, { key: 'orders', label: 'Vendas', align: 'right' }, { key: 'revenue', label: 'Faturamento', align: 'right', render: m('revenue') }, { key: 'gross_profit', label: 'Lucro bruto', align: 'right', render: m('gross_profit') }],
    chart: (r) => <Bars data={r.map((x) => ({ mes: new Date(x.period + 'T12:00').toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }), v: Number(x.revenue) }))} x="mes" y="v" name="Faturamento" /> },
  { key: 'anual', label: '3. Comparativo anual', fn: 'report_sales_series', args: (p) => ({ p_start: `${Number(p.end.slice(0, 4)) - 4}-01-01`, p_end: p.end, p_granularity: 'year' }),
    cols: [{ key: 'period', label: 'Ano', render: (x) => x.period.slice(0, 4) }, { key: 'orders', label: 'Vendas', align: 'right' }, { key: 'revenue', label: 'Faturamento', align: 'right', render: m('revenue') }, { key: 'gross_profit', label: 'Lucro bruto', align: 'right', render: m('gross_profit') }],
    chart: (r) => <Bars data={r.map((x) => ({ ano: x.period.slice(0, 4), v: Number(x.revenue) }))} x="ano" y="v" name="Faturamento" /> },
  { key: 'categoria', label: '4. Lucro por categoria', fn: 'report_sales_by_category', cols: [{ key: 'category', label: 'Categoria' }, { key: 'quantity', label: 'Qtd.', align: 'right' }, { key: 'revenue', label: 'Receita', align: 'right', render: m('revenue') }, { key: 'cost', label: 'Custo', align: 'right', render: m('cost') }, { key: 'margin', label: 'Lucro', align: 'right', render: m('margin') }, { key: 'margin_pct', label: 'Margem', align: 'right', render: (x) => pct(Number(x.margin_pct)) }],
    chart: (r) => <HBars data={r} label="category" value="margin" /> },
  { key: 'margem', label: '5. Margem por produto', fn: 'report_product_ranking', cols: [{ key: 'product', label: 'Produto' }, { key: 'quantity', label: 'Qtd.', align: 'right' }, { key: 'revenue', label: 'Receita', align: 'right', render: m('revenue') }, { key: 'cost', label: 'Custo', align: 'right', render: m('cost') }, { key: 'margin', label: 'Lucro', align: 'right', render: m('margin') }, { key: 'margin_pct', label: 'Margem', align: 'right', render: (x) => pct(Number(x.margin_pct)) }] },
  { key: 'rentaveis', label: '6. Produtos mais rentáveis', fn: 'report_product_ranking', transform: (r) => [...r].sort((a, b) => Number(b.margin) - Number(a.margin)), cols: [{ key: 'product', label: 'Produto' }, { key: 'margin', label: 'Lucro', align: 'right', render: m('margin') }, { key: 'margin_pct', label: 'Margem', align: 'right', render: (x) => pct(Number(x.margin_pct)) }], chart: (r) => <HBars data={r} label="product" value="margin" /> },
  { key: 'menos', label: '7. Produtos menos rentáveis', fn: 'report_product_ranking', transform: (r) => [...r].sort((a, b) => Number(a.margin_pct) - Number(b.margin_pct)), cols: [{ key: 'product', label: 'Produto' }, { key: 'margin', label: 'Lucro', align: 'right', render: m('margin') }, { key: 'margin_pct', label: 'Margem', align: 'right', render: (x) => pct(Number(x.margin_pct)) }] },
  { key: 'desperdicio', label: '8. Desperdício', fn: 'report_waste', cols: [{ key: 'ingredient', label: 'Item' }, { key: 'quantity', label: 'Qtd.', align: 'right', render: (x) => `${num(x.quantity, 3)} ${x.unit}` }, { key: 'cost', label: 'Custo', align: 'right', render: m('cost') }], chart: (r) => <HBars data={r} label="ingredient" value="cost" /> },
  { key: 'insumos', label: '9. Custo de ingredientes', fn: 'report_ingredient_costs', cols: [{ key: 'ingredient', label: 'Item' }, { key: 'consumed', label: 'Consumido', align: 'right', render: (x) => `${num(x.consumed, 3)} ${x.unit}` }, { key: 'cost', label: 'Custo', align: 'right', render: m('cost') }, { key: 'avg_cost', label: 'Custo médio', align: 'right', render: m('avg_cost') }], chart: (r) => <HBars data={r} label="ingredient" value="cost" /> },
  { key: 'func', label: '10. Produtividade (vendas por funcionário)', fn: 'report_sales_by_operator', cols: [{ key: 'operator', label: 'Funcionário' }, { key: 'sales', label: 'Vendas', align: 'right' }, { key: 'revenue', label: 'Faturamento', align: 'right', render: m('revenue') }, { key: 'avg_ticket', label: 'Ticket', align: 'right', render: m('avg_ticket') }, { key: 'discounts', label: 'Descontos', align: 'right', render: m('discounts') }, { key: 'cancelled', label: 'Cancelamentos', align: 'right' }], chart: (r) => <HBars data={r} label="operator" value="revenue" /> },
  { key: 'horas', label: '11/12. Horas trabalhadas por departamento', fn: 'report_hours_by_department', cols: [{ key: 'department', label: 'Departamento' }, { key: 'employees', label: 'Pessoas', align: 'right' }, { key: 'worked_minutes', label: 'Trabalhadas', align: 'right', render: (x) => minutesToHM(x.worked_minutes) }, { key: 'overtime_minutes', label: 'Extras', align: 'right', render: (x) => minutesToHM(x.overtime_minutes) }, { key: 'late_minutes', label: 'Atrasos', align: 'right', render: (x) => minutesToHM(x.late_minutes) }, { key: 'absences', label: 'Faltas', align: 'right' }],
    chart: (r) => <HBars data={r.map((x) => ({ ...x, h: Number(x.worked_minutes) / 60 }))} label="department" value="h" fmt="number" sub={() => 'h'} /> },
  { key: 'ticket', label: '13. Ticket médio', fn: 'report_sales_series', args: (p) => ({ p_start: p.start, p_end: p.end, p_granularity: 'day' }), compare: true, cols: [{ key: 'period', label: 'Dia', render: (x) => dateBR(x.period + 'T12:00') }, { key: 'avg_ticket', label: 'Ticket médio', align: 'right', render: m('avg_ticket') }],
    chart: (r, p) => <LineCompare data={r.map((x, i) => ({ d: x.period, atual: Number(x.avg_ticket), anterior: p?.[i] ? Number(p[i].avg_ticket) : null }))} x="d" cur="atual" prev="anterior" labelFmt={day} /> },
  { key: 'hora', label: '14. Vendas por horário', fn: 'report_sales_by_hour', cols: [{ key: 'hour', label: 'Hora', render: (x) => `${x.hour}h` }, { key: 'orders', label: 'Vendas', align: 'right' }, { key: 'revenue', label: 'Faturamento', align: 'right', render: m('revenue') }],
    chart: (r) => <Bars data={r.map((x) => ({ h: `${x.hour}h`, v: Number(x.revenue) }))} x="h" y="v" name="Faturamento" /> },
  { key: 'canal', label: '15. Delivery × balcão', fn: 'report_channels', cols: [{ key: 'channel', label: 'Canal' }, { key: 'origin', label: 'Origem' }, { key: 'sales', label: 'Vendas', align: 'right' }, { key: 'revenue', label: 'Faturamento', align: 'right', render: m('revenue') }, { key: 'avg_ticket', label: 'Ticket', align: 'right', render: m('avg_ticket') }],
    chart: (r) => <HBars data={r.map((x) => ({ ...x, l: `${x.channel} · ${x.origin}` }))} label="l" value="revenue" /> },
  { key: 'caixas', label: '16. Desempenho dos caixas', fn: 'report_cash_registers', cols: [{ key: 'terminal', label: 'Caixa' }, { key: 'operator', label: 'Operador' }, { key: 'opened_at', label: 'Abertura', render: (x) => dateTimeBR(x.opened_at) }, { key: 'closed_at', label: 'Fechamento', render: (x) => dateTimeBR(x.closed_at) }, { key: 'sales_total', label: 'Vendas', align: 'right', render: m('sales_total') }, { key: 'difference', label: 'Diferença', align: 'right', render: (x) => x.difference == null ? '—' : <span className={Math.abs(Number(x.difference)) >= 0.01 ? 'text-red-700' : ''}>{money(x.difference)}</span> }] },
  { key: 'despesas', label: '17. Despesas por categoria', fn: 'report_expenses_by_category', cols: [{ key: 'category', label: 'Categoria' }, { key: 'dre_group', label: 'Grupo' }, { key: 'amount', label: 'Valor', align: 'right', render: m('amount') }], chart: (r) => <HBars data={r} label="category" value="amount" /> },
  { key: 'fluxo', label: '18. Fluxo de caixa', fn: 'report_cash_flow', cols: [{ key: 'day', label: 'Dia', render: (x) => dateBR(x.day + 'T12:00') }, { key: 'inflow', label: 'Entradas', align: 'right', render: m('inflow') }, { key: 'outflow', label: 'Saídas', align: 'right', render: m('outflow') }, { key: 'net', label: 'Líquido', align: 'right', render: m('net') }, { key: 'projected_in', label: 'A receber', align: 'right', render: m('projected_in') }, { key: 'projected_out', label: 'A pagar', align: 'right', render: m('projected_out') }, { key: 'cumulative', label: 'Acumulado', align: 'right', render: m('cumulative') }],
    chart: (r) => <LineCompare data={r.map((x) => ({ d: x.day, acumulado: Number(x.cumulative) }))} x="d" cur="acumulado" labelFmt={day} /> },
  { key: 'estoque', label: '19. Evolução do estoque (valor)', fn: 'report_stock_value_history', args: () => ({ p_days: 60 }), cols: [{ key: 'day', label: 'Dia', render: (x) => dateBR(x.day + 'T12:00') }, { key: 'value', label: 'Valor', align: 'right', render: m('value') }],
    chart: (r) => <LineCompare data={r.map((x) => ({ d: x.day, valor: Number(x.value) }))} x="d" cur="valor" labelFmt={day} /> },
  { key: 'cancel', label: '20. Cancelamentos', fn: 'report_cancellations', cols: [{ key: 'order_number', label: 'Pedido', render: (x) => `#${x.order_number}` }, { key: 'cancelled_at', label: 'Quando', render: (x) => dateTimeBR(x.cancelled_at) }, { key: 'total', label: 'Valor', align: 'right', render: m('total') }, { key: 'reason', label: 'Motivo' }, { key: 'cancelled_by', label: 'Por' }, { key: 'authorized_by', label: 'Autorizado por' }] },
  { key: 'pagamentos', label: 'Formas de pagamento', fn: 'report_payment_methods', cols: [{ key: 'method', label: 'Forma' }, { key: 'payments', label: 'Qtd.', align: 'right' }, { key: 'amount', label: 'Valor', align: 'right', render: m('amount') }, { key: 'fees', label: 'Taxas', align: 'right', render: m('fees') }], chart: (r) => <HBars data={r} label="method" value="amount" /> },
  { key: 'status', label: 'Pedidos por status', fn: 'report_orders_by_status', cols: [{ key: 'status', label: 'Status', render: (x) => ORDER_STATUS[x.status] ?? x.status }, { key: 'orders', label: 'Pedidos', align: 'right' }, { key: 'total', label: 'Valor', align: 'right', render: m('total') }] },
];

export default function Reports() {
  const toast = useToast();
  const [sel, setSel] = useState(REPORTS[0].key); const [p, setP] = useState<Period>(presetPeriod('mes'));
  const [rows, setRows] = useState<any[]>([]); const [prev, setPrev] = useState<any[] | undefined>(); const [kitchen, setKitchen] = useState<any>(null);
  const rep = REPORTS.find((r) => r.key === sel);
  useEffect(() => {
    if (sel === 'dre') return;
    if (sel === 'cozinha') { rpc('report_kitchen', { p_start: p.start, p_end: p.end }).then(setKitchen).catch((e) => toast(e.message, 'err')); return; }
    if (!rep) return;
    const args = rep.args ? rep.args(p) : { p_start: p.start, p_end: p.end };
    rpc<any[]>(rep.fn, args).then((r) => setRows(rep.transform ? rep.transform(r) : r)).catch((e) => { setRows([]); toast(e.message, 'err'); });
    if (rep.compare) { const pp = previousPeriod(p); rpc<any[]>(rep.fn, rep.args ? rep.args(pp) : { p_start: pp.start, p_end: pp.end }).then(setPrev).catch(() => setPrev(undefined)); } else setPrev(undefined);
  }, [sel, p]); // eslint-disable-line react-hooks/exhaustive-deps

  const pdf = () => rep && printHTML(rep.label, `<h1>${escapeHtml(rep.label)}</h1><p class="muted">${dateBR(p.start + 'T12:00')} a ${dateBR(p.end + 'T12:00')} · gerado em ${dateTimeBR(new Date())}</p>
    <table><tr>${rep.cols.map((c) => `<th class="${c.align === 'right' ? 'r' : ''}">${escapeHtml(c.label)}</th>`).join('')}</tr>${rows.map((x) => `<tr>${rep.cols.map((c) => {
      const v = c.render ? c.render(x) : x[c.key]; return `<td class="${c.align === 'right' ? 'r' : ''}">${escapeHtml(typeof v === 'object' ? (v as any)?.props?.children ?? '' : v)}</td>`; }).join('')}</tr>`).join('')}</table>`);
  return (
    <div>
      <PageHeader title="Relatórios e BI" subtitle="Todos os números vêm do banco de dados. Escolha o relatório, o período e exporte." actions={sel === 'dre' ? undefined : <PeriodPicker value={p} onChange={setP} />} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <nav className="rounded-md border border-char/10 bg-white p-2 text-sm dark:bg-stone-900">
          {[...REPORTS.map((r) => [r.key, r.label]), ['cozinha', 'Desempenho da cozinha'], ['dre', 'DRE gerencial']].map(([k, l]) => (
            <button key={k} onClick={() => setSel(k)} className={`block w-full rounded px-2 py-1.5 text-left ${sel === k ? 'bg-char text-white' : 'hover:bg-stone-100 dark:hover:bg-stone-800'}`}>{l}</button>))}
        </nav>
        <div className="min-w-0 space-y-4">
          {sel === 'dre' ? <Dre /> : sel === 'cozinha' ? (kitchen && <Card title="Desempenho da cozinha">
            <p className="text-sm">Pedidos finalizados: <b>{kitchen.orders}</b> · tempo médio até ficar pronto: <b>{kitchen.avg_minutes ?? '—'} min</b> · atrasados (&gt; {kitchen.alert_minutes} min): <b>{kitchen.late_orders}</b></p>
            <div className="mt-4 grid gap-4 md:grid-cols-2"><div><h3 className="mb-2 text-sm font-semibold">Tempo médio por produto (min)</h3><HBars data={kitchen.by_product} label="product" value="avg_minutes" fmt="number" /></div>
              <div><h3 className="mb-2 text-sm font-semibold">Tempo médio por horário (min)</h3><Bars data={kitchen.by_hour.map((x: any) => ({ h: `${x.hour}h`, v: Number(x.avg_minutes) }))} x="h" y="v" fmt="number" name="Minutos" /></div></div></Card>) : rep && <>
            <div className="flex flex-wrap items-center gap-2"><h2 className="heading text-xl">{rep.label}</h2>{rep.compare && <span className="text-xs text-stone-500">linha tracejada: período anterior de mesma duração</span>}
              <button className="btn-outline ml-auto py-1.5 text-sm" onClick={() => exportCSV(rep.key, rows)}>Excel (CSV)</button><button className="btn-outline py-1.5 text-sm" onClick={pdf}>PDF / imprimir</button></div>
            {rep.chart && <Card>{rep.chart(rows, prev)}</Card>}
            <div className="rounded-md border border-char/10 bg-white dark:bg-stone-900"><Table rows={rows} rowKey={rep.cols[0].key} cols={rep.cols} empty="Sem dados no período." /></div>
          </>}
        </div>
      </div>
    </div>
  );
}
