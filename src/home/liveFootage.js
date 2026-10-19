/**
 * liveFootage.js — Home's "Live footage" strip, the arithmetic (pure, tested
 * in liveFootage.test.js). The owner, 2026-10-18: "'Live from Telegram' and
 * 'From the ground' should just be replaced by one unified feed I can swipe
 * sideways to show the latest Telegram videos."
 *
 *   footageFromPosts(...lists)   the fallback merge, from /api/telegram/feed
 *                                and /api/telegram/posts, while a server has
 *                                no /api/telegram/footage yet: posts with a
 *                                picture or a video, and the footage behind
 *                                street reports (marked on the ground)
 *   dedupe(items)                one card per video: the same post from both
 *                                lists, a forward (Telegram's media id), the
 *                                same words under the same kind of media;
 *                                the first post is kept, the others listed
 *   order(items)                 videos lead, newest first; pictures follow
 *                                only while the videos are few
 *   reconcile(shown, latest, atStart)   what the strip shows after a poll:
 *                                at the start the new ones slide in; scrolled
 *                                away nothing moves under the thumb, and the
 *                                count of new ones waits in a pill
 */

export const MIN_VIDEOS = 6
export const MAX_ITEMS = 40

const arr = (v) => (Array.isArray(v) ? v : [])

/** Words only: links, @handles, punctuation and case dropped. */
export function normText(t) {
    return String(t || "").replace(/https?:\/\/\S+|t\.me\/\S+|@\w+/gi, " ").toLowerCase()
        .replace(/[^\p{L}\p{N}_]+/gu, " ").trim().slice(0, 160)
}

/** What makes two cards the same footage. */
export function dedupKey(it) {
    if (it?.media_key) return `m:${it.media_key}`
    const w = normText(it?.text)
    return w.length >= 12 ? `t:${it.media}:${w}` : null
}

const realPlace = (p) => {
    const s = String(p || "").trim()
    return s && !/^(none|null|unknown)$/i.test(s) ? s : null
}

/** A post (the shape /api/telegram/feed and /posts return) as a card. */
function cardOf(p, extra = {}) {
    const text = String(p.text || "").trim()
    return {
        id: p.id || `tg-${p.channel}-${p.msg_id}`, channel: p.channel, msg_id: p.msg_id,
        channel_title: p.channel_title || p.channel, posted_at: p.posted_at,
        media: p.media, media_key: p.media_key || null, duration: p.duration ?? null, thumb_url: p.thumb_url,
        caption: String(p.caption || p.headline || p.summary_en || text || "").replace(/\s+/g, " ").trim(),
        headline: p.headline || null, summary_en: p.summary_en || null, text,
        place: realPlace(p.place), lat: p.lat ?? null, lon: p.lon ?? null, country_code: p.country_code || null,
        graphic: !!p.graphic, on_ground: !!p.on_ground, ground_kind: p.ground_kind || null,
        url: p.url || null, also_in: arr(p.also_in).slice(), ...extra,
    }
}

const hasMedia = (x) => (x?.media === "video" || x?.media === "photo") && !!x?.thumb_url

/** Posts from the old endpoints → cards (then deduped and ordered). */
export function footageFromPosts(...lists) {
    const out = []
    for (const p of lists.flatMap(arr)) {
        if (!p) continue
        if (p.street_report && arr(p.sources).length) {
            // a street report stands for messages; its footage is theirs
            for (const s of p.sources) {
                if (!hasMedia(s)) continue
                out.push(cardOf({ ...s, id: `tg-${s.channel}-${s.msg_id}`, caption: s.translation || p.headline,
                                  place: p.place, lat: p.lat, lon: p.lon, graphic: p.graphic },
                                { on_ground: true, ground_kind: "street_report" }))
            }
            continue
        }
        if (p.unified || !hasMedia(p)) continue
        out.push(cardOf(p))
    }
    return order(dedupe(out))
}

/** One card per video; the first post kept, the other chats listed. */
export function dedupe(items) {
    const kept = [], byKey = new Map(), byId = new Map()
    const sorted = arr(items).filter(Boolean).slice().sort((a, b) => String(a.posted_at || "").localeCompare(String(b.posted_at || "")))
    for (const it0 of sorted) {
        const it = { ...it0, also_in: arr(it0.also_in).slice() }
        const k = dedupKey(it)
        const first = byId.get(it.id) || (k ? byKey.get(k) : null)
        if (first) {
            if (it.channel_title && it.channel_title !== first.channel_title && !first.also_in.includes(it.channel_title)) first.also_in.push(it.channel_title)
            for (const f of ["place", "lat", "lon", "duration", "media_key"]) if (first[f] == null && it[f] != null) first[f] = it[f]
            if (!first.on_ground && it.on_ground) { first.on_ground = true; first.ground_kind = it.ground_kind }
            if (it.graphic) first.graphic = true
            continue
        }
        byId.set(it.id, it)
        if (k) byKey.set(k, it)
        kept.push(it)
    }
    return kept
}

/** Videos newest first; pictures after them only while videos are few. */
export function order(items, limit = MAX_ITEMS) {
    const t = (x) => String(x.posted_at || "")
    const newest = (a, b) => t(b).localeCompare(t(a))
    const vids = arr(items).filter((x) => x.media === "video").sort(newest)
    const pics = arr(items).filter((x) => x.media === "photo").sort(newest)
    return (vids.length >= MIN_VIDEOS ? vids : [...vids, ...pics]).slice(0, limit)
}

/**
 * After a poll. `atStart`: the strip is scrolled to its beginning, so the
 * new list replaces it (new cards slide in at the start). Otherwise the
 * cards on screen stay where they are (refreshed in place), and `pending`
 * counts the new ones waiting for the pill. `fresh`: ids just added.
 */
export function reconcile(shown, latest, atStart) {
    const now = arr(latest)
    const had = new Set(arr(shown).map((x) => x.id))
    if (!arr(shown).length || atStart) {
        return { shown: now, pending: 0, fresh: arr(shown).length ? now.filter((x) => !had.has(x.id)).map((x) => x.id) : [] }
    }
    const byId = new Map(now.map((x) => [x.id, x]))
    return { shown: shown.map((x) => byId.get(x.id) || x), pending: now.filter((x) => !had.has(x.id)).length, fresh: [] }
}

/** "0:42", "12:05" — a video's length; nothing when unknown. */
export function durLabel(s) {
    const n = Number(s)
    if (!Number.isFinite(n) || n <= 0) return null
    const t = Math.round(n), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = String(t % 60).padStart(2, "0")
    return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`
}

/** "Obolon, Kyiv" from "Obolon, Kyiv, Kyiv Oblast, Ukraine". */
export function shortPlace(p) {
    return String(realPlace(p) || "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 2).join(", ")
}
