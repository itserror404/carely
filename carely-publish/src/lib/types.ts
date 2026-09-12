export type Medication = {
  id: string
  name: string
  dose: string
  times: string[] // e.g. ["08:00", "21:00"]
  boxPhotoPath?: string
  refillDate?: string // when the supply runs out
}

export type DoseEvent = {
  medicationId: string
  scheduledAt: string
  respondedAt?: string
  status: "taken" | "missed" | "no_response" | "double_dose_attempt"
  source: "button" | "voice_note" | "inferred"
}

export type Concern = {
  at: string
  rawText: string // what she actually said, verbatim
  type: "symptom" | "confusion" | "other"
}

export type Patient = {
  name: string
  patientThreadId: string
  caretakerThreadId: string
  medications: Medication[]
  doseHistory: DoseEvent[]
  concerns: Concern[]
  escalationLadder: { name: string; contact: string }[]
}
