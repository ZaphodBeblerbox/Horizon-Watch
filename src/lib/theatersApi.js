/**
 * theatersApi.js — the regions you watch.
 *
 * The tab strip's contents used to be a literal in app.jsx. They are rows
 * now, owned by the account, so they follow you to another machine and can
 * be added to.
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

export const listTheaters = () => req("/api/theaters")

export const createTheater = (body) =>
    req("/api/theaters", { method: "POST", body: JSON.stringify(body) })

export const updateTheater = (id, patch) =>
    req(`/api/theaters/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(patch) })

export const deleteTheater = (id) =>
    req(`/api/theaters/${encodeURIComponent(id)}`, { method: "DELETE" })

export const reorderTheaters = (ids) =>
    req("/api/theaters/order", { method: "POST", body: JSON.stringify({ ids }) })
