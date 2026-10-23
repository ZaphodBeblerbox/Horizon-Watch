/**
 * postDraft.js — "Write a post" from a signal: what the card sends to the
 * server (backend/assistant_post.py), what goes to the Desk on confirm, and
 * the media download. Pure helpers are tested (assistantPost.test.jsx).
 *
 * The item open in the Inspector or the phone's sheet is remembered here
 * (setOpenItem), so "write a post about this" typed in the chat knows what
 * "this" is.
 */
import API_BASE from "../apiBase.js"
import { reportMedia } from "../components/ReportMedia.jsx"

const arr = (v) => (Array.isArray(v) ? v : [])

/** The fields a post may use, from whatever shape the card holds. Pure. */
export function postItemFrom(r) {
    if (!r || typeof r !== "object") return null
    const d = r.data && typeof r.data === "object" && !r.title && !r.headline ? r.data : r
    const sources = arr(d.sources).slice(0, 6).map((s) => ({
        channel_title: s.channel_title || s.chat || s.channel || null, url: s.url || null,
        text: s.text || s.headline || s.title || null, posted_at: s.posted_at || s.when || null,
        channel: s.channel || null, msg_id: s.msg_id ?? null, media: s.media || null, thumb_url: s.thumb_url || null,
        video_url: s.video_url || null,
    }))
    return {
        id: d.id ?? d.alert_id ?? null, kind: d.kind || r.entityType || null,
        title: d.title || d.headline || d.name || "", summary: d.summary || d.description || d.text || "",
        place: d.place || d.location || d.aoi || "", lat: d.lat ?? null, lon: d.lon ?? null,
        event_time: d.event_time || d.published_at || d.posted_at || d.time || null,
        corroboration: d.corroboration || null, credibility: d.credibility || null,
        verification: typeof d.verification === "string" ? d.verification : null,
        url: d.url || null, source: d.source || null, channel_title: d.channel_title || null,
        channel: d.channel || null, msg_id: d.msg_id ?? null, media: d.media || null, thumb_url: d.thumb_url || null,
        video_url: d.video_url || null,
        sources,
    }
}

/** The item's picture or video (the first one), as the cards show it. */
export function postMediaOf(item) {
    try {
        const m = reportMedia(item, API_BASE).find((x) => !x.missing) || null
        return m ? { type: m.type, thumb: m.thumb || null, video: m.video || null } : null
    } catch { return null }
}

/** What "Post to Desk" sends to the existing POST /api/desk/posts: the text, and the item as the attachment. Pure. */
export function deskPostBody(text, item) {
    const body = String(text || "").trim().slice(0, 4000)
    if (!item) return { body }
    const headline = (item.title || "").slice(0, 300)
    // a Telegram post (the item itself, or the report a live signal cites) travels with its media
    const tg = item.channel && item.msg_id != null ? item : arr(item.sources).find((s) => s.channel && s.msg_id != null)
    if (tg) {
        return { body, attachment: { kind: "telegram", id: item.id, channel: tg.channel, msg_id: tg.msg_id,
            channel_title: tg.channel_title || null, headline, place: item.place || null, lat: item.lat, lon: item.lon,
            media: tg.media || null, thumb_url: tg.thumb_url || null, posted_at: item.event_time || null } }
    }
    return { body, attachment: { kind: "signal", id: item.id, headline, meta: item.place || null,
                                 lat: item.lat, lon: item.lon } }
}

/** The file name a download gets. Pure. */
export function mediaFileName(media, title = "media", type = "") {
    const base = String(title || "media").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "media"
    const ext = /video/.test(type) || media?.type === "video" ? "mp4" : /png/.test(type) ? "png" : /webp/.test(type) ? "webp" : "jpg"
    return `${base}.${ext}`
}

/**
 * Save the item's media as a file. On a phone with a share sheet that takes
 * files, the sheet opens with the file; otherwise the browser saves it.
 * @returns {Promise<"shared"|"saved"|"failed">}
 */
export async function downloadMedia(media, { title, phone = false } = {}) {
    const url = media?.type === "video" ? media.video || media.thumb : media?.thumb
    if (!url) return "failed"
    try {
        const r = await fetch(url, { credentials: "include" })
        if (!r.ok) return "failed"
        const blob = await r.blob()
        const name = mediaFileName(media, title, blob.type)
        if (phone && typeof File !== "undefined" && navigator.canShare) {
            const file = new File([blob], name, { type: blob.type || "application/octet-stream" })
            if (navigator.canShare({ files: [file] })) {
                try { await navigator.share({ files: [file], title: title || name }); return "shared" } catch { /* closed: save instead */ }
            }
        }
        const a = document.createElement("a")
        a.href = URL.createObjectURL(blob)
        a.download = name
        document.body.appendChild(a)
        a.click()
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000)
        return "saved"
    } catch {
        return "failed"
    }
}

let openItem = null
/** The item open in the Inspector / the phone's sheet (for "write a post about this"). */
export function setOpenItem(r) { openItem = r ? postItemFrom(r) : null }
export const getOpenItem = () => openItem

/** "write a post about this", "draft a post", "make a post on it". Pure. */
export function isPostRequest(text) {
    return /\b(write|draft|make|compose|generate)\b[^.?!]{0,30}\bpost\b/i.test(String(text || ""))
}
