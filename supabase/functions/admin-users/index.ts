// Cria usuários da equipe com a chave de serviço (nunca exposta ao navegador).
// Só executa se quem chama tiver a permissão users.manage (verificada no banco com o JWT dele).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { cors, json } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);
  const url = Deno.env.get('SUPABASE_URL')!;
  const auth = req.headers.get('Authorization') ?? '';
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data: allowed, error: permErr } = await asUser.rpc('has_perm', { p_code: 'users.manage' });
  if (permErr || !allowed) return json({ error: 'Permissão negada' }, 403);

  const { email, password, full_name, role_code } = await req.json().catch(() => ({}));
  if (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'E-mail inválido' }, 400);
  if (typeof password !== 'string' || password.length < 8) return json({ error: 'A senha deve ter ao menos 8 caracteres' }, 400);
  if (typeof role_code !== 'string' || role_code === 'admin') return json({ error: 'Papel inválido' }, 400);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: String(full_name ?? '').slice(0, 120) },
    app_metadata: { role_code, invited: true }, // lido pelo gatilho handle_new_auth_user (não editável pelo usuário)
  });
  if (error) return json({ error: error.message }, 400);
  return json({ id: data.user?.id });
});
