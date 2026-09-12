// Step 4: a caretaker sends a photo of the medicine boxes. Vision reads the
// labels; nothing is committed to the shared Patient state until the
// caretaker confirms the parsed result. A misread drug name is the one
// failure that actually matters, so there is no silent auto-commit path.
import { randomUUID } from "node:crypto"
import { writeFile, mkdir } from "node:fs/promises"
import type { StatefulThread } from "@copilotkit/channels"
import { Message, Header, Fields, Field, Section, Actions, Button } from "@copilotkit/channels/ui"
import { parseMedicationsFromImage } from "./lib/gemini.js"
import { composeToCaretaker } from "./lib/compose-message.js"
import { deriveDefaultTimes } from "./lib/schedule-defaults.js"
import { readPatient, updatePatient } from "./lib/patient-store.js"
import type { Medication } from "./lib/types.js"

const MEDIA_DIR = new URL("../media/medications/", import.meta.url)

export async function handleSetupPhoto(
  thread: StatefulThread<unknown>,
  imageBase64: string,
  mimeType: string,
): Promise<void> {
  const bytes = Buffer.from(imageBase64, "base64")
  const patientName = (await readPatient()).name

  let parsed
  try {
    parsed = await parseMedicationsFromImage(bytes, mimeType)
  } catch (err) {
    console.error("[setup] vision parse failed:", err)
    await thread.post(
      await composeToCaretaker(patientName, "Apologize that the photo couldn't be read, and ask for a clearer picture of the medicine boxes."),
    )
    return
  }

  if (parsed.length === 0) {
    await thread.post(
      await composeToCaretaker(
        patientName,
        "No medication labels could be made out in that photo. Ask them to try again with better lighting, one box at a time.",
      ),
    )
    return
  }

  await mkdir(MEDIA_DIR, { recursive: true })
  const photoId = randomUUID()
  const ext = mimeType.split("/")[1] ?? "jpg"
  const photoPath = new URL(`${photoId}.${ext}`, MEDIA_DIR)
  await writeFile(photoPath, bytes)
  // Stored relative to the project root, not absolute — an absolute path
  // would break as soon as the project runs from anywhere else.
  const relativePhotoPath = `media/medications/${photoId}.${ext}`

  const candidates: Medication[] = parsed.map((m) => ({
    id: randomUUID(),
    name: m.name || "(unreadable)",
    dose: m.dose || "(unreadable)",
    times: deriveDefaultTimes(m.frequencyText),
    boxPhotoPath: relativePhotoPath,
  }))

  const greeting = await composeToCaretaker(
    patientName,
    "Thank them warmly for sending the photo, and let them know here's what was read from it, ready for their confirmation.",
  )

  await thread.post(
    Message({
      children: [
        Section({ children: greeting }),
        Header({ children: "New medication — please confirm" }),
        ...candidates.map((c) =>
          Fields({
            children: [
              Field({ label: "Medication", children: c.name }),
              Field({ label: "Dose", children: c.dose }),
              Field({ label: "Reminder times", children: c.times.join(", ") }),
            ],
          }),
        ),
        Section({
          children:
            "Times are a default guess based on the frequency printed on the label — tell me if they need to change.",
        }),
        Actions({
          children: [
            Button({
              children: "Confirm",
              style: "primary",
              onClick: async (ctx) => {
                await updatePatient((p) => ({
                  ...p,
                  caretakerThreadId: p.caretakerThreadId || ctx.actor.id,
                  medications: [...p.medications, ...candidates],
                }))
                console.log(
                  `[${new Date().toISOString()}] setup confirmed:`,
                  candidates.map((c) => c.name),
                )
                await ctx.thread.post(
                  await composeToCaretaker(
                    patientName,
                    `Confirm ${candidates.map((c) => c.name).join(", ")} have been added and reminders will start at the times shown.`,
                  ),
                )
              },
            }),
            Button({
              children: "Retake photo",
              onClick: async (ctx) => {
                console.log(`[${new Date().toISOString()}] setup rejected:`, candidates.map((c) => c.name))
                await ctx.thread.post(
                  await composeToCaretaker(patientName, "Let them know that's no problem, and to send another photo whenever ready."),
                )
              },
            }),
          ],
        }),
      ],
    }),
  )
}
