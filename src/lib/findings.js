/**
 * findings.js — what the automatic watch found, as boxes on the ground.
 *
 * Owner, 2026-10-12: "when we get a notification like 'Possible tent or
 * vehicle group detected' I want what was detected to be shown; when I press
 * the notification I want to be shown on the map with detection boxes."
 *
 * Every finding (backend/finding_boxes.py) carries `box` = [west, south,
 * east, north] in degrees, a label, a size, a date and a tone (red: something
 * new appeared; amber: something went or changed). The same shape is drawn
 *   - on the desktop globe (globe/GlobeFindingsLayer.jsx),
 *   - on the phone map (mobile/findingsLeaflet.js),
 *   - on the Imagery scene (as fractions of the image: boxToFrame),
 *   - in the signal view, cut out of the image (components/FindingPreview.jsx).
 *
 * One store says which findings are on show; each map subscribes to it.
 * Pure helpers first (tested in findings.test.js), the store and the two
 * fetches after.
 */
import API_BASE from "../apiBase.js"

export const TONE = { red: "#FF3B30", amber: "#FFB300" }
export const FINDING_TYPES = new Set(["sweep_finding", "radar_change"])
const SWEEP_LABEL = { "new tent/vehicle cluster": "Possible tent or vehicle group",
                      "new cleared/disturbed ground": "Cleared or disturbed ground" }
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(+v) ? null : +v)

/** [w, s, e, n] from a list, {west,…} or a zone bbox {min_lon,…}; null otherwise. */
export function asBounds(b) {
    if (!b) return null
    let w, s, e, n
    if (Array.isArray(b)) [w, s, e, n] = b
    else if (b.west !== undefined) ({ west: w, south: s, east: e, north: n } = b)
    else ({ min_lon: w, min_lat: s, max_lon: e, max_lat: n } = b)
    ;[w, s, e, n] = [w, s, e, n].map(num)
    if ([w, s, e, n].some((v) => v === null) || !(e > w && n > s)) return null
    return [w, s, e, n]
}

/** A box in degrees → [x, y, w, h] as fractions of a frame (y down from the north edge). */
export function boxToFrame(box, bounds) {
    const b = asBounds(box), f = asBounds(bounds)
    if (!b || !f) return null
    const dx = f[2] - f[0], dy = f[3] - f[1]
    return [(b[0] - f[0]) / dx, (f[3] - b[3]) / dy, (b[2] - b[0]) / dx, (b[3] - b[1]) / dy]
}

/** A square of the given area around a point — the fallback when no extent was kept. */
export function areaBox(lat, lon, m2, minSide = 60) {
    const side = Math.max(minSide, Math.sqrt(Math.max(0, +m2 || 0)))
    const dLat = side / 2 / 110574
    const dLon = side / 2 / (111320 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)))
    return [lon - dLon, lat - dLat, lon + dLon, lat + dLat]
}

export function sizeText(m2) {
    const a = +m2
    if (!a) return null
    if (a >= 10000) { const ha = a / 10000; return `${ha < 10 ? ha.toFixed(1) : Math.round(ha)} ha` }
    return `${Math.round(a).toLocaleString("en-GB")} m²`
}

export function dayText(iso) {
    if (!iso) return null
    const d = new Date(String(iso).length <= 10 ? `${iso}T00:00:00Z` : iso)
    return Number.isNaN(d.getTime()) ? null : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

/** "Possible tent or vehicle group · 4.0 ha · 11 Oct" */
export function findingCaption(f) {
    return [f?.label, f?.size || sizeText(f?.area_m2), dayText(f?.date)].filter(Boolean).join(" · ")
}

/** The map's shorter wording for a label ("Radar: returns gone"). Pure. */
export function shortLabel(f) {
    const l = String(f?.label || "")
    return l.replace(/^Radar change — new bright returns$/, "Radar: new returns")
        .replace(/^Radar change — returns gone \(darker\)$/, "Radar: returns gone")
}

/** On a map, "what · size · date" for the few that matter most; the rest are
 *  boxes whose caption appears close in (or on tap). Red first, then by size. Pure. */
export const MAP_LABELS = 6
export function labelRanks(findings) {
    const order = [...(findings || [])].map((f, i) => ({ f, i }))
        .sort((a, b) => (a.f.tone === "red" ? 0 : 1) - (b.f.tone === "red" ? 0 : 1) || (+b.f.area_m2 || 0) - (+a.f.area_m2 || 0) || a.i - b.i)
    const rank = new Map()
    order.forEach(({ f }, k) => rank.set(f.id, k))
    return rank
}
export function mapCaption(f) {
    return [shortLabel(f), f?.size || sizeText(f?.area_m2), dayText(f?.date)].filter(Boolean).join(" · ")
}

/** The alert's own fields: the row's raw_json holds the whole alert as written,
 *  with what the producer put in raw_json one level down. */
export function alertRaw(a) {
    const r = a?.raw_json && typeof a.raw_json === "object" ? a.raw_json : {}
    return r.raw_json && typeof r.raw_json === "object" ? { ...r, ...r.raw_json } : r
}

/** Any finding shape (the API's, a sweep's raw finding, a radar "where") → the API's. */
export function normalizeFinding(f, i = 0, ctx = {}) {
    if (!f) return null
    const lat = num(f.lat ?? f.centroid_lat), lon = num(f.lon ?? f.centroid_lon)
    if (lat === null || lon === null) return null
    if (f.label && asBounds(f.box)) return { ...f, box: asBounds(f.box) }
    const sweep = f.kind && SWEEP_LABEL[f.kind] !== undefined
    const area = sweep ? (+f.appeared_m2 || 0) + (+f.cleared_m2 || 0) : +f.area_m2 || 0
    const box = asBounds(f.box)
    const dir = f.direction || f.change_direction
    const label = sweep ? SWEEP_LABEL[f.kind]
        : dir === "removed" ? "Radar change — returns gone (darker)" : dir ? "Radar change — new bright returns"
        : f.label || "Finding"
    return {
        id: f.id || `${ctx.kind || (sweep ? "sweep" : "chg")}:${ctx.zoneId || "x"}:${i}`,
        kind: sweep ? "sweep_find" : dir ? "radar_change" : (f.kind || "finding"),
        label, lat, lon, area_m2: area || null, size: sizeText(area),
        box: box || areaBox(lat, lon, area),
        box_source: box ? (f.box_source || "pixel_extent") : "area_estimate",
        tone: sweep ? (f.kind === "new tent/vehicle cluster" ? "red" : "amber") : dir === "removed" ? "amber" : "red",
        date: ctx.date || f.date || null, zone_id: ctx.zoneId || f.zone_id || null, scan_id: ctx.scanId || f.scan_id || null,
    }
}

/** The zone a notification is about, when it is an imagery finding (else null). */
export function findingZoneOf(a) {
    if (!a) return null
    const raw = alertRaw(a)
    const z = a.zoneId || a.zone_id || raw.zone_id
    if (z) return String(z)
    const et = a.entityType || a.entity_type, eid = a.entityId || a.entity_id
    if (FINDING_TYPES.has(et) && eid) return String(eid)
    const m = String(a.alertId || a.alert_id || a.id || "").match(/^RCHG-(ZONE-\d+)-/)
    return m ? m[1] : null
}

/** Is this alert / notification an imagery finding (sweep, radar change, imagery signal)? */
export function isFindingAlert(a) {
    if (!a) return false
    const t = a.alertType || a.alert_type
    const et = a.entityType || a.entity_type
    const kind = alertRaw(a).kind
    return t === "Imagery signal" || FINDING_TYPES.has(et) || kind === "sweep_find" || kind === "radar_change"
        || /^RCHG-/.test(String(a.alertId || a.alert_id || a.id || ""))
}

/** The findings an alert itself carries, boxed (older alerts: from their centroid and area). */
export function findingsFromAlert(a) {
    const raw = alertRaw(a)
    const zoneId = findingZoneOf(a)
    const date = raw.captured || raw.change?.until || (a?.created_at ? String(a.created_at).slice(0, 10) : null)
    const list = Array.isArray(raw.findings) && raw.findings.length ? raw.findings
        : Array.isArray(raw.change?.where) ? raw.change.where : []
    return list.map((f, i) => normalizeFinding(f, i, { zoneId, date, scanId: raw.scan_id })).filter(Boolean)
}

/** The box around all of them, or null. */
export function findingsBounds(findings) {
    const bs = (findings || []).map((f) => asBounds(f.box)).filter(Boolean)
    if (!bs.length) return null
    return [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])),
            Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))]
}

/** Camera height that frames a box (metres), never closer than a few km. */
export function altitudeFor(box) {
    const b = asBounds(box)
    if (!b) return 20000
    const lat = (b[1] + b[3]) / 2
    const spanM = Math.max((b[3] - b[1]) * 110574, (b[2] - b[0]) * 111320 * Math.cos((lat * Math.PI) / 180))
    return Math.min(400000, Math.max(4000, spanM * 2.6))
}

/** A finding as one of the Imagery viewer's outlines, placed on a frame. */
export function findingToOutline(f, frameBounds, { alwaysLabel = true } = {}) {
    const bbox = boxToFrame(f.box, frameBounds)
    if (!bbox) return null
    return { id: `finding-${f.id}`, label: f.label, caption: mapCaption(f), bbox, type: "finding", alwaysLabel,
             color: TONE[f.tone] || TONE.amber, estimate: f.box_source === "area_estimate", conf: null, finding: f }
}

/** All of a zone's findings as outlines, captioned in full only for the most
 *  telling few (the rest when zoomed in, or selected). Pure. */
export function findingOutlines(findings, frameBounds) {
    const ranks = labelRanks(findings)
    return (findings || []).map((f) => findingToOutline(f, frameBounds, { alwaysLabel: (ranks.get(f.id) ?? 99) < MAP_LABELS }))
        .filter(Boolean)
}

// ── the store: which findings are on show ─────────────────────────────────
let shown = null
const subs = new Set()

/** Put findings on the maps: {zoneId, findings, title, focusId, fit}. null clears. */
export function showFindings(s) {
    shown = s && Array.isArray(s.findings) && s.findings.length ? { ...s, at: Date.now() } : null
    if (typeof window !== "undefined") window.__plxFindings = shown
    for (const fn of [...subs]) { try { fn(shown) } catch { /* one map failing must not stop the other */ } }
    return shown
}
export const clearFindings = () => showFindings(null)
export const getShownFindings = () => shown
export function subscribeFindings(fn) {
    subs.add(fn)
    return () => subs.delete(fn)
}

// ── the API ────────────────────────────────────────────────────────────────
async function getJson(path) {
    const r = await fetch(`${API_BASE}${path}`, { credentials: "include" })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(typeof d?.detail === "string" ? d.detail : `HTTP ${r.status}`)
    return d
}

/** GET /api/watch-zones/{id}/findings → {zone, findings, counts}. */
export function fetchFindings(zoneId, { scanId = null, days = 30 } = {}) {
    const q = new URLSearchParams({ days: String(days) })
    if (scanId) q.set("scan_id", scanId)
    return getJson(`/api/watch-zones/${encodeURIComponent(zoneId)}/findings?${q}`)
}

/** A cut-out of the newest image around a box → {image_b64, box, date, instrument} or {image_b64: null, why}. */
export function fetchCrop(zoneId, box) {
    const b = asBounds(box)
    return getJson(`/api/watch-zones/${encodeURIComponent(zoneId)}/findings/crop?box=${b.map((v) => v.toFixed(6)).join(",")}`)
}

/**
 * The findings to show for an alert: the zone's own list for that scan (it
 * holds real extents for old findings too), else what the alert carried.
 */
export async function findingsForAlert(a) {
    const zoneId = findingZoneOf(a)
    const own = findingsFromAlert(a)
    if (!zoneId) return { zoneId: null, findings: own, zone: null }
    try {
        const scanId = alertRaw(a).scan_id || null
        let d = await fetchFindings(zoneId, { scanId })
        if (!d?.findings?.length && scanId) d = await fetchFindings(zoneId)
        if (d?.findings?.length) return { zoneId, findings: d.findings, zone: d.zone }
        return { zoneId, findings: own, zone: d?.zone || null }
    } catch {
        return { zoneId, findings: own, zone: null }
    }
}
