/**
 * adminApi.js — the superadmin console's calls, and the request-access form.
 *
 * Separate from casesApi because these are the only calls in the app whose
 * subject is the account rather than the work, and because exactly one of
 * them (requestAccess) is made by somebody who is not signed in.
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
        try { const body = await r.json(); if (body?.detail) detail = body.detail } catch { /* no body */ }
        const e = new Error(detail)
        e.status = r.status
        throw e
    }
    return r.json()
}

/** Ask for an account. The only call here made while signed out. */
export const requestAccess = (body) =>
    req("/api/auth/request-access", { method: "POST", body: JSON.stringify(body) })

export const accessState = () => req("/api/auth/access-state")

export const listAllUsers = () => req("/api/admin/users")

export const approveUser = (id) =>
    req(`/api/admin/users/${encodeURIComponent(id)}/approve`, { method: "POST" })

export const revokeUser = (id) =>
    req(`/api/admin/users/${encodeURIComponent(id)}/revoke`, { method: "POST" })

export const deleteUser = (id) =>
    req(`/api/admin/users/${encodeURIComponent(id)}`, { method: "DELETE" })

export const updateUser = (id, patch) =>
    req(`/api/admin/users/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(patch) })
