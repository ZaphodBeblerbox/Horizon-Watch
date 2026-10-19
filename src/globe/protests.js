/**
 * protests.js — announced protests and where they stand now, for the globe
 * (GlobeDemonstrationsLayer.jsx), the phone (mobile/mapLayers.js, the
 * "demonstrations" row), the inspector card (inspector/ProtestDetail.jsx),
 * the Desk and Home.
 *
 * Owner, 2026-10-18: "If a protest was announced yesterday at République for
 * a specific time, I don't want to read 'announced 14 hours ago', I want to
 * read e.g. 'Currently ongoing', and be able to ingest the photos and videos
 * that go with it, with crowd estimations etc."
 *
 * One answer: GET /api/routes/demonstrations → `protests` (backend
 * protest_status.py). Each carries its status (planned, starting, ongoing,
 * dispersing, ended, no_show) with the times it rests on; the words are
 * rebuilt here from those times every time the map redraws, so "reports
 * 3 min ago" keeps counting between polls. statusLabel() and the backend's
 * protest_status.status_label() say the same thing — keep them so.
 *
 * Colour lives in the icons only; every word is plain.
 */
import { demoStale } from "./freshness.js"

export const PROTEST_SIZE = 24
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
/** The status's colour, in the mark only. */
export const STATUS_COLOUR = {
    planned: "#9AA9BC", starting: "#F5A524", ongoing: "#F5A524", dispersing: "#C9A15A", ended: "#6B7686", no_show: "#6B7686",
}

const ms = (v) => { const t = Date.parse(v || ""); return Number.isFinite(t) ? t : NaN }
const arr = (v) => (Array.isArray(v) ? v : [])
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
const svgUri = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
const STARTING_MIN = 15
const FRESH_MIN = 30

/** 12 → "12 min"; 200 → "3 h 20"; 1500 → "1 day". */
export function span(minutes) {
    const m = Math.max(0, Math.round(Number(minutes) || 0))
    if (m < 60) return `${m} min`
    if (m < 24 * 60) {
        const h = Math.floor(m / 60), r = m % 60
        return r === 0 ? `${h} h` : `${h} h ${String(r).padStart(2, "0")}`
    }
    const d = Math.round(m / 1440)
    return `${d} day${d !== 1 ? "s" : ""}`
}

const agoWords = (minutes) => (minutes < 1 ? "just now" : `${span(minutes)} ago`)

function parts(t, tz) {
    const d = new Date(t)
    try {
        const f = new Intl.DateTimeFormat("en-GB", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit",
                                                     hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" })
        const o = Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]))
        return { y: +o.year, mo: +o.month, d: +o.day, hh: o.hour, mm: o.minute, wd: o.weekday }
    } catch {
        return parts(t, "UTC")
    }
}

/** "14:00" in the place's zone ("14:00 UTC" when it has none). */
export function hhmm(iso, tz) {
    const t = ms(iso)
    if (!Number.isFinite(t)) return ""
    const p = parts(t, tz)
    return `${p.hh}:${p.mm}${tz ? "" : " UTC"}`
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** "today", "tomorrow", "yesterday", "Sat 18 Oct" — in the place's zone. */
export function dayLabel(iso, now = Date.now(), tz) {
    const t = ms(iso)
    if (!Number.isFinite(t)) return ""
    const a = parts(t, tz), n = parts(now, tz)
    const da = Date.UTC(a.y, a.mo - 1, a.d), dn = Date.UTC(n.y, n.mo - 1, n.d)
    const diff = Math.round((da - dn) / 86_400_000)
    if (diff === 0) return "today"
    if (diff === 1) return "tomorrow"
    if (diff === -1) return "yesterday"
    return `${a.wd} ${a.d} ${MONTHS[a.mo - 1]}`
}

/**
 * The words for a status, from its key and times (the backend's
 * status_label, rebuilt so the minutes keep counting):
 *   "Planned · starts in 3 h", "Planned · Sat 18 Oct 14:00", "Starting now · 14:00",
 *   "Ongoing · since 14:00 (reports 3 min ago)", "Dispersing · reports 40 min ago",
 *   "Ended · 14:00–17:20", "No sign it happened · planned 14:00".
 */
export function statusLabel(s, now = Date.now()) {
    if (!s || !s.key) return s?.label || ""
    const tz = s.tz || null
    const start = s.starts_utc, since = s.since, until = s.until
    const lastMs = ms(s.last_report_at)
    const lastMin = Number.isFinite(lastMs) ? (now - lastMs) / 60_000 : null
    const reports = lastMin != null ? `reports ${agoWords(lastMin)}` : null
    switch (s.key) {
    case "planned": {
        if (!Number.isFinite(ms(start))) return "Planned"
        if (s.start_approx) return `Planned · ${dayLabel(start, now, tz)} (no time given)`
        const mins = (ms(start) - now) / 60_000
        if (mins < 12 * 60) return `Planned · starts in ${span(mins)}`
        return `Planned · ${dayLabel(start, now, tz)} ${hhmm(start, tz)}`
    }
    case "starting":
        if (Number.isFinite(ms(since)) && Number.isFinite(ms(start)) && ms(since) < ms(start) - STARTING_MIN * 60_000) {
            return `Starting · people already there (${reports || "reported"})`
        }
        return `Starting now · ${hhmm(start, tz)}${reports && lastMin <= FRESH_MIN ? ` (${reports})` : ""}`
    case "ongoing": {
        const head = `Ongoing · since ${hhmm(since || start, tz)}`
        return reports ? `${head} (${reports})` : `${head} (no reports from there yet)`
    }
    case "dispersing":
        return reports ? `Dispersing · ${reports}` : "Dispersing"
    case "ended": {
        const a = since || start
        return Number.isFinite(ms(a)) && Number.isFinite(ms(until)) ? `Ended · ${hhmm(a, tz)}–${hhmm(until, tz)}` : "Ended"
    }
    case "no_show":
        return Number.isFinite(ms(start)) && !s.start_approx ? `No sign it happened · planned ${hhmm(start, tz)}` : "No sign it happened"
    default:
        return s.label || ""
    }
}

/** A feed item, an announcement or a hazard that stands for a protest: its status words, else null. */
export function itemStatusLabel(item, now = Date.now()) {
    const s = item?.protest_status || (item?.kind === "protest" ? { ...item.status, tz: item.tz } : null)
    if (!s || !s.key) return null
    return statusLabel(s, now) || s.label || null
}

/** "est. 1,500–3,000 · from 3 photos + 2 reports" (never a bare number), or null. */
export function crowdLabel(p) {
    return p?.crowd?.label || null
}

/** "organisers 10,000 · police 2,300" — each source's own figure, apart. */
export function crowdSources(p) {
    return p?.crowd?.by_source_label || null
}

function textW(t, size) { return Math.round(String(t).length * size * 0.58) }

/** The map mark: a ring (dashed when not yet begun, solid and filled while
 *  under way, faint once over) with a crowd glyph, the status beside it. */
export function protestIcon(key, label = "") {
    const c = STATUS_COLOUR[key] || STATUS_COLOUR.planned
    const text = String(label || "")
    const width = 28 + (text ? textW(text, 11) + 8 : 0), height = 26
    const live = key === "ongoing" || key === "starting"
    const over = key === "ended" || key === "no_show"
    const ring = key === "planned"
        ? `<circle cx="13" cy="13" r="10.5" fill="#0b1220" stroke="${c}" stroke-width="2" stroke-dasharray="3.4 2.6"/>`
        : `<circle cx="13" cy="13" r="10.5" fill="${live ? c : "#0b1220"}" fill-opacity="${live ? 0.95 : 1}" stroke="${c}" stroke-width="2"/>`
    const ink = live ? "#0b1220" : c
    const glyph = `<g fill="${ink}" opacity="${over ? 0.7 : 1}"><circle cx="9.6" cy="11" r="1.6"/><circle cx="13" cy="10" r="1.8"/><circle cx="16.4" cy="11" r="1.6"/>`
        + "<path d=\"M7.6 16c.4-1.9 1.1-2.8 2-2.8s1.6.9 2 2.8zM11 16c.4-2.2 1.1-3.2 2-3.2s1.6 1 2 3.2zM14.4 16c.4-1.9 1.1-2.8 2-2.8s1.6.9 2 2.8z\"/></g>"
    const halo = live ? `<circle cx="13" cy="13" r="12.4" fill="none" stroke="${c}" stroke-opacity="0.45" stroke-width="1.2"/>` : ""
    const words = text ? `<text x="29" y="17" font-family="${FONT}" font-size="11" font-weight="600" fill="#F2F4F7" stroke="#05070C" stroke-width="3" stroke-linejoin="round" paint-order="stroke">${esc(text)}</text>` : ""
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${halo}${ring}${glyph}${words}</svg>`
    return { uri: svgUri(svg), width, height, anchor: [13, 13] }
}


/** The card's text: status, when, crowd, and the posts behind it. */
export function protestDetail(p, now = Date.now()) {
    const st = statusLabel({ ...p?.status, tz: p?.tz }, now)
    const srcs = arr(p?.sources)
    return [
        `${p?.title || "Announced protest"} — ${st}.`,
        p?.starts_label ? `Announced for ${p.starts_label}${p?.start_approx ? "" : ` (local time)`}; ${p?.duration_basis === "stated" ? "end as stated" : `planned length is the ${p?.duration_basis || "default"}`}.` : null,
        crowdLabel(p) ? `Crowd: ${crowdLabel(p)}${crowdSources(p) ? ` (${crowdSources(p)})` : ""}.` : null,
        arr(p?.media).length ? `${p.media.length} photo${p.media.length === 1 ? "" : "s"} and video${p.media.length === 1 ? "" : "s"} from there.` : null,
        srcs.length ? `Announced in ${srcs.length} post${srcs.length === 1 ? "" : "s"}: ${[...new Set(srcs.map((s) => s.channel_title || s.channel))].slice(0, 4).join(", ")}.` : null,
        p?.note || null,
    ].filter(Boolean).join("\n")
}

/** The fields the inspector and the phone's card read, on top of the protest. */
export function protestRaw(p, now = Date.now()) {
    const st = statusLabel({ ...p?.status, tz: p?.tz }, now)
    const last = arr(p?.evidence)[0]
    return {
        ...p, kind: "protest", title: p?.title || "Announced protest", status_label: st,
        sub: [st, crowdLabel(p)].filter(Boolean).join(" · "),
        url: last?.url || arr(p?.sources)[0]?.url || null, source: "Announced on Telegram",
        // the card's time is the status, never "announced N h ago"
        published_at: null, detail: protestDetail(p, now),
    }
}

/** Over: no longer a signal on the map (owner, 2026-10-19: "Once the demonstration is over we don't want the signal anymore"). */
export const OVER = new Set(["ended", "no_show"])

/** Every protest not yet over as a map point: {id, lat, lon, iconUri, iconWidth, iconHeight, iconAnchor, size, title, sub, key, raw}. */
export function protestPoints(data, now = Date.now()) {
    return arr(data?.protests).filter((p) => Number.isFinite(+p?.lat) && Number.isFinite(+p?.lon) && !OVER.has(p?.status?.key)
                                       && !demoStale({ ...p, kind: "protest" }, now)).map((p) => {
        const raw = protestRaw(p, now)
        const key = p.status?.key || "planned"
        const ic = protestIcon(key, raw.status_label.split(" (")[0])
        return { id: `protest-${p.id}`, lat: +p.lat, lon: +p.lon, iconUri: ic.uri, iconWidth: ic.width, iconHeight: ic.height,
                 iconAnchor: ic.anchor, size: PROTEST_SIZE, title: raw.title, sub: raw.sub, key, raw }
    })
}

/** The media strip's items with absolute URLs (newest first, as served). */
export function mediaItems(p, base = "") {
    const abs = (u) => (!u ? null : /^https?:|^data:/.test(u) ? u : `${base}${u}`)
    return arr(p?.media).map((m) => ({ ...m, thumb: abs(m.thumb_url), video: abs(m.video_url) }))
}
