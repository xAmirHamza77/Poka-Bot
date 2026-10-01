'use client';
import { FiCheck, FiRotateCcw } from 'react-icons/fi';
import { CHAT_COLORS, DEFAULT_APPEARANCE } from '../lib/appearance.mjs';
import MessageItem from './MessageItem';

export default function AppearanceSettings({ appearance, onChange }) {
  const update = (key, value) => onChange({ ...appearance, [key]: value });
  return <section className="settings-group appearance-settings">
    <div><h2>Appearance</h2><p className="settings-description">Your chat, your style. Changes save automatically on this device.</p></div>
    <fieldset className="appearance-row"><legend>Chat color</legend><div className="chat-color-choices">{CHAT_COLORS.map(color => <label key={color.id} title={color.name}><input type="radio" name="chat-color" value={color.id} checked={appearance.color === color.id} onChange={() => update('color', color.id)} /><span className="chat-color-swatch" style={{ background: color.value }}>{appearance.color === color.id && <FiCheck />}</span><span>{color.name}</span></label>)}</div></fieldset>
    <div className="appearance-row"><label htmlFor="chat-design">Chat design</label><select id="chat-design" className="settings-input" value={appearance.design} onChange={e => update('design', e.target.value)}><option value="rounded">Rounded bubbles</option><option value="compact">Compact bubbles</option><option value="minimal">Minimal conversation</option></select></div>
    <div className="appearance-row"><label htmlFor="chat-text-size">Text size</label><select id="chat-text-size" className="settings-input" value={appearance.textSize} onChange={e => update('textSize', Number(e.target.value))}>{[[14,'Small'],[16,'Default'],[18,'Large'],[20,'Extra large']].map(([size,label]) => <option key={size} value={size}>{label} · {size} px</option>)}</select></div>
    <div className="appearance-row"><label htmlFor="chat-width">Conversation width</label><select id="chat-width" className="settings-input" value={appearance.width} onChange={e => update('width',e.target.value)}><option value="comfortable">Comfortable</option><option value="wide">Wide</option></select></div>
    {[["timestamps","Show message times","Display the time below each message."],["enterToSend","Enter to send","Turn off to use Enter for a new line. ⌘/Ctrl + Enter always sends."],["reducedMotion","Reduce motion","Use instant scrolling and fewer animations."]].map(([key,label,description]) => <label key={key} className="appearance-toggle-row"><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" role="switch" checked={appearance[key]} onChange={e => update(key,e.target.checked)} /></label>)}
    <div className="appearance-preview" aria-label="Chat appearance preview"><p className="settings-description mb-4">Live preview</p><MessageItem message={{ sender:'user',text:'Let’s make something great.',created_at:'2026-10-01T10:00:00' }} /><MessageItem message={{ sender:'bot',text:'I’m ready. **What would you like to create?**',created_at:'2026-10-01T10:01:00' }} /></div>
    <button className="soft-button" onClick={() => onChange({ ...DEFAULT_APPEARANCE })}><FiRotateCcw /> Restore appearance defaults</button>
  </section>;
}
