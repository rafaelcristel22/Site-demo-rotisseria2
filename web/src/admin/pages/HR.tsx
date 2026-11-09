import { useEffect, useState } from 'react';
import { supabase, rpc } from '../../lib/supabase';
import { money, dateBR } from '../../lib/format';
import Crud, { r, type FieldDef } from '../Crud';
import { Badge, Card, Modal, PageHeader, Tabs, useToast, Field } from '../ui';
import { useAuth } from '../auth';
import { RefName } from './Catalog';

const ST: Record<string, any> = { ativo: ['Ativo', 'good'], ferias: ['Férias', 'info'], afastado: ['Afastado', 'warn'], desligado: ['Desligado', 'neutral'] };
const LEAVE: Record<string, string> = { ferias: 'Férias', atestado: 'Atestado médico', licenca_maternidade: 'Licença-maternidade', licenca_paternidade: 'Licença-paternidade',
  afastamento_inss: 'Afastamento INSS', falta_justificada: 'Falta justificada', falta_injustificada: 'Falta injustificada', folga: 'Folga', suspensao: 'Suspensão', outro: 'Outro' };

const employeeFields: FieldDef[] = [
  { name: 'full_name', label: 'Nome completo', required: true }, { name: 'code', label: 'Matrícula (usada no ponto)', required: true },
  { name: 'photo_url', label: 'Foto', type: 'image', bucket: 'company-assets', wide: true },
  { name: 'cpf', label: 'CPF (somente números)' }, { name: 'rg', label: 'RG' }, { name: 'birth_date', label: 'Nascimento', type: 'date' },
  { name: 'phone', label: 'Telefone', type: 'tel' }, { name: 'email', label: 'E-mail', type: 'email' },
  { name: 'address', label: 'Endereço (JSON: street, number, district, city, zip)', type: 'json' },
  { name: 'department_id', label: 'Departamento', type: 'ref', ref: { table: 'departments', label: 'name' } },
  { name: 'position_id', label: 'Cargo', type: 'ref', ref: { table: 'positions', label: 'name' } },
  { name: 'schedule_id', label: 'Jornada / escala', type: 'ref', ref: { table: 'schedules', label: 'name' } },
  { name: 'hire_date', label: 'Admissão', type: 'date', required: true }, { name: 'termination_date', label: 'Desligamento', type: 'date' },
  { name: 'contract_type', label: 'Contrato', type: 'select', default: 'clt', options: ['clt', 'experiencia', 'temporario', 'intermitente', 'estagio', 'pj', 'autonomo'].map((x) => ({ value: x, label: x })) },
  { name: 'salary', label: 'Salário (R$)', type: 'money', required: true, hint: 'Alterações ficam no histórico salarial' },
  { name: 'salary_type', label: 'Tipo de salário', type: 'select', default: 'mensal', options: [{ value: 'mensal', label: 'Mensal' }, { value: 'horista', label: 'Por hora' }, { value: 'diarista', label: 'Por dia' }] },
  { name: 'commission_percent', label: 'Comissão sobre vendas (%)', type: 'number', default: 0 }, { name: 'dependents', label: 'Dependentes (IRRF)', type: 'number', default: 0 },
  { name: 'status', label: 'Situação', type: 'select', default: 'ativo', options: Object.entries(ST).map(([value, v]) => ({ value, label: v[0] })) },
  { name: 'pis', label: 'PIS' }, { name: 'ctps', label: 'CTPS' },
  { name: 'user_id', label: 'Usuário do sistema (login)', type: 'ref', ref: { table: 'users', label: 'full_name' } },
  { name: 'emergency_contact', label: 'Contato de emergência (JSON: name, phone, relationship)', type: 'json' },
  { name: 'notes', label: 'Observações', type: 'textarea' },
];

export default function HR() {
  const { can } = useAuth();
  const empRef = { table: 'employees', label: 'full_name' };
  return (
    <div>
      <PageHeader title="Recursos humanos" subtitle="Funcionários, cargos, jornadas, férias, afastamentos, ocorrências, treinamentos e calendário." />
      <Tabs tabs={[
        { key: 'func', label: 'Funcionários', el: () => <Crud cfg={{ table: 'employees', title: 'Funcionários', perm: 'hr.manage', embedded: true, order: 'full_name.asc', search: ['full_name', 'code', 'cpf'],
          fields: employeeFields, columns: [
            { key: 'full_name', label: 'Nome', render: (e) => <span className="flex items-center gap-2">{e.photo_url && <img src={e.photo_url} alt="" className="h-7 w-7 rounded-full object-cover" />}<b>{e.full_name}</b></span> },
            { key: 'code', label: 'Matrícula' }, { key: 'department_id', label: 'Departamento', render: (e) => <RefName table="departments" id={e.department_id} /> },
            { key: 'position_id', label: 'Cargo', render: (e) => <RefName table="positions" id={e.position_id} /> },
            { key: 'hire_date', label: 'Admissão', render: (e) => dateBR(e.hire_date + 'T12:00') },
            ...(can('payroll.view') ? [{ key: 'salary', label: 'Salário', align: 'right' as const, render: (e: any) => money(e.salary) }] : []),
            { key: 'status', label: 'Situação', render: (e) => <Badge tone={ST[e.status][1]}>{ST[e.status][0]}</Badge> }],
          rowActions: (e) => <EmployeeExtras emp={e} /> }} /> },
        { key: 'ferias', label: 'Férias e afastamentos', el: () => <Crud cfg={{ table: 'employee_leaves', title: 'Férias e afastamentos', perm: 'hr.manage', embedded: true, order: 'start_date.desc',
          fields: [{ name: 'employee_id', label: 'Funcionário', type: 'ref', ref: empRef, required: true },
            { name: 'leave_type', label: 'Tipo', type: 'select', options: Object.entries(LEAVE).map(([value, label]) => ({ value, label })), required: true },
            { name: 'start_date', label: 'Início', type: 'date', required: true }, { name: 'end_date', label: 'Fim', type: 'date', required: true },
            { name: 'acquisition_start', label: 'Período aquisitivo — início', type: 'date' }, { name: 'acquisition_end', label: 'Período aquisitivo — fim', type: 'date' },
            { name: 'sell_days', label: 'Dias vendidos (abono)', type: 'number', default: 0 }, { name: 'paid', label: 'Remunerado', type: 'bool', default: true },
            { name: 'status', label: 'Status', type: 'select', default: 'aprovado', options: ['solicitado', 'aprovado', 'rejeitado', 'cancelado', 'concluido'].map((x) => ({ value: x, label: x })) },
            { name: 'notes', label: 'Observações', type: 'textarea' }],
          columns: [{ key: 'employee_id', label: 'Funcionário', render: (x) => <RefName table="employees" id={x.employee_id} col="full_name" /> }, { key: 'leave_type', label: 'Tipo', render: r.label(LEAVE, 'leave_type') },
            { key: 'start_date', label: 'Período', render: (x) => `${dateBR(x.start_date + 'T12:00')} a ${dateBR(x.end_date + 'T12:00')}` }, { key: 'days', label: 'Dias', align: 'right' },
            { key: 'status', label: 'Status', render: (x) => <Badge tone={x.status === 'aprovado' ? 'good' : x.status === 'solicitado' ? 'warn' : 'neutral'}>{x.status}</Badge> }] }} /> },
        { key: 'ocorr', label: 'Ocorrências', el: () => <Crud cfg={{ table: 'employee_occurrences', title: 'Ocorrências', perm: 'hr.manage', embedded: true, order: 'occurred_on.desc',
          fields: [{ name: 'employee_id', label: 'Funcionário', type: 'ref', ref: empRef, required: true },
            { name: 'occurrence_type', label: 'Tipo', type: 'select', required: true, options: [{ value: 'advertencia_verbal', label: 'Advertência verbal' }, { value: 'advertencia_escrita', label: 'Advertência escrita' },
              { value: 'suspensao', label: 'Suspensão' }, { value: 'elogio', label: 'Elogio' }, { value: 'ocorrencia', label: 'Ocorrência' }, { value: 'acidente', label: 'Acidente de trabalho' }] },
            { name: 'occurred_on', label: 'Data', type: 'date', required: true }, { name: 'description', label: 'Descrição', type: 'textarea', required: true }, { name: 'acknowledged', label: 'Ciência do funcionário', type: 'bool' }],
          columns: [{ key: 'occurred_on', label: 'Data', render: (x) => dateBR(x.occurred_on + 'T12:00') }, { key: 'employee_id', label: 'Funcionário', render: (x) => <RefName table="employees" id={x.employee_id} col="full_name" /> },
            { key: 'occurrence_type', label: 'Tipo' }, { key: 'description', label: 'Descrição' }] }} /> },
        { key: 'aval', label: 'Avaliações', el: () => <Crud cfg={{ table: 'employee_evaluations', title: 'Avaliações', perm: 'hr.manage', embedded: true, order: 'evaluated_on.desc',
          fields: [{ name: 'employee_id', label: 'Funcionário', type: 'ref', ref: empRef, required: true }, { name: 'period_label', label: 'Período (ex.: 2026-S2)', required: true },
            { name: 'scores', label: 'Notas 1 a 5 (JSON)', type: 'json', default: { pontualidade: 3, qualidade: 3, trabalho_em_equipe: 3, higiene: 3, atendimento: 3 } },
            { name: 'strengths', label: 'Pontos fortes', type: 'textarea' }, { name: 'improvements', label: 'A melhorar', type: 'textarea' }, { name: 'goals', label: 'Metas', type: 'textarea' }],
          columns: [{ key: 'evaluated_on', label: 'Data', render: (x) => dateBR(x.evaluated_on + 'T12:00') }, { key: 'employee_id', label: 'Funcionário', render: (x) => <RefName table="employees" id={x.employee_id} col="full_name" /> },
            { key: 'period_label', label: 'Período' }, { key: 'overall_score', label: 'Nota', align: 'right' }] }} /> },
        { key: 'trein', label: 'Treinamentos', el: () => <div className="space-y-4">
          <Crud cfg={{ table: 'trainings', title: 'Treinamentos', perm: 'hr.manage', embedded: true, order: 'title.asc',
            fields: [{ name: 'title', label: 'Treinamento', required: true }, { name: 'description', label: 'Descrição', type: 'textarea' }, { name: 'is_mandatory', label: 'Obrigatório', type: 'bool' }, { name: 'validity_months', label: 'Validade (meses)', type: 'number' }],
            columns: [{ key: 'title', label: 'Treinamento' }, { key: 'is_mandatory', label: 'Obrigatório', render: r.bool('is_mandatory') }, { key: 'validity_months', label: 'Validade (meses)' }] }} />
          <Crud cfg={{ table: 'employee_trainings', title: 'Participações', perm: 'hr.manage', embedded: true, order: 'completed_on.desc',
            fields: [{ name: 'employee_id', label: 'Funcionário', type: 'ref', ref: empRef, required: true }, { name: 'training_id', label: 'Treinamento', type: 'ref', ref: { table: 'trainings', label: 'title' }, required: true },
              { name: 'completed_on', label: 'Concluído em', type: 'date' }, { name: 'expires_on', label: 'Vence em', type: 'date' }, { name: 'status', label: 'Status', type: 'select', default: 'concluido', options: ['pendente', 'concluido', 'vencido'].map((x) => ({ value: x, label: x })) }],
            columns: [{ key: 'employee_id', label: 'Funcionário', render: (x) => <RefName table="employees" id={x.employee_id} col="full_name" /> }, { key: 'training_id', label: 'Treinamento', render: (x) => <RefName table="trainings" id={x.training_id} col="title" /> },
              { key: 'completed_on', label: 'Concluído', render: (x) => x.completed_on ? dateBR(x.completed_on + 'T12:00') : '—' }, { key: 'expires_on', label: 'Vence', render: (x) => x.expires_on ? dateBR(x.expires_on + 'T12:00') : '—' }] }} />
        </div> },
        { key: 'cal', label: 'Calendário', el: () => <Calendar /> },
        { key: 'escalas', label: 'Escalas do dia', el: () => <Crud cfg={{ table: 'shift_assignments', title: 'Escalas', perm: 'hr.manage', embedded: true, order: 'work_date.desc',
          fields: [{ name: 'employee_id', label: 'Funcionário', type: 'ref', ref: empRef, required: true }, { name: 'work_date', label: 'Dia', type: 'date', required: true },
            { name: 'start_time', label: 'Entrada', type: 'time' }, { name: 'end_time', label: 'Saída', type: 'time' }, { name: 'break_minutes', label: 'Intervalo (min)', type: 'number', default: 60 },
            { name: 'is_day_off', label: 'Folga neste dia', type: 'bool' }, { name: 'notes', label: 'Observação' }],
          columns: [{ key: 'work_date', label: 'Dia', render: (x) => dateBR(x.work_date + 'T12:00') }, { key: 'employee_id', label: 'Funcionário', render: (x) => <RefName table="employees" id={x.employee_id} col="full_name" /> },
            { key: 'start_time', label: 'Horário', render: (x) => x.is_day_off ? 'Folga' : `${x.start_time?.slice(0, 5)}–${x.end_time?.slice(0, 5)}` }] }} /> },
        { key: 'deps', label: 'Departamentos', el: () => <Crud cfg={{ table: 'departments', title: 'Departamentos', perm: 'hr.manage', embedded: true, order: 'name.asc',
          fields: [{ name: 'code', label: 'Código', required: true }, { name: 'name', label: 'Nome', required: true }, { name: 'description', label: 'Descrição' }, { name: 'is_active', label: 'Ativo', type: 'bool', default: true }],
          columns: [{ key: 'code', label: 'Código' }, { key: 'name', label: 'Departamento' }, { key: 'is_active', label: '', render: r.active }] }} /> },
        { key: 'cargos', label: 'Cargos', el: () => <Crud cfg={{ table: 'positions', title: 'Cargos', perm: 'hr.manage', embedded: true, order: 'name.asc',
          fields: [{ name: 'name', label: 'Cargo', required: true }, { name: 'department_id', label: 'Departamento', type: 'ref', ref: { table: 'departments', label: 'name' } },
            { name: 'cbo', label: 'CBO' }, { name: 'base_salary', label: 'Salário-base de referência', type: 'money' }, { name: 'description', label: 'Atribuições', type: 'textarea' }],
          columns: [{ key: 'name', label: 'Cargo' }, { key: 'department_id', label: 'Departamento', render: (x) => <RefName table="departments" id={x.department_id} /> }, { key: 'base_salary', label: 'Salário-base', align: 'right', render: r.money('base_salary') }] }} /> },
        { key: 'jornadas', label: 'Jornadas', el: () => <Crud cfg={{ table: 'schedules', title: 'Jornadas', perm: 'hr.manage', embedded: true, order: 'name.asc',
          fields: [{ name: 'name', label: 'Nome', required: true }, { name: 'schedule_type', label: 'Tipo', type: 'select', default: 'semanal', options: [{ value: 'semanal', label: 'Semanal' }, { value: '12x36', label: '12x36' }, { value: 'personalizada', label: 'Personalizada' }] },
            { name: 'days', label: 'Dias da semana (0=dom … 6=sáb) — JSON {"1":{"start":"08:00","end":"17:00","break_minutes":60}}', type: 'json', default: {} },
            { name: 'cycle_reference_date', label: '12x36: um dia trabalhado de referência', type: 'date' }, { name: 'cycle_start', label: '12x36: entrada', type: 'time' }, { name: 'cycle_end', label: '12x36: saída', type: 'time' },
            { name: 'min_break_minutes', label: 'Intervalo mínimo (min)', type: 'number', default: 60 }, { name: 'notes', label: 'Observações', type: 'textarea' }],
          columns: [{ key: 'name', label: 'Jornada' }, { key: 'schedule_type', label: 'Tipo' }] }} /> },
        { key: 'feriados', label: 'Feriados', el: () => <Crud cfg={{ table: 'holidays', title: 'Feriados', perm: 'hr.manage', embedded: true, order: 'day.asc',
          fields: [{ name: 'day', label: 'Data', type: 'date', required: true }, { name: 'name', label: 'Nome', required: true }, { name: 'is_national', label: 'Nacional', type: 'bool', default: true }],
          columns: [{ key: 'day', label: 'Data', render: (x) => dateBR(x.day + 'T12:00') }, { key: 'name', label: 'Feriado' }] }} /> },
      ]} />
    </div>
  );
}

function EmployeeExtras({ emp }: { emp: any }) {
  const toast = useToast(); const { can } = useAuth();
  const [open, setOpen] = useState(false); const [vac, setVac] = useState<any>(null); const [hist, setHist] = useState<any[]>([]); const [pin, setPin] = useState('');
  useEffect(() => { if (open) {
    rpc('vacation_balance', { p_employee: emp.id }).then(setVac).catch(() => {});
    supabase.from('employee_salary_history').select('*').eq('employee_id', emp.id).order('effective_date').then(({ data }) => setHist(data ?? []));
  } }, [open, emp.id]);
  return <>
    <button className="btn-outline px-2 py-1 text-xs" onClick={() => setOpen(true)}>Ficha</button>
    {open && <Modal title={emp.full_name} onClose={() => setOpen(false)} wide>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Férias (CLT)">{vac ? <dl className="space-y-1 text-sm">
          <div className="flex justify-between"><dt>Meses trabalhados</dt><dd>{vac.months_worked}</dd></div>
          <div className="flex justify-between"><dt>Dias adquiridos</dt><dd>{vac.days_earned}</dd></div>
          <div className="flex justify-between"><dt>Dias gozados/vendidos</dt><dd>{vac.days_taken}</dd></div>
          <div className="flex justify-between font-semibold"><dt>Saldo</dt><dd>{vac.days_available} dias</dd></div>
          <div className="flex justify-between text-stone-500"><dt>Proporcional em curso</dt><dd>{vac.proportional_days} dias</dd></div>
          <div className="flex justify-between text-stone-500"><dt>Próximo período completo</dt><dd>{dateBR(vac.next_period_complete_on + 'T12:00')}</dd></div></dl> : '…'}</Card>
        <Card title="PIN do ponto (quiosque)">
          <p className="mb-2 text-sm text-stone-500">Matrícula <b>{emp.code}</b>. O PIN é guardado criptografado.</p>
          {can('hr.manage') || can('timeclock.manage') ? <div className="flex gap-2"><input className="input" type="password" inputMode="numeric" placeholder="4 a 8 dígitos" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
            <button className="btn-dark" disabled={pin.length < 4} onClick={async () => { try { await rpc('set_employee_pin', { p_employee: emp.id, p_pin: pin }); toast('PIN definido'); setPin(''); } catch (e) { toast((e as Error).message, 'err'); } }}>Definir</button></div> : null}
        </Card>
        {can('payroll.view') && <Card title="Histórico salarial" className="md:col-span-2"><ul className="text-sm">{hist.map((h) => <li key={h.id} className="flex justify-between border-b border-char/5 py-1">
          <span>{dateBR(h.effective_date + 'T12:00')} — {h.reason}</span><span>{h.old_salary != null ? `${money(h.old_salary)} → ` : ''}<b>{money(h.new_salary)}</b></span></li>)}</ul></Card>}
      </div>
    </Modal>}
  </>;
}

function Calendar() {
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [ev, setEv] = useState<any[]>([]);
  useEffect(() => {
    const end = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    rpc<any[]>('hr_calendar', { p_start: month.toISOString().slice(0, 10), p_end: end.toISOString().slice(0, 10) }).then(setEv).catch(() => {});
  }, [month]);
  const first = month.getDay(); const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const on = (d: number) => {
    const iso = new Date(month.getFullYear(), month.getMonth(), d, 12).toISOString().slice(0, 10);
    return ev.filter((e) => e.event_date === iso || (e.end_date && e.event_date <= iso && e.end_date >= iso));
  };
  return (
    <Card title={month.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })} actions={<span className="flex gap-1">
      <button className="btn-outline px-2 py-1 text-xs" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button>
      <button className="btn-outline px-2 py-1 text-xs" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button></span>}>
      <div className="grid grid-cols-7 gap-px bg-char/10 text-xs">
        {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d) => <div key={d} className="bg-white p-1 text-center font-semibold dark:bg-stone-900">{d}</div>)}
        {cells.map((d, i) => <div key={i} className="min-h-[84px] bg-white p-1 dark:bg-stone-900">{d && <><p className="font-semibold">{d}</p>
          {on(d).map((e, j) => <p key={j} className={`mt-0.5 truncate rounded px-1 ${e.event_type === 'feriado' ? 'bg-red-100 text-red-900' : e.event_type === 'aniversario' ? 'bg-amber-100 text-amber-900' : e.event_type === 'ferias' ? 'bg-sky-100 text-sky-900' : 'bg-stone-100 text-stone-700'}`} title={e.title}>{e.title}</p>)}</>}</div>)}
      </div>
    </Card>
  );
}

export { Field };
