import { createChannel } from "@copilotkit/channels"
import { whatsapp, InMemoryHistoryStore, conversationKeyOf } from "@copilotkit/channels/whatsapp"
import { required } from "./lib/env.js"
import { readPatient } from "./lib/patient-store.js"
import { handleSetupPhoto } from "./setup-flow.js"
import { transcribeAudio } from "./lib/gemini.js"
import { composeToPatient, composeToCaretaker } from "./lib/compose-message.js"
import { reconcileVoiceReply } from "./reconcile-reply.js"
import { recordDoseTaken } from "./escalation.js"

// Kept so we can read back the raw multimodal content of the last inbound
// turn — the adapter feeds images/audio to the agent's history but does not
// surface them on the plain ChannelMessage passed to onMessage.
const historyStore = new InMemoryHistoryStore()

export const channel = createChannel({
  identifyUser: "platform",
  name: "medication-care-agent",
  adapters: [
    whatsapp({
      accessToken: required("WHATSAPP_ACCESS_TOKEN"),
      phoneNumberId: required("WHATSAPP_PHONE_NUMBER_ID"),
      appSecret: required("WHATSAPP_APP_SECRET"),
      verifyToken: required("WHATSAPP_VERIFY_TOKEN"),
      port: 3000,
      historyStore,
    }),
  ],
})

channel.onMessage(async ({ thread, message }) => {
  console.log(`[${new Date().toISOString()}] inbound (${message.platform}): ${message.text}`)

  const patient = await readPatient()
  const senderId = message.actor.id
  const isCaretaker = senderId === patient.caretakerThreadId || !patient.caretakerThreadId
  const isPatient = senderId === patient.patientThreadId

  const history = await historyStore.read(conversationKeyOf(senderId))
  const last = history[history.length - 1]
  const parts = Array.isArray(last?.content) ? last.content : []

  if (isCaretaker) {
    const imagePart = parts.find((p) => p.type === "image")
    if (imagePart?.type === "image") {
      await handleSetupPhoto(thread, imagePart.source.value, imagePart.source.mimeType)
      return
    }
  }

  if (isPatient) {
    const audioPart = parts.find((p) => p.type === "audio")
    if (audioPart?.type === "audio") {
      const bytes = Buffer.from(audioPart.source.value, "base64")
      let transcript = ""
      try {
        transcript = await transcribeAudio(bytes, audioPart.source.mimeType)
      } catch (err) {
        console.error("[patient] transcription failed:", err)
      }
      console.log(`[${new Date().toISOString()}] patient voice note transcript: "${transcript}"`)
      await reconcileVoiceReply(patient, transcript)
      await thread.post(await composeToPatient(patient.name, "Thank her for the voice note, and gently ask how she's feeling today."))
      return
    }

    // She's meant to only need buttons and voice notes, but nothing stops her
    // from typing — reconcile plain text the same way so a concern like
    // "head is dizzy" never just gets echoed back.
    if (message.text.trim()) {
      await reconcileVoiceReply(patient, message.text)
      await thread.post(await composeToPatient(patient.name, "Thank her for her message, and gently ask how she's feeling today."))
      return
    }
  }

  // Placeholder until there's a real reason for the caretaker to send free
  // text outside the setup flow above.
  await thread.post(await composeToCaretaker(patient.name, `Acknowledge receipt of their message: "${message.text}"`))
  console.log(`[${new Date().toISOString()}] outbound: echo: ${message.text}`)
})

channel.onInteraction<{ medicationId: string; scheduledAt: string }>("dose_taken", async (ctx) => {
  const value = ctx.action.value
  if (!value) return
  const patient = await readPatient()
  const result = await recordDoseTaken({ ...value, source: "button" })
  console.log(`[${new Date().toISOString()}] dose_taken tap:`, value, "->", result)
  if (!result.ok) return
  await ctx.thread.post(
    await composeToPatient(
      patient.name,
      result.doubleDose
        ? "Thank her for letting you know, and reassure her you've told her caretaker too, just to be safe."
        : "Cheerfully confirm the dose is marked as taken, and gently ask how she's feeling today.",
    ),
  )
})

channel.onInteraction<{ medicationId: string; scheduledAt: string }>("dose_not_yet", async (ctx) => {
  console.log(`[${new Date().toISOString()}] dose_not_yet tap:`, ctx.action.value)
  const patient = await readPatient()
  await ctx.thread.post(
    await composeToPatient(patient.name, "Reassure her that's completely fine, no rush, and you'll check back in a little while."),
  )
})
