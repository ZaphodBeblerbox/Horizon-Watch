/**
 * ProtestDetail.jsx — the top of an announced protest's card, on the desktop
 * inspector and in the phone's sheet (owner, 2026-10-18: "I want to read e.g.
 * 'Currently ongoing', and be able to ingest the photos and videos that go
 * with it, with crowd estimations").
 *
 *   status   "Ongoing · since 14:00 (reports 3 min ago)" — rebuilt every 30 s
 *            from the times it rests on (globe/protests.js statusLabel)
 *   crowd    "est. 1,500–3,000 · from 3 photos + 2 reports", each source's own
 *            figure apart ("organisers 10,000 · police 2,300"); never a bare number
 *   media    the photos and videos from there, newest first, each with its
 *            chat, time and link; a tap opens it full screen (mobile/MediaViewer)
 *   evidence what says it is (or was) happening, newest first, linked
 *
 * Colour only in the mark; every word plain (the phone's rule).
 */
import { useEffect, useState } from "react"
import API_BASE from "../apiBase.js"
import { openMedia } from "../mobile/MediaViewer.jsx"
import { crowdLabel, crowdSources, hhmm, mediaItems, protestIcon, statusLabel } from "../globe/protests.js"
import SourceLink from "../components/SourceLink.jsx"

const arr = (v) => (Array.isArray(v) ? v : [])
const KIND = { street_report: "Street report", crowd_report: "Crowd report", position: "People there", post: "Post" }

export default function ProtestDetail({ protest, phone = false }) {
    const p = protest || {}
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        const iv = setInterval(() => setNow(Date.now()), 30_000)
        return () => clearInterval(iv)
    }, [])
    const key = p.status?.key || "planned"
    const st = statusLabel({ ...p.status, tz: p.tz }, now) || p.status_label
    const media = mediaItems(p, API_BASE)
    const crowd = crowdLabel(p)
    const bySource = crowdSources(p)
    const pending = p.vision?.pending > 0 && !(p.vision?.photos > 0)
    const ev = arr(p.evidence).slice(0, 5)
    const dim = phone ? "var(--txt2, #c3c7cf)" : "var(--text-dim, var(--txt2))"
    const small = { fontSize: phone ? 12.5 : "var(--text-xs, 12px)", color: dim, lineHeight: 1.45 }
    return (
        <div data-testid="protest-detail" style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: phone ? 12 : "var(--space-4, 16px)" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <img src={protestIcon(key).uri} width={26} height={26} alt="" style={{ flex: "none" }} />
                <div style={{ minWidth: 0 }}>
                    <div data-testid="protest-status" style={{ fontWeight: 600, fontSize: phone ? 15 : "var(--text-sm, 13px)", lineHeight: 1.35 }}>{st}</div>
                    {p.starts_label && <div style={small}>Announced for {p.starts_label}{p.start_approx ? "" : " local time"}{p.n_sources > 1 ? ` · ${p.n_sources} posts` : ""}</div>}
                </div>
            </div>

            {(crowd || pending) && (
                <div data-testid="protest-crowd">
                    <div style={{ ...small, textTransform: "uppercase", letterSpacing: ".06em", fontSize: 10.5, marginBottom: 2 }}>Crowd</div>
                    {crowd && <div style={{ fontWeight: 600, fontSize: phone ? 14.5 : "var(--text-sm, 13px)" }}>{crowd}</div>}
                    {bySource && <div style={small}>As stated: {bySource}</div>}
                    {arr(p.vision?.notes).length > 0 && <div style={small}>From the photos: {p.vision.notes.join("; ")}</div>}
                    {pending && <div style={small}>Estimating from {p.vision.pending} photo{p.vision.pending === 1 ? "" : "s"}…</div>}
                </div>
            )}

            {media.length > 0 && (
                <div>
                    <div style={{ ...small, textTransform: "uppercase", letterSpacing: ".06em", fontSize: 10.5, marginBottom: 6 }}>
                        Photos and videos from there · {media.length}
                    </div>
                    <div data-testid="protest-media-strip" style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4,
                                                                   scrollSnapType: "x proximity", WebkitOverflowScrolling: "touch" }}>
                        {media.map((m) => (
                            <figure key={m.id} style={{ margin: 0, flex: "none", width: phone ? 132 : 120, scrollSnapAlign: "start" }}>
                                <button type="button" aria-label={`${m.type === "video" ? "Play the video" : "Open the photo"} from ${m.chat}, ${m.hhmm}`}
                                    onClick={(e) => {
                                        const img = e.currentTarget.querySelector("img")
                                        if (m.type === "video" && m.video) openMedia({ src: m.video, type: "video", poster: m.thumb, fromEl: img || e.currentTarget })
                                        else if (m.thumb) openMedia({ src: m.thumb, type: "image", fromEl: img || e.currentTarget })
                                    }}
                                    style={{ position: "relative", display: "block", width: "100%", aspectRatio: "4 / 3", padding: 0, border: 0,
                                             borderRadius: 8, overflow: "hidden", background: "#0b0d12", cursor: "pointer" }}>
                                    {m.thumb && <img src={m.thumb} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
                                    {m.type === "video" && (
                                        <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden
                                             style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)" }}>
                                            <circle cx="15" cy="15" r="14" fill="rgba(0,0,0,.55)" stroke="rgba(255,255,255,.85)" strokeWidth="1.2" />
                                            <path d="M12 9.5v11l9-5.5z" fill="#fff" />
                                        </svg>
                                    )}
                                </button>
                                <figcaption style={{ ...small, marginTop: 4 }}>
                                    <div>{m.hhmm || hhmm(m.at, p.tz)}{m.type === "video" ? " · video" : ""}</div>
                                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {m.url ? <SourceLink url={m.url} style={{ color: "inherit" }}>{m.chat}</SourceLink> : m.chat}
                                    </div>
                                </figcaption>
                            </figure>
                        ))}
                    </div>
                </div>
            )}

            {ev.length > 0 && (
                <div>
                    <div style={{ ...small, textTransform: "uppercase", letterSpacing: ".06em", fontSize: 10.5, marginBottom: 4 }}>From the ground</div>
                    {ev.map((e, i) => (
                        <div key={`${e.at}-${i}`} style={{ ...small, color: undefined, fontSize: phone ? 13 : "var(--text-xs, 12px)", marginBottom: 3 }}>
                            <span style={{ color: dim }}>{hhmm(e.at, p.tz)} · {KIND[e.kind] || "Report"}{e.dispersal ? " · dispersing" : ""}{e.distance_m != null ? ` · ${e.distance_m} m away` : ""} — </span>
                            {e.url ? <SourceLink url={e.url} style={{ color: "inherit" }}>{e.title || e.source || "post"}</SourceLink> : (e.title || e.source)}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
