import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './load.mjs';

const { LifeEngine } = loadScript('life-engine');
const { parseRule } = LifeEngine ?? {};
const m = (...n) => n.reduce((a, k) => a | (1 << k), 0);

test('parseRule valid', () => {
  assert.deepEqual({ ...parseRule('B3/S23') }, { birth: m(3), survive: m(2, 3) });
  assert.deepEqual({ ...parseRule(' b36/s23 ') }, { birth: m(3, 6), survive: m(2, 3) });
  assert.deepEqual({ ...parseRule('B2/S') }, { birth: m(2), survive: 0 });
  assert.deepEqual({ ...parseRule('B3678/S34678') }, { birth: m(3, 6, 7, 8), survive: m(3, 4, 6, 7, 8) });
  assert.deepEqual({ ...parseRule('B33/S23') }, { birth: m(3), survive: m(2, 3) });
});

test('parseRule invalid', () => {
  for (const s of ['B9/S2', 'xyz', '', 'B3S23', 'B3/S2a', 'S23/B3']) {
    // Ошибка создана внутри vm-контекста, поэтому instanceof Error не сработает — проверяем имя.
    assert.throws(() => parseRule(s), (e) => e?.name === 'Error' && /правил/i.test(e.message), s);
  }
});
