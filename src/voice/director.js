/**
 * director.js — the console shows its answer (owner, 2026-10-10: the old
 * director mode's freedoms, for answering a question).
 *
 * When a spoken question is answered, the map is driven to the evidence:
 * the layers its signals come from are switched on, the camera takes in the
 * place, then visits the strongest located signals one by one while the
 * answer lights the one on screen. Everything it switched is recorded so
 * "Put the map back" undoes it; Stop ends the tour where it is.
 */
const SOURCE_LAYER = [
    [/telegram/i, "telegram"], [/gdelt|news|rss/i, "gdelt"], [/geoconfirmed/i, "geoconfirmed"],
    [/firms|heat|thermal|fire/i, "heat"], [/imagery|sentinel/i, "imagery_signals"], [/ais|vessel|ship|sanction/i, "vessels"],
    [/adsb|aircraft|squawk|military aircraft/i, "aircraft"], [/gps|jamming/i, "gps_interference"], [/unrest|protest/i, "unrest"],
]

/** The map layers this evidence needs. Pure. */
export function layersFor(signals) {
    const out = new Set(["alerts"])
    for (const s of signals || []) {
        const t = `${s.source || ""} ${s.source_type || ""}`
        for (const [re, layer] of SOURCE_LAYER) if (re.test(t)) out.add(layer)
    }
    return [...out]
}

/** The signals worth visiting: located, strongest first, at most n. Pure. */
export function tourStops(signals, n = 3) {
    const rank = { critical: 0, significant: 1, high: 1, elevated: 2, moderate: 3 }
    return (signals || []).map((s, i) => ({ ...s, _i: i }))
        .filter((s) => Number.isFinite(+s.lat) && Number.isFinite(+s.lon))
        .sort((a, b) => (rank[String(a.severity || "").toLowerCase()] ?? 4) - (rank[String(b.severity || "").toLowerCase()] ?? 4))
        .slice(0, n)
}

/** The camera over all of them: centre and an altitude that takes them in. Pure. */
export function overview(signals) {
    const pts = (signals || []).filter((s) => Number.isFinite(+s.lat) && Number.isFinite(+s.lon))
    if (!pts.length) return null
    const lats = pts.map((p) => +p.lat), lons = pts.map((p) => +p.lon)
    const span = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lons) - Math.min(...lons))
    return { lat: (Math.max(...lats) + Math.min(...lats)) / 2, lon: (Math.max(...lons) + Math.min(...lons)) / 2,
             altitude: Math.min(8_000_000, Math.max(400_000, span * 160_000)) }
}

const fly = (lat, lon, altitude) => window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat, lon, altitude } }))

/**
 * Run the tour. onStep(index|null) says which signal is on screen.
 * Returns { stop, restore }.
 */
export function direct(signals, { onStep = () => {}, dwellMs = 4500 } = {}) {
    let stopped = false
    const timers = []
    const switched = []
    window.dispatchEvent(new CustomEvent("akili:open-map"))
    for (const layer of layersFor(signals)) {
        let was = null
        window.dispatchEvent(new CustomEvent("akili:voice-layer", { detail: { layer, on: true, report: (v, prev) => { was = prev } } }))
        switched.push({ layer, was })
    }
    const ov = overview(signals)
    if (ov) timers.push(setTimeout(() => { if (!stopped) fly(ov.lat, ov.lon, ov.altitude) }, 600))
    tourStops(signals).forEach((s, k) => {
        timers.push(setTimeout(() => {
            if (stopped) return
            fly(+s.lat, +s.lon, 60_000)
            onStep(s._i)
        }, 600 + dwellMs * (k + 1)))
    })
    timers.push(setTimeout(() => { if (!stopped) onStep(null) }, 600 + dwellMs * (tourStops(signals).length + 1)))
    return {
        stop() { stopped = true; timers.forEach(clearTimeout); onStep(null) },
        restore() {
            this.stop()
            for (const { layer } of switched) window.dispatchEvent(new CustomEvent("akili:voice-layer-undo", { detail: { layer } }))
        },
    }
}
