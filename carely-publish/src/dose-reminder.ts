// Step 5: what actually gets sent to the patient thread for one due dose.
// Deliberately minimal — voice note, box photo, two buttons. No history, no
// menus, no free text prompts.
import { readFile } from "node:fs/promises"
import { generateVoiceNote } from "./lib/gemini.js"
import { composeToPatient } from "./lib/compose-message.js"
import { sendAudioFile, sendImageFile, sendButtons } from "./lib/whatsapp-send.js"
import type { Medication, Patient } from "./lib/types.js"

// Medication.boxPhotoPath is stored relative to the project root.
const PROJECT_ROOT = new URL("../", import.meta.url)

export async function sendDoseReminder(
  patient: Patient,
  med: Medication,
  scheduledAt: string,
): Promise<void> {
  const to = patient.patientThreadId
  if (!to) return

  try {
    const text = await composeToPatient(
      patient.name,
      `Tell her it's time to take her ${med.name} (${med.dose}).`,
    )
    const voice = await generateVoiceNote(text)
    await sendAudioFile(to, voice, "audio/ogg")
  } catch (err) {
    console.error(`[reminder] voice note failed for ${med.name}:`, err)
  }

  if (med.boxPhotoPath) {
    try {
      const photo = await readFile(new URL(med.boxPhotoPath, PROJECT_ROOT))
      await sendImageFile(to, photo, "image/jpeg")
    } catch (err) {
      console.error(`[reminder] photo send failed for ${med.name}:`, err)
    }
  }

  const value = { medicationId: med.id, scheduledAt }
  await sendButtons(to, `${med.name} — ${med.dose}`, [
    { id: `dose_taken::${JSON.stringify(value)}`, title: "Taken" },
    { id: `dose_not_yet::${JSON.stringify(value)}`, title: "Not yet" },
  ])

  console.log(`[${new Date().toISOString()}] sent dose reminder: ${med.name} (${scheduledAt})`)
}
