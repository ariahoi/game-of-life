import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './load.mjs';

const { ViewMath } = loadScript('view-math');
const VM = ViewMath ?? {};
const plain = (o) => (o ? { ...o } : o);
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('screenToCell at and near the centre', () => {
  const cam = { x: 50, y: 40, zoom: 10 };
  assert.deepEqual(plain(VM.screenToCell(cam, 400, 300, 800, 600, 100, 80)), { x: 50, y: 40 });
  assert.deepEqual(plain(VM.screenToCell(cam, 395, 295, 800, 600, 100, 80)), { x: 49, y: 39 });
});

test('screenToCell outside the field → null', () => {
  assert.equal(VM.screenToCell({ x: 5, y: 5, zoom: 10 }, 0, 0, 800, 600, 100, 80), null);
  assert.equal(VM.screenToCell({ x: 95, y: 75, zoom: 10 }, 799, 599, 800, 600, 100, 80), null);
});

test('cellToScreen / screenToCell round trip', () => {
  const cam = { x: 33.3, y: 21.7, zoom: 6 };
  const p = VM.cellToScreen(cam, 12, 7, 800, 600);
  assert.deepEqual(plain(VM.screenToCell(cam, p.x + 1, p.y + 1, 800, 600, 100, 80)), { x: 12, y: 7 });
});

test('zoomAt keeps the world point under the cursor', () => {
  const cam = { x: 50, y: 40, zoom: 4 };
  const world = (c) => ({ x: c.x + (100 - 400) / c.zoom, y: c.y + (100 - 300) / c.zoom });
  const before = world(cam);
  const next = VM.zoomAt(cam, 100, 100, 1.15, 800, 600);
  const after = world(next);
  near(after.x, before.x);
  near(after.y, before.y);
  assert.notEqual(next, cam, 'returns a new object');
  assert.equal(cam.zoom, 4, 'input not mutated');
});

test('zoomAt clamps to [0.5, 64]', () => {
  let cam = { x: 0, y: 0, zoom: 1 };
  for (let i = 0; i < 100; i++) cam = VM.zoomAt(cam, 10, 10, 1.15, 800, 600);
  assert.equal(cam.zoom, 64);
  for (let i = 0; i < 100; i++) cam = VM.zoomAt(cam, 10, 10, 1 / 1.15, 800, 600);
  assert.equal(cam.zoom, 0.5);
  assert.equal(VM.MIN_ZOOM, 0.5);
  assert.equal(VM.MAX_ZOOM, 64);
});

test('fitCamera centres and fits with 5% margin', () => {
  const cam = VM.fitCamera(400, 300, 800, 600);
  assert.equal(cam.x, 200);
  assert.equal(cam.y, 150);
  near(cam.zoom, 1.9);
  assert.equal(VM.fitCamera(1000, 1000, 300, 200).zoom, 0.5, 'clamped to MIN_ZOOM');
});

test('lineCells is gap-free and includes both ends', () => {
  const pts = Array.from(VM.lineCells(0, 0, 4, 2), (p) => [...p]);
  assert.equal(pts.length, 5);
  assert.deepEqual(pts[0], [0, 0]);
  assert.deepEqual(pts[4], [4, 2]);
  for (let i = 1; i < pts.length; i++) {
    assert.ok(Math.abs(pts[i][0] - pts[i - 1][0]) <= 1);
    assert.ok(Math.abs(pts[i][1] - pts[i - 1][1]) <= 1);
  }
  assert.deepEqual(Array.from(VM.lineCells(3, 3, 3, 3), (p) => [...p]), [[3, 3]]);
  assert.equal(VM.lineCells(5, 0, 0, 7).length, 8, 'steep, reversed direction');
});

test('stepsForFrame: normal, capped at 8, accumulator capped at 0.25 s', () => {
  const a = VM.stepsForFrame(0, 0.1, 15);
  assert.equal(a.steps, 1);
  near(a.acc, 0.1 - 1 / 15);
  const b = VM.stepsForFrame(0, 10, 60);
  assert.equal(b.steps, 8);
  assert.equal(b.acc, 0);
  const c = VM.stepsForFrame(0, 10, 1);
  assert.equal(c.steps, 0);
  assert.equal(c.acc, 0.25);
});

// ---------- Final-review fixes ----------
test('wheelFactor: one notch = 1.15, many small trackpad deltas ≈ one notch', () => {
  near(VM.wheelFactor(-100, 0, 800), 1.15);
  near(VM.wheelFactor(100, 0, 800), 1 / 1.15);
  let z = 2;
  for (let i = 0; i < 30; i++) z *= VM.wheelFactor(-4, 0, 800);
  assert.ok(z < 2 * 1.25, `30×(-4px) zoomed to ${z}`);
  near(VM.wheelFactor(-3, 1, 800), 1.15 ** (99 / 100)); // строки ×33 px
  near(VM.wheelFactor(1, 2, 800), 1.15 ** (-8));        // страница = высота вьюпорта
});

test('rawCell is unbounded; strokeSegment keeps only in-field cells, gap-free to the edge', () => {
  assert.deepEqual(plain(VM.rawCell({ x: 5, y: 5, zoom: 10 }, 0, 0, 800, 600)), { x: -35, y: -25 });
  const seg = Array.from(VM.strokeSegment({ x: 380, y: 5 }, { x: 420, y: 5 }, 400, 300), (p) => [...p]);
  assert.equal(seg.length, 20);
  assert.deepEqual(seg[0], [380, 5]);
  assert.deepEqual(seg[19], [399, 5]);
  assert.equal(VM.strokeSegment({ x: -10, y: 5 }, { x: 410, y: 5 }, 400, 300).length, 400);
  assert.equal(VM.strokeSegment({ x: -10, y: -10 }, { x: -1, y: -1 }, 400, 300).length, 0);
});

test('Stroke: mode from first in-field cell, revert restores prior cells', () => {
  const s = new Set(['1,1', '2,1']);
  const life = {
    get: (x, y) => (s.has(`${x},${y}`) ? 1 : 0),
    set: (x, y, v) => (v ? s.add(`${x},${y}`) : s.delete(`${x},${y}`)),
  };
  const st = new VM.Stroke();
  st.paint(life, [[1, 1], [2, 1], [3, 1]]);
  assert.equal(st.mode, false, 'started on a live cell → erase');
  assert.equal(s.size, 0);
  st.paint(life, [[2, 1]]);
  st.revert(life);
  assert.deepEqual([...s].sort(), ['1,1', '2,1']);

  const st2 = new VM.Stroke();
  st2.paint(life, [[5, 5], [1, 1]]);
  assert.equal(st2.mode, true, 'started on an empty cell → draw');
  st2.revert(life);
  assert.deepEqual([...s].sort(), ['1,1', '2,1']);
});

test('smoothFor: smoothing only when downscaling', () => {
  assert.equal(VM.smoothFor(0.73, 1), true);
  assert.equal(VM.smoothFor(0.73, 2), false);
  assert.equal(VM.smoothFor(1, 1), false);
  assert.equal(VM.smoothFor(16, 1), false);
});
