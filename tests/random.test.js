// Randomised check: 1,000 synthetic cases across amounts, dates (2026–2027), report delays and holds.
// Every plan must obey the rules, every packet must match schema/case-packet.schema.json, every split must add up.
const test = require("node:test");
const assert = require("node:assert/strict");
const GH = require("../engine.js");
const schema = require("../schema/case-packet.schema.json");

let seed = 42; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = a => a[Math.floor(rnd() * a.length)];
const N = 1000;

function checkPacket(pk) {
  for (const k of schema.required) assert.ok(k in pk, "missing " + k);
  for (const k of Object.keys(pk)) assert.ok(k in schema.properties, "extra field " + k);
  assert.match(pk.utr, /^[0-9]{12}$/);
  if (pk.ncrp_ack !== null) assert.match(pk.ncrp_ack, /^[0-9]{14}$/);
  assert.ok(schema.properties.route.enum.includes(pk.route));
  assert.ok(["2017", "2027"].includes(pk.rbi_regime));
}

test(`${N} random cases: routes, deadlines, drafts and packets obey the rules`, () => {
  const t0 = process.hrtime.bigint(); let bigs = 0, comps = 0;
  for (let i = 0; i < N; i++) {
    const paidAt = new Date(Date.UTC(2026, 0, 1) + Math.floor(rnd() * 730) * 864e5 + Math.floor(rnd() * 1440) * 6e4);
    const reportedAt = new Date(paidAt.getTime() + Math.floor(rnd() * (rnd() < 0.6 ? 60 : 4320)) * 6e4);
    const amount = pick([500, 1999, 9999, 25000, 49999, 50000, 50001, 75000, 99999, 250000, 1000000]);
    const held = pick([0, Math.floor(amount * rnd()), amount, amount + 5000]);
    const c = { amount, held, utr: String(1e11 + Math.floor(rnd() * 8.99e11)), vpa: "x" + i + "@ybl", paidAt, reportedAt, ack: rnd() < 0.5 ? String(3e13 + i) : "" };
    const now = new Date(reportedAt.getTime() + Math.floor(rnd() * 200) * 864e5);
    assert.deepEqual(GH.validate(c), []);
    const p = GH.planCase(c, now);
    // Rule invariants
    assert.equal(p.big, held > 50000);
    assert.equal(p.holdLapses, held > 0 && held <= 50000);
    if (!held) assert.equal(p.routes[0].id, "report");
    else assert.equal(p.routes[0].id, p.big ? "s503" : "mrm");
    assert.equal(p.rbi2027, paidAt >= new Date("2027-01-01T00:00:00+05:30"));
    assert.ok(p.bankDue > paidAt);
    assert.equal(p.compEligible, p.rbi2027 && amount <= 50000);
    if (p.compEligible) assert.ok(p.compAmount <= 25000 && p.compAmount <= 0.85 * amount + 1e-9);
    assert.ok(p.claim <= amount && p.claim <= held);
    assert.ok(p.routes.every(r => r.title && r.desc && !/undefined|NaN/.test(r.desc)));
    if (p.big) assert.ok(p.routes.some(r => r.id === "s106"));
    // Drafts: both languages, no OTP/PIN request in the body, no unfilled template markers
    for (const d of p.docs) for (const l of ["en", "ta"]) {
      const t = GH.draft(d, l, c, p);
      assert.ok(!/undefined|NaN|\$\{/.test(t), `${d}/${l}`);
      assert.doesNotMatch(t.split("— ")[0], /\bOTP\b|\bPIN\b/);
    }
    checkPacket(GH.casePacket(c, p));
    if (p.big) bigs++; if (p.compEligible) comps++;
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`# ${N} cases in ${ms.toFixed(0)} ms (${(ms / N).toFixed(2)} ms each); court route ${bigs}, compensation ${comps}`);
  assert.ok(bigs > 50 && comps > 20, "coverage of both branches");
});

test("1,000 random pro-rata splits add up to the rupee and never over-pay", () => {
  for (let i = 0; i < 1000; i++) {
    const claims = Array.from({ length: 1 + Math.floor(rnd() * 9) }, (_, k) => ({ id: "c" + k, amount: 100 + Math.floor(rnd() * 500000) }));
    const lien = Math.floor(rnd() * 1500000);
    const r = GH.splitLien(claims, lien);
    const sum = r.claims.reduce((s, c) => s + c.share, 0);
    assert.equal(sum, Math.min(lien, r.total));
    for (const c of r.claims) assert.ok(Number.isInteger(c.share) && c.share >= 0 && c.share <= c.amount);
    const csv = GH.splitCsv("XXXX0001", r).trim().split("\n");
    assert.equal(csv.length, claims.length + 2);
  }
});
