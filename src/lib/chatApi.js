/**
 * chatApi.js — conversations, members and messages.
 *
 * Thin on purpose. Everything about who may see what is decided by the
 * server from the session, so there is nothing here to get wrong except
 * the shape of a URL.
 */
import API_BASE from "../apiBase.js"

async function req(path, opts) {
    const r = await fetch(`${API_BASE}${path}`, {
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        ...opts,
    })
    if (!r.ok) {
        let detail = `HTTP ${r.status}`
        try { const b = await r.json(); if (b?.detail) detail = b.detail } catch { /* no body */ }
        const e = new Error(detail); e.status = r.status
        throw e
    }
    return r.json()
}

const enc = encodeURIComponent

export const listConversations = () => req("/api/chat/conversations")

export const startConversation = (body) =>
    req("/api/chat/conversations", { method: "POST", body: JSON.stringify(body) })

export const updateConversation = (id, patch) =>
    req(`/api/chat/conversations/${enc(id)}`, { method: "PUT", body: JSON.stringify(patch) })

export const addMembers = (id, userIds) =>
    req(`/api/chat/conversations/${enc(id)}/members`,
        { method: "POST", body: JSON.stringify({ user_ids: userIds }) })

export const removeMember = (id, userId) =>
    req(`/api/chat/conversations/${enc(id)}/members/${enc(userId)}`, { method: "DELETE" })

export const listMessages = (id, { before, limit } = {}) => {
    const q = new URLSearchParams()
    if (before) q.set("before", before)
    if (limit) q.set("limit", String(limit))
    const s = q.toString()
    return req(`/api/chat/conversations/${enc(id)}/messages${s ? `?${s}` : ""}`)
}

export const sendMessage = (id, body) =>
    req(`/api/chat/conversations/${enc(id)}/messages`, { method: "POST", body: JSON.stringify(body) })

export const deleteMessage = (id, messageId) =>
    req(`/api/chat/conversations/${enc(id)}/messages/${enc(messageId)}`, { method: "DELETE" })

export const markRead = (id) =>
    req(`/api/chat/conversations/${enc(id)}/read`, { method: "POST" })

export const unreadTotal = () => req("/api/chat/unread")

export const chatPeople = () => req("/api/chat/people")

/* ── attachments ───────────────────────────────────────────────────────
   The upload is multipart, so it does NOT go through req(): setting a
   Content-Type by hand on a FormData body omits the multipart boundary
   and the server parses nothing. */

export async function uploadToChat(id, file, body = "") {
    const fd = new FormData()
    fd.append("file", file)
    if (body) fd.append("body", body)
    const r = await fetch(`${API_BASE}/api/chat/conversations/${enc(id)}/files`, {
        method: "POST", credentials: "include", body: fd,
    })
    if (!r.ok) {
        let detail = `HTTP ${r.status}`
        try { const b = await r.json(); if (b?.detail) detail = b.detail } catch { /* no body */ }
        throw new Error(detail)
    }
    return r.json()
}

export const attachCaseNode = (id, { case_id, node_id, body }) =>
    req(`/api/chat/conversations/${enc(id)}/attach-node`,
        { method: "POST", body: JSON.stringify({ case_id, node_id, body }) })

export const attachmentUrl = (id, messageId) =>
    `${API_BASE}/api/chat/conversations/${enc(id)}/messages/${enc(messageId)}/file`

export const attachableFiles = (q) =>
    req(`/api/chat/attachable${q ? `?q=${enc(q)}` : ""}`)

export const attachCase = (id, { case_id, can_edit, body }) =>
    req(`/api/chat/conversations/${enc(id)}/attach-case`,
        { method: "POST", body: JSON.stringify({ case_id, can_edit, body }) })

export const sendableCases = () => req("/api/chat/sendable-cases")
