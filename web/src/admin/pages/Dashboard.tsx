import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc } from '../../lib/supabase';
import { money, num, pct, dateBR, ORDER_STATUS } from '../../lib/format';
import { Card, PageHeader, PeriodPicker, Stat, presetPeriod, previousPeriod, type Period, useToast } from '../ui';
import { Bars, HBars, LineCompare } from '../charts';

type K = Record<string, number>;
const delta = (a: number, b: number) => (b ? ((a - b) / Math.abs(b)) * 100 : null);
function Delta({ cur, prev, invert }: { cur: number; prev: number; invert?: boolean }) {
  const d = delta(cur, prev);
  if (d === null) return <span>sem base de comparação</span>;
  const good = invert ? d <= 0 : d >= 0;
  return <span className={good ? 'text-green-800' : 'text-red-700'}>{d >= 0 ? '▲' : '▼'} {pct(Math.abs(d))} vs período anterior</span>;
}

export default function Dashboard() {
  const toast = useToast();
  const [p, setP] = useState<Period>(presetPeriod('mes'));
  const [k, setK] = useState<K | null>(null); const [kp, setKp] = useState<K | null>(null);
  const [series, setSeries] = useState<any[]>([]); const [hours, setHours] = useState<any[]>([]);
  const [cats, setCats] = useState<any[]>([]); const [prods, setProds] = useState<any[]>([]);
  const [pays, setPays] = useState<any[]>([]); const [status, setStatus] = useState<any[]>([]);
  const [ops, setOps] = useState<any[]>([]); const [exp, setExp] = useState<any[]>([]); const [ch, setCh] = useState<any[]>([]);
  const [months, setMonths] = useState<any[]>([]);

  useEffect(() => {
    const prev = previousPeriod(p);
    const a = { p_start: p.start, p_end: p.end };
    const y0 = `${new Date().getFullYear() - 1}-01-01`;
    Promise.all([
      rpc<K>('dashboard_kpis', a), rpc<K>('dashboard_kpis', { p_start: prev.start, p_end: prev.end }),
      rpc<any[]>('report_sales_series', { ...a, p_granularity: 'day' }),
      rpc<any[]>('report_sales_series', { p_start: prev.start, p_end: prev.end, p_granularity: 'day' }),
      rpc<any[]>('report_sales_by_hour', a), rpc<any[]>('report_sales_by_category', a), rpc<any[]>('report_product_ranking', a),
      rpc<any[]>('report_payment_methods', a), rpc<any[]>('report_orders_by_status', a), rpc<any[]>('report_sales_by_operator', a),
      rpc<any[]>('report_expenses_by_category', a), rpc<any[]>('report_channels', a),
      rpc<any[]>('report_sales_series', { p_start: y0, p_end: p.end, p_granularity: 'month' }),
    ]).then(([k1, k2, s1, s2, h, c, pr, pm, st, op, ex, chn, mo]) => {
      setK(k1); setKp(k2);
      setSeries(s1.map((r, i) => ({ dia: r.period, atual: Number(r.revenue), anterior: s2[i] ? Number(s2[i].revenue) : null })));
      setHours(h.map((r) => ({ hora: `${r.hour}h`, valor: Number(r.revenue) })));
      setCats(c); setProds(pr); setPays(pm); setStatus(st); setOps(op); setExp(ex); setCh(chn);
      setMonths(mo.map((r) => ({ mes: r.period, valor: Number(r.revenue) })));
    }).catch((e) => toast(e.message, 'err'));
  }, [p, toast]);

  const n = (x: string) => Number(k?.[x] ?? 0); const np = (x: string) => Number(kp?.[x] ?? 0);
  const byMonth = (() => {
    const y = new Date().getFullYear();
    return Array.from({ length: 12 }, (_, i) => {
      const cur = months.find((m) => new Date(m.mes + 'T12:00').getFullYear() === y && new Date(m.mes + 'T12:00').getMonth() === i);
      const prev = months.find((m) => new Date(m.mes + 'T12:00').getFullYear() === y - 1 && new Date(m.mes + 'T12:00').getMonth() === i);
      return { mes: new Date(y, i, 1).toLocaleDateString('pt-BR', { month: 'short' }), atual: cur?.valor ?? 0, anterior: prev?.valor ?? 0 };
    });
  })();
  const least = [...prods].filter((x) => Number(x.quantity) > 0).sort((a, b) => Number(a.quantity) - Number(b.quantity));

  return (
    <div>
      <PageHeader title="Dashboard" subtitle={`${dateBR(p.start + 'T12:00')} a ${dateBR(p.end + 'T12:00')} · comparado ao período anterior de mesma duração`}
        actions={<PeriodPicker value={p} onChange={setP} />} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Faturamento hoje" value={money(n('revenue_today'))} />
        <Stat label="Na semana" value={money(n('revenue_week'))} />
        <Stat label="No mês" value={money(n('revenue_month'))} />
        <Stat label="No ano" value={money(n('revenue_year'))} />
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-stone-500">No período selecionado</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Faturamento" value={money(n('revenue_period'))} sub={<Delta cur={n('revenue_period')} prev={np('revenue_period')} />} />
        <Stat label="Lucro bruto" value={money(n('gross_profit'))} sub="vendas − custo (ficha técnica)" />
        <Stat label="Lucro líquido est." value={money(n('net_profit_estimate'))} tone={n('net_profit_estimate') < 0 ? 'bad' : undefined} sub="após taxas e despesas" />
        <Stat label="Despesas" value={money(n('expenses_period'))} sub={<Delta cur={n('expenses_period')} prev={np('expenses_period')} invert />} />
        <Stat label="Pedidos" value={num(n('orders_count'))} sub={`${num(n('cancelled_count'))} cancelados`} />
        <Stat label="Vendas" value={num(n('sales_count'))} sub={<Delta cur={n('sales_count')} prev={np('sales_count')} />} />
        <Stat label="Ticket médio" value={money(n('avg_ticket'))} sub={<Delta cur={n('avg_ticket')} prev={np('avg_ticket')} />} />
        <Stat label="Itens vendidos" value={num(n('items_sold'))} />
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-stone-500">Agora</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Link to="/admin/pedidos"><Stat label="Pedidos pendentes" value={num(n('orders_pending'))} tone={n('orders_pending') > 0 ? 'warn' : undefined} /></Link>
        <Link to="/admin/cozinha"><Stat label="Em preparo" value={num(n('orders_preparing'))} /></Link>
        <Stat label="Prontos / em rota" value={num(n('orders_ready'))} />
        <Link to="/admin/ponto"><Stat label="Trabalhando" value={num(n('employees_working'))} sub={`${num(n('employees_absent'))} ausente(s)`} tone={n('employees_absent') ? 'warn' : undefined} /></Link>
        <Link to="/admin/estoque"><Stat label="Estoque baixo" value={num(n('low_stock'))} tone={n('low_stock') ? 'bad' : undefined} sub={`${num(n('expiring_lots'))} lote(s) vencendo`} /></Link>
        <Link to="/admin/financeiro"><Stat label="Contas a pagar" value={money(n('payables_open'))} sub={<span className={n('payables_overdue') ? 'text-red-700' : ''}>{money(n('payables_overdue'))} vencido</span>} /></Link>
        <Stat label="Vencem em 7 dias" value={money(n('payables_due_7d'))} />
        <Stat label="Contas a receber" value={money(n('receivables_open'))} />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <Card title="Faturamento por dia" className="xl:col-span-2">
          <LineCompare data={series} x="dia" cur="atual" prev="anterior" labelFmt={(v) => (v ? new Date(v + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '')} />
        </Card>
        <Card title="Vendas por horário"><Bars data={hours} x="hora" y="valor" name="Faturamento" /></Card>
        <Card title={`Comparativo mensal ${new Date().getFullYear()} × ${new Date().getFullYear() - 1}`} className="xl:col-span-2">
          <LineCompare data={byMonth} x="mes" cur="atual" prev="anterior" />
        </Card>
        <Card title="Formas de pagamento"><HBars data={pays} label="method" value="amount" sub={(r) => `(${r.payments})`} /></Card>
        <Card title="Vendas por categoria"><HBars data={cats} label="category" value="revenue" sub={(r) => `· margem ${pct(Number(r.margin_pct))}`} /></Card>
        <Card title="Produtos mais vendidos"><HBars data={prods} label="product" value="quantity" fmt="number" sub={(r) => `· ${money(r.revenue)}`} /></Card>
        <Card title="Produtos menos vendidos"><HBars data={least} label="product" value="quantity" fmt="number" max={8} /></Card>
        <Card title="Pedidos por status"><HBars data={status.map((s) => ({ ...s, label: ORDER_STATUS[s.status] ?? s.status }))} label="label" value="orders" fmt="number" /></Card>
        <Card title="Vendas por funcionário"><HBars data={ops} label="operator" value="revenue" sub={(r) => `(${r.sales})`} /></Card>
        <Card title="Despesas por categoria"><HBars data={exp} label="category" value="amount" /></Card>
        <Card title="Canais: balcão, retirada e entrega"><HBars data={ch.map((c) => ({ ...c, label: `${c.channel} · ${c.origin}` }))} label="label" value="revenue" sub={(r) => `(${r.sales})`} /></Card>
      </div>
    </div>
  );
}
