/**
 * Geração de comandos ESC/POS para impressoras térmicas 58 mm (32 col.) e 80 mm (48 col.)
 * e envio via Web Serial (Chrome/Edge). Também abre a gaveta de dinheiro (pulso ESC p).
 */
export const COLS = { 58: 32, 80: 48 } as const;
const ESC = 0x1b, GS = 0x1d;

/** Remove acentos (a maioria das impressoras usa CP850/CP437 sem suporte completo a UTF-8). */
export const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e\n]/g, '');

export function line(left: string, right: string, cols: number) {
  const l = plain(left), r = plain(right);
  const space = cols - r.length;
  if (l.length <= space - 1) return l + ' '.repeat(space - l.length) + r;
  return l.slice(0, cols) + '\n' + ' '.repeat(Math.max(cols - r.length, 0)) + r;
}
export function center(s: string, cols: number) {
  const t = plain(s).slice(0, cols);
  return ' '.repeat(Math.floor((cols - t.length) / 2)) + t;
}
export const rule = (cols: number, ch = '-') => ch.repeat(cols);

export class EscPos {
  private bytes: number[] = [ESC, 0x40]; // inicializa
  text(s: string) { for (const c of plain(s)) this.bytes.push(c.charCodeAt(0)); return this; }
  ln(s = '') { return this.text(s + '\n'); }
  bold(on: boolean) { this.bytes.push(ESC, 0x45, on ? 1 : 0); return this; }
  size(double: boolean) { this.bytes.push(GS, 0x21, double ? 0x11 : 0x00); return this; }
  align(a: 'left' | 'center' | 'right') { this.bytes.push(ESC, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2); return this; }
  feed(n = 3) { this.bytes.push(ESC, 0x64, n); return this; }
  cut() { this.bytes.push(GS, 0x56, 0x42, 0x00); return this; }
  drawer() { this.bytes.push(ESC, 0x70, 0x00, 0x19, 0xfa); return this; } // pulso no pino 2
  build() { return new Uint8Array(this.bytes); }
}

interface SerialPortLike { open(o: { baudRate: number }): Promise<void>; writable: WritableStream<Uint8Array>; close(): Promise<void> }
/** Envia bytes à impressora pela Web Serial. Requer gesto do usuário na primeira vez. */
export async function sendSerial(data: Uint8Array, baudRate = 9600) {
  const nav = navigator as unknown as { serial?: { requestPort(): Promise<SerialPortLike>; getPorts(): Promise<SerialPortLike[]> } };
  if (!nav.serial) throw new Error('Este navegador não suporta Web Serial. Use Chrome/Edge ou a impressão pelo navegador.');
  const port = (await nav.serial.getPorts())[0] ?? (await nav.serial.requestPort());
  await port.open({ baudRate });
  const w = port.writable.getWriter();
  try { await w.write(data); } finally { w.releaseLock(); await port.close(); }
}
