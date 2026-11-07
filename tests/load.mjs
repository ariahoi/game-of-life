import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const HTML_PATH = new URL('../index.html', import.meta.url);

// Вырезает содержимое <script id="..."> из index.html и исполняет его в изолированном контексте.
// Возвращает globalThis этого контекста.
export function loadScript(id) {
  const html = readFileSync(HTML_PATH, 'utf8');
  const re = new RegExp(`<script id="${id}">([\\s\\S]*?)</script>`);
  const m = html.match(re);
  if (!m) throw new Error(`script #${id} not found in index.html`);
  const ctx = vm.createContext({});
  vm.runInContext(m[1], ctx, { filename: `index.html#${id}` });
  return ctx;
}

// Детерминированный ГПСЧ (mulberry32) для тестов.
export function seededRng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
