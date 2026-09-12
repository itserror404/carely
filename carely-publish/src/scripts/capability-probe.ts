// Throwaway script (step 2 of the build brief). Sends a plain text message, an
// image, an audio message, and an interactive reply-button message to a test
// number, using the raw WhatsAppClient directly (not the full channel/agent
// pipeline). Reports clearly which of the four actually worked.
//
// Run with: npm run probe

import { readFile } from "node:fs/promises"
import { WhatsAppClient, type WhatsAppOutbound } from "@copilotkit/channels/whatsapp"
import { required } from "../lib/env.js"

const client = new WhatsAppClient({
  accessToken: required("WHATSAPP_ACCESS_TOKEN"),
  phoneNumberId: required("WHATSAPP_PHONE_NUMBER_ID"),
})

const to = required("PROBE_TEST_NUMBER")

type ProbeResult = { name: string; ok: boolean; detail: string }
const results: ProbeResult[] = []

async function probe(name: string, fn: () => Promise<string>) {
  try {
    const detail = await fn()
    results.push({ name, ok: true, detail })
    console.log(`[probe] ${name}: OK — ${detail}`)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    results.push({ name, ok: false, detail })
    console.log(`[probe] ${name}: FAILED — ${detail}`)
  }
}

await probe("text", async () => {
  const ref = await client.sendMessage(to, {
    type: "text",
    text: { body: "capability probe: plain text", preview_url: false },
  })
  return `sent, id=${ref.id}`
})

await probe("image", async () => {
  const bytes = await readFile(new URL("../../media/probe-image.png", import.meta.url))
  const mediaId = await client.uploadMedia(bytes, "image/png", "probe-image.png")
  const ref = await client.sendMessage(to, {
    type: "image",
    image: { id: mediaId, caption: "capability probe: image" },
  })
  return `sent, mediaId=${mediaId}, id=${ref.id}`
})

await probe("audio", async () => {
  const bytes = await readFile(new URL("../../media/probe-voice-note.ogg", import.meta.url))
  const mediaId = await client.uploadMedia(bytes, "audio/ogg", "probe-voice-note.ogg")
  // No "audio" case in the library's typed WhatsAppOutbound union — the Cloud
  // API supports it, the wrapper's TS type just doesn't model it. sendMessage
  // only spreads the payload into the request body, so this is safe at runtime.
  const payload = { type: "audio", audio: { id: mediaId } } as unknown as WhatsAppOutbound
  const ref = await client.sendMessage(to, payload)
  return `sent (unmodeled type, cast used), mediaId=${mediaId}, id=${ref.id}`
})

await probe("interactive buttons", async () => {
  const ref = await client.sendMessage(to, {
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "capability probe: reply buttons" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "probe_yes", title: "Taken" } },
          { type: "reply", reply: { id: "probe_no", title: "Not yet" } },
        ],
      },
    },
  })
  return `sent, id=${ref.id}`
})

console.log("\n=== capability probe summary ===")
for (const r of results) {
  console.log(`${r.ok ? "✅" : "❌"} ${r.name}: ${r.detail}`)
}
const anyFailed = results.some((r) => !r.ok)
if (anyFailed) {
  console.log("\nAt least one capability failed. Do not silently work around it — report back before continuing.")
  process.exit(1)
}
