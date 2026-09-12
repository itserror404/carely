// Step 7: escalation ladder. Plain deterministic code — the model never
// decides what happens here, only what it observed (see reconcile-reply.ts).
import { readPatient, updatePatient } from "./lib/patient-store.js"
import { sendAudioFile, sendButtons, sendText } from "./lib/whatsapp-send.js"
import { generateVoiceNote } from "./lib/gemini.js"
import { composeToPatient, composeToCaretaker } from "./lib/compose-message.js"
import type { Patient, DoseEvent } from "./lib/types.js"

const FOLLOW_UP_AFTER_MS = 40 * 60_000
const REFILL_WARN_DAYS = 7

// `situation` is the plain facts of what happened — the model composes the
// actual sentence from it, per the caretaker system prompt.
async function postCaretakerAlert(patient: Patient, situation: string): Promise<void> {
  if (!patient.caretakerThreadId) return
  const text = await composeToCaretaker(patient.name, situation)
  await sendText(patient.caretakerThreadId, text)
}

// One follow-up at +40 minutes, then stop — never a third message. The
// status flip from "no_response" to "missed" is what guarantees this check
// only ever fires once per dose (subsequent ticks see it's no longer
// "no_response" and skip it).
export async function checkOverdueDoses(): Promise<void> {
  const patient = await readPatient()
  const now = Date.now()

  for (const event of patient.doseHistory) {
    if (event.status !== "no_response") continue
    if (now - new Date(event.scheduledAt).getTime() < FOLLOW_UP_AFTER_MS) continue

    const med = patient.medications.find((m) => m.id === event.medicationId)
    if (!med) continue

    await updatePatient((p) => ({
      ...p,
      doseHistory: p.doseHistory.map((e) =>
        e.medicationId === event.medicationId && e.scheduledAt === event.scheduledAt
          ? { ...e, status: "missed" as const }
          : e,
      ),
    }))

    if (patient.patientThreadId) {
      try {
        const text = await composeToPatient(
          patient.name,
          `Check in on her gently — she hasn't confirmed taking her ${med.name} (${med.dose}) yet. Ask if she's had a chance to take it.`,
        )
        const voice = await generateVoiceNote(text)
        await sendAudioFile(patient.patientThreadId, voice, "audio/ogg")
      } catch (err) {
        console.error(`[escalation] follow-up voice note failed for ${med.name}:`, err)
      }
      const value = { medicationId: med.id, scheduledAt: event.scheduledAt }
      await sendButtons(patient.patientThreadId, `${med.name} — ${med.dose}`, [
        { id: `dose_taken::${JSON.stringify(value)}`, title: "Taken" },
        { id: `dose_not_yet::${JSON.stringify(value)}`, title: "Not yet" },
      ])
    }

    await postCaretakerAlert(
      patient,
      `${patient.name} hasn't confirmed the ${new Date(event.scheduledAt).toLocaleTimeString()} ${med.name} (${med.dose}) yet. One gentle reminder has been sent to her; no further automatic reminders will go out for this dose. Let the caretaker know they may want to check in themselves.`,
    )
    console.log(`[${new Date().toISOString()}] escalated overdue dose: ${med.name} (${event.scheduledAt})`)
  }
}

// In-memory de-dup only (not part of the Patient schema) — resets on
// restart, which just means a refill warning can repeat once after a
// restart. Fine for a hackathon; a durable store would key this properly.
const refillAlertsSentToday = new Set<string>()

export async function checkRefillsDue(): Promise<void> {
  const patient = await readPatient()
  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)

  for (const med of patient.medications) {
    if (!med.refillDate) continue
    const daysUntil = Math.ceil(
      (new Date(med.refillDate).getTime() - today.getTime()) / 86_400_000,
    )
    if (daysUntil < 0 || daysUntil > REFILL_WARN_DAYS) continue
    const key = `${med.id}:${todayStr}`
    if (refillAlertsSentToday.has(key)) continue
    refillAlertsSentToday.add(key)

    await postCaretakerAlert(
      patient,
      `${med.name} (${med.dose}) is running low — it's due to run out on ${med.refillDate}, which is ${daysUntil} day(s) from now.`,
    )
  }
}

// Step 6 + 7: a button tap or reconciled voice reply resolving a dose as
// taken. Handles the double-dose case (second "Taken" for an already-taken
// dose) with its own escalation, highest priority, immediate.
export async function recordDoseTaken(args: {
  medicationId: string
  scheduledAt: string
  source: DoseEvent["source"]
}): Promise<{ ok: boolean; doubleDose: boolean }> {
  let doubleDose = false
  let found = false

  const patient = await updatePatient((p) => {
    const idx = p.doseHistory.findIndex(
      (e) => e.medicationId === args.medicationId && e.scheduledAt === args.scheduledAt,
    )
    if (idx === -1) return p
    found = true
    const existing = p.doseHistory[idx]
    const respondedAt = new Date().toISOString()

    if (existing.status === "taken") {
      doubleDose = true
      return {
        ...p,
        doseHistory: [
          ...p.doseHistory,
          {
            medicationId: args.medicationId,
            scheduledAt: args.scheduledAt,
            respondedAt,
            status: "double_dose_attempt" as const,
            source: args.source,
          },
        ],
      }
    }

    const nextHistory = [...p.doseHistory]
    nextHistory[idx] = { ...existing, status: "taken", respondedAt, source: args.source }
    return { ...p, doseHistory: nextHistory }
  })

  if (!found) return { ok: false, doubleDose: false }

  if (doubleDose) {
    const med = patient.medications.find((m) => m.id === args.medicationId)
    await postCaretakerAlert(
      patient,
      `${patient.name} just tapped "Taken" again for ${med?.name ?? "a medication"}, which was already marked taken earlier — this could mean a double dose. This is high priority; suggest checking in with her as soon as possible.`,
    )
    console.log(`[${new Date().toISOString()}] double-dose attempt: ${args.medicationId} (${args.scheduledAt})`)
  }

  return { ok: true, doubleDose }
}

// Step 6 + 7: a concern reported in the patient's own words. Stored verbatim,
// never interpreted, and always escalated — a concern is never silent.
export async function recordConcern(rawText: string, type: "symptom" | "confusion" | "other"): Promise<void> {
  const patient = await updatePatient((p) => ({
    ...p,
    concerns: [...p.concerns, { at: new Date().toISOString(), rawText, type }],
  }))

  await postCaretakerAlert(
    patient,
    `${patient.name} said, in her own words: "${rawText}". This has been logged verbatim, not interpreted. Mention that a GP follow-up would normally be booked automatically here, but that part isn't wired up yet.`,
  )
  console.log(`[${new Date().toISOString()}] concern recorded: ${type} — "${rawText}"`)
}
