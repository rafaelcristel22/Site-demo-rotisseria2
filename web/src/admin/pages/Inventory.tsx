import { useCallback, useEffect, useState } from 'react';
import { supabase, rpc, cleanError } from '../../lib/supabase';
import { money, num, dateBR, dateTimeBR } from '../../lib/format';
import Crud, { r, FieldInput, useRefs, type FieldDef } from '../Crud';
import { Badge, Card, Field, Modal, PageHeader, Table, Tabs, exportCSV, useToast } from '../ui';
import { useAuth } from '../auth';
import { RefName } from './Catalog';

const TYPES: Record<string, string> = { ingrediente: 'Ingrediente', carne: 'Carne', frango: 'Frango', massa: 'Massa', tempero: 'Tempero', bebida: 'Bebida',
  embalagem: 'Embalagem', revenda: 'Revenda', limpeza: 'Limpeza', hortifruti: 'Hortifrúti', laticinio: 'Laticínio', outro: 'Outro' };
const MOV: Record<string, string> = { entrada: 'Entrada', saida: 'Saída', ajuste: 'Ajuste', perda: 'Perda', transferencia_saida: 'Transf. (saída)',
  transferencia_entrada: 'Transf. (entrada)', inventario: 'Inventário', consumo_venda: 'Consumo (venda)', estorno_venda: 'Estorno (venda)', producao: 'Produção' };

export default function Inventory() {
  return (
    <div>
      <PageHeader title="Estoque" subtitle="Posição, movimentações, fichas técnicas, lotes e validade. Vendas baixam o estoque automaticamente pela ficha técnica." />
      <Tabs tabs={[
        { key: 'posicao', label: 'Posição', el: () => <Levels /> },
        { key: 'mov', label: 'Movimentações', el: () => <Movements /> },
        { key: 'itens', label: 'Itens de estoque', el: () => <Crud cfg={{
          table: 'ingredients', title: 'Itens de estoque', perm: 'inventory.manage', embedded: true, order: 'name.asc', search: ['name', 'sku'],
          fields: [{ name: 'name', label: 'Nome', required: true },
            { name: 'ingredient_type', label: 'Tipo', type: 'select', default: 'ingrediente', options: Object.entries(TYPES).map(([value, label]) => ({ value, label })) },
            { name: 'unit', label: 'Unidade', type: 'select', default: 'kg', options: ['kg', 'g', 'l', 'ml', 'un', 'cx', 'pct', 'dz'].map((u) => ({ value: u, label: u })) },
            { name: 'min_stock', label: 'Estoque mínimo', type: 'number', default: 0 }, { name: 'max_stock', label: 'Estoque máximo', type: 'number' },
            { name: 'default_supplier_id', label: 'Fornecedor padrão', type: 'ref', ref: { table: 'suppliers', label: 'name' } },
            { name: 'shelf_life_days', label: 'Validade padrão (dias)', type: 'number' }, { name: 'track_lots', label: 'Controlar lotes', type: 'bool' },
            { name: 'sku', label: 'Código' }, { name: 'barcode', label: 'Código de barras' }, { name: 'notes', label: 'Observações', type: 'textarea' },
            { name: 'is_active', label: 'Ativo', type: 'bool', default: true }],
          columns: [{ key: 'name', label: 'Item' }, { key: 'ingredient_type', label: 'Tipo', render: r.label(TYPES, 'ingredient_type') }, { key: 'unit', label: 'Un.' },
            { key: 'avg_cost', label: 'Custo médio', align: 'right', render: (x) => money(x.avg_cost) }, { key: 'min_stock', label: 'Mínimo', align: 'right' }, { key: 'is_active', label: '', render: r.active }],
        }} /> },
        { key: 'fichas', label: 'Fichas técnicas', el: () => <Recipes /> },
        { key: 'validade', label: 'Lotes e validade', el: () => <Expiring /> },
        { key: 'inventario', label: 'Inventário (contagem)', el: () => <Counts /> },
        { key: 'locais', label: 'Locais', el: () => <Crud cfg={{ table: 'stock_locations', title: 'Locais', perm: 'inventory.manage', embedded: true, order: 'name.asc',
          fields: [{ name: 'name', label: 'Nome', required: true }, { name: 'is_default', label: 'Padrão', type: 'bool' }, { name: 'is_active', label: 'Ativo', type: 'bool', default: true }],
          columns: [{ key: 'name', label: 'Local' }, { key: 'is_default', label: 'Padrão', render: r.bool('is_default') }] }} /> },
      ]} />
    </div>
  );
}

function Levels() {
  const { can } = useAuth();
  const [rows, setRows] = useState<any[]>([]); const [filter, setFilter] = useState<'todos' | 'baixo'>('todos'); const [move, setMove] = useState<any | null>(null);
  const load = useCallback(() => supabase.from('v_stock_levels').select('*').eq('is_active', true).order('name').then(({ data }) => setRows(data ?? [])), []);
  useEffect(() => { load(); }, [load]);
  const list = filter === 'baixo' ? rows.filter((x) => x.status !== 'ok' && Number(x.min_stock) > 0) : rows;
  const total = rows.reduce((s, x) => s + Number(x.stock_value), 0);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <select className="input w-auto py-2 text-sm" value={filter} onChange={(e) => setFilter(e.target.value as any)}><option value="todos">Todos os itens</option><option value="baixo">Abaixo do mínimo</option></select>
        <span className="text-sm text-stone-500">Valor em estoque (custo médio): <b className="text-char dark:text-white">{money(total)}</b></span>
        <button className="btn-outline ml-auto py-2 text-sm" onClick={() => exportCSV('estoque', list, { name: 'Item', unit: 'Unidade', quantity: 'Quantidade', min_stock: 'Mínimo', avg_cost: 'Custo médio', stock_value: 'Valor', status: 'Situação' })}>Exportar Excel (CSV)</button>
        {can('inventory.manage') && <button className="btn-primary py-2 text-sm" onClick={() => setMove({})}>Movimentar</button>}
      </div>
      <div className="rounded-md border border-char/10 bg-white dark:bg-stone-900">
        <Table rows={list} rowKey="ingredient_id" onRow={can('inventory.manage') ? (x) => setMove({ ingredient_id: x.ingredient_id }) : undefined} cols={[
          { key: 'name', label: 'Item' }, { key: 'ingredient_type', label: 'Tipo', render: r.label(TYPES, 'ingredient_type') },
          { key: 'quantity', label: 'Quantidade', align: 'right', render: (x) => `${num(x.quantity, 3)} ${x.unit}` },
          { key: 'min_stock', label: 'Mínimo', align: 'right', render: (x) => num(x.min_stock, 3) },
          { key: 'avg_cost', label: 'Custo médio', align: 'right', render: (x) => money(x.avg_cost) },
          { key: 'stock_value', label: 'Valor', align: 'right', render: (x) => money(x.stock_value) },
          { key: 'status', label: 'Situação', render: (x) => x.status === 'ok' ? <Badge tone="good">OK</Badge> : x.status === 'baixo' ? <Badge tone="warn">Baixo</Badge> : <Badge tone="bad">Zerado</Badge> },
        ]} />
      </div>
      {move && <MoveModal initial={move} onClose={() => setMove(null)} onDone={() => { setMove(null); load(); }} />}
    </div>
  );
}

function MoveModal({ initial, onClose, onDone }: { initial: any; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const fields: FieldDef[] = [
    { name: 'ingredient_id', label: 'Item', type: 'ref', ref: { table: 'ingredients', label: 'name' }, required: true },
    { name: 'type', label: 'Tipo', type: 'select', options: [{ value: 'entrada', label: 'Entrada (compra avulsa)' }, { value: 'saida', label: 'Saída' },
      { value: 'perda', label: 'Perda / desperdício' }, { value: 'ajuste', label: 'Ajuste (+/−)' }, { value: 'producao', label: 'Produção' }, { value: 'transferencia', label: 'Transferência entre locais' }] },
    { name: 'quantity', label: 'Quantidade', type: 'number', required: true },
    { name: 'location_id', label: 'Local (origem)', type: 'ref', ref: { table: 'stock_locations', label: 'name' } },
    { name: 'to_location_id', label: 'Local de destino (transferência)', type: 'ref', ref: { table: 'stock_locations', label: 'name' } },
    { name: 'unit_cost', label: 'Custo unitário (entrada)', type: 'money' },
    { name: 'lot_code', label: 'Lote' }, { name: 'expiry', label: 'Validade', type: 'date' },
    { name: 'reason', label: 'Motivo', type: 'textarea' },
  ];
  const refs = useRefs(fields);
  const [d, setD] = useState<any>({ type: 'entrada', ...initial });
  return (
    <Modal title="Movimentar estoque" onClose={onClose} wide footer={<><button className="btn-outline" onClick={onClose}>Cancelar</button>
      <button className="btn-primary" onClick={async () => {
        try {
          if (d.type === 'transferencia') await rpc('inventory_transfer', { p_ingredient: d.ingredient_id, p_from: d.location_id, p_to: d.to_location_id, p_quantity: Number(d.quantity), p_reason: d.reason ?? null });
          else await rpc('inventory_move', { p_ingredient: d.ingredient_id, p_type: d.type, p_quantity: Number(d.quantity), p_location: d.location_id || null,
            p_unit_cost: d.unit_cost ? Number(d.unit_cost) : null, p_reason: d.reason ?? null, p_lot_code: d.lot_code || null, p_expiry: d.expiry || null });
          toast('Movimentação registrada'); onDone();
        } catch (e) { toast((e as Error).message, 'err'); }
      }}>Registrar</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.filter((f) => f.name !== 'to_location_id' || d.type === 'transferencia').filter((f) => !['unit_cost', 'lot_code', 'expiry'].includes(f.name) || d.type === 'entrada')
          .map((f) => <div key={f.name} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}><FieldInput f={f} value={d[f.name]} options={f.type === 'ref' ? refs[f.name] : f.options} onChange={(v) => setD({ ...d, [f.name]: v })} /></div>)}
      </div>
      <p className="mt-3 text-xs text-stone-500">Ajuste aceita valor negativo. Toda movimentação fica no histórico e não pode ser apagada.</p>
    </Modal>
  );
}

function Movements() {
  const [rows, setRows] = useState<any[]>([]); const [type, setType] = useState('');
  useEffect(() => {
    let q = supabase.from('inventory_movements').select('*').order('created_at', { ascending: false }).limit(300);
    if (type) q = q.eq('movement_type', type);
    q.then(({ data }) => setRows(data ?? []));
  }, [type]);
  return (
    <div>
      <div className="mb-3 flex gap-2"><select className="input w-auto py-2 text-sm" value={type} onChange={(e) => setType(e.target.value)}><option value="">Todos os tipos</option>
        {Object.entries(MOV).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button className="btn-outline ml-auto py-2 text-sm" onClick={() => exportCSV('movimentacoes', rows)}>Exportar CSV</button></div>
      <div className="rounded-md border border-char/10 bg-white dark:bg-stone-900">
        <Table rows={rows} cols={[
          { key: 'created_at', label: 'Data', render: (m) => dateTimeBR(m.created_at) },
          { key: 'ingredient_id', label: 'Item', render: (m) => <RefName table="ingredients" id={m.ingredient_id} /> },
          { key: 'movement_type', label: 'Tipo', render: (m) => MOV[m.movement_type] },
          { key: 'quantity', label: 'Qtd.', align: 'right', render: (m) => <span className={Number(m.quantity) < 0 ? 'text-red-700' : 'text-green-800'}>{num(m.quantity, 3)}</span> },
          { key: 'balance_after', label: 'Saldo', align: 'right', render: (m) => num(m.balance_after, 3) },
          { key: 'total_cost', label: 'Custo', align: 'right', render: (m) => money(m.total_cost) },
          { key: 'reason', label: 'Motivo/ref.', render: (m) => m.reason ?? m.reference_type ?? '—' },
          { key: 'created_by', label: 'Por', render: (m) => m.created_by ? <RefName table="users" id={m.created_by} col="full_name" /> : 'sistema' },
        ]} />
      </div>
    </div>
  );
}

function Recipes() {
  const { can } = useAuth(); const toast = useToast();
  const [products, setProducts] = useState<any[]>([]); const [sel, setSel] = useState<string>(''); const [recipe, setRecipe] = useState<any | null>(null);
  const [items, setItems] = useState<any[]>([]); const [ings, setIngs] = useState<any[]>([]); const [cost, setCost] = useState<number | null>(null);
  useEffect(() => {
    supabase.from('products').select('id,name,price,product_type').in('product_type', ['preparado']).order('name').then(({ data }) => setProducts(data ?? []));
    supabase.from('ingredients').select('id,name,unit,avg_cost').eq('is_active', true).order('name').then(({ data }) => setIngs(data ?? []));
  }, []);
  const load = useCallback(async () => {
    if (!sel) return;
    const { data } = await supabase.from('recipes').select('*').eq('product_id', sel).maybeSingle();
    setRecipe(data);
    if (data) { const { data: it } = await supabase.from('recipe_items').select('*').eq('recipe_id', data.id); setItems(it ?? []); } else setItems([]);
    setCost(await rpc<number>('product_unit_cost', { p_product: sel, p_depth: 0 }).catch(() => null));
  }, [sel]);
  useEffect(() => { load(); }, [load]);
  const product = products.find((p) => p.id === sel);
  const ing = (id: string) => ings.find((i) => i.id === id);
  const batch = items.reduce((s, i) => s + Number(i.quantity) * Number(ing(i.ingredient_id)?.avg_cost ?? 0), 0);

  async function saveRecipe(patch: any) {
    const res = recipe ? await supabase.from('recipes').update(patch).eq('id', recipe.id) : await supabase.from('recipes').insert({ product_id: sel, name: product.name, ...patch });
    if (res.error) toast(cleanError(res.error.message), 'err'); else load();
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <Card title="Produtos preparados">
        <ul className="max-h-[60vh] overflow-y-auto text-sm">{products.map((p) => <li key={p.id}><button onClick={() => setSel(p.id)} className={`w-full rounded px-2 py-1.5 text-left ${sel === p.id ? 'bg-char text-white' : 'hover:bg-stone-100 dark:hover:bg-stone-800'}`}>{p.name}</button></li>)}</ul>
      </Card>
      {!product ? <Card><p className="text-sm text-stone-500">Escolha um produto para montar a ficha técnica. A ficha define o custo do produto e a baixa automática no estoque a cada venda.</p></Card> : (
        <Card title={`Ficha técnica — ${product.name}`}>
          {!recipe ? <button className="btn-primary" disabled={!can('inventory.manage')} onClick={() => saveRecipe({ yield_quantity: 1, loss_percent: 0 })}>Criar ficha técnica</button> : <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Rendimento (porções por receita)"><input className="input" type="number" step="0.001" defaultValue={recipe.yield_quantity} disabled={!can('inventory.manage')} onBlur={(e) => saveRecipe({ yield_quantity: Number(e.target.value) })} /></Field>
              <Field label="Perda na produção (%)"><input className="input" type="number" step="0.1" defaultValue={recipe.loss_percent} disabled={!can('inventory.manage')} onBlur={(e) => saveRecipe({ loss_percent: Number(e.target.value) })} /></Field>
              <Field label="Ativa"><select className="input" value={recipe.is_active ? '1' : '0'} disabled={!can('inventory.manage')} onChange={(e) => saveRecipe({ is_active: e.target.value === '1' })}><option value="1">Sim</option><option value="0">Não</option></select></Field>
            </div>
            <table className="mt-4 w-full text-sm"><thead><tr className="border-b border-char/10 text-left text-xs uppercase text-stone-500"><th className="py-2">Ingrediente</th><th className="text-right">Qtd. (receita inteira)</th><th className="text-right">Custo</th><th /></tr></thead>
              <tbody>{items.map((i) => <tr key={i.id} className="border-b border-char/5"><td className="py-1.5">{ing(i.ingredient_id)?.name}</td>
                <td className="text-right">{num(i.quantity, 4)} {ing(i.ingredient_id)?.unit}</td><td className="text-right">{money(Number(i.quantity) * Number(ing(i.ingredient_id)?.avg_cost ?? 0))}</td>
                <td className="text-right">{can('inventory.manage') && <button className="text-xs text-red-700 underline" onClick={async () => { await supabase.from('recipe_items').delete().eq('id', i.id); load(); }}>remover</button>}</td></tr>)}</tbody></table>
            {can('inventory.manage') && <AddRecipeItem ings={ings} onAdd={async (ingredient_id, quantity) => {
              const { error } = await supabase.from('recipe_items').insert({ recipe_id: recipe.id, ingredient_id, quantity });
              if (error) toast(cleanError(error.message), 'err'); else load();
            }} />}
            <dl className="mt-4 grid gap-2 border-t border-char/10 pt-3 text-sm sm:grid-cols-4">
              <div><dt className="text-stone-500">Custo da receita</dt><dd className="font-semibold">{money(batch)}</dd></div>
              <div><dt className="text-stone-500">Custo por unidade vendida</dt><dd className="font-semibold">{cost != null ? money(cost) : '—'}</dd></div>
              <div><dt className="text-stone-500">Preço de venda</dt><dd className="font-semibold">{money(product.price)}</dd></div>
              <div><dt className="text-stone-500">Margem (CMV)</dt><dd className="font-semibold">{cost != null && Number(product.price) > 0 ? `${num((1 - cost / Number(product.price)) * 100, 1)}%` : '—'}</dd></div>
            </dl>
          </>}
        </Card>
      )}
    </div>
  );
}
function AddRecipeItem({ ings, onAdd }: { ings: any[]; onAdd: (id: string, q: number) => void }) {
  const [id, setId] = useState(''); const [q, setQ] = useState('');
  return <div className="mt-3 flex gap-2"><select className="input py-2 text-sm" value={id} onChange={(e) => setId(e.target.value)}><option value="">Adicionar ingrediente…</option>{ings.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}</select>
    <input className="input w-32 py-2 text-sm" type="number" step="0.0001" placeholder="Qtd." value={q} onChange={(e) => setQ(e.target.value)} />
    <button className="btn-dark py-2 text-sm" disabled={!id || !Number(q)} onClick={() => { onAdd(id, Number(q)); setId(''); setQ(''); }}>Adicionar</button></div>;
}

function Expiring() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { supabase.from('v_expiring_lots').select('*').order('expiry_date').then(({ data }) => setRows(data ?? [])); }, []);
  return <Card title="Lotes vencidos ou vencendo em até 7 dias"><Table rows={rows} empty="Nenhum lote próximo do vencimento." cols={[
    { key: 'ingredient_name', label: 'Item' }, { key: 'lot_code', label: 'Lote' }, { key: 'location_name', label: 'Local' },
    { key: 'quantity', label: 'Qtd.', align: 'right', render: (l) => `${num(l.quantity, 3)} ${l.unit}` },
    { key: 'expiry_date', label: 'Validade', render: (l) => dateBR(l.expiry_date + 'T12:00') },
    { key: 'days_to_expire', label: 'Situação', render: (l) => l.days_to_expire < 0 ? <Badge tone="bad">Vencido</Badge> : <Badge tone="warn">{l.days_to_expire} dia(s)</Badge> }]} /></Card>;
}

function Counts() {
  const toast = useToast(); const { can } = useAuth();
  const [counts, setCounts] = useState<any[]>([]); const [locs, setLocs] = useState<any[]>([]); const [open, setOpen] = useState<any | null>(null); const [items, setItems] = useState<any[]>([]);
  const load = useCallback(() => {
    supabase.from('inventory_counts').select('*').order('started_at', { ascending: false }).limit(30).then(({ data }) => setCounts(data ?? []));
    supabase.from('stock_locations').select('id,name').then(({ data }) => setLocs(data ?? []));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (open) supabase.from('inventory_count_items').select('*').eq('count_id', open.id).then(({ data }) => setItems(data ?? [])); }, [open]);
  return (
    <div>
      {can('inventory.manage') && <div className="mb-3 flex gap-2">{locs.map((l) => <button key={l.id} className="btn-outline py-2 text-sm" onClick={async () => {
        try { await rpc('inventory_count_start', { p_location: l.id }); toast('Inventário iniciado'); load(); } catch (e) { toast((e as Error).message, 'err'); } }}>Iniciar contagem — {l.name}</button>)}</div>}
      <div className="rounded-md border border-char/10 bg-white dark:bg-stone-900"><Table rows={counts} onRow={setOpen} cols={[
        { key: 'started_at', label: 'Início', render: (c) => dateTimeBR(c.started_at) }, { key: 'location_id', label: 'Local', render: (c) => locs.find((l) => l.id === c.location_id)?.name ?? '—' },
        { key: 'status', label: 'Status', render: (c) => <Badge tone={c.status === 'aberto' ? 'warn' : 'good'}>{c.status}</Badge> }, { key: 'finished_at', label: 'Fim', render: (c) => dateTimeBR(c.finished_at) }]} /></div>
      {open && <Modal title="Contagem de inventário" wide onClose={() => setOpen(null)} footer={open.status === 'aberto' && can('inventory.manage') ? <button className="btn-primary" onClick={async () => {
        try { const n = await rpc<number>('inventory_count_finish', { p_count: open.id }); toast(`Inventário finalizado: ${n} ajuste(s)`); setOpen(null); load(); } catch (e) { toast((e as Error).message, 'err'); } }}>Finalizar e ajustar estoque</button> : undefined}>
        <table className="w-full text-sm"><thead><tr className="text-left text-xs uppercase text-stone-500"><th>Item</th><th className="text-right">Sistema</th><th className="text-right">Contado</th><th className="text-right">Diferença</th></tr></thead>
          <tbody>{items.map((i) => <tr key={i.ingredient_id} className="border-t border-char/5"><td className="py-1"><RefName table="ingredients" id={i.ingredient_id} /></td><td className="text-right">{num(i.system_quantity, 3)}</td>
            <td className="text-right">{open.status === 'aberto' ? <input className="input w-28 py-1 text-right text-sm" type="number" step="0.001" defaultValue={i.counted_quantity ?? ''} onBlur={async (e) => {
              const v = e.target.value === '' ? null : Number(e.target.value);
              await supabase.from('inventory_count_items').update({ counted_quantity: v }).eq('count_id', open.id).eq('ingredient_id', i.ingredient_id);
              setItems((xs) => xs.map((x) => x.ingredient_id === i.ingredient_id ? { ...x, counted_quantity: v } : x)); }} /> : num(i.counted_quantity, 3)}</td>
            <td className="text-right">{i.counted_quantity != null ? num(Number(i.counted_quantity) - Number(i.system_quantity), 3) : '—'}</td></tr>)}</tbody></table>
      </Modal>}
    </div>
  );
}
