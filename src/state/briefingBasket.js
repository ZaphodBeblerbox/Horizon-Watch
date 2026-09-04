import { useState, useEffect } from "react"

// briefingBasket.js — the real "evidence selected for the next report"
// mechanism referenced throughout the redesign (status bar count, Situation
// inspector's "add to briefing" action, and later rounds' Inbox/Dossiers/
// Analytics/Generate). Confirmed via investigation: nothing resembling this
// existed anywhere in the codebase before this — no prior "briefing basket"
// or "evidence" selection concept to reuse, so this is genuinely new,
// deliberately minimal plain pub/sub (matching toast.js's shape) rather than
// a React context, so any module can add to it without a provider tree.
//
// Holds real signal/entity ids only — never a count fabricated separately
// from what's actually in the Set. Round 4's Generate module is where this
// basket's contents actually get used to assemble a report; this round only
// needs a real, working add/remove/count so the status bar and Situation's
// inspector have something real to show and act on.

const items = new Map() // id -> { id, label, addedAt }
const listeners = new Set()

function emit() {
    const snapshot = Array.from(items.values())
    listeners.forEach((fn) => fn(snapshot))
}

export function addToBriefing(id, label) {
    if (!id || items.has(id)) return false
    items.set(id, { id, label: label || id, addedAt: Date.now() })
    emit()
    return true
}

export function removeFromBriefing(id) {
    if (!items.has(id)) return false
    items.delete(id)
    emit()
    return true
}

export function clearBriefing() {
    if (items.size === 0) return
    items.clear()
    emit()
}

export function getBriefingItems() {
    return Array.from(items.values())
}

export function subscribeBriefing(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
}

/** React hook — real live count, for the status bar and anywhere else that
 * needs to reflect the basket's actual current size. */
export function useBriefingCount() {
    const [count, setCount] = useState(items.size)
    useEffect(() => subscribeBriefing((snapshot) => setCount(snapshot.length)), [])
    return count
}
