/* Golden Hour rules engine.
 * Pure functions, no DOM: the browser demo and the unit tests (tests/engine.test.js) use the same code.
 * Every rule value carries its source and whether it is official text, reported, or our own policy.
 * Output is information for the victim to check and file themselves, never legal advice. */
(function (root) {
  "use strict";

  const RULES = [
    { key: "SOP_SMALL_HOLD", value: 50000, unit: "₹ per held account", use: "At or below this, restoration without a court order (NCRP Money Restoration Module). Above it, a court order (BNSS s.503) or FIR is needed", src: "MHA / I4C SOP for NCRP-CFCFRMS, 02.01.2026 (Business Standard, LiveLaw)", status: "verify" },
    { key: "HOLD_LIFT_DAYS", value: 90, unit: "days", use: "Hold lapses if no lawful direction arrives; bank warns police 15 days before", src: "MHA / I4C SOP, 02.01.2026 (as reported)", status: "verify" },
    { key: "HOLD_EXTENSION_DAYS", value: 90, unit: "days, once", use: "Investigating officer may extend the hold once", src: "MHA / I4C SOP, 02.01.2026 (as reported)", status: "verify" },
    { key: "S106_REPLY_DAYS", value: 15, unit: "days", use: "Account holder must justify the transaction after a BNSS s.106(3) notice, else release on indemnity bond", src: "MHA / I4C SOP, 02.01.2026 (legal commentary)", status: "verify" },
    { key: "BANK_REPORT_WD", value: 3, unit: "working days", use: "Zero-liability reporting window for payments before 1 Jan 2027", src: "RBI circular on limiting customer liability, 6 Jul 2017", status: "official" },
    { key: "RBI_2027_FROM", value: "2027-01-01", unit: "payment date", use: "Payments a victim was tricked into authorising are covered; burden of proof on the bank; 45-day resolution", src: "RBI Responsible Business Conduct (Third Amendment) Directions, 24 Jun 2026", status: "official" },
    { key: "RBI_2027_REPORT_DAYS", value: 5, unit: "days", use: "No customer loss if reported within this window and the fault lies with the bank or a third party", src: "RBI directions, 24 Jun 2026 (as reported)", status: "verify" },
    { key: "SMALL_COMP_MAX_LOSS", value: 50000, unit: "₹ net loss", use: "One-time small-value compensation: 85% of net loss, capped at ₹25,000, once per customer", src: "RBI directions, 24 Jun 2026 (Business Standard, Business Today)", status: "verify" },
    { key: "OMBUDSMAN_DAYS", value: 90, unit: "days", use: "Escalation window to the RBI Ombudsman after the bank rejects or does not resolve", src: "RB-IOS 2026 (from 1 Jul 2026, as reported)", status: "verify" },
    { key: "MAGISTRATE_ROUTE", value: "BNSS s.503", unit: "", use: "Court-ordered release; Madras HC: an NCRP acknowledgement is enough, no need to wait for an FIR", src: "BNSS 2023; DT Next report on Madras HC circular (2025)", status: "official" },
    { key: "PII_RETENTION", value: 30, unit: "days", use: "Delete screenshots and SMS after the case packet is filed", src: "Golden Hour policy under DPDP Act 2023 / Rules 2025", status: "policy" },
  ];
  const R = Object.fromEntries(RULES.map(r => [r.key, r.value]));
  const DAY = 864e5;

  const addWD = (d, n) => { const x = new Date(d); let c = 0; while (c < n) { x.setDate(x.getDate() + 1); const w = x.getDay(); if (w && w !== 6) c++; } return x; };
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
    if (held) routes.push({ id: "hold", tone: holdDaysLeft <= 15 ? "crit" : "neutral", title: "Watch the 90-day hold",
      desc: `If no restoration or court order arrives, the hold can lapse around ${fmtD(holdLift)} (${Math.max(0, holdDaysLeft)} days). The officer can extend it once, to about ${fmtD(holdLiftMax)}. We remind you at 30, 15 and 5 days.` });
    routes.push({ id: "ombudsman", tone: "neutral", title: "RBI Ombudsman (cms.rbi.org.in)", desc: `If the bank rejects your claim or does not reply, escalate within ${R.OMBUDSMAN_DAYS} days. Free, online.` });

    const docs = ["restoration", "s503", "bank"].filter(d => held || d === "bank");
    const primary = (routes.find(r => r.rec && r.doc) || {}).doc || "bank";
    return { mins, golden, big, rbi2027, bankDue, bankDaysLeft, holdLift, holdLiftMax, holdDaysLeft, claim, held, amount, compEligible, compAmount, routes, docs, primary };
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
5. Under the MHA SOP of 2 January 2026, the hold may lapse around ${fmtD(p.holdLift)}. Urgent orders are therefore requested.

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
5. உள்துறை அமைச்சகத்தின் 2 ஜனவரி 2026 SOP-ன்படி இந்த முடக்கம் சுமார் ${fmtD(p.holdLift)} அன்று நீங்கக்கூடும். எனவே அவசர உத்தரவு கோரப்படுகிறது.

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

  const DOC_NAMES = { restoration: ["Restoration request", "மீட்பு விண்ணப்பம்"], s503: ["s.503 petition", "பிரிவு 503 மனு"], bank: ["Bank letter", "வங்கிக் கடிதம்"] };

  const GH = { RULES, R, addWD, addD, fmtD, fmtDT, inr, validate, planCase, draft, DOC_NAMES };
  if (typeof module !== "undefined" && module.exports) module.exports = GH;
  root.GH = GH;
})(typeof window !== "undefined" ? window : globalThis);
