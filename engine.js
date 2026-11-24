/* Golden Hour rules engine.
 * Pure functions, no DOM: the browser demo and the unit tests (tests/engine.test.js) use the same code.
 * Every rule value carries its source and whether it is official text, reported, or our own policy.
 * Output is information for the victim to check and file themselves, never legal advice. */
(function (root) {
  "use strict";

  const RULES = [
    { key: "SOP_SMALL_HOLD", value: 50000, unit: "₹ per held account", use: "At or below this, restoration without a court order (NCRP Money Restoration Module). Above it, a court order (BNSS s.503) or FIR is needed", src: "MHA / I4C SOP for NCRP-CFCFRMS, 02.01.2026 (Business Standard, LiveLaw)", status: "verify" },
    { key: "HOLD_LIFT_DAYS", value: 90, unit: "days", use: "Holds up to ₹50,000 lapse if no lawful direction arrives (bank warns police 15 days before). Above ₹50,000 the hold continues until the investigation ends or a court orders release", src: "MHA / I4C SOP, 02.01.2026 (LiveLaw, Jun 2026, as reported)", status: "verify" },
    { key: "HOLD_EXTENSION_DAYS", value: 90, unit: "days, once", use: "Investigating officer may extend the hold once", src: "MHA / I4C SOP, 02.01.2026 (as reported)", status: "verify" },
    { key: "S106_REPLY_DAYS", value: 15, unit: "days", use: "Account holder must justify the transaction after a BNSS s.106(3) notice, else release on indemnity bond", src: "MHA / I4C SOP, 02.01.2026 (legal commentary)", status: "verify" },
    { key: "BANK_REPORT_WD", value: 3, unit: "working days", use: "Zero-liability reporting window for payments before 1 Jan 2027", src: "RBI circular on limiting customer liability, 6 Jul 2017", status: "official" },
    { key: "RBI_2027_FROM", value: "2027-01-01", unit: "payment date", use: "Payments a victim was tricked into authorising are covered; burden of proof on the bank; 45-day resolution", src: "RBI Responsible Business Conduct (Third Amendment) Directions, 24 Jun 2026", status: "official" },
    { key: "RBI_2027_REPORT_DAYS", value: 5, unit: "days", use: "No customer loss if reported within this window and the fault lies with the bank or a third party", src: "RBI directions, 24 Jun 2026 (as reported)", status: "verify" },
    { key: "SMALL_COMP_MAX_LOSS", value: 50000, unit: "₹ net loss", use: "One-time small-value compensation: 85% of net loss, capped at ₹25,000, once per customer", src: "RBI directions, 24 Jun 2026 (Business Standard, Business Today)", status: "verify" },
    { key: "OMBUDSMAN_DAYS", value: 365, unit: "days", use: "Complain to the RBI Ombudsman within one year of the bank's reply, or after 30 days with no reply", src: "RB-IOS 2021, cl. 10; carried into RB-IOS 2026 (as reported)", status: "verify" },
    { key: "MAGISTRATE_ROUTE", value: "BNSS s.503", unit: "", use: "Court-ordered release; Madras HC: an NCRP acknowledgement is enough, no need to wait for an FIR", src: "BNSS 2023; DT Next report on Madras HC circular (2025)", status: "official" },
    { key: "PII_RETENTION", value: 30, unit: "days", use: "Delete screenshots and SMS after the case packet is filed", src: "Golden Hour policy under DPDP Act 2023 / Rules 2025", status: "policy" },
  ];
  const R = Object.fromEntries(RULES.map(r => [r.key, r.value]));
  const DAY = 864e5;

  // Working days are counted on the IST calendar, whatever the device's time zone.
  const addWD = (d, n) => { let x = new Date(d).getTime(), c = 0; while (c < n) { x += 864e5; const w = new Date(x + 330 * 6e4).getUTCDay(); if (w && w !== 6) c++; } return new Date(x); };
  const addD = (d, n) => new Date(new Date(d).getTime() + n * DAY);
  const fmtD = d => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  const fmtDT = d => new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
  const inr = n => "₹" + Math.round(n).toLocaleString("en-IN");

  /* Validation shared by the UI and the tests. */
  function validate(c) {
    const errs = [];
    if (!(c.amount > 0)) errs.push("amount");
    if (!/^[0-9]{12}$/.test(c.utr || "")) errs.push("12-digit UTR");
    if (!c.paidAt) errs.push("payment time");
    if (!c.reportedAt) errs.push("report time");
    if (c.paidAt && c.reportedAt && c.reportedAt < c.paidAt) errs.push("a report time after the payment time");
    if (c.ack && !/^[0-9]{14}$/.test(c.ack)) errs.push("14-digit NCRP acknowledgement");
    return errs;
  }

  /* Decide routes, deadlines and documents for one case.
   * c = { amount, held, utr, vpa, paidAt: Date, reportedAt: Date, ack? }, now = Date */
  function planCase(c, now) {
    now = now || new Date();
    const paid = new Date(c.paidAt), rep = new Date(c.reportedAt);
    const held = Math.max(0, c.held || 0), amount = c.amount;
    const mins = Math.round((rep - paid) / 6e4);
    const golden = mins >= 0 && mins <= 60;
    const big = held > R.SOP_SMALL_HOLD;
    const rbi2027 = paid >= new Date(R.RBI_2027_FROM + "T00:00:00+05:30");
    const bankDue = rbi2027 ? addD(paid, R.RBI_2027_REPORT_DAYS) : addWD(paid, R.BANK_REPORT_WD);
    const bankDaysLeft = Math.ceil((bankDue - now) / DAY);
    const holdLapses = held > 0 && held <= R.SOP_SMALL_HOLD;
    const holdLift = addD(rep, R.HOLD_LIFT_DAYS), holdLiftMax = addD(holdLift, R.HOLD_EXTENSION_DAYS);
    const holdDaysLeft = Math.ceil((holdLift - now) / DAY);
    const claim = Math.min(held, amount);
    const compEligible = rbi2027 && amount <= R.SMALL_COMP_MAX_LOSS;
    const compAmount = Math.min(0.85 * amount, 25000);

    const routes = [];
    if (!held) {
      routes.push({ id: "report", tone: "gold", rec: true, title: "Report on 1930 / cybercrime.gov.in now", desc: "Nothing is held yet. Restoration needs a hold on the scammer's account, and the police can only place one after a report. Call 1930 or file at cybercrime.gov.in, then come back with the 14-digit acknowledgement." });
    } else if (!big) {
      routes.push({ id: "mrm", tone: "gold", rec: true, title: "NCRP Money Restoration request", desc: `${inr(held)} is held, within the ${inr(R.SOP_SMALL_HOLD)} per-account limit, so no court order is needed. Apply on the Money Restoration Module with your acknowledgement number.`, doc: "restoration" });
    } else {
      routes.push({ id: "s503", tone: "gold", rec: true, title: "Magistrate release petition · BNSS s.503", desc: `${inr(held)} is held, above the ${inr(R.SOP_SMALL_HOLD)} limit, so a court order is needed. Madras HC: your NCRP acknowledgement is enough, you need not wait for an FIR. Petition drafted in Tamil and English.`, doc: "s503" });
      routes.push({ id: "s106", tone: "info", title: "Ask the investigating officer for a s.106(3) notice", desc: `The account holder then has ${R.S106_REPLY_DAYS} days to justify the money. If they cannot, the officer can direct the bank to release it to you on an indemnity bond.` });
      routes.push({ id: "mrm", tone: "info", title: "NCRP Money Restoration request + FIR", desc: "File in parallel so the case is on record with the police.", doc: "restoration" });
    }
    routes.push({ id: "bank", tone: bankDaysLeft >= 0 ? "warn" : "neutral", title: "Bank dispute letter", doc: "bank",
      desc: bankDaysLeft >= 0 ? `Report to your bank by ${fmtD(bankDue)} (${bankDaysLeft} day${bankDaysLeft === 1 ? "" : "s"} left). ${rbi2027 ? "Under the 2027 RBI rules the bank must prove you were at fault and resolve within 45 days." : "The 2017 RBI liability rules apply to this payment."}`
        : `The reporting window ended on ${fmtD(bankDue)}. File it anyway; it is the first step before the RBI Ombudsman.` });
    routes.push({ id: "comp", tone: compEligible ? "good" : "neutral", title: "RBI small-value compensation",
      desc: compEligible ? `Your loss is up to ${inr(R.SMALL_COMP_MAX_LOSS)}, so you can claim about ${inr(compAmount)} (85%, up to ₹25,000) once through your bank.`
        : amount > R.SMALL_COMP_MAX_LOSS ? `Only covers losses up to ${inr(R.SMALL_COMP_MAX_LOSS)} and pays at most ₹25,000. Getting the frozen money back matters more for you.`
          : "Only for payments made on or after 1 Jan 2027. Your payment is earlier, so it does not apply." });
    if (holdLapses) routes.push({ id: "hold", tone: holdDaysLeft <= 15 ? "crit" : "neutral", title: "Watch the 90-day hold",
      desc: `If no restoration or court order arrives, the hold can lapse around ${fmtD(holdLift)} (${Math.max(0, holdDaysLeft)} days). The officer can extend it once, to about ${fmtD(holdLiftMax)}. We remind you at 30, 15 and 5 days.` });
    else if (held) routes.push({ id: "hold", tone: "neutral", title: "Track the hold",
      desc: "Above ₹50,000 the hold generally stays until the investigation ends or a court orders release. It will not lapse on its own, but the money only reaches you through a court order, so file the petition rather than wait. We check the case status every 15 days." });
    routes.push({ id: "ombudsman", tone: "neutral", title: "RBI Ombudsman (cms.rbi.org.in)", desc: "If the bank rejects your claim, or does not reply within 30 days, complain online at cms.rbi.org.in within one year. It is free." });

    const docs = ["restoration", "s503", "bank"].filter(d => held || d === "bank");
    const primary = (routes.find(r => r.rec && r.doc) || {}).doc || "bank";
    return { mins, golden, big, holdLapses, rbi2027, bankDue, bankDaysLeft, holdLift, holdLiftMax, holdDaysLeft, claim, held, amount, compEligible, compAmount, routes, docs, primary };
  }

  const ph = (v, fill) => v ? v : fill;
  const FOOT = {
    en: "This is a draft for you to check and file yourself. It is information, not legal advice. Free legal aid: call 15100 (NALSA) or your District Legal Services Authority. Golden Hour never charges fees and never asks for your OTP or PIN. Anyone who offers to recover your money for a fee is a scammer.",
    ta: "இது நீங்களே சரிபார்த்துத் தாக்கல் செய்வதற்கான வரைவு மட்டுமே; சட்ட ஆலோசனை அல்ல. இலவச சட்ட உதவிக்கு 15100 (NALSA) அல்லது உங்கள் மாவட்ட சட்டப் பணிகள் ஆணையத்தை அணுகவும். Golden Hour எந்தக் கட்டணமும் வசூலிப்பதில்லை; OTP அல்லது PIN கேட்பதில்லை. கட்டணம் வாங்கிப் பணத்தை மீட்டுத் தருவதாகச் சொல்பவர்கள் மோசடியாளர்களே.",
  };

  /* Draft text for one document in "en" or "ta". */
  function draft(doc, lang, c, p) {
    const ack = ph(c.ack, lang === "ta" ? "[14 இலக்க எண்]" : "[14 digits]");
    const vpa = ph(c.vpa, lang === "ta" ? "[பெறுநர் UPI ID]" : "[payee UPI ID]");
    const paid = fmtDT(c.paidAt), rep = fmtDT(c.reportedAt), amt = inr(c.amount);
    const held = p.held ? inr(p.held) : (lang === "ta" ? "[காவல்துறை SMS-ல் உள்ள தொகை]" : "[amount from police SMS]");
    const claim = p.held ? inr(p.claim) : held;
    const T = {
      restoration: {
        en: `MONEY RESTORATION REQUEST · NCRP Money Restoration Module

NCRP acknowledgement no.: ${ack}
Transaction: UPI Ref ${c.utr}, ${amt} paid to ${vpa} on ${paid}.
Reported to 1930 / cybercrime.gov.in: ${rep} (${p.mins} minutes after payment).
Amount held in the beneficiary account: ${held}.
My bank account for the refund: [account number, IFSC]
Attachments: payment screenshot, NCRP acknowledgement SMS${p.big ? ", FIR copy or s.503 petition (held amount is above ₹50,000)" : ""}.

I request restoration of ${claim}, which was taken from me by deception and is now held.

Name: [your name]    Date: [date]    Signature: [signature]`,
        ta: `பணத்தைத் திருப்பித் தரக் கோரும் விண்ணப்பம் · NCRP Money Restoration Module

NCRP ஒப்புகை எண்: ${ack}
பரிவர்த்தனை: UPI Ref ${c.utr}, ${amt} தொகை ${vpa}-க்கு ${paid} அன்று செலுத்தப்பட்டது.
1930 / cybercrime.gov.in-ல் புகார்: ${rep} (பணம் செலுத்திய ${p.mins} நிமிடங்களில்).
பயனாளர் கணக்கில் முடக்கப்பட்ட தொகை: ${held}.
பணம் திரும்ப வர வேண்டிய என் வங்கிக் கணக்கு: [கணக்கு எண், IFSC]
இணைப்புகள்: பணம் செலுத்திய திரைப்பிடிப்பு, NCRP ஒப்புகை SMS${p.big ? ", FIR நகல் அல்லது பிரிவு 503 மனு (முடக்கப்பட்ட தொகை ₹50,000-க்கு மேல்)" : ""}.

ஏமாற்றி என்னிடமிருந்து பெறப்பட்டு, தற்போது முடக்கப்பட்டுள்ள ${claim} தொகையை எனக்குத் திருப்பித் தருமாறு கேட்டுக்கொள்கிறேன்.

பெயர்: [உங்கள் பெயர்]    தேதி: [தேதி]    கையொப்பம்: [கையொப்பம்]`,
      },
      s503: {
        en: `BEFORE THE HON'BLE JUDICIAL MAGISTRATE, [court], [district]

Petition under Section 503 of the Bharatiya Nagarik Suraksha Sanhita, 2023, for release of money held in a bank account

Petitioner: [your name], [address]
NCRP acknowledgement no.: ${ack}

1. On ${paid}, the petitioner was deceived into paying ${amt} by UPI (UTR ${c.utr}) to ${vpa}.
2. The petitioner reported the fraud on the 1930 helpline / cybercrime.gov.in on ${rep}, ${p.mins} minutes later.
3. ${held} is now held in the beneficiary account [account number, bank].
4. This money belongs to the petitioner. Under the Madras High Court circular, the NCRP acknowledgement is sufficient and the petitioner need not wait for an FIR.
5. The amount has been held since ${rep}. Under the MHA SOP of 2 January 2026, amounts above ₹50,000 can be released to the victim only on a court order. The petitioner has no other remedy and requests early orders.

PRAYER: The petitioner prays that this Hon'ble Court direct the bank to release ${claim} to the petitioner's account [account number, IFSC], on such terms as this Court thinks fit, including an indemnity bond.

Enclosures: payment screenshot, NCRP acknowledgement SMS, bank statement, identity proof.

Place: [place]    Date: [date]    Signature of petitioner: [signature]`,
        ta: `மாண்புமிகு நீதித்துறை நடுவர் அவர்கள் முன்பு, [நீதிமன்றம்], [மாவட்டம்]

பாரதிய நாகரிக் சுரக்ஷா சன்ஹிதா, 2023 பிரிவு 503-ன் கீழ், வங்கிக் கணக்கில் முடக்கப்பட்ட பணத்தை விடுவிக்கக் கோரும் மனு

மனுதாரர்: [உங்கள் பெயர்], [முகவரி]
NCRP ஒப்புகை எண்: ${ack}

1. ${paid} அன்று, மனுதாரர் ஏமாற்றப்பட்டு ${amt} தொகையை UPI மூலம் (UTR ${c.utr}) ${vpa}-க்குச் செலுத்தினார்.
2. மனுதாரர் ${rep} அன்று, அதாவது ${p.mins} நிமிடங்களில், 1930 உதவி எண் / cybercrime.gov.in-ல் புகார் அளித்தார்.
3. பயனாளர் கணக்கில் [கணக்கு எண், வங்கி] ${held} தொகை தற்போது முடக்கப்பட்டுள்ளது.
4. இந்தப் பணம் மனுதாரருக்கே உரியது. சென்னை உயர் நீதிமன்ற சுற்றறிக்கையின்படி NCRP ஒப்புகை எண் போதுமானது; FIR-க்காகக் காத்திருக்கத் தேவையில்லை.
5. இந்தத் தொகை ${rep} முதல் முடக்கத்தில் உள்ளது. உள்துறை அமைச்சகத்தின் 2 ஜனவரி 2026 SOP-ன்படி, ₹50,000-க்கு மேற்பட்ட தொகையை நீதிமன்ற உத்தரவின் மூலம் மட்டுமே பாதிக்கப்பட்டவருக்கு விடுவிக்க முடியும். மனுதாரருக்கு வேறு தீர்வு இல்லாததால், விரைவான உத்தரவு கோரப்படுகிறது.

கோரிக்கை: முடக்கப்பட்ட ${claim} தொகையை மனுதாரரின் கணக்கிற்கு [கணக்கு எண், IFSC] விடுவிக்குமாறு, இழப்பீட்டுப் பிணைப் பத்திரம் உட்பட இந்நீதிமன்றம் பொருத்தமெனக் கருதும் நிபந்தனைகளுடன், வங்கிக்கு உத்தரவிட வேண்டுமென மனுதாரர் பணிவுடன் கேட்டுக்கொள்கிறார்.

இணைப்புகள்: பணம் செலுத்திய திரைப்பிடிப்பு, NCRP ஒப்புகை SMS, வங்கி அறிக்கை, அடையாளச் சான்று.

இடம்: [இடம்]    தேதி: [தேதி]    மனுதாரர் கையொப்பம்: [கையொப்பம்]`,
      },
      bank: {
        en: `To: The Branch Manager / Grievance Nodal Officer, [bank], [branch]

Subject: Fraudulent UPI transaction: request to record, hold and reverse

I was deceived into paying ${amt} on ${paid} (UPI Ref ${c.utr}) to ${vpa}. I reported it to 1930 / NCRP on ${rep}. NCRP acknowledgement no.: ${ack}.

I request you to:
1. record this as a fraudulent transaction on my account [account number];
2. ask the beneficiary bank to keep the amount on hold;
3. process my claim under ${p.rbi2027 ? "the RBI directions in force from 1 January 2027" : "the RBI circular on limiting customer liability (6 July 2017)"}${p.compEligible ? ", including the one-time small-value compensation" : ""};
4. give me a complaint reference number in writing.

If this is not resolved, I will approach the RBI Ombudsman at cms.rbi.org.in.

Name: [your name]    Mobile: [number]    Date: [date]`,
        ta: `பெறுநர்: கிளை மேலாளர் / குறைதீர் அலுவலர், [வங்கி], [கிளை]

பொருள்: மோசடி UPI பரிவர்த்தனை: பதிவு செய்து, முடக்கி, திருப்பித் தரக் கோரிக்கை

நான் ஏமாற்றப்பட்டு ${paid} அன்று ${amt} தொகையை (UPI Ref ${c.utr}) ${vpa}-க்குச் செலுத்தினேன். ${rep} அன்று 1930 / NCRP-ல் புகார் அளித்தேன். NCRP ஒப்புகை எண்: ${ack}.

தயவுசெய்து:
1. என் கணக்கில் [கணக்கு எண்] இதை மோசடிப் பரிவர்த்தனையாகப் பதிவு செய்யவும்;
2. பயனாளர் வங்கியிடம் அந்தத் தொகையை முடக்கத்தில் வைக்கக் கோரவும்;
3. ${p.rbi2027 ? "1 ஜனவரி 2027 முதல் நடைமுறையில் உள்ள RBI வழிகாட்டுதல்களின்படி" : "RBI வாடிக்கையாளர் பொறுப்பு வரம்பு சுற்றறிக்கையின்படி (6 ஜூலை 2017)"} என் கோரிக்கையைப் பரிசீலிக்கவும்${p.compEligible ? "; ஒருமுறை வழங்கப்படும் சிறுதொகை இழப்பீட்டையும் சேர்த்து" : ""};
4. புகார் குறிப்பு எண்ணை எழுத்துமூலம் வழங்கவும்.

தீர்வு கிடைக்காவிட்டால், RBI குறைதீர்ப்பாளரை cms.rbi.org.in-ல் அணுகுவேன்.

பெயர்: [உங்கள் பெயர்]    கைபேசி: [எண்]    தேதி: [தேதி]`,
      },
    };
    const body = (T[doc] || T.bank)[lang === "ta" ? "ta" : "en"];
    return body + "\n\n— " + FOOT[lang === "ta" ? "ta" : "en"] + "\n";
  }

  /* Pro-rata split of one lien across all victim claims on that account.
   * Shares are whole rupees, never exceed a claim, and sum exactly to min(lien, total claims). */
  function splitLien(claims, lien) {
    const total = claims.reduce((s, c) => s + c.amount, 0), ratio = total ? Math.min(1, lien / total) : 0;
    const sh = claims.map(c => ({ ...c, share: Math.floor(c.amount * ratio) }));
    let rem = Math.min(lien, total) - sh.reduce((s, x) => s + x.share, 0);
    const order = [...sh].sort((a, b) => b.amount - a.amount);
    for (let i = 0; rem > 0 && order.length; i = (i + 1) % order.length) { if (order[i].share < order[i].amount) { order[i].share++; rem--; } }
    return { claims: sh, total, lien, ratio };
  }

  /* Union-find over case → payee UPI ID → account → phone links. Returns connected groups, largest first. */
  function clusterGraph(cases, acctPhone) {
    const parent = {}; const f = x => (parent[x] ??= x, parent[x] === x ? x : (parent[x] = f(parent[x])));
    const edges = [];
    cases.forEach(c => edges.push(["case:" + c.id, "vpa:" + c.vpa], ["vpa:" + c.vpa, "acct:" + c.acct]));
    Object.entries(acctPhone).forEach(([a, p]) => edges.push(["acct:" + a, "phone:" + p]));
    edges.forEach(([a, b]) => { parent[f(a)] = f(b); });
    const g = {}; Object.keys(parent).forEach(n => (g[f(n)] ??= []).push(n));
    return { edges, groups: Object.values(g).sort((a, b) => b.length - a.length) };
  }

  /* The case packet both crews share. Same fields on the victim and bank side; hashed for the audit trail. */
  function casePacket(c, p) {
    return { schema: "golden-hour/case-packet@1", amount_inr: c.amount, held_inr: p.held, utr: c.utr, payee_vpa: c.vpa || null, ncrp_ack: c.ack || null,
      paid_at: new Date(c.paidAt).toISOString(), reported_at: new Date(c.reportedAt).toISOString(), reported_after_min: p.mins,
      route: p.routes.filter(r => r.rec).map(r => r.id)[0] || null, rbi_regime: p.rbi2027 ? "2027" : "2017",
      deadlines: { bank_report: new Date(p.bankDue).toISOString().slice(0, 10), hold_lift: p.holdLapses ? new Date(p.holdLift).toISOString().slice(0, 10) : null } };
  }

  /* ---------- Receipt parsing (shared by the demo and tests/ocr-bench) ---------- */
  const INDIAN = /^[0-9]{1,2}(?:,[0-9]{2})*,[0-9]{3}(?:\.[0-9]{1,2})?$|^[0-9]{1,3}(?:\.[0-9]{1,2})?$/;
  const AMOUNT_ONLY = /^[0-9]{1,3}(?:,[0-9]{2,3})+(?:\.[0-9]{1,2})?$/;
  // The English OCR model often reads the ₹ glyph as 3, 2, T, ¥, <, %, ? or F. On a line that holds only an
  // amount, treat that glyph as ₹. A digit is only treated as ₹ when the full number breaks Indian digit
  // grouping and the rest fits it (₹48,000 → "348,000" → 48,000; a real ₹3,48,000 is never touched).
  function fixRupee(txt) {
    return txt.split("\n").map(line => {
      const l = line.trim();
      let m = l.match(/^([3T¥<%?zZF2])\s+([0-9][0-9,]*(?:\.[0-9]{1,2})?)$/);
      if (m && AMOUNT_ONLY.test(m[2])) return "₹" + m[2];
      m = l.match(/^([T¥<%?zZF])([0-9][0-9,]*(?:\.[0-9]{1,2})?)$/);
      if (m && AMOUNT_ONLY.test(m[2])) return "₹" + m[2];
      m = l.match(/^([32])([0-9][0-9,]*(?:\.[0-9]{1,2})?)$/);
      if (m && AMOUNT_ONLY.test(m[1] + m[2]) && !INDIAN.test(m[1] + m[2]) && INDIAN.test(m[2])) return "₹" + m[2];
      return line;
    }).join("\n");
  }
  const HANDLES = ["ybl", "ibl", "axl", "okaxis", "oksbi", "okhdfcbank", "okicici", "paytm", "upi", "apl", "sbi", "icici", "hdfcbank", "axisbank", "kotak", "idfcbank", "fbl", "jupiteraxis", "freecharge", "airtel", "demo"];
  function lev(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
  // Snap a misread handle (e.g. "yhbl") to a known UPI handle when exactly one is a single edit away.
  function fixHandle(vpa) {
    const [u, h] = vpa.split("@"); if (!h || HANDLES.includes(h)) return vpa;
    const near = HANDLES.filter(x => lev(x, h) === 1);
    return near.length === 1 ? u + "@" + near[0] : vpa;
  }

  function parseReceipt(t) {
      const txt = fixRupee((t || "").replace(/[|]/g, " "));
    const out = { amount: null, utr: null, vpa: null, when: null, ack: null, aadhaar: false };
    const amt = [...txt.matchAll(/(?:₹|Rs\.?|INR|%|\?)\s?([0-9]{1,3}(?:,[0-9]{2,3})+(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)(?![0-9])/gi)].map(m => Number(m[1].replace(/,/g, ""))).filter(n => n >= 1 && n < 1e8);
    if (amt.length) out.amount = Math.max(...amt);
    if (!out.amount) {
      const lines = txt.split(/\n/).map(l => l.trim());
      const hit = lines.map(l => l.match(/^[^0-9A-Za-z]{0,3}([0-9]{1,2}(?:,[0-9]{2})*,[0-9]{3}(?:\.[0-9]{1,2})?|[0-9]{3,6}\.[0-9]{2})[^0-9A-Za-z]{0,3}$/)).find(Boolean);
      if (hit) out.amount = Number(hit[1].replace(/,/g, ""));
    }
    const ref = txt.match(/(?:UTR|UPI\s*Ref(?:erence)?\.?\s*(?:No\.?|ID)?|UPI\s*transaction\s*ID|Ref(?:erence)?\s*No\.?|RRN|குறிப்பு\s*எண்|பரிவர்த்தனை\s*(?:ஐடி|எண்))[^0-9]{0,12}([0-9]{12})(?![0-9])/i);
    out.utr = ref ? ref[1] : ((txt.match(/(?<![0-9])([0-9]{12})(?![0-9])/) || [])[1] || null);
    // UPI IDs end in a handle with no dot-domain after it (excludes emails such as support@bank.com)
    const vpas = [...txt.matchAll(/([a-zA-Z0-9.\-_]{2,})\s?@\s?([a-zA-Z][a-zA-Z0-9]{1,})(?![.a-zA-Z0-9])/g)].map(m => (m[1] + "@" + m[2]).toLowerCase());
    if (vpas.length) out.vpa = fixHandle(vpas[0]);
    const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    let Y, Mo, D;
    let m = txt.match(/([0-3]?[0-9])(?:st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?,?\s+(20[0-9]{2})/i);
    if (m) { D = +m[1]; Mo = MON[m[2].slice(0, 3).toLowerCase()]; Y = +m[3]; }
    else if ((m = txt.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+([0-3]?[0-9]),?\s+(20[0-9]{2})/i))) { D = +m[2]; Mo = MON[m[1].slice(0, 3).toLowerCase()]; Y = +m[3]; }
    else if ((m = txt.match(/([0-3]?[0-9])[\/\-.]([0-1]?[0-9])[\/\-.](20[0-9]{2})/))) { D = +m[1]; Mo = +m[2] - 1; Y = +m[3]; }
    if (Y && Mo >= 0 && Mo < 12 && D >= 1 && D <= 31) {
      const TIME = /\b([0-2]?[0-9]):([0-5][0-9])(?::[0-5][0-9])?\s*(am|pm|AM|PM)?/;
      const near = txt.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30);
      let hh = 0, mm = 0; const tm = near.match(TIME) || txt.match(TIME);
      if (tm) { hh = +tm[1]; mm = +tm[2]; if (tm[3] && /pm/i.test(tm[3]) && hh < 12) hh += 12; if (tm[3] && /am/i.test(tm[3]) && hh === 12) hh = 0; if (hh > 23) hh = 0; }
      out.when = new Date(Date.UTC(Y, Mo, D, hh, mm) - 330 * 6e4); out.timeFound = !!tm; // receipts show IST
    }
    const a = txt.match(/(?<![0-9])([0-9]{14})(?![0-9])/); if (a) out.ack = a[1];
    out.aadhaar = /\b[2-9][0-9]{3}\s[0-9]{4}\s[0-9]{4}\b/.test(txt);
    return out;
  }

  const DOC_NAMES = { restoration: ["Restoration request", "மீட்பு விண்ணப்பம்"], s503: ["s.503 petition", "பிரிவு 503 மனு"], bank: ["Bank letter", "வங்கிக் கடிதம்"] };

  const GH = { RULES, R, addWD, addD, fmtD, fmtDT, inr, validate, planCase, draft, parseReceipt, splitLien, clusterGraph, casePacket, DOC_NAMES };
  if (typeof module !== "undefined" && module.exports) module.exports = GH;
  root.GH = GH;
})(typeof window !== "undefined" ? window : globalThis);
