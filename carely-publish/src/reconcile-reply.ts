// Step 6: a voice-note reply from the patient. The model only observes what
// she said — whether it resolves a pending dose, and whether she mentioned
// anything about how she feels. It never decides what happens next; that's
// escalation.ts.
import { GoogleGenAI, Type } from "@google/genai"
import { required } from "./lib/env.js"
import { recordDoseTaken, recordConcern } from "./escalation.js"
import type { Patient } from "./lib/types.js"

const ai = new GoogleGenAI({ apiKey: required("GEMINI_API_KEY") })
const MODEL = "gemini-3.6-flash"

const RECONCILE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    resolvesDose: { type: Type.BOOLEAN },
    matchedMedicationName: { type: Type.STRING },
    concernPresent: { type: Type.BOOLEAN },
    concernType: { type: Type.STRING, enum: ["symptom", "confusion", "other"] },
  },
  required: ["resolvesDose", "matchedMedicationName", "concernPresent", "concernType"],
}

async function classifyReply(
  transcript: string,
  pendingMedicationNames: string[],
): Promise<{
  resolvesDose: boolean
  matchedMedicationName: string
  concernPresent: boolean
  concernType: "symptom" | "confusion" | "other"
}> {
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: [
              "You only observe what was said. You never give medical advice, never interpret a symptom, and never suggest anything about a dose.",
              `Medications currently awaiting confirmation: ${pendingMedicationNames.length ? pendingMedicationNames.join(", ") : "(none)"}.`,
              `What she said: "${transcript}"`,
              "Decide: (1) is she saying she already took one of the medications listed above? If so, name it exactly as listed in matchedMedicationName, else leave it empty. (2) Does she mention anything about how she physically feels, or seem confused? If so set concernPresent true and classify concernType as 'symptom', 'confusion', or 'other' — do not diagnose or interpret, just classify.",
            ].join("\n"),
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: RECONCILE_SCHEMA,
    },
  })
  return JSON.parse(res.text ?? "{}")
}

export async function reconcileVoiceReply(patient: Patient, transcript: string): Promise<void> {
  if (!transcript.trim()) return

  const pendingEvents = patient.doseHistory.filter(
    (e) => e.status === "no_response" || e.status === "missed",
  )
  const pendingMeds = pendingEvents
    .map((e) => ({ event: e, med: patient.medications.find((m) => m.id === e.medicationId) }))
    .filter((x) => x.med)

  const result = await classifyReply(
    transcript,
    pendingMeds.map((x) => x.med!.name),
  )

  if (result.resolvesDose && result.matchedMedicationName) {
    const match = pendingMeds.find(
      (x) => x.med!.name.toLowerCase() === result.matchedMedicationName.toLowerCase(),
    )
    if (match) {
      await recordDoseTaken({
        medicationId: match.med!.id,
        scheduledAt: match.event.scheduledAt,
        source: "voice_note",
      })
    }
  }

  if (result.concernPresent) {
    await recordConcern(transcript, result.concernType)
  }
}
