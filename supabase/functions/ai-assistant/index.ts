// Edge Function: assistente administrativo com Claude (somente leitura).
// Segredos necessários: ANTHROPIC_API_KEY (supabase secrets set ANTHROPIC_API_KEY=...).
import Anthropic from 'npm:@anthropic-ai/sdk@1.7.0';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { cors, json } from '../_shared/cors.ts';
import { runAgent } from './agent.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);
  if (!Deno.env.get('ANTHROPIC_API_KEY')) return json({ error: 'assistente não configurado (ANTHROPIC_API_KEY ausente)' }, 503);

  // Cliente com o JWT do usuário: todas as consultas respeitam RLS e permissões
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false },
  });
  const { data: allowed } = await db.rpc('has_perm', { p_code: 'ai.use' });
  if (!allowed) return json({ error: 'Permissão negada (ai.use)' }, 403);
  const { data: settings } = await db.from('company_settings').select('ai_enabled,timezone').eq('id', 1).maybeSingle();
  if (!settings?.ai_enabled) return json({ error: 'assistente desativado em Configurações' }, 403);

  const body = await req.json().catch(() => ({}));
  const question = String(body.question ?? '').slice(0, 2000).trim();
  if (!question) return json({ error: 'Pergunta vazia' }, 400);
  const history = Array.isArray(body.history) ? body.history.slice(-8).filter((h: any) => ['user', 'assistant'].includes(h?.role) && typeof h?.text === 'string') : [];

  const tz = settings.timezone ?? 'America/Sao_Paulo';
  const today = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, dateStyle: 'full' }).format(new Date())
    + ` (${new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())})`;

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data;
  };
  const select = async (view: string, limit: number) => {
    const { data, error } = await db.from(view).select('*').limit(limit);
    if (error) throw new Error(error.message);
    return data;
  };

  try {
    const result = await runAgent({ client: new Anthropic(), question, history, rpc, select, today, tz });
    await db.rpc('log_action', { p_action: 'AI_QUERY', p_entity: 'ai-assistant', p_entity_id: null, p_new: { question, tools: result.tools } }).catch(() => {});
    return json(result);
  } catch (e) {
    const status = e instanceof Anthropic.RateLimitError ? 429 : e instanceof Anthropic.APIError ? 502 : 500;
    return json({ error: `Falha ao consultar o assistente: ${(e as Error).message}` }, status);
  }
});
