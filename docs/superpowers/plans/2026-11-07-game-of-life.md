# Игра «Жизнь» Конвея — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Одностраничная браузерная «Жизнь» с зумом/панорамой, сменой правил, цветом по возрасту и следами.

**Architecture:** Один `index.html`. Чистая логика — в двух `<script>` с id (`life-engine`, `view-math`), без DOM, экспортируется в `globalThis`; тесты на Node вырезают эти блоки и исполняют в `node:vm`. Остальной `<script>` (Renderer, Input, UI, цикл) использует их.

**Tech Stack:** HTML + Canvas 2D + ванильный JS (ES2020), Node ≥ 18 `node:test` для тестов. Без зависимостей.

**Spec:** `docs/superpowers/specs/2026-11-07-game-of-life-design.md`

## Global Constraints

- Никаких внешних зависимостей и сетевых запросов; всё в `index.html`.
- Блоки `<script id="life-engine">` и `<script id="view-math">` не обращаются к `document`/`window` (только `globalThis`).
- Правило по умолчанию `B3/S23`; пресеты: Conway `B3/S23`, HighLife `B36/S23`, Seeds `B2/S`, Day & Night `B3678/S34678`.
- `TRAIL_DECAY = 16`; `age` насыщается на 255; `trail` у только что умершей = 255.
- Зум: 0.5…64 экранных пикселя на клетку; множитель колеса 1.15; сетка при `zoom ≥ 8`.
- Скорость 1…60 пок./с, по умолчанию 15; аккумулятор ≤ 0.25 с; ≤ 8 шагов за кадр.
- Размеры поля: 200×150, 400×300 (по умолчанию), 600×400, 1000×1000. Плотность случайного заполнения 5…60 %, по умолчанию 25 %.
- Фон `#0a0c14`. Тексты интерфейса — на русском.
- Тесты: `node --test tests/`.

## Review Focus

1. Рисование/клик за пределами поля (в зоне фона) — ничего не меняется, без исключений. → тест `screenToCell` возвращает `null` вне поля (Task 3).
2. Зум колесом до упора — значение зажимается в [0.5, 64], точка под курсором остаётся под курсором. → тест `zoomAt` (Task 3).
3. Быстрый мазок мышью — клетки между событиями заполняются без пропусков. → тест `lineCells` (Task 3).
4. Возврат на вкладку после долгого фона — не больше 8 шагов за кадр. → тест `stepsForFrame` (Task 3).
5. Правило с пробелами/строчными буквами/повторами цифр (`" b36/s23 "`, `B33/S23`) — принимается; `B3S23` — нет. → тест в Task 1.

---

### Task 1: Каркас, тестовый стенд, `parseRule`

**Files:**
- Create: `index.html` (минимальный документ с `<script id="life-engine">` и пустым `<script id="view-math">`)
- Create: `tests/load.mjs` — `loadScript(id): object` читает `index.html`, вырезает `<script id="…">…</script>`, исполняет в `vm.createContext({})`, возвращает контекст (`globalThis`).
- Test: `tests/life.test.mjs`

**Interfaces:**
- Produces: `LifeEngine.parseRule(str: string) -> { birth: number, survive: number }` — 9-битные маски; бросает `Error` на неверный ввод. `loadScript(id)` из `tests/load.mjs`.

- [ ] **Step 1: Написать падающие тесты**

```js
const { parseRule } = loadScript('life-engine').LifeEngine;
const m = (...n) => n.reduce((a, k) => a | (1 << k), 0);
test('parseRule valid', () => {
  assert.deepEqual(parseRule('B3/S23'), { birth: m(3), survive: m(2,3) });
  assert.deepEqual(parseRule(' b36/s23 '), { birth: m(3,6), survive: m(2,3) });
  assert.deepEqual(parseRule('B2/S'), { birth: m(2), survive: 0 });
  assert.deepEqual(parseRule('B3678/S34678'), { birth: m(3,6,7,8), survive: m(3,4,6,7,8) });
  assert.deepEqual(parseRule('B33/S23'), { birth: m(3), survive: m(2,3) });
});
test('parseRule invalid', () => {
  for (const s of ['B9/S2', 'xyz', '', 'B3S23', 'B3/S2a', 'S23/B3'])
    assert.throws(() => parseRule(s), Error, s);
});
```

- [ ] **Step 2:** `node --test tests/` → FAIL (`LifeEngine` не определён).
- [ ] **Step 3:** Реализовать `parseRule` в `life-engine`, regex `^B([0-8]*)/S([0-8]*)$` (после `trim()`, без учёта регистра); `globalThis.LifeEngine = { parseRule }`.
- [ ] **Step 4:** `node --test tests/` → PASS.
- [ ] **Step 5:** `git commit -m "feat: каркас, тестовый стенд и parseRule"`

---

### Task 2: Класс `Life`

**Files:**
- Modify: `index.html` (блок `life-engine`)
- Test: `tests/life.test.mjs`

**Interfaces:**
- Consumes: `parseRule` (Task 1).
- Produces: `new LifeEngine.Life(width: number, height: number, rule = 'B3/S23')`; свойства `width`, `height`, `cells: Uint8Array`, `age: Uint8Array`, `trail: Uint8Array`, `generation: number`, `population: number`, `rule: string`; методы `get(x,y): 0|1`, `set(x,y,alive: boolean)`, `setRule(str)` (бросает при ошибке, правило не меняется), `step()`, `clear()`, `randomize(density: number, rng = Math.random)`, `resize(w, h)`. Индекс клетки `y*width + x`. Константа `LifeEngine.TRAIL_DECAY = 16`.

- [ ] **Step 1: Написать падающие тесты** (хелпер `place(life, [[x,y],…])`, `snapshot(life) -> string` координат живых клеток)
  - `block still`: блок 2×2 на 10×10, после 5 `step()` — тот же снимок, `population === 4`.
  - `blinker period 2`: горизонтальная тройка в (4..6, 5) → после 1 шага вертикальная (5, 4..6); после 2 — исходная.
  - `glider moves`: глайдер `[[1,0],[2,1],[0,2],[1,2],[2,2]]` на 20×20, после 4 шагов каждая клетка сдвинута на (+1,+1).
  - `torus wrap`: тот же глайдер на 20×20, после 80 шагов снимок равен исходному.
  - `highlife birth on 6`: мёртвая клетка (5,5) с ровно 6 живыми соседями `[[4,4],[5,4],[6,4],[4,6],[5,6],[6,6]]`: при `B36/S23` после шага `get(5,5) === 1`, при `B3/S23` — `0`.
  - `age`: клетка блока сразу после `set` — `age === 1`, после 3 шагов — `4`, после 300 шагов — `255`; у мигалки клетка (5,4), родившаяся на шаге 1, — `age === 1`; клетка (4,5), умершая на шаге 1, — `age === 0`.
  - `trail`: у мигалки клетка (4,5) после шага 1 — `trail === 255`, после шага 2 (снова жива) — `0`. Одиночная клетка: после шага 1 — `255`, после шага 2 — `239`, после шага 17 — `0`, после шага 20 — `0`.
  - `setRule invalid keeps old`: `setRule('B9/S2')` бросает, `rule` остаётся `'B3/S23'`.
  - `resize centers`: блок в (0,0),(1,0),(0,1),(1,1) на 10×10 → `resize(20,20)` → блок в (5,5)…(6,6), `population === 4`; `resize(4,4)` с 10×10, где живая только (0,0) → `population === 0`.
  - `counters`: `generation` растёт на 1 за `step()`; `clear()` → `population 0`, `generation 0`; `randomize(0.25, seededRng)` на 100×100 → `population` в [2000, 3000], `generation 0`.
- [ ] **Step 2:** `node --test tests/` → FAIL.
- [ ] **Step 3:** Реализовать `Life` по спецификации §3.1. `step()` — один проход с подсчётом соседей через предвычисленные индексы соседних строк/столбцов с оборачиванием, затем обмен буферов `cells`/`next`. `resize`: смещение `dx = floor((newW - oldW)/2)`, `dy` аналогично, копируются клетки, попадающие в новое поле, вместе с `age`/`trail`.
- [ ] **Step 4:** `node --test tests/` → PASS.
- [ ] **Step 5:** `git commit -m "feat: движок Life с возрастом и следами"`

---

### Task 3: Математика вида (`view-math`)

**Files:**
- Modify: `index.html` (блок `view-math`)
- Test: `tests/view.test.mjs`

**Interfaces:**
- Produces `globalThis.ViewMath`:
  - `screenToCell(cam, sx, sy, vw, vh, W, H) -> {x, y} | null` — `cam = {x, y, zoom}` (x,y — координата клетки в центре экрана, дробная); `vw, vh` — размер вьюпорта в CSS-пикселях. `null`, если вне `[0,W)×[0,H)`.
  - `cellToScreen(cam, cx, cy, vw, vh) -> {x, y}` (левый верхний угол клетки).
  - `zoomAt(cam, sx, sy, factor, vw, vh) -> cam` — новый объект; zoom зажат в [0.5, 64]; мировая точка под (sx,sy) остаётся под ней.
  - `fitCamera(W, H, vw, vh) -> cam` — центр поля, zoom = `min(vw/W, vh/H) * 0.95`, зажат в [0.5, 64].
  - `lineCells(x0, y0, x1, y1) -> Array<[x,y]>` — Брезенхем, включая оба конца.
  - `stepsForFrame(acc, dt, speed) -> { steps, acc }` — `acc' = min(acc + dt, 0.25)`; `steps = min(floor(acc' * speed), 8)`; остаток `acc' - steps/speed` (если упёрлись в 8 — `acc = 0`).
  - Константы `MIN_ZOOM = 0.5`, `MAX_ZOOM = 64`.

- [ ] **Step 1: Написать падающие тесты**
  - `screenToCell center`: cam `{x:50,y:40,zoom:10}`, vw=800, vh=600, W=100, H=80 → (400,300) → `{x:50,y:40}`; (395,295) → `{x:49,y:39}`.
  - `screenToCell outside → null`: cam `{x:5,y:5,zoom:10}`, vw=800, vh=600, W=100, H=80 → (0,0) → `null`; (799,599) при cam `{x:95,y:75,zoom:10}` → `null`. Формула: `x = floor(cam.x + (sx - vw/2)/zoom)`.
  - `round trip`: `screenToCell(cam, cellToScreen(cam, 12, 7).x + 1, …y + 1)` → `{x:12,y:7}`.
  - `zoomAt keeps point`: мировая точка под (100,100) до и после `zoomAt(cam,100,100,1.15)` совпадает с точностью 1e-9.
  - `zoomAt clamps`: 100 раз ×1.15 → `zoom === 64`; 100 раз ÷1.15 → `zoom === 0.5`.
  - `fitCamera`: (400,300,800,600) → `{x:200,y:150,zoom:1.9}`.
  - `lineCells`: (0,0)→(4,2) — 5 клеток, первая `[0,0]`, последняя `[4,2]`, соседние отличаются не более чем на 1 по каждой оси; (3,3)→(3,3) → `[[3,3]]`.
  - `stepsForFrame`: `(0, 0.1, 15)` → `steps 1`, `acc ≈ 0.0333` (1e-9); `(0, 10, 60)` → `steps 8, acc 0`; `(0, 10, 1)` → `steps 0`, `acc 0.25`.
- [ ] **Step 2:** `node --test tests/` → FAIL.
- [ ] **Step 3:** Реализовать `ViewMath` в блоке `view-math`.
- [ ] **Step 4:** `node --test tests/` → PASS.
- [ ] **Step 5:** `git commit -m "feat: математика камеры, линии и шага цикла"`

---

### Task 4: Renderer и игровой цикл (страница показывает поле)

**Files:**
- Modify: `index.html` (разметка: полноэкранный `<canvas id="view">`; основной `<script>`; стили)

**Interfaces:**
- Consumes: `Life` (Task 2), `ViewMath.fitCamera`, `cellToScreen`, `stepsForFrame` (Task 3).
- Produces (внутри основного скрипта, для Task 5): объект `app = { life, cam, running: boolean, speed: number, trails: boolean, density: number }`; функции `render()`, `fit()`, `resizeCanvas()`.

- [ ] **Step 1:** Renderer: внеэкранный canvas W×H + `ImageData`; LUT `ageColor[256]` (RGBA, градиент: age 1 `#e8f8ff` → ~age 20 `#2ee6c8` → ≥100 `#6a2bd9`); цвет следа — `#6a2bd9` с альфой `trail/255 * 0.45`, смешанный с фоном `#0a0c14`. Пересоздание буфера при смене размера `life`.
- [ ] **Step 2:** `render()`: заливка фона, `imageSmoothingEnabled = false`, `drawImage` по `cellToScreen(cam, 0, 0)` с размером `W*zoom × H*zoom`; учёт `devicePixelRatio` (canvas в физических пикселях, `ctx.setTransform(dpr,…)`); сетка линиями `rgba(255,255,255,0.06)` по видимым клеткам при `zoom ≥ 8`.
- [ ] **Step 3:** Цикл `requestAnimationFrame`: `dt` из timestamp, если `running` — `stepsForFrame` → `life.step()` × steps; всегда `render()`. Старт: `Life(400,300)`, `randomize(0.25)`, `fit()`, пауза. `resize` окна → `resizeCanvas()`, центр камеры сохраняется.
- [ ] **Step 4: Проверка в браузере:** открыть `index.html`, скриншот — видно поле 400×300 со случайными клетками, вписанное в экран, консоль без ошибок. Временно `app.running = true` из консоли → клетки меняются, цвета молодых светлее, видны фиолетовые следы.
- [ ] **Step 5:** `node --test tests/` → PASS; `git commit -m "feat: отрисовка поля и игровой цикл"`

---

### Task 5: Ввод — рисование, панорама, зум, тач

**Files:**
- Modify: `index.html` (основной скрипт)

**Interfaces:**
- Consumes: `app`, `render` (Task 4); `ViewMath.screenToCell`, `zoomAt`, `lineCells` (Task 3); `life.get/set`.
- Produces: `app.spaceHeld: boolean`, `app.dragPannedDuringSpace: boolean` (читаются горячими клавишами в Task 6).

- [ ] **Step 1:** Pointer Events на canvas, `touch-action: none`, `contextmenu` → `preventDefault`. ЛКМ/одно касание без пробела: режим мазка = `!life.get(первая клетка)`; на `pointermove` — `lineCells` от прошлой клетки к текущей, каждая клетка внутри поля → `set(x,y,mode)`; клетки вне поля (`screenToCell` → `null`) пропускаются.
- [ ] **Step 2:** Панорама: ПКМ-перетаскивание или ЛКМ при `app.spaceHeld` → `cam.x -= dx/zoom`, `cam.y -= dy/zoom`; при пробеле выставлять `app.dragPannedDuringSpace = true`.
- [ ] **Step 3:** Колесо: `cam = zoomAt(cam, sx, sy, deltaY < 0 ? 1.15 : 1/1.15, vw, vh)`, `preventDefault`.
- [ ] **Step 4:** Два активных указателя: отменить текущий мазок; зум через отношение расстояний к центру щипка (`zoomAt` с этим центром), панорама по смещению центра.
- [ ] **Step 5: Проверка в браузере:** нарисовать линию быстрым движением — без разрывов; клик в фон вне поля — без ошибок в консоли; колесо к углу поля — угол остаётся под курсором; ПКМ-перетаскивание двигает вид. `git commit -m "feat: рисование, панорама и зум"`

---

### Task 6: Панель управления, правила, горячие клавиши, статус

**Files:**
- Modify: `index.html` (разметка панели и статуса, стили, основной скрипт)

**Interfaces:**
- Consumes: `app`, `fit`, `render` (Task 4); `app.spaceHeld`, `app.dragPannedDuringSpace` (Task 5); `life.setRule`, `clear`, `randomize`, `resize`, `step` (Task 2).

- [ ] **Step 1:** Панель (левый верхний угол, `background: rgba(15,18,30,0.8)`, `backdrop-filter: blur(6px)`, сворачивается кнопкой «☰»): кнопки «Старт/Пауза», «Шаг», «Очистить», «Случайно» + ползунок «Плотность» 5–60 % (25), ползунок «Скорость» 1–60 (15) с подписью «N пок./с», `<select>` «Правило» (4 пресета + «Своё») и `<input>` правила, `<select>` «Размер поля» (4 значения, по умолчанию 400×300), чекбокс «Следы» (вкл), кнопка «Вписать».
- [ ] **Step 2:** Правило: на `input` — `try { life.setRule(v); снять .invalid; выбрать совпадающий пресет или «Своё» } catch { добавить .invalid (красная рамка) }`. Выбор пресета пишет строку в поле и применяет.
- [ ] **Step 3:** Размер поля: `life.resize(w,h)`, пересоздать буфер рендерера, `fit()`.
- [ ] **Step 4:** Статус (нижний левый угол, мелко, `rgba(255,255,255,0.6)`): «Поколение: N · Популяция: N · B3/S23», обновлять каждый кадр.
- [ ] **Step 5:** Горячие клавиши (игнорировать, если фокус в `<input>`): Пробел keydown → `spaceHeld = true`, `dragPannedDuringSpace = false`, `preventDefault`; keyup → если `!dragPannedDuringSpace` — переключить `running`; `spaceHeld = false`. N — шаг (только на паузе), C — очистить, R — случайно, F — вписать.
- [ ] **Step 6: Проверка в браузере:** скриншоты — работающая симуляция; крупный зум с сеткой; правило `B9/S2` → красная рамка, симуляция продолжает по старому; HighLife из списка — поле ввода показывает `B36/S23`; размер 1000×1000, 30 пок./с — плавно; панель сворачивается; консоль без ошибок. `node --test tests/` → PASS. `git commit -m "feat: панель управления, правила и горячие клавиши"`

---

### Task 7: Финальная проверка и публикация

- [ ] **Step 1:** `node --test tests/` → все PASS. Ручной прогон чек-листа §5.2 спецификации, скриншоты.
- [ ] **Step 2:** Опубликовать `index.html` как артефакт «Игра «Жизнь» Конвея».
- [ ] **Step 3:** `git commit` (если были правки).
