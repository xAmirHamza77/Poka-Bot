'use client';
import { useId } from 'react';
import { FiCheck } from 'react-icons/fi';
import MascotAvatar, { POKA_AVATAR_COLORS } from './MascotAvatar';

export default function AvatarColorPicker({ value, onChange, disabled = false }) {
  const group = useId();
  return <fieldset className="avatar-color-picker" disabled={disabled}>
    <legend>Avatar color</legend>
    <div className="avatar-color-options">{POKA_AVATAR_COLORS.map(color => <label className={`avatar-color-option ${value === color.accent ? 'selected' : ''}`} key={color.type}>
      <input type="radio" name={group} value={color.accent} checked={value === color.accent} onChange={() => onChange(color.accent)} aria-label={`${color.label} Poka avatar`} />
      <span className="avatar-color-preview"><MascotAvatar type={color.type} size="lg" />{value === color.accent && <span className="avatar-color-check"><FiCheck /></span>}</span>
      <span>{color.label}</span>
    </label>)}</div>
  </fieldset>;
}
