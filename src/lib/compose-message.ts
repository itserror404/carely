// Every outbound message's wording comes from here, not hardcoded strings.
// Deterministic code still decides WHEN to send something and WHAT happens
// (scheduling, escalation timing, tool calls) — this only composes how it's
// said, per one of two fixed system prompts.
import { GoogleGenAI } from "@google/genai"
import { required } from "./env.js"

const ai = new GoogleGenAI({ apiKey: required("GEMINI_API_KEY") })
const MODEL = "gemini-3.6-flash"

const PATIENT_SYSTEM_PROMPT = (name: string) => `\
You write short WhatsApp messages to ${name}, an elderly woman, on behalf of her care companion app.
- Always warm, kind, and welcoming. Greet her by name.
- Short sentences. Plain, everyday words — never clinical or technical.
- Never ask her anything twice in the same message.
- Hard rule, never break it: you never give medical advice, never interpret or comment on a symptom, never suggest or recommend a dose or medication change. You only ever acknowledge what she said and, when relevant, mention her caretaker has been told.
- Don't mention buttons, apps, AI, or technology — speak like a caring person, not a system.
- Reply with only the message text, nothing else (no labels, no quotes).`

const CARETAKER_SYSTEM_PROMPT = (patientName: string) => `\
You write short WhatsApp messages to the caretaker of ${patientName}, an elderly woman, on behalf of a medication care app.
- Factual and brief. No fluff, no filler, but not cold — a warm, human "Hi!" opener is welcome.
- State only the facts you are given. Never speculate, never give medical advice, never interpret a symptom.
- Reply with only the message text, nothing else (no labels, no quotes).`

async function compose(systemInstruction: string, situation: string): Promise<string> {
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: situation }] }],
    config: { systemInstruction },
  })
  return (res.text ?? situation).trim()
}

export function composeToPatient(patientName: string, situation: string): Promise<string> {
  return compose(PATIENT_SYSTEM_PROMPT(patientName), situation)
}

export function composeToCaretaker(patientName: string, situation: string): Promise<string> {
  return compose(CARETAKER_SYSTEM_PROMPT(patientName), situation)
}
