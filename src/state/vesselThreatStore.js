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

/** Open a vessel live: fetch, publish; the globe layer draws and flies. */
export async function openVesselThreat(mmsi, opts = {}) {
  if (!mmsi) return
  const req = state.req + 1
  set({ mmsi: String(mmsi), loading: true, error: null, data: state.mmsi === String(mmsi) ? state.data : null, sim: null, req, fly: opts.fly !== false })
  try {
    const data = await fetchVesselThreat(mmsi, opts)
    if (state.req !== req) return
    set({ loading: false, data, error: data?.available === false ? (data.reason || "unavailable") : null })
  } catch (e) {
    if (state.req !== req) return
    set({ loading: false, error: String(e?.message || e) })
  }
}

/** Fly the simulated drone to targets[index] (default the top-ranked). */
export function simulateVesselThreat(index = 0) {
  if (!state.data?.targets?.length) return
  set({ sim: { index, startedAt: Date.now(), id: (state.sim?.id || 0) + 1 } })
}

export function stopSimulation() { set({ sim: null }) }

export function closeVesselThreat() {
  set({ mmsi: null, loading: false, error: null, data: null, sim: null, req: state.req + 1 })
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
