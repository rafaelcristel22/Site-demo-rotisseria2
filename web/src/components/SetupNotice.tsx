export default function SetupNotice() {
  return (
    <div className="mx-auto max-w-lg p-6 pt-16">
      <h1 className="font-display text-2xl font-bold">Configuração necessária</h1>
      <p className="mt-3 text-stone-600">
        O sistema não está conectado ao banco de dados. Crie o arquivo <code className="rounded bg-stone-200 px-1">web/.env.local</code> com
        <code className="rounded bg-stone-200 px-1">VITE_SUPABASE_URL</code> e <code className="rounded bg-stone-200 px-1">VITE_SUPABASE_ANON_KEY</code>
        do seu projeto Supabase e aplique as migrações (veja <b>docs/IMPLANTACAO.md</b>).
      </p>
    </div>
  );
}
