/**
 * TelegramMedia.jsx — a Telegram post's picture or video, in our own frame.
 *
 * Video: fetched from Telegram by the backend when opened (GET
 * /api/telegram/video/…, held for half an hour, never archived), autoplaying muted and on a
 * loop — browsers only autoplay muted — and paused by a click on it, resumed
 * by another. A small button turns the sound on. The still is the poster
 * until the video is ready, and stays if the video cannot be fetched.
 * No Telegram interface is ever shown.
 *
 * SENSITIVE CONTENT. A post the backend marks `graphic` (dead or injured
 * people — telegram_ingest.screen_graphic) opens behind a warning: the still
 * blurred past recognition, a line saying what it may show, and a button to
 * show it. Nothing is fetched or played until then. Settings → General can
 * turn the warning off.
 */
import { useEffect, useRef, useState } from "react"
import API_BASE from "../apiBase.js"
import { getSettings } from "../state/settingsStore.js"

const abs = (u) => (!u ? null : u.startsWith("http") ? u : `${API_BASE}${u}`)

/** Should this post open behind the warning? */
export function warnFor(post) {
    return !!post?.graphic && getSettings()?.media?.warnGraphic !== false
}

/** A thumbnail for a list: blurred when the post is graphic. */
export function SafeThumb({ post, src, style }) {
    const warn = warnFor(post)
    return (
        <span style={{ position: "relative", display: "inline-block", overflow: "hidden", flex: "none", background: "#000", ...style }}>
            {src && <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", filter: warn ? "blur(14px) brightness(.6)" : "none", transform: warn ? "scale(1.15)" : "none" }} />}
            {warn && <span title="Sensitive content" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#fff", font: "600 10px var(--font)", letterSpacing: ".08em", textTransform: "uppercase", textAlign: "center" }}>sensitive</span>}
        </span>
    )
}

function SensitiveCover({ still, maxHeight, radius, onShow }) {
    return (
        <div style={{ position: "relative", background: "#000", borderRadius: radius, overflow: "hidden", minHeight: 220, maxHeight, display: "grid" }}>
            {still && <img src={still} alt="" aria-hidden style={{ gridArea: "1/1", width: "100%", height: "100%", maxHeight, objectFit: "cover", filter: "blur(36px) brightness(.45)", transform: "scale(1.2)" }} />}
            <div style={{ gridArea: "1/1", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 24, textAlign: "center", color: "#fff" }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.2 2.3-2.4 3.6M6.2 6.2C4.2 7.6 2.7 9.6 2 12c1 2.5 5 7 10 7 1.8 0 3.4-.5 4.8-1.3M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>
                <span style={{ font: "600 15px var(--font)" }}>Sensitive content</span>
                <span style={{ font: "400 13px/1.5 var(--font)", color: "rgba(255,255,255,.8)", maxWidth: 360 }}>This footage may show dead or injured people.</span>
                <button onClick={(e) => { e.stopPropagation(); onShow() }} style={{ marginTop: 4, height: 32, padding: "0 16px", borderRadius: 16, border: "1px solid rgba(255,255,255,.55)", background: "rgba(255,255,255,.08)", color: "#fff", font: "500 13px var(--font)", cursor: "pointer" }}>Show</button>
            </div>
        </div>
    )
}

export function videoSrc(post) {
    const chan = post?.channel
    const mid = post?.msg_id ?? String(post?.id || "").split("-").pop()
    if (!chan || !mid) return null
    // a channel without a username ("c/<id>") goes as Telegram's "-100<id>"
    const c = String(chan).startsWith("c/") ? `-100${String(chan).slice(2)}` : String(chan)
    return `${API_BASE}/api/telegram/video/${encodeURIComponent(c)}/${mid}`
}

/* onEnded: play once and report the end (Home's reel moves on) instead of
   looping. onProgress(fraction) and onUnplayable() serve the same reel.
   muted/onMutedChange: the caller may hold the sound setting, so turning
   sound on stays on from one video to the next. */
export default function TelegramMedia({ post, maxHeight = "60vh", radius = "var(--radius)",
                                        onEnded = null, onProgress = null, onUnplayable = null,
                                        muted: mutedProp = undefined, onMutedChange = null }) {
    const v = useRef(null)
    const [failed, setFailed] = useState(false)
    const [paused, setPaused] = useState(false)
    const [mutedOwn, setMutedOwn] = useState(true)
    const muted = mutedProp === undefined ? mutedOwn : mutedProp
    const setMuted = (f) => { const next = typeof f === "function" ? f(muted) : f; if (onMutedChange) onMutedChange(next); else setMutedOwn(next) }
    const [shown, setShown] = useState(false)
    // Paused by the reader: then nothing restarts it on its own.
    const heldRef = useRef(false)
    useEffect(() => { setFailed(false); setPaused(false); if (mutedProp === undefined) setMutedOwn(true); setShown(false); heldRef.current = false }, [post?.id]) // eslint-disable-line react-hooks/exhaustive-deps
    // React sets `muted` as a property after the element exists and never
    // writes the attribute, and browsers (Safari first) then refuse to
    // autoplay. So muted is forced on the element itself and play() is
    // called as soon as there is enough to play.
    useEffect(() => { if (v.current) v.current.muted = muted }, [muted])
    const start = (el) => {
        if (!el || heldRef.current) return
        el.muted = muted
        el.defaultMuted = true
        const p = el.play()
        if (p && p.catch) p.catch(() => {})
    }
    const still = abs(post?.thumb_url)
    // Nothing to play: say so once, so a reel can move on. A video behind
    // the graphic-content warning is not unplayable — it waits for the reader.
    const covered = warnFor(post) && !shown
    const unplayable = !covered && (post?.media !== "video" || !videoSrc(post) || failed)
    useEffect(() => { if (unplayable && onUnplayable) onUnplayable() }, [unplayable, post?.id]) // eslint-disable-line react-hooks/exhaustive-deps
    if (warnFor(post) && !shown) return <SensitiveCover still={still} maxHeight={maxHeight} radius={radius} onShow={() => setShown(true)} />
    const src = post?.media === "video" ? videoSrc(post) : null

    if (src && !failed) {
        return (
            <div style={{ position: "relative", background: "#000", borderRadius: radius, overflow: "hidden" }}>
                <video ref={v} key={src} src={src} poster={still || undefined}
                       autoPlay muted={muted} loop={!onEnded} playsInline preload="auto"
                       onError={() => setFailed(true)}
                       onEnded={onEnded || undefined}
                       onTimeUpdate={onProgress ? (e) => { const el = e.currentTarget; if (el.duration) onProgress(el.currentTime / el.duration) } : undefined}
                       onLoadedData={(e) => start(e.currentTarget)} onCanPlay={(e) => { if (e.currentTarget.paused) start(e.currentTarget) }}
                       onPlay={() => setPaused(false)} onPause={() => setPaused(true)}
                       onClick={() => { const el = v.current; if (!el) return; if (el.paused) { heldRef.current = false; start(el) } else { heldRef.current = true; el.pause() } }}
                       style={{ display: "block", width: "100%", maxHeight, objectFit: "contain", cursor: "pointer" }} />
                {paused && (
                    <span aria-hidden style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none",
                                               color: "#fff", fontSize: 34, textShadow: "0 1px 6px rgba(0,0,0,.6)" }}>▶</span>
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
