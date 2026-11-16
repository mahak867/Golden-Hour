const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 1800 }, deviceScaleFactor: 3 });
  await p.goto('file://' + require('path').resolve(__dirname, '../charts/charts.html'));
  await p.addStyleTag({ content: 'body{background:transparent!important}' });
  for (const [id, name] of [['c1','tn-2024-funnel'],['c2','frozen-returned-share'],['c3','india-losses'],['arch','architecture']]) {
    await p.locator('#' + id + ' svg').screenshot({ path: require('path').resolve(__dirname, '../charts/' + name + '.png'), omitBackground: true });
  }
  await b.close();
})();
