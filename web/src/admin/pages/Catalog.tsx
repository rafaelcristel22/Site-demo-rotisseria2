import { useEffect, useState } from 'react';
import { supabase, cleanError } from '../../lib/supabase';
import { money } from '../../lib/format';
import Crud, { r, type FieldDef } from '../Crud';
import { Badge, Modal, PageHeader, Tabs, useToast } from '../ui';
import { useAuth } from '../auth';

const productFields: FieldDef[] = [
  { name: 'name', label: 'Nome', required: true },
  { name: 'category_id', label: 'Categoria', type: 'ref', ref: { table: 'categories', label: 'name' }, required: true },
  { name: 'price', label: 'Preço de venda (R$)', type: 'money', required: true },
  { name: 'promotional_price', label: 'Preço promocional (R$)', type: 'money', hint: 'Deixe vazio se não houver' },
  { name: 'description', label: 'Descrição', type: 'textarea' },
  { name: 'image_url', label: 'Foto', type: 'image', wide: true },
  { name: 'product_type', label: 'Tipo', type: 'select', default: 'preparado', options: [
    { value: 'preparado', label: 'Preparado (usa ficha técnica)' }, { value: 'revenda', label: 'Revenda (baixa 1 item de estoque)' },
    { value: 'combo', label: 'Combo' }, { value: 'servico', label: 'Serviço/sem estoque' }] },
  { name: 'unit', label: 'Unidade de venda', type: 'select', default: 'un', options: [{ value: 'un', label: 'Unidade' }, { value: 'kg', label: 'Quilo' }, { value: 'porcao', label: 'Porção' }, { value: 'litro', label: 'Litro' }] },
  { name: 'stock_item_id', label: 'Item de estoque (revenda)', type: 'ref', ref: { table: 'ingredients', label: 'name' } },
  { name: 'stock_item_qty', label: 'Qtd. baixada por unidade', type: 'number', default: 1 },
  { name: 'sku', label: 'Código interno (SKU)' }, { name: 'barcode', label: 'Código de barras' },
  { name: 'prep_time_minutes', label: 'Tempo de preparo (min)', type: 'number', default: 15 },
  { name: 'serves', label: 'Serve quantas pessoas', type: 'number' },
  { name: 'sort_order', label: 'Ordem no cardápio', type: 'number', default: 0 },
  { name: 'tags', label: 'Etiquetas', type: 'tags' },
  { name: 'is_active', label: 'Ativo', type: 'bool', default: true },
  { name: 'available_online', label: 'Vende no site', type: 'bool', default: true },
  { name: 'available_pos', label: 'Vende no balcão', type: 'bool', default: true },
  { name: 'send_to_kitchen', label: 'Vai para a cozinha', type: 'bool', default: true },
  { name: 'sold_out', label: 'Esgotado hoje', type: 'bool' },
  { name: 'is_featured', label: 'Sugestão da casa', type: 'bool' },
  { name: 'is_popular', label: 'Destacar como popular', type: 'bool' },
];

export default function Catalog() {
  const { can } = useAuth();
  return (
    <div>
      <PageHeader title="Cardápio" subtitle="Produtos, preços, fotos, opções e combos. Alterações de preço ficam registradas na auditoria." />
      <Tabs tabs={[
        { key: 'produtos', label: 'Produtos', el: () => <Crud cfg={{
          table: 'products', title: 'Produtos', perm: 'catalog.manage', embedded: true, order: 'name.asc', search: ['name', 'sku', 'barcode'],
          fields: productFields, canDelete: true,
          columns: [
            { key: 'name', label: 'Produto', render: (p) => <span className="flex items-center gap-2">{p.image_url && <img src={p.image_url} alt="" className="h-8 w-8 rounded object-cover" />}<b>{p.name}</b></span> },
            { key: 'price', label: 'Preço', align: 'right', render: (p) => <>{money(p.price)}{p.promotional_price != null && <span className="block text-xs text-green-800">promo {money(p.promotional_price)}</span>}</> },
            { key: 'product_type', label: 'Tipo' },
            { key: 'flags', label: 'Situação', render: (p) => <span className="flex flex-wrap gap-1">{!p.is_active && <Badge>Inativo</Badge>}{p.sold_out && <Badge tone="bad">Esgotado</Badge>}
              {p.available_online && <Badge tone="info">Site</Badge>}{p.available_pos && <Badge>Balcão</Badge>}</span> },
          ],
          rowActions: can('catalog.manage') ? (p, reload) => <span className="flex justify-end gap-1">
            <OptionsButton product={p} /><SoldOutToggle p={p} reload={reload} /></span> : undefined,
        }} /> },
        { key: 'categorias', label: 'Categorias', el: () => <Crud cfg={{
          table: 'categories', title: 'Categorias', perm: 'catalog.manage', embedded: true, order: 'sort_order.asc', canDelete: true,
          fields: [{ name: 'name', label: 'Nome', required: true }, { name: 'slug', label: 'Identificador (URL)', required: true, hint: 'ex.: frangos' },
            { name: 'description', label: 'Descrição' }, { name: 'sort_order', label: 'Ordem', type: 'number', default: 0 },
            { name: 'kitchen_station', label: 'Estação da cozinha', default: 'cozinha' }, { name: 'is_active', label: 'Ativa', type: 'bool', default: true },
            { name: 'show_online', label: 'Aparece no site', type: 'bool', default: true }],
          columns: [{ key: 'sort_order', label: 'Ordem' }, { key: 'name', label: 'Categoria' }, { key: 'slug', label: 'URL' }, { key: 'is_active', label: '', render: r.active }],
        }} /> },
        { key: 'combos', label: 'Itens dos combos', el: () => <Crud cfg={{
          table: 'combo_items', title: 'Itens de combo', perm: 'catalog.manage', embedded: true, order: 'combo_product_id.asc', canDelete: true,
          fields: [{ name: 'combo_product_id', label: 'Combo', type: 'ref', ref: { table: 'products', label: 'name', filter: { product_type: 'combo' } }, required: true },
            { name: 'product_id', label: 'Produto incluído', type: 'ref', ref: { table: 'products', label: 'name' }, required: true },
            { name: 'quantity', label: 'Quantidade', type: 'number', default: 1 }],
          columns: [{ key: 'combo_product_id', label: 'Combo', render: (x) => <RefName table="products" id={x.combo_product_id} /> },
            { key: 'product_id', label: 'Produto', render: (x) => <RefName table="products" id={x.product_id} /> }, { key: 'quantity', label: 'Qtd.', align: 'right' }],
        }} /> },
        { key: 'precos', label: 'Histórico de preços', el: () => <PriceHistory /> },
      ]} />
    </div>
  );
}

const refCache = new Map<string, Promise<string>>();
export function RefName({ table, id, col = 'name' }: { table: string; id: string | null; col?: string }) {
  const [v, setV] = useState('…');
  useEffect(() => {
    if (!id) { setV('—'); return; }
    const k = `${table}:${col}:${id}`;
    if (!refCache.has(k)) refCache.set(k, Promise.resolve(supabase.from(table).select(col).eq('id', id).maybeSingle().then(({ data }) => (data as any)?.[col] ?? '—')));
    refCache.get(k)!.then(setV);
  }, [table, id, col]);
  return <>{v}</>;
}

function SoldOutToggle({ p, reload }: { p: any; reload: () => void }) {
  const toast = useToast();
  return <button className="btn-outline px-2 py-1 text-xs" onClick={async () => {
    const { error } = await supabase.from('products').update({ sold_out: !p.sold_out }).eq('id', p.id);
    if (error) toast(cleanError(error.message), 'err'); else reload();
  }}>{p.sold_out ? 'Disponível' : 'Esgotar'}</button>;
}

function OptionsButton({ product }: { product: any }) {
  const [open, setOpen] = useState(false);
  return <>
    <button className="btn-outline px-2 py-1 text-xs" onClick={() => setOpen(true)}>Opções</button>
    {open && <Modal title={`Opções — ${product.name}`} onClose={() => setOpen(false)} wide>
      <p className="mb-3 text-sm text-stone-500">Grupos (ex.: “Sabor”, “Adicionais”) e as opções de cada grupo. Mínimo 1 = obrigatório.</p>
      <Crud cfg={{ table: 'product_option_groups', title: 'Grupos', perm: 'catalog.manage', embedded: true, order: 'sort_order.asc', filter: { product_id: product.id }, canDelete: true,
        fields: [{ name: 'name', label: 'Nome do grupo', required: true }, { name: 'min_select', label: 'Mínimo', type: 'number', default: 0 },
          { name: 'max_select', label: 'Máximo', type: 'number', default: 1 }, { name: 'sort_order', label: 'Ordem', type: 'number', default: 0 }],
        columns: [{ key: 'name', label: 'Grupo' }, { key: 'min_select', label: 'Mín.' }, { key: 'max_select', label: 'Máx.' }],
        rowActions: (g) => <GroupOptions group={g} /> }} />
    </Modal>}
  </>;
}
function GroupOptions({ group }: { group: any }) {
  const [open, setOpen] = useState(false);
  return <>
    <button className="btn-outline px-2 py-1 text-xs" onClick={() => setOpen(true)}>Itens</button>
    {open && <Modal title={`Itens — ${group.name}`} onClose={() => setOpen(false)} wide>
      <Crud cfg={{ table: 'product_options', title: 'Opções', perm: 'catalog.manage', embedded: true, order: 'sort_order.asc', filter: { group_id: group.id }, canDelete: true,
        fields: [{ name: 'name', label: 'Opção', required: true }, { name: 'price_delta', label: 'Acréscimo (R$)', type: 'money', default: 0 },
          { name: 'stock_item_id', label: 'Baixa item de estoque', type: 'ref', ref: { table: 'ingredients', label: 'name' } },
          { name: 'stock_qty', label: 'Qtd. baixada', type: 'number', default: 0 }, { name: 'sort_order', label: 'Ordem', type: 'number', default: 0 },
          { name: 'is_active', label: 'Ativa', type: 'bool', default: true }],
        columns: [{ key: 'name', label: 'Opção' }, { key: 'price_delta', label: 'Acréscimo', align: 'right', render: r.money('price_delta') }, { key: 'is_active', label: '', render: r.active }] }} />
    </Modal>}
  </>;
}

function PriceHistory() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => { supabase.from('product_price_history').select('*').order('changed_at', { ascending: false }).limit(200).then(({ data }) => setRows(data ?? [])); }, []);
  return (
    <div className="rounded-md border border-char/10 bg-white dark:bg-stone-900">
      <table className="w-full text-sm"><thead><tr className="border-b border-char/10 text-left text-xs uppercase text-stone-500"><th className="p-2">Quando</th><th>Produto</th><th className="text-right">De</th><th className="text-right">Para</th><th className="p-2">Quem</th></tr></thead>
        <tbody>{rows.map((h) => <tr key={h.id} className="border-b border-char/5"><td className="p-2">{new Date(h.changed_at).toLocaleString('pt-BR')}</td><td><RefName table="products" id={h.product_id} /></td>
          <td className="text-right">{h.old_price != null ? money(h.old_price) : '—'}</td><td className="text-right">{money(h.new_price)}</td><td className="p-2"><RefName table="users" id={h.changed_by} col="full_name" /></td></tr>)}</tbody></table>
    </div>
  );
}
