/**
 * fieldReports.js — USER REPORTS on the client (owner, 2026-10-24): what somebody reports seeing on the ground,
 * shown on both maps until it expires. Server: backend/field_reports.py, /api/field-reports.
 *
 *   api            listReports / createReport / updateReport / endReport / deleteReport / uploadReportPhoto
 *   KIND_LIST      the kinds in the server's order, with label, glyph and default expiry (lib/mapIcons.js REPORT_KINDS)
 *   EXPIRY_CHIPS   1 h / 2 h / 6 h / 12 h / 24 h (and custom, up to MAX_EXPIRY_H)
 *   reportActive   not ended, not expired at `now` (the server says so too; the map re-checks on a timer)
 *   reportFeatures the phone map's features (mobile/mapLayers.js 'userReports')
 *   words          whenWords / expiryWords / reportLines for the marker card
 *   changes        notifyReportsChanged / subscribeReports: a new or ended report redraws both maps at once
 */
import API_BASE from "../apiBase.js"
import { REPORT_KINDS, reportIcon, reportMarker, ICON_PX } from "./mapIcons.js"
import { uploadDeskFile } from "./deskApi.js"

export { REPORT_KINDS, reportIcon, reportMarker }
export const REPORTS_PATH = "/api/field-reports"
export const REFRESH_MS = 60_000
export const MAX_EXPIRY_H = 72
export const EXPIRY_CHIPS = [1, 2, 6, 12, 24]
export const KIND_LIST = Object.entries(REPORT_KINDS).map(([kind, k]) => ({ kind, ...k }))
export const AUDIENCE_LABEL = { company: "Your company", everyone: "Everyone", people: "Named people" }

const enc = encodeURIComponent

async function req(path, opts = {}) {
    const r = await fetch(`${API_BASE}${path}`, {
        headers: { "Content-Type": "application/json" }, credentials: "include", ...opts,
    })
    if (!r.ok) {
        let detail = `HTTP ${r.status}`
        try { const b = await r.json(); if (b?.detail) detail = typeof b.detail === "string" ? b.detail : JSON.stringify(b.detail) } catch { /* no body */ }
        const e = new Error(detail); e.status = r.status
        throw e
    }
    return r.json()
}

/** The active reports this user may read. `bounds` {south, west, north, east} narrows them to the view. */
export async function listReports({ bounds = null } = {}) {
    const q = new URLSearchParams()
    if (bounds && [bounds.south, bounds.west, bounds.north, bounds.east].every(Number.isFinite)) {
        for (const k of ["south", "west", "north", "east"]) q.set(k, String(bounds[k]))
    }
    const s = q.toString()
    const d = await req(`${REPORTS_PATH}${s ? `?${s}` : ""}`)
    return Array.isArray(d?.reports) ? d.reports : []
}
export const createReport = (body) => req(REPORTS_PATH, { method: "POST", body: JSON.stringify(body) }).then((r) => { notifyReportsChanged(); return r })
export const updateReport = (id, changes) => req(`${REPORTS_PATH}/${enc(id)}`, { method: "PATCH", body: JSON.stringify(changes) }).then((r) => { notifyReportsChanged(); return r })
export const endReport = (id) => req(`${REPORTS_PATH}/${enc(id)}/end`, { method: "POST" }).then((r) => { notifyReportsChanged(); return r })
export const deleteReport = (id) => req(`${REPORTS_PATH}/${enc(id)}`, { method: "DELETE" }).then((r) => { notifyReportsChanged(); return r })

/** A photo or video for a report: the desk's upload (POST /api/desk/files), then its path in the report's media. */
export async function uploadReportPhoto(file) {
    const f = await uploadDeskFile(file)
    return { path: f.path, type: String(f.mime || "").startsWith("video/") ? "video" : "image", mime: f.mime, name: f.name }
}

/** A media item's address in the page: the server's own paths get the API base. */
export const mediaUrl = (m) => (m?.url && m.url.startsWith("/") ? `${API_BASE}${m.url}` : m?.url || null)

// ── building a create body ──────────────────────────────────────────────────
export const defaultExpiryH = (kind) => (REPORT_KINDS[kind] || REPORT_KINDS.other).expiryH

/** Hours from a chip or a typed value: a positive number up to MAX_EXPIRY_H, else null. */
export function cleanHours(v) {
    const h = Number(String(v ?? "").replace(",", "."))
    if (!Number.isFinite(h) || h <= 0) return null
    return Math.min(MAX_EXPIRY_H, h)
}

/**
 * The POST body from the form: { kind, title, note?, lat, lon, place?, expires_in_h, audience, media? }.
 * Throws an Error a person can read when the form is not complete.
 */
export function buildReportBody({ kind, title = "", note = "", lat, lon, place = "", expiresInH = null, audience = "company", media = [] } = {}) {
    if (!REPORT_KINDS[kind]) throw new Error("Pick what you saw")
    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) throw new Error("Put the pin where it is")
    const h = expiresInH == null ? defaultExpiryH(kind) : cleanHours(expiresInH)
    if (h == null) throw new Error(`Expiry is a number of hours, up to ${MAX_EXPIRY_H}`)
    const p = String(place || "").trim()
    const t = String(title || "").trim() || (p ? `${REPORT_KINDS[kind].label} at ${p}` : REPORT_KINDS[kind].label)
    const body = { kind, title: t.slice(0, 120), lat: Number(Number(lat).toFixed(6)), lon: Number(Number(lon).toFixed(6)), expires_in_h: h, audience }
    if (p) body.place = p.slice(0, 200)
    if (String(note || "").trim()) body.note = String(note).trim().slice(0, 1000)
    if (Array.isArray(media) && media.length) body.media = media.slice(0, 4)
    return body
}

// ── reading ─────────────────────────────────────────────────────────────────
const ms = (v) => { const t = Date.parse(v || ""); return Number.isFinite(t) ? t : NaN }

/** Still on the map at `now`: not ended, and its expiry not passed. */
export function reportActive(r, now = Date.now()) {
    if (!r || r.ended_at) return false
    const e = ms(r.expires_at)
    return Number.isFinite(e) && e > now
}

function span(minutes) {
    const m = Math.max(0, Math.round(minutes))
    if (m < 60) return `${m} min`
    const h = Math.floor(m / 60), rest = m % 60
    if (h >= 24 && rest === 0 && h % 24 === 0) return `${h / 24} d`
    return rest && h < 6 ? `${h} h ${rest} min` : `${Math.round(m / 60)} h`
}
/** "12 min ago", "2 h ago". */
export function whenWords(iso, now = Date.now()) {
    const t = ms(iso)
    if (!Number.isFinite(t)) return ""
    const m = (now - t) / 60_000
    return m < 1 ? "just now" : `${span(m)} ago`
}
/** "Expires in 1 h 20 min", "Ended", "Expired". */
export function expiryWords(r, now = Date.now()) {
    if (r?.ended_at) return "Ended"
    const e = ms(r?.expires_at)
    if (!Number.isFinite(e)) return ""
    return e <= now ? "Expired" : `Expires in ${span((e - now) / 60_000)}`
}
/** The marker card's lines: who and when, the expiry. */
export function reportLines(r, now = Date.now()) {
    const who = r?.label || `Reported by ${r?.author?.name || "a user"}, unverified`
    return { title: r?.title || REPORT_KINDS[r?.kind]?.label || "Report", who, when: whenWords(r?.occurred_at, now), expiry: expiryWords(r, now) }
}

/** The phone map's features for the 'userReports' layer (one typology; the shared collision pass). */
export function reportFeatures(reports, now = Date.now()) {
    return (Array.isArray(reports) ? reports : []).filter((r) => reportActive(r, now) && Number.isFinite(+r.lat) && Number.isFinite(+r.lon)).map((r) => {
        const c = reportLines(r, now)
        const k = REPORT_KINDS[r.kind] || REPORT_KINDS.other
        return {
            id: `fr-${r.id}`, lat: +r.lat, lon: +r.lon, size: ICON_PX, collide: true, pri: k.priority,
            iconUri: reportIcon(r.kind), title: c.title, sub: `${c.who} · ${c.expiry}`, severity: null,
            raw: { ...r, kind: "field_report", report_kind: r.kind, headline: c.title, layerLabel: "User report", published_at: r.occurred_at },
        }
    })
}

// ── changes: a new or ended report redraws both maps now ────────────────────
export const CHANGED_EVENT = "plx:field-reports-changed"
export function notifyReportsChanged() {
    try { window.dispatchEvent(new CustomEvent(CHANGED_EVENT)) } catch { /* no window (tests) */ }
}
export function subscribeReports(cb) {
    if (typeof window === "undefined") return () => {}
    window.addEventListener(CHANGED_EVENT, cb)
    return () => window.removeEventListener(CHANGED_EVENT, cb)
}
/** Open the report form (desktop): at a point, or at the map's centre when none is given. */
export const OPEN_EVENT = "plx:field-report-open"
export function openReportForm(at = null) {
    try { window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: at })) } catch { /* no window */ }
}
