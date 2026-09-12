// Gemini TTS returns raw PCM; WhatsApp needs a real container format. ffmpeg
// (already a project dependency for the capability probe's test voice note)
// does the conversion in-process, no temp files.
import { spawn } from "node:child_process"

export function pcmToOggOpus(pcm: Buffer, sampleRate: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", [
      "-f",
      "s16le",
      "-ar",
      String(sampleRate),
      "-ac",
      "1",
      "-i",
      "pipe:0",
      "-c:a",
      "libopus",
      "-b:a",
      "32k",
      "-f",
      "ogg",
      "pipe:1",
    ])
    const chunks: Buffer[] = []
    ff.stdout.on("data", (c) => chunks.push(c))
    ff.on("error", reject)
    ff.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks))
      else reject(new Error(`ffmpeg exited with code ${code}`))
    })
    ff.stdin.write(pcm)
    ff.stdin.end()
  })
}
