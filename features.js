/* Golden Hour add-ons, loaded after the main app script.
 * 1. OCR reads English + Tamil (Tamil-language GPay / PhonePe screenshots; the Tamil model also reads ₹ correctly).
 * 2. "Read aloud" for every draft, in Tamil or English, using the device's own speech engine (nothing uploaded).
 * 3. Installable and usable offline (service worker + manifest): victims often have weak signal. */
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const OCR_LANGS = ["eng", "tam"];

  /* 1. English + Tamil OCR: create the worker the app will reuse (runOCR only creates one if TRY.worker is empty). */
  if (typeof runOCR === "function" && typeof TRY === "object") {
    const original = runOCR;
    window.runOCR = async function (file) {
      if (!TRY.worker && !TRY.creating) {
        TRY.creating = (async () => {
          try {
            await loadScript("vendor/tesseract/tesseract.min.js");
            TRY.worker = await Tesseract.createWorker(OCR_LANGS, 1, { workerPath: "vendor/tesseract/worker.min.js", corePath: "vendor/tesseract/", langPath: "vendor/tesseract/lang", gzip: true });
          } catch (e) { /* fall back to the app's English-only worker */ }
        })();
      }
      const p = $("#progTxt"); if (p && !TRY.worker) p.textContent = "Loading OCR (English + தமிழ்)…";
      await TRY.creating;
      return original(file);
    };
  }

  /* 2. Read aloud. Adds a button next to "Save as PDF" whenever the plan is (re)built. */
  const canSpeak = "speechSynthesis" in window;
  function voiceFor(lang) {
    const vs = speechSynthesis.getVoices(), code = lang === "ta" ? "ta" : "en";
    return vs.find(v => v.lang && v.lang.toLowerCase().startsWith(code + "-in")) || vs.find(v => v.lang && v.lang.toLowerCase().startsWith(code)) || null;
  }
  function readAloud(btn) {
    if (speechSynthesis.speaking) { speechSynthesis.cancel(); btn.classList.remove("on"); return; }
    const lang = TRY.lang === "ta" ? "ta" : "en", v = voiceFor(lang);
    if (lang === "ta" && !v) { if (typeof toast === "function") toast("No Tamil voice on this device", "Install Tamil text-to-speech, or switch the draft to English"); return; }
    const text = GH.draft(TRY.doc, TRY.lang, TRY.case, TRY.plan).replace(/\[[^\]]*\]/g, " ").replace(/[₹]/g, lang === "ta" ? "ரூபாய் " : "rupees ");
    const u = new SpeechSynthesisUtterance(text); u.lang = lang === "ta" ? "ta-IN" : "en-IN"; if (v) u.voice = v; u.rate = 0.95;
    u.onend = u.onerror = () => btn.classList.remove("on");
    btn.classList.add("on"); speechSynthesis.speak(u);
  }
  function addReadAloud() {
    const pdf = $("#pdfDraft"); if (!pdf || $("#readDraft") || !canSpeak) return;
    const b = document.createElement("button"); b.className = "btn ghost sm"; b.id = "readDraft"; b.type = "button";
    b.innerHTML = (typeof icon === "function" ? icon("mic", 13) : "") + "Read aloud";
    b.title = "Read this draft aloud on your device (Tamil or English)";
    b.onclick = () => readAloud(b);
    pdf.after(b);
  }
  new MutationObserver(addReadAloud).observe(document.body, { childList: true, subtree: true });
  if (canSpeak) speechSynthesis.getVoices();

  /* 3. Offline + install. */
  if (!document.querySelector('link[rel="manifest"]')) {
    const l = document.createElement("link"); l.rel = "manifest"; l.href = "manifest.webmanifest"; document.head.appendChild(l);
  }
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
