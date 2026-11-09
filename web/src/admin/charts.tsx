import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { money, num } from '../lib/format';
import { Empty } from './ui';

export const C = { main: '#b3261e', prev: '#8a837d', ink: '#57534e', grid: 'rgba(120,113,108,.18)' };
const axis = { fontSize: 11, fill: '#78716c' };
const fmtShort = (v: number) => v >= 1000 ? `${num(v / 1000, 1)} mil` : num(v, 0);
type Fmt = 'money' | 'number';
const f = (v: number, t: Fmt) => (t === 'money' ? money(v) : num(v, 0));

function Tip({ active, payload, label, fmt, labelFmt }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded border border-char/10 bg-white px-3 py-2 text-xs shadow-md dark:bg-stone-800">
      <p className="mb-1 font-semibold">{labelFmt ? labelFmt(label) : label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="flex items-center gap-2"><span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-stone-500">{p.name}:</span> <b className="tabular-nums">{f(p.value, fmt)}</b></p>
      ))}
    </div>
  );
}

/** Linha do período atual × anterior (anterior tracejada e cinza). */
export function LineCompare({ data, x, cur, prev, fmt = 'money', height = 260, labelFmt }: {
  data: any[]; x: string; cur: string; prev?: string; fmt?: Fmt; height?: number; labelFmt?: (v: any) => string;
}) {
  if (!data.length) return <Empty>Sem dados no período.</Empty>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey={x} tick={axis} tickLine={false} axisLine={false} tickFormatter={labelFmt} minTickGap={16} />
        <YAxis tick={axis} tickLine={false} axisLine={false} width={56} tickFormatter={fmtShort} />
        <Tooltip content={<Tip fmt={fmt} labelFmt={labelFmt} />} cursor={{ stroke: C.ink, strokeDasharray: '3 3' }} />
        {prev && <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />}
        {prev && <Line type="monotone" dataKey={prev} name="Período anterior" stroke={C.prev} strokeWidth={2} strokeDasharray="5 4" dot={false} />}
        <Line type="monotone" dataKey={cur} name="Período atual" stroke={C.main} strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function Bars({ data, x, y, fmt = 'money', height = 240, name = 'Valor', labelFmt }: {
  data: any[]; x: string; y: string; fmt?: Fmt; height?: number; name?: string; labelFmt?: (v: any) => string;
}) {
  if (!data.length || data.every((d) => !Number(d[y]))) return <Empty>Sem dados no período.</Empty>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={4}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey={x} tick={axis} tickLine={false} axisLine={false} tickFormatter={labelFmt} minTickGap={4} />
        <YAxis tick={axis} tickLine={false} axisLine={false} width={56} tickFormatter={fmtShort} />
        <Tooltip content={<Tip fmt={fmt} labelFmt={labelFmt} />} cursor={{ fill: 'rgba(120,113,108,.08)' }} />
        <Bar dataKey={y} name={name} fill={C.main} radius={[4, 4, 0, 0]} maxBarSize={36} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Barras horizontais com rótulo e valor em texto (legível sem depender de cor). */
export function HBars({ data, label, value, fmt = 'money', max = 10, sub }: {
  data: any[]; label: string; value: string; fmt?: Fmt; max?: number; sub?: (r: any) => string;
}) {
  const rows = data.slice(0, max);
  if (!rows.length) return <Empty>Sem dados no período.</Empty>;
  const top = Math.max(...rows.map((r) => Number(r[value]) || 0), 1);
  return (
    <ul className="space-y-2.5">
      {rows.map((r, i) => (
        <li key={i} title={`${r[label]}: ${f(Number(r[value]), fmt)}`}>
          <div className="flex justify-between gap-3 text-[13px]"><span className="truncate">{r[label]}</span>
            <span className="shrink-0 tabular-nums text-stone-600 dark:text-stone-300">{f(Number(r[value]), fmt)}{sub && <span className="ml-1 text-stone-400">{sub(r)}</span>}</span></div>
          <div className="mt-1 h-2 rounded-r bg-stone-100 dark:bg-stone-800"><div className="h-2 rounded-r" style={{ width: `${(Number(r[value]) / top) * 100}%`, background: C.main }} /></div>
        </li>
      ))}
    </ul>
  );
}
