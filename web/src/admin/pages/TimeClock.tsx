import { useCallback, useEffect, useState } from 'react';
import { supabase, rpc } from '../../lib/supabase';
import { minutesToHM, timeBR, dateBR, dateTimeBR, isoDate } from '../../lib/format';
import { Badge, Card, Field, Modal, PageHeader, PeriodPicker, Stat, Table, Tabs, exportCSV, presetPeriod, printHTML, escapeHtml, useToast } from '../ui';
import { useAuth } from '../auth';
import { RefName } from './Catalog';

const PT: Record<string, string> = { entrada: 'Entrada', intervalo_inicio: 'Início do intervalo', intervalo_fim: 'Fim do intervalo', saida: 'Saída' };
const REASON: Record<string, string> = { jornada: '', folga: 'Folga', feriado: 'Feriado', sem_jornada: 'Sem jornada', fora_contrato: '—', ferias: 'Férias', atestado: 'Atestado' };
const DEV_KEY = 'erp.timeclock.device'; // token do dispositivo autorizado (o registro em si fica no banco)

export default function TimeClock() {
  const { can } = useAuth();
  return (
    <div>
      <PageHeader title="Ponto eletrônico" subtitle="Marcações imutáveis com NSR e assinatura em cadeia. Correções só por solicitação justificada e aprovada." />
      <Tabs tabs={[
        { key: 'meu', label: 'Meu ponto', el: () => <MyClock /> },
        { key: 'espelho', label: 'Espelho de ponto', el: () => <Mirror /> },
        { key: 'ajustes', label: 'Ajustes', el: () => <Adjustments /> },
        { key: 'extras', label: 'Horas extras', el: () => <Overtime />, hidden: !can('timeclock.view') },
        { key: 'presenca', label: 'Quem está trabalhando', el: () => <Presence />, hidden: !can('timeclock.view') },
        { key: 'dispositivos', label: 'Dispositivos', el: () => <Devices />, hidden: !can('timeclock.manage') },
      ]} />
    </div>
  );
}

function MyClock() {
  const toast = useToast();
  const [st, setSt] = useState<any>(null); const [now, setNow] = useState(new Date()); const [busy, setBusy] = useState(false); const [bank, setBank] = useState<any>(null);
  const load = useCallback(() => rpc<any>('my_timeclock_status').then((s) => { setSt(s); if (s.linked) rpc('hour_bank_balance', { p_employee: s.employee_id }).then(setBank).catch(() => {}); }).catch((e) => toast(e.message, 'err')), [toast]);
  useEffect(() => { load(); const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, [load]);
  if (!st) return null;
  if (!st.linked) return <Card><p className="text-sm">Seu usuário ainda não está vinculado a um cadastro de funcionário. Peça ao RH para vincular em Funcionários → Usuário do sistema.</p></Card>;
  const allowed: string[] = st.next.allowed;
  let token: string | null = null; try { token = localStorage.getItem(DEV_KEY); } catch { /* */ }
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
      <Card>
        <p className="text-sm text-stone-500">{now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}</p>
        <p className="heading text-6xl tabular-nums">{now.toLocaleTimeString('pt-BR')}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {allowed.map((t) => <button key={t} disabled={busy} className={t === allowed[0] ? 'btn-primary px-6 py-4 text-lg' : 'btn-outline px-6 py-4 text-lg'} onClick={async () => {
            setBusy(true);
            try { const r = await rpc<any>('clock_punch', { p_type: t, p_device_token: token }); toast(`${PT[r.punch_type]} registrada às ${timeBR(r.punched_at)} (NSR ${r.nsr})`); load(); }
            catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
          }}>Registrar {PT[t].toLowerCase()}</button>)}
        </div>
        <p className="mt-3 text-xs text-stone-500">{token ? 'Este computador está autorizado para registro de ponto.' : 'Registro pelo painel do funcionário.'}</p>
      </Card>
      <Card title="Marcações recentes">
        <ul className="text-sm">{st.today.map((r: any) => <li key={r.id} className="flex justify-between border-b border-char/5 py-1.5"><span>{PT[r.punch_type]}</span><span className="tabular-nums">{dateBR(r.punched_at)} {timeBR(r.punched_at)} · NSR {r.nsr}</span></li>)}
          {!st.today.length && <li className="text-stone-500">Nenhuma marcação hoje.</li>}</ul>
        {bank?.enabled && <p className="mt-3 text-sm">Banco de horas: <b className={bank.balance_minutes < 0 ? 'text-red-700' : 'text-green-800'}>{minutesToHM(bank.balance_minutes)}</b></p>}
      </Card>
    </div>
  );
}

export function Mirror() {
  const { can, me } = useAuth(); const toast = useToast();
  const [emps, setEmps] = useState<any[]>([]); const [emp, setEmp] = useState(''); const [p, setP] = useState(presetPeriod('mes'));
  const [rows, setRows] = useState<any[]>([]); const [sum, setSum] = useState<any>(null); const [adj, setAdj] = useState<any | null>(null);
  useEffect(() => {
    if (can('timeclock.view')) supabase.from('employees').select('id,full_name,code').neq('status', 'desligado').order('full_name').then(({ data }) => setEmps(data ?? []));
    rpc<any>('my_timeclock_status').then((s) => s.linked && setEmp((e) => e || s.employee_id)).catch(() => {});
  }, [can]);
  const load = useCallback(() => {
    if (!emp) return;
    rpc<any[]>('timeclock_calc', { p_employee: emp, p_start: p.start, p_end: p.end }).then(setRows).catch((e) => toast(e.message, 'err'));
    rpc('timeclock_summary', { p_employee: emp, p_start: p.start, p_end: p.end }).then(setSum).catch(() => {});
  }, [emp, p, toast]);
  useEffect(() => { load(); }, [load]);
  const name = emps.find((e) => e.id === emp)?.full_name ?? me?.full_name ?? '';
  const exportRows = rows.map((r) => ({ Data: dateBR(r.work_date + 'T12:00'), Dia: ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][r.weekday],
    Marcações: r.punches.map((x: any) => timeBR(x.at)).join(' '), Previsto: minutesToHM(r.expected_minutes), Trabalhado: minutesToHM(r.worked_minutes), Intervalo: minutesToHM(r.break_minutes),
    Extras: minutesToHM(r.overtime_minutes), Atraso: minutesToHM(r.late_minutes), Débito: minutesToHM(r.deficit_minutes), Falta: r.absence ? 'sim' : '', Noturno: minutesToHM(r.night_minutes), Obs: REASON[r.day_reason] ?? r.day_reason }));
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {can('timeclock.view') && <select className="input w-auto py-2 text-sm" value={emp} onChange={(e) => setEmp(e.target.value)}><option value="">Funcionário…</option>{emps.map((e) => <option key={e.id} value={e.id}>{e.full_name} ({e.code})</option>)}</select>}
        <PeriodPicker value={p} onChange={setP} />
        <button className="btn-outline ml-auto py-2 text-sm" disabled={!rows.length} onClick={() => exportCSV(`espelho-ponto-${name}`, exportRows)}>Excel (CSV)</button>
        <button className="btn-outline py-2 text-sm" disabled={!rows.length} onClick={() => printHTML('Espelho de ponto', `<h1>Espelho de ponto</h1><p><b>${escapeHtml(name)}</b> — ${dateBR(p.start + 'T12:00')} a ${dateBR(p.end + 'T12:00')}</p>
          <table><tr>${Object.keys(exportRows[0]).map((k) => `<th>${k}</th>`).join('')}</tr>${exportRows.map((r) => `<tr>${Object.values(r).map((v) => `<td>${escapeHtml(v)}</td>`).join('')}</tr>`).join('')}</table>
          <p>Totais — previsto ${minutesToHM(sum?.expected_minutes)}, trabalhado ${minutesToHM(sum?.worked_minutes)}, extras ${minutesToHM(sum?.overtime_minutes)}, atrasos ${minutesToHM(sum?.late_minutes)}, faltas ${sum?.absences ?? 0}, saldo ${minutesToHM(sum?.balance_minutes)}</p>
          <br><br><p>_______________________________<br>Assinatura do funcionário</p><p class="muted">Gerado em ${dateTimeBR(new Date())}. Marcações com NSR e cadeia de hash verificável.</p>`)}>PDF / imprimir</button>
      </div>
      {sum && <div className="mb-3 grid grid-cols-3 gap-2 md:grid-cols-7">
        <Stat label="Previsto" value={minutesToHM(sum.expected_minutes)} /><Stat label="Trabalhado" value={minutesToHM(sum.worked_minutes)} />
        <Stat label="Extras" value={minutesToHM(sum.overtime_minutes)} sub={`50%: ${minutesToHM(sum.overtime_50_minutes)} · 100%: ${minutesToHM(sum.overtime_100_minutes)}`} />
        <Stat label="Atrasos" value={minutesToHM(sum.late_minutes)} tone={sum.late_minutes ? 'warn' : undefined} /><Stat label="Faltas" value={String(sum.absences)} tone={sum.absences ? 'bad' : undefined} />
        <Stat label="Noturno" value={minutesToHM(sum.night_minutes)} /><Stat label="Saldo" value={minutesToHM(sum.balance_minutes)} tone={sum.balance_minutes < 0 ? 'bad' : undefined} />
      </div>}
      <div className="rounded-md border border-char/10 bg-white dark:bg-stone-900"><Table rows={rows} rowKey="work_date" empty="Escolha o funcionário e o período." cols={[
        { key: 'work_date', label: 'Dia', render: (r) => <>{dateBR(r.work_date + 'T12:00')} <span className="text-stone-400">{['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][r.weekday]}</span></> },
        { key: 'punches', label: 'Marcações', render: (r) => <span className="tabular-nums">{r.punches.map((x: any) => <span key={x.id} title={`${PT[x.type]} · ${x.source} · NSR ${x.nsr}`} className={`mr-2 ${x.source === 'ajuste' ? 'underline decoration-dotted' : ''}`}>{timeBR(x.at)}</span>)}</span> },
        { key: 'expected_minutes', label: 'Previsto', align: 'right', render: (r) => r.expected_minutes ? minutesToHM(r.expected_minutes) : <span className="text-stone-400">{REASON[r.day_reason] ?? r.day_reason}</span> },
        { key: 'worked_minutes', label: 'Trabalhado', align: 'right', render: (r) => minutesToHM(r.worked_minutes) },
        { key: 'overtime_minutes', label: 'Extras', align: 'right', render: (r) => r.overtime_minutes ? <span className="text-green-800">{minutesToHM(r.overtime_minutes)} ({r.overtime_rate}%)</span> : '' },
        { key: 'late_minutes', label: 'Atraso', align: 'right', render: (r) => r.late_minutes ? <span className="text-amber-700">{minutesToHM(r.late_minutes)}</span> : '' },
        { key: 'deficit_minutes', label: 'Débito', align: 'right', render: (r) => r.deficit_minutes ? minutesToHM(r.deficit_minutes) : '' },
        { key: 'flags', label: '', render: (r) => <>{r.absence && <Badge tone="bad">Falta</Badge>} {r.incomplete && <Badge tone="warn">Incompleto</Badge>}</> },
        { key: 'a', label: '', align: 'right', render: (r) => <button className="text-xs underline" onClick={() => setAdj({ work_date: r.work_date, punches: r.punches })}>solicitar ajuste</button> },
      ]} /></div>
      {adj && <AdjustRequest emp={emp} day={adj} onClose={() => setAdj(null)} onDone={() => { setAdj(null); load(); }} />}
    </div>
  );
}

function AdjustRequest({ emp, day, onClose, onDone }: { emp: string; day: any; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [type, setType] = useState<'incluir' | 'alterar' | 'anular'>('incluir'); const [target, setTarget] = useState(''); const [ptype, setPtype] = useState('entrada');
  const [time, setTime] = useState(''); const [just, setJust] = useState('');
  return (
    <Modal title={`Solicitar ajuste — ${dateBR(day.work_date + 'T12:00')}`} onClose={onClose} footer={<><button className="btn-outline" onClick={onClose}>Cancelar</button>
      <button className="btn-primary" disabled={just.trim().length < 10} onClick={async () => {
        try {
          const at = time ? new Date(`${day.work_date}T${time}:00`).toISOString() : null;
          await rpc('request_time_adjustment', { p_employee: emp, p_type: type, p_work_date: day.work_date, p_punch_type: type === 'anular' ? null : ptype, p_requested_time: at, p_target: target || null, p_justification: just });
          toast('Solicitação enviada para aprovação'); onDone();
        } catch (e) { toast((e as Error).message, 'err'); }
      }}>Enviar solicitação</button></>}>
      <div className="grid gap-3">
        <Field label="O que deseja"><select className="input" value={type} onChange={(e) => setType(e.target.value as any)}><option value="incluir">Incluir marcação esquecida</option><option value="alterar">Corrigir horário de uma marcação</option><option value="anular">Anular marcação indevida</option></select></Field>
        {type !== 'incluir' && <Field label="Marcação"><select className="input" value={target} onChange={(e) => setTarget(e.target.value)}><option value="">—</option>{day.punches.map((x: any) => <option key={x.id} value={x.id}>{PT[x.type]} {timeBR(x.at)}</option>)}</select></Field>}
        {type !== 'anular' && <div className="grid grid-cols-2 gap-3"><Field label="Tipo"><select className="input" value={ptype} onChange={(e) => setPtype(e.target.value)}>{Object.entries(PT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Horário correto"><input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field></div>}
        <Field label="Justificativa (mín. 10 caracteres)"><textarea className="input min-h-[80px]" value={just} onChange={(e) => setJust(e.target.value)} /></Field>
        <p className="text-xs text-stone-500">A marcação original é preservada. O ajuste só vale após aprovação de um responsável.</p>
      </div>
    </Modal>
  );
}

function Adjustments() {
  const { can } = useAuth(); const toast = useToast();
  const [rows, setRows] = useState<any[]>([]); const [st, setSt] = useState('pendente');
  const load = useCallback(() => supabase.from('time_adjustments').select('*').eq('status', st).order('requested_at', { ascending: false }).limit(200).then(({ data }) => setRows(data ?? [])), [st]);
  useEffect(() => { load(); }, [load]);
  const review = async (id: string, ok: boolean) => {
    const notes = ok ? '' : prompt('Motivo da rejeição:') ?? ''; if (!ok && notes.length < 3) return;
    try { await rpc('review_time_adjustment', { p_id: id, p_approve: ok, p_notes: notes || null }); toast(ok ? 'Ajuste aprovado e aplicado' : 'Ajuste rejeitado'); load(); } catch (e) { toast((e as Error).message, 'err'); }
  };
  return (
    <div>
      <select className="input mb-3 w-auto py-2 text-sm" value={st} onChange={(e) => setSt(e.target.value)}><option value="pendente">Pendentes</option><option value="aprovado">Aprovados</option><option value="rejeitado">Rejeitados</option></select>
      <div className="rounded-md border border-char/10 bg-white dark:bg-stone-900"><Table rows={rows} empty="Nenhuma solicitação." cols={[
        { key: 'employee_id', label: 'Funcionário', render: (a) => <RefName table="employees" id={a.employee_id} col="full_name" /> },
        { key: 'work_date', label: 'Dia', render: (a) => dateBR(a.work_date + 'T12:00') }, { key: 'adjustment_type', label: 'Tipo' },
        { key: 'requested_time', label: 'Horário', render: (a) => a.requested_time ? `${PT[a.punch_type] ?? ''} ${timeBR(a.requested_time)}` : '—' },
        { key: 'justification', label: 'Justificativa', className: 'max-w-xs' }, { key: 'requested_at', label: 'Pedido em', render: (a) => dateTimeBR(a.requested_at) },
        { key: 'r', label: '', align: 'right', render: (a) => a.status === 'pendente' && can('timeclock.manage') ? <span className="flex justify-end gap-1">
          <button className="btn-outline px-2 py-1 text-xs" onClick={() => review(a.id, false)}>Rejeitar</button><button className="btn-primary px-2 py-1 text-xs" onClick={() => review(a.id, true)}>Aprovar</button></span> : a.review_notes ?? '' }]} /></div>
    </div>
  );
}

function Overtime() {
  const { can } = useAuth(); const toast = useToast();
  const [p, setP] = useState(presetPeriod('mes_anterior')); const [rows, setRows] = useState<any[]>([]); const [sel, setSel] = useState<string[]>([]);
  const load = useCallback(() => supabase.from('overtime_records').select('*').gte('work_date', p.start).lte('work_date', p.end).order('work_date').then(({ data }) => setRows(data ?? [])), [p]);
  useEffect(() => { load(); }, [load]);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2"><PeriodPicker value={p} onChange={setP} />
        {can('timeclock.manage') && <>
          <button className="btn-outline ml-auto py-2 text-sm" onClick={async () => { try { const n = await rpc<number>('generate_overtime_records', { p_start: p.start, p_end: p.end }); toast(`${n} dia(s) com hora extra apurados`); load(); } catch (e) { toast((e as Error).message, 'err'); } }}>Apurar horas extras do período</button>
          <button className="btn-outline py-2 text-sm" disabled={!sel.length} onClick={async () => { await rpc('review_overtime', { p_ids: sel, p_approve: true, p_destination: 'banco_horas' }); setSel([]); load(); }}>Aprovar → banco de horas</button>
          <button className="btn-primary py-2 text-sm" disabled={!sel.length} onClick={async () => { await rpc('review_overtime', { p_ids: sel, p_approve: true, p_destination: 'pagamento' }); setSel([]); load(); }}>Aprovar → pagamento</button></>}
      </div>
      <div className="rounded-md border border-char/10 bg-white dark:bg-stone-900"><Table rows={rows} cols={[
        { key: 's', label: '', render: (o) => o.status === 'pendente' ? <input type="checkbox" className="accent-red-600" checked={sel.includes(o.id)} onChange={(e) => setSel(e.target.checked ? [...sel, o.id] : sel.filter((x) => x !== o.id))} /> : null },
        { key: 'employee_id', label: 'Funcionário', render: (o) => <RefName table="employees" id={o.employee_id} col="full_name" /> }, { key: 'work_date', label: 'Dia', render: (o) => dateBR(o.work_date + 'T12:00') },
        { key: 'minutes', label: 'Horas', align: 'right', render: (o) => minutesToHM(o.minutes) }, { key: 'rate_percent', label: 'Adicional', align: 'right', render: (o) => `${o.rate_percent}%` },
        { key: 'destination', label: 'Destino' }, { key: 'status', label: 'Status', render: (o) => <Badge tone={o.status === 'aprovado' ? 'good' : o.status === 'rejeitado' ? 'bad' : 'warn'}>{o.status}</Badge> }]} /></div>
    </div>
  );
}

function Presence() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { rpc<any[]>('employees_presence').then(setRows).catch(() => {}); }, []);
  const T: Record<string, any> = { trabalhando: ['Trabalhando', 'good'], intervalo: ['Em intervalo', 'info'], ausente: ['Ausente', 'bad'], fora_do_turno: ['Fora do turno', 'neutral'], ferias: ['Férias', 'neutral'], afastado: ['Afastado', 'neutral'] };
  return <div className="rounded-md border border-char/10 bg-white dark:bg-stone-900"><Table rows={rows} rowKey="employee_id" cols={[{ key: 'full_name', label: 'Funcionário' }, { key: 'department', label: 'Departamento' },
    { key: 'state', label: 'Situação', render: (x) => <Badge tone={T[x.state]?.[1]}>{T[x.state]?.[0] ?? x.state}</Badge> }, { key: 'since', label: 'Última marcação', render: (x) => dateTimeBR(x.since) }]} /></div>;
}

function Devices() {
  const toast = useToast();
  const [rows, setRows] = useState<any[]>([]); const [name, setName] = useState(''); const [type, setType] = useState('tablet_compartilhado'); const [token, setToken] = useState<string | null>(null);
  const [chain, setChain] = useState<any>(null);
  const load = useCallback(() => supabase.from('time_clock_devices').select('*').order('created_at').then(({ data }) => setRows(data ?? [])), []);
  useEffect(() => { load(); }, [load]);
  let mine: string | null = null; try { mine = localStorage.getItem(DEV_KEY); } catch { /* */ }
  return (
    <div className="space-y-4">
      <Card title="Autorizar novo dispositivo">
        <div className="flex flex-wrap gap-2"><input className="input w-64" placeholder="Nome (ex.: Tablet da entrada)" value={name} onChange={(e) => setName(e.target.value)} />
          <select className="input w-auto" value={type} onChange={(e) => setType(e.target.value)}><option value="tablet_compartilhado">Tablet compartilhado (quiosque)</option><option value="computador">Computador autorizado</option></select>
          <button className="btn-primary" disabled={!name} onClick={async () => { try { const r = await rpc<any>('register_timeclock_device', { p_name: name, p_type: type }); setToken(r.token); setName(''); load(); } catch (e) { toast((e as Error).message, 'err'); } }}>Gerar token</button></div>
        {token && <div className="mt-3 border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-char">
          <p><b>Token (exibido uma única vez):</b> <code className="break-all">{token}</code></p>
          <p className="mt-1">Quiosque: abra <code>{location.origin}/ponto</code> no tablet e cole o token. Computador: clique abaixo neste computador.</p>
          <button className="btn-dark mt-2 py-1.5 text-sm" onClick={() => { try { localStorage.setItem(DEV_KEY, token); toast('Este computador agora registra ponto como dispositivo autorizado'); } catch { /* */ } }}>Autorizar ESTE computador</button></div>}
        {mine && <p className="mt-2 text-xs text-stone-500">Este navegador está configurado como dispositivo autorizado. <button className="underline" onClick={() => { localStorage.removeItem(DEV_KEY); toast('Autorização removida deste navegador'); }}>remover</button></p>}
      </Card>
      <div className="rounded-md border border-char/10 bg-white dark:bg-stone-900"><Table rows={rows} cols={[{ key: 'name', label: 'Dispositivo' }, { key: 'device_type', label: 'Tipo' },
        { key: 'last_used_at', label: 'Último uso', render: (d) => dateTimeBR(d.last_used_at) }, { key: 'is_active', label: '', render: (d) => <button className="text-xs underline" onClick={async () => { await supabase.from('time_clock_devices').update({ is_active: !d.is_active }).eq('id', d.id); load(); }}>{d.is_active ? 'desativar' : 'reativar'}</button> }]} /></div>
      <Card title="Integridade das marcações">
        <button className="btn-outline" onClick={() => rpc('timeclock_verify_chain').then(setChain).catch((e) => toast(e.message, 'err'))}>Verificar cadeia de assinaturas</button>
        {chain && <p className={`mt-2 text-sm ${chain.ok ? 'text-green-800' : 'text-red-700'}`}>{chain.ok ? `Íntegra: ${chain.total} marcações verificadas.` : `${chain.invalid} marcação(ões) inválidas a partir do NSR ${chain.first_invalid_nsr}.`}</p>}
      </Card>
    </div>
  );
}

export { isoDate };
