/**
 * openFinding.js — what the phone puts on the map for an imagery finding's
 * notification: the alert's own pass (its scan), its boxes, and the one box
 * that IS the signal, in focus (owner, 2026-10-13: "a notification tap must
 * lead straight to the image, the exact signal and its detection boxes").
 *
 * WHY THIS EXISTS. The phone drew from whatever the route carried. The route
 * carries the alert row only when openSignal's lookup (1.5 s) won the race,
 * or never when the notification itself named the zone (a radar change's
 * RCHG-ZONE-… id). Without the row there is no scan id and, for an optical
 * "Imagery signal" (its zone is only in raw_json), no zone at all: no boxes,
 * no image, only a pin. The desktop (app.jsx openFindingRoute) always
 * fetched the alert. Now the phone does too, and says which pass and which
 * box the notification was about.
 *
 * Pure helpers first (openFinding.test.js).
 */
import API_BASE from "../apiBase.js"
import { authHeaders } from "../auth.js"
import { alertRaw, asBounds, findingsForAlert } from "../lib/findings.js"
import { lookupId } from "../notify/openSignal.js"

const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(+v) ? null : +v)

/** The alert as far as the route knows it (no row fetched). Pure. */
export function alertStub(r) {
    return {
        alert_id: r?.alertId || r?.id || null, title: r?.title || "", severity: r?.sev || null,
        lat: r?.lat ?? null, lon: r?.lon ?? null, alert_type: r?.alertType || null,
        entity_type: r?.entityType || null, entity_id: r?.entityId || null,
        raw_json: { zone_id: r?.zoneId || null },
    }
}

/** The pass a finding alert is about: {scanId, kind: "radar" | "scene"} or null. Pure. */
export function scanOfAlert(a) {
    const raw = alertRaw(a)
    const scanId = raw.scan_id ? String(raw.scan_id) : null
    if (!scanId) return null
    const et = a?.entity_type || a?.entityType
    const radar = raw.kind === "radar_change" || raw.kind === "sweep_find" || et === "radar_change" || et === "sweep_finding"
        || /^RCHG-/.test(String(a?.alert_id || a?.id || ""))
    return { scanId, kind: radar ? "radar" : "scene" }
}

/** Where the signal is on the ground: the source the reason names
 *  ("… Source 54.174803, 12.120955."), else the alert's point. Pure. */
export function signalPoint(a) {
    const m = String(alertRaw(a).reason || a?.message || "").match(/Source\s+(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/)
    if (m) return { lat: +m[1], lon: +m[2] }
    const lat = num(a?.lat), lon = num(a?.lon)
    return lat !== null && lon !== null ? { lat, lon } : null
}

const words = (s) => String(s || "").toLowerCase().replace(/[_-]+/g, " ").trim()

/** The finding that is the notification's signal, or null: of the alert's
 *  pass, the kind it names (entity_type / focus, "smoke_plume" → "Smoke
 *  plume") nearest its point; else a box holding the point. Pure. */
export function focusFindingId(findings, a) {
    const fs = (findings || []).filter((f) => asBounds(f?.box))
    if (!fs.length) return null
    const scan = scanOfAlert(a)?.scanId
    const pool = scan && fs.some((f) => f.scan_id === scan) ? fs.filter((f) => f.scan_id === scan) : fs
    const raw = alertRaw(a)
    const kinds = [a?.entity_type || a?.entityType, raw.focus].map(words).filter((k) => k && k !== "other")
    const p = signalPoint(a)
    const centre = (f) => { const b = asBounds(f.box); return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] }
    const dist = (f) => {
        if (!p) return 0
        const [x, y] = centre(f)
        const k = Math.cos((p.lat * Math.PI) / 180)
        return Math.hypot((x - p.lon) * k, y - p.lat)
    }
    const typed = kinds.length ? pool.filter((f) => kinds.some((k) => words(f.label).includes(k) || words(f.kind) === k)) : []
    if (typed.length) return [...typed].sort((x, y) => dist(x) - dist(y))[0].id
    if (!p) return null
    const holding = pool.filter((f) => { const b = asBounds(f.box); return p.lon >= b[0] && p.lon <= b[2] && p.lat >= b[1] && p.lat <= b[3] })
    return holding.length ? [...holding].sort((x, y) => dist(x) - dist(y))[0].id : null
}

/** What to put on show for a finding route (lib/findings.js showFindings), without the title / fit. Pure. */
export function showFor({ zoneId, findings, zone }, alert) {
    const scan = scanOfAlert(alert)
    return {
        zoneId, findings, zone: zone || null,
        focusId: focusFindingId(findings, alert),
        scanId: scan?.scanId || null, scanKind: scan?.kind || null,
    }
}

async function fetchAlertRow(id, timeoutMs = 10000) {
    let headers = {}
    try { headers = authHeaders() } catch { /* no storage */ }
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null
    const t = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null
    try {
        // the bearer too (lib/desktopAuth.js adds it as well): cross-site the cookie is not sent
        const r = await fetch(`${API_BASE}/api/alerts/${encodeURIComponent(id)}`, { credentials: "include", headers, signal: ctl?.signal })
        return r.ok ? await r.json() : null
    } catch { return null } finally { if (t) clearTimeout(t) }
}

/**
 * The route → {show, alert}: the alert row (the route's, else fetched —
 * with the time a phone on a cold start needs, not openSignal's 1.5 s),
 * then its findings (lib/findings.js findingsForAlert: the pass's own list,
 * else the zone's), and which pass and box to show.
 */
export async function findingsForRoute(r, { fetchAlert = fetchAlertRow, forAlert = findingsForAlert } = {}) {
    let alert = r?.alert && (r.alert.alert_id || r.alert.title) ? r.alert : null
    if (!alert) {
        const id = lookupId(r)
        const row = id ? await fetchAlert(id).catch(() => null) : null
        alert = row && (row.alert_id || row.title) ? row : null
    }
    const a = alert || alertStub(r)
    const d = await forAlert(a)
    return { alert: a, show: showFor(d || { zoneId: null, findings: [] }, a) }
}
