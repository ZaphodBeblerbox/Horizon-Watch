// casesApi.js — real, thin fetch wrappers for Cases/RFIs/Users (Workstation
// round, §7.4/§7.6/§7.7). Same real-fetch-wrapper pattern reportApi.js and
// sessionStore.js already established — one real implementation, not
// re-hand-rolled fetch+headers per component.
import API_BASE from "../apiBase.js"

async function req(path, opts) {
    const r = await fetch(`${API_BASE}${path}`, {
        headers: { "Content-Type": "application/json" },
        // Real authentication round — case-approval advance and RFI answer
        // now require the real session cookie server-side; sending
        // credentials here is what makes that actually reach the backend
        // cross-origin (see backend/main.py's _cookie_kwargs()).
        credentials: "include",
        ...opts,
    })
    if (!r.ok) {
        let detail = `HTTP ${r.status}`
        try { const body = await r.json(); if (body?.detail) detail = body.detail } catch { /* no body */ }
        throw new Error(detail)
    }
    return r.json()
}

export const listUsers = () => req("/api/users")

export const listCases = () => req("/api/cases")
export const getCase = (caseId) => req(`/api/cases/${encodeURIComponent(caseId)}`)
export const createCase = (data) => req("/api/cases", { method: "POST", body: JSON.stringify(data) })
export const deleteCase = (caseId) =>
    req(`/api/cases/${encodeURIComponent(caseId)}`, { method: "DELETE" })
export const updateCase = (caseId, data) => req(`/api/cases/${encodeURIComponent(caseId)}`, { method: "PUT", body: JSON.stringify(data) })
export const addCaseRef = (caseId, ref) => req(`/api/cases/${encodeURIComponent(caseId)}/refs`, { method: "POST", body: JSON.stringify({ ref }) })
export const addCaseNote = (caseId, text, authorUserId) =>
    req(`/api/cases/${encodeURIComponent(caseId)}/notes`, { method: "POST", body: JSON.stringify({ text, author_user_id: authorUserId }) })
// Real authentication round — the acting user for both of these is now
// resolved server-side from the real session cookie (backend/main.py's
// _require_current_user()), never a client-supplied field, so neither
// takes a userId param anymore — passing one would just be ignored.
export const advanceCase = (caseId) =>
    req(`/api/cases/${encodeURIComponent(caseId)}/advance`, { method: "POST", body: JSON.stringify({}) })

export const listRfis = (params = {}) => {
    const q = new URLSearchParams(params).toString()
    return req(`/api/rfis${q ? `?${q}` : ""}`)
}
export const createRfi = (data) => req("/api/rfis", { method: "POST", body: JSON.stringify(data) })
export const answerRfi = (rfiId, text) =>
    req(`/api/rfis/${encodeURIComponent(rfiId)}/answer`, { method: "POST", body: JSON.stringify({ text }) })

// ── Case workspace: folders, files, documents, sharing ────────────────────
// Everything here is scoped server-side to the authenticated user (owner or
// an explicit share). There is deliberately no "list everything" call.

export const listNodes  = (caseId) => req(`/api/cases/${encodeURIComponent(caseId)}/nodes`)
export const createNode = (caseId, data) =>
    req(`/api/cases/${encodeURIComponent(caseId)}/nodes`, { method: "POST", body: JSON.stringify(data) })
export const updateNode = (caseId, nodeId, data) =>
    req(`/api/cases/${encodeURIComponent(caseId)}/nodes/${encodeURIComponent(nodeId)}`, { method: "PATCH", body: JSON.stringify(data) })
export const deleteNode = (caseId, nodeId) =>
    req(`/api/cases/${encodeURIComponent(caseId)}/nodes/${encodeURIComponent(nodeId)}`, { method: "DELETE" })
export const getDoc = (caseId, nodeId) =>
    req(`/api/cases/${encodeURIComponent(caseId)}/nodes/${encodeURIComponent(nodeId)}/doc`)

/**
 * File a saved signal or a screenshot into its folder in a case.
 *
 * The server owns the taxonomy (Signals/<type>, Screenshots/<type>) and
 * creates the folders on the way. The client says what the thing IS and
 * lets the tree be the server's business — a client that builds the path
 * itself is a second definition of the filing system, and the two drift.
 */
export const fileSavedItem = (caseId, data) =>
    req(`/api/cases/${encodeURIComponent(caseId)}/file-saved`,
        { method: "POST", body: JSON.stringify(data) })

export const fileUrl = (caseId, nodeId) =>
    `${API_BASE}/api/cases/${encodeURIComponent(caseId)}/files/${encodeURIComponent(nodeId)}`

/** Multipart, so no Content-Type header — the browser must set the boundary. */
export async function uploadFile(caseId, file, parentId = null, onProgress = null) {
    const fd = new FormData()
    fd.append("file", file)
    if (parentId) fd.append("parent_id", parentId)
    fd.append("name", file.name)

    const r = await fetch(`${API_BASE}/api/cases/${encodeURIComponent(caseId)}/files`, {
        method: "POST", credentials: "include", body: fd,
    })
    if (!r.ok) {
        let detail = `HTTP ${r.status}`
        try { const b = await r.json(); if (b?.detail) detail = b.detail } catch { /* no body */ }
        throw new Error(detail)
    }
    onProgress?.(1)
    return r.json()
}

export const listShares = (caseId) => req(`/api/cases/${encodeURIComponent(caseId)}/shares`)
export const addShare = (caseId, userId, canEdit = false) =>
    req(`/api/cases/${encodeURIComponent(caseId)}/shares`, { method: "POST", body: JSON.stringify({ user_id: userId, can_edit: canEdit }) })
export const removeShare = (caseId, userId) =>
    req(`/api/cases/${encodeURIComponent(caseId)}/shares/${encodeURIComponent(userId)}`, { method: "DELETE" })
