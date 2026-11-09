import { describe, it, expect } from 'vitest';
import { addLine, setQuantity, subtotal, validateOptions, unitPrice, deliveryFee, changeDue, lineKey, type CartLine } from './cart';
import type { MenuProduct } from './types';

const product: MenuProduct = {
  id: 'p1', category_id: 'c1', name: 'Frango', description: null, image_url: null, price: 54.9, list_price: 54.9,
  promotion: null, product_type: 'preparado', unit: 'un', serves: 4, tags: [], is_featured: false, is_popular: false,
  sold_out: false, prep_time_minutes: 20, combo_items: [],
  option_groups: [
    { id: 'g1', name: 'Adicionais', min_select: 0, max_select: 2, options: [{ id: 'o1', name: 'Farofa', price_delta: 6 }, { id: 'o2', name: 'Molho', price_delta: 3 }, { id: 'o3', name: 'Batata', price_delta: 9.9 }] },
    { id: 'g2', name: 'Ponto', min_select: 1, max_select: 1, options: [{ id: 'o4', name: 'Normal', price_delta: 0 }, { id: 'o5', name: 'Bem passado', price_delta: 0 }] },
  ],
};
const line = (over: Partial<CartLine> = {}): CartLine => ({ key: 'k', product_id: 'p1', name: 'Frango', unit_price: 10, quantity: 1,
  option_ids: [], option_labels: [], notes: '', image_url: null, category_id: 'c1', ...over });

describe('carrinho', () => {
  it('soma itens iguais na mesma linha', () => {
    const l = addLine(addLine([], line()), line({ quantity: 2 }));
    expect(l).toHaveLength(1);
    expect(l[0].quantity).toBe(3);
  });
  it('remove ao zerar quantidade', () => {
    expect(setQuantity([line()], 'k', 0)).toHaveLength(0);
  });
  it('calcula subtotal sem erro de ponto flutuante', () => {
    expect(subtotal([line({ unit_price: 0.1, quantity: 3 }), line({ key: 'b', unit_price: 0.2 })])).toBe(0.5);
  });
  it('chave da linha independe da ordem das opções', () => {
    expect(lineKey('p', ['b', 'a'], ' Sem sal ')).toBe(lineKey('p', ['a', 'b'], 'sem sal'));
  });
});

describe('opções', () => {
  it('exige opção obrigatória', () => {
    expect(validateOptions(product.option_groups, [])).toMatch(/Ponto/);
  });
  it('respeita máximo', () => {
    expect(validateOptions(product.option_groups, ['o1', 'o2', 'o3', 'o4'])).toMatch(/Máximo/);
  });
  it('aceita seleção válida e soma adicionais', () => {
    expect(validateOptions(product.option_groups, ['o1', 'o4'])).toBeNull();
    expect(unitPrice(product, ['o1', 'o2', 'o4'])).toBe(63.9);
  });
});

describe('entrega e troco', () => {
  it('frete grátis acima do valor', () => {
    expect(deliveryFee(100, { fee: 7, free_delivery_above: 80 })).toBe(0);
    expect(deliveryFee(50, { fee: 7, free_delivery_above: 80 })).toBe(7);
  });
  it('troco', () => {
    expect(changeDue(87.3, 100)).toBe(12.7);
    expect(changeDue(87.3, 50)).toBeNull();
  });
});
