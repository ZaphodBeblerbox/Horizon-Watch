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

/**
 * `extra` carries whatever the caller knows about the thing — where it was,
 * a crop, a line of detail. The basket itself still only needs id+label for
 * its count, but the Editor's reference pane cannot put an item on a page
 * from a label alone, and every caller already has the record in hand at
 * this moment. Mirroring here means every existing "add to briefing" in the
 * app — Ontology, Dossiers, Analytics, Imagery, the map — feeds the writer
 * without each one being taught separately.
 */
export function addToBriefing(id, label, extra = null) {
    if (!id || items.has(id)) return false
    items.set(id, { id, label: label || id, addedAt: Date.now() })
    emit()
    // Imported lazily: briefingBasket is imported by modules that run before
    // settings exist, and a static import would pull the settings store into
    // that path.
    import("./savedForBriefing.js").then(({ saveForBriefing }) => {
        saveForBriefing({
            id, kind: extra?.kind || "signal", label: label || id,
            region: extra?.region ?? null,
            lat: extra?.lat ?? null, lon: extra?.lon ?? null,
            imageUrl: extra?.imageUrl ?? null,
            detail: extra?.detail ?? null,
        })
    }).catch(() => { /* the basket still worked */ })
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
