/**
 * FootageTab.jsx — footage from the ground, on the phone.
 *
 * The Telegram posts the console publishes (kinetic, located, screened —
 * backend telegram_ingest.py), newest first, each with its picture or
 * video. A phone should not autoplay thirty videos at once: the list shows
 * stills with a play mark, and the one you tap plays in place (the same
 * TelegramMedia player the desktop uses, sound one tap away). "Show on
 * map" flies the phone's globe to where it was filmed.
 */
import { useEffect, useState } from "react"
import API_BASE from "../../apiBase.js"
import TelegramMedia from "../../components/TelegramMedia.jsx"
import Dots from "../../ui/Dots.jsx"
import { agoLabel } from "../../utils/formatTime.js"

const abs = (u) => (!u ? null : u.startsWith("http") ? u : `${API_BASE}${u}`)
const WINDOWS = [[24, "24 h"], [72, "3 days"], [168, "7 days"]]

export default function FootageTab({ onShowOnMap }) {
    const [hours, setHours] = useState(24)
    const [posts, setPosts] = useState(null)
    const [playing, setPlaying] = useState(null)

    useEffect(() => {
        let live = true
        const load = () => fetch(`${API_BASE}/api/telegram/posts?hours=${hours}`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (live) setPosts((d?.posts || []).filter((p) => p.thumb_url || p.media === "video")) })
            .catch(() => { if (live) setPosts((p) => p || []) })
        load()
        const t = setInterval(load, 60_000)
        return () => { live = false; clearInterval(t) }
    }, [hours])

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "10px 16px 4px" }}>
                <div style={{ font: "700 20px var(--font)" }}>Footage</div>
                <div style={{ fontSize: 12.5, color: "var(--txt-3)" }}>{posts ? `${posts.length} from the ground` : ""}</div>
            </div>
            <div className="m-chiprow">
                {WINDOWS.map(([h, label]) => (
                    <button key={h} className="chip" aria-pressed={hours === h} onClick={() => { setHours(h); setPlaying(null) }}>{label}</button>
                ))}
            </div>
            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 16px 24px" }}>
                {posts === null && <div style={{ color: "var(--txt-3)", fontSize: 14, padding: "20px 0" }}>Loading footage…</div>}
                {posts?.length === 0 && <div style={{ color: "var(--txt-3)", fontSize: 14, padding: "20px 0" }}>No footage from the ground in this window.</div>}
                {(posts || []).map((p) => {
                    const isVideo = p.media === "video"
                    const still = abs(p.thumb_url)
                    return (
                        <article key={p.id} style={{ padding: "14px 0", borderBottom: "1px solid var(--line-soft)" }}>
                            {playing === p.id ? (
                                <TelegramMedia post={{ ...p, thumb_url: still }} maxHeight="56vh" radius="8px" />
                            ) : still || isVideo ? (
                                <button className="m-tap" onClick={() => setPlaying(p.id)} aria-label={isVideo ? "Play the video" : "Show the picture"}
                                    style={{ position: "relative", display: "block", width: "100%", padding: 0, border: 0, borderRadius: 8, overflow: "hidden", background: "#000", cursor: "pointer" }}>
                                    {still
                                        ? <img src={still} alt="" loading="lazy" style={{ display: "block", width: "100%", maxHeight: "42vh", objectFit: "cover" }} />
                                        : <span style={{ display: "block", width: "100%", aspectRatio: "16 / 9" }} />}
                                    {isVideo && (
                                        <span aria-hidden style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
                                            <span style={{ width: 54, height: 54, borderRadius: "50%", background: "rgba(0,0,0,.55)", color: "#fff",
                                                           display: "grid", placeItems: "center", fontSize: 22, paddingLeft: 4 }}>▶</span>
                                        </span>
                                    )}
                                </button>
                            ) : null}
                            <div style={{ fontSize: 15.5, lineHeight: 1.4, color: "var(--txt)", margin: "10px 0 4px", fontWeight: 600 }}>{p.headline}</div>
                            <div style={{ fontSize: 12.5, color: "var(--txt-3)", lineHeight: 1.45 }}>
                                <Dots text={[p.place, p.channel_title || p.channel, agoLabel(p.posted_at)].filter(Boolean).join(" · ")} />
                            </div>
                            {p.verification && <div style={{ fontSize: 12, color: "var(--txt-4)", marginTop: 2 }}>{p.verification}</div>}
                            {p.lat != null && p.lon != null && (
                                <button className="btn m-tap" onClick={() => onShowOnMap(p.lat, p.lon)} style={{ marginTop: 8 }}>Show on map</button>
                            )}
                        </article>
                    )
                })}
            </div>
        </div>
    )
}
