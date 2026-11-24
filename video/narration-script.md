# Golden Hour demo: voice-over script

This script is for `video/golden-hour-demo.mp4` (1440x900, 2:05, no audio). It runs about 85 to 90 seconds of speech, leaving room to breathe. Read it in your own voice. Timings are when each line should **start**, matched to the on-screen captions.

All data in the video is synthetic. The Telegram chat and the agent steps in the victim journey are a scripted walkthrough. The OCR, the rules engine, the drafts, the pro-rata split, the mule clustering and the audit hashes are working code. Do not add claims beyond what is on screen.

## Script

| Start | On screen | Say |
|---|---|---|
| 0:00 | Title card: ₹772 cr frozen, ≈ ₹84 cr returned | **(Tamil)** தமிழ்நாட்டில் 2024-ல் 772 கோடி ரூபாய் மோசடிப் பணம் முடக்கப்பட்டது. திரும்பக் கிடைத்தது 84 கோடி மட்டுமே. <br>*(English meaning: "In Tamil Nadu in 2024, ₹772 crore of scam money was frozen. Only ₹84 crore came back.")* |
| 0:07 | Telegram chat, voice note, consent, evidence | This is Golden Hour, a scripted walkthrough on synthetic data. A victim sends a Tanglish voice note. The bot replies in Tamil, takes consent, then reads her screenshot and masks her Aadhaar. |
| 0:21 | Routes tab, then Drafts tab | Plain, sourced rules pick the official recovery routes. The drafter fills in the restoration request, FIR letter, bank dispute and court petition. She checks them and files them herself. |
| 0:33 | Deadlines tab, then audit chain | Deadline Guardian tracks the clocks that decide whether frozen money is lost. Each step is hashed into an audit chain. |
| 0:47 | Bank fraud-ops console, split bar, mule graph, approval | At the bank, three victims claim more than an eighty-thousand-rupee hold. Reconciliation splits it pro-rata, to the rupee. The mule graph links two accounts through one phone number, and an analyst approves every action. |
| 1:14 | Rules & sources table | Every rule cites its source, and values we still have to verify are flagged. |
| 1:20 | "Try it live" window, sample receipt being read | Try it yourself: real OCR reads a UPI screenshot right in the browser. |
| 1:31 | Held amount changed to ₹90,000, plan rebuilt, petition preview | Now ninety thousand rupees is held. Above fifty thousand, money comes back only with a court order, so the plan switches to a BNSS section 503 petition, drafted in Tamil and in English. |
| 1:47 | "Send case packet to bank desk", console shows "You" row | One tap sends the same case packet, with the same hash, to the bank desk. Her claim joins the hold and is split fairly. |
| 1:58 | End card | Golden Hour: no fees, and it never holds money. Try it live at golden-hour-khacks dot vercel dot app. |

Pronunciation help for the Tamil line: *Tamizhnaattil irandaayirathu irupaththi naangil, ezhunooru ezhupaththi irandu kodi roobaai mosadi panam mudakkappattathu. Thirumbak kidaiththathu enpaththi naangu kodi mattume.*

## How to record

1. Play the MP4 muted on a laptop and record your voice on a phone at the same time, in a quiet room, phone 20 to 30 cm from your mouth. Start the recording, then press play on the video, so it is easy to trim the start later.
2. Save the recording as `narration.m4a` (most phone voice recorders do this). If you trim it, make sure your first word lands at about 0:00 of the video.
3. If the voice starts a little late or early, shift it with `-itsoffset` (see below) instead of re-recording.

## Mux the voice onto the video

Run this from the repository root. It keeps the video stream as it is, encodes the voice to AAC, evens out the loudness, and pads the audio with silence so the output is exactly as long as the video:

```sh
ffmpeg -i video/golden-hour-demo.mp4 -i narration.m4a \
  -map 0:v:0 -map 1:a:0 -c:v copy \
  -af "loudnorm=I=-16:TP=-1.5:LRA=11,apad" -c:a aac -b:a 128k -ar 48000 \
  -shortest -movflags +faststart video/golden-hour-demo-voice.mp4
```

To delay the voice by half a second, put `-itsoffset 0.5` immediately before `-i narration.m4a`. To start it earlier, trim the recording first: `ffmpeg -ss 0.5 -i narration.m4a -c copy narration-trimmed.m4a`.

Check the result before uploading: `ffprobe -v error -show_entries format=duration -show_entries stream=codec_type video/golden-hour-demo-voice.mp4` should list one video and one audio stream and a duration of about 125 seconds.

## Upload

Upload `golden-hour-demo-voice.mp4` to YouTube as an **Unlisted** video (not Public, not Private, so judges can open the link without it being searchable). A suggested title: "Golden Hour: K! Hacks 4.0 FinTech demo (synthetic data)". In the description, say that the walkthrough uses synthetic data and link the live prototype, golden-hour-khacks.vercel.app. Then paste the YouTube link into the submission form and the README.
