import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { money, dateBR } from '../../lib/format';
import Crud, { r } from '../Crud';
import { Badge, Card, PageHeader, Table, Tabs } from '../ui';
import { RefName } from './Catalog';

const DAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export default function Marketing() {
  return (
    <div>
      <PageHeader title="Marketing" subtitle="Cupons, promoções programadas, campanhas, banners do site e resultados." />
      <Tabs tabs={[
        { key: 'cupons', label: 'Cupons', el: () => <Crud cfg={{ table: 'coupons', title: 'Cupons', perm: 'marketing.manage', embedded: true, order: 'created_at.desc', search: ['code', 'description'],
          fields: [{ name: 'code', label: 'Código', required: true }, { name: 'description', label: 'Descrição' },
            { name: 'discount_type', label: 'Tipo', type: 'select', required: true, options: [{ value: 'percentual', label: '% de desconto' }, { value: 'valor_fixo', label: 'R$ de desconto' }, { value: 'frete_gratis', label: 'Entrega grátis' }] },
            { name: 'discount_value', label: 'Valor', type: 'number', default: 0 }, { name: 'min_order_value', label: 'Pedido mínimo (R$)', type: 'money', default: 0 }, { name: 'max_discount', label: 'Desconto máximo (R$)', type: 'money' },
            { name: 'starts_at', label: 'Início', type: 'date' }, { name: 'ends_at', label: 'Fim', type: 'date' }, { name: 'max_uses', label: 'Limite total de usos', type: 'number' },
            { name: 'max_uses_per_customer', label: 'Usos por cliente', type: 'number', default: 1 }, { name: 'customer_id', label: 'Exclusivo do cliente', type: 'ref', ref: { table: 'customers', label: 'name' } },
            { name: 'campaign_id', label: 'Campanha', type: 'ref', ref: { table: 'campaigns', label: 'name' } }, { name: 'channels', label: 'Canais (pdv, site)', type: 'tags', default: ['pdv', 'site'] },
            { name: 'first_order_only', label: 'Somente 1º pedido', type: 'bool' }, { name: 'is_active', label: 'Ativo', type: 'bool', default: true }],
          transform: (d) => ({ ...d, starts_at: d.starts_at ?? new Date().toISOString() }),
          columns: [{ key: 'code', label: 'Código', render: (c) => <b>{c.code}</b> }, { key: 'discount_type', label: 'Desconto', render: (c) => c.discount_type === 'percentual' ? `${c.discount_value}%` : c.discount_type === 'valor_fixo' ? money(c.discount_value) : 'Entrega grátis' },
            { key: 'uses_count', label: 'Usos', align: 'right', render: (c) => `${c.uses_count}${c.max_uses ? `/${c.max_uses}` : ''}` }, { key: 'ends_at', label: 'Validade', render: (c) => c.ends_at ? dateBR(c.ends_at) : 'sem fim' },
            { key: 'customer_id', label: 'Cliente', render: (c) => c.customer_id ? <RefName table="customers" id={c.customer_id} /> : 'todos' }, { key: 'is_active', label: '', render: r.active }] }} /> },
        { key: 'promo', label: 'Promoções programadas', el: () => <Crud cfg={{ table: 'promotions', title: 'Promoções', perm: 'marketing.manage', embedded: true, order: 'created_at.desc',
          fields: [{ name: 'name', label: 'Nome', required: true }, { name: 'promo_type', label: 'Tipo', type: 'select', required: true, options: [{ value: 'percentual', label: '% de desconto' }, { value: 'valor_fixo', label: 'R$ de desconto' }, { value: 'preco_fixo', label: 'Preço fixo' }] },
            { name: 'value', label: 'Valor', type: 'number', required: true }, { name: 'product_id', label: 'Produto', type: 'ref', ref: { table: 'products', label: 'name' } },
            { name: 'category_id', label: 'ou categoria inteira', type: 'ref', ref: { table: 'categories', label: 'name' } },
            { name: 'days_of_week', label: 'Dias da semana (0=dom … 6=sáb)', type: 'tags', default: ['0', '1', '2', '3', '4', '5', '6'] },
            { name: 'start_time', label: 'Das', type: 'time' }, { name: 'end_time', label: 'Até', type: 'time' }, { name: 'starts_on', label: 'Início', type: 'date' }, { name: 'ends_on', label: 'Fim', type: 'date' },
            { name: 'channels', label: 'Canais', type: 'tags', default: ['pdv', 'site'] }, { name: 'campaign_id', label: 'Campanha', type: 'ref', ref: { table: 'campaigns', label: 'name' } }, { name: 'is_active', label: 'Ativa', type: 'bool', default: true }],
          transform: (d) => ({ ...d, days_of_week: (d.days_of_week as string[] ?? []).map(Number), starts_on: d.starts_on ?? new Date().toISOString().slice(0, 10) }),
          columns: [{ key: 'name', label: 'Promoção' }, { key: 'value', label: 'Valor', render: (p) => p.promo_type === 'percentual' ? `${p.value}%` : money(p.value) },
            { key: 'alvo', label: 'Aplica-se a', render: (p) => p.product_id ? <RefName table="products" id={p.product_id} /> : <RefName table="categories" id={p.category_id} /> },
            { key: 'days_of_week', label: 'Quando', render: (p) => `${p.days_of_week.length === 7 ? 'todos os dias' : p.days_of_week.map((d: number) => DAYS[d]).join(', ')}${p.start_time ? ` ${p.start_time.slice(0, 5)}–${p.end_time?.slice(0, 5)}` : ''}` },
            { key: 'is_active', label: '', render: r.active }] }} /> },
        { key: 'camp', label: 'Campanhas e resultados', el: () => <Campaigns /> },
        { key: 'banners', label: 'Banners do site', el: () => <Crud cfg={{ table: 'banners', title: 'Banners', perm: 'marketing.manage', embedded: true, order: 'sort_order.asc', canDelete: true,
          fields: [{ name: 'title', label: 'Título', required: true }, { name: 'subtitle', label: 'Subtítulo' }, { name: 'image_url', label: 'Imagem (opcional)', type: 'image', wide: true },
            { name: 'link_url', label: 'Link (ex.: #combos)' }, { name: 'product_id', label: 'Abre o produto', type: 'ref', ref: { table: 'products', label: 'name' } },
            { name: 'starts_at', label: 'Início', type: 'date' }, { name: 'ends_at', label: 'Fim', type: 'date' }, { name: 'sort_order', label: 'Ordem', type: 'number', default: 0 }, { name: 'is_active', label: 'Ativo', type: 'bool', default: true }],
          columns: [{ key: 'title', label: 'Banner' }, { key: 'subtitle', label: 'Subtítulo' }, { key: 'is_active', label: '', render: r.active }] }} /> },
        { key: 'destaques', label: 'Sugestões da casa', el: () => <Card><p className="text-sm">As sugestões e destaques do site são definidos em Cardápio → Produto → “Sugestão da casa”. Combos ficam na categoria Combos, com itens em Cardápio → Itens dos combos.</p></Card> },
      ]} />
    </div>
  );
}

function Campaigns() {
  const [res, setRes] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const { data: camps } = await supabase.from('campaigns').select('*').order('starts_on', { ascending: false });
      const { data: coupons } = await supabase.from('coupons').select('id,campaign_id,code');
      const { data: reds } = await supabase.from('coupon_redemptions').select('coupon_id,order_id,discount_amount');
      const ids = (reds ?? []).map((x) => x.order_id).filter(Boolean);
      const { data: orders } = ids.length ? await supabase.from('orders').select('id,total,status').in('id', ids) : { data: [] as any[] };
      setRes((camps ?? []).map((c) => {
        const cps = (coupons ?? []).filter((x) => x.campaign_id === c.id).map((x) => x.id);
        const rr = (reds ?? []).filter((x) => cps.includes(x.coupon_id));
        const oo = (orders ?? []).filter((o) => rr.some((x) => x.order_id === o.id) && o.status !== 'cancelado');
        const revenue = oo.reduce((s, o) => s + Number(o.total), 0); const disc = rr.reduce((s, x) => s + Number(x.discount_amount), 0);
        return { ...c, uses: rr.length, revenue, disc, roi: Number(c.budget) + disc > 0 ? (revenue - Number(c.budget) - disc) / (Number(c.budget) + disc) * 100 : null };
      }));
    })();
  }, []);
  return (
    <div className="space-y-4">
      <Crud cfg={{ table: 'campaigns', title: 'Campanhas', perm: 'marketing.manage', embedded: true, order: 'starts_on.desc',
        fields: [{ name: 'name', label: 'Nome', required: true }, { name: 'objective', label: 'Objetivo' },
          { name: 'channel', label: 'Canal', type: 'select', default: 'whatsapp', options: ['whatsapp', 'instagram', 'facebook', 'email', 'sms', 'site', 'panfleto', 'outro'].map((x) => ({ value: x, label: x })) },
          { name: 'starts_on', label: 'Início', type: 'date' }, { name: 'ends_on', label: 'Fim', type: 'date' }, { name: 'budget', label: 'Investimento (R$)', type: 'money', default: 0 },
          { name: 'status', label: 'Status', type: 'select', default: 'planejada', options: ['planejada', 'ativa', 'encerrada', 'cancelada'].map((x) => ({ value: x, label: x })) },
          { name: 'target_segment', label: 'Público' }, { name: 'notes', label: 'Observações', type: 'textarea' }],
        columns: [{ key: 'name', label: 'Campanha' }, { key: 'channel', label: 'Canal' }, { key: 'status', label: 'Status', render: (c) => <Badge>{c.status}</Badge> }] }} />
      <Card title="Resultados (pedidos com cupons vinculados à campanha)"><Table rows={res} cols={[{ key: 'name', label: 'Campanha' }, { key: 'uses', label: 'Usos de cupom', align: 'right' },
        { key: 'revenue', label: 'Faturamento gerado', align: 'right', render: (c) => money(c.revenue) }, { key: 'disc', label: 'Descontos concedidos', align: 'right', render: (c) => money(c.disc) },
        { key: 'budget', label: 'Investimento', align: 'right', render: (c) => money(c.budget) }, { key: 'roi', label: 'Retorno', align: 'right', render: (c) => c.roi == null ? '—' : `${c.roi.toFixed(0)}%` }]} /></Card>
    </div>
  );
}
