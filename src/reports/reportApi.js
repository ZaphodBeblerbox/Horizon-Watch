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

export function getXrefIndex(reportId) {
    return apiFetch(`/api/reports/${reportId}/xref-index`).then(asJson)
}

/** Real ontology objects + relationships behind this report's evidence set —
 * the print layout's Appendix A (backend/main.py's get_report_link_analysis,
 * implementation manual v1.0 §7). */
export function getLinkAnalysis(reportId) {
    return apiFetch(`/api/reports/${reportId}/link-analysis`).then(asJson)
}

// Real, in-memory prefetch cache — one shared promise per reportId across
// every caller (Generate.jsx, Briefings.jsx, PrintLayout.jsx), so "build the
// print pages eagerly, at generation time" (implementation manual v1.0 §2)
// means what it says: the same real fetch Generate.jsx kicks off the moment
// drafting completes is still in flight (or already resolved) by the time
// the reader's "printable briefing" button — or Generate's own — opens
// PrintLayout, instead of a second, independent fetch with a visible loading
// flash. Never a separately-recomputed document; just the same real
// GET calls, deduplicated.
const _reportBundleCache = new Map()

export function prefetchReportBundle(reportId) {
    if (!reportId || _reportBundleCache.has(reportId)) return
    _reportBundleCache.set(reportId, Promise.all([
        getReport(reportId), getReportSections(reportId),
        getXrefIndex(reportId).catch(() => null),
        getLinkAnalysis(reportId).catch(() => null),
    ]).then(([report, sections, xrefIndex, linkAnalysis]) => ({ report, sections, xrefIndex, linkAnalysis })))
}

/** Same real bundle prefetchReportBundle() populates — call this from any
 * view that needs the data; it starts the real fetch itself if nothing
 * already kicked it off. */
export function getReportBundle(reportId) {
    prefetchReportBundle(reportId)
    return _reportBundleCache.get(reportId)
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

/** "Generate Snapshot Report" — creates a real ReportTask that captures its
 * scope's intelligence picture immediately instead of over a scheduled
 * window; lands directly on ready_to_draft (see backend/main.py's
 * create_snapshot_report_task()). `watchZoneId` (optional): a real, enabled
 * WatchZone's system_id to scope to; omit for the global/all-active-regions
 * fallback. */
export function createSnapshotReportTask({ focus, watchZoneId } = {}) {
    return apiFetch("/api/reports/tasks/snapshot", {
        method: "POST",
        body: JSON.stringify({ focus: focus || null, watch_zone_id: watchZoneId || null }),
    }).then(asJson)
}

/** Real, enabled Watch Areas (WatchZone rows) an analyst can scope a
 * Snapshot Report to — same GET /api/watch-zones the Intel destination's
 * Watch Areas tab already lists from. */
export function listWatchZones() {
    return apiFetch("/api/watch-zones").then(asJson)
}

/** Real asset-register proximity scoring for a task's frozen evidence set —
 * backend/asset_exposure.py. A genuinely separate, separately-timed stage
 * ahead of drafting (Generate rebuild's "Score exposure" checklist step). */
export function scoreTaskExposure(taskId) {
    return apiFetch(`/api/reports/tasks/${taskId}/exposure`, { method: "POST" }).then(asJson)
}

export function listReports(status) {
    const qs = status && status !== "all" ? `?status=${encodeURIComponent(status)}` : ""
    return apiFetch(`/api/reports${qs}`).then(asJson)
}
