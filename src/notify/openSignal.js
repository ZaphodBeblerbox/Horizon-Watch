/**
 * openSignal.js — ONE way to open what a notification is about, whatever
 * was clicked (owner, 2026-10-11: "when I click on the notification, I
 * should be led directly to that boat on the map, with the striking range
 * displayed, the 3D path displayed, and all of that").
 *
 * Every entry point comes here:
 *   - a web/phone push clicked with the app open (public/sw-push.js posts
 *     NOTIFICATION_CLICK → main.jsx → "plx:open-notification"),
 *   - a push clicked with the app closed (/?signal=…&vessel=… → main.jsx
 *     parseOpenParams → window.__plxPendingOpen),
 *   - the desktop app's macOS notification (desktop/nativeNotify.js),
 *   - an in-app card (NotificationStack), a phone banner (MNotifCards),
 *     the tray, the General desk's "On the map".
 *
 * routeFor() decides what to open — a livestream, an asset, a VESSEL OF
 * CONCERN (Russia-linked vessel loitering: the vessel's live view with its
 * drone rings, targets and the simulated flight), or any other signal (fly
 * there and open it, as before). The surface that is on screen (the
 * desktop console in app.jsx, or the phone shell in MobileApp.jsx)
 * registers how to do each with setSignalSurface().
 *
 * A vessel alert is recognised from what the notification carried (its
 * alert_type / mmsi / RUL-<mmsi>-… id), so it opens before anything is
 * fetched; anything else with an alert id is looked up (GET
 * /api/alerts/{id}, briefly) in case it is a vessel alert that arrived
 * without saying so.
 */
import { ALERT_TYPE, isVesselThreatAlert, mmsiOf } from "../globe/vesselThreat.js"
import { findingZoneOf, isFindingAlert } from "../lib/findings.js"

const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(+v) ? null : +v)

/** Any shape a notification arrives in → one shape.
 *  (push message, native/URL detail, a store item, a feed/General item, an alert row) */
export function normalizeOpen(d) {
    if (!d) return null
    const ref = d.ref && num(d.ref.lat) !== null && num(d.ref.lon) !== null ? d.ref : null
    const rawId = d.alertId || d.alert_id || d.eventId || d.id || null
    // the General feed's "sig:<alert id>" and the surface's "sig-<id>"
    const alertId = rawId ? String(rawId).replace(/^sig[:-]/, "") : null
    return {
        _n: true,
        id: d.id || d.eventId || alertId,
        alertId,
        lat: ref ? +ref.lat : num(d.lat),
        lon: ref ? +ref.lon : num(d.lon ?? d.lng),
        title: d.title || d.headline || d.h || "",
        sub: d.sub || d.message || "",
        sev: d.sev || d.severity || null,
        kind: d.kind || null,
        alertType: d.alertType || d.alert_type || null,
        mmsi: d.mmsi || d.vessel || null,
        entityId: d.entityId || d.entity_id || null,
        entityType: d.entityType || d.entity_type || null,
        zoneId: d.zoneId || d.zone_id || findingZoneOf(d) || null,
        assetId: d.assetId || d.asset_id || null,
        routePlanId: d.routePlanId || d.route_plan_id || null,
        livestreamId: d.livestreamId || d.livestream_id || null,
        // a message for you (its conversation), a desk post (its id)
        conversationId: d.conversationId || d.conversation_id || null,
        postId: d.postId || (d.kind === "desk" ? d.post_id : null) || null,
        inspect: d.inspect !== false,
        _item: d.ref !== undefined || d.read !== undefined ? d : null,      // a tray item: the desktop opens it as itself
    }
}

export const EXIT_ALERT_TYPE = "Leave now"

/** What to open. Pure. */
export function routeFor(input) {
    const n = input?._n ? input : normalizeOpen(input)
    if (!n) return null
    // A MESSAGE OPENS ITS CONVERSATION, a desk card the desk at that post
    // (owner, 2026-10-19) — on the phone and the desktop alike.
    if (n.kind === "message" || n.conversationId) return { ...n, action: "chat" }
    if (n.kind === "desk") return { ...n, action: "desk" }
    if (n.livestreamId) return { ...n, action: "livestream" }
    // LEAVE NOW (backend/exit_watch.py): unrest near someone — the safest-route view
    if (n.alertType === EXIT_ALERT_TYPE || n.kind === "exit") return { ...n, action: "exit" }
    if (n.assetId) return { ...n, action: "asset" }
    const probe = { alert_type: n.alertType, mmsi: n.mmsi, entity_id: n.entityId, alert_id: n.alertId, id: n.id }
    if (n.mmsi || isVesselThreatAlert(probe, n.alertId)) {
        const mmsi = n.mmsi ? String(n.mmsi) : mmsiOf(probe, n.alertId)
        if (mmsi) return { ...n, action: "vessel", mmsi: String(mmsi), alertType: n.alertType || ALERT_TYPE }
    }
    // AN IMAGERY FINDING (owner, 2026-10-12): a border-sweep find, a radar
    // change, an imagery signal — opened on what was found, drawn as boxes.
    if (isFindingAlert(n)) return { ...n, action: "finding", zoneId: n.zoneId || findingZoneOf(n) || null }
    return { ...n, action: "signal" }
}

/**
 * HOW a route is shown (owner, 2026-10-12: "I should be sent to the specific
 * signal AND the specific location on the map, with the actual signal
 * displayed on the map"). Pure; both surfaces follow it.
 *   map     the map is opened, at `focus` when the signal has a place
 *   draw    what is drawn there: "vessel" (live vessel, rings, top targets),
 *           "findings" (the boxes, over the scene's image), "pin" (the
 *           signal's own marker, highlighted), or null
 *   panel   the details: "sheet" on the phone, "inspector" on the desktop
 *   sheet   "half" (the map visible above, draggable to full) when the map
 *           shows the signal, "full" when there is nothing to show on a map
 */
export function presentationFor(r, surface = "phone") {
    if (!r) return null
    const focus = r.lat != null && r.lon != null ? { lat: +r.lat, lon: +r.lon } : null
    const panel = surface === "phone" ? "sheet" : "inspector"
    if (r.action === "livestream") return { map: false, focus: null, draw: null, panel: "player", sheet: null }
    if (r.action === "chat" || r.action === "desk") return { map: false, focus: null, draw: null, panel: r.action, sheet: null }
    if (r.action === "asset") return { map: false, focus: null, draw: null, panel: "asset", sheet: null }
    if (r.action === "exit") return { map: true, focus, draw: "route", panel: "route", sheet: null }
    if (r.action === "vessel") return { map: true, focus, draw: "vessel", panel, sheet: "half" }
    // a finding is placed by its boxes (the zone's list), even without a point
    if (r.action === "finding") return { map: true, focus, draw: "findings", overlay: true, panel, sheet: "half" }
    if (focus) return { map: true, focus, draw: "pin", panel, sheet: "half" }
    return { map: false, focus: null, draw: null, panel, sheet: "full" }
}

/** The marker a plain signal is drawn with (a Telegram or GeoConfirmed post,
 *  a place, any alert with a point), or null. Pure. */
export function pinFor(r) {
    if (!r || r.action !== "signal" || r.lat == null || r.lon == null) return null
    return { id: r.id || r.alertId || null, alertId: r.alertId || null, lat: +r.lat, lon: +r.lon,
             title: r.title || "", sev: r.sev || null, kind: r.kind || null, alertType: r.alertType || null }
}

/** The query a notification opens the app with when it was closed
 *  (public/sw-push.js builds it: signal, focus, live, asset, vessel, type, h). Pure. */
export function parseOpenParams(search) {
    const q = new URLSearchParams(search || "")
    const [lat, lon] = (q.get("focus") || "").split(",").map((x) => (x === "" ? NaN : Number(x)))
    const has = q.get("signal") || q.get("live") || q.get("asset") || q.get("vessel") || q.get("chat") || q.get("deskpost")
        || (Number.isFinite(lat) && Number.isFinite(lon))
    if (!has) return null
    const vessel = /^\d{6,}$/.test(q.get("vessel") || "") ? q.get("vessel") : null
    return {
        id: q.get("signal") || null,
        lat: Number.isFinite(lat) ? lat : null, lon: Number.isFinite(lon) ? lon : null,
        livestreamId: q.get("live") || null, assetId: q.get("asset") || null, routePlanId: q.get("plan") || null,
        mmsi: vessel, alertType: q.get("type") || (vessel ? ALERT_TYPE : null),
        title: q.get("h") || "",
        conversationId: q.get("chat") || null, postId: q.get("deskpost") || null,
        kind: q.get("chat") ? "message" : q.get("deskpost") ? "desk" : null,
    }
}

/** Could this id be an alert row worth looking up? (not a Telegram post,
 *  a summary push, an inferred finding …) */
export function lookupId(n) {
    const id = String(n?.alertId || "")
    if (!id || id.length > 120 || /[:/\s]/.test(id) || /^N-/.test(id)) return null
    return id
}

/** An alert row → the fields routeFor reads. */
export function fromAlertRow(n, row) {
    if (!row) return n
    const raw = row.raw_json && typeof row.raw_json === "object" ? row.raw_json : {}
    return {
        ...n,
        alertType: n.alertType || row.alert_type || null,
        mmsi: n.mmsi || raw.mmsi || (row.alert_type === ALERT_TYPE ? row.entity_id : null) || null,
        entityId: n.entityId || row.entity_id || null,
        entityType: n.entityType || row.entity_type || null,
        zoneId: n.zoneId || findingZoneOf(row) || null,
        alert: row,
        lat: n.lat ?? num(row.lat), lon: n.lon ?? num(row.lon),
        title: n.title || row.title || "",
        sev: n.sev || row.severity || null,
    }
}

// ── the surface on screen ──────────────────────────────────────────────
const surfaces = []
let queued = null

/** The desktop console or the phone shell says how to open each route.
 *  The last one registered is used; returns its unregister. Something
 *  opened before any surface was there is opened when one arrives. */
export function setSignalSurface(fn) {
    surfaces.push(fn)
    if (queued) {
        const q = queued
        queued = null
        setTimeout(() => fn(q), 0)
    }
    return () => {
        const i = surfaces.lastIndexOf(fn)
        if (i >= 0) surfaces.splice(i, 1)
    }
}

// How alerts are looked up: the app's signed-in fetch (auth.apiFetch),
// loaded lazily so this module stays pure for its tests.
let fetcher = async (path) => {
    const { apiFetch } = await import("../auth")
    const r = await apiFetch(path, { _timeout: 4000 })
    return r.ok ? r.json() : null
}
/** A test seam: replace the lookup (null: never look anything up). */
export function setAlertFetcher(fn) { fetcher = fn }

async function resolve(n, timeoutMs) {
    const id = lookupId(n)
    if (!id || !fetcher) return n
    try {
        const row = await Promise.race([
            fetcher(`/api/alerts/${encodeURIComponent(id)}`),
            new Promise((r) => setTimeout(() => r(null), timeoutMs)),
        ])
        return fromAlertRow(n, row)
    } catch {
        return n
    }
}

/** Open what a notification is about, on whichever surface is showing.
 *  Returns the route it took. */
export async function openSignal(input, { timeoutMs = 1500 } = {}) {
    let r = routeFor(input)
    if (!r) return null
    // Not recognisably a vessel from what it carried: ask the alert itself.
    // (A known alert type that is not one needs no lookup.)
    if (r.action === "signal" && !r.alertType) r = routeFor(await resolve(r, timeoutMs)) || r
    // A finding whose zone the notification did not carry: the alert says.
    else if (r.action === "finding" && !r.zoneId) r = routeFor(await resolve(r, timeoutMs)) || r
    if (r.action === "chat" || r.action === "desk") {
        // the screen asks for it whenever it mounts (notify/inbox.js); the
        // surface brings that screen up
        const inbox = await import("./inbox.js")
        if (r.action === "chat") inbox.requestOpenChat(r.conversationId)
        else inbox.requestOpenDeskPost(r.postId)
    }
    if (r.action === "exit") {
        // the same view on every surface: the phone's full screen, the desktop's panel over the globe
        const { openFromNotification } = await import("../routes/contexts.js")
        try { window.dispatchEvent(new CustomEvent("akili:navigate", { detail: { destination: "situation" } })) } catch { /* no window */ }
        openFromNotification(r)
        return r
    }
    const fn = surfaces[surfaces.length - 1]
    if (fn) fn(r)
    else queued = r
    return r
}

/** Test seam. */
export function __resetSignalSurfaces() { surfaces.length = 0; queued = null; fetcher = null }
