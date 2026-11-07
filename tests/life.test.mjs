import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript, seededRng } from './load.mjs';

const { LifeEngine } = loadScript('life-engine');
const { parseRule, Life } = LifeEngine ?? {};
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

// ---------- Life ----------
const place = (life, pts) => { for (const [x, y] of pts) life.set(x, y, true); return life; };
const alive = (life) => {
  const out = [];
  for (let y = 0; y < life.height; y++)
    for (let x = 0; x < life.width; x++) if (life.get(x, y)) out.push(`${x},${y}`);
  return out.join(' ');
};
const run = (life, n) => { for (let i = 0; i < n; i++) life.step(); return life; };
const GLIDER = [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]];
const BLOCK = [[4, 4], [5, 4], [4, 5], [5, 5]];
const BLINKER = [[4, 5], [5, 5], [6, 5]];

test('block still', () => {
  const life = place(new Life(10, 10), BLOCK);
  const before = alive(life);
  run(life, 5);
  assert.equal(alive(life), before);
  assert.equal(life.population, 4);
});

test('blinker period 2', () => {
  const life = place(new Life(10, 10), BLINKER);
  const start = alive(life);
  life.step();
  assert.equal(alive(life), '5,4 5,5 5,6');
  life.step();
  assert.equal(alive(life), start);
});

test('glider moves (+1,+1) in 4 generations', () => {
  const life = place(new Life(20, 20), GLIDER);
  run(life, 4);
  const expected = place(new Life(20, 20), GLIDER.map(([x, y]) => [x + 1, y + 1]));
  assert.equal(alive(life), alive(expected));
});

test('torus wrap: glider returns after 80 generations on 20x20', () => {
  const life = place(new Life(20, 20), GLIDER);
  const start = alive(life);
  run(life, 80);
  assert.equal(alive(life), start);
  assert.equal(life.generation, 80);
});

test('highlife: birth on 6 neighbours only with B36', () => {
  const six = [[4, 4], [5, 4], [6, 4], [4, 6], [5, 6], [6, 6]];
  const hl = place(new Life(12, 12, 'B36/S23'), six);
  hl.step();
  assert.equal(hl.get(5, 5), 1);
  const conway = place(new Life(12, 12, 'B3/S23'), six);
  conway.step();
  assert.equal(conway.get(5, 5), 0);
});

test('age: set=1, survives +1, born=1, dead=0, saturates at 255', () => {
  const life = place(new Life(10, 10), BLOCK);
  const i = 4 * 10 + 4;
  assert.equal(life.age[i], 1);
  run(life, 3);
  assert.equal(life.age[i], 4);
  run(life, 297);
  assert.equal(life.age[i], 255);

  const b = place(new Life(10, 10), BLINKER);
  b.step();
  assert.equal(b.age[4 * 10 + 5], 1, 'born (5,4)');
  assert.equal(b.age[5 * 10 + 4], 0, 'died (4,5)');
});

test('trail: 255 on death, decays by 16, clamps at 0, 0 when alive', () => {
  assert.equal(LifeEngine.TRAIL_DECAY, 16);
  const b = place(new Life(10, 10), BLINKER);
  const i = 5 * 10 + 4;
  b.step();
  assert.equal(b.trail[i], 255);
  b.step();
  assert.equal(b.trail[i], 0);

  const s = place(new Life(10, 10), [[3, 3]]);
  const j = 3 * 10 + 3;
  s.step();
  assert.equal(s.trail[j], 255);
  s.step();
  assert.equal(s.trail[j], 239);
  run(s, 15); // всего 17 шагов
  assert.equal(s.trail[j], 0);
  run(s, 3); // всего 20
  assert.equal(s.trail[j], 0);
});

test('setRule: valid normalises, invalid throws and keeps old rule', () => {
  const life = new Life(5, 5);
  assert.equal(life.rule, 'B3/S23');
  assert.throws(() => life.setRule('B9/S2'));
  assert.equal(life.rule, 'B3/S23');
  life.setRule(' b36/s23 ');
  assert.equal(life.rule, 'B36/S23');
});

test('resize centres content and crops what does not fit', () => {
  const life = place(new Life(10, 10), [[0, 0], [1, 0], [0, 1], [1, 1]]);
  life.resize(20, 20);
  assert.equal(life.width, 20);
  assert.equal(life.height, 20);
  assert.equal(alive(life), '5,5 6,5 5,6 6,6');
  assert.equal(life.population, 4);
  assert.equal(life.age[5 * 20 + 5], 1, 'age carried over');

  const small = place(new Life(10, 10), [[0, 0]]);
  small.resize(4, 4);
  assert.equal(small.population, 0);
});

test('counters: generation, clear, randomize', () => {
  const life = place(new Life(10, 10), BLINKER);
  run(life, 3);
  assert.equal(life.generation, 3);
  assert.equal(life.population, 3);
  life.clear();
  assert.equal(life.population, 0);
  assert.equal(life.generation, 0);
  assert.equal(alive(life), '');

  const r = new Life(100, 100);
  run(r, 2);
  r.randomize(0.25, seededRng(42));
  assert.equal(r.generation, 0);
  assert.ok(r.population >= 2000 && r.population <= 3000, `population ${r.population}`);
});

test('set wraps coordinates on the torus', () => {
  const life = new Life(10, 10);
  life.set(-1, 10, true);
  assert.equal(life.get(9, 0), 1);
  assert.equal(life.population, 1);
  life.set(9, 0, false);
  assert.equal(life.population, 0);
});
