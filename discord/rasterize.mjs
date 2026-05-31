import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import path from 'path';
const here = path.dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(path.join(here, 'brutal-arena-icon.svg'), 'utf8');
const out = path.join(here, 'brutal-arena-icon.png');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 2 });
// inline the SVG so the font @import resolves and nothing is blocked
await page.setContent(
  `<!doctype html><html><head><meta charset="utf-8">
   <style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style>
   </head><body>${svg}</body></html>`,
  { waitUntil: 'networkidle' });
await page.waitForTimeout(1500); // let Bangers (Google Font) load + paint
const el = await page.$('svg');
await el.screenshot({ path: out, omitBackground: true });
await browser.close();
console.log('wrote', out);
