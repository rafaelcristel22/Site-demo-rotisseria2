import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { dateTimeBR } from '../../lib/format';
import { Modal, PageHeader, Table, exportCSV } from '../ui';

const ACTIONS: Record<string, string> = { ORDER_CANCEL: 'Cancelamento de venda/pedido', DISCOUNT_APPROVED: 'Desconto autorizado', TIMECLOCK_ADJUST_APPROVE: 'Ajuste de ponto aprovado',
  TIMECLOCK_ADJUST_REJECT: 'Ajuste de ponto rejeitado', FIN_REVERSAL: 'Estorno financeiro', LGPD_EXPORT: 'Exportação de dados (LGPD)', LGPD_ANONYMIZE: 'Anonimização (LGPD)',
  PAYROLL_CALCULATE: 'Folha calculada', PAYROLL_REVIEW: 'Folha conferida', PAYROLL_REOPEN: 'Folha reaberta', SET_PIN: 'PIN alterado', INSERT: 'Inclusão', UPDATE: 'Alteração', DELETE: 'Exclusão' };
const ENT = ['', 'products', 'orders', 'sales', 'inventory_movements', 'ingredients', 'time_clock_records', 'time_adjustments', 'financial_transactions', 'accounts_payable', 'employees', 'users', 'company_settings', 'cash_registers', 'coupons', 'promotions'];

export default function Audit() {
  const [rows, setRows] = useState<any[]>([]); const [entity, setEntity] = useState(''); const [action, setAction] = useState(''); const [open, setOpen] = useState<any | null>(null);
  useEffect(() => {
    let q = supabase.from('audit_logs').select('*').order('occurred_at', { ascending: false }).limit(500);
    if (entity) q = q.eq('entity', entity); if (action) q = q.eq('action', action);
    q.then(({ data }) => setRows(data ?? []));
  }, [entity, action]);
  return (
    <div>
      <PageHeader title="Auditoria" subtitle="Registro imutável de quem fez o quê: preços, cancelamentos, estoque, descontos, ponto, financeiro e permissões." />
      <div className="mb-3 flex flex-wrap gap-2">
        <select className="input w-auto py-2 text-sm" value={entity} onChange={(e) => setEntity(e.target.value)}>{ENT.map((e) => <option key={e} value={e}>{e || 'Todas as tabelas'}</option>)}</select>
        <select className="input w-auto py-2 text-sm" value={action} onChange={(e) => setAction(e.target.value)}><option value="">Todas as ações</option>{Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button className="btn-outline ml-auto py-2 text-sm" onClick={() => exportCSV('auditoria', rows)}>Exportar CSV</button>
      </div>
      <div className="rounded-md border border-char/10 bg-white dark:bg-stone-900"><Table rows={rows} onRow={setOpen} cols={[
        { key: 'occurred_at', label: 'Quando', render: (a) => dateTimeBR(a.occurred_at) }, { key: 'user_email', label: 'Usuário', render: (a) => a.user_email ?? 'sistema/site' },
        { key: 'action', label: 'Ação', render: (a) => ACTIONS[a.action] ?? a.action }, { key: 'entity', label: 'Tabela' },
        { key: 'changed_fields', label: 'Campos alterados', render: (a) => (a.changed_fields ?? []).join(', ') || '—' }, { key: 'reason', label: 'Motivo', render: (a) => a.reason ?? '' }]} /></div>
      {open && <Modal title="Detalhe do registro" wide onClose={() => setOpen(null)}>
        <p className="mb-2 text-sm">{dateTimeBR(open.occurred_at)} · {open.user_email ?? 'sistema'} · IP {open.ip ?? '—'}</p>
        <div className="grid gap-3 md:grid-cols-2"><div><h3 className="text-sm font-semibold">Antes</h3><pre className="max-h-80 overflow-auto rounded bg-stone-100 p-2 text-xs dark:bg-stone-800">{JSON.stringify(open.old_data, null, 2)}</pre></div>
          <div><h3 className="text-sm font-semibold">Depois</h3><pre className="max-h-80 overflow-auto rounded bg-stone-100 p-2 text-xs dark:bg-stone-800">{JSON.stringify(open.new_data, null, 2)}</pre></div></div>
      </Modal>}
    </div>
  );
}
