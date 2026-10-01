'use client';

const colors = {
  blue: 'brightness(.75) sepia(1) saturate(5) hue-rotate(170deg)',
  pink: 'brightness(.75) sepia(1) saturate(5) hue-rotate(295deg)',
  green: 'brightness(.75) sepia(1) saturate(5) hue-rotate(85deg)',
  violet: 'brightness(.75) sepia(1) saturate(5) hue-rotate(215deg)',
  coral: 'brightness(.8) sepia(1) saturate(4) hue-rotate(325deg)',
  warning: 'brightness(.8) sepia(1) saturate(5) hue-rotate(355deg)',
};
export const POKA_AVATAR_COLORS = [
  { type: 'blue', label: 'Blue', accent: '#3b82f6' },
  { type: 'pink', label: 'Pink', accent: '#ec4899' },
  { type: 'green', label: 'Green', accent: '#10b981' },
  { type: 'violet', label: 'Purple', accent: '#a855f7' },
  { type: 'coral', label: 'Amber', accent: '#f59e0b' },
];
export function getAvatarType(bot) {
  if (bot?.isError) return 'warning';
  const accents = Object.fromEntries(POKA_AVATAR_COLORS.map(color => [color.accent, color.type]));
  accents['#d97757'] = 'coral';
  if (accents[bot?.accent_color]) return accents[bot.accent_color];
  const hash = Array.from(bot?.id || 'poka').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return POKA_AVATAR_COLORS[hash % POKA_AVATAR_COLORS.length].type;
}
export default function MascotAvatar({ type = 'blue', size = 'md', className = '' }) {
  const sizes = { sm: 'w-8 h-8', md: 'w-11 h-11', lg: 'w-14 h-14' };
  return <span className={`${sizes[size] || sizes.md} shrink-0 inline-flex overflow-hidden rounded-xl ${className}`}>
    <img src="/poka-logo.jpg" alt="" aria-hidden="true" className="w-full h-full object-cover scale-[1.3]" style={{ filter: colors[type] || colors.blue }} />
  </span>;
}
