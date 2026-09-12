import { CopilotRuntime, CopilotKitIntelligence } from "@copilotkit/runtime/v2"
import { createCopilotNodeListener } from "@copilotkit/runtime/v2/node"
import { channel } from "./channel.js"
import { required, optional } from "./lib/env.js"

const intelligence = new CopilotKitIntelligence({
  apiKey: required("COPILOTKIT_API_KEY"),
  // Falls back to CopilotKit's managed platform when unset.
  apiUrl: optional("COPILOTKIT_INTELLIGENCE_URL"),
})

const runtime = new CopilotRuntime({
  agents: {}, // no AG-UI agent — messages are composed directly via compose-message.ts
  intelligence,
  channels: [channel],
})

// Creating the listener starts channel activation (the WhatsApp adapter opens
// its own webhook server on port 3000 at /webhook — nothing else to mount).
export const listener = createCopilotNodeListener({ runtime })
