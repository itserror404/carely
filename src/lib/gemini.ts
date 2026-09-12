import { GoogleGenAI, Type } from "@google/genai"
import { required } from "./env.js"
import { pcmToOggOpus } from "./audio.js"

const ai = new GoogleGenAI({ apiKey: required("GEMINI_API_KEY") })
const MODEL = "gemini-3.6-flash"
const TTS_MODEL = "gemini-2.5-flash-preview-tts"
const TTS_SAMPLE_RATE = 24000

export type ParsedMedication = {
  name: string
  dose: string
  frequencyText: string // frequency as printed on the label, e.g. "twice daily"
}

const MEDICATION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    medications: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          dose: { type: Type.STRING },
          frequencyText: { type: Type.STRING },
        },
        required: ["name", "dose", "frequencyText"],
      },
    },
  },
  required: ["medications"],
}

// Reads medication box/bottle labels from a photo. Pure extraction — no
// clinical judgment, no dose recommendation. If a field isn't legible on the
// label, the model returns an empty string for it rather than guessing.
export async function parseMedicationsFromImage(
  bytes: Buffer,
  mimeType: string,
): Promise<ParsedMedication[]> {
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: "user",
        parts: [
          {
            text: "This photo shows one or more medication boxes or bottles. For each one, read the label and extract exactly what is printed: the medication name, the dose (e.g. '500mg'), and the frequency (e.g. 'twice daily', 'once at night'). If a field is not legible, return an empty string for it. Do not infer or guess a dose or frequency you cannot read on the label.",
          },
          { inlineData: { mimeType, data: bytes.toString("base64") } },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: MEDICATION_SCHEMA,
    },
  })
  const parsed = JSON.parse(res.text ?? "{}") as { medications?: ParsedMedication[] }
  return parsed.medications ?? []
}

// Text-to-speech for the patient-facing dose reminder. Returns OGG/Opus bytes
// ready to send as a WhatsApp voice note.
export async function generateVoiceNote(text: string): Promise<Buffer> {
  const res = await ai.models.generateContent({
    model: TTS_MODEL,
    contents: [{ role: "user", parts: [{ text }] }],
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
      },
    },
  })
  const data = res.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data
  if (!data) throw new Error("Gemini TTS returned no audio")
  return pcmToOggOpus(Buffer.from(data, "base64"), TTS_SAMPLE_RATE)
}

// Speech understanding for the patient's voice-note replies. Returns the
// transcript only — reconciling it against state is separate, deterministic
// logic (see reconcile-voice-reply.ts).
export async function transcribeAudio(bytes: Buffer, mimeType: string): Promise<string> {
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { text: "Transcribe exactly what is said in this audio clip. Reply with only the transcript, nothing else." },
          { inlineData: { mimeType, data: bytes.toString("base64") } },
        ],
      },
    ],
  })
  return (res.text ?? "").trim()
}
