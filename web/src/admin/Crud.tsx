import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Plus, Search, Upload } from 'lucide-react';
import { supabase, cleanError } from '../lib/supabase';
import { money, dateBR } from '../lib/format';
import { Field, Modal, PageHeader, Table, useToast, Badge, type Col } from './ui';
import { useAuth } from './auth';

export interface FieldDef {
  name: string; label: string;
  type?: 'text' | 'textarea' | 'number' | 'money' | 'date' | 'time' | 'bool' | 'select' | 'ref' | 'tags' | 'image' | 'email' | 'tel' | 'color' | 'json';
  options?: { value: string; label: string }[];
  ref?: { table: string; label: string; filter?: Record<string, string> };
  required?: boolean; hint?: string; wide?: boolean; step?: string; min?: number; max?: number;
  bucket?: string; readOnly?: boolean; default?: unknown;
}
export interface CrudConfig {
  table: string; title: string; subtitle?: string; perm: string; fields: FieldDef[];
  columns: Col<any>[]; order?: string; search?: string[]; filter?: Record<string, string>;
  canDelete?: boolean; rowActions?: (row: any, reload: () => void) => ReactNode; headerExtra?: ReactNode;
  transform?: (data: Record<string, unknown>) => Record<string, unknown>; embedded?: boolean; limit?: number; pk?: string;
}

export function useRefs(fields: FieldDef[]) {
  const [refs, setRefs] = useState<Record<string, { value: string; label: string }[]>>({});
  const key = fields.filter((f) => f.ref).map((f) => f.ref!.table + f.ref!.label).join('|');
  useEffect(() => {
    fields.filter((f) => f.type === 'ref' && f.ref).forEach(async (f) => {
      let q = supabase.from(f.ref!.table).select(`id,${f.ref!.label}`).order(f.ref!.label).limit(1000);
      for (const [k, v] of Object.entries(f.ref!.filter ?? {})) q = q.eq(k, v);
      const { data } = await q;
      setRefs((r) => ({ ...r, [f.name]: (data ?? []).map((x: any) => ({ value: x.id, label: x[f.ref!.label] })) }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return refs;
}

export default function Crud({ cfg }: { cfg: CrudConfig }) {
  const { can } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(true);
  const refs = useRefs(cfg.fields);
  const manage = can(cfg.perm);

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase.from(cfg.table).select('*').limit(cfg.limit ?? 500);
    for (const [k, v] of Object.entries(cfg.filter ?? {})) query = query.eq(k, v);
    if (q.trim() && cfg.search?.length) query = query.or(cfg.search.map((c) => `${c}.ilike.*${q.trim().replace(/[,()*]/g, ' ')}*`).join(','));
    const [col, dir] = (cfg.order ?? 'created_at.desc').split('.');
    query = query.order(col, { ascending: dir !== 'desc' });
    const { data, error } = await query;
    if (error) toast(cleanError(error.message), 'err');
    setRows(data ?? []); setLoading(false);
  }, [cfg.table, cfg.order, cfg.limit, JSON.stringify(cfg.filter), q]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

  const newRow = useMemo(() => Object.fromEntries([
    ...cfg.fields.filter((f) => f.default !== undefined).map((f) => [f.name, f.default]),
    ...Object.entries(cfg.filter ?? {}),
  ]), [cfg]);

  async function save(data: Record<string, any>) {
    const payload: Record<string, unknown> = {};
    for (const f of cfg.fields) {
      if (f.readOnly) continue;
      let v = data[f.name];
      if (v === '' || v === undefined) v = f.type === 'bool' ? false : f.type === 'tags' ? [] : null;
      if ((f.type === 'number' || f.type === 'money') && v !== null) v = Number(String(v).replace(',', '.'));
      if (f.type === 'json' && typeof v === 'string') { try { v = JSON.parse(v); } catch { throw new Error(`${f.label}: JSON inválido`); } }
      if (f.required && (v === null || v === '')) throw new Error(`Preencha: ${f.label}`);
      payload[f.name] = v;
    }
    Object.assign(payload, cfg.filter ?? {});
    const final = cfg.transform ? cfg.transform(payload) : payload;
    const pk = cfg.pk ?? 'id';
    const res = data.__existing || data.id ? await supabase.from(cfg.table).update(final).eq(pk, data[pk]) : await supabase.from(cfg.table).insert(final);
    if (res.error) throw new Error(cleanError(res.error.message));
  }

  async function remove(id: string) {
    if (!confirm('Excluir este registro? Esta ação é registrada na auditoria.')) return;
    const { error } = await supabase.from(cfg.table).delete().eq(cfg.pk ?? 'id', id);
    if (error) toast(cleanError(error.message).includes('foreign key') ? 'Registro em uso; desative em vez de excluir.' : cleanError(error.message), 'err');
    else { toast('Registro excluído'); setEditing(null); load(); }
  }

  const cols = cfg.rowActions ? [...cfg.columns, { key: '_a', label: '', align: 'right' as const, render: (r: any) => <span onClick={(e) => e.stopPropagation()}>{cfg.rowActions!(r, load)}</span> }] : cfg.columns;

  return (
    <div>
      {!cfg.embedded && <PageHeader title={cfg.title} subtitle={cfg.subtitle} actions={<>{cfg.headerExtra}
        {manage && <button className="btn-primary" onClick={() => setEditing({ ...newRow })}><Plus size={16} /> Novo</button>}</>} />}
      <div className="rounded-md border border-char/10 bg-white dark:border-white/10 dark:bg-stone-900">
        <div className="flex items-center gap-2 border-b border-char/10 px-3 py-2 dark:border-white/10">
          {cfg.search?.length ? <><Search size={16} className="text-stone-400" />
            <input className="w-full bg-transparent py-1 text-sm outline-none" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" /></> : <span className="flex-1" />}
          {cfg.embedded && manage && <button className="btn-outline py-1.5 text-sm" onClick={() => setEditing({ ...newRow })}><Plus size={14} /> Adicionar</button>}
          <span className="shrink-0 text-xs text-stone-400">{loading ? 'carregando…' : `${rows.length} registro(s)`}</span>
        </div>
        <Table cols={cols} rows={rows} rowKey={cfg.pk ?? 'id'} onRow={manage ? (r) => setEditing({ ...r, __existing: true }) : undefined} />
      </div>
      {editing && (
        <FormModal title={`${editing.__existing ? 'Editar' : 'Novo'} — ${cfg.title}`} fields={cfg.fields} refs={refs} initial={editing}
          onClose={() => setEditing(null)}
          onSave={async (d) => { await save(d); toast('Salvo'); setEditing(null); load(); }}
          onDelete={cfg.canDelete && editing.__existing ? () => remove(editing[cfg.pk ?? 'id']) : undefined} />
      )}
    </div>
  );
}

export function FormModal({ title, fields, refs, initial, onClose, onSave, onDelete, wide }: {
  title: string; fields: FieldDef[]; refs: Record<string, { value: string; label: string }[]>; initial: Record<string, any>;
  onClose: () => void; onSave: (d: Record<string, any>) => Promise<void>; onDelete?: () => void; wide?: boolean;
}) {
  const [d, setD] = useState<Record<string, any>>(() => ({ ...initial }));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const set = (k: string, v: unknown) => setD((x) => ({ ...x, [k]: v }));
  return (
    <Modal title={title} onClose={onClose} wide={wide ?? fields.length > 8} footer={<>
      {onDelete && <button className="btn-ghost mr-auto text-red-700" onClick={onDelete}>Excluir</button>}
      <button className="btn-outline" onClick={onClose}>Cancelar</button>
      <button className="btn-primary" disabled={busy} onClick={async () => {
        setBusy(true); setErr('');
        try { await onSave(d); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
      }}>Salvar</button></>}>
      <div className={`grid gap-3 ${fields.length > 8 ? 'sm:grid-cols-2' : ''}`}>
        {fields.map((f) => <div key={f.name} className={f.wide || f.type === 'textarea' || f.type === 'json' ? 'sm:col-span-2' : ''}>
          <FieldInput f={f} value={d[f.name]} onChange={(v) => set(f.name, v)} options={f.type === 'ref' ? refs[f.name] ?? [] : f.options} />
        </div>)}
      </div>
      {err && <p role="alert" className="mt-3 border-l-4 border-red-600 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</p>}
    </Modal>
  );
}

export function FieldInput({ f, value, onChange, options }: { f: FieldDef; value: any; onChange: (v: any) => void; options?: { value: string; label: string }[] }) {
  const common = { className: 'input', disabled: f.readOnly, required: f.required };
  if (f.type === 'bool') return (
    <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" className="h-4 w-4 accent-red-600" checked={!!value} disabled={f.readOnly} onChange={(e) => onChange(e.target.checked)} />{f.label}</label>);
  let input: ReactNode;
  switch (f.type) {
    case 'textarea': input = <textarea {...common} className="input min-h-[80px]" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />; break;
    case 'json': input = <textarea {...common} className="input min-h-[120px] font-mono text-xs" value={typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2)} onChange={(e) => onChange(e.target.value)} />; break;
    case 'select': case 'ref':
      input = <select {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">—</option>{(options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>; break;
    case 'number': case 'money':
      input = <input {...common} type="number" step={f.step ?? (f.type === 'money' ? '0.01' : 'any')} min={f.min} max={f.max} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />; break;
    case 'date': input = <input {...common} type="date" value={value ? String(value).slice(0, 10) : ''} onChange={(e) => onChange(e.target.value)} />; break;
    case 'time': input = <input {...common} type="time" value={value ? String(value).slice(0, 5) : ''} onChange={(e) => onChange(e.target.value)} />; break;
    case 'color': input = <input {...common} type="color" className="h-10 w-20 rounded border border-char/20" value={value ?? '#000000'} onChange={(e) => onChange(e.target.value)} />; break;
    case 'tags': input = <input {...common} value={(value ?? []).join(', ')} onChange={(e) => onChange(e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} placeholder="separe por vírgula" />; break;
    case 'image': input = <ImageInput value={value} onChange={onChange} bucket={f.bucket ?? 'product-images'} />; break;
    default: input = <input {...common} type={f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : 'text'} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
  }
  return <Field label={f.label + (f.required ? ' *' : '')} hint={f.hint}>{input}</Field>;
}

export function ImageInput({ value, onChange, bucket }: { value: string | null; onChange: (v: string | null) => void; bucket: string }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  async function upload(file: File) {
    setBusy(true); setErr('');
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Imagem acima de 5 MB');
      const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${file.name.split('.').pop()?.toLowerCase() ?? 'jpg'}`;
      const { error } = await supabase.storage.from(bucket).upload(path, file, { cacheControl: '31536000', upsert: false });
      if (error) throw new Error(error.message);
      onChange(supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl);
    } catch (e) { setErr(`Falha no envio: ${(e as Error).message}`); } finally { setBusy(false); }
  }
  return (
    <div className="flex items-start gap-3">
      {value ? <img src={value} alt="" className="h-20 w-20 rounded object-cover" /> : <div className="flex h-20 w-20 items-center justify-center rounded border border-dashed border-char/20 text-xs text-stone-400">sem foto</div>}
      <div className="flex-1 space-y-2">
        <label className="btn-outline cursor-pointer py-1.5 text-sm"><Upload size={14} /> {busy ? 'Enviando…' : 'Enviar foto'}
          <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></label>
        <input className="input py-1.5 text-xs" placeholder="ou cole a URL da imagem" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} />
        {value && <button type="button" className="text-xs text-red-700 underline" onClick={() => onChange(null)}>remover foto</button>}
        {err && <p className="text-xs text-red-700">{err}</p>}
      </div>
    </div>
  );
}

// renderizadores comuns
export const r = {
  money: (k: string) => (row: any) => money(row[k]),
  date: (k: string) => (row: any) => dateBR(row[k]),
  bool: (k: string, yes = 'Sim', no = 'Não') => (row: any) => row[k] ? <Badge tone="good">{yes}</Badge> : <Badge>{no}</Badge>,
  active: (row: any) => row.is_active === false ? <Badge>Inativo</Badge> : <Badge tone="good">Ativo</Badge>,
  label: (map: Record<string, string>, k: string) => (row: any) => map[row[k]] ?? row[k] ?? '—',
};
