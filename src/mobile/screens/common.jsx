/**
 * common.jsx — pieces every phone screen shares: severity colours, the
 * "when" label, and the sheet a signal opens into (what it is, its
 * footage or the X posts it cites, show it on the map, share it to the desk).
 */
import { useState } from "react"
import TelegramMedia from "../../components/TelegramMedia.jsx"
import XPost, { xPostId } from "../../components/XPost.jsx"
import { createPost } from "../../lib/deskApi.js"
import { whenLabel } from "../../utils/formatTime.js"

export const SEV = { critical: "var(--red, #e5484d)", significant: "var(--amber, #f5a623)", high: "var(--amber, #f5a623)",
    elevated: "var(--amber, #f5a623)", moderate: "#7aa7ff", medium: "#7aa7ff", low: "var(--txt4, #6b7280)" }
export const sevColor = (s) => SEV[String(s || "").toLowerCase()] || "var(--txt4, #6b7280)"
export const when = (ts) => (ts ? whenLabel(ts) : "")
/** A feed's time: "2 d", "14 min" — the relative part only. */
export const ago = (ts) => {
    const full = when(ts)
    const rel = full.split(" · ").pop() || full
    return rel.replace(/ ago$/, "")
}

export function Icon({ id, size = 20 }) {
    return <svg width={size} height={size} aria-hidden focusable="false"><use href={`#${id}`} /></svg>
}

export function Sheet({ onClose, children }) {
    return <>
        <div className="m2-sheet-back" onClick={onClose} />
        <div className="m2-sheet" role="dialog">
            <div className="m2-grip" />
            {children}
        </div>
    </>
}

/** What a signal is, in the form the desk takes. */
export function attachmentFor(s) {
    if (s.channel && s.msg_id) {
        return { kind: "telegram", id: s.id, channel: s.channel, msg_id: s.msg_id, channel_title: s.channel_title, headline: s.headline || s.title,
            place: s.place || null, lat: s.lat ?? null, lon: s.lon ?? null, media: s.media, thumb_url: s.thumb_url, posted_at: s.posted_at || null, graphic: !!s.graphic }
    }
    return { kind: "signal", id: String(s.id ?? s.headline), headline: s.headline || s.title || "Signal", lat: s.lat ?? null, lon: s.lon ?? null,
        meta: [s.location || s.place, s.source || s.source_type].filter(Boolean).join(" · ") || null,
        urgency: String(s.severity_tier || s.severity || s.sev || "routine").toLowerCase() }
}

const URLS = /https?:\/\/[^\s,]+/g

export function SignalSheet({ s, onClose, onShowOnMap }) {
    const [note, setNote] = useState("")
    const [shared, setShared] = useState(null)
    if (!s) return null
    const title = s.headline || s.title || "Signal"
    const where = String(s.place || s.location || s.geocoded_as || "").split(",").slice(0, 3).join(",")
    const xs = [...new Set(String(s.original_source || s.url || "").match(URLS) || [])].filter(xPostId).slice(0, 2)
    const share = async () => {
        try { await createPost({ body: note, attachment: attachmentFor(s), urgency: ["critical", "high", "elevated", "routine"].includes(String(s.severity_tier || "").toLowerCase()) ? String(s.severity_tier).toLowerCase() : undefined }); setShared("Posted to the desk.") }
        catch (e) { setShared(e.message || "Could not post") }
    }
    return (
        <Sheet onClose={onClose}>
            <div className="m2-eyebrow" style={{ color: sevColor(s.severity_tier || s.sev) }}>
                {[s.severity_tier || s.sev, when(s.posted_at || s.published_at || s.created_at || s.when), s.channel_title || s.source].filter(Boolean).join(" · ")}
            </div>
            <h2 style={{ margin: "6px 0 4px", fontSize: 19, lineHeight: 1.3 }}>{title}</h2>
            {where && <div className="m2-sub" style={{ marginBottom: 10 }}>{where}</div>}
            {(s.media === "video" || s.thumb_url) && s.channel && <div style={{ margin: "0 -14px 10px" }}><TelegramMedia post={s} maxHeight="46vh" radius="0" /></div>}
            {xs.map((u) => <XPost key={u} url={u} />)}
            {(s.summary_en || s.context || s.summary || s.why || s.detail) && (
                <p style={{ fontSize: 14, lineHeight: 1.5, color: "var(--txt2, #c3c7cf)", margin: "0 0 12px" }}>{s.summary_en || s.context || s.summary || s.why || s.detail}</p>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                {Number.isFinite(+s.lat) && Number.isFinite(+s.lon) && <button className="m2-btn" onClick={() => { onShowOnMap?.(s); onClose() }}>Show on the map</button>}
                {s.url && !xs.length && <a className="m2-btn ghost" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }} href={s.url} target="_blank" rel="noreferrer">Original</a>}
            </div>
            <div className="m2-eyebrow" style={{ marginBottom: 6 }}>Share to the desk</div>
            <textarea className="m2-input" rows={2} placeholder="What should the team know?" value={note} onChange={(e) => setNote(e.target.value)} />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                <button className="m2-btn ghost" onClick={share}>Post</button>
                {shared && <span className="m2-sub">{shared}</span>}
            </div>
        </Sheet>
    )
}

export function Row({ s, title, sub, when: w, color, onClick }) {
    return (
        <button className="m2-row" onClick={onClick}>
            <span className="m2-dot" style={{ background: color || sevColor(s?.severity_tier || s?.sev) }} />
            <span style={{ minWidth: 0 }}>
                <span className="m2-t">{title}</span>
                {sub && <span className="m2-sub">{sub}</span>}
            </span>
            <span className="m2-when">{w || ""}</span>
        </button>
    )
}
