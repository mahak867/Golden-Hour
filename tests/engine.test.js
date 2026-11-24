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

/* ---------- Named hard cases: boundaries a real victim can hit ---------- */
const P = (o, now = NOW) => GH.planCase({ ...base, ...o }, now);

test("hard case: held exactly ₹50,000 → MRM, no court order", () => {
  const p = P({ amount: 50000, held: 50000 });
  assert.equal(p.big, false); assert.equal(p.primary, "restoration"); assert.equal(p.holdLapses, true);
});

test("hard case: held ₹50,001 → s.503 petition, hold does not lapse", () => {
  const p = P({ amount: 50001, held: 50001 });
  assert.equal(p.big, true); assert.equal(p.primary, "s503"); assert.equal(p.holdLapses, false);
});

test("hard case: paid 31 Dec 2026 23:59 IST → 2017 rules", () => {
  assert.equal(P({ paidAt: at("2026-12-31T23:59:00"), reportedAt: at("2027-01-01T00:20:00") }).rbi2027, false);
});

test("hard case: paid 1 Jan 2027 00:00 IST → 2027 rules", () => {
  assert.equal(P({ paidAt: at("2027-01-01T00:00:00"), reportedAt: at("2027-01-01T00:20:00") }).rbi2027, true);
});

test("hard case: paid on Saturday → bank deadline skips the weekend", () => {
  // Sat 14 Nov 2026 → Mon 16, Tue 17, Wed 18
  const p = P({ paidAt: at("2026-11-14T11:00:00"), reportedAt: at("2026-11-14T11:30:00") });
  assert.equal(GH.fmtD(p.bankDue), GH.fmtD(at("2026-11-18T11:00:00")));
});

test("hard case: 2027 payment → 5-day bank window, calendar days", () => {
  const p = P({ paidAt: at("2027-03-05T10:00:00"), reportedAt: at("2027-03-05T10:15:00") }, at("2027-03-06T10:00:00"));
  assert.equal(Math.round((p.bankDue - at("2027-03-05T10:00:00")) / 864e5), 5);
});

test("hard case: held more than lost → claim is capped at the amount lost", () => {
  const p = P({ amount: 30000, held: 45000 });
  assert.equal(p.claim, 30000);
  assert.ok(GH.draft("restoration", "en", { ...base, amount: 30000, held: 45000 }, p).includes("₹30,000"));
});

test("hard case: nothing held, 2027, loss ≤ ₹50k → report first, compensation still offered", () => {
  const p = P({ amount: 20000, held: 0, paidAt: at("2027-02-01T10:00:00"), reportedAt: at("2027-02-01T10:30:00") });
  assert.equal(p.routes[0].id, "report");
  assert.equal(p.compEligible, true);
});

test("hard case: loss exactly ₹50,000 is eligible for compensation, ₹50,001 is not", () => {
  const d = { paidAt: at("2027-02-01T10:00:00"), reportedAt: at("2027-02-01T10:30:00") };
  assert.equal(P({ ...d, amount: 50000, held: 50000 }).compEligible, true);
  assert.equal(P({ ...d, amount: 50001, held: 50001 }).compEligible, false);
});

test("hard case: compensation caps at ₹25,000 (₹30k loss → ₹25,000, ₹29k → ₹24,650)", () => {
  const d = { paidAt: at("2027-02-01T10:00:00"), reportedAt: at("2027-02-01T10:30:00") };
  assert.equal(P({ ...d, amount: 30000, held: 30000 }).compAmount, 25000);
  assert.equal(P({ ...d, amount: 29000, held: 29000 }).compAmount, 24650);
});

test("hard case: 13-digit UTR and 15-digit acknowledgement are rejected", () => {
  assert.ok(GH.validate({ ...base, utr: "4365129077810" }).includes("12-digit UTR"));
  assert.ok(GH.validate({ ...base, ack: "312102600312345" }).includes("14-digit NCRP acknowledgement"));
});

test("hard case: hold lapsing within 15 days is flagged critical", () => {
  const p = P({}, at("2027-02-01T10:00:00"));
  const hold = p.routes.find(r => r.id === "hold");
  assert.ok(p.holdDaysLeft <= 15 && p.holdDaysLeft >= 0);
  assert.equal(hold.tone, "crit");
});

test("hard case: reporting window already over → still advises filing, no negative days", () => {
  const p = P({}, at("2026-12-20T10:00:00"));
  const bank = p.routes.find(r => r.id === "bank");
  assert.match(bank.desc, /ended on/);
  assert.doesNotMatch(bank.desc, /-\d+ day/);
});

test("hard case: Tamil drafts never ask for OTP or PIN in the body", () => {
  const big = { ...base, amount: 120000, held: 90000 };
  const p = GH.planCase(big, NOW);
  for (const d of ["restoration", "s503", "bank"]) {
    const body = GH.draft(d, "ta", big, p).split("— ")[0];
    assert.doesNotMatch(body, /OTP|PIN|கட்டணம்/, d);
  }
});

test("pro-rata: three victims on one ₹80,000 lien share it exactly, to the rupee", () => {
  const claims = [{ id: "a", amount: 48000 }, { id: "b", amount: 33333 }, { id: "c", amount: 28667 }];
  const r = GH.splitLien(claims, 80000);
  assert.equal(r.claims.reduce((s, c) => s + c.share, 0), 80000);
  for (const c of r.claims) assert.ok(c.share <= c.amount && Number.isInteger(c.share));
});

test("pro-rata: lien larger than all claims → every victim is paid in full, nothing extra", () => {
  const r = GH.splitLien([{ id: "a", amount: 10000 }, { id: "b", amount: 5000 }], 30000);
  assert.deepEqual(r.claims.map(c => c.share), [10000, 5000]);
});

test("pro-rata: awkward amounts still sum exactly (no lost rupee)", () => {
  const claims = Array.from({ length: 7 }, (_, i) => ({ id: String(i), amount: 1001 + i * 997 }));
  const r = GH.splitLien(claims, 12345);
  assert.equal(r.claims.reduce((s, c) => s + c.share, 0), 12345);
});

test("mule clusters: two accounts sharing a phone form one group", () => {
  const cases = [{ id: "1", vpa: "a@upi", acct: "A1" }, { id: "2", vpa: "b@upi", acct: "B1" }, { id: "3", vpa: "c@upi", acct: "C1" }];
  const g = GH.clusterGraph(cases, { A1: "+91 9", B1: "+91 9", C1: "+91 8" });
  assert.equal(g.groups.length, 2);
  assert.ok(g.groups[0].includes("acct:A1") && g.groups[0].includes("acct:B1"));
});

test("case packet: same fields for victim and bank, no PII beyond the payment", () => {
  const c = { ...base, ack: "31210260031234" };
  const pk = GH.casePacket(c, GH.planCase(c, NOW));
  assert.equal(pk.schema, "golden-hour/case-packet@1");
  assert.equal(pk.utr, "436512907781"); assert.equal(pk.route, "mrm"); assert.equal(pk.rbi_regime, "2017");
  assert.ok(!("name" in pk) && !("pan" in pk) && !("aadhaar" in pk));
});

/* ---------- Receipt parser: OCR misreads seen in bench/ocr-bench.json ---------- */
test("parser: ₹ misread as a digit is removed only when Indian grouping proves it", () => {
  assert.equal(GH.parseReceipt("Paid successfully\n348,000\nTo: ab@ybl").amount, 48000);
  assert.equal(GH.parseReceipt("₹ 3,48,000").amount, 348000);
  assert.equal(GH.parseReceipt("3 75,000").amount, 75000);
  assert.equal(GH.parseReceipt("T 1,999").amount, 1999);
});

test("parser: misread UPI handle snaps to a known handle", () => {
  assert.equal(GH.parseReceipt("Paid to kycupdate78@yhbl").vpa, "kycupdate78@ybl");
  assert.equal(GH.parseReceipt("Paid to someone@okaxis").vpa, "someone@okaxis");
  assert.equal(GH.parseReceipt("Write to support@bank.com").vpa, null);
});

test("parser: UTR, date, time and Aadhaar masking flag", () => {
  const f = GH.parseReceipt("UPI Ref No. 512398447016\nDate 14 Nov 2026, 11:42 am\n2345 6789 1234");
  assert.equal(f.utr, "512398447016");
  assert.equal(f.when.getDate(), 14); assert.equal(f.when.getHours(), 11);
  assert.equal(f.aadhaar, true);
});

test("parser: Tamil-language receipt (English + Tamil OCR output)", () => {
  const f = GH.parseReceipt("பணம்‌ செலுத்தப்பட்டது\n₹48,000\nபெறுநர்‌ quickcash21@ybl\nUPI குறிப்பு எண்‌ 512398447016\n9 அக் 2026 999988887777\nதேதி 14 Nov 2026, 11:42 am");
  assert.equal(f.amount, 48000);
  assert.equal(f.utr, "512398447016");
  assert.equal(f.vpa, "quickcash21@ybl");
});
