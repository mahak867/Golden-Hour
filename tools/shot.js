const { chromium } = require('playwright');
const OUT = process.argv[2] || require('path').resolve(__dirname, '../screenshots');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  p.on('pageerror', e => console.log('PAGEERROR', e.message));
  await p.goto('file://' + require('path').resolve(__dirname, '../index.html') + '?autoplay=1&speed=0.15');
  await p.waitForFunction(() => document.title === 'DONE', null, { timeout: 60000 });
  await p.evaluate(() => { hideCard(); selAcct = 'XXXX4471'; renderBank(); });
  await p.waitForTimeout(600);
  await p.screenshot({ path: OUT + '/bank-console.png' });
  await p.click('.tab[data-view=victim]'); await p.waitForTimeout(800);
  await p.screenshot({ path: OUT + '/victim-flow.png' });
  await p.locator('.phone').screenshot({ path: OUT + '/telegram-chat.png' });
  await p.locator('#cards').screenshot({ path: OUT + '/agent-cards.png' });
  await b.close();
})();
