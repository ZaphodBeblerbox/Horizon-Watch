// mobileApi.js — real fetch wrappers for the mobile companion, sharing the
// real backend + auth mechanism the console uses (src/auth.js's apiFetch —
// never a second auth path), never a mock/local data source.
import { apiFetch, authHeaders } from "../auth.js"
import API_BASE from "../apiBase.js"

async function asJson(res) {
    let body = null
    try { body = await res.json() } catch { /* no body */ }
    if (!res.ok) throw new Error((body && body.detail) || res.statusText || "Request failed")
    return body
}

/** Real GET /api/forge/alerts — confirmed live: returns a plain array of
 * real alert objects directly, never a {alerts:[...]} wrapper. */
export function getForgeAlerts() {
    return apiFetch("/api/forge/alerts").then(asJson)
}

export function acknowledgeAlert(alertId, by) {
    return apiFetch(`/api/alerts/${alertId}/acknowledge`, { method: "POST", body: JSON.stringify({ by }) }).then(asJson)
}

export function escalateAlert(alertId, by) {
    return apiFetch(`/api/alerts/${alertId}/escalate`, { method: "POST", body: JSON.stringify({ by }) }).then(asJson)
}

export function listReports(status) {
    const qs = status && status !== "all" ? `?status=${encodeURIComponent(status)}` : ""
    return apiFetch(`/api/reports${qs}`).then(asJson)
}

export function getReport(reportId) {
    return apiFetch(`/api/reports/${reportId}`).then(asJson)
}

export function getReportSections(reportId) {
    return apiFetch(`/api/reports/${reportId}/sections`).then(asJson)
}

export function getXrefIndex(reportId) {
    return apiFetch(`/api/reports/${reportId}/xref-index`).then(asJson)
}

export function getAisVessels(bbox) {
    const qs = bbox ? `?bbox=${bbox.join(",")}` : ""
    return apiFetch(`/api/ais/vessels${qs}`).then(asJson)
}

export function getAdsb(lat, lon, dist = 2000) {
    return apiFetch(`/adsb?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&dist=${dist}`).then(asJson)
}

/** Real note delivery — multipart so a real voice-note audio Blob can ride
 * along; the response's `status` ("sent"/"failed") reflects a real
 * server-side delivery attempt, never a client-side timer (backend/routers/
 * forge.py's create_desk_note). */
export function sendDeskNote({ route, kind, textContent, referenceKind, referenceId, referenceLabel, audioBlob, audioSeconds, createdBy }) {
    const form = new FormData()
    form.set("route", route)
    form.set("kind", kind)
    form.set("text_content", textContent || "")
    form.set("reference_kind", referenceKind || "")
    form.set("reference_id", referenceId || "")
    form.set("reference_label", referenceLabel || "")
    form.set("created_by", createdBy || "operator")
    form.set("audio_seconds", String(audioSeconds || 0))
    if (audioBlob) form.set("audio", audioBlob, "note.webm")
    // Real fetch, not apiFetch — apiFetch always forces Content-Type:
    // application/json, which would corrupt this multipart body (the
    // browser must set its own multipart boundary). Same real
    // auth-headers-only-for-FormData convention ForgePanel.jsx's own real
    // file upload already establishes (forgeFormHeaders()).
    return fetch(`${API_BASE}/api/forge/notes`, { method: "POST", headers: authHeaders(), body: form }).then(asJson)
}

export function listDeskNotes() {
    return apiFetch("/api/forge/notes").then(asJson)
}
