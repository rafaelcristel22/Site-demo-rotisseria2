import { useCallback, useEffect, useState } from 'react';
import { supabase, rpc, cleanError } from '../../lib/supabase';
import { dateBR } from '../../lib/format';
import Crud, { FieldInput, ImageInput, r, type FieldDef } from '../Crud';
import { Badge, Card, Field, Modal, PageHeader, Table, Tabs, useToast } from '../ui';
import { useAuth } from '../auth';
import { printHTML } from '../ui';
import { EscPos, sendSerial } from '../../lib/escpos';

const DAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export default function Settings() {
  const { can } = useAuth();
  return (
    <div>
      <PageHeader title="Configurações" subtitle="Empresa, regras de funcionamento, usuários, permissões, pagamentos, impressoras e tabelas da folha." />
      <Tabs tabs={[
        { key: 'empresa', label: 'Empresa e horários', el: () => <Company section="empresa" /> },
        { key: 'regras', label: 'Regras (PDV, site, ponto)', el: () => <Company section="regras" /> },
        { key: 'usuarios', label: 'Usuários', el: () => <Users />, hidden: !can('users.manage') },
        { key: 'permissoes', label: 'Papéis e permissões', el: () => <Roles /> },
        { key: 'pagamentos', label: 'Formas de pagamento', el: () => <Crud cfg={{ table: 'payment_methods', pk: 'code', title: 'Formas de pagamento', perm: 'settings.manage', embedded: true, order: 'sort_order.asc',
          fields: [{ name: 'code', label: 'Código (não altere após criar)', required: true }, { name: 'name', label: 'Nome', required: true },
            { name: 'method_type', label: 'Tipo', type: 'select', required: true, options: ['dinheiro', 'pix', 'credito', 'debito', 'vale', 'credito_interno', 'outro'].map((x) => ({ value: x, label: x })) },
            { name: 'account_id', label: 'Conta financeira de destino', type: 'ref', ref: { table: 'financial_accounts', label: 'name' } },
            { name: 'fee_percent', label: 'Taxa (%)', type: 'number', default: 0 }, { name: 'fee_fixed', label: 'Taxa fixa (R$)', type: 'money', default: 0 },
            { name: 'settlement_days', label: 'Prazo de repasse (dias)', type: 'number', default: 0, hint: '> 0 gera conta a receber' },
            { name: 'allows_change', label: 'Permite troco', type: 'bool' }, { name: 'available_pos', label: 'No PDV', type: 'bool', default: true },
            { name: 'available_online', label: 'No site', type: 'bool', default: true }, { name: 'is_active', label: 'Ativa', type: 'bool', default: true }, { name: 'sort_order', label: 'Ordem', type: 'number', default: 0 }],
          columns: [{ key: 'name', label: 'Forma' }, { key: 'method_type', label: 'Tipo' }, { key: 'fee_percent', label: 'Taxa', align: 'right', render: (m) => `${m.fee_percent}%` },
            { key: 'settlement_days', label: 'Repasse', align: 'right', render: (m) => `${m.settlement_days} d` }, { key: 'is_active', label: '', render: r.active }] }} /> },
        { key: 'impressoras', label: 'Impressoras e equipamentos', el: () => <Printers /> },
        { key: 'folha', label: 'Tabelas da folha', el: () => <Company section="folha" /> },
      ]} />
    </div>
  );
}

const SECTIONS: Record<string, FieldDef[]> = {
  empresa: [
    { name: 'trade_name', label: 'Nome fantasia', required: true }, { name: 'legal_name', label: 'Razão social' }, { name: 'cnpj', label: 'CNPJ' }, { name: 'state_registration', label: 'Inscrição estadual' },
    { name: 'phone', label: 'Telefone' }, { name: 'whatsapp', label: 'WhatsApp' }, { name: 'email', label: 'E-mail', type: 'email' },
    { name: 'address', label: 'Endereço (JSON: street, number, district, city, state, zip)', type: 'json' },
    { name: 'primary_color', label: 'Cor principal', type: 'color' }, { name: 'secondary_color', label: 'Cor secundária', type: 'color' },
    { name: 'timezone', label: 'Fuso horário', default: 'America/Sao_Paulo' }, { name: 'receipt_footer', label: 'Rodapé do comprovante' },
    { name: 'privacy_policy_text', label: 'Texto de privacidade (site)', type: 'textarea' }, { name: 'privacy_policy_url', label: 'URL da política de privacidade' },
  ],
  regras: [
    { name: 'online_ordering_enabled', label: 'Pedidos pelo site ativos', type: 'bool' }, { name: 'delivery_enabled', label: 'Entrega', type: 'bool' }, { name: 'pickup_enabled', label: 'Retirada', type: 'bool' },
    { name: 'scheduling_enabled', label: 'Agendamento', type: 'bool' }, { name: 'scheduling_max_days', label: 'Agendar até (dias)', type: 'number' },
    { name: 'min_order_value', label: 'Pedido mínimo do site (R$)', type: 'money' }, { name: 'avg_prep_minutes', label: 'Tempo médio de preparo (min)', type: 'number' },
    { name: 'kitchen_alert_minutes', label: 'Alerta de atraso na cozinha (min)', type: 'number' }, { name: 'delivery_alert_minutes', label: 'Alerta de atraso na entrega (min)', type: 'number' },
    { name: 'pos_max_discount_without_auth', label: 'Desconto máximo sem autorização (%)', type: 'number' },
    { name: 'pos_require_pin_for_cancel', label: 'Cancelamento exige PIN de responsável', type: 'bool' }, { name: 'pos_require_pin_for_withdrawal', label: 'Sangria exige PIN', type: 'bool' },
    { name: 'timeclock_tolerance_per_mark_min', label: 'Ponto: tolerância por marcação (min)', type: 'number', hint: 'CLT art. 58 §1º: 5 min' },
    { name: 'timeclock_tolerance_daily_min', label: 'Ponto: tolerância diária (min)', type: 'number', hint: 'CLT: 10 min' },
    { name: 'timeclock_min_interval_seconds', label: 'Ponto: intervalo mínimo entre marcações (s)', type: 'number' },
    { name: 'timeclock_require_authorized_device', label: 'Ponto só em dispositivo autorizado', type: 'bool' },
    { name: 'overtime_rate_weekday', label: 'Hora extra dia útil (%)', type: 'number' }, { name: 'overtime_rate_sunday_holiday', label: 'Hora extra domingo/feriado (%)', type: 'number' },
    { name: 'hour_bank_enabled', label: 'Banco de horas (acordo/convenção)', type: 'bool' }, { name: 'hour_bank_start_date', label: 'Início do banco de horas', type: 'date' },
    { name: 'night_shift_start', label: 'Noturno: início', type: 'time' }, { name: 'night_shift_end', label: 'Noturno: fim', type: 'time' }, { name: 'night_shift_rate', label: 'Adicional noturno (%)', type: 'number' },
    { name: 'loyalty_enabled', label: 'Programa de fidelidade', type: 'bool' }, { name: 'loyalty_points_per_real', label: 'Pontos por R$ 1', type: 'number' },
    { name: 'loyalty_real_per_point', label: 'Valor de cada ponto no resgate (R$)', type: 'number', step: '0.0001' }, { name: 'loyalty_min_redeem_points', label: 'Mínimo de pontos para resgatar', type: 'number' },
    { name: 'ai_enabled', label: 'Assistente de IA habilitado', type: 'bool' },
  ],
  folha: [
    { name: 'payroll_monthly_hours', label: 'Divisor de horas mensais', type: 'number', hint: '220 para 44h semanais' }, { name: 'payroll_fgts_rate', label: 'FGTS (%)', type: 'number' },
    { name: 'payroll_dsr_on_overtime', label: 'Calcular DSR sobre horas extras', type: 'bool' },
    { name: 'payroll_tax_tables', label: 'Tabelas INSS/IRRF (JSON) — confirme a vigência com a contabilidade', type: 'json' },
  ],
};

function Company({ section }: { section: string }) {
  const toast = useToast(); const { can } = useAuth();
  const [d, setD] = useState<any>(null);
  useEffect(() => { supabase.from('company_settings').select('*').eq('id', 1).maybeSingle().then(({ data }) => setD(data)); }, []);
  if (!d) return null;
  const fields = SECTIONS[section]; const editable = can('settings.manage');
  async function save() {
    const patch: any = {};
    for (const f of fields) {
      let v = d[f.name];
      if (f.type === 'json' && typeof v === 'string') { try { v = JSON.parse(v); } catch { return toast(`${f.label}: JSON inválido`, 'err'); } }
      if ((f.type === 'number' || f.type === 'money') && v !== null && v !== '') v = Number(v);
      if (v === '') v = null;
      patch[f.name] = v;
    }
    if (section === 'empresa') { patch.opening_hours = d.opening_hours; patch.logo_url = d.logo_url; }
    const { error } = await supabase.from('company_settings').update(patch).eq('id', 1);
    if (error) toast(cleanError(error.message), 'err'); else toast('Configurações salvas');
  }
  return (
    <div className="space-y-4">
      {section === 'empresa' && <Card title="Logotipo"><ImageInput value={d.logo_url} onChange={(v) => setD({ ...d, logo_url: v })} bucket="company-assets" /></Card>}
      <Card><div className="grid gap-3 md:grid-cols-2">{fields.map((f) => <div key={f.name} className={f.type === 'json' || f.type === 'textarea' ? 'md:col-span-2' : ''}>
        <FieldInput f={{ ...f, readOnly: !editable }} value={d[f.name]} onChange={(v) => setD({ ...d, [f.name]: v })} /></div>)}</div></Card>
      {section === 'empresa' && <Card title="Horário de funcionamento">
        <div className="grid gap-2">{DAYS.map((name, i) => { const h = d.opening_hours?.[String(i)] ?? { open: '10:00', close: '22:00', closed: true };
          const set = (patch: any) => setD({ ...d, opening_hours: { ...d.opening_hours, [String(i)]: { ...h, ...patch } } });
          return <div key={i} className="flex flex-wrap items-center gap-3 text-sm"><span className="w-20">{name}</span>
            <label className="flex items-center gap-1"><input type="checkbox" className="accent-red-600" checked={!h.closed} disabled={!editable} onChange={(e) => set({ closed: !e.target.checked })} /> aberto</label>
            <input type="time" className="input w-auto py-1" value={h.open} disabled={h.closed || !editable} onChange={(e) => set({ open: e.target.value })} /><span>às</span>
            <input type="time" className="input w-auto py-1" value={h.close} disabled={h.closed || !editable} onChange={(e) => set({ close: e.target.value })} /></div>; })}</div>
      </Card>}
      {editable && <button className="btn-primary" onClick={save}>Salvar alterações</button>}
    </div>
  );
}

function Users() {
  const toast = useToast(); const { me, refresh } = useAuth();
  const [rows, setRows] = useState<any[]>([]); const [roles, setRoles] = useState<any[]>([]); const [edit, setEdit] = useState<any | null>(null); const [nw, setNw] = useState(false); const [pin, setPin] = useState('');
  const load = useCallback(() => { rpc<any[]>('admin_list_users').then(setRows).catch((e) => toast(e.message, 'err')); supabase.from('roles').select('*').order('name').then(({ data }) => setRoles(data ?? [])); }, [toast]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="space-y-4">
      <Card title="Meu PIN de autorização"><p className="mb-2 text-sm text-stone-500">Usado para aprovar descontos, cancelamentos e sangrias no caixa de outra pessoa. {me?.has_pin ? 'Você já tem um PIN.' : 'Você ainda não tem PIN.'}</p>
        <div className="flex max-w-sm gap-2"><input className="input" type="password" inputMode="numeric" placeholder="4 a 8 dígitos" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
          <button className="btn-dark" disabled={pin.length < 4} onClick={async () => { try { await rpc('set_my_authorization_pin', { p_pin: pin }); setPin(''); toast('PIN salvo'); refresh(); } catch (e) { toast((e as Error).message, 'err'); } }}>Salvar</button></div></Card>
      <div className="flex justify-end"><button className="btn-primary" onClick={() => setNw(true)}>Criar usuário</button></div>
      <div className="rounded-md border border-char/10 bg-white dark:bg-stone-900"><Table rows={rows} onRow={setEdit} cols={[
        { key: 'full_name', label: 'Nome' }, { key: 'email', label: 'E-mail' }, { key: 'role_code', label: 'Papel', render: (u) => roles.find((x) => x.code === u.role_code)?.name ?? u.role_code },
        { key: 'employee_name', label: 'Funcionário vinculado', render: (u) => u.employee_name ?? '—' }, { key: 'has_pin', label: 'PIN', render: r.bool('has_pin') },
        { key: 'is_active', label: 'Situação', render: (u) => u.is_active ? <Badge tone="good">Ativo</Badge> : <Badge tone="warn">Aguardando liberação</Badge> }, { key: 'created_at', label: 'Criado', render: (u) => dateBR(u.created_at) }]} /></div>
      {edit && <Modal title={edit.full_name} onClose={() => setEdit(null)} footer={<button className="btn-primary" onClick={async () => {
        try { await rpc('admin_update_user', { p_user: edit.id, p_role: edit.role_code, p_active: edit.is_active, p_max_discount: Number(edit.max_discount_percent), p_name: edit.full_name }); toast('Usuário atualizado'); setEdit(null); load(); } catch (e) { toast((e as Error).message, 'err'); } }}>Salvar</button>}>
        <div className="grid gap-3"><Field label="Nome"><input className="input" value={edit.full_name} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} /></Field>
          <Field label="Papel"><select className="input" value={edit.role_code} onChange={(e) => setEdit({ ...edit, role_code: e.target.value })}>{roles.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></Field>
          <Field label="Desconto máximo no PDV sem autorização (%)"><input className="input" type="number" value={edit.max_discount_percent} onChange={(e) => setEdit({ ...edit, max_discount_percent: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-red-600" checked={edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} /> Acesso liberado</label></div>
      </Modal>}
      {nw && <NewUser roles={roles} onClose={() => setNw(false)} onDone={() => { setNw(false); load(); }} />}
    </div>
  );
}

function NewUser({ roles, onClose, onDone }: { roles: any[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [d, setD] = useState({ full_name: '', email: '', password: '', role_code: 'funcionario' });
  return (
    <Modal title="Criar usuário" onClose={onClose} footer={<button className="btn-primary" onClick={async () => {
      const { data, error } = await supabase.functions.invoke('admin-users', { body: d });
      if (error || data?.error) return toast(data?.error ?? error?.message ?? 'Falha ao criar usuário', 'err');
      toast('Usuário criado. Peça para trocar a senha no primeiro acesso.'); onDone();
    }}>Criar</button>}>
      <div className="grid gap-3">
        <Field label="Nome"><input className="input" value={d.full_name} onChange={(e) => setD({ ...d, full_name: e.target.value })} /></Field>
        <Field label="E-mail"><input className="input" type="email" value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} /></Field>
        <Field label="Senha provisória (mín. 8)"><input className="input" type="text" value={d.password} onChange={(e) => setD({ ...d, password: e.target.value })} /></Field>
        <Field label="Papel"><select className="input" value={d.role_code} onChange={(e) => setD({ ...d, role_code: e.target.value })}>{roles.filter((x) => x.code !== 'admin').map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></Field>
        <p className="text-xs text-stone-500">Usa a função segura “admin-users” no servidor (chave de serviço nunca vai para o navegador).</p>
      </div>
    </Modal>
  );
}

function Roles() {
  const toast = useToast(); const { can } = useAuth();
  const [roles, setRoles] = useState<any[]>([]); const [perms, setPerms] = useState<any[]>([]); const [rp, setRp] = useState<Record<string, Set<string>>>({});
  const load = useCallback(async () => {
    const [{ data: r1 }, { data: p1 }, { data: x1 }] = await Promise.all([supabase.from('roles').select('*').order('name'), supabase.from('permissions').select('*').order('module'), supabase.from('role_permissions').select('*')]);
    setRoles(r1 ?? []); setPerms(p1 ?? []);
    const m: Record<string, Set<string>> = {}; (x1 ?? []).forEach((x: any) => (m[x.role_code] ??= new Set()).add(x.permission_code)); setRp(m);
  }, []);
  useEffect(() => { load(); }, [load]);
  const editable = can('users.manage');
  return (
    <div className="overflow-x-auto rounded-md border border-char/10 bg-white dark:bg-stone-900">
      <table className="text-xs"><thead><tr><th className="sticky left-0 bg-white p-2 text-left dark:bg-stone-900">Permissão</th>{roles.map((r) => <th key={r.code} className="p-2">{r.name}</th>)}</tr></thead>
        <tbody>{perms.map((p) => <tr key={p.code} className="border-t border-char/5"><td className="sticky left-0 bg-white p-2 dark:bg-stone-900"><b>{p.module}</b> — {p.description}</td>
          {roles.map((r) => <td key={r.code} className="p-2 text-center">{r.code === 'admin' ? '✓' : <input type="checkbox" className="accent-red-600" disabled={!editable} checked={rp[r.code]?.has(p.code) ?? false} onChange={async (e) => {
            const cur = new Set(rp[r.code] ?? []); e.target.checked ? cur.add(p.code) : cur.delete(p.code);
            try { await rpc('admin_set_role_permissions', { p_role: r.code, p_perms: [...cur] }); setRp({ ...rp, [r.code]: cur }); } catch (err) { toast((err as Error).message, 'err'); } }} />}</td>)}</tr>)}</tbody></table>
      <p className="p-3 text-xs text-stone-500">Alterações valem imediatamente e ficam registradas na auditoria. Permissões individuais podem ser concedidas/negadas por usuário na tabela user_permission_overrides.</p>
    </div>
  );
}

function Printers() {
  const toast = useToast(); const { can } = useAuth();
  const [list, setList] = useState<any[]>([]);
  useEffect(() => { supabase.from('company_settings').select('printers').eq('id', 1).maybeSingle().then(({ data }) => setList(data?.printers ?? [])); }, []);
  const save = async (l: any[]) => { const { error } = await supabase.from('company_settings').update({ printers: l }).eq('id', 1); if (error) toast(cleanError(error.message), 'err'); else { setList(l); toast('Salvo'); } };
  return (
    <div className="space-y-4">
      <Card title="Impressoras cadastradas">
        {list.map((p, i) => <div key={i} className="mb-2 grid gap-2 sm:grid-cols-5">
          <input className="input py-1.5 text-sm" value={p.name} onChange={(e) => setList(list.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} placeholder="Nome" />
          <select className="input py-1.5 text-sm" value={p.role} onChange={(e) => setList(list.map((x, j) => j === i ? { ...x, role: e.target.value } : x))}><option value="receipt">Comprovante (caixa)</option><option value="kitchen">Cozinha</option></select>
          <select className="input py-1.5 text-sm" value={p.paper} onChange={(e) => setList(list.map((x, j) => j === i ? { ...x, paper: Number(e.target.value) } : x))}><option value={80}>80 mm</option><option value={58}>58 mm</option></select>
          <select className="input py-1.5 text-sm" value={p.connection} onChange={(e) => setList(list.map((x, j) => j === i ? { ...x, connection: e.target.value } : x))}><option value="browser">Pelo navegador (driver do sistema)</option><option value="serial">ESC/POS direto (Web Serial/USB)</option></select>
          <button className="btn-outline py-1.5 text-sm" onClick={async () => {
            try {
              if (p.connection === 'serial') await sendSerial(new EscPos().align('center').bold(true).ln('TESTE DE IMPRESSAO').bold(false).ln(p.name).feed(3).cut().build());
              else printHTML('Teste', `<h1 class="c">TESTE DE IMPRESSÃO</h1><p class="c">${p.name} · ${p.paper} mm</p><hr><p>0123456789 ABCDEFGHIJ</p>`, p.paper);
            } catch (e) { toast((e as Error).message, 'err'); } }}>Imprimir teste</button></div>)}
        {can('settings.manage') && <div className="mt-2 flex gap-2"><button className="btn-outline py-1.5 text-sm" onClick={() => setList([...list, { name: 'Impressora', role: 'receipt', paper: 80, connection: 'browser' }])}>+ impressora</button>
          <button className="btn-primary py-1.5 text-sm" onClick={() => save(list)}>Salvar</button></div>}
      </Card>
      <Card title="Gaveta de dinheiro e leitor de código de barras">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Gaveta ligada à impressora térmica (RJ11): no PDV, “Abrir gaveta + imprimir (ESC/POS)” envia o pulso ESC p.</li>
          <li>Leitor de código de barras USB (modo teclado): no PDV, leia o código no campo de busca; o Enter adiciona o produto (campo “Código de barras” do produto).</li>
          <li>Requisitos e homologação de modelos: veja <b>docs/HARDWARE.md</b>.</li>
        </ul>
      </Card>
    </div>
  );
}
