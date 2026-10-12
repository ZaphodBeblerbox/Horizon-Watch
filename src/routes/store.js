/**
 * store.js — the route panel: is it open, for what request, and the plan on
 * show (published for map layers drawn apart from the panel — the globe).
 *
 *   openRoutePanel({ request, planId?, title?, purpose? })
 *     request = { from: {asset_id} | {me: true} | {lat, lon, label}, to: null | {lat, lon, name} | {asset_id},
 *                 mode, depart_at, avoid: [provider], purpose }
 *     planId  = a saved plan to open (GET /api/routes/{id}) instead of planning anew
 */
let state = { open: false, request: null, planId: null, title: null, plan: null, seq: 0 }
const subs = new Set()
export function getRoutePanel() { return state }
export function subscribeRoutePanel(fn) { subs.add(fn); return () => subs.delete(fn) }
function set(patch) { state = { ...state, ...patch }; subs.forEach((f) => { try { f(state) } catch { /* listener */ } }) }

export function openRoutePanel({ request, planId = null, title = null } = {}) {
    set({ open: true, request: { mode: "foot", from: { me: true }, to: null, avoid: null, purpose: "exit", ...(request || {}) },
          planId, title, plan: null, seq: state.seq + 1 })
    try { window.dispatchEvent(new CustomEvent("plx:route-panel", { detail: state })) } catch { /* no window */ }
}
export function closeRoutePanel() { set({ open: false, plan: null, planId: null }) }
/** Change the request (mode, depart time, avoid chips, destination): planned again. */
export function updateRequest(patch) { set({ request: { ...state.request, ...patch }, planId: null, seq: state.seq + 1 }) }
export function publishPlan(plan) { if (state.plan !== plan) set({ plan }) }
