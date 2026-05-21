import { useState, useEffect, useRef, useCallback } from "react"
import API_BASE from "../apiBase.js"

// ── YouTube IFrame API loader (singleton) ─────────────────────────────────────
let ytApiLoaded   = false
let ytApiReady    = false
const ytCallbacks = []

function loadYTApi() {
    if (ytApiLoaded) return
    ytApiLoaded = true
    const tag = document.createElement("script")
    tag.src   = "https://www.youtube.com/iframe_api"
    document.head.appendChild(tag)
    window.onYouTubeIframeAPIReady = () => {
        ytApiReady = true
        ytCallbacks.forEach(cb => cb())
        ytCallbacks.length = 0
    }
}

function whenYTReady(cb) {
    if (ytApiReady) cb()
    else ytCallbacks.push(cb)
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function NewsReels({ onClose }) {
    const [shorts,  setShorts]  = useState([])
    const [index,   setIndex]   = useState(0)
    const [loading, setLoading] = useState(true)

    const playerRef    = useRef(null)
    const playerDivRef = useRef(null)
    const touchStartY  = useRef(null)
    const touchStartTime = useRef(null)

    useEffect(() => { loadYTApi() }, [])

    useEffect(() => {
        fetch(`${API_BASE}/api/news/shorts`)
            .then(r => r.json())
            .then(data => {
                setShorts(Array.isArray(data.shorts) ? data.shorts : [])
                setLoading(false)
            })
            .catch(() => setLoading(false))
    }, [])

    const goNext = useCallback(() => {
        setIndex(i => (i + 1) % shorts.length)
    }, [shorts.length])

    const goPrev = useCallback(() => {
        setIndex(i => (i - 1 + shorts.length) % shorts.length)
    }, [shorts.length])

    // Create player once on first load
    useEffect(() => {
        if (!shorts.length || loading) return
        whenYTReady(() => {
            if (!playerDivRef.current || playerRef.current) return
            playerRef.current = new window.YT.Player(playerDivRef.current, {
                videoId: shorts[0]?.video_id,
                width:   "100%",
                height:  "100%",
                playerVars: {
                    autoplay:       1,
                    mute:           1,
                    controls:       1,
                    disablekb:      1,
                    fs:             0,
                    iv_load_policy: 3,
                    modestbranding: 1,
                    playsinline:    1,
                    rel:            0,
                    origin:         window.location.origin,
                },
                events: {
                    onReady: (e) => { e.target.playVideo() },
                    onStateChange: (e) => {
                        if (e.data === window.YT.PlayerState.ENDED)
                            setIndex(i => (i + 1) % shorts.length)
                    },
                },
            })
        })
    }, [shorts, loading])

    // Load new video on index change
    useEffect(() => {
        if (!shorts.length || !playerRef.current) return
        const videoId = shorts[index]?.video_id
        if (!videoId) return
        try {
            playerRef.current.loadVideoById({ videoId, startSeconds: 0 })
            playerRef.current.mute()
        } catch (e) {
            console.warn("[reels] loadVideoById failed:", e)
        }
    }, [index, shorts])

    // Destroy on unmount
    useEffect(() => {
        return () => {
            if (playerRef.current) {
                try { playerRef.current.destroy() } catch (_) {}
                playerRef.current = null
            }
        }
    }, [])

    // Swipe only — no tap handling
    const handleTouchStart = useCallback((e) => {
        touchStartY.current    = e.touches[0].clientY
        touchStartTime.current = Date.now()
    }, [])

    const handleTouchEnd = useCallback((e) => {
        if (touchStartY.current === null) return
        const deltaY = touchStartY.current - e.changedTouches[0].clientY
        const deltaT = Date.now() - touchStartTime.current
        touchStartY.current = null
        if (Math.abs(deltaY) > 60 || (Math.abs(deltaY) > 30 && deltaT < 300)) {
            if (deltaY > 0) goNext(); else goPrev()
        }
    }, [goNext, goPrev])

    useEffect(() => {
        const onKey = (e) => {
            if (e.key === "ArrowDown") goNext()
            if (e.key === "ArrowUp")   goPrev()
            if (e.key === "Escape")    onClose()
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [goNext, goPrev, onClose])

    const current = shorts[index]

    return (
        <div
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            style={{
                position: "fixed", inset: 0, background: "#000",
                zIndex: 9999, display: "flex", flexDirection: "column",
                overflow: "hidden",
            }}
        >
            {/* Full-screen player */}
            {!loading && shorts.length > 0 && (
                <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                    <div ref={playerDivRef} style={{ width: "100%", height: "100%" }} />
                </div>
            )}

            {loading && (
                <div style={{
                    flex: 1, display: "flex", alignItems: "center",
                    justifyContent: "center",
                    color: "rgba(255,255,255,0.4)", fontSize: 13,
                }}>
                    Loading news reels…
                </div>
            )}

            {/* Close button — top right */}
            <div style={{
                position: "absolute", top: 0, left: 0, right: 0, zIndex: 10,
                padding: "calc(max(48px, env(safe-area-inset-top) + 12px)) 16px 16px",
                display: "flex", justifyContent: "flex-end",
                pointerEvents: "none",
            }}>
                <button
                    onClick={(e) => { e.stopPropagation(); onClose() }}
                    style={{
                        background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.15)",
                        borderRadius: "50%", width: 34, height: 34,
                        color: "white", fontSize: 18, cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        pointerEvents: "auto", fontFamily: "inherit",
                    }}
                >×</button>
            </div>

            {/* Bottom info: channel + title + date */}
            {current && (
                <div style={{
                    position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 10,
                    padding: "0 16px calc(max(40px, env(safe-area-inset-bottom) + 24px))",
                    background: "linear-gradient(to top, rgba(0,0,0,0.75), transparent)",
                    pointerEvents: "none",
                }}>
                    <div style={{
                        display: "inline-block",
                        background: current.channel_color + "33",
                        border: `1px solid ${current.channel_color}66`,
                        borderRadius: 20, padding: "2px 10px", marginBottom: 6,
                    }}>
                        <span style={{
                            color: current.channel_color,
                            fontSize: 10, fontWeight: 700, letterSpacing: 0.8,
                        }}>
                            {current.channel.toUpperCase()}
                        </span>
                    </div>
                    <div style={{
                        color: "white", fontSize: 14, fontWeight: 600,
                        lineHeight: 1.35, textShadow: "0 1px 6px rgba(0,0,0,0.9)",
                    }}>
                        {current.title}
                    </div>
                    <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, marginTop: 4 }}>
                        {current.published
                            ? new Date(current.published).toLocaleDateString("en-GB", {
                                day: "numeric", month: "short",
                                hour: "2-digit", minute: "2-digit",
                            })
                            : ""}
                    </div>
                </div>
            )}
        </div>
    )
}
