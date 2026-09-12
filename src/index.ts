import { listener } from "./runtime.js"
import { startScheduler } from "./scheduler.js"

async function main() {
  console.log(`[${new Date().toISOString()}] waiting for WhatsApp channel to come online...`)
  await listener.channels?.ready({ timeoutMs: 15_000 })
  console.log(`[${new Date().toISOString()}] WhatsApp channel online. Webhook: port 3000, path /webhook`)
  startScheduler()
}

main().catch((err) => {
  console.error(`[${new Date().toISOString()}] failed to start:`, err)
  process.exit(1)
})

process.on("SIGINT", async () => {
  await listener.channels?.stop()
  process.exit(0)
})
