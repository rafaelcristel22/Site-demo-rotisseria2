import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function Login() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ t: string; ok?: boolean } | null>(null);
  const [mode, setMode] = useState<'login' | 'recover'>('login');

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    if (mode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMsg({ t: error.message.includes('Invalid') ? 'E-mail ou senha incorretos.' : error.message });
    } else {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/admin/redefinir-senha` });
      setMsg(error ? { t: error.message } : { t: 'Se o e-mail estiver cadastrado, você receberá um link para criar nova senha.', ok: true });
    }
    setBusy(false);
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-md border border-char/10 bg-white p-6">
        <h1 className="heading text-[28px] leading-none">Área da equipe</h1>
        <p className="mt-1 text-sm text-stone-500">{mode === 'login' ? 'Entre com seu e-mail e senha.' : 'Informe seu e-mail para redefinir a senha.'}</p>
        <label className="mt-5 block"><span className="label">E-mail</span>
          <input className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        {mode === 'login' && <label className="mt-3 block"><span className="label">Senha</span>
          <input className="input" type="password" autoComplete="current-password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} /></label>}
        {msg && <p role="alert" className={`mt-3 text-sm ${msg.ok ? 'text-green-800' : 'text-red-700'}`}>{msg.t}</p>}
        <button className="btn-dark mt-5 w-full py-3" disabled={busy}>{busy ? 'Aguarde…' : mode === 'login' ? 'Entrar' : 'Enviar link'}</button>
        <button type="button" className="mt-3 w-full text-center text-sm text-stone-500 underline" onClick={() => { setMode(mode === 'login' ? 'recover' : 'login'); setMsg(null); }}>
          {mode === 'login' ? 'Esqueci minha senha' : 'Voltar ao login'}</button>
      </form>
    </div>
  );
}

export function ResetPassword() {
  const [p1, setP1] = useState(''); const [p2, setP2] = useState(''); const [msg, setMsg] = useState('');
  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4">
      <form className="w-full max-w-sm rounded-md border border-char/10 bg-white p-6" onSubmit={async (e) => {
        e.preventDefault();
        if (p1 !== p2) return setMsg('As senhas não conferem.');
        const { error } = await supabase.auth.updateUser({ password: p1 });
        setMsg(error ? error.message : 'Senha alterada. Você já pode usar o sistema.');
      }}>
        <h1 className="heading text-2xl">Nova senha</h1>
        <input className="input mt-4" type="password" minLength={8} required placeholder="Nova senha (mín. 8)" value={p1} onChange={(e) => setP1(e.target.value)} />
        <input className="input mt-3" type="password" minLength={8} required placeholder="Repita a senha" value={p2} onChange={(e) => setP2(e.target.value)} />
        {msg && <p className="mt-3 text-sm">{msg}</p>}
        <button className="btn-dark mt-4 w-full">Salvar</button>
        <a href="/admin" className="mt-3 block text-center text-sm underline">Ir para o painel</a>
      </form>
    </div>
  );
}
