# WhatsApp Medication Care Agent

An AI agent that helps an elderly person take her medication and keeps her caretaker in the loop — entirely inside WhatsApp. The patient never opens an app, never types, never learns anything new. Her phone just receives a WhatsApp message the way it always does.

Built for a hackathon. One patient, hardcoded, running locally. No auth, no database, no multi-patient support.

## How it works

Two separate 1:1 WhatsApp threads, driven by one shared state object (`data/patient.json`):

- **Patient thread** — voice notes, a photo of the medicine box, and two buttons: Taken / Not yet. Nothing else.
- **Caretaker thread** — where a photo of the medicine boxes is sent to set up the plan, and where alerts (missed dose, double dose, a concern, refill due) show up.

The patient must never see anything meant for the caretaker, and vice versa — they're kept strictly separate at the message level.

### Design rule that shapes everything

**The model never decides *when* or *whether* to escalate.** Deterministic code owns all timing and thresholds (the 40-minute follow-up, double-dose detection, refill warnings). The model's only two jobs are: (1) compose the actual sentence sent to each side, in-character per a fixed system prompt, and (2) classify what a reply means (does it resolve a pending dose, does it mention a concern) — it never gives medical advice, never interprets a symptom, never suggests a dose.

## Stack

- Node + TypeScript, run with `tsx`
- `@copilotkit/channels` (WhatsApp adapter over the Meta Cloud API) + `@copilotkit/runtime`
- Google Gemini (`@google/genai`) for vision (reading medicine labels), TTS (voice note reminders), and audio understanding (transcribing the patient's voice replies)
- ffmpeg (must be on `PATH`) to convert Gemini's raw PCM TTS output into WhatsApp-compatible OGG/Opus
- ngrok to expose the local webhook to Meta during development

## Setup

```sh
npm install
cp .env.example .env   # fill in the values below
```

### Required `.env` values

| Var | Where to get it |
|---|---|
| `WHATSAPP_ACCESS_TOKEN` | Meta App Dashboard → WhatsApp → API Setup. Temporary tokens expire in ~24h (often sooner in practice) — a permanent System User token is worth setting up for anything beyond a quick demo. |
| `WHATSAPP_PHONE_NUMBER_ID` | Same page as above. |
| `WHATSAPP_APP_SECRET` | Meta App Dashboard → App Settings → Basic → "App Secret". Used to verify webhook signatures. |
| `WHATSAPP_VERIFY_TOKEN` | Any string you choose — enter the same value in Meta's webhook config. |
| `COPILOTKIT_API_KEY` | From your CopilotKit account (free tier available). |
| `GEMINI_API_KEY` | Google AI Studio. |
| `PATIENT_THREAD_ID` / `CARETAKER_THREAD_ID` | The two WhatsApp numbers (E.164, no `+`) playing each role. Only used to seed `data/patient.json` on its first run — edit that file directly afterward. |

While in Meta's development/test-number mode, **both numbers must be added and verified** under WhatsApp → API Setup → recipient list before they can receive anything.

### Run it

```sh
npm run start          # starts the webhook server + scheduler on port 3000
```

In another terminal, expose it publicly and register the webhook in Meta's dashboard (Callback URL: `https://<your-ngrok-domain>/webhook`, path `/webhook`, subscribed to the `messages` field):

```sh
ngrok http 3000
```

One extra step specific to the Cloud API: the WhatsApp Business Account has to be explicitly subscribed to your app before webhooks are delivered (this doesn't happen automatically for a fresh dev app):

```sh
curl -X POST -H "Authorization: Bearer $WHATSAPP_ACCESS_TOKEN" \
  "https://graph.facebook.com/v21.0/<your-waba-id>/subscribed_apps"
```

### Capability probe

Before relying on the full pipeline, `npm run probe` sends a plain text, an image, an audio message, and interactive buttons to a test number (`PROBE_TEST_NUMBER` in `.env`) and reports which of the four actually delivered.

## What's built

| Step | Status |
|---|---|
| 1. Channel skeleton (send/receive proven end to end) | ✅ |
| 2. Capability probe (text/image/audio/buttons) | ✅ |
| 3. State model + JSON persistence | ✅ |
| 4. Setup from a photo (vision → caretaker confirms → committed) | ✅ |
| 5. Scheduler (once-a-minute dose check) | ✅ |
| 6. Patient responses (buttons + voice-note reconciliation) | ✅ |
| 7. Escalation ladder (40-min follow-up, double-dose, concern → alert) | ✅ |
| 8. Caretaker alert cards | ✅ (adherence-pattern summary card not yet built) |
| 9. Ambiguous AI tool actions (Mail/Tasks/Calendar/Drive via MCP) | ❌ not started — needs connection details |

## Known limitations

- **Silent-failure risk**: if the AI message-composition call fails after a state update already succeeded (e.g. a button tap), the patient may get no reply text even though her dose was correctly recorded.
- **Voice-based double-dose isn't detected** the same way a second button tap is — saying "I took it" twice via voice for an already-confirmed dose doesn't currently trigger the double-dose alert.
- In-memory de-dup for refill alerts resets on restart (a warning can repeat once after a restart).
- Durable `HistoryStore`/`ActionStore` are in-memory — conversation history and button-click continuations are lost on restart (fine for a demo, not for production).
- WhatsApp's Cloud API has no proactive messaging outside the 24-hour customer-service window — this only works because the demo starts with an inbound message from each side.
