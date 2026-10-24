/**
 * footage.js — the pictures and videos an item carries, in the one shape TelegramMedia plays (owner, 2026-10-24:
 * "when an item has footage, the swiped-up detail sheet must include the footage, playable"). Items arrive in several
 * shapes: a Telegram post (media "video"|"photo", thumb_url, channel, msg_id), a live signal (media as an attachment
 * object, all_media a list: live_signals.py), a footage card (video_url / photo_url). At most four, videos first,
 * one per file.
 */
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v)

function one(m, parent = {}) {
    if (!m) return null
    const kind = m.kind || m.media || (m.video_url ? "video" : (m.photo_url || m.thumb_url) ? "photo" : null)
    if (kind !== "video" && kind !== "photo") return null
    const thumb = m.thumb_url || m.photo_url || null
    if (!thumb && !m.video_url && !(kind === "video" && m.channel && m.msg_id != null)) return null
    return {
        id: `${m.channel || parent.channel || "x"}-${m.msg_id ?? parent.msg_id ?? thumb ?? m.video_url}`,
        media: kind, thumb_url: thumb, video_url: m.video_url || null, photo_url: m.photo_url || (kind === "photo" ? thumb : null),
        channel: m.channel || parent.channel || null, msg_id: m.msg_id ?? parent.msg_id ?? null,
        graphic: !!(m.graphic || parent.graphic), headline: parent.headline || parent.title || "",
    }
}

export function footageOf(s) {
    if (!s) return []
    const out = []
    for (const m of Array.isArray(s.all_media) ? s.all_media : []) out.push(one(m, s))
    if (isObj(s.media)) out.push(one(s.media, s))
    else if (s.media === "video" || s.media === "photo" || s.video_url || s.photo_url) out.push(one(s, s))
    else if (s.thumb_url && s.channel) out.push(one({ ...s, media: "photo" }, s))
    const seen = new Set()
    return out.filter((m) => m && !seen.has(m.video_url || m.thumb_url || m.id) && seen.add(m.video_url || m.thumb_url || m.id))
        .sort((a, b) => (a.media === "video" ? 0 : 1) - (b.media === "video" ? 0 : 1)).slice(0, 4)
}
