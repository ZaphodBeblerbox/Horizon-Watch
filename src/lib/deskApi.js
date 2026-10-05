/**
 * deskApi.js — observations published to the desk.
 *
 * Deliberately not a follower feed: see backend/routers/desk.py for why
 * the audience is the organisation and the filters are theater and
 * urgency.
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

export function listPosts({ theater, urgency, author, before, limit } = {}) {
    const q = new URLSearchParams()
    if (theater) q.set("theater", theater)
    if (urgency?.length) q.set("urgency", Array.isArray(urgency) ? urgency.join(",") : urgency)
    if (author) q.set("author", author)
    if (before) q.set("before", before)
    if (limit) q.set("limit", String(limit))
    const s = q.toString()
    return req(`/api/desk/posts${s ? `?${s}` : ""}`)
}

export const createPost = (body) =>
    req("/api/desk/posts", { method: "POST", body: JSON.stringify(body) })

export const deletePost = (id) =>
    req(`/api/desk/posts/${enc(id)}`, { method: "DELETE" })

export const toggleAck = (id) =>
    req(`/api/desk/posts/${enc(id)}/ack`, { method: "POST" })

export const whoAcked = (id) => req(`/api/desk/posts/${enc(id)}/acks`)

export const listReplies = (id) => req(`/api/desk/posts/${enc(id)}/replies`)

export const postedTheaters = () => req("/api/desk/theaters")

export const deskFileUrl = (postId) => `${API_BASE}/api/desk/files/${enc(postId)}`

/** Multipart, so it does not go through req() — see chatApi for why. */
export async function uploadDeskFile(file) {
    const fd = new FormData()
    fd.append("file", file)
    const r = await fetch(`${API_BASE}/api/desk/files`, {
        method: "POST", credentials: "include", body: fd,
    })
    if (!r.ok) {
        let detail = `HTTP ${r.status}`
        try { const b = await r.json(); if (b?.detail) detail = b.detail } catch { /* no body */ }
        throw new Error(detail)
    }
    return r.json()
}
