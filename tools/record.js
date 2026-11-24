// Records the autoplay walkthrough to video/raw/*.webm. Usage: node tools/record.js [speed]
// Logs page errors, console errors and a caption timeline (seconds from video start) for narration timing.
const { chromium } = require('playwright');
const SPEED = Number(process.argv[2] || 1.15);
(async () => {
  const dir = require('path').resolve(__dirname, '../video/raw');
  const srv = await require('./serve')();
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir, size: { width: 1440, height: 900 } }, timezoneId: 'Asia/Kolkata', locale: 'en-IN' });
  const p = await ctx.newPage();
  const t0 = Date.now(), ts = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6);
  let errors = 0;
  p.on('pageerror', e => { errors++; console.log(ts(), 'PAGEERROR', e.message); });
  p.on('console', m => { if (m.type() === 'error') { errors++; console.log(ts(), 'CONSOLE', m.text()); } else if (m.text().startsWith('GH-CAP ')) console.log(ts(), m.text()); });
  p.on('requestfailed', r => console.log(ts(), 'REQFAILED', r.url(), r.failure() && r.failure().errorText));
  await p.addInitScript(() => {
    addEventListener('DOMContentLoaded', () => {
      const log = (k, el) => console.log('GH-CAP ' + k + ' ' + el.textContent.replace(/\s+/g, ' ').trim().slice(0, 110));
      new MutationObserver(() => log('caption', document.getElementById('caption'))).observe(document.getElementById('caption'), { childList: true, subtree: true });
      new MutationObserver(() => { const c = document.getElementById('card'); if (c.classList.contains('show')) log('card', c); }).observe(document.getElementById('card'), { attributes: true, attributeFilter: ['class'] });
    });
  });
  await p.goto(srv.url + 'index.html?autoplay=1&captions=1&speed=' + SPEED);
  await p.waitForFunction(() => document.title === 'DONE', null, { timeout: 300000 });
  console.log(ts(), 'DONE');
  await p.waitForTimeout(1500);
  const v = p.video(); await ctx.close(); console.log('VIDEO', await v.path(), 'errors', errors); await b.close(); srv.close();
})();
