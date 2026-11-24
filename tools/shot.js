// Captures README / deck screenshots after the autoplay walkthrough. Usage: node tools/shot.js [outDir] [scale]
const { chromium } = require('playwright');
const path = require('path');
const OUT = process.argv[2] || path.resolve(__dirname, '../screenshots');
const SCALE = Number(process.argv[3] || 2);
(async () => {
  const srv = await require('./serve')();
  const b = await chromium.launch();
  // IST so the form's local times match the receipt and the drafts.
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: SCALE, timezoneId: 'Asia/Kolkata', locale: 'en-IN' });
  let errors = 0;
  p.on('pageerror', e => { errors++; console.log('PAGEERROR', e.message); });
  p.on('console', m => { if (m.type() === 'error') { errors++; console.log('CONSOLE', m.text()); } });
  await p.goto(srv.url + 'index.html?autoplay=1&speed=0.12');
  await p.waitForFunction(() => document.title === 'DONE', null, { timeout: 120000 });
  // The walkthrough ends with its own hand-off; drop that packet so the console shots show the seeded queue.
  await p.evaluate(() => { hideCard(); document.getElementById('cursor').classList.remove('on'); const i = CASES.findIndex(x => x.mine); if (i >= 0) CASES.splice(i, 1); consoleBuilt = false; SPEED = 1; });
  await p.waitForTimeout(700);
  const shot = file => p.screenshot({ path: path.join(OUT, file) }).then(() => console.log('wrote', file));
  const snap = async (view, file, prep) => { await p.evaluate(v => show(v), view); if (prep) await p.evaluate(prep); await p.waitForTimeout(1100); await shot(file); };
  await snap('console', 'bank-console.png', () => { selAcct = 'XXXX4471'; renderConsole(); });
  await snap('impact', 'impact.png');
  await snap('rules', 'rules.png');
  await snap('victim', 'victim-flow.png', () => openTab('routes'));
  await p.locator('.device').screenshot({ path: path.join(OUT, 'telegram-chat.png') }); console.log('wrote telegram-chat.png');
  await p.evaluate(() => openTab('evidence')); await p.waitForTimeout(500);
  await shot('victim-evidence.png');
  await p.evaluate(() => openTab('deadlines')); await p.waitForTimeout(500);
  await shot('victim-deadlines.png');
  await p.locator('.orch').screenshot({ path: path.join(OUT, 'agent-cards.png') }); console.log('wrote agent-cards.png');
  await p.evaluate(() => show('victim'));
  // Try it live: real OCR on the synthetic sample, default plan.
  // The walkthrough left its own form in the modal; remove it so we wait for this OCR run, not the old one.
  await p.evaluate(() => { const b = document.querySelector('#buildPlan'); if (b) b.remove(); });
  await p.click('#tryNav'); await p.waitForTimeout(300); await p.click('#sampleBtn');
  await p.waitForSelector('#buildPlan', { timeout: 90000 }); await p.click('#buildPlan'); await p.waitForTimeout(700);
  await shot('try-it.png');
  // Held above ₹50,000: the plan switches to the BNSS s.503 court-order route.
  await p.fill('#f-amt', '120000'); await p.fill('#f-held', '90000'); await p.click('#buildPlan'); await p.waitForTimeout(700);
  await p.evaluate(() => document.querySelector('#outcome').scrollIntoView({ block: 'start' })); await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelector('#f-amt').scrollIntoView({ block: 'start' })); await p.waitForTimeout(400);
  await shot('try-court-route.png');
  // Tamil s.503 draft preview (Tamil is the default; select it explicitly in case the walkthrough left English on).
  await p.click('#langSeg [data-l="ta"]'); await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelector('#docPrev').scrollIntoView({ block: 'center' })); await p.waitForTimeout(600);
  await shot('tamil-petition.png');
  // Hand-off: the victim's packet joins the hold in the bank console.
  await p.click('#sendBank'); await p.waitForFunction(() => document.querySelector('#v-console.active') && !document.querySelector('#tryModal.open'), null, { timeout: 10000 });
  await p.waitForTimeout(1400);
  await shot('handoff-console.png');
  console.log('errors', errors);
  await b.close(); srv.close();
})();
