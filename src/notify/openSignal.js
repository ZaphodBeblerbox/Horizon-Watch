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
        assetId: d.assetId || d.asset_id || null,
        livestreamId: d.livestreamId || d.livestream_id || null,
        inspect: d.inspect !== false,
        _item: d.ref !== undefined || d.read !== undefined ? d : null,      // a tray item: the desktop opens it as itself
    }
}

/** What to open. Pure. */
export function routeFor(input) {
    const n = input?._n ? input : normalizeOpen(input)
    if (!n) return null
    if (n.livestreamId) return { ...n, action: "livestream" }
    if (n.assetId) return { ...n, action: "asset" }
    const probe = { alert_type: n.alertType, mmsi: n.mmsi, entity_id: n.entityId, alert_id: n.alertId, id: n.id }
    if (n.mmsi || isVesselThreatAlert(probe, n.alertId)) {
        const mmsi = n.mmsi ? String(n.mmsi) : mmsiOf(probe, n.alertId)
        if (mmsi) return { ...n, action: "vessel", mmsi: String(mmsi), alertType: n.alertType || ALERT_TYPE }
    }
    return { ...n, action: "signal" }
}

/** The query a notification opens the app with when it was closed
 *  (public/sw-push.js builds it: signal, focus, live, asset, vessel, type, h). Pure. */
export function parseOpenParams(search) {
    const q = new URLSearchParams(search || "")
    const [lat, lon] = (q.get("focus") || "").split(",").map((x) => (x === "" ? NaN : Number(x)))
    const has = q.get("signal") || q.get("live") || q.get("asset") || q.get("vessel") || (Number.isFinite(lat) && Number.isFinite(lon))
    if (!has) return null
    const vessel = /^\d{6,}$/.test(q.get("vessel") || "") ? q.get("vessel") : null
    return {
        id: q.get("signal") || null,
        lat: Number.isFinite(lat) ? lat : null, lon: Number.isFinite(lon) ? lon : null,
        livestreamId: q.get("live") || null, assetId: q.get("asset") || null,
        mmsi: vessel, alertType: q.get("type") || (vessel ? ALERT_TYPE : null),
        title: q.get("h") || "",
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
    const fn = surfaces[surfaces.length - 1]
    if (fn) fn(r)
    else queued = r
    return r
}

/** Test seam. */
export function __resetSignalSurfaces() { surfaces.length = 0; queued = null; fetcher = null }
