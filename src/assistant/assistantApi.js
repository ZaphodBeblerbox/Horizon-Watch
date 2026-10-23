/**
 * assistantApi.js — the assistant's endpoints (backend/routers/assistant.py).
 *
 * A proposal is never written from here directly: /confirm checks the
 * signed token and hands back the request, which is then sent to the
 * EXISTING endpoint (theaters, my-assets, settings) with the user's session.
 */
import API_BASE from "../apiBase.js"
import { updateSetting, getSettings } from "../state/settingsStore.js"

async function req(path, opts) {
    const r = await fetch(`${API_BASE}${path}`, {
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        ...opts,
    })
    let body = null
    try { body = await r.json() } catch { /* no body */ }
    if (!r.ok) {
        const e = new Error(body?.detail || body?.error || `HTTP ${r.status}`)
        e.status = r.status
        throw e
    }
    return body
}

export const askTurn = (body, { signal } = {}) =>
    req("/api/assistant/turn", { method: "POST", body: JSON.stringify(body), signal })

/* Conversations, kept per user on the server (backend/assistant_history.py). */
const C = "/api/assistant/conversations"
const J = (method, body) => ({ method, body: JSON.stringify(body || {}) })
export const listConversations = (limit = 50) => req(`${C}?limit=${limit}`).then((d) => d?.conversations || [])
export const createConversation = (mode = "chat") => req(C, J("POST", { mode }))
export const getConversation = (id) => req(`${C}/${encodeURIComponent(id)}`)
export const renameConversation = (id, title) => req(`${C}/${encodeURIComponent(id)}`, J("PATCH", { title }))
export const deleteConversation = (id) => req(`${C}/${encodeURIComponent(id)}`, { method: "DELETE" })
export const appendMessages = (id, messages) => req(`${C}/${encodeURIComponent(id)}/messages`, J("POST", { messages }))
export const stopTurn = (id, turnId) => req(`${C}/${encodeURIComponent(id)}/stop`, J("POST", { turn_id: turnId }))
export const setProposalState = (id, mid, token, state, why) =>
    req(`${C}/${encodeURIComponent(id)}/messages/${mid}`, J("PATCH", { token, state, why }))
export const setDraftState = (id, mid, draft) =>
    req(`${C}/${encodeURIComponent(id)}/messages/${mid}`, J("PATCH", { draft }))
/** "Write a post": the item in, a cited draft out (one model call at most; a template when it is off). */
export const draftPost = (item, { signal } = {}) =>
    req("/api/assistant/draft_post", { method: "POST", body: JSON.stringify({ item }), signal })
export const proposeForm = (kind, fields) =>
    req("/api/assistant/propose", { method: "POST", body: JSON.stringify({ kind, fields }) })
export const assistantStatus = () => req("/api/assistant/status")

/**
 * Confirm a proposal: the server checks the token (signature, owner,
 * expiry, single use), then the app calls the existing endpoint.
 * @returns {Promise<{kind, result}>}
 */
export async function confirmProposal(token, { fetchImpl } = {}) {
    const plan = await req("/api/assistant/confirm", { method: "POST", body: JSON.stringify({ token }) })
    return { kind: plan.kind, result: await runConfirmed(plan, { fetchImpl }) }
}

/** The confirmed request, sent where the forms send it. Settings go through
 *  the settings store so the open app sees them at once. */
export async function runConfirmed(plan, { fetchImpl } = {}) {
    if (plan.method === "PATCH" && plan.path === "/api/users/me/settings" && !fetchImpl) {
        const cur = getSettings()?.interests || {}
        const next = { ...cur, ...(plan.body?.interests || {}) }
        const out = await updateSetting("interests", next)
        if (out && out.ok === false) throw new Error(out.error || "The settings were not saved.")
        return next
    }
    const f = fetchImpl || fetch
    const r = await f(`${API_BASE}${plan.path}`, {
        method: plan.method, credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(plan.body),
    })
    let body = null
    try { body = await r.json() } catch { /* no body */ }
    if (!r.ok) throw new Error(body?.detail || `HTTP ${r.status}`)
    if (plan.kind === "theater" && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("akili:theater-created", { detail: { id: body?.id } }))
    }
    if (plan.kind === "asset" && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("plx:assets-changed", { detail: { id: body?.id } }))
    }
    return body
}
