// Deterministic mapping from a label's printed frequency text to default
// reminder times. This is scheduling convenience, not clinical judgment — it
// never decides a dose, only when to send a reminder. The caretaker confirms
// (and can have these adjusted) before anything is committed.
const DEFAULT_SLOTS: Record<number, string[]> = {
  1: ["08:00"],
  2: ["08:00", "20:00"],
  3: ["08:00", "14:00", "20:00"],
  4: ["08:00", "12:00", "16:00", "20:00"],
}

export function deriveDefaultTimes(frequencyText: string): string[] {
  const text = frequencyText.toLowerCase()
  const numberWords: Record<string, number> = { once: 1, twice: 2, thrice: 3 }
  for (const [word, count] of Object.entries(numberWords)) {
    if (text.includes(word)) return DEFAULT_SLOTS[count] ?? DEFAULT_SLOTS[1]
  }
  const match = text.match(/(\d+)\s*(?:x|times)/)
  if (match) {
    const count = Math.min(Number(match[1]), 4)
    return DEFAULT_SLOTS[count] ?? DEFAULT_SLOTS[1]
  }
  return DEFAULT_SLOTS[1]
}
