// Run with: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const GH = require("../engine.js");

const at = s => new Date(s + "+05:30");
const base = { amount: 48000, held: 48000, utr: "436512907781", vpa: "fastgains.demo@upi", paidAt: at("2026-11-12T14:05:00"), reportedAt: at("2026-11-12T14:45:00") };
const NOW = at("2026-11-16T10:05:00");
const ids = p => p.routes.map(r => r.id);

test("every rule has a source and a status", () => {
  for (const r of GH.RULES) {
    assert.ok(r.src && r.src.length > 5, r.key);
    assert.ok(["official", "verify", "policy"].includes(r.status), r.key);
  }
});

test("validation catches bad UTR, ack and time order", () => {
  assert.deepEqual(GH.validate(base), []);
  assert.ok(GH.validate({ ...base, utr: "123" }).includes("12-digit UTR"));
  assert.ok(GH.validate({ ...base, ack: "999" }).includes("14-digit NCRP acknowledgement"));
  assert.ok(GH.validate({ ...base, reportedAt: at("2026-11-12T13:00:00") }).includes("a report time after the payment time"));
});

test("hold at or below ₹50,000 → Money Restoration request, no court order", () => {
  const p = GH.planCase(base, NOW);
  assert.equal(p.big, false);
  assert.equal(p.routes[0].id, "mrm");
  assert.equal(p.primary, "restoration");
  assert.ok(!ids(p).includes("s503"));
});

test("hold above ₹50,000 → s.503 petition first, s.106(3) and MRM as parallel routes", () => {
  const p = GH.planCase({ ...base, amount: 120000, held: 90000 }, NOW);
  assert.equal(p.big, true);
  assert.deepEqual(ids(p).slice(0, 3), ["s503", "s106", "mrm"]);
  assert.equal(p.primary, "s503");
  assert.equal(p.claim, 90000);
});

test("nothing held → first step is to report on 1930, only bank letter drafted", () => {
  const p = GH.planCase({ ...base, held: 0 }, NOW);
  assert.equal(p.routes[0].id, "report");
  assert.deepEqual(p.docs, ["bank"]);
  assert.ok(!ids(p).includes("hold"));
});

test("golden hour is reporting within 60 minutes", () => {
  assert.equal(GH.planCase(base, NOW).golden, true);
  assert.equal(GH.planCase({ ...base, reportedAt: at("2026-11-12T16:05:00") }, NOW).golden, false);
});

test("2017 rules: 3 working days to report, skipping the weekend", () => {
  // Friday 13 Nov 2026 → Mon, Tue, Wed = 18 Nov
  const p = GH.planCase({ ...base, paidAt: at("2026-11-13T10:00:00"), reportedAt: at("2026-11-13T10:30:00") }, NOW);
  assert.equal(p.rbi2027, false);
  assert.equal(GH.fmtD(p.bankDue), GH.fmtD(at("2026-11-18T10:00:00")));
});

test("2027 rules apply from 1 Jan 2027 with small-value compensation", () => {
  const p = GH.planCase({ ...base, amount: 20000, held: 20000, paidAt: at("2027-01-02T10:00:00"), reportedAt: at("2027-01-02T10:20:00") }, at("2027-01-03T09:00:00"));
  assert.equal(p.rbi2027, true);
  assert.equal(p.compEligible, true);
  assert.equal(p.compAmount, 17000); // 85% of 20,000
  const cap = GH.planCase({ ...base, amount: 40000, held: 40000, paidAt: at("2027-01-02T10:00:00"), reportedAt: at("2027-01-02T10:20:00") }, NOW);
  assert.equal(cap.compAmount, 25000);
});

test("compensation does not apply to 2026 payments or losses above ₹50,000", () => {
  assert.equal(GH.planCase(base, NOW).compEligible, false);
  assert.equal(GH.planCase({ ...base, amount: 60000, paidAt: at("2027-02-01T10:00:00"), reportedAt: at("2027-02-01T10:10:00") }, NOW).compEligible, false);
});

test("holds up to ₹50,000 lapse after 90 days (extendable once); larger holds do not", () => {
  const p = GH.planCase(base, NOW);
  assert.equal(p.holdLapses, true);
  assert.equal(p.routes.find(r => r.id === "hold").title, "Watch the 90-day hold");
  const big = GH.planCase({ ...base, amount: 120000, held: 90000 }, NOW);
  assert.equal(big.holdLapses, false);
  assert.equal(big.routes.find(r => r.id === "hold").title, "Track the hold");
  assert.ok(!GH.draft("s503", "en", { ...base, amount: 120000, held: 90000 }, big).includes("may lapse"));
  assert.equal(Math.round((p.holdLift - base.reportedAt) / 864e5), 90);
  assert.equal(Math.round((p.holdLiftMax - base.reportedAt) / 864e5), 180);
});

test("drafts exist in English and Tamil, carry the case facts and the safety footer", () => {
  const c = { ...base, amount: 120000, held: 90000, ack: "31210260031234" };
  const p = GH.planCase(c, NOW);
  for (const doc of ["restoration", "s503", "bank"]) {
    const en = GH.draft(doc, "en", c, p), ta = GH.draft(doc, "ta", c, p);
    for (const t of [en, ta]) {
      assert.ok(t.includes("436512907781"), doc + " UTR");
      assert.ok(t.includes("31210260031234"), doc + " ack");
      assert.ok(t.includes("15100"), doc + " legal aid");
      assert.ok(/OTP/.test(t), doc + " OTP warning");
    }
    assert.match(ta, /[஀-௿]/, doc + " has Tamil script");
  }
  assert.ok(GH.draft("s503", "en", c, p).includes("Section 503"));
  assert.ok(GH.draft("s503", "ta", c, p).includes("பிரிவு 503"));
});

test("drafts never ask for OTP, PIN or a fee", () => {
  const p = GH.planCase(base, NOW);
  for (const doc of ["restoration", "s503", "bank"]) for (const l of ["en", "ta"]) {
    const t = GH.draft(doc, l, base, p).split("— ")[0];
    assert.doesNotMatch(t, /\b(OTP|PIN|fee)\b/i, `${doc}/${l}`);
  }
});
