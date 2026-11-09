import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, rpc } from '../lib/supabase';

export interface Me {
  id: string; email: string; full_name: string; role_code: string; role_name: string; is_active: boolean;
  has_pin: boolean; max_discount_percent: number; permissions: string[];
}
interface Ctx { session: Session | null; me: Me | null; loading: boolean; can: (p: string) => boolean; refresh: () => Promise<void>; signOut: () => Promise<void> }
const AuthCtx = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    try { setMe(await rpc<Me | null>('me')); } catch { setMe(null); }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session) await loadMe();
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => {
      setSession(s);
      if (s) await loadMe(); else setMe(null);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadMe]);

  const can = useCallback((p: string) => !!me && me.is_active && (me.role_code === 'admin' || me.permissions.includes(p)), [me]);
  return (
    <AuthCtx.Provider value={{ session, me, loading, can, refresh: loadMe, signOut: async () => { await supabase.auth.signOut(); setMe(null); } }}>
      {children}
    </AuthCtx.Provider>
  );
}
export function useAuth() { const c = useContext(AuthCtx); if (!c) throw new Error('AuthProvider ausente'); return c; }
