/**
 * ReportMedia.jsx — the pictures and videos behind a report from the street
 * (a street report's posts, a Telegram signal, a feed item), as thumbnails
 * that open the real thing full screen (mobile/MediaViewer.jsx, used on the
 * desktop too). Owner, 2026-10-19: "Currently it only says 'footage at
 * Châtelet' and 'footage at République'. I want the footage visible, so
 * when I click on it, I want the actual footage."
 *
 * Where the media comes from: the server keeps a still of each Telegram
 * picture and video (/api/telegram/media/…); a video is fetched from
 * Telegram when opened (/api/telegram/video/…, held half an hour, never on
 * the laptop). A picture whose still was not kept cannot be shown: the strip
 * says so and links the post, never a bare label.
 *
 *   reportMedia(item)      → [{id, type, thumb, video, chat, hhmm, url, missing}]
 *   <ReportMedia item />   the strip (phone sheet, desktop inspector)
 *   <ReportMedia item compact />  one thumbnail with a count (the phone's map card)
 *
 * Colour only in the media itself; the words plain; no monospace.
 */
import { useState } from "react"
import API_BASE from "../apiBase.js"
import { openMedia } from "../mobile/MediaViewer.jsx"
import { warnFor } from "./TelegramMedia.jsx"
import SourceLink from "./SourceLink.jsx"

const arr = (v) => (Array.isArray(v) ? v : [])
const abs = (u, base) => (!u ? null : /^https?:|^data:|^blob:/.test(u) ? u : `${base}${u}`)
const isMedia = (m) => m === "photo" || m === "video"

function videoUrl(channel, msgId) {
    if (!channel || msgId == null) return null
    const c = String(channel).startsWith("c/") ? `-100${String(channel).slice(2)}` : String(channel)
    return `/api/telegram/video/${encodeURIComponent(c)}/${msgId}`
}

/** The media of an item, newest first: from its sources when it has them (a
 *  street report, a unified signal), else its own. */
export function reportMedia(item, base = API_BASE) {
    if (!item || typeof item !== "object") return []
    const out = []
    const seen = new Set()
    const push = (s, fallbackId) => {
        const type = s?.media
        if (!isMedia(type)) return
        const mid = s.media_msg_id ?? s.msg_id
        const id = s.id && !s.sources ? String(s.id) : `${s.channel || ""}/${mid ?? fallbackId}`
        if (seen.has(id)) return
        seen.add(id)
        const video = type === "video" ? abs(s.video_url || videoUrl(s.channel, mid), base) : null
        const thumb = abs(s.thumb_url, base)
        out.push({ id, type, thumb, video, chat: s.channel_title || s.channel || "Telegram", hhmm: s.hhmm || null,
                   at: s.posted_at || null, url: s.url || null, graphic: !!s.graphic || !!item.graphic,
                   // a picture without its still cannot be shown; a video plays from Telegram
                   missing: type === "photo" ? !thumb : !video })
    }
    const srcs = arr(item.sources)
    srcs.slice().reverse().forEach((s, i) => push(s, `s${i}`))
    if (!out.length) push({ ...item, channel: item.media_channel || item.channel }, "self")
    return out
}

const PLAY = (
    <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden
         style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", pointerEvents: "none" }}>
        <circle cx="15" cy="15" r="14" fill="rgba(0,0,0,.55)" stroke="rgba(255,255,255,.85)" strokeWidth="1.2" />
        <path d="M12 9.5v11l9-5.5z" fill="#fff" />
    </svg>
)

function open(list, i, e) {
    const playable = list.filter((m) => !m.missing)
    const k = playable.indexOf(list[i])
    if (k < 0) return
    const tiles = e?.currentTarget?.closest?.("[data-report-media]")?.querySelectorAll?.("[data-media-tile]") || []
    openMedia({
        list: playable.map((m) => ({
            src: m.type === "video" ? m.video : m.thumb, type: m.type, poster: m.thumb,
            fromEl: () => [...tiles].find((t) => t.dataset.mediaTile === m.id)?.querySelector("img") || null,
            title: m.chat, meta: [m.hhmm, m.type === "video" ? "video" : "photo"].filter(Boolean).join(" · "),
        })),
        index: k,
    })
}

function Tile({ m, list, i, size, radius = 8 }) {
    // graphic footage opens behind the warning: the first tap shows the still, the next plays it
    const [shown, setShown] = useState(false)
    const blur = warnFor({ graphic: m.graphic }) && !shown
    const label = m.missing
        ? `The ${m.type} from ${m.chat} was not kept on the server`
        : `${m.type === "video" ? "Play the video" : "Open the photo"} from ${m.chat}${m.hhmm ? `, ${m.hhmm}` : ""}`
    return (
        <button type="button" data-media-tile={m.id} aria-label={label} title={label} disabled={m.missing}
                onClick={(e) => { e.stopPropagation(); if (blur) setShown(true); else open(list, i, e) }}
                style={{ position: "relative", display: "block", width: size.w, height: size.h, padding: 0, border: 0, flex: "none",
                         borderRadius: radius, overflow: "hidden", background: "#0b0d12", cursor: m.missing ? "default" : "pointer" }}>
            {m.thumb && <img src={m.thumb} alt="" loading="lazy"
                             style={{ width: "100%", height: "100%", objectFit: "cover", display: "block",
                                      filter: blur ? "blur(14px) brightness(.6)" : "none" }} />}
            {!m.thumb && (
                <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 6, textAlign: "center",
                               color: "rgba(255,255,255,.75)", font: "500 11px/1.3 var(--font, system-ui, sans-serif)" }}>
                    {m.missing ? "not kept" : "video"}
                </span>
            )}
            {blur && <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#fff",
                                    font: "600 10px var(--font, system-ui, sans-serif)", letterSpacing: ".08em", textTransform: "uppercase" }}>sensitive</span>}
            {m.type === "video" && !m.missing && !blur && PLAY}
        </button>
    )
}

/** The strip: every picture and video behind the item, each opening full screen. */
export default function ReportMedia({ item, phone = false, compact = false, base = API_BASE }) {
    const list = reportMedia(item, base)
    if (!list.length) return null
    const missing = list.filter((m) => m.missing)
    const shown = list.filter((m) => !m.missing)
    if (compact) {
        const first = shown[0]
        if (!first) return null
        return (
            <div data-report-media data-testid="report-media-compact" style={{ position: "relative", flex: "none" }}>
                <Tile m={first} list={list} i={list.indexOf(first)} size={{ w: 64, h: 64 }} radius={10} />
                {shown.length > 1 && (
                    <span style={{ position: "absolute", right: 4, bottom: 4, padding: "1px 5px", borderRadius: 6, background: "rgba(0,0,0,.6)",
                                   color: "#fff", font: "600 10px var(--font, system-ui, sans-serif)", pointerEvents: "none" }}>{shown.length}</span>
                )}
            </div>
        )
    }
    const small = { fontSize: phone ? 12.5 : "var(--text-xs, 12px)", color: phone ? "var(--txt2, #c3c7cf)" : "var(--text-dim, var(--txt2))", lineHeight: 1.45 }
    const w = phone ? 132 : 120
    return (
        <div data-report-media data-testid="report-media" style={{ marginBottom: phone ? 12 : "var(--space-4, 16px)" }}>
            <div style={{ ...small, textTransform: "uppercase", letterSpacing: ".06em", fontSize: 10.5, marginBottom: 6 }}>
                {shown.some((m) => m.type === "video") ? "Footage" : "Photos"} from there · {shown.length}
            </div>
            {shown.length > 0 && (
                <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, scrollSnapType: "x proximity", WebkitOverflowScrolling: "touch" }}>
                    {shown.map((m) => (
                        <figure key={m.id} style={{ margin: 0, flex: "none", width: w, scrollSnapAlign: "start" }}>
                            <Tile m={m} list={list} i={list.indexOf(m)} size={{ w, h: Math.round((w * 3) / 4) }} />
                            <figcaption style={{ ...small, marginTop: 4 }}>
                                <div>{[m.hhmm, m.type === "video" ? "video" : "photo"].filter(Boolean).join(" · ")}</div>
                                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {m.url ? <SourceLink url={m.url} style={{ color: "inherit" }}>{m.chat}</SourceLink> : m.chat}
                                </div>
                            </figcaption>
                        </figure>
                    ))}
                </div>
            )}
            {missing.length > 0 && (
                <div data-testid="report-media-missing" style={{ ...small, marginTop: 4 }}>
                    {missing.length === 1 ? `A ${missing[0].type} from ${missing[0].chat} was` : `${missing.length} pictures were`} not kept on the server
                    {missing.some((m) => m.url) ? <> — <SourceLink url={missing.find((m) => m.url).url} style={{ color: "inherit" }}>open the post on Telegram</SourceLink></> : "."}
                </div>
            )}
        </div>
    )
}
