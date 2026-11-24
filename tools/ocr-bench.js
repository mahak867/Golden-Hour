// OCR benchmark: 60 synthetic UPI receipts through the same in-browser OCR and parser the demo uses.
// 3 generic layouts (no real app branding) x 5 random transactions x 4 conditions
// (clean, JPEG quality 0.4, rotated 2 degrees, scaled to 75%). Seeded, so runs are repeatable.
// Usage: node tools/ocr-bench.js   (OCR_LANGS=eng to test English only; default eng+tam, as in the app)
// Previously:   → writes bench/ocr-bench.json and prints a summary.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');

(async () => {
  const srv = await require('./serve')();
  const b = await chromium.launch();
  const p = await b.newPage();
  p.on('pageerror', e => console.log('PAGEERROR', e.message));
  await p.goto(srv.url + 'index.html?view=rules');
  await p.waitForTimeout(500);

  const LANGS = (process.env.OCR_LANGS || "eng+tam").split("+");
  const res = await p.evaluate(async (LANGS) => {
    let seed = 20261124; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pick = a => a[Math.floor(rnd() * a.length)];
    const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const names = ["quickcash", "luckydraw", "kycupdate", "parcelhelp", "stockguru", "refunddesk", "jobportal", "loanfast"];
    const handles = ["okaxis", "ybl", "paytm", "oksbi", "ibl", "upi"];
    const inrFmt = n => n.toLocaleString("en-IN");
    function txn() {
      const amount = pick([1999, 4500, 12000, 25500, 48000, 75000, 99999, 150000, 9850.5, 33333]);
      const utr = String(Math.floor(1e11 + rnd() * 8.99e11));
      const vpa = pick(names) + Math.floor(rnd() * 90 + 10) + "@" + pick(handles);
      const d = new Date(2026, Math.floor(rnd() * 11), 1 + Math.floor(rnd() * 27), Math.floor(rnd() * 24), Math.floor(rnd() * 60));
      return { amount, utr, vpa, d };
    }
    const h12 = d => { const h = d.getHours() % 12 || 12; return `${h}:${String(d.getMinutes()).padStart(2, "0")} ${d.getHours() < 12 ? "am" : "pm"}`; };
    function draw(layout, t) {
      const c = document.createElement("canvas"); c.width = 720; c.height = 1000; const g = c.getContext("2d");
      const amt = Number.isInteger(t.amount) ? inrFmt(t.amount) : t.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 });
      if (layout === 0) {
        g.fillStyle = "#fff"; g.fillRect(0, 0, 720, 1000);
        g.fillStyle = "#188038"; g.font = "bold 34px Arial"; g.fillText("Payment successful", 60, 110);
        g.fillStyle = "#111"; g.font = "bold 72px Arial"; g.fillText("₹ " + amt, 60, 220);
        [["Paid to", t.vpa], ["UPI Ref No.", t.utr], ["Date", `${t.d.getDate()} ${MON[t.d.getMonth()]} ${t.d.getFullYear()}, ${h12(t.d)}`]].forEach(([a, v], i) => { const y = 340 + i * 90; g.font = "30px Arial"; g.fillStyle = "#666"; g.fillText(a, 60, y); g.fillStyle = "#111"; g.fillText(v, 290, y); });
      } else if (layout === 1) {
        g.fillStyle = "#f4f6fb"; g.fillRect(0, 0, 720, 1000); g.textAlign = "center";
        g.fillStyle = "#1a237e"; g.font = "bold 32px Arial"; g.fillText("Paid successfully", 360, 120);
        g.fillStyle = "#000"; g.font = "bold 80px Arial"; g.fillText("₹" + amt, 360, 240);
        g.font = "28px Arial"; g.fillStyle = "#333"; g.fillText("To: " + t.vpa, 360, 320);
        g.fillText(`${String(t.d.getDate()).padStart(2, "0")}/${String(t.d.getMonth() + 1).padStart(2, "0")}/${t.d.getFullYear()} ${String(t.d.getHours()).padStart(2, "0")}:${String(t.d.getMinutes()).padStart(2, "0")}`, 360, 380);
        g.textAlign = "left"; g.font = "28px Arial"; g.fillText("UPI transaction ID", 80, 520); g.font = "bold 30px Arial"; g.fillText(t.utr, 80, 565);
      } else {
        g.fillStyle = "#121212"; g.fillRect(0, 0, 720, 1000);
        g.fillStyle = "#7ee2a8"; g.font = "bold 30px Arial"; g.fillText("Money sent", 60, 100);
        g.fillStyle = "#fff"; g.font = "bold 70px Arial"; g.fillText("Rs. " + amt, 60, 200);
        g.font = "28px Arial"; g.fillStyle = "#ddd";
        g.fillText(`${MON[t.d.getMonth()]} ${t.d.getDate()}, ${t.d.getFullYear()} at ${h12(t.d).toUpperCase()}`, 60, 270);
        g.fillText("Sent to " + t.vpa, 60, 350); g.fillText("UTR: " + t.utr, 60, 420);
      }
      return c;
    }
    async function variant(c, k) {
      if (k === 0) return new Promise(r => c.toBlob(r, "image/png"));
      if (k === 1) return new Promise(r => c.toBlob(r, "image/jpeg", 0.4));
      const o = document.createElement("canvas"), g = o.getContext("2d");
      if (k === 2) { o.width = c.width; o.height = c.height; g.fillStyle = "#888"; g.fillRect(0, 0, o.width, o.height); g.translate(o.width / 2, o.height / 2); g.rotate(2 * Math.PI / 180); g.drawImage(c, -c.width / 2, -c.height / 2); }
      else { o.width = c.width * 0.75; o.height = c.height * 0.75; g.drawImage(c, 0, 0, o.width, o.height); }
      return new Promise(r => o.toBlob(r, "image/png"));
    }
    await loadScript("vendor/tesseract/tesseract.min.js");
    const w = await Tesseract.createWorker(LANGS, 1, { workerPath: "vendor/tesseract/worker.min.js", corePath: "vendor/tesseract/", langPath: "vendor/tesseract/lang", gzip: true });
    const rows = [], COND = ["clean", "jpeg-q40", "rotate-2deg", "scale-75%"];
    for (let layout = 0; layout < 3; layout++) for (let i = 0; i < 5; i++) {
      const t = txn(), c = draw(layout, t);
      for (let k = 0; k < 4; k++) {
        const blob = await variant(c, k), t0 = performance.now();
        const { data } = await w.recognize(blob); const ms = performance.now() - t0;
        const f = parseReceipt(data.text);
        const sameDay = f.when && f.when.getFullYear() === t.d.getFullYear() && f.when.getMonth() === t.d.getMonth() && f.when.getDate() === t.d.getDate();
        const sameTime = sameDay && f.when.getHours() === t.d.getHours() && f.when.getMinutes() === t.d.getMinutes();
        rows.push({ layout, cond: COND[k], ms: Math.round(ms), ...(Math.abs((f.amount || 0) - t.amount) < 0.01 && f.vpa === t.vpa.toLowerCase() ? {} : { want: [t.amount, t.vpa], got: [f.amount, f.vpa], text: data.text.split("\n").slice(0, 6).join(" | ") }), amount: Math.abs((f.amount || 0) - t.amount) < 0.01, utr: f.utr === t.utr, vpa: f.vpa === t.vpa.toLowerCase(), date: !!sameDay, time: !!sameTime });
      }
    }
    await w.terminate();
    return rows;
  }, LANGS);

  const n = res.length, pct = k => res.filter(r => r[k]).length;
  const ms = res.map(r => r.ms).sort((a, b) => a - b), median = ms[Math.floor(n / 2)];
  const by = key => Object.fromEntries([...new Set(res.map(r => r[key]))].map(v => { const s = res.filter(r => r[key] === v); return [v, Object.fromEntries(["amount", "utr", "vpa", "date", "time"].map(f => [f, `${s.filter(r => r[f]).length}/${s.length}`]))]; }));
  const all4 = res.filter(r => r.amount && r.utr && r.vpa && r.date).length;
  const summary = { receipts: n, generated: new Date().toISOString().slice(0, 10), note: `Synthetic receipts, 3 generic layouts x 5 transactions x 4 conditions. Headless Chromium, 4-core machine, OCR languages: ${LANGS.join("+")}.`, correct: { amount: `${pct("amount")}/${n}`, utr: `${pct("utr")}/${n}`, payee_upi_id: `${pct("vpa")}/${n}`, date: `${pct("date")}/${n}`, time: `${pct("time")}/${n}`, all_four_key_fields: `${all4}/${n}` }, median_ms_per_image: median, by_condition: by("cond"), by_layout: by("layout") };
  fs.mkdirSync(path.join(__dirname, '../bench'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '../bench/ocr-bench.json'), JSON.stringify({ summary, rows: res }, null, 1));
  console.log(JSON.stringify(summary, null, 1));
  await b.close(); srv.close();
})();
