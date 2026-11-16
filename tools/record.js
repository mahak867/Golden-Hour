const { chromium } = require('playwright');
(async () => {
  const dir = require('path').resolve(__dirname, '../video/raw');
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir, size: { width: 1440, height: 900 } } });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('PAGEERROR', e.message));
  await p.goto('file://' + require('path').resolve(__dirname, '../index.html') + '?autoplay=1&captions=1&speed=1.3');
  await p.waitForFunction(() => document.title === 'DONE', null, { timeout: 180000 });
  await p.waitForTimeout(1500);
  const v = p.video(); await ctx.close(); console.log(await v.path()); await b.close();
})();
