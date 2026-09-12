// The single source of truth for the one hardcoded patient. Both the patient
// thread and the family thread read and write through this module — no
// database, just a JSON file on disk (per the brief: this is a hackathon).
import { readFile, writeFile, mkdir } from "node:fs/promises"
import type { Patient } from "./types.js"
import { optional } from "./env.js"

const DATA_DIR = new URL("../../data/", import.meta.url)
const DATA_FILE = new URL("patient.json", DATA_DIR)

// Seed values, only used the first time data/patient.json is created.
// patientThreadId/caretakerThreadId are the WhatsApp wa_ids for the patient's
// 1:1 chat and the caretaker's 1:1 chat, taken from env if set. Edit the JSON
// file directly to change them afterwards.
const DEFAULT_PATIENT: Patient = {
  name: "Sandy",
  patientThreadId: optional("PATIENT_THREAD_ID") ?? "",
  caretakerThreadId: optional("CARETAKER_THREAD_ID") ?? "",
  medications: [],
  doseHistory: [],
  concerns: [],
  escalationLadder: [],
}

export async function readPatient(): Promise<Patient> {
  try {
    const raw = await readFile(DATA_FILE, "utf-8")
    return JSON.parse(raw) as Patient
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      await writePatient(DEFAULT_PATIENT)
      return DEFAULT_PATIENT
    }
    throw err
  }
}

export async function writePatient(patient: Patient): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
  await writeFile(DATA_FILE, JSON.stringify(patient, null, 2), "utf-8")
}

// Serializes read-modify-write cycles so the patient thread and family thread
// (which can fire concurrently) never clobber each other's writes.
let writeQueue: Promise<unknown> = Promise.resolve()

export function updatePatient(
  fn: (patient: Patient) => Patient | Promise<Patient>,
): Promise<Patient> {
  const task = writeQueue.then(async () => {
    const patient = await readPatient()
    const next = await fn(patient)
    await writePatient(next)
    return next
  })
  writeQueue = task.then(
    () => undefined,
    () => undefined,
  )
  return task
}
