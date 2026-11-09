import { useCallback, useEffect, useState } from 'react';
import { supabase, rpc, cleanError } from '../../lib/supabase';
import { money, num, dateBR } from '../../lib/format';
import Crud, { r } from '../Crud';
import { Badge, Card, Field, Modal, PageHeader, Table, Tabs, useToast } from '../ui';
import { useAuth } from '../auth';
import { RefName } from './Catalog';
import { LineCompare } from '../charts';

const ST: Record<string, any> = { rascunho: ['Rascunho', 'neutral'], enviado: ['Enviado', 'info'], recebido_parcial: ['Parcial', 'warn'], recebido: ['Recebido', 'good'], cancelado: ['Cancelado', 'bad'] };

export default function Purchases() {
  return (
    <div>
      <PageHeader title="Compras e fornecedores" subtitle="Cotações, pedidos de compra, recebimento com conferência, entrada no estoque e contas a pagar." />
      <Tabs tabs={[
        { key: 'pedidos', label: 'Pedidos de compra', el: () => <PurchaseOrders /> },
        { key: 'reposicao', label: 'Reposição sugerida', el: () => <Restock /> },
        { key: 'cotacoes', label: 'Cotações', el: () => <Quotations /> },
        { key: 'fornecedores', label: 'Fornecedores', el: () => <Crud cfg={{
          table: 'suppliers', title: 'Fornecedores', perm: 'purchases.manage', embedded: true, order: 'name.asc', search: ['name', 'trade_name', 'document'],
          fields: [{ name: 'name', label: 'Razão social / nome', required: true }, { name: 'trade_name', label: 'Nome fantasia' },
            { name: 'document', label: 'CNPJ/CPF (só números)' }, { name: 'contact_name', label: 'Contato' }, { name: 'phone', label: 'Telefone', type: 'tel' },
            { name: 'whatsapp', label: 'WhatsApp', type: 'tel' }, { name: 'email', label: 'E-mail', type: 'email' }, { name: 'payment_terms', label: 'Condições de pagamento' },
            { name: 'delivery_days', label: 'Prazo de entrega (dias)', type: 'number' }, { name: 'categories', label: 'Categorias fornecidas', type: 'tags' },
            { name: 'rating', label: 'Avaliação (0-5)', type: 'number', step: '0.5' }, { name: 'notes', label: 'Observações', type: 'textarea' },
            { name: 'is_active', label: 'Ativo', type: 'bool', default: true }],
          columns: [{ key: 'name', label: 'Fornecedor' }, { key: 'contact_name', label: 'Contato' }, { key: 'phone', label: 'Telefone' },
            { key: 'payment_terms', label: 'Pagamento' }, { key: 'is_active', label: '', render: r.active }],
        }} /> },
        { key: 'precos', label: 'Evolução de preços', el: () => <PriceEvolution /> },
      ]} />
    </div>
  );
}

function PurchaseOrders() {
  const { can } = useAuth(); const toast = useToast();
  const [rows, setRows] = useState<any[]>([]); const [edit, setEdit] = useState<any | null>(null); const [receive, setReceive] = useState<any | null>(null);
  const load = useCallback(() => supabase.from('purchases').select('*').order('created_at', { ascending: false }).limit(200).then(({ data }) => setRows(data ?? [])), []);
  useEffect(() => { load(); }, [load]);
  return (
    <div>
      {can('purchases.manage') && <button className="btn-primary mb-3" onClick={() => setEdit({})}>Novo pedido de compra</button>}
      <div className="rounded-md border border-char/10 bg-white dark:bg-stone-900"><Table rows={rows} onRow={setEdit} cols={[
        { key: 'number', label: 'Nº', render: (p) => `#${p.number}` }, { key: 'supplier_id', label: 'Fornecedor', render: (p) => <RefName table="suppliers" id={p.supplier_id} /> },
        { key: 'order_date', label: 'Data', render: (p) => dateBR(p.order_date + 'T12:00') }, { key: 'expected_date', label: 'Previsão', render: (p) => p.expected_date ? dateBR(p.expected_date + 'T12:00') : '—' },
        { key: 'total', label: 'Total', align: 'right', render: (p) => money(p.total) }, { key: 'status', label: 'Status', render: (p) => <Badge tone={ST[p.status][1]}>{ST[p.status][0]}</Badge> },
        { key: 'a', label: '', align: 'right', render: (p) => can('purchases.manage') && ['rascunho', 'enviado', 'recebido_parcial'].includes(p.status) ?
          <button className="btn-outline px-2 py-1 text-xs" onClick={(e) => { e.stopPropagation(); setReceive(p); }}>Receber</button> : null },
      ]} /></div>
      {edit && <PurchaseEditor purchase={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {receive && <ReceiveModal purchase={receive} onClose={() => setReceive(null)} onDone={() => { setReceive(null); load(); toast('Recebimento registrado: estoque e contas a pagar atualizados'); }} />}
    </div>
  );
}

function PurchaseEditor({ purchase, onClose, onSaved }: { purchase: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast(); const { can } = useAuth();
  const [p, setP] = useState<any>({ freight: 0, discount: 0, ...purchase });
  const [items, setItems] = useState<any[]>([]); const [sups, setSups] = useState<any[]>([]); const [ings, setIngs] = useState<any[]>([]);
  const editable = can('purchases.manage') && (!p.id || p.status === 'rascunho');
  useEffect(() => {
    supabase.from('suppliers').select('id,name').eq('is_active', true).order('name').then(({ data }) => setSups(data ?? []));
    supabase.from('ingredients').select('id,name,unit,last_cost').eq('is_active', true).order('name').then(({ data }) => setIngs(data ?? []));
    if (p.id) supabase.from('purchase_items').select('*').eq('purchase_id', p.id).then(({ data }) => setItems(data ?? []));
  }, [p.id]);
  const total = items.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.unit_price || 0), 0) + Number(p.freight || 0) - Number(p.discount || 0);
  async function save(status?: string) {
    try {
      if (!p.supplier_id) throw new Error('Escolha o fornecedor');
      if (!items.length) throw new Error('Adicione itens');
      const head = { supplier_id: p.supplier_id, expected_date: p.expected_date || null, freight: Number(p.freight || 0), discount: Number(p.discount || 0), notes: p.notes ?? null, ...(status ? { status } : {}) };
      let id = p.id;
      if (id) { const r1 = await supabase.from('purchases').update(head).eq('id', id); if (r1.error) throw r1.error; await supabase.from('purchase_items').delete().eq('purchase_id', id); }
      else { const r1 = await supabase.from('purchases').insert(head).select('id').single(); if (r1.error) throw r1.error; id = r1.data.id; }
      const r2 = await supabase.from('purchase_items').insert(items.map((i) => ({ purchase_id: id, ingredient_id: i.ingredient_id, quantity: Number(i.quantity), unit_price: Number(i.unit_price) })));
      if (r2.error) throw r2.error;
      toast('Pedido salvo'); onSaved();
    } catch (e: any) { toast(cleanError(e.message), 'err'); }
  }
  return (
    <Modal title={p.id ? `Pedido de compra #${p.number}` : 'Novo pedido de compra'} wide onClose={onClose} footer={editable ? <>
      {p.id && <button className="btn-ghost mr-auto text-red-700" onClick={async () => { await supabase.from('purchases').update({ status: 'cancelado' }).eq('id', p.id); onSaved(); }}>Cancelar pedido</button>}
      <button className="btn-outline" onClick={() => save()}>Salvar rascunho</button><button className="btn-primary" onClick={() => save('enviado')}>Salvar e marcar como enviado</button></> : undefined}>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Fornecedor" className="sm:col-span-2"><select className="input" disabled={!editable} value={p.supplier_id ?? ''} onChange={(e) => setP({ ...p, supplier_id: e.target.value })}><option value="">—</option>{sups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Previsão de entrega"><input className="input" type="date" disabled={!editable} value={p.expected_date ?? ''} onChange={(e) => setP({ ...p, expected_date: e.target.value })} /></Field>
        <Field label="Frete (R$)"><input className="input" type="number" step="0.01" disabled={!editable} value={p.freight} onChange={(e) => setP({ ...p, freight: e.target.value })} /></Field>
      </div>
      <table className="mt-4 w-full text-sm"><thead><tr className="text-left text-xs uppercase text-stone-500"><th>Item</th><th className="w-28 text-right">Qtd.</th><th className="w-32 text-right">Preço unit.</th><th className="w-28 text-right">Total</th><th className="w-8" /></tr></thead>
        <tbody>{items.map((i, k) => <tr key={k} className="border-t border-char/5">
          <td className="py-1"><select className="input py-1.5 text-sm" disabled={!editable} value={i.ingredient_id} onChange={(e) => { const g = ings.find((x) => x.id === e.target.value); setItems(items.map((x, j) => j === k ? { ...x, ingredient_id: e.target.value, unit_price: x.unit_price || g?.last_cost || '' } : x)); }}>
            <option value="">—</option>{ings.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.unit})</option>)}</select></td>
          <td><input className="input py-1.5 text-right text-sm" type="number" step="0.001" disabled={!editable} value={i.quantity} onChange={(e) => setItems(items.map((x, j) => j === k ? { ...x, quantity: e.target.value } : x))} /></td>
          <td><input className="input py-1.5 text-right text-sm" type="number" step="0.0001" disabled={!editable} value={i.unit_price} onChange={(e) => setItems(items.map((x, j) => j === k ? { ...x, unit_price: e.target.value } : x))} /></td>
          <td className="text-right">{money(Number(i.quantity || 0) * Number(i.unit_price || 0))}</td>
          <td>{editable && <button className="text-red-700" onClick={() => setItems(items.filter((_, j) => j !== k))} aria-label="Remover">×</button>}</td></tr>)}</tbody></table>
      {editable && <button className="btn-outline mt-2 py-1.5 text-sm" onClick={() => setItems([...items, { ingredient_id: '', quantity: '', unit_price: '' }])}>+ item</button>}
      <p className="mt-3 text-right text-lg font-bold">Total {money(total)}</p>
    </Modal>
  );
}

function ReceiveModal({ purchase, onClose, onDone }: { purchase: any; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [items, setItems] = useState<any[]>([]); const [invoice, setInvoice] = useState(purchase.invoice_number ?? '');
  const [payable, setPayable] = useState(true); const [due, setDue] = useState(''); const [inst, setInst] = useState(1);
  const [check, setCheck] = useState({ temperature_ok: true, packaging_ok: true, invoice_matches: true, notes: '' });
  useEffect(() => { supabase.from('purchase_items').select('*').eq('purchase_id', purchase.id).then(({ data }) =>
    setItems((data ?? []).map((i) => ({ ...i, recv: Math.max(Number(i.quantity) - Number(i.received_quantity), 0), price: i.unit_price, lot: '', exp: '' })))); }, [purchase.id]);
  return (
    <Modal title={`Receber pedido #${purchase.number}`} wide onClose={onClose} footer={<><button className="btn-outline" onClick={onClose}>Voltar</button>
      <button className="btn-primary" onClick={async () => {
        try {
          await rpc('receive_purchase', { p_purchase: purchase.id, p_invoice: invoice || null, p_create_payable: payable, p_due_date: due || null, p_installments: inst,
            p_items: items.map((i) => ({ item_id: i.id, received_quantity: Number(i.recv), unit_price: Number(i.price), lot_code: i.lot, expiry_date: i.exp || null })), p_check: check });
          onDone();
        } catch (e) { toast((e as Error).message, 'err'); }
      }}>Confirmar recebimento</button></>}>
      <table className="w-full text-sm"><thead><tr className="text-left text-xs uppercase text-stone-500"><th>Item</th><th className="text-right">Pedido</th><th>Recebido</th><th>Preço NF</th><th>Lote</th><th>Validade</th></tr></thead>
        <tbody>{items.map((i, k) => <tr key={i.id} className="border-t border-char/5"><td className="py-1"><RefName table="ingredients" id={i.ingredient_id} /></td>
          <td className="text-right">{num(i.quantity, 3)}{Number(i.received_quantity) > 0 && <span className="block text-xs text-stone-500">já recebido {num(i.received_quantity, 3)}</span>}</td>
          {(['recv', 'price', 'lot', 'exp'] as const).map((f) => <td key={f} className="px-1"><input className="input py-1 text-sm" type={f === 'exp' ? 'date' : f === 'lot' ? 'text' : 'number'} step="0.0001"
            value={i[f]} onChange={(e) => setItems(items.map((x, j) => j === k ? { ...x, [f]: e.target.value } : x))} /></td>)}</tr>)}</tbody></table>
      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Field label="Nº da nota fiscal"><input className="input" value={invoice} onChange={(e) => setInvoice(e.target.value)} /></Field>
        <Field label="Gerar contas a pagar"><select className="input" value={payable ? '1' : '0'} onChange={(e) => setPayable(e.target.value === '1')}><option value="1">Sim</option><option value="0">Não (pago à vista fora do sistema)</option></select></Field>
        <Field label="1º vencimento"><input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <Field label="Parcelas"><input className="input" type="number" min={1} max={12} value={inst} onChange={(e) => setInst(Number(e.target.value))} /></Field>
      </div>
      <fieldset className="mt-4 flex flex-wrap gap-4 text-sm"><legend className="label">Conferência</legend>
        {([['temperature_ok', 'Temperatura adequada'], ['packaging_ok', 'Embalagens íntegras'], ['invoice_matches', 'Nota confere com o pedido']] as const).map(([k, l]) =>
          <label key={k} className="flex items-center gap-2"><input type="checkbox" className="accent-red-600" checked={check[k]} onChange={(e) => setCheck({ ...check, [k]: e.target.checked })} />{l}</label>)}
        <input className="input" placeholder="Divergências / observações" value={check.notes} onChange={(e) => setCheck({ ...check, notes: e.target.value })} />
      </fieldset>
    </Modal>
  );
}

function Restock() {
  const toast = useToast(); const { can } = useAuth();
  const [rows, setRows] = useState<any[]>([]); const [days, setDays] = useState(7);
  useEffect(() => { rpc<any[]>('restock_suggestions', { p_days_coverage: days }).then(setRows).catch((e) => toast(e.message, 'err')); }, [days, toast]);
  async function createOrders() {
    const bySup = new Map<string, any[]>();
    rows.filter((x) => x.supplier_id && Number(x.suggested_quantity) > 0).forEach((x) => bySup.set(x.supplier_id, [...(bySup.get(x.supplier_id) ?? []), x]));
    if (!bySup.size) return toast('Defina o fornecedor padrão nos itens de estoque para gerar pedidos.', 'err');
    for (const [sup, list] of bySup) {
      const { data, error } = await supabase.from('purchases').insert({ supplier_id: sup, notes: 'Gerado pela reposição sugerida' }).select('id').single();
      if (error) return toast(cleanError(error.message), 'err');
      await supabase.from('purchase_items').insert(list.map((x) => ({ purchase_id: data.id, ingredient_id: x.ingredient_id, quantity: Number(x.suggested_quantity), unit_price: Number(x.last_cost) })));
    }
    toast(`${bySup.size} pedido(s) de compra criados como rascunho`);
  }
  return (
    <div>
      <div className="mb-3 flex items-center gap-3 text-sm"><span>Cobrir consumo de</span><input className="input w-20 py-1.5" type="number" min={1} value={days} onChange={(e) => setDays(Number(e.target.value))} /><span>dias (média dos últimos 30 dias)</span>
        {can('purchases.manage') && <button className="btn-primary ml-auto py-2" onClick={createOrders}>Gerar pedidos por fornecedor</button>}</div>
      <div className="rounded-md border border-char/10 bg-white dark:bg-stone-900"><Table rows={rows} rowKey="ingredient_id" empty="Nada a repor agora." cols={[
        { key: 'name', label: 'Item' }, { key: 'quantity', label: 'Em estoque', align: 'right', render: (x) => `${num(x.quantity, 3)} ${x.unit}` },
        { key: 'avg_daily_use', label: 'Consumo/dia', align: 'right', render: (x) => num(x.avg_daily_use, 3) },
        { key: 'days_left', label: 'Dura (dias)', align: 'right', render: (x) => x.days_left ?? '—' },
        { key: 'suggested_quantity', label: 'Sugerido', align: 'right', render: (x) => <b>{num(x.suggested_quantity, 3)}</b> },
        { key: 'supplier_name', label: 'Fornecedor', render: (x) => x.supplier_name ?? <span className="text-stone-400">sem fornecedor padrão</span> },
        { key: 'cost', label: 'Custo est.', align: 'right', render: (x) => money(Number(x.suggested_quantity) * Number(x.last_cost)) }]} /></div>
    </div>
  );
}

function Quotations() {
  const toast = useToast(); const { can } = useAuth();
  const [reqs, setReqs] = useState<any[]>([]); const [open, setOpen] = useState<any | null>(null);
  const load = useCallback(() => supabase.from('purchase_requests').select('*').order('created_at', { ascending: false }).limit(50).then(({ data }) => setReqs(data ?? [])), []);
  useEffect(() => { load(); }, [load]);
  return (
    <div>
      {can('purchases.manage') && <button className="btn-primary mb-3" onClick={async () => {
        const { data, error } = await supabase.from('purchase_requests').insert({ status: 'em_cotacao' }).select('*').single();
        if (error) toast(cleanError(error.message), 'err'); else { load(); setOpen(data); } }}>Nova solicitação de compra</button>}
      <div className="rounded-md border border-char/10 bg-white dark:bg-stone-900"><Table rows={reqs} onRow={setOpen} cols={[
        { key: 'number', label: 'Nº', render: (q) => `#${q.number}` }, { key: 'created_at', label: 'Data', render: (q) => dateBR(q.created_at) },
        { key: 'status', label: 'Status', render: (q) => <Badge>{q.status}</Badge> }, { key: 'notes', label: 'Observações' }]} /></div>
      {open && <QuotationDetail req={open} onClose={() => { setOpen(null); load(); }} />}
    </div>
  );
}
function QuotationDetail({ req, onClose }: { req: any; onClose: () => void }) {
  const toast = useToast();
  const [cmp, setCmp] = useState<any[]>([]); const [sups, setSups] = useState<any[]>([]); const [ings, setIngs] = useState<any[]>([]);
  const [sup, setSup] = useState(''); const [lines, setLines] = useState<{ ingredient_id: string; quantity: string; unit_price: string }[]>([{ ingredient_id: '', quantity: '', unit_price: '' }]);
  const load = useCallback(() => rpc<any[]>('compare_quotations', { p_request: req.id }).then(setCmp).catch(() => {}), [req.id]);
  useEffect(() => { load(); supabase.from('suppliers').select('id,name').order('name').then(({ data }) => setSups(data ?? []));
    supabase.from('ingredients').select('id,name,unit').eq('is_active', true).order('name').then(({ data }) => setIngs(data ?? [])); }, [load]);
  return (
    <Modal title={`Solicitação #${req.number} — cotações`} wide onClose={onClose} footer={<button className="btn-primary" disabled={!cmp.length} onClick={async () => {
      try { const n = await rpc<number>('purchase_from_best_quotes', { p_request: req.id }); toast(`${n} pedido(s) gerados com os menores preços`); onClose(); } catch (e) { toast((e as Error).message, 'err'); } }}>Gerar pedidos com os melhores preços</button>}>
      <h3 className="font-semibold">Registrar cotação de um fornecedor</h3>
      <div className="mt-2 grid gap-2"><select className="input py-2 text-sm" value={sup} onChange={(e) => setSup(e.target.value)}><option value="">Fornecedor…</option>{sups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        {lines.map((l, k) => <div key={k} className="flex gap-2"><select className="input py-1.5 text-sm" value={l.ingredient_id} onChange={(e) => setLines(lines.map((x, j) => j === k ? { ...x, ingredient_id: e.target.value } : x))}><option value="">Item…</option>{ings.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}</select>
          <input className="input w-28 py-1.5 text-sm" type="number" placeholder="Qtd." value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => j === k ? { ...x, quantity: e.target.value } : x))} />
          <input className="input w-32 py-1.5 text-sm" type="number" step="0.0001" placeholder="Preço unit." value={l.unit_price} onChange={(e) => setLines(lines.map((x, j) => j === k ? { ...x, unit_price: e.target.value } : x))} /></div>)}
        <div className="flex gap-2"><button className="btn-outline py-1.5 text-sm" onClick={() => setLines([...lines, { ingredient_id: '', quantity: '', unit_price: '' }])}>+ item</button>
          <button className="btn-dark py-1.5 text-sm" disabled={!sup} onClick={async () => {
            const { data, error } = await supabase.from('purchase_quotations').insert({ request_id: req.id, supplier_id: sup }).select('id').single();
            if (error) return toast(cleanError(error.message), 'err');
            const r2 = await supabase.from('purchase_quotation_items').insert(lines.filter((l) => l.ingredient_id && Number(l.quantity)).map((l) => ({ quotation_id: data.id, ingredient_id: l.ingredient_id, quantity: Number(l.quantity), unit_price: Number(l.unit_price) })));
            if (r2.error) return toast(cleanError(r2.error.message), 'err');
            toast('Cotação registrada'); setSup(''); load();
          }}>Salvar cotação</button></div></div>
      <h3 className="mt-5 font-semibold">Comparação</h3>
      <Table rows={cmp} rowKey="supplier_name" empty="Nenhuma cotação ainda." cols={[
        { key: 'ingredient_name', label: 'Item' }, { key: 'supplier_name', label: 'Fornecedor' }, { key: 'quantity', label: 'Qtd.', align: 'right' },
        { key: 'unit_price', label: 'Preço', align: 'right', render: (x) => money(x.unit_price) }, { key: 'total', label: 'Total', align: 'right', render: (x) => money(x.total) },
        { key: 'is_best', label: '', render: (x) => x.is_best ? <Badge tone="good">Melhor preço{Number(x.savings_vs_worst) > 0 ? ` · economia ${money(x.savings_vs_worst)}` : ''}</Badge> : null }]} />
    </Modal>
  );
}

function PriceEvolution() {
  const [ings, setIngs] = useState<any[]>([]); const [sel, setSel] = useState(''); const [data, setData] = useState<any[]>([]);
  useEffect(() => { supabase.from('ingredients').select('id,name,unit').order('name').then(({ data }) => setIngs(data ?? [])); }, []);
  useEffect(() => { if (sel) rpc<any[]>('report_ingredient_price_history', { p_ingredient: sel }).then((d) => setData(d.map((x) => ({ ...x, preco: Number(x.unit_price) })))); }, [sel]);
  return (
    <Card title="Evolução do preço de compra dos ingredientes">
      <select className="input mb-3 w-auto" value={sel} onChange={(e) => setSel(e.target.value)}><option value="">Escolha um item…</option>{ings.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
      {sel && <><LineCompare data={data} x="recorded_on" cur="preco" labelFmt={(v) => (v ? dateBR(v + 'T12:00') : '')} />
        <Table rows={data} rowKey="recorded_on" cols={[{ key: 'recorded_on', label: 'Data', render: (x) => dateBR(x.recorded_on + 'T12:00') }, { key: 'supplier', label: 'Fornecedor' },
          { key: 'source', label: 'Origem' }, { key: 'unit_price', label: 'Preço', align: 'right', render: (x) => money(x.unit_price) }]} /></>}
    </Card>
  );
}
