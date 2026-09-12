// Shared raw-client sender for proactive messages (scheduler ticks, timeouts,
// caretaker alerts) — anything sent outside the context of an inbound event,
// where there is no `thread` to post through.
import { WhatsAppClient, type WhatsAppOutbound } from "@copilotkit/channels/whatsapp"
import { required } from "./env.js"

export const waClient = new WhatsAppClient({
  accessToken: required("WHATSAPP_ACCESS_TOKEN"),
  phoneNumberId: required("WHATSAPP_PHONE_NUMBER_ID"),
})

export async function sendText(to: string, body: string) {
  return waClient.sendMessage(to, { type: "text", text: { body, preview_url: false } })
}

export async function sendImageFile(to: string, bytes: Buffer, mimeType: string, caption?: string) {
  const mediaId = await waClient.uploadMedia(bytes, mimeType, "photo")
  return waClient.sendMessage(to, { type: "image", image: { id: mediaId, caption } })
}

// No "audio" case in the library's typed union (see capability-probe.ts) —
// the Cloud API supports it, the cast bypasses the TS type only.
export async function sendAudioFile(to: string, bytes: Buffer, mimeType: string) {
  const mediaId = await waClient.uploadMedia(bytes, mimeType, "voice-note")
  const payload = { type: "audio", audio: { id: mediaId } } as unknown as WhatsAppOutbound
  return waClient.sendMessage(to, payload)
}

export async function sendButtons(
  to: string,
  body: string,
  buttons: { id: string; title: string }[],
) {
  return waClient.sendMessage(to, {
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      action: { buttons: buttons.map((b) => ({ type: "reply", reply: b })) },
    },
  })
}
