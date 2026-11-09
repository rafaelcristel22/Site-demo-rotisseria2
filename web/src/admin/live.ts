import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

/** Atualiza em tempo real (Supabase Realtime) com recarga periódica de segurança. */
export function useLive(tables: string[], reload: () => void, intervalMs = 15000) {
  const ref = useRef(reload); ref.current = reload;
  useEffect(() => {
    ref.current();
    const ch = supabase.channel(`live-${tables.join('-')}-${Math.random().toString(36).slice(2)}`);
    tables.forEach((t) => ch.on('postgres_changes' as any, { event: '*', schema: 'public', table: t }, () => ref.current()));
    ch.subscribe();
    const iv = setInterval(() => ref.current(), intervalMs);
    return () => { clearInterval(iv); supabase.removeChannel(ch); };
  }, [tables.join(','), intervalMs]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Bipe curto para novos pedidos (sem arquivo de áudio). */
export function beep() {
  try {
    const ctx = new AudioContext(); const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = 880; o.connect(g); g.connect(ctx.destination); g.gain.value = 0.15;
    o.start(); setTimeout(() => { o.frequency.value = 660; }, 150); setTimeout(() => { o.stop(); ctx.close(); }, 320);
  } catch { /* sem áudio */ }
}

export function minutesSince(iso: string | null | undefined) {
  return iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 60000) : 0;
}
