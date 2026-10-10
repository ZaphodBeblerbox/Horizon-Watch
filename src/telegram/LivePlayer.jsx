/**
 * LivePlayer.jsx — a Telegram livestream, watched in the console.
 *
 * Opened by watchLive(id) — from the "livestream started … Click to watch"
 * notification, or the Live now strip on Home and the phone. The playlist
 * is the server's (telegram_live.py): asking for it starts pulling the
 * stream, and the server stops when nobody has asked for 45 s, so closing
 * this player ends it. Safari and the desktop app play HLS themselves;
 * elsewhere hls.js does. Closed with ✕, Escape or a click outside.
 */
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import API_BASE from "../apiBase.js"

export function watchLive(id, title = "") {
    window.dispatchEvent(new CustomEvent("plx:watch-live", { detail: { id, title } }))
}

export default function LivePlayerHost() {
    const [open, setOpen] = useState(null)
    useEffect(() => {
        const h = (e) => setOpen(e.detail || null)
        window.addEventListener("plx:watch-live", h)
        return () => window.removeEventListener("plx:watch-live", h)
    }, [])
    if (!open) return null
    return <LivePlayer id={open.id} title={open.title} onClose={() => setOpen(null)} />
}

function LivePlayer({ id, title, onClose }) {
    const video = useRef(null)
    const [state, setState] = useState("Connecting to the stream…")
    useEffect(() => {
        const k = (e) => { if (e.key === "Escape") onClose() }
        window.addEventListener("keydown", k)
        return () => window.removeEventListener("keydown", k)
    }, [onClose])
    useEffect(() => {
        const v = video.current
        if (!v) return undefined
        const url = `${API_BASE}/api/telegram/live/${encodeURIComponent(id)}/index.m3u8`
        let hls = null, dead = false
        const fail = (msg) => { if (!dead) setState(msg) }
        // ask once first: a stream that ended or failed says why
        fetch(url, { credentials: "include" }).then(async (r) => {
            if (!r.ok) { const d = await r.json().catch(() => ({})); fail(d.detail || `The stream could not be opened (${r.status}).`); return }
            if (v.canPlayType("application/vnd.apple.mpegurl")) {
                v.src = url
                v.play().catch(() => {})
            } else {
                const { default: Hls } = await import("hls.js")
                if (dead) return
                if (!Hls.isSupported()) { fail("This browser cannot play live video."); return }
                hls = new Hls({ liveSyncDurationCount: 3, manifestLoadingMaxRetry: 30, xhrSetup: (x) => { x.withCredentials = true } })
                hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) fail("The stream stopped.") })
                hls.loadSource(url)
                hls.attachMedia(v)
                hls.on(Hls.Events.MANIFEST_PARSED, () => v.play().catch(() => {}))
            }
        }).catch(() => fail("The server could not be reached."))
        const onPlay = () => setState(null)
        v.addEventListener("playing", onPlay)
        return () => { dead = true; v.removeEventListener("playing", onPlay); hls?.destroy(); v.removeAttribute("src"); v.load() }
    }, [id])
    return createPortal(
        <div role="dialog" aria-label="Telegram livestream" data-testid="live-player"
             onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
             style={{ position: "fixed", inset: 0, zIndex: 2100, background: "rgba(5,8,14,.7)", display: "grid", placeItems: "center", padding: 16 }}>
            <div style={{ width: "min(1100px, 100%)", background: "var(--glass, rgba(14,18,32,.96))", border: "1px solid var(--gline2)", boxShadow: "var(--gshadow)" }}>
                <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--gline)" }}>
                    <span style={{ font: "700 10px var(--mono)", letterSpacing: ".12em", color: "#fff", background: "#E5484D", padding: "2px 6px" }}>LIVE</span>
                    <b style={{ flex: 1, minWidth: 0, font: "600 14px var(--font)", color: "var(--txt)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title || "Telegram livestream"}</b>
                    <button onClick={onClose} aria-label="Close the stream" style={{ height: 28, width: 32, border: "1px solid var(--gline2)", background: "transparent", color: "var(--txt2)", cursor: "pointer" }}>✕</button>
                </header>
                <div style={{ position: "relative", background: "#000", aspectRatio: "16 / 9" }}>
                    <video ref={video} controls playsInline muted autoPlay style={{ width: "100%", height: "100%", display: "block" }} />
                    {state && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#cfd6e2", font: "400 13px var(--font)", padding: 20, textAlign: "center" }}>{state}</div>}
                </div>
                <div style={{ padding: "8px 14px", font: "400 11px var(--font)", color: "var(--txt-4)" }}>
                    Pulled from Telegram while you watch; nothing is recorded. Closing this stops it.
                </div>
            </div>
        </div>,
        document.body,
    )
}

/** Streams on now, as a strip of buttons (Home, the phone). */
export function LiveNow({ compact = false }) {
    const [streams, setStreams] = useState([])
    useEffect(() => {
        let live = true
        const load = () => fetch(`${API_BASE}/api/telegram/live`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null)).then((d) => { if (live && d) setStreams(d.streams || []) }).catch(() => {})
        load()
        const t = setInterval(load, 60_000)
        return () => { live = false; clearInterval(t) }
    }, [])
    if (!streams.length) return null
    return (
        <div data-testid="live-now" style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: compact ? "0 0 10px" : "0 0 12px" }}>
            {streams.map((s) => (
                <button key={s.id} onClick={() => watchLive(s.id, s.headline)}
                        style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 30, padding: "0 12px", border: "1px solid var(--gline2)",
                                 background: "var(--glass2)", color: "var(--txt)", cursor: "pointer", font: "500 12.5px var(--font)", maxWidth: "100%" }}>
                    <span style={{ width: 8, height: 8, borderRadius: 4, background: "#E5484D", boxShadow: "0 0 8px #E5484D", flex: "none" }} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.headline}</span>
                </button>
            ))}
        </div>
    )
}
