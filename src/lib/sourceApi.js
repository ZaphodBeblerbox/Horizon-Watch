/**
 * sourceApi.js — a cited source as our own card (backend/source_card.py).
 *
 *   sourceCard(url)              what the server holds: channel or outlet, time, original text, its English,
 *                                media URLs through our proxy; no model. Kept in memory for the session.
 *   sourceSummary(url, given)    the short "what happened", asked for when the reader opens the source (one model
 *                                call on the server, cached there per URL); {summary: null, why} when the model is off
 *   telegramUrl(it)              the t.me link of a Telegram item (public channels and c/<id> channels)
 */
import API_BASE from "../apiBase.js"

const cards = new Map()
const sums = new Map()

async function get(path, opts) {
    const r = await fetch(`${API_BASE}${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...opts })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
}

export function sourceCard(url) {
    if (!url) return Promise.resolve(null)
    if (!cards.has(url)) {
        const p = get(`/api/source/card?url=${encodeURIComponent(url)}`).catch((e) => { cards.delete(url); throw e })
        cards.set(url, p)
    }
    return cards.get(url)
}

export function sourceSummary(url, given = {}) {
    if (!url) return Promise.resolve(null)
    if (!sums.has(url)) {
        const p = get("/api/source/summary", { method: "POST", body: JSON.stringify({ url, ...given }) })
            .then((d) => { if (!d?.summary) sums.delete(url); return d })       // off: the next open asks again
            .catch((e) => { sums.delete(url); throw e })
        sums.set(url, p)
    }
    return sums.get(url)
}

export function telegramUrl(it) {
    if (!it) return null
    if (it.url && /t(?:elegram)?\.me\//i.test(it.url)) return it.url
    const ch = String(it.channel || "")
    if (!ch || it.msg_id == null || /^(u|g)\//.test(ch)) return null
    return `https://t.me/${ch}/${it.msg_id}`
}
