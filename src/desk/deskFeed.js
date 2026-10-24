/**
 * deskFeed.js — the Desk read like X (owner, 2026-10-24: "if our entire system, the desk, behaves like Twitter,
 * then I'm happy"). Pure helpers shared by the desktop Desk and the phone's:
 *
 *   theaterTabs      the top bar: "All", then the user's theatres (X's "For you / Following / lists")
 *   teamPostIn       a team post belongs to a theatre by its name, or by the place it carries
 *   nextTab          a swipe on the feed moves one tab left or right
 *   itemKey          the id a General item's comments are kept under (routers/desk.py item-comments)
 *   exactTime        the full date and time of a post in its full view, never "2h"
 *   mediaOf          the media a full view shows and downloads (assistant/postDraft.js downloadMedia's shape)
 *   placeOf          where it happened, for the small map; null without a real place
 *   scrollMemo       where the reader was in a list, so Back returns there
 */
import API_BASE from "../apiBase.js"

/** [{id: null, label: "All"}, ...one per theatre]. */
export function theaterTabs(theaters) {
    const list = Array.isArray(theaters) ? theaters : []
    return [{ id: null, label: "All" }, ...list.filter((t) => t && t.id != null).map((t) => ({ id: String(t.id), label: t.name || "Theatre", theater: t }))]
}

/** The tab `dir` (+1 right, -1 left) steps from `current`; the edges hold. */
export function nextTab(tabs, current, dir) {
    const i = Math.max(0, tabs.findIndex((t) => t.id === (current ?? null)))
    const j = Math.min(tabs.length - 1, Math.max(0, i + (dir > 0 ? 1 : -1)))
    return tabs[j]?.id ?? null
}

const norm = (s) => String(s || "").trim().toLowerCase()

/** A team post is in a theatre when it was posted to it by name, or when what it carries lies inside it. */
export function teamPostIn(post, theater, inside) {
    if (!theater) return true
    if (post?.theater && norm(post.theater) === norm(theater.name)) return true
    const a = post?.attachment
    if (a && Number.isFinite(+a.lat) && Number.isFinite(+a.lon) && a.lat !== null && inside) return !!inside({ lat: +a.lat, lon: +a.lon })
    return false
}

/** routers/desk.py ITEM_KEY: letters, digits and : / _ . ~ - ; anything else becomes "_". */
export function itemKey(it) {
    const raw = String(it?.id ?? it?.url ?? "").slice(0, 160)
    return raw.replace(/[^A-Za-z0-9:/_.~-]/g, "_") || null
}

const naive = (s) => typeof s === "string" && /T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s.trim())

/** "Saturday 24 October 2026, 14:32" in the reader's time, with the zone. A date-only event says only the day. */
export function exactTime(iso, { precision = "time", timeZone } = {}) {
    if (!iso) return ""
    const s = String(iso).trim()
    const d = new Date(naive(s) ? `${s}Z` : s)
    if (Number.isNaN(d.getTime())) return ""
    const day = { weekday: "long", day: "numeric", month: "long", year: "numeric", ...(timeZone ? { timeZone } : {}) }
    if (precision === "day") return d.toLocaleDateString(undefined, { ...day, timeZone: "UTC" })
    return d.toLocaleString(undefined, { ...day, hour: "2-digit", minute: "2-digit", timeZoneName: "short" })
}

const abs = (u) => (!u ? null : /^https?:|^blob:|^data:/.test(u) ? u : `${API_BASE}${u}`)

/** {type: "video"|"photo", thumb, video} for a Telegram post or desk attachment; null without media. */
export function mediaOf(it) {
    if (!it) return null
    const kind = it.media === "video" ? "video" : (it.media === "photo" || it.photo_url || it.thumb_url) ? "photo" : null
    if (!kind) return null
    const thumb = abs(it.photo_url || it.thumb_url)
    let video = null
    if (kind === "video") {
        if (it.video_url) video = abs(it.video_url)
        else if (it.channel && it.msg_id != null) {
            const c = String(it.channel).startsWith("c/") ? `-100${String(it.channel).slice(2)}` : String(it.channel)
            video = `${API_BASE}/api/telegram/video/${encodeURIComponent(c)}/${it.msg_id}`
        }
    }
    if (!thumb && !video) return null
    return { type: kind, thumb, video }
}

/** {lat, lon, label} when the item has a real place (not 0,0, not missing). */
export function placeOf(it) {
    const a = it?.attachment
    const lat = Number(it?.lat ?? a?.lat), lon = Number(it?.lon ?? a?.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return null
    if ((it?.lat == null && a?.lat == null) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
    return { lat, lon, label: String(it?.place || a?.place || a?.name || it?.location || "").split(",").slice(0, 2).join(",") || null }
}

/** Remember and give back a list's scroll position by key (Back returns to the same place). */
export function scrollMemo() {
    const at = new Map()
    return {
        save(key, el) { if (el) at.set(key, el.scrollTop) },
        restore(key, el) {
            if (!el || !at.has(key)) return
            const y = at.get(key)
            el.scrollTop = y
            // media above may still be laying out: once more on the next frame
            if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => { el.scrollTop = y })
        },
        get: (key) => at.get(key),
    }
}

/** Is this click on the card itself, not on one of its controls or its media? */
export function isCardClick(e) {
    const t = e?.target
    return !(t && typeof t.closest === "function" && t.closest("button, a, input, textarea, select, video, label, [data-noopen]"))
}
