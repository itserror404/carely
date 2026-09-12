// Step 5: the once-a-minute loop that makes this an agent rather than a
// chatbot. Checks which doses are due and sends the reminder; also drives
// the escalation ladder's time-based checks (step 7).
import { readPatient, updatePatient } from "./lib/patient-store.js"
import { sendDoseReminder } from "./dose-reminder.js"
import { checkOverdueDoses, checkRefillsDue } from "./escalation.js"

const CHECK_INTERVAL_MS = 60_000

function nowHHMM(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

function todayScheduledAt(time: string): string {
  const d = new Date()
  const [h, m] = time.split(":").map(Number)
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}

export function startScheduler(): void {
  setInterval(() => {
    tick().catch((err) => console.error("[scheduler] tick failed:", err))
  }, CHECK_INTERVAL_MS)
  console.log(`[${new Date().toISOString()}] scheduler started (checking every 60s)`)
}

async function tick(): Promise<void> {
  await sendDueDoses()
  await checkOverdueDoses()
  await checkRefillsDue()
}

async function sendDueDoses(): Promise<void> {
  const patient = await readPatient()
  if (!patient.patientThreadId) return // nowhere to send yet

  const currentTime = nowHHMM()
  for (const med of patient.medications) {
    if (!med.times.includes(currentTime)) continue
    const scheduledAt = todayScheduledAt(currentTime)
    const alreadySent = patient.doseHistory.some(
      (e) => e.medicationId === med.id && e.scheduledAt === scheduledAt,
    )
    if (alreadySent) continue

    // Record first, so a slow send or a duplicate tick within the same
    // minute can never fire the reminder twice.
    const updated = await updatePatient((p) => {
      if (p.doseHistory.some((e) => e.medicationId === med.id && e.scheduledAt === scheduledAt)) {
        return p
      }
      return {
        ...p,
        doseHistory: [
          ...p.doseHistory,
          { medicationId: med.id, scheduledAt, status: "no_response", source: "inferred" },
        ],
      }
    })
    await sendDoseReminder(updated, med, scheduledAt)
  }
}
