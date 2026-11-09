import { describe, it, expect } from 'vitest';
import { EscPos, line, center, plain, COLS } from './escpos';

describe('ESC/POS', () => {
  it('remove acentos', () => expect(plain('Coração à brasa')).toBe('Coracao a brasa'));
  it('alinha valor à direita em 32 colunas', () => {
    const l = line('Frango assado', 'R$ 54,90', COLS[58]);
    expect(l).toHaveLength(32);
    expect(l.endsWith('R$ 54,90')).toBe(true);
  });
  it('quebra linha quando o texto não cabe', () => {
    expect(line('x'.repeat(40), '9,90', 32)).toContain('\n');
  });
  it('centraliza', () => expect(center('OK', 6)).toBe('  OK'));
  it('gera comando de gaveta e corte', () => {
    const b = new EscPos().ln('teste').drawer().cut().build();
    expect(Array.from(b.slice(0, 2))).toEqual([0x1b, 0x40]);
    expect(Array.from(b)).toEqual(expect.arrayContaining([0x1b, 0x70, 0x00]));
    expect(Array.from(b.slice(-4))).toEqual([0x1d, 0x56, 0x42, 0x00]);
  });
});
