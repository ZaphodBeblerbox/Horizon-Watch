// Thin, real fetch wrappers for the Report endpoints this destination uses.
// Centralized here (rather than re-hand-rolling fetch+headers in every
// component, the way ForgePanel.jsx's original TaskList/TaskStatusBar code
// did) so ReadingWorkspace/EditingWorkspace/ReportWorkspace share one real
// implementation of each call. Uses src/auth.js's apiFetch() (real
// Authorization header + timeout handling), same as the rest of the
// post-Round-2 app — not a second auth mechanism.
import { apiFetch } from "../auth.js"

async function asJson(res) {
    let body = null
    try { body = await res.json() } catch { /* no body */ }
    if (!res.ok) {
        const detail = (body && body.detail) || res.statusText || "Request failed"
        throw new Error(detail)
    }
    return body
}

export function getReport(reportId) {
    return apiFetch(`/api/reports/${reportId}`).then(asJson)
}

export function getReportSections(reportId) {
    return apiFetch(`/api/reports/${reportId}/sections`).then(asJson)
}

export function patchReport(reportId, patch) {
    return apiFetch(`/api/reports/${reportId}`, { method: "PATCH", body: JSON.stringify(patch) }).then(asJson)
}

export function submitReportForReview(reportId) {
    return apiFetch(`/api/reports/${reportId}/submit-for-review`, { method: "POST" }).then(asJson)
}

export function approveReport(reportId, body = {}) {
    return apiFetch(`/api/reports/${reportId}/approve`, { method: "POST", body: JSON.stringify(body) }).then(asJson)
}

export function rejectReport(reportId, body = {}) {
    return apiFetch(`/api/reports/${reportId}/reject`, { method: "POST", body: JSON.stringify(body) }).then(asJson)
}

export function publishReport(reportId) {
    return apiFetch(`/api/reports/${reportId}/publish`, { method: "POST" }).then(asJson)
}

/** Downloads the real PDF export as a blob and triggers a client-side save —
 * GET /api/reports/{id}/pdf returns raw PDF bytes (see backend/main.py). */
export async function downloadReportPdf(reportId) {
    const res = await apiFetch(`/api/reports/${reportId}/pdf`)
    if (!res.ok) throw new Error(`PDF export failed (${res.status})`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${reportId}.pdf`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export function getReportTask(taskId) {
    return apiFetch(`/api/reports/tasks/${taskId}`).then(asJson)
}

/** Generic ReportTask action — path is one of "/finish-collection", "/draft",
 * "/archive", matching TaskStatusBar's onAction(actionPath, body) contract. */
export function runTaskAction(taskId, path, body) {
    return apiFetch(`/api/reports/tasks/${taskId}${path}`, {
        method: "POST",
        body: JSON.stringify(body || {}),
    }).then(asJson)
}
