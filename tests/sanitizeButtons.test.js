const assert = require('assert');
const { sanitizeButtons } = require('../src/bot/menu/renderMenu');

// Basic smoke test for sanitizeButtons
const input = [
  { text: 'A', callback_data: 'cmd:one' },
  { text: 'A dup', callback_data: 'cmd:one' },
  { text: 'B', callback_data: 'x'.repeat(70) }, // too long
  { text: 'C', callback_data: 'cmd:three' },
];

const out = sanitizeButtons(input);
assert(Array.isArray(out), 'output must be array');
assert(out.length === 2, 'should remove duplicates and too-long items');
assert(out[0].callback_data === 'cmd:one');
assert(out[1].callback_data === 'cmd:three');
console.log('sanitizeButtons test passed');
