// Ajuste ALLOWED_ORIGIN (variável de ambiente) para o domínio do painel em produção.
const origin = Deno.env.get('ALLOWED_ORIGIN') ?? '*';
export const cors = {
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
