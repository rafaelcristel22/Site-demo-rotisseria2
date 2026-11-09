import { useEffect, useState } from 'react';
import { supabase, rpc } from '../../lib/supabase';
import { money, num, minutesToHM, isoDate } from '../../lib/format';
import { Badge, Card, PageHeader, presetPeriod } from '../ui';

interface Msg { role: 'user' | 'assistant'; text: string }
const TONE: Record<string, any> = { positivo: 'good', atencao: 'warn', inconsistencia: 'bad', info: 'info' };

/** Perguntas frequentes respondidas direto do banco (sem IA, sempre disponíveis). */
const QUICK: { q: string; run: () => Promise<string> }[] = [
  { q: 'Quanto faturamos hoje?', run: async () => { const t = isoDate(new Date()); const k = await rpc<any>('dashboard_kpis', { p_start: t, p_end: t });
    return `Hoje: ${money(k.revenue_today)} em ${k.sales_count} venda(s), ticket médio ${money(k.avg_ticket)}.`; } },
  { q: 'Qual foi nosso produto mais vendido?', run: async () => { const p = presetPeriod('mes'); const r = await rpc<any[]>('report_product_ranking', { p_start: p.start, p_end: p.end });
    const top = [...r].sort((a, b) => Number(b.quantity) - Number(a.quantity))[0];
    return top ? `No mês: ${top.product}, ${num(top.quantity)} unidade(s), ${money(top.revenue)} (margem ${top.margin_pct}%).` : 'Ainda não há vendas neste mês.'; } },
  { q: 'Quanto gastamos com fornecedores neste mês?', run: async () => { const p = presetPeriod('mes');
    const { data } = await supabase.from('accounts_payable').select('paid_amount,payable_type,paid_at').eq('payable_type', 'fornecedor').gte('paid_at', p.start).lte('paid_at', p.end);
    const paid = (data ?? []).reduce((s, x) => s + Number(x.paid_amount), 0);
    const { data: open } = await supabase.from('accounts_payable').select('amount,paid_amount').eq('payable_type', 'fornecedor').in('status', ['aberto', 'parcial']);
    return `Pago a fornecedores no mês: ${money(paid)}. Em aberto com fornecedores: ${money((open ?? []).reduce((s, x) => s + Number(x.amount) - Number(x.paid_amount), 0))}.`; } },
  { q: 'Qual departamento teve mais horas extras?', run: async () => { const p = presetPeriod('mes'); const r = await rpc<any[]>('report_hours_by_department', { p_start: p.start, p_end: p.end });
    const top = [...r].sort((a, b) => Number(b.overtime_minutes) - Number(a.overtime_minutes))[0];
    return top && Number(top.overtime_minutes) > 0 ? `${top.department}: ${minutesToHM(top.overtime_minutes)} de horas extras no mês.` : 'Nenhuma hora extra registrada no mês.'; } },
];

export default function Assistant() {
  const [ins, setIns] = useState<any[] | null>(null); const [msgs, setMsgs] = useState<Msg[]>([]); const [q, setQ] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { rpc<any[]>('business_insights', { p_days: 30 }).then(setIns).catch(() => setIns([])); }, []);

  async function ask(text: string) {
    setMsgs((m) => [...m, { role: 'user', text }]); setBusy(true);
    try {
      const quick = QUICK.find((x) => x.q === text);
      let answer: string;
      if (quick) answer = await quick.run();
      else {
        const { data, error } = await supabase.functions.invoke('ai-assistant', { body: { question: text, history: msgs.slice(-8) } });
        if (error || data?.error) answer = `O assistente de IA não está disponível (${data?.error ?? error?.message}). As perguntas rápidas e os alertas abaixo continuam funcionando com os dados do banco.`;
        else answer = data.answer;
      }
      setMsgs((m) => [...m, { role: 'assistant', text: answer }]);
    } catch (e) { setMsgs((m) => [...m, { role: 'assistant', text: (e as Error).message }]); } finally { setBusy(false); }
  }

  return (
    <div>
      <PageHeader title="Assistente" subtitle="Responde com dados autorizados do banco. Somente leitura: não altera preços, estoque, ponto ou financeiro." />
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <Card title="Pergunte">
          <div className="mb-3 flex flex-wrap gap-2">{QUICK.map((x) => <button key={x.q} className="btn-outline py-1.5 text-sm" onClick={() => ask(x.q)} disabled={busy}>{x.q}</button>)}</div>
          <div className="min-h-[240px] space-y-3 rounded border border-char/10 p-3">
            {!msgs.length && <p className="text-sm text-stone-500">Faça uma pergunta sobre vendas, custos, estoque, equipe ou financeiro.</p>}
            {msgs.map((m, i) => <div key={i} className={m.role === 'user' ? 'text-right' : ''}><p className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-md px-3 py-2 text-sm ${m.role === 'user' ? 'bg-char text-white' : 'bg-stone-100 dark:bg-stone-800'}`}>{m.text}</p></div>)}
            {busy && <p className="text-sm text-stone-500">Consultando os dados…</p>}
          </div>
          <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (q.trim()) { ask(q.trim()); setQ(''); } }}>
            <input className="input" placeholder="Ex.: qual dia da semana vende mais frango?" value={q} onChange={(e) => setQ(e.target.value)} disabled={busy} />
            <button className="btn-dark" disabled={busy || !q.trim()}>Enviar</button></form>
          <p className="mt-2 text-xs text-stone-500">Perguntas livres usam a função “ai-assistant” no servidor (Claude), que só executa consultas de leitura com as suas permissões.</p>
        </Card>
        <Card title="Alertas e oportunidades (últimos 30 dias)">
          {ins === null ? <p className="text-sm text-stone-500">Analisando…</p> : !ins.length ? <p className="text-sm text-stone-500">Nada relevante a apontar com os dados atuais.</p> :
            <ul className="space-y-2">{ins.map((x, i) => <li key={i} className="text-sm"><Badge tone={TONE[x.type]}>{x.area}</Badge> <span className="ml-1">{x.text}</span></li>)}</ul>}
        </Card>
      </div>
    </div>
  );
}
