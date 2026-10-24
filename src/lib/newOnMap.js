/**
 * newOnMap.js — what is NEW on the map pulses, briefly (owner, 2026-10-24: "when a new item appears on the map
 * it pulses for a few seconds, then rests at its normal size"), on the phone and the desktop alike.
 *
 * NEW means: an item of an event layer (a live signal, a protest, police or crowd item, a strike, any event
 * marker with a time) that this map has not drawn before, whose own time is recent (FRESH_MS), and that came
 * after the layer's first picture — so opening the map, turning a layer on or panning over old items makes
 * nothing pulse, and a report that arrives while you look does. Items with no time (ports, assets) never pulse.
 *
 * The pulse itself is lib/mapIcons.js PULSE / pulseRingIcon / pulseFrame: one ring, drawn by the phone
 * (mobile/screens/MMap.jsx) and the globe (globe/GlobePulseLayer.jsx), from the store below.
 */
import { PULSE } from "./mapIcons.js"

export const FRESH_MS = 30 * 60_000          // only an item from the last 30 minutes is new
export const BASELINE_MS = 15_000            // a layer's first picture: what it shows in its first non-empty load (or 15 s)
const MAX_SEEN = 20_000

export function createNewTracker({ freshMs = FRESH_MS, baselineMs = BASELINE_MS } = {}) {
    const layers = new Map()                 // layer -> { seen:Set, since:number, settled:boolean }
    return {
        /** items [{id, t, ...}] → the ones that are new now (see above). */
        observe(layer, items, now = Date.now()) {
            let st = layers.get(layer)
            if (!st) { st = { seen: new Set(), since: now, settled: false }; layers.set(layer, st) }
            const list = Array.isArray(items) ? items : []
            const baseline = !st.settled
            const out = []
            for (const it of list) {
                if (it?.id == null) continue
                const k = String(it.id)
                if (st.seen.has(k)) continue
                st.seen.add(k)
                if (baseline) continue
                const t = +it.t
                if (!Number.isFinite(t) || t <= 0 || now - t > freshMs || t - now > 5 * 60_000) continue
                out.push(it)
            }
            if (baseline && (list.length > 0 || now - st.since >= baselineMs)) st.settled = true
            if (st.seen.size > MAX_SEEN) st.seen = new Set(list.map((x) => String(x?.id)))
            return out
        },
        /** The layer was turned off: its next picture is a first picture again. */
        reset(layer) { layers.delete(layer) },
    }
}

// ── the pulses on show (both maps draw them) ───────────────────────────────
let pulses = []
const subs = new Set()
const emit = () => { for (const fn of [...subs]) { try { fn(pulses) } catch { /* one map must not stop the other */ } } }

/** [{id, lat, lon, pri, size}] start pulsing now. */
export function addPulses(list, now = Date.now()) {
    const add = (list || []).filter((p) => Number.isFinite(+p.lat) && Number.isFinite(+p.lon))
        .map((p) => ({ id: String(p.id), lat: +p.lat, lon: +p.lon, pri: p.pri || "alert", size: p.size || 24, start: now }))
    if (!add.length) return
    const ids = new Set(add.map((p) => p.id))
    pulses = [...pulses.filter((p) => !ids.has(p.id) && now - p.start < PULSE.ms), ...add]
    emit()
}
export function getPulses(now = Date.now()) { return pulses.filter((p) => now - p.start < PULSE.ms) }
export function subscribePulses(fn) { subs.add(fn); return () => subs.delete(fn) }

// the tracker the globe's layers share (globe/screenDeclutter.js observes every event layer through it)
export const globeTracker = createNewTracker()
