import { useEffect, useState } from 'react';
import { rpc } from '../lib/supabase';
import { timeBR } from '../lib/format';

const KEY = 'erp.kiosk.device'; // token do tablet autorizado (configuração local do aparelho)
const PT: Record<string, string> = { entrada: 'Entrada', intervalo_inicio: 'Saída para intervalo', intervalo_fim: 'Volta do intervalo', saida: 'Saída' };

/** Quiosque de ponto para tablet compartilhado: matrícula + PIN. */
export default function Kiosk() {
  const [token, setToken] = useState<string | null>(() => { try { return localStorage.getItem(KEY); } catch { return null; } });
  const [setup, setSetup] = useState('');
  const [now, setNow] = useState(new Date());
  const [step, setStep] = useState<'code' | 'pin' | 'choose' | 'done'>('code');
  const [code, setCode] = useState(''); const [pin, setPin] = useState(''); const [who, setWho] = useState<any>(null); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (step === 'done' || err) { const t = setTimeout(reset, 6000); return () => clearTimeout(t); } }, [step, err]); // eslint-disable-line react-hooks/exhaustive-deps
  function reset() { setStep('code'); setCode(''); setPin(''); setWho(null); setMsg(''); setErr(''); }

  if (!token) return (
    <div className="flex min-h-screen items-center justify-center bg-char p-6 text-white">
      <div className="w-full max-w-md"><h1 className="heading text-3xl">Configurar quiosque de ponto</h1>
        <p className="mt-2 text-white/70">Cole o token gerado em Ponto → Dispositivos no painel administrativo.</p>
        <input className="input mt-4 text-char" value={setup} onChange={(e) => setSetup(e.target.value.trim())} placeholder="token do dispositivo" />
        <button className="btn-primary mt-3 w-full py-3" disabled={setup.length < 32} onClick={() => { localStorage.setItem(KEY, setup); setToken(setup); }}>Salvar</button></div>
    </div>
  );
  const val = step === 'code' ? code : pin;
  const press = (k: string) => {
    setErr('');
    if (k === 'C') return step === 'code' ? setCode('') : setPin('');
    if (k === 'OK') return next();
    if (val.length >= (step === 'code' ? 12 : 8)) return;
    step === 'code' ? setCode(code + k) : setPin(pin + k);
  };
  async function next() {
    if (step === 'code' && code) return setStep('pin');
    if (step === 'pin') {
      try { const r = await rpc<any>('kiosk_identify', { p_device_token: token, p_employee_code: code, p_pin: pin });
        if (!r.ok) { setErr(r.error); setPin(''); return; } setWho(r); setStep('choose'); }
      catch (e) { setErr((e as Error).message); }
    }
  }
  async function punch(t: string) {
    try { const r = await rpc<any>('kiosk_punch', { p_device_token: token, p_employee_code: code, p_pin: pin, p_type: t });
      if (r.ok === false) return setErr(r.error);
      setMsg(`${PT[r.punch_type]} registrada às ${timeBR(r.punched_at)} — NSR ${r.nsr}`); setStep('done'); }
    catch (e) { setErr((e as Error).message); }
  }
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-char p-6 text-white">
      <p className="text-white/60">{now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}</p>
      <p className="heading text-7xl tabular-nums">{now.toLocaleTimeString('pt-BR')}</p>
      <div className="mt-8 w-full max-w-sm">
        {step === 'choose' && who ? <div className="text-center">
          <p className="text-2xl font-semibold">Olá, {who.employee.split(' ')[0]}!</p>
          <div className="mt-4 grid gap-3">{who.next.allowed.map((t: string) => <button key={t} onClick={() => punch(t)} className="btn-primary py-5 text-xl">{PT[t]}</button>)}</div>
          <button className="mt-4 text-white/60 underline" onClick={reset}>Cancelar</button></div>
        : step === 'done' ? <p className="rounded-md bg-green-700 p-6 text-center text-xl font-semibold">{msg}</p>
        : <>
          <p className="mb-2 text-center text-lg">{step === 'code' ? 'Digite sua matrícula' : 'Digite seu PIN'}</p>
          <div className="mb-4 h-14 rounded-md bg-white/10 text-center text-4xl leading-[3.5rem] tracking-[.3em] tabular-nums">{step === 'code' ? code : '•'.repeat(pin.length)}</div>
          <div className="grid grid-cols-3 gap-3">{['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'OK'].map((k) =>
            <button key={k} onClick={() => press(k)} className={`h-16 rounded-md text-2xl font-semibold ${k === 'OK' ? 'bg-red-600' : 'bg-white/10 active:bg-white/20'}`}>{k}</button>)}</div>
        </>}
        {err && <p className="mt-4 rounded-md bg-red-700 p-3 text-center">{err}</p>}
      </div>
    </div>
  );
}
