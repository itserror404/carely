# Build prompt: WhatsApp medication care agent

You are building a hackathon project in Node + TypeScript. Read this whole brief before writing code.

## What we're building

An AI agent that helps an elderly person take their medication, and keeps their adult children in the loop. It lives entirely inside WhatsApp. The elderly person never opens an app, never types, never learns anything new. Their phone just receives a WhatsApp message the way it always does.

There are two separate WhatsApp conversations, driven by one agent and one shared state object:

- **Patient thread** — a one-to-one chat with the elderly person. Deliberately minimal.
- **Family group** — a group chat with the adult children. This is where the detail lives.

The patient must never see the family discussing her adherence. Keep the two strictly separated at the message level.

## Stack

- Node + TypeScript, run locally with `tsx`
- `@copilotkit/channels` with the WhatsApp adapter (Meta WhatsApp Cloud API underneath)
- `@copilotkit/runtime`, `@tanstack/ai`, `@tanstack/ai-openai`
- OpenAI for the model and for Whisper transcription
- Ambiguous AI over MCP for real-world actions (Mail, Tasks, Calendar, Drive)
- ngrok to expose the webhook to Meta

Install:

```
npm install @copilotkit/channels @copilotkit/runtime @tanstack/ai @tanstack/ai-openai
```

Env vars that will exist:

```
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_APP_SECRET=
WHATSAPP_VERIFY_TOKEN=
COPILOTKIT_API_KEY=
COPILOTKIT_INTELLIGENCE_URL=
OPENAI_API_KEY=
```

Follow the CopilotKit Channels WhatsApp docs for the adapter setup. The runtime drives the channel — do not call `channel.start()` yourself; mount the node listener and call `ready()`. Serve the webhook on port 3000 at `/webhook`.

## Constraints that shape the design

1. **WhatsApp 24-hour window.** Business-initiated messages outside 24 hours require an approved template, which we don't have. Assume every demo run begins with the patient sending an inbound message, which opens the window. Do not build template handling.
2. **The patient side must survive a user who cannot type.** Buttons and voice notes only.
3. **No clinical reasoning, ever.** The agent records, asks and escalates. It never interprets a symptom, never suggests a dose, never gives medical advice. Put this in the system prompt as a hard rule and refuse if pushed.
4. **Escalation is deterministic code, not a model decision.** The model decides what it observed; a plain function decides what happens next.

## Build order

Do these in order. Each one should work before you start the next.

### 1. Channel skeleton
WhatsApp adapter wired up, `channel.onMessage` logging inbound, echoing a reply. Prove send and receive both work end to end before anything else.

### 2. Capability probe
Write a throwaway script that tries to send (a) a plain text message, (b) an image, (c) an audio message, (d) interactive reply buttons, to a test number. Report clearly which of the four work. The patient experience depends on image, audio and buttons — if any fail, tell me immediately and I'll decide on a fallback. Do not silently work around it.

### 3. State model
A single `Patient` object, persisted to a JSON file (no database — this is a hackathon):

```ts
type Medication = {
  id: string
  name: string
  dose: string
  times: string[]        // e.g. ["08:00", "21:00"]
  boxPhotoPath?: string
  refillDate?: string    // when the supply runs out
}

type DoseEvent = {
  medicationId: string
  scheduledAt: string
  respondedAt?: string
  status: "taken" | "missed" | "no_response" | "double_dose_attempt"
  source: "button" | "voice_note" | "inferred"
}

type Concern = {
  at: string
  rawText: string        // what she actually said, verbatim
  type: "symptom" | "confusion" | "other"
}

type Patient = {
  name: string
  patientThreadId: string
  familyThreadId: string
  medications: Medication[]
  doseHistory: DoseEvent[]
  concerns: Concern[]
  escalationLadder: { name: string; contact: string }[]
}
```

Everything else reads and writes this. Both threads share it.

### 4. Setup from a photo
A family member sends a photo of the medicine boxes into the family group. Send it to an OpenAI vision call, get back structured JSON of medication name, dose and frequency. Post the parsed result back into the family group for confirmation before committing it to state. Never commit an unconfirmed schedule — a misread drug name is the one failure that actually matters.

### 5. Scheduler
A loop (every minute is fine) that checks which doses are due and sends to the patient thread. This is the part not covered by any tutorial and it's what makes this an agent rather than a chatbot. Budget time for it.

Each dose message to the patient:
- a short voice note (TTS) naming the medication in plain words, e.g. "the small white one"
- the photo of that box
- two reply buttons: **Taken** and **Not yet**

Nothing else. No history, no menus, no free text prompts.

### 6. Patient responses
- Button tap writes a `DoseEvent` immediately.
- Voice note reply: download the audio, transcribe with Whisper, hand the text to the agent to reconcile against state. "I took it after lunch" should resolve the open dose.
- If a reply mentions how she feels, store it as a `Concern` with her exact words. Do not interpret it.

### 7. Escalation ladder (plain code, not the model)
- No response to a dose → one follow-up after 40 minutes → then stop and post to the family group. Never send a third message. Badgering a confused person is worse than useless.
- A second "Taken" for a dose already marked taken → record `double_dose_attempt` → post to the family group immediately, highest priority.
- A `Concern` logged → post to the family group, and book a GP follow-up.

### 8. Family group cards
Use CopilotKit's interactive message UI, not walls of text. Cards for:
- adherence pattern ("missed the evening dose 3 times this week, never the morning one")
- double-dose alert
- concern reported
- refill due

Each card has buttons. When one sibling taps, the card resolves for everyone in the group — shared state, not per-user. Show who acted.

### 9. Ambiguous AI actions
Agent tools that call Ambiguous over MCP:
- `order_refill` → Mail, to the pharmacy, when a medication's supply is running low
- `assign_collection` → Tasks, assigned to a named family member
- `book_appointment` → Calendar
- `write_symptom_timeline` → Drive, a document listing dates and her verbatim words, formatted for a doctor to read
- `build_doctor_questions` → Drive, a document of things she's mentioned in passing since the last appointment

Build these last. They're the piece we can demo without if the integration fights back.

## Agent design notes

- Tools should be small and deterministic. The model chooses which to call; the tool body does the work.
- Two system prompts, one per thread. The patient-facing one is warm, short-sentenced, uses her name, never asks anything twice. The family-facing one is factual and brief.
- Keep the model out of scheduling, out of escalation timing, and out of anything medical.

## Code style

- TypeScript, small files, clear names
- `pcall`-style error handling around every outbound WhatsApp call — the API fails intermittently and a crash mid-demo is fatal
- Log every inbound and outbound message to the console with a timestamp; we'll be debugging live
- No auth, no multi-patient support, no deployment config. One patient, hardcoded, running locally.

## Start here

Do step 1 and step 2 now, and report back what the capability probe found before going further.