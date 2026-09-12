// collabApi.js — real, thin fetch wrappers for the Workstation round's
// collaboration primitives (Part 8: comments/@mention, assignment,
// presence). Same real-fetch-wrapper pattern casesApi.js/reportApi.js
// already established — one real implementation, not re-hand-rolled
// fetch+headers per component. Every write here requires the real
// session cookie server-side (backend/main.py's _require_current_user).
import API_BASE from "../apiBase.js"

async function req(path, opts) {
    const r = await fetch(`${API_BASE}${path}`, {
        headers: { "Content-Type": "application/json" },
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

const qs = (params) => `?${new URLSearchParams(params)}`

export const listComments = (recordRef) => req(`/api/comments${qs({ record_ref: recordRef })}`)
export const createComment = (recordRef, body, mentionedUserIds) =>
    req("/api/comments", { method: "POST", body: JSON.stringify({ record_ref: recordRef, body, mentioned_user_ids: mentionedUserIds }) })
export const resolveComment = (commentId) => req(`/api/comments/${encodeURIComponent(commentId)}/resolve`, { method: "POST" })
export const reopenComment = (commentId) => req(`/api/comments/${encodeURIComponent(commentId)}/reopen`, { method: "POST" })

export const getAssignment = (recordRef) => req(`/api/assignments${qs({ record_ref: recordRef })}`)
export const createAssignment = (recordRef, assigneeUserId, dueAt) =>
    req("/api/assignments", { method: "POST", body: JSON.stringify({ record_ref: recordRef, assignee_user_id: assigneeUserId, due_at: dueAt }) })
export const markAssignmentDone = (assignmentId) => req(`/api/assignments/${encodeURIComponent(assignmentId)}/done`, { method: "POST" })

export const listActivity = (recordRef) => req(`/api/activity${qs({ record_ref: recordRef })}`)

// Real presence heartbeat — polled, not push-based (see backend/main.py's
// own comment on why: no live-update channel to the browser exists
// anywhere in this app). Callers must label this "viewing now" or
// similar, never "live".
export const presenceHeartbeat = (recordRef) => req(`/api/presence${qs({ record_ref: recordRef })}`, { method: "POST" })
export const getPresence = (recordRef) => req(`/api/presence${qs({ record_ref: recordRef })}`)
