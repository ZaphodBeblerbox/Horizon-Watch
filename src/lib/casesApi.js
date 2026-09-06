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
