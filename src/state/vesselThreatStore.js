// The vessel-of-concern live view: one open vessel at a time, shared by the
// inspector section (VesselThreatSection), the globe layer
// (GlobeVesselThreatLayer) and the phone sheet. A tiny pub-sub store —
// the app's convention (no zustand/context for selection).
import { apiFetch } from "../auth"

let state = { mmsi: null, loading: false, error: null, data: null, sim: null, req: 0 }
const subs = new Set()

function set(patch) {
  state = { ...state, ...patch }
  subs.forEach((f) => { try { f(state) } catch (e) { console.error("[vessel-threat] subscriber", e) } })
}

export function getVesselThreat() { return state }

export function subscribeVesselThreat(fn) {
  subs.add(fn)
  return () => subs.delete(fn)
}

export function vesselThreatPath(mmsi, { lat, lon, synthetic } = {}) {
  const q = new URLSearchParams()
  if (Number.isFinite(+lat) && Number.isFinite(+lon) && lat !== null && lon !== null) { q.set("lat", lat); q.set("lon", lon) }
  if (synthetic) q.set("synthetic", "true")
  const qs = q.toString()
  return `/api/vessel-threat/vessel/${encodeURIComponent(mmsi)}${qs ? `?${qs}` : ""}`
}

export async function fetchVesselThreat(mmsi, opts = {}) {
  const res = await apiFetch(vesselThreatPath(mmsi, opts), { _timeout: 60000 })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/** Open a vessel live: fetch, publish; the globe layer draws and flies.
 *  opts.simulate: start the simulated drone flight to the top-ranked
 *  target once the view is drawn (opened from a notification,
 *  notify/openSignal.js). opts.from: what opened it ("notification"). */
export async function openVesselThreat(mmsi, opts = {}) {
  if (!mmsi) return
  const req = state.req + 1
  const same = state.mmsi === String(mmsi)
  set({
    mmsi: String(mmsi), loading: true, error: null, data: same ? state.data : null, sim: null, req, fly: opts.fly !== false,
    // a re-open of the same vessel (the inspector section mounting) keeps
    // a flight that is still to start
    pendingSim: opts.simulate ? true : same ? !!state.pendingSim : false,
    from: opts.from || (same ? state.from : null) || null,
  })
  try {
    const data = await fetchVesselThreat(mmsi, opts)
    if (state.req !== req) return
    set({ loading: false, data, error: data?.available === false ? (data.reason || "unavailable") : null })
    if (state.pendingSim && data?.available !== false && data?.targets?.length) {
      // the vessel first (the globe flies to it), then the flight
      setTimeout(() => {
        if (state.req !== req || !state.pendingSim) return
        set({ pendingSim: false })
        simulateVesselThreat(0)
      }, opts.simDelayMs ?? 2200)
    }
  } catch (e) {
    if (state.req !== req) return
    set({ loading: false, error: String(e?.message || e) })
  }
}

/** Open it unless it is already open (or opening) — the inspector section
 *  mounting must not restart a view a notification just opened. */
export function ensureVesselThreat(mmsi, opts = {}) {
  if (!mmsi) return
  if (state.mmsi === String(mmsi) && (state.loading || state.data)) return
  return openVesselThreat(mmsi, opts)
}

/** Fly the simulated drone to targets[index] (default the top-ranked). */
export function simulateVesselThreat(index = 0) {
  if (!state.data?.targets?.length) return
  set({ sim: { index, startedAt: Date.now(), id: (state.sim?.id || 0) + 1 } })
}

export function stopSimulation() { set({ sim: null, pendingSim: false }) }

export function closeVesselThreat() {
  set({ mmsi: null, loading: false, error: null, data: null, sim: null, pendingSim: false, from: null, req: state.req + 1 })
}

// Scripted/devtools entry point and cross-surface trigger, the app's event-bus
// convention: window.dispatchEvent(new CustomEvent("akili:vessel-threat", {detail}))
if (typeof window !== "undefined" && !window.__vesselThreatListening) {
  window.__vesselThreatListening = true
  window.addEventListener("akili:vessel-threat", (e) => {
    const d = e.detail || {}
    if (d.action === "close") return closeVesselThreat()
    if (d.action === "simulate") return simulateVesselThreat(d.index || 0)
    openVesselThreat(d.mmsi, d)
  })
}
