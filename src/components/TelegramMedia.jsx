/**
 * TelegramMedia.jsx — a Telegram post's picture or video, in our own frame.
 *
 * Video: fetched from Telegram by the backend when opened (GET
 * /api/telegram/video/…, held for half an hour, never archived), autoplaying muted and on a
 * loop — browsers only autoplay muted — and paused by a click on it, resumed
 * by another. A small button turns the sound on. The still is the poster
 * until the video is ready, and stays if the video cannot be fetched.
 * No Telegram interface is ever shown.
 */
import { useEffect, useRef, useState } from "react"
import API_BASE from "../apiBase.js"
import { captureFrame } from "../locate/frames.js"

const abs = (u) => (!u ? null : u.startsWith("http") ? u : `${API_BASE}${u}`)

export function videoSrc(post) {
    const chan = post?.channel
    const mid = post?.msg_id ?? String(post?.id || "").split("-").pop()
    return chan && !String(chan).startsWith("c/") ? `${API_BASE}/api/telegram/video/${encodeURIComponent(chan)}/${mid}` : null
}

export default function TelegramMedia({ post, maxHeight = "60vh", radius = "var(--radius)" }) {
    const v = useRef(null)
    const [failed, setFailed] = useState(false)
    const [paused, setPaused] = useState(false)
    const [muted, setMuted] = useState(true)
    useEffect(() => { setFailed(false); setPaused(false); setMuted(true) }, [post?.id])
    const still = abs(post?.thumb_url)
    const src = post?.media === "video" ? videoSrc(post) : null

    if (src && !failed) {
        return (
            <div style={{ position: "relative", background: "#000", borderRadius: radius, overflow: "hidden" }}>
                <video ref={v} key={src} src={src} poster={still || undefined} crossOrigin="use-credentials"
                       autoPlay muted={muted} loop playsInline preload="auto"
                       onError={() => setFailed(true)}
                       onPlay={() => setPaused(false)} onPause={() => setPaused(true)}
                       onClick={() => { const el = v.current; if (!el) return; if (el.paused) el.play().catch(() => {}); else el.pause() }}
                       style={{ display: "block", width: "100%", maxHeight, objectFit: "contain", cursor: "pointer" }} />
                {paused && (
                    <span aria-hidden style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none",
                                               color: "#fff", fontSize: 34, textShadow: "0 1px 6px rgba(0,0,0,.6)" }}>▶</span>
                )}
                {/* LOCATE THIS FRAME: pause where the place shows best, and
                    the Locate workbench opens on exactly that screenshot. */}
                {post?.channel && !String(post.channel).startsWith("c/") && (
                    <button onClick={(e) => {
                                e.stopPropagation()
                                const el = v.current
                                if (!el) return
                                el.pause()
                                const frame = captureFrame(el)
                                window.dispatchEvent(new CustomEvent("akili:locate", { detail: { post, frame, frameAt: el.currentTime } }))
                            }}
                            title="Pause where the place shows best, then locate from this exact frame"
                            style={{ position: "absolute", left: 8, bottom: 8, border: 0, borderRadius: 4, padding: "3px 8px",
                                     background: paused ? "rgba(0,0,0,.75)" : "rgba(0,0,0,.55)", color: "#fff", font: "500 11px var(--font)", cursor: "pointer" }}>
                        ⌖ Locate this frame
                    </button>
                )}
                <button onClick={(e) => { e.stopPropagation(); setMuted((m) => !m) }}
                        title={muted ? "Sound on" : "Sound off"} aria-label={muted ? "Sound on" : "Sound off"}
                        style={{ position: "absolute", right: 8, bottom: 8, border: 0, borderRadius: 4, padding: "3px 7px",
                                 background: "rgba(0,0,0,.55)", color: "#fff", font: "500 11px var(--font)", cursor: "pointer" }}>
                    {muted ? "🔇 sound" : "🔊 on"}
                </button>
            </div>
        )
    }
    if (!still) return null
    return <img src={still} alt={post?.headline || ""} style={{ display: "block", width: "100%", maxHeight, objectFit: "contain", borderRadius: radius, background: "#000" }} />
}
