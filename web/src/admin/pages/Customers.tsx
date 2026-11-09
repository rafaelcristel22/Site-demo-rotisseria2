import { useEffect, useState } from 'react';
import { supabase, rpc } from '../../lib/supabase';
import { money, dateBR, dateTimeBR, formatPhone, ORDER_STATUS } from '../../lib/format';
import Crud, { type FieldDef } from '../Crud';
import { Badge, Card, Modal, PageHeader, Table, Tabs, exportCSV, useToast } from '../ui';
import { useAuth } from '../auth';

const SEG: Record<string, any> = { frequente: ['Frequente', 'good'], ocasional: ['Ocasional', 'neutral'], novo: ['Novo', 'info'], inativo: ['Inativo', 'warn'], sem_compras: ['Sem compras', 'neutral'] };
const fields: FieldDef[] = [
  { name: 'name', label: 'Nome', required: true }, { name: 'phone', label: 'Telefone', type: 'tel' }, { name: 'email', label: 'E-mail', type: 'email' },
  { name: 'cpf', label: 'CPF' }, { name: 'birth_date', label: 'Nascimento', type: 'date' },
  { name: 'source', label: 'Origem', type: 'select', default: 'balcao', options: ['balcao', 'site', 'telefone', 'whatsapp', 'ifood', 'outro'].map((x) => ({ value: x, label: x })) },
  { name: 'preferences', label: 'Preferências', type: 'textarea' }, { name: 'notes', label: 'Observações', type: 'textarea' }, { name: 'tags', label: 'Etiquetas', type: 'tags' },
  { name: 'credit_enabled', label: 'Crédito (fiado) autorizado', type: 'bool' }, { name: 'credit_limit', label: 'Limite de crédito (R$)', type: 'money', default: 0 },
  { name: 'is_blocked', label: 'Bloqueado', type: 'bool' },
];

export default function Customers() {
  return (
    <div>
      <PageHeader title="Clientes" subtitle="Cadastro, histórico, segmentos, fidelidade e consentimentos (LGPD)." />
      <Tabs tabs={[
        { key: 'seg', label: 'Ranking e segmentos', el: () => <Segments /> },
        { key: 'cad', label: 'Cadastro', el: () => <Crud cfg={{ table: 'customers', title: 'Clientes', perm: 'customers.manage', embedded: true, order: 'name.asc', search: ['name', 'phone', 'email'], fields,
          columns: [{ key: 'name', label: 'Cliente' }, { key: 'phone', label: 'Telefone', render: (c) => formatPhone(c.phone ?? '') }, { key: 'orders_count', label: 'Pedidos', align: 'right' },
            { key: 'total_spent', label: 'Gasto', align: 'right', render: (c) => money(c.total_spent) }, { key: 'last_order_at', label: 'Último pedido', render: (c) => dateBR(c.last_order_at) },
            { key: 'loyalty_points', label: 'Pontos', align: 'right' }],
          rowActions: (c) => <CustomerFile c={c} /> }} /> },
      ]} />
    </div>
  );
}

function Segments() {
  const [rows, setRows] = useState<any[]>([]); const [seg, setSeg] = useState(''); const [inactive, setInactive] = useState(45);
  useEffect(() => { rpc<any[]>('customer_segments', { p_inactive_days: inactive }).then(setRows).catch(() => {}); }, [inactive]);
  const list = seg ? rows.filter((r) => r.segment === seg) : rows;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {Object.entries(SEG).map(([k, v]) => <button key={k} onClick={() => setSeg(seg === k ? '' : k)} className={`rounded border px-2.5 py-1 ${seg === k ? 'border-char bg-char text-white' : 'border-char/15'}`}>{v[0]} ({rows.filter((r) => r.segment === k).length})</button>)}
        <span className="ml-2">Inativo após</span><input className="input w-20 py-1" type="number" value={inactive} onChange={(e) => setInactive(Number(e.target.value))} /><span>dias</span>
        <button className="btn-outline ml-auto py-1.5" onClick={() => exportCSV('clientes-segmentos', list)}>Exportar CSV</button>
      </div>
      <div className="rounded-md border border-char/10 bg-white dark:bg-stone-900"><Table rows={list} rowKey="customer_id" cols={[
        { key: 'rank_position', label: '#' }, { key: 'name', label: 'Cliente' }, { key: 'phone', label: 'Telefone', render: (c) => formatPhone(c.phone ?? '') },
        { key: 'orders_count', label: 'Pedidos', align: 'right' }, { key: 'total_spent', label: 'Total gasto', align: 'right', render: (c) => money(c.total_spent) },
        { key: 'avg_ticket', label: 'Ticket médio', align: 'right', render: (c) => money(c.avg_ticket) }, { key: 'days_since_last', label: 'Dias sem comprar', align: 'right' },
        { key: 'segment', label: 'Segmento', render: (c) => <Badge tone={SEG[c.segment]?.[1]}>{SEG[c.segment]?.[0]}</Badge> }]} /></div>
    </div>
  );
}

function CustomerFile({ c }: { c: any }) {
  const toast = useToast(); const { can } = useAuth();
  const [open, setOpen] = useState(false); const [orders, setOrders] = useState<any[]>([]); const [cons, setCons] = useState<any[]>([]); const [inter, setInter] = useState<any[]>([]);
  const [addr, setAddr] = useState<any[]>([]); const [note, setNote] = useState(''); const [pts, setPts] = useState('');
  const load = () => {
    supabase.from('orders').select('id,number,created_at,total,status,channel').eq('customer_id', c.id).order('created_at', { ascending: false }).limit(50).then(({ data }) => setOrders(data ?? []));
    supabase.from('v_customer_current_consents').select('*').eq('customer_id', c.id).then(({ data }) => setCons(data ?? []));
    supabase.from('customer_interactions').select('*').eq('customer_id', c.id).order('created_at', { ascending: false }).then(({ data }) => setInter(data ?? []));
    supabase.from('customer_addresses').select('*').eq('customer_id', c.id).then(({ data }) => setAddr(data ?? []));
  };
  useEffect(() => { if (open) load(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return <>
    <button className="btn-outline px-2 py-1 text-xs" onClick={() => setOpen(true)}>Ficha</button>
    {open && <Modal title={c.name} wide onClose={() => setOpen(false)}>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Histórico de compras"><Table rows={orders} cols={[{ key: 'number', label: 'Nº', render: (o) => `#${o.number}` }, { key: 'created_at', label: 'Data', render: (o) => dateTimeBR(o.created_at) },
          { key: 'total', label: 'Total', align: 'right', render: (o) => money(o.total) }, { key: 'status', label: 'Status', render: (o) => ORDER_STATUS[o.status] }]} /></Card>
        <div className="space-y-4">
          <Card title="Endereços">{addr.map((a) => <p key={a.id} className="text-sm">{[a.street, a.number, a.complement, a.district].filter(Boolean).join(', ')}</p>)}{!addr.length && <p className="text-sm text-stone-500">Nenhum.</p>}</Card>
          <Card title="Consentimentos (LGPD)">
            {['termos_privacidade', 'marketing_whatsapp', 'marketing_email', 'programa_fidelidade'].map((t) => { const x = cons.find((k) => k.consent_type === t); return (
              <div key={t} className="flex items-center justify-between py-1 text-sm"><span>{t.replace(/_/g, ' ')}</span>
                <span className="flex items-center gap-2">{x ? <Badge tone={x.granted ? 'good' : 'neutral'}>{x.granted ? 'concedido' : 'negado'} · {dateBR(x.recorded_at)}</Badge> : <Badge>sem registro</Badge>}
                  {can('customers.manage') && t !== 'termos_privacidade' && <button className="text-xs underline" onClick={async () => { await rpc('set_customer_consent', { p_customer: c.id, p_type: t, p_granted: !(x?.granted) }); load(); }}>{x?.granted ? 'revogar' : 'registrar'}</button>}</span></div>); })}
            {can('customers.manage') && <div className="mt-3 flex gap-2 border-t border-char/10 pt-3">
              <button className="btn-outline py-1.5 text-xs" onClick={async () => { const data = await rpc('customer_data_export', { p_customer: c.id });
                const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); a.download = `dados-cliente-${c.id}.json`; a.click(); }}>Exportar dados do titular</button>
              <button className="btn-ghost py-1.5 text-xs text-red-700" onClick={async () => { const why = prompt('Protocolo/motivo da solicitação de eliminação:'); if (!why) return;
                try { await rpc('anonymize_customer', { p_customer: c.id, p_reason: why }); toast('Dados pessoais anonimizados'); setOpen(false); } catch (e) { toast((e as Error).message, 'err'); } }}>Anonimizar (eliminação)</button></div>}
          </Card>
          <Card title={`Fidelidade: ${c.loyalty_points} pontos`}>{can('customers.manage') && <div className="flex gap-2"><input className="input py-1.5" type="number" placeholder="+/- pontos" value={pts} onChange={(e) => setPts(e.target.value)} />
            <button className="btn-outline py-1.5 text-sm" onClick={async () => { const why = prompt('Motivo do ajuste:'); if (!why) return; try { await rpc('loyalty_adjust', { p_customer: c.id, p_points: Number(pts), p_notes: why }); toast('Pontos ajustados'); } catch (e) { toast((e as Error).message, 'err'); } }}>Ajustar</button></div>}</Card>
          <Card title="Atendimentos">
            {can('customers.manage') && <div className="mb-2 flex gap-2"><input className="input py-1.5 text-sm" placeholder="Registrar atendimento, reclamação, elogio…" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="btn-dark py-1.5 text-sm" disabled={!note} onClick={async () => { await supabase.from('customer_interactions').insert({ customer_id: c.id, description: note }); setNote(''); load(); }}>Salvar</button></div>}
            <ul className="text-sm">{inter.map((i) => <li key={i.id} className="border-b border-char/5 py-1"><span className="text-stone-500">{dateTimeBR(i.created_at)} · {i.channel}</span> — {i.description}</li>)}</ul>
          </Card>
        </div>
      </div>
    </Modal>}
  </>;
}
