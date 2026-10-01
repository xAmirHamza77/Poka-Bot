const { test } = require('node:test');
const assert = require('node:assert/strict');
test('appearance preferences survive storage and safely recover invalid values', async () => {
  const { readAppearance, normalizeAppearance, appearanceStyle, DEFAULT_APPEARANCE, APPEARANCE_KEY } = await import('../../client/lib/appearance.mjs');
  const data = new Map(); const storage = { getItem: key => data.get(key) || null, setItem: (key,value) => data.set(key,value) };
  assert.deepEqual(readAppearance(storage), DEFAULT_APPEARANCE);
  const prefs = { color:'purple',design:'minimal',textSize:20,width:'wide',timestamps:false,reducedMotion:true,enterToSend:false };
  storage.setItem(APPEARANCE_KEY,JSON.stringify(prefs)); assert.deepEqual(readAppearance(storage),prefs);
  assert.deepEqual(appearanceStyle(prefs), {'--chat-color':'#7944c1','--chat-text-size':'20px','--chat-width':'1200px'});
  storage.setItem(APPEARANCE_KEY,'broken json'); assert.deepEqual(readAppearance(storage),DEFAULT_APPEARANCE);
  assert.deepEqual(normalizeAppearance({ color:'red; display:none',textSize:999,design:'invalid',timestamps:'false' }),DEFAULT_APPEARANCE);
  assert.deepEqual(readAppearance({getItem(){throw new Error('Storage blocked');}}),DEFAULT_APPEARANCE);
});
