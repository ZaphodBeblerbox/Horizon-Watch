/**
 * contexts.js — WHEN THE ROUTE PANEL OPENS ON ITS OWN (owner, 2026-10-12:
 * a route planner "that appears in certain situations").
 *
 * The server says whether a route plan is relevant at a place, and why
 * (GET /api/routes/context → [{kind, purpose, title, reason, mode, depart_at?}]):
 *   exit    a person or a mover within 1 km of a live danger → "Exit route"
 *   access  a site with a public call (roadblock, picket, gathering) within
 *           2 km in the next 48 h → "Deliveries / access route" (truck)
 * Each kind is turned into a panel request here, by a registered handler,
 * so a new planner adds its own kind with registerRouteContext:
 *
 *   registerRouteContext("medevac", { title, request: (ctx, subject) => ({...}) })
 *
 * Triggers wired in the app:
 *   - a "Leave now" notification (notify/openSignal.js, action "exit") → openFromNotification
 *   - the inspector / asset sheets → <RouteContextCards assetId=… /> (RouteContextCards.jsx)
 */
import { openRoutePanel } from "./store.js"

export const routeContexts = new Map()

/** def: {title?, request(ctx, subject) → panel request} */
export function registerRouteContext(kind, def) { routeContexts.set(kind, { kind, ...def }) }

registerRouteContext("exit", {
    title: "Exit route",
    request: (ctx, s) => ({ from: s.assetId ? { asset_id: s.assetId } : { me: true }, to: null, mode: ctx.mode || "foot", purpose: "exit" }),
})
registerRouteContext("access", {
    title: "Deliveries / access route",
    request: (ctx, s) => ({ from: null, to: { asset_id: s.assetId }, mode: ctx.mode || "truck", purpose: "access", depart_at: ctx.depart_at || null }),
})

/** The panel request for a context card, or null when no handler knows its kind. */
export function requestFor(ctx, subject) {
    const h = routeContexts.get(ctx?.kind)
    return h ? h.request(ctx, subject || {}) : null
}

export function openContext(ctx, subject) {
    const request = requestFor(ctx, subject)
    if (!request) return false
    openRoutePanel({ request, title: ctx.title || routeContexts.get(ctx.kind)?.title })
    return true
}

/** A "Leave now" notification (backend/exit_watch.py): the panel on that person's exit route
 *  — the plan it was raised with when it carries one, re-checked on opening. */
export function openFromNotification(n) {
    openRoutePanel({
        request: { from: n.assetId ? { asset_id: n.assetId } : { me: true }, to: null, mode: "foot", purpose: "exit" },
        planId: n.routePlanId || null,
        title: "Exit route",
    })
}
