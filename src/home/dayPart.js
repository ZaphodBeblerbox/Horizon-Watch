/**
 * dayPart.js — Home turns three times a day (the owner, 2026-10-07), on the
 * desktop and on the phone alike: at 05:00, 12:00 and 18:00 local time.
 */
import { useRef } from "react"

/** The part of the day and how the brief speaks of it (turns at 05, 12, 18). */
export function slotOf(now) {
    const h = now.getHours()
    const d = new Date(now)
    const at = (hh) => { const x = new Date(d); x.setHours(hh, 0, 0, 0); return x.getTime() }
    if (h >= 5 && h < 12) return { key: `${d.toDateString()}:m`, part: "morning", since: at(5) - 11 * 3600_000,
        happened: "What happened overnight", ahead: "What today may bring", record: "How yesterday's forecast did" }
    if (h >= 12 && h < 18) return { key: `${d.toDateString()}:a`, part: "afternoon", since: at(5),
        happened: "What happened this morning", ahead: "What this afternoon may bring", record: "How this morning's forecast did" }
    const base = h < 5 ? new Date(d.getTime() - 86400_000) : d
    return { key: `${base.toDateString()}:n`, part: "night", since: at(12) - (h < 5 ? 86400_000 : 0),
        happened: "What happened this afternoon", ahead: "What may follow tonight", record: "How this afternoon's forecast did" }
}

/** A value chosen once per key (a part of the day) and kept until the key
 * turns — refreshed three times a day rather than on every poll. It waits
 * for a value that is ready (`ready`) before it settles. */
export function useFrozen(key, value, ready) {
    const ref = useRef({ key: null, value: [] })
    if (ref.current.key !== key || !ready(ref.current.value)) {
        if (ready(value)) ref.current = { key, value }
        else if (ref.current.key !== key) ref.current = { key: null, value }
    }
    return ref.current.key === key ? ref.current.value : value
}

