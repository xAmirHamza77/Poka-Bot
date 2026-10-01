'use client';
import { useState } from 'react';
import { FiX, FiPlus } from 'react-icons/fi';
import MascotAvatar, { getAvatarType } from './MascotAvatar';
import AvatarColorPicker from './AvatarColorPicker';
export default function NewAssistantModal({ defaultModel, models, onCreate, onClose }) {
  const [accent, setAccent] = useState('#3b82f6');
  const [name, setName] = useState('');
  const [role, setRole] = useState('General assistant');
  const [model, setModel] = useState(defaultModel);
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <div className="modal-backdrop" onClick={onClose}><section className="workspace-modal" role="dialog" aria-modal="true" aria-labelledby="new-assistant-title" onClick={e => e.stopPropagation()}>
    <button className="icon-button absolute right-5 top-5" onClick={onClose} aria-label="Close"><FiX /></button><MascotAvatar type={getAvatarType({ accent_color: accent })} size="lg" className="mb-6" /><h2 id="new-assistant-title" className="text-2xl font-semibold">Meet your next assistant</h2><p className="text-sm text-zinc-500 mt-2 mb-6">A dedicated space for your next project.</p>
    <form className="space-y-4" onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { await onCreate({ name: name.trim(), role: role.trim() || 'AI assistant', model, system_prompt: instructions.trim() || `You are ${name.trim()}, a helpful AI assistant.`, avatar: 'poka', accent_color: accent, description: role.trim() }); onClose(); } catch (failure) { setError(failure.message); } finally { setBusy(false); } }}>
      <AvatarColorPicker value={accent} onChange={setAccent} disabled={busy} />
      <label className="field-label">Name<input autoFocus required maxLength={100} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Research partner" className="setup-input" /></label>
      <label className="field-label">Role<input value={role} onChange={e => setRole(e.target.value)} className="setup-input" /></label>
      <label className="field-label">Model ID<input required value={model} onChange={e => setModel(e.target.value)} list="assistant-models" className="setup-input" /><datalist id="assistant-models">{models.map(m => <option key={m.id} value={m.id} />)}</datalist></label>
      <label className="field-label">Instructions <span className="text-zinc-500">· optional</span><textarea rows={3} value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="What should this assistant know about its job?" className="setup-input" /></label>
      {error && <p className="text-sm text-red-400" role="alert">{error}</p>}<button className="primary-button w-full justify-center" disabled={busy || !name.trim()}><FiPlus />{busy ? 'Creating…' : 'Create assistant'}</button>
    </form>
  </section></div>;
}
