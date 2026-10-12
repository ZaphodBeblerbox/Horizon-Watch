/**
 * findingOverlay.js — the IMAGE a finding was noticed in, laid on the map
 * under its boxes (owner, 2026-10-12: "I now have the detection polygon on
 * the map but NOT the original satellite image where it was noticed").
 *
 * Follows the findings store (lib/findings.js): whenever findings are put on
 * show, the image of the one in focus (else the first) is fetched —
 *   radar change / sweep find   the comparison's own Before / After / Change
 *                               (backend/radar_images.py), with their bounds
 *   anything else with a scan   the optical pass (/api/imagery/scenes/{id})
 *                               and its previous pass, over the zone's bbox
 *                               (every scene of a zone is fetched over it)
 * — and cleared when they are. Radar images not kept yet: status "missing"
 * with what fetching them again costs; loadOverlayRadar() asks for them.
 *
 * Drawn by the desktop globe (globe/GlobeFindingsLayer.jsx, a Cesium
 * SingleTileImageryProvider on the bounds) and the phone map
 * (mobile/findingsLeaflet.js, an L.imageOverlay), each with After / Before /
 * Change and an opacity slider. Pure helpers first (findingOverlay.test.js).
 */
import API_BASE from "../apiBase.js"
import { authHeaders } from "../auth.js"
import {
    asBounds, fetchFindings, fetchRadarImages, findingSource, getShownFindings, isRadarFinding,
    startRadarImages, subscribeFindings,
} from "./findings.js"

export const OVERLAY_VIEWS = {
    radar: [["After", "after"], ["Before", "before"], ["Change", "change"]],
    optical: [["This pass", "after"], ["Previous pass", "before"]],
}
export const DEFAULT_OPACITY = 0.85

/** The image type a base64 payload is (radar PNGs, optical JPEGs). Pure. */
export function b64Mime(b64) {
    const s = String(b64 || "")
    if (s.startsWith("/9j/")) return "image/jpeg"
    if (s.startsWith("UklGR")) return "image/webp"
    if (s.startsWith("R0lGOD")) return "image/gif"
    return "image/png"
}

/** The finding whose image is laid down: the one in focus, else a radar one, else any with a scan. Pure. */
export function overlayFinding(shown) {
    const fs = Array.isArray(shown?.findings) ? shown.findings : []
    return fs.find((f) => f.id === shown.focusId && f.scan_id)
        || fs.find((f) => f.scan_id && isRadarFinding(f))
        || fs.find((f) => f.scan_id) || null
}

/** Which image that is ("ZONE-005|radar:<scan>"), or null. Pure. */
export function overlayKey(shown) {
    const f = overlayFinding(shown)
    const z = shown?.zoneId || f?.zone_id
    return f && z ? `${z}|${findingSource(f)}` : null
}

/** The views an overlay can switch between (only those with an image). Pure. */
export function viewsFor(ov) {
    if (!ov || ov.status !== "ready") return []
    return (OVERLAY_VIEWS[ov.kind] || []).filter(([, k]) => !!ov.layers?.[k])
}

/** Leaflet's [[south, west], [north, east]] for [w, s, e, n] (or any asBounds shape). Pure. */
export function leafletImageBounds(b) {
    const x = asBounds(b)
    return x ? [[x[1], x[0]], [x[3], x[2]]] : null
}

/** {west, south, east, north} in degrees for Cesium's Rectangle.fromDegrees. Pure. */
export function cesiumRectDegrees(b) {
    const x = asBounds(b)
    return x ? { west: x[0], south: x[1], east: x[2], north: x[3] } : null
}

/** Does the image cover every box (a check that the georeference is the right one)? Pure. */
export function coversFindings(bounds, findings, slack = 1e-6) {
    const b = asBounds(bounds)
    if (!b) return false
    return (findings || []).every((f) => {
        const x = asBounds(f.box)
        return !x || (x[0] >= b[0] - slack && x[1] >= b[1] - slack && x[2] <= b[2] + slack && x[3] <= b[3] + slack)
    })
}

export const clampOpacity = (v) => (Number.isFinite(+v) && v !== null && v !== "" ? Math.min(1, Math.max(0, +v)) : DEFAULT_OPACITY)

// ── the fetches (replaceable in tests) ─────────────────────────────────────
async function sceneOf(scanId) {
    let headers = {}
    try { headers = authHeaders() } catch { /* no storage */ }
    // the bearer too: cross-site (the web page, the API elsewhere) the cookie is not sent
    const r = await fetch(`${API_BASE}/api/imagery/scenes/${encodeURIComponent(scanId)}`, { credentials: "include", headers })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(typeof d?.detail === "string" ? d.detail : `HTTP ${r.status}`)
    return d
}
let deps = {
    radar: fetchRadarImages,
    start: startRadarImages,
    scene: sceneOf,
    zone: async (zoneId) => (await fetchFindings(zoneId, { days: 1 }))?.zone || null,
    pollMs: 3000,
}
/** Test seam. */
export function __setOverlayDeps(d) { deps = { ...deps, ...d } }

// ── the store ──────────────────────────────────────────────────────────────
let st = null            // {key, status, kind, bounds, layers, why, …}
let view = "after"
let opacity = DEFAULT_OPACITY
let token = 0
let timer = null
let urls = {}
const subs = new Set()
let wired = false

const snapshot = () => (st ? { ...st, view: st.layers?.[view] ? view : "after", opacity } : null)
function emit() {
    const s = snapshot()
    if (typeof window !== "undefined") window.__plxFindingOverlay = s && { ...s, layers: s.layers ? Object.keys(s.layers) : null }
    for (const fn of [...subs]) { try { fn(s) } catch { /* one map failing must not stop the other */ } }
}
function revoke() {
    for (const u of Object.values(urls)) { try { if (String(u).startsWith("blob:")) URL.revokeObjectURL(u) } catch { /* gone */ } }
    urls = {}
}

/** A URL for one of the overlay's images (made once, revoked when the overlay goes). */
export function overlayUrl(which) {
    const b64 = st?.layers?.[which]
    if (!b64) return null
    if (urls[which]) return urls[which]
    const mime = b64Mime(b64)
    try {
        if (typeof URL !== "undefined" && URL.createObjectURL && typeof Blob !== "undefined" && typeof atob === "function") {
            const bin = atob(b64)
            const bytes = new Uint8Array(bin.length)
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
            urls[which] = URL.createObjectURL(new Blob([bytes], { type: mime }))
            return urls[which]
        }
    } catch { /* fall back to a data URL */ }
    urls[which] = `data:${mime};base64,${b64}`
    return urls[which]
}

function set(next) {
    if (!next || next.key !== st?.key) revoke()
    st = next
    emit()
}

async function resolve(shown, key, my) {
    const f = overlayFinding(shown)
    const zoneId = shown.zoneId || f.zone_id
    const alive = () => my === token
    try {
        if (isRadarFinding(f)) {
            const d = await deps.radar(zoneId, f.scan_id)
            if (!alive()) return
            if (d?.status === "ready") {
                const bounds = asBounds(d.bounds)
                if (!bounds) { set({ key, status: "none", why: "The radar images came without their place on the ground." }); return }
                set({ key, status: "ready", kind: "radar", zoneId, scanId: f.scan_id, bounds,
                      layers: { after: d.after_b64 || null, before: d.before_b64 || null, change: d.change_b64 || null },
                      datesBefore: d.dates_before || null, datesAfter: d.dates_after || null })
                return
            }
            set({ key, status: d?.status || "missing", kind: "radar", zoneId, scanId: f.scan_id,
                  why: d?.why || d?.error || null, requests: d?.requests ?? null, regenerable: !!d?.regenerable,
                  done: d?.done ?? null, total: d?.total ?? null })
            if (d?.status === "running") timer = setTimeout(() => { if (alive()) resolve(shown, key, my) }, deps.pollMs)
            return
        }
        const [d, zone] = await Promise.all([deps.scene(f.scan_id), shown.zone?.bbox ? shown.zone : deps.zone(zoneId).catch(() => null)])
        if (!alive()) return
        const bounds = asBounds(zone?.bbox)
        if (!d?.image_b64 || !bounds) {
            set({ key, status: "none", kind: "optical", why: !d?.image_b64 ? "This pass's image has been retired." : "The area's outline is not known." })
            return
        }
        set({ key, status: "ready", kind: "optical", zoneId, scanId: f.scan_id, bounds,
              layers: { after: d.image_b64, before: d.reference_image_b64 || null },
              dateAfter: d.scan?.image_timestamp_utc || null, dateBefore: d.reference_date || null })
    } catch (e) {
        if (alive()) set({ key, status: "failed", why: e instanceof TypeError ? "The server did not answer." : e?.message || "The image could not be fetched." })
    }
}

function onFindings(shown) {
    const key = overlayKey(shown)
    if (key && key === st?.key && st.status !== "failed") return
    token += 1
    clearTimeout(timer)
    if (!key) { view = "after"; set(null); return }
    view = "after"
    set({ key, status: "loading" })
    resolve(shown, key, token)
}

function wire() {
    if (wired) return
    wired = true
    subscribeFindings(onFindings)
    onFindings(getShownFindings())
}

/** Follow the overlay (called with the snapshot, or null when there is none). */
export function subscribeOverlay(fn) {
    wire()
    subs.add(fn)
    try { fn(snapshot()) } catch { /* the subscriber's problem */ }
    return () => subs.delete(fn)
}
export const getOverlay = () => snapshot()

export function setOverlayView(v) {
    if (!st?.layers?.[v]) return
    view = v
    emit()
}
export function setOverlayOpacity(v) {
    opacity = clampOpacity(v)
    emit()
}

/** Fetch an older radar comparison's images again (costs Sentinel Hub requests; asked for by a person). */
export async function loadOverlayRadar() {
    if (!st || st.kind !== "radar" || !st.zoneId || !st.scanId || st.status === "ready") return
    const key = st.key, my = token
    set({ ...st, status: "running", done: 0, total: st.requests ?? null, why: null })
    try {
        await deps.start(st.zoneId, st.scanId)
        if (my !== token) return
        const shown = getShownFindings()
        if (shown && overlayKey(shown) === key) await resolve(shown, key, my)
    } catch (e) {
        if (my === token) set({ ...st, status: "error", why: e?.message || "The radar images could not be fetched." })
    }
}

/** Ask again after a failure (a slow or unreachable server). */
export function retryOverlay() {
    const shown = getShownFindings()
    if (!shown || st?.status !== "failed") return
    st = null
    onFindings(shown)
}

/** Test seam. */
export function __resetOverlay() {
    token += 1
    clearTimeout(timer)
    revoke()
    st = null
    view = "after"
    opacity = DEFAULT_OPACITY
}
