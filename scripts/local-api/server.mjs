// =====================================================================
// API LOCAL DE DESENVOLVIMENTO — subconjunto compatível com o Supabase
//   • /auth/v1/token (password / refresh_token), /auth/v1/user, /auth/v1/logout, /auth/v1/signup
//   • /rest/v1/rpc/<função>                (POST)
//   • /rest/v1/<tabela>?select=&filtros    (GET, POST, PATCH, DELETE)
// Executa cada requisição como "anon" ou "authenticated" (com o sub do JWT),
// portanto as políticas RLS do banco valem exatamente como no Supabase.
// Uso: node server.mjs   (DATABASE_URL, PORT, JWT_SECRET opcionais)
// NÃO usar em produção — em produção use o Supabase (PostgREST + GoTrue + Realtime).
// =====================================================================
import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';

// tipos como o PostgREST devolve em JSON: date → 'AAAA-MM-DD', numeric/bigint → número
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/rotisseria_test' });
const PORT = Number(process.env.PORT ?? 54321);
const SECRET = process.env.JWT_SECRET ?? crypto.randomBytes(32).toString('hex');
const IDENT = /^[a-z_][a-z0-9_]*$/;
const OPS = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'like', ilike: 'ilike' };

// ---------------- JWT (HS256) ----------------
const b64u = (b) => Buffer.from(b).toString('base64url');
function sign(payload) {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify(payload));
  return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`;
}
function verify(token) {
  const [h, p, s] = (token ?? '').split('.');
  if (!s) return null;
  const exp = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url');
  if (exp.length !== s.length || !crypto.timingSafeEqual(Buffer.from(exp), Buffer.from(s))) return null;
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  return claims.exp * 1000 > Date.now() ? claims : null;
}
const refreshTokens = new Map();
function session(user) {
  const now = Math.floor(Date.now() / 1000);
  const access = sign({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600 });
  const refresh = crypto.randomBytes(24).toString('hex');
  refreshTokens.set(refresh, user.id);
  return { access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: refresh, user: userJson(user) };
}
const userJson = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, user_metadata: u.raw_user_meta_data ?? {},
  app_metadata: { provider: 'email' }, created_at: u.created_at });

// ---------------- util ----------------
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}
async function readBody(req) { let b = ''; for await (const c of req) b += c; return b ? JSON.parse(b) : null; }

async function withRole(req, fn) {
  const auth = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const claims = verify(auth);
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(claims ? 'set local role authenticated' : 'set local role anon');
    await client.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true), set_config('request.headers', $3, true)",
      [claims?.sub ?? '', JSON.stringify(claims ?? { role: 'anon' }),
       JSON.stringify({ 'user-agent': req.headers['user-agent'] ?? '', 'x-forwarded-for': req.socket.remoteAddress })]);
    const r = await fn(client);
    await client.query('commit');
    return r;
  } catch (e) { await client.query('rollback').catch(() => {}); throw e; }
  finally { client.release(); }
}

// ---------------- filtros estilo PostgREST ----------------
function parseValue(raw) { return raw; }
function buildWhere(params, vals) {
  const parts = [];
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    if (k === 'or') { // or=(a.eq.1,b.ilike.*x*)
      const inner = v.replace(/^\(|\)$/g, '').split(',').map((cond) => {
        const [col, op, ...rest] = cond.split('.');
        return cond1(col, op, rest.join('.'), vals);
      });
      parts.push(`(${inner.join(' or ')})`);
      continue;
    }
    const m = v.match(/^(not\.)?([a-z]+)\.(.*)$/s);
    if (!m) throw new Error(`filtro inválido: ${k}`);
    const c = cond1(k, m[2], m[3], vals);
    parts.push(m[1] ? `not (${c})` : c);
  }
  return parts.length ? `where ${parts.join(' and ')}` : '';
}
function cond1(col, op, raw, vals) {
  if (!IDENT.test(col)) throw new Error(`coluna inválida: ${col}`);
  if (op === 'is') return `"${col}" is ${raw === 'null' ? 'null' : raw === 'true' ? 'true' : 'false'}`;
  if (op === 'in') {
    const items = raw.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, ''));
    vals.push(items); return `"${col}"::text = any($${vals.length}::text[])`;
  }
  if (op === 'cs') { vals.push(raw); return `"${col}" @> $${vals.length}`; }
  const sqlop = OPS[op]; if (!sqlop) throw new Error(`operador não suportado: ${op}`);
  if (op.endsWith('like')) { vals.push(raw.replace(/\*/g, '%')); return `"${col}"::text ${sqlop} $${vals.length}`; }
  vals.push(parseValue(raw)); // o tipo do parâmetro é inferido pela coluna
  return `"${col}" ${sqlop} $${vals.length}`;
}
function buildSelect(sel) {
  if (!sel || sel === '*') return '*';
  return sel.split(',').map((c) => { const [name, alias] = c.trim().split(':').reverse(); if (!IDENT.test(name)) throw new Error(`coluna inválida: ${name}`);
    return alias && IDENT.test(alias) ? `"${name}" as "${alias}"` : `"${name}"`; }).join(', ');
}
function buildOrder(o) {
  if (!o) return '';
  return 'order by ' + o.split(',').map((x) => { const [c, dir, nulls] = x.split('.'); if (!IDENT.test(c)) throw new Error('ordem inválida');
    return `"${c}" ${dir === 'desc' ? 'desc' : 'asc'}${nulls === 'nullslast' ? ' nulls last' : nulls === 'nullsfirst' ? ' nulls first' : ''}`; }).join(', ');
}

async function argTypes(client, fn) {
  const r = await client.query(`select unnest(proargnames) n, unnest(proargtypes::regtype[]::text[]) t from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = $1`, [fn]);
  return Object.fromEntries(r.rows.map((x) => [x.n, x.t]));
}

// ---------------- servidor ----------------
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range');
  if (req.method === 'OPTIONS') return res.end();
  const url = new URL(req.url, 'http://x');
  try {
    // ---- AUTH ----
    if (url.pathname === '/auth/v1/token') {
      const body = await readBody(req);
      const c = await pool.connect();
      try {
        if (url.searchParams.get('grant_type') === 'refresh_token') {
          const id = refreshTokens.get(body.refresh_token);
          if (!id) return send(res, 400, { error: 'invalid_grant', error_description: 'Sessão expirada' });
          refreshTokens.delete(body.refresh_token);
          const u = (await c.query('select * from auth.users where id = $1', [id])).rows[0];
          return send(res, 200, session(u));
        }
        const u = (await c.query("select * from auth.users where lower(email) = lower($1) and encrypted_password = extensions.crypt($2, encrypted_password)", [body.email, body.password])).rows[0];
        if (!u) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' });
        return send(res, 200, session(u));
      } finally { c.release(); }
    }
    if (url.pathname === '/auth/v1/signup') {
      const body = await readBody(req);
      const c = await pool.connect();
      try {
        const u = (await c.query("insert into auth.users(email, encrypted_password, raw_user_meta_data) values ($1, extensions.crypt($2, extensions.gen_salt('bf', 8)), $3) returning *",
          [body.email, body.password, body.data ?? {}])).rows[0];
        return send(res, 200, session(u));
      } finally { c.release(); }
    }
    if (url.pathname === '/auth/v1/user') {
      const claims = verify((req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''));
      if (!claims) return send(res, 401, { msg: 'invalid JWT' });
      const c = await pool.connect();
      try { const u = (await c.query('select * from auth.users where id = $1', [claims.sub])).rows[0]; return send(res, 200, userJson(u)); }
      finally { c.release(); }
    }
    if (url.pathname === '/auth/v1/logout') return send(res, 204);
    if (url.pathname === '/auth/v1/recover') return send(res, 200, {});

    // ---- Edge Function local: criar usuário da equipe (equivale a supabase/functions/admin-users) ----
    if (url.pathname === '/functions/v1/admin-users' && req.method === 'POST') {
      const body = await readBody(req);
      const allowed = await withRole(req, async (c) => (await c.query("select public.has_perm('users.manage') ok")).rows[0].ok);
      if (!allowed) return send(res, 403, { error: 'Permissão negada' });
      const c = await pool.connect();
      try {
        const u = (await c.query("insert into auth.users(email, encrypted_password, raw_user_meta_data, raw_app_meta_data) values ($1, extensions.crypt($2, extensions.gen_salt('bf', 8)), $3, $4) returning id",
          [body.email, body.password, { full_name: body.full_name }, { role_code: body.role_code, invited: true }])).rows[0];
        return send(res, 200, { id: u.id });
      } catch (e) { return send(res, 400, { error: e.message }); } finally { c.release(); }
    }

    // ---- RPC ----
    const rpcM = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z][a-z0-9_]*)$/);
    if (rpcM) {
      const args = (await readBody(req)) ?? Object.fromEntries(url.searchParams);
      const result = await withRole(req, async (c) => {
        const types = await argTypes(c, rpcM[1]);
        const retset = (await c.query(`select bool_or(proretset) s, max(prorettype::regtype::text) t from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname=$1`, [rpcM[1]])).rows[0];
        const names = Object.keys(args).filter((n) => IDENT.test(n));
        const call = `public.${rpcM[1]}(${names.map((n, i) => `${n} => $${i + 1}::${types[n] ?? 'text'}`).join(', ')})`;
        const vals = names.map((n) => (args[n] !== null && typeof args[n] === 'object' ? JSON.stringify(args[n]) : args[n]));
        const composite = retset.s || !['jsonb', 'json', 'text', 'uuid', 'numeric', 'integer', 'bigint', 'boolean', 'void', 'date', 'timestamp with time zone'].includes(retset.t);
        if (composite) {
          const rows = (await c.query(`select * from ${call} r`, vals)).rows;
          if (retset.s) return rows;
          // função que devolve um único registro: objeto (ou null se todos os campos forem nulos), como no PostgREST
          return rows[0] && Object.values(rows[0]).some((v) => v !== null) ? rows[0] : null;
        }
        return (await c.query(`select ${call} as r`, vals)).rows[0]?.r ?? null;
      });
      return send(res, 200, result);
    }

    // ---- TABELAS ----
    const tM = url.pathname.match(/^\/rest\/v1\/([a-z][a-z0-9_]*)$/);
    if (tM) {
      const table = tM[1];
      const prefer = req.headers.prefer ?? '';
      const params = [...url.searchParams.entries()];
      const sel = buildSelect(url.searchParams.get('select'));
      const out = await withRole(req, async (c) => {
        const vals = [];
        if (req.method === 'GET' || req.method === 'HEAD') {
          const where = buildWhere(params, vals);
          const limit = url.searchParams.get('limit'); const offset = url.searchParams.get('offset');
          let range = req.headers.range?.match(/(\d+)-(\d+)/);
          const lim = limit ? Number(limit) : range ? Number(range[2]) - Number(range[1]) + 1 : null;
          const off = offset ? Number(offset) : range ? Number(range[1]) : 0;
          const q = `select ${sel} from public."${table}" ${where} ${buildOrder(url.searchParams.get('order'))} ${lim ? `limit ${lim}` : ''} offset ${off}`;
          const rows = (await c.query(q, vals)).rows;
          let count = '*';
          if (prefer.includes('count=exact')) count = (await c.query(`select count(*)::int n from public."${table}" ${where}`, vals)).rows[0].n;
          return { rows, range: `${off}-${off + rows.length - 1}/${count}` };
        }
        const body = await readBody(req);
        if (req.method === 'POST') {
          const rows = Array.isArray(body) ? body : [body];
          const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => IDENT.test(k));
          const tuples = rows.map((r) => `(${cols.map((k) => { vals.push(r[k] !== null && typeof r[k] === 'object' && !Array.isArray(r[k]) ? JSON.stringify(r[k]) : r[k] ?? null); return r[k] === undefined ? 'default' : `$${vals.length}`; }).join(', ')})`);
          const upsert = prefer.includes('resolution=merge-duplicates') ? ` on conflict (${(url.searchParams.get('on_conflict') ?? 'id').split(',').filter((x) => IDENT.test(x)).join(',')}) do update set ${cols.map((k) => `"${k}" = excluded."${k}"`).join(', ')}` : '';
          return { rows: (await c.query(`insert into public."${table}" (${cols.map((k) => `"${k}"`).join(', ')}) values ${tuples.join(', ')}${upsert} returning ${sel}`, vals)).rows };
        }
        if (req.method === 'PATCH') {
          const cols = Object.keys(body).filter((k) => IDENT.test(k));
          const sets = cols.map((k) => { const v = body[k]; vals.push(v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v); return `"${k}" = $${vals.length}`; });
          const where = buildWhere(params, vals);
          if (!where) throw new Error('UPDATE sem filtro não é permitido');
          return { rows: (await c.query(`update public."${table}" set ${sets.join(', ')} ${where} returning ${sel}`, vals)).rows };
        }
        if (req.method === 'DELETE') {
          const where = buildWhere(params, vals);
          if (!where) throw new Error('DELETE sem filtro não é permitido');
          return { rows: (await c.query(`delete from public."${table}" ${where} returning ${sel}`, vals)).rows };
        }
        throw new Error('método não suportado');
      });
      const single = (req.headers.accept ?? '').includes('vnd.pgrst.object');
      if (single) {
        if (out.rows.length !== 1) return send(res, 406, { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' });
        return send(res, 200, out.rows[0]);
      }
      const ret = req.method === 'GET' || prefer.includes('return=representation');
      return send(res, ret ? 200 : 201, ret ? out.rows : undefined, out.range ? { 'Content-Range': out.range } : {});
    }
    return send(res, 404, { message: 'rota não encontrada' });
  } catch (e) {
    return send(res, e.code === '42501' ? 403 : 400, { message: e.message, code: e.code ?? 'LOCAL', details: e.detail ?? null, hint: e.hint ?? null });
  }
});
server.listen(PORT, () => console.log(`API local em http://localhost:${PORT}  (auth, rest, rpc)`));
