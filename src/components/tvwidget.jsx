import { useState, useRef, useEffect } from "react"
import { TV_CHANNELS } from "./tvchannels.js"

const GLASS = {
    background: "rgba(13,17,28,0.96)",
    backdropFilter: "blur(12px)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 12,
    boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
    color: "#fff",
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
}

function createDragHandler(panelRef, setPos, containerRef) {
    return (e) => {
        e.preventDefault()
        const panelEl = panelRef.current
        const containerEl = containerRef ? containerRef.current : document.body
        if (!panelEl) return

        const panelRect = panelEl.getBoundingClientRect()
        const containerRect = containerEl ? containerEl.getBoundingClientRect() : { top: 0, left: 0 }
        const startTop  = panelRect.top  - containerRect.top
        const startLeft = panelRect.left - containerRect.left
        const startMouseX = e.clientX
        const startMouseY = e.clientY

        setPos({ top: startTop, left: startLeft })

        const onMove = (me) => setPos({
            top:  startTop  + (me.clientY - startMouseY),
            left: startLeft + (me.clientX - startMouseX),
        })
        const onUp = () => {
            window.removeEventListener("mousemove", onMove)
            window.removeEventListener("mouseup", onUp)
        }
        window.addEventListener("mousemove", onMove)
        window.addEventListener("mouseup", onUp)
    }
}

export default function TVWidget({ onClose, containerRef }) {
    const [channelIndex, setChannelIndex] = useState(0)
    const [minimised, setMinimised]       = useState(false)
    const [showBias, setShowBias]         = useState(false)
    const [pos, setPos]                   = useState(null)  // null = use default CSS position
    const panelRef = useRef(null)

    const ch = TV_CHANNELS[channelIndex]
    const total = TV_CHANNELS.length

    const prev = () => setChannelIndex(i => (i - 1 + total) % total)
    const next = () => setChannelIndex(i => (i + 1) % total)

    // Reset position when opened fresh
    useEffect(() => { setPos(null) }, [])

    const posStyle = pos
        ? { position: "fixed", top: pos.top, left: pos.left, bottom: "auto", right: "auto" }
        : { position: "fixed", bottom: 24, left: 24 }

    return (
        <div
            ref={panelRef}
            style={{
                ...GLASS,
                ...posStyle,
                width: 340,
                zIndex: 3000,
                overflow: "hidden",
                userSelect: "none",
            }}
        >
            {/* Header / drag handle */}
            <div
                onMouseDown={createDragHandler(panelRef, setPos, containerRef)}
                style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "10px 12px",
                    borderBottom: minimised ? "none" : "1px solid rgba(255,255,255,0.08)",
                    cursor: "grab",
                    background: "rgba(255,255,255,0.04)",
                }}
            >
                {/* Channel colour dot */}
                <div style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: ch.color, flexShrink: 0,
                    boxShadow: `0 0 6px ${ch.color}`,
                }} />

                {/* LIVE badge */}
                <div style={{
                    fontSize: 9, fontWeight: 700,
                    background: "#ef4444", color: "#fff",
                    padding: "1px 5px", borderRadius: 4,
                    letterSpacing: 1, flexShrink: 0,
                }}>LIVE</div>

                <span style={{ fontSize: 12, fontWeight: 600, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {ch.name}
                </span>

                {/* Minimise */}
                <button
                    onClick={() => setMinimised(v => !v)}
                    style={{ background: "none", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer", fontSize: 14, padding: "0 2px", lineHeight: 1 }}
                    title={minimised ? "Expand" : "Minimise"}
                >
                    {minimised ? "▲" : "▼"}
                </button>

                {/* Close */}
                <button
                    onClick={onClose}
                    style={{ background: "none", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer", fontSize: 16, padding: "0 2px", lineHeight: 1 }}
                    title="Close"
                >
                    ×
                </button>
            </div>

            {!minimised && (
                <>
                    {/* YouTube embed */}
                    <div style={{ position: "relative", width: "100%", paddingBottom: "56.25%", background: "#000" }}>
                        <iframe
                            key={ch.youtubeId}
                            src={`https://www.youtube.com/embed/${ch.youtubeId}?autoplay=1&mute=0&controls=1&rel=0&modestbranding=1`}
                            title={ch.name}
                            allow="autoplay; encrypted-media; fullscreen"
                            allowFullScreen
                            style={{
                                position: "absolute", top: 0, left: 0,
                                width: "100%", height: "100%",
                                border: "none",
                            }}
                        />
                    </div>

                    {/* Channel navigation */}
                    <div style={{ display: "flex", alignItems: "center", padding: "8px 12px", gap: 8, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                        <button onClick={prev} style={navBtnStyle}>‹</button>
                        <div style={{ flex: 1, textAlign: "center" }}>
                            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>
                                {channelIndex + 1} / {total} · {ch.region} · {ch.language}
                            </div>
                        </div>
                        <button onClick={next} style={navBtnStyle}>›</button>
                    </div>

                    {/* Channel list */}
                    <div style={{ maxHeight: 160, overflowY: "auto", padding: "4px 0" }}>
                        {TV_CHANNELS.map((c, i) => (
                            <div
                                key={c.id}
                                onClick={() => setChannelIndex(i)}
                                style={{
                                    display: "flex", alignItems: "center", gap: 8,
                                    padding: "5px 12px",
                                    cursor: "pointer",
                                    background: i === channelIndex ? "rgba(255,255,255,0.07)" : "transparent",
                                    transition: "background 120ms",
                                }}
                                onMouseEnter={e => { if (i !== channelIndex) e.currentTarget.style.background = "rgba(255,255,255,0.04)" }}
                                onMouseLeave={e => { if (i !== channelIndex) e.currentTarget.style.background = "transparent" }}
                            >
                                <div style={{ width: 6, height: 6, borderRadius: "50%", background: c.color, flexShrink: 0 }} />
                                <span style={{ fontSize: 11, flex: 1, color: i === channelIndex ? "#fff" : "rgba(255,255,255,0.6)" }}>
                                    {c.name}
                                </span>
                                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>{c.region}</span>
                            </div>
                        ))}
                    </div>

                    {/* Bias / allegiance toggle */}
                    <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "6px 12px" }}>
                        <div
                            onClick={() => setShowBias(v => !v)}
                            style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                        >
                            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: 1 }}>
                                Editorial stance
                            </span>
                            <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", marginLeft: "auto" }}>
                                {showBias ? "▲" : "▼"}
                            </span>
                        </div>
                        {showBias && (
                            <div style={{ marginTop: 5 }}>
                                <div style={{ fontSize: 10, fontWeight: 600, color: ch.color, marginBottom: 3 }}>
                                    {ch.bias}
                                </div>
                                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>
                                    {ch.allegiance}
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    )
}

const navBtnStyle = {
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.12)",
    color: "#fff",
    borderRadius: 6,
    width: 28, height: 28,
    cursor: "pointer",
    fontSize: 18,
    display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0,
    lineHeight: 1,
    padding: 0,
}
