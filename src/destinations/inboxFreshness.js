/**
 * How long ago the queue last landed, said briefly.
 *
 * Deliberately coarse. A working record does not need "37 seconds"; it
 * needs the reader to know at a glance whether they are looking at now
 * or at something that stopped updating.
 */
export function freshnessLabel(lastLoadMs, nowMs = Date.now()) {
    if (!Number.isFinite(lastLoadMs) || lastLoadMs <= 0) return ""
    const s = Math.max(0, Math.round((nowMs - lastLoadMs) / 1000))
    if (s < 10) return "just now"
    if (s < 60) return `${s}s ago`
    const m = Math.round(s / 60)
    if (m < 60) return `${m}m ago`
    const h = Math.round(m / 60)
    return `${h}h ago`
}
