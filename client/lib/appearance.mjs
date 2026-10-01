export const APPEARANCE_KEY = 'poka_appearance';
export const CHAT_COLORS = [
  { id: 'blue', name: 'Blue', value: '#3276df' },
  { id: 'pink', name: 'Pink', value: '#ad296b' },
  { id: 'green', name: 'Green', value: '#14764f' },
  { id: 'purple', name: 'Purple', value: '#7944c1' },
  { id: 'amber', name: 'Amber', value: '#8b5b12' },
];
export const DEFAULT_APPEARANCE = Object.freeze({ color: 'blue', design: 'rounded', textSize: 16, width: 'comfortable', timestamps: true, reducedMotion: false, enterToSend: true });
export function normalizeAppearance(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  return {
    color: CHAT_COLORS.some(color => color.id === value.color) ? value.color : 'blue',
    design: ['rounded', 'compact', 'minimal'].includes(value.design) ? value.design : 'rounded',
    textSize: [14,16,18,20].includes(value.textSize) ? value.textSize : 16,
    width: value.width === 'wide' ? 'wide' : 'comfortable',
    timestamps: typeof value.timestamps === 'boolean' ? value.timestamps : true,
    reducedMotion: typeof value.reducedMotion === 'boolean' ? value.reducedMotion : false,
    enterToSend: typeof value.enterToSend === 'boolean' ? value.enterToSend : true,
  };
}
export function readAppearance(storage) {
  try { return normalizeAppearance(JSON.parse(storage.getItem(APPEARANCE_KEY))); }
  catch { return { ...DEFAULT_APPEARANCE }; }
}
export function appearanceStyle(value) {
  const prefs = normalizeAppearance(value);
  return { '--chat-color': CHAT_COLORS.find(color => color.id === prefs.color).value, '--chat-text-size': `${prefs.textSize}px`, '--chat-width': prefs.width === 'wide' ? '1200px' : '960px' };
}
