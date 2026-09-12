import { config } from "dotenv"

config({ quiet: true })

export function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

export function optional(name: string): string | undefined {
  return process.env[name] || undefined
}
