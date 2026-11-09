// Servidor de desenvolvimento LOCAL compatível com o endpoint RPC do PostgREST/Supabase
// (POST /rest/v1/rpc/<função>). Permite rodar o site de pedidos contra um PostgreSQL local
// com as migrações aplicadas, executando como o papel "anon" — as mesmas regras de segurança.
// NÃO usar em produção: em produção use o Supabase (PostgREST + Auth + Realtime).
import http from 'node:http';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/rotisseria_test' });
const PORT = Number(process.env.PORT ?? 54321);

async function argTypes(client, fn) {
  const r = await client.query(
    `select unnest(proargnames) n, unnest(proargtypes::regtype[]::text[]) t from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'public' and p.proname = $1`, [fn]);
  return Object.fromEntries(r.rows.map((x) => [x.n, x.t]));
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.end();
  const m = req.url.match(/^\/rest\/v1\/rpc\/([a-z][a-z0-9_]*)/);
  if (!m) { res.statusCode = 404; return res.end('{"message":"not found"}'); }
  let body = '';
  for await (const chunk of req) body += chunk;
  const args = body ? JSON.parse(body) : {};
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role anon');
    await client.query("select set_config('request.headers', $1, true)",
      [JSON.stringify({ 'user-agent': req.headers['user-agent'] ?? '', 'x-forwarded-for': req.socket.remoteAddress })]);
    const types = await argTypes(client, m[1]);
    const names = Object.keys(args).filter((n) => /^[a-z_][a-z0-9_]*$/.test(n));
    const sql = `select public.${m[1]}(${names.map((n, i) => `${n} => $${i + 1}::${types[n] ?? 'text'}`).join(', ')}) as r`;
    const vals = names.map((n) => (args[n] !== null && typeof args[n] === 'object' ? JSON.stringify(args[n]) : args[n]));
    const r = await client.query(sql, vals);
    await client.query('commit');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(r.rows[0]?.r ?? null));
  } catch (e) {
    await client.query('rollback').catch(() => {});
    res.statusCode = e.code === '42501' ? 401 : 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ message: e.message, code: e.code, details: e.detail ?? null, hint: e.hint ?? null }));
  } finally { client.release(); }
});
server.listen(PORT, () => console.log(`API local (RPC) em http://localhost:${PORT}/rest/v1/rpc/*`));
