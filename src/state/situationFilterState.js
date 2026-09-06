// situationFilterState.js — the real, live Situation filter state (V3
// Phase 1, §5.1: time window, severity floor, domain/context/track layer
// toggles, projection). Situation.jsx publishes here on every real change
// (matching cameraState.js's pattern); a session-save action reads it
// directly, no event round-trip needed. Restoring a session dispatches
// akili:apply-session-filters, which Situation.jsx listens for and applies
// to its own state setters — the real values live in Situation.jsx's
// useState (unchanged), this module is only the live mirror external code
// reads from and the restore channel.

let current = null
const listeners = new Set()

export function publishFilterState(state) {
    current = state
    listeners.forEach((fn) => fn(current))
}

export function getFilterState() {
    return current
}

export function subscribeFilterState(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
}

export function restoreFilterState(state) {
    if (!state) return
    window.dispatchEvent(new CustomEvent("akili:apply-session-filters", { detail: state }))
}
