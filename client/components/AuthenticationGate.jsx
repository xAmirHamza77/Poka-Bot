'use client';

import { useEffect, useState } from 'react';
import { getDesktop, AuthenticationError, ensureSession, login } from '../lib/api';
import { migrateWorkspaceBranding } from '../lib/branding';
import Dashboard from './Dashboard';
import BrandIcon from './BrandIcon';

export default function AuthenticationGate() {
  const [phase, setPhase] = useState('loading');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const checkSession = async () => {
    setPhase('loading');
    setError('');
    try {
      await ensureSession();
      setPhase('authenticated');
    } catch (failure) {
      setPhase(failure instanceof AuthenticationError ? 'login' : 'unavailable');
      if (!(failure instanceof AuthenticationError)) setError('Cannot reach the API. Start the server and retry.');
    }
  };

  useEffect(() => {
    migrateWorkspaceBranding();
    checkSession();
    const expired = () => { setToken(''); setError(''); setPhase('login'); };
    window.addEventListener('poka:authentication-required', expired);
    return () => window.removeEventListener('poka:authentication-required', expired);
  }, []);

  const signIn = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const credential = token;
    setToken('');
    try {
      await login(credential);
      setPhase('authenticated');
    } catch (failure) {
      setError(failure.message || 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  if (phase === 'authenticated') return <Dashboard />;
  return (
    <main className="min-h-screen bg-[#09090b] text-zinc-100 flex items-center justify-center p-6">
      <section className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/70 p-8 space-y-5 shadow-2xl">
        <BrandIcon className="h-14 w-14" />
        <div><p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-violet-300">Your personal AI workspace</p><h1 className="text-2xl font-semibold tracking-tight">Welcome to Poka</h1></div>
        {phase === 'loading' ? <p role="status">Checking session…</p> : phase === 'unavailable' ? <>
          <p role="alert" className="text-sm text-red-300">{error}</p>
          <button onClick={checkSession} className="rounded-lg bg-violet-600 px-4 py-2 text-sm">Retry connection</button>
        </> : typeof window !== 'undefined' && getDesktop() && !getDesktop().remote ? <div className="space-y-4"><p className="text-sm text-zinc-400">Your local session is signed out. Reconnect to open your workspace on this device.</p><button type="button" className="primary-button w-full justify-center" onClick={async () => { try { await getDesktop().signIn(); await checkSession(); } catch { setError('Could not reconnect. Restart Poka and try again.'); } }}>Reconnect to Poka</button>{error && <p role="alert" className="text-sm text-red-300">{error}</p>}</div> : <form onSubmit={signIn} className="space-y-4">

          <p className="text-sm text-zinc-400">Enter the owner token configured on your server. For a local installation, read the .auth-token file in your data directory (normally ~/.poka).</p>
          <label htmlFor="owner-token" className="block text-sm">Owner token</label>
          <input id="owner-token" type="password" autoComplete="off" required maxLength={4096} value={token} onChange={(event) => setToken(event.target.value)} disabled={busy} className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 focus:outline-violet-400" />
          <p className="text-xs text-zinc-500">This is the Poka login token. Your model provider key is configured after signing in.</p>
          {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
          <button disabled={busy} type="submit" className="w-full rounded-lg bg-violet-600 px-4 py-2 text-sm disabled:opacity-50">{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>}
      </section>
    </main>
  );
}
