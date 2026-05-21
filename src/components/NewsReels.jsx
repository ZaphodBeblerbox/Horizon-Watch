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
    const [shorts,         setShorts]         = useState([])
    const [index,          setIndex]          = useState(0)
    const [loading,        setLoading]        = useState(true)
    const [hasInteracted,  setHasInteracted]  = useState(false)

    const playerRef        = useRef(null)
    const playerDivRef     = useRef(null)
    const hasInteractedRef = useRef(false)   // mirrors state without stale-closure
    const touchStartY      = useRef(null)
    const touchStartTime   = useRef(null)

    // Load YT API once on mount
    useEffect(() => { loadYTApi() }, [])

    // Fetch shorts
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

    // Create player ONCE when shorts first load
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
                    controls:       0,
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

    // Load new video into existing player on index change
    useEffect(() => {
        if (!shorts.length || !playerRef.current) return
        const videoId = shorts[index]?.video_id
        if (!videoId) return
        try {
            playerRef.current.loadVideoById({ videoId, startSeconds: 0 })
            if (hasInteractedRef.current) {
                playerRef.current.unMute()
                playerRef.current.setVolume(100)
            } else {
                playerRef.current.mute()
            }
        } catch (e) {
            console.warn("[reels] loadVideoById failed:", e)
        }
    }, [index, shorts])

    // Destroy player on unmount only
    useEffect(() => {
        return () => {
            if (playerRef.current) {
                try { playerRef.current.destroy() } catch (_) {}
                playerRef.current = null
            }
        }
    }, [])

    // Unmute on first interaction
    const handleTap = useCallback(() => {
        if (!hasInteractedRef.current) {
            hasInteractedRef.current = true
            setHasInteracted(true)
            try {
                playerRef.current?.unMute()
                playerRef.current?.setVolume(100)
            } catch (_) {}
        }
    }, [])

    // Touch
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
        } else {
            handleTap()
        }
    }, [goNext, goPrev, handleTap])

    // Keyboard
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
            onClick={handleTap}
            style={{
                position: "fixed", inset: 0, background: "#000",
                zIndex: 9999, display: "flex", flexDirection: "column",
                overflow: "hidden",
            }}
        >
            {/* Full-screen player div */}
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

            {/* Top bar — close button only */}
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

            {/* Bottom info overlay */}
            {current && (
                <div style={{
                    position: "absolute", bottom: 0, left: 0, right: 72, zIndex: 10,
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

            {/* Right controls */}
            <div style={{
                position: "absolute", right: 12,
                bottom: "calc(max(80px, env(safe-area-inset-bottom) + 60px))",
                zIndex: 10, display: "flex", flexDirection: "column",
                gap: 12, alignItems: "center",
            }}>
                {/* Mute toggle */}
                <button
                    onClick={(e) => { e.stopPropagation(); handleTap() }}
                    style={{
                        background: "rgba(0,0,0,0.5)", border: "1px solid rgba(255,255,255,0.15)",
                        borderRadius: "50%", width: 44, height: 44,
                        color: "white", fontSize: 18, cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        backdropFilter: "blur(8px)", fontFamily: "inherit",
                    }}
                >
                    {hasInteracted ? "🔊" : "🔇"}
                </button>

                {/* Open in YouTube */}
                <a
                    href={current?.shorts_url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    style={{
                        background: "rgba(255,59,48,0.15)", border: "1px solid rgba(255,59,48,0.3)",
                        borderRadius: "50%", width: 44, height: 44,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: "#FF3B30", fontSize: 11, fontWeight: 700,
                        textDecoration: "none", backdropFilter: "blur(8px)",
                    }}
                >YT</a>

                {/* Counter */}
                <div style={{
                    color: "rgba(255,255,255,0.5)", fontSize: 10,
                    textAlign: "center", lineHeight: 1.4,
                }}>
                    {index + 1}<br />
                    <span style={{ fontSize: 8 }}>/ {shorts.length}</span>
                </div>
            </div>

            {/* Left progress dots */}
            <div style={{
                position: "absolute", left: 8, top: "50%",
                transform: "translateY(-50%)", zIndex: 10,
                display: "flex", flexDirection: "column", gap: 3,
            }}>
                {shorts
                    .slice(Math.max(0, index - 5), Math.min(shorts.length, index + 6))
                    .map((_, i) => {
                        const actual = Math.max(0, index - 5) + i
                        return (
                            <div
                                key={actual}
                                onClick={(e) => { e.stopPropagation(); setIndex(actual) }}
                                style={{
                                    width:      3,
                                    height:     actual === index ? 24 : 5,
                                    borderRadius: 2,
                                    background: actual === index ? "white"
                                              : actual < index   ? "rgba(255,255,255,0.5)"
                                                                 : "rgba(255,255,255,0.2)",
                                    cursor: "pointer", transition: "all 0.2s",
                                }}
                            />
                        )
                    })}
            </div>

            {/* First-load hint */}
            {!hasInteracted && !loading && shorts.length > 0 && (
                <div style={{
                    position: "absolute", top: "50%", left: "50%",
                    transform: "translate(-50%, -50%)",
                    zIndex: 11, textAlign: "center", pointerEvents: "none",
                    animation: "nr-fadeout 4s forwards 1s",
                }}>
                    <div style={{
                        background: "rgba(0,0,0,0.6)", borderRadius: 12,
                        padding: "10px 16px", backdropFilter: "blur(8px)",
                    }}>
                        <div style={{ color: "white", fontSize: 13 }}>Tap to unmute</div>
                        <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, marginTop: 3 }}>
                            Swipe up/down to browse
                        </div>
                    </div>
                </div>
            )}

            <style>{`
                @keyframes nr-fadeout { 0%,80% { opacity:1; } 100% { opacity:0; } }
            `}</style>
        </div>
    )
}
