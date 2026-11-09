import { useCallback, useEffect, useState } from 'react';
import { supabase, rpc } from '../../lib/supabase';
import { money, minutesToHM, dateTimeBR } from '../../lib/format';
import Crud from '../Crud';
import { Badge, Card, Modal, PageHeader, Stat, Table, exportCSV, printHTML, escapeHtml, useToast } from '../ui';
import { useAuth } from '../auth';
import { RefName } from './Catalog';

export default function Payroll() {
  const { can } = useAuth(); const toast = useToast();
  const [periods, setPeriods] = useState<any[]>([]); const [sel, setSel] = useState<any | null>(null); const [rows, setRows] = useState<any[]>([]);
  const [month, setMonth] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); });
  const [slip, setSlip] = useState<any | null>(null); const [entries, setEntries] = useState(false);
  const loadP = useCallback(() => supabase.from('payroll_periods').select('*').order('reference_month', { ascending: false }).then(({ data }) => { setPeriods(data ?? []); setSel((s: any) => s ? (data ?? []).find((x) => x.id === s.id) ?? s : (data ?? [])[0] ?? null); }), []);
  useEffect(() => { loadP(); }, [loadP]);
  const loadR = useCallback(() => { if (sel) supabase.from('payroll_records').select('*').eq('period_id', sel.id).then(({ data }) => setRows(data ?? [])); else setRows([]); }, [sel]);
  useEffect(() => { loadR(); }, [loadR]);
  const tot = (k: string) => rows.reduce((s, x) => s + Number(x[k] ?? 0), 0);
  const act = async (fn: string, args: any, ok: string) => { try { await rpc(fn, args); toast(ok); loadP(); loadR(); } catch (e) { toast((e as Error).message, 'err'); } };

  return (
    <div>
      <PageHeader title="Folha de pagamento" subtitle="Estimativa gerencial a partir do ponto, horas extras aprovadas, lançamentos e tabelas configuráveis. Valide com a contabilidade antes de pagar." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select className="input w-auto py-2 text-sm" value={sel?.id ?? ''} onChange={(e) => setSel(periods.find((p) => p.id === e.target.value) ?? null)}>
          {periods.map((p) => <option key={p.id} value={p.id}>{new Date(p.reference_month + 'T12:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })} — {p.status}</option>)}</select>
        {can('payroll.manage') && <><input type="month" className="input w-auto py-2 text-sm" value={month} onChange={(e) => setMonth(e.target.value)} />
          <button className="btn-outline py-2 text-sm" onClick={() => act('payroll_open_period', { p_month: month + '-01' }, 'Competência aberta')}>Abrir competência</button></>}
        {sel && can('payroll.manage') && <>
          <button className="btn-outline py-2 text-sm" onClick={() => setEntries(true)}>Lançamentos (adicionais, descontos, adiantamentos)</button>
          {['rascunho', 'calculado'].includes(sel.status) && <button className="btn-primary py-2 text-sm" onClick={() => act('calculate_payroll', { p_period: sel.id }, 'Folha calculada')}>Calcular</button>}
          {sel.status === 'calculado' && <button className="btn-dark py-2 text-sm" onClick={() => { const due = prompt('Vencimento das contas a pagar (AAAA-MM-DD):', `${sel.reference_month.slice(0, 7).replace(/(\d+)-(\d+)/, (_: string, y: string, m: string) => Number(m) === 12 ? `${Number(y) + 1}-01` : `${y}-${String(Number(m) + 1).padStart(2, '0')}`)}-05`); if (due) act('payroll_review', { p_period: sel.id, p_due: due, p_generate_payables: true }, 'Folha conferida; contas a pagar geradas'); }}>Conferir e gerar contas a pagar</button>}
          {sel.status === 'conferido' && <button className="btn-ghost py-2 text-sm text-red-700" onClick={() => { const why = prompt('Motivo da reabertura:'); if (why) act('payroll_reopen', { p_period: sel.id, p_reason: why }, 'Folha reaberta'); }}>Reabrir</button>}
        </>}
        {rows.length > 0 && <button className="btn-outline ml-auto py-2 text-sm" onClick={() => exportCSV('folha', rows.map((x) => ({ funcionario_id: x.employee_id, base: x.base_salary, extras: x.overtime_amount, dsr: x.dsr_amount, noturno: x.night_amount,
          comissao: x.commission, adicionais: x.additions, bruto: x.gross, inss: x.inss, irrf: x.irrf, faltas: x.absence_deduction, atrasos: x.late_deduction, adiantamentos: x.advances, outros_descontos: x.other_deductions, liquido: x.net, fgts: x.fgts, custo_empresa: x.employer_cost })))}>Exportar para contabilidade (CSV)</button>}
      </div>
      {sel && <>
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-6">
          <Stat label="Situação" value={sel.status} sub={sel.calculated_at ? `calculada ${dateTimeBR(sel.calculated_at)}` : undefined} />
          <Stat label="Salário bruto" value={money(tot('gross'))} /><Stat label="Descontos" value={money(tot('total_deductions'))} />
          <Stat label="Líquido" value={money(tot('net'))} /><Stat label="FGTS" value={money(tot('fgts'))} />
          <Stat label="Custo total estimado" value={money(tot('employer_cost'))} sub="inclui provisões de férias e 13º" />
        </div>
        <div className="rounded-md border border-char/10 bg-white dark:bg-stone-900"><Table rows={rows} onRow={setSlip} empty="Calcule a folha para ver os valores." cols={[
          { key: 'employee_id', label: 'Funcionário', render: (x) => <RefName table="employees" id={x.employee_id} col="full_name" /> },
          { key: 'base_salary', label: 'Base', align: 'right', render: (x) => money(x.base_salary) },
          { key: 'overtime_amount', label: 'Extras + DSR', align: 'right', render: (x) => money(Number(x.overtime_amount) + Number(x.dsr_amount)) },
          { key: 'gross', label: 'Bruto', align: 'right', render: (x) => money(x.gross) }, { key: 'inss', label: 'INSS', align: 'right', render: (x) => money(x.inss) },
          { key: 'irrf', label: 'IRRF', align: 'right', render: (x) => money(x.irrf) }, { key: 'total_deductions', label: 'Descontos', align: 'right', render: (x) => money(x.total_deductions) },
          { key: 'net', label: 'Líquido', align: 'right', render: (x) => <b>{money(x.net)}</b> }, { key: 'absences', label: 'Faltas', align: 'right', render: (x) => x.absences ? <Badge tone="bad">{x.absences}</Badge> : '' }]} /></div>
      </>}
      <p className="mt-3 text-xs text-stone-500">Tabelas de INSS/IRRF em Configurações → Folha. O sistema não envia eSocial/DCTFWeb; exporte para o escritório contábil.</p>
      {slip && <Payslip rec={slip} period={sel} onClose={() => setSlip(null)} />}
      {entries && sel && <Modal title="Lançamentos da competência" wide onClose={() => { setEntries(false); }}>
        <Crud cfg={{ table: 'payroll_entries', title: 'Lançamentos', perm: 'payroll.manage', embedded: true, order: 'created_at.desc', filter: { period_id: sel.id }, canDelete: true,
          fields: [{ name: 'employee_id', label: 'Funcionário', type: 'ref', ref: { table: 'employees', label: 'full_name' }, required: true },
            { name: 'entry_type', label: 'Tipo', type: 'select', required: true, options: [{ value: 'adicional', label: 'Adicional (provento)' }, { value: 'comissao', label: 'Comissão' }, { value: 'beneficio', label: 'Benefício' },
              { value: 'adiantamento', label: 'Adiantamento (desconto)' }, { value: 'vale_transporte', label: 'Vale-transporte (desconto)' }, { value: 'desconto', label: 'Desconto autorizado' }, { value: 'outro', label: 'Outro provento' }] },
            { name: 'description', label: 'Descrição', required: true }, { name: 'amount', label: 'Valor', type: 'money', required: true }, { name: 'taxable', label: 'Incide INSS/IRRF', type: 'bool', default: true }],
          columns: [{ key: 'employee_id', label: 'Funcionário', render: (x) => <RefName table="employees" id={x.employee_id} col="full_name" /> }, { key: 'entry_type', label: 'Tipo' }, { key: 'description', label: 'Descrição' }, { key: 'amount', label: 'Valor', align: 'right', render: (x) => money(x.amount) }] }} />
      </Modal>}
    </div>
  );
}

function Payslip({ rec, period, onClose }: { rec: any; period: any; onClose: () => void }) {
  const [name, setName] = useState('');
  useEffect(() => { supabase.from('employees').select('full_name').eq('id', rec.employee_id).maybeSingle().then(({ data }) => setName(data?.full_name ?? '')); }, [rec.employee_id]);
  const prov: [string, number][] = [['Salário-base', rec.base_salary], [`Horas extras (${minutesToHM(rec.overtime_50_minutes)} a 50% · ${minutesToHM(rec.overtime_100_minutes)} a 100%)`, rec.overtime_amount],
    ['DSR sobre extras', rec.dsr_amount], [`Adicional noturno (${minutesToHM(rec.night_minutes)})`, rec.night_amount], ['Comissões', rec.commission], ['Adicionais', rec.additions], ['Benefícios (não tributáveis)', rec.benefits]];
  const desc: [string, number][] = [['INSS', rec.inss], ['IRRF', rec.irrf], [`Faltas (${rec.absences})`, rec.absence_deduction], [`Atrasos (${minutesToHM(rec.late_minutes)})`, rec.late_deduction], ['Adiantamentos', rec.advances], ['Outros descontos', rec.other_deductions]];
  const comp = new Date(period.reference_month + 'T12:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const html = `<h1>Demonstrativo de pagamento (estimativa)</h1><p><b>${escapeHtml(name)}</b> — competência ${comp}</p>
    <table><tr><th>Proventos</th><th class="r">Valor</th></tr>${prov.filter(([, v]) => Number(v)).map(([l, v]) => `<tr><td>${escapeHtml(l)}</td><td class="r">${money(v)}</td></tr>`).join('')}</table>
    <table><tr><th>Descontos</th><th class="r">Valor</th></tr>${desc.filter(([, v]) => Number(v)).map(([l, v]) => `<tr><td>${escapeHtml(l)}</td><td class="r">${money(v)}</td></tr>`).join('')}</table>
    <h2>Líquido: ${money(rec.net)}</h2><p class="muted">FGTS do mês: ${money(rec.fgts)}. Documento gerencial — não substitui o holerite emitido pela contabilidade.</p>`;
  return (
    <Modal title={`Demonstrativo — ${name}`} onClose={onClose} footer={<button className="btn-outline" onClick={() => printHTML('Demonstrativo', html)}>PDF / imprimir</button>}>
      <div className="grid gap-4 sm:grid-cols-2 text-sm">
        <Card title="Proventos">{prov.map(([l, v]) => <p key={l} className="flex justify-between gap-2"><span>{l}</span><span>{money(v)}</span></p>)}<p className="mt-2 flex justify-between font-semibold"><span>Bruto</span><span>{money(rec.gross)}</span></p></Card>
        <Card title="Descontos">{desc.map(([l, v]) => <p key={l} className="flex justify-between gap-2"><span>{l}</span><span>{money(v)}</span></p>)}<p className="mt-2 flex justify-between font-semibold"><span>Total</span><span>{money(rec.total_deductions)}</span></p></Card>
      </div>
      <p className="mt-4 text-xl font-bold">Líquido estimado: {money(rec.net)}</p>
      <p className="text-xs text-stone-500">Provisões: férias + 1/3 {money(rec.provision_vacation)} · 13º {money(rec.provision_13th)} · FGTS {money(rec.fgts)} · custo total {money(rec.employer_cost)}</p>
    </Modal>
  );
}
