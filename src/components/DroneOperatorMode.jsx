import { useState, useEffect, useRef, useCallback } from "react"

const MOCK_CLASSES = ["small-vehicle", "large-vehicle", "plane", "helicopter", "ship", "person", "storage-tank"]
const CLASS_COLORS = {
    "small-vehicle": "#22d3ee",
    "large-vehicle": "#f59e0b",
    "plane":         "#a78bfa",
    "helicopter":    "#a78bfa",
    "ship":          "#34d399",
    "person":        "#f87171",
    "storage-tank":  "#fb923c",
}
const READABLE = {
    "small-vehicle": "Vehicle (sm)",
    "large-vehicle": "Vehicle (lg)",
    "plane":         "Aircraft",
    "helicopter":    "Helicopter",
    "ship":          "Vessel",
    "person":        "Personnel",
    "storage-tank":  "Storage Tank",
}

function randomBetween(a, b) { return a + Math.random() * (b - a) }

function generateBox() {
    const cls = MOCK_CLASSES[Math.floor(Math.random() * MOCK_CLASSES.length)]
    const w = randomBetween(40, 120)
    const h = randomBetween(30, 80)
    return {
        id:   Math.random().toString(36).slice(2),
        cls,
        x:    randomBetween(0.05, 0.85),
        y:    randomBetween(0.05, 0.85),
        w:    w,
        h:    h,
        conf: randomBetween(0.62, 0.98),
        life: randomBetween(2000, 6000),
        born: Date.now(),
    }
}

function DroneCanvas({ running }) {
    const canvasRef = useRef(null)
    const boxesRef  = useRef([])
    const rafRef    = useRef(null)
    const noiseRef  = useRef(null)

    // Pre-generate noise texture
    useEffect(() => {
        const off = document.createElement("canvas")
        off.width = 256; off.height = 256
        const ctx = off.getContext("2d")
        const img = ctx.createImageData(256, 256)
        for (let i = 0; i < img.data.length; i += 4) {
            const v = Math.random() * 40
            img.data[i] = v; img.data[i+1] = v; img.data[i+2] = v; img.data[i+3] = 255
        }
        ctx.putImageData(img, 0, 0)
        noiseRef.current = off
    }, [])

    useEffect(() => {
        if (!running) {
            cancelAnimationFrame(rafRef.current)
            const canvas = canvasRef.current
            if (!canvas) return
            const ctx = canvas.getContext("2d")
            ctx.fillStyle = "#000"
            ctx.fillRect(0, 0, canvas.width, canvas.height)
            ctx.fillStyle = "rgba(148,163,184,0.35)"
            ctx.font = "13px monospace"
            ctx.textAlign = "center"
            ctx.fillText("FEED OFFLINE", canvas.width / 2, canvas.height / 2)
            return
        }

        // Seed initial boxes
        boxesRef.current = Array.from({ length: 3 }, generateBox)

        let frame = 0
        function draw() {
            const canvas = canvasRef.current
            if (!canvas) return
            const W = canvas.width
            const H = canvas.height
            const ctx = canvas.getContext("2d")
            const now = Date.now()
            frame++

            // Background — dark terrain gradient
            const grad = ctx.createLinearGradient(0, 0, 0, H)
            grad.addColorStop(0,   "#0a1628")
            grad.addColorStop(0.4, "#0d1f1a")
            grad.addColorStop(1,   "#060e14")
            ctx.fillStyle = grad
            ctx.fillRect(0, 0, W, H)

            // Noise overlay (subtle)
            if (noiseRef.current) {
                ctx.globalAlpha = 0.04
                for (let tx = 0; tx < W; tx += 256) for (let ty = 0; ty < H; ty += 256)
                    ctx.drawImage(noiseRef.current, tx, ty)
                ctx.globalAlpha = 1
            }

            // Scanlines
            ctx.fillStyle = "rgba(0,0,0,0.12)"
            for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1)

            // Grid overlay (faint)
            ctx.strokeStyle = "rgba(34,211,238,0.04)"
            ctx.lineWidth   = 1
            const gridStep = 60
            for (let x = 0; x < W; x += gridStep) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke() }
            for (let y = 0; y < H; y += gridStep) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }

            // Crosshair center
            const cx = W / 2, cy = H / 2
            const ch = 24
            ctx.strokeStyle = "rgba(34,211,238,0.6)"
            ctx.lineWidth   = 1
            ctx.beginPath(); ctx.moveTo(cx - ch, cy); ctx.lineTo(cx - 6, cy); ctx.stroke()
            ctx.beginPath(); ctx.moveTo(cx + 6, cy); ctx.lineTo(cx + ch, cy); ctx.stroke()
            ctx.beginPath(); ctx.moveTo(cx, cy - ch); ctx.lineTo(cx, cy - 6); ctx.stroke()
            ctx.beginPath(); ctx.moveTo(cx, cy + 6); ctx.lineTo(cx, cy + ch); ctx.stroke()
            ctx.strokeStyle = "rgba(34,211,238,0.3)"
            ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2); ctx.stroke()

            // Tick compass heading bar (top center)
            const headingBase = (frame * 0.18) % 360
            ctx.font = "10px monospace"
            ctx.fillStyle = "rgba(34,211,238,0.55)"
            ctx.textAlign  = "center"
            for (let d = -5; d <= 5; d++) {
                const deg = Math.round((headingBase + d * 5)) % 360
                const xp  = cx + d * 18
                ctx.fillStyle = d === 0 ? "rgba(34,211,238,0.9)" : "rgba(34,211,238,0.35)"
                ctx.fillText(deg < 0 ? deg + 360 : deg, xp, 18)
            }
            ctx.fillStyle = "#22d3ee"
            ctx.fillText("▼", cx, 27)

            // Altitude / speed left column
            ctx.textAlign  = "left"
            ctx.font       = "10px monospace"
            ctx.fillStyle  = "rgba(34,211,238,0.7)"
            const alt = (120 + Math.sin(frame * 0.01) * 5).toFixed(1)
            const spd = (38  + Math.cos(frame * 0.008) * 3).toFixed(1)
            ctx.fillText(`ALT  ${alt} m`, 10, H - 40)
            ctx.fillText(`SPD  ${spd} m/s`, 10, H - 26)
            ctx.fillText(`HDG  ${Math.round(headingBase).toString().padStart(3,"0")}°`, 10, H - 12)

            // Lat / lon right column
            ctx.textAlign = "right"
            const lat = (25.2048 + Math.sin(frame * 0.005) * 0.001).toFixed(5)
            const lon = (55.2708 + Math.cos(frame * 0.007) * 0.001).toFixed(5)
            ctx.fillText(`${lat}N`, W - 10, H - 26)
            ctx.fillText(`${lon}E`, W - 10, H - 12)

            // REC indicator
            if (Math.floor(now / 800) % 2 === 0) {
                ctx.fillStyle = "#ef4444"
                ctx.beginPath(); ctx.arc(W - 20, 14, 5, 0, Math.PI * 2); ctx.fill()
                ctx.textAlign = "right"
                ctx.fillStyle = "rgba(239,68,68,0.85)"
                ctx.font      = "10px monospace"
                ctx.fillText("REC", W - 28, 18)
            }

            // Expire + spawn boxes
            boxesRef.current = boxesRef.current.filter(b => now - b.born < b.life)
            while (boxesRef.current.length < 4) boxesRef.current.push(generateBox())

            // Draw detection boxes
            boxesRef.current.forEach(b => {
                const age    = now - b.born
                const fade   = Math.min(1, age / 300) * Math.min(1, (b.life - age) / 300)
                const color  = CLASS_COLORS[b.cls] || "#22d3ee"
                const bx     = b.x * W
                const by     = b.y * H
                // Subtle drift
                const dx     = Math.sin(age * 0.0008 + b.id.charCodeAt(0)) * 6
                const dy     = Math.cos(age * 0.0006 + b.id.charCodeAt(1)) * 4

                ctx.globalAlpha = fade * 0.85
                ctx.strokeStyle = color
                ctx.lineWidth   = 1.5

                // Corner bracket style box
                const bw = b.w, bh = b.h
                const cs = 10
                ctx.beginPath()
                ctx.moveTo(bx + dx, by + dy + cs)
                ctx.lineTo(bx + dx, by + dy)
                ctx.lineTo(bx + dx + cs, by + dy)
                ctx.stroke()
                ctx.beginPath()
                ctx.moveTo(bx + dx + bw - cs, by + dy)
                ctx.lineTo(bx + dx + bw, by + dy)
                ctx.lineTo(bx + dx + bw, by + dy + cs)
                ctx.stroke()
                ctx.beginPath()
                ctx.moveTo(bx + dx, by + dy + bh - cs)
                ctx.lineTo(bx + dx, by + dy + bh)
                ctx.lineTo(bx + dx + cs, by + dy + bh)
                ctx.stroke()
                ctx.beginPath()
                ctx.moveTo(bx + dx + bw - cs, by + dy + bh)
                ctx.lineTo(bx + dx + bw, by + dy + bh)
                ctx.lineTo(bx + dx + bw, by + dy + bh - cs)
                ctx.stroke()

                // Label
                ctx.globalAlpha = fade
                ctx.fillStyle   = color
                ctx.font        = "9px monospace"
                ctx.textAlign   = "left"
                ctx.fillText(
                    `${READABLE[b.cls] || b.cls}  ${(b.conf * 100).toFixed(0)}%`,
                    bx + dx, by + dy - 4
                )
                ctx.globalAlpha = 1
            })

            rafRef.current = requestAnimationFrame(draw)
        }

        draw()
        return () => cancelAnimationFrame(rafRef.current)
    }, [running])

    return (
        <canvas
            ref={canvasRef}
            width={880}
            height={540}
            style={{ width: "100%", height: "100%", display: "block", imageRendering: "pixelated" }}
        />
    )
}

export default function DroneOperatorMode({ onClose }) {
    const [layout,       setLayout]       = useState("split")   // "split" | "full"
    const [rtmpUrl,      setRtmpUrl]       = useState("")
    const [connected,    setConnected]     = useState(false)
    const [detections,   setDetections]    = useState([])
    const [showConfig,   setShowConfig]    = useState(false)

    // Simulate detections while connected
    useEffect(() => {
        if (!connected) return
        const spawn = () => {
            const cls = MOCK_CLASSES[Math.floor(Math.random() * MOCK_CLASSES.length)]
            setDetections(prev => [{
                id:   Math.random().toString(36).slice(2),
                cls,
                conf: randomBetween(0.62, 0.98),
                ts:   Date.now(),
            }, ...prev].slice(0, 40))
        }
        spawn()
        const iv = setInterval(spawn, randomBetween(800, 2400))
        return () => clearInterval(iv)
    }, [connected])

    const handleConnect = useCallback(() => {
        if (!rtmpUrl.trim() && !connected) return
        setConnected(v => !v)
        if (connected) setDetections([])
    }, [rtmpUrl, connected])

    const formatAge = (ts) => {
        const s = Math.floor((Date.now() - ts) / 1000)
        if (s < 60) return `${s}s ago`
        return `${Math.floor(s / 60)}m ago`
    }

    return (
        <div style={{
            display:        "flex",
            flexDirection:  "column",
            height:         "100%",
            background:     "#060e1a",
            color:          "#e2e8f0",
            fontFamily:     "monospace",
            overflow:       "hidden",
        }}>
            {/* Header bar */}
            <div style={{
                display:        "flex",
                alignItems:     "center",
                gap:            10,
                padding:        "0 14px",
                height:         40,
                background:     "rgba(8,15,30,0.95)",
                borderBottom:   "1px solid rgba(34,211,238,0.12)",
                flexShrink:     0,
            }}>
                {/* Drone icon */}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="2"/>
                    <path d="M5 5l3 3M16 5l-3 3M5 19l3-3M16 19l-3-3"/>
                    <path d="M3 5a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM17 5a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM3 19a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM17 19a2 2 0 1 0 4 0 2 2 0 0 0-4 0z"/>
                </svg>
                <span style={{ fontSize: 11, letterSpacing: "0.1em", fontWeight: 700, color: "#22d3ee", textTransform: "uppercase" }}>Drone Operator</span>

                {/* Connection status */}
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginLeft: 8 }}>
                    <span style={{
                        width: 7, height: 7, borderRadius: "50%",
                        background: connected ? "#22c55e" : "#4b5563",
                        boxShadow: connected ? "0 0 6px #22c55e" : "none",
                    }} />
                    <span style={{ fontSize: 10, color: connected ? "#86efac" : "#6b7280", letterSpacing: "0.06em" }}>
                        {connected ? "LIVE" : "OFFLINE"}
                    </span>
                </div>

                <div style={{ flex: 1 }} />

                {/* Layout toggle */}
                <div style={{ display: "flex", gap: 2 }}>
                    {["split", "full"].map(m => (
                        <button key={m} onClick={() => setLayout(m)} style={{
                            padding:      "3px 10px",
                            background:   layout === m ? "rgba(34,211,238,0.15)" : "none",
                            border:       `1px solid ${layout === m ? "rgba(34,211,238,0.4)" : "rgba(255,255,255,0.08)"}`,
                            borderRadius: 4,
                            color:        layout === m ? "#22d3ee" : "#64748b",
                            fontSize:     10,
                            cursor:       "pointer",
                            letterSpacing:"0.06em",
                            textTransform:"uppercase",
                        }}>
                            {m === "split" ? "⊞ Split" : "⊡ Full"}
                        </button>
                    ))}
                </div>

                {/* Config toggle */}
                <button onClick={() => setShowConfig(v => !v)} title="RTMP Configuration" style={{
                    width: 28, height: 28,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: showConfig ? "rgba(34,211,238,0.12)" : "none",
                    border: "1px solid rgba(34,211,238,0.15)", borderRadius: 4,
                    cursor: "pointer",
                    color: showConfig ? "#22d3ee" : "#64748b",
                }}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="8" cy="8" r="2.5"/>
                        <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.9 11.9l1.05 1.05M3.05 12.95l1.06-1.06M11.9 4.1l1.05-1.05"/>
                    </svg>
                </button>

                {onClose && (
                    <button onClick={onClose} style={{
                        width: 28, height: 28,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "#64748b",
                        fontSize: 16,
                    }}>×</button>
                )}
            </div>

            {/* RTMP config strip */}
            {showConfig && (
                <div style={{
                    display:      "flex",
                    alignItems:   "center",
                    gap:          10,
                    padding:      "8px 14px",
                    background:   "rgba(8,15,30,0.9)",
                    borderBottom: "1px solid rgba(34,211,238,0.08)",
                    flexShrink:   0,
                }}>
                    <span style={{ fontSize: 10, color: "#64748b", letterSpacing: "0.08em", flexShrink: 0 }}>RTMP URL</span>
                    <input
                        value={rtmpUrl}
                        onChange={e => setRtmpUrl(e.target.value)}
                        placeholder="rtmp://host:1935/live/streamkey"
                        style={{
                            flex:        1,
                            background:  "rgba(255,255,255,0.04)",
                            border:      "1px solid rgba(34,211,238,0.2)",
                            borderRadius: 4,
                            padding:     "4px 8px",
                            color:       "#e2e8f0",
                            fontSize:    11,
                            fontFamily:  "monospace",
                            outline:     "none",
                        }}
                        onKeyDown={e => e.key === "Enter" && handleConnect()}
                    />
                    <button onClick={handleConnect} style={{
                        padding:      "4px 14px",
                        background:   connected ? "rgba(239,68,68,0.15)" : "rgba(34,211,238,0.15)",
                        border:       `1px solid ${connected ? "rgba(239,68,68,0.4)" : "rgba(34,211,238,0.4)"}`,
                        borderRadius: 4,
                        color:        connected ? "#fca5a5" : "#22d3ee",
                        fontSize:     10,
                        cursor:       "pointer",
                        letterSpacing:"0.08em",
                        textTransform:"uppercase",
                        flexShrink:   0,
                    }}>
                        {connected ? "Disconnect" : "Connect"}
                    </button>
                </div>
            )}

            {/* Body */}
            <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
                {/* Video feed */}
                <div style={{
                    flex:     layout === "split" ? "0 0 62%" : 1,
                    minWidth: 0,
                    position: "relative",
                    background: "#000",
                    borderRight: layout === "split" ? "1px solid rgba(34,211,238,0.1)" : "none",
                }}>
                    <DroneCanvas running={connected} />

                    {/* Offline connect overlay */}
                    {!connected && !showConfig && (
                        <div style={{
                            position:  "absolute", inset: 0,
                            display:   "flex", flexDirection: "column",
                            alignItems:"center", justifyContent: "center",
                            gap: 12,
                        }}>
                            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(34,211,238,0.3)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="2"/>
                                <path d="M5 5l3 3M16 5l-3 3M5 19l3-3M16 19l-3-3"/>
                                <path d="M3 5a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM17 5a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM3 19a2 2 0 1 0 4 0 2 2 0 0 0-4 0zM17 19a2 2 0 1 0 4 0 2 2 0 0 0-4 0z"/>
                            </svg>
                            <p style={{ margin: 0, fontSize: 11, color: "rgba(148,163,184,0.5)", letterSpacing: "0.1em" }}>NO FEED</p>
                            <button onClick={() => setShowConfig(true)} style={{
                                padding:      "5px 16px",
                                background:   "rgba(34,211,238,0.1)",
                                border:       "1px solid rgba(34,211,238,0.3)",
                                borderRadius: 4,
                                color:        "#22d3ee",
                                fontSize:     10,
                                cursor:       "pointer",
                                letterSpacing:"0.08em",
                            }}>Configure RTMP</button>
                        </div>
                    )}
                </div>

                {/* Detections panel */}
                {layout === "split" && (
                    <div style={{
                        flex:          "0 0 38%",
                        display:       "flex",
                        flexDirection: "column",
                        overflow:      "hidden",
                        background:    "#060e1a",
                    }}>
                        <div style={{
                            padding:      "8px 12px 6px",
                            borderBottom: "1px solid rgba(34,211,238,0.08)",
                            flexShrink:   0,
                        }}>
                            <span style={{ fontSize: 10, letterSpacing: "0.1em", color: "#64748b", textTransform: "uppercase" }}>
                                Detections
                            </span>
                            {detections.length > 0 && (
                                <span style={{
                                    marginLeft: 8,
                                    background: "rgba(34,211,238,0.15)",
                                    color:      "#22d3ee",
                                    fontSize:   9,
                                    padding:    "1px 6px",
                                    borderRadius: 3,
                                    fontWeight: 700,
                                }}>
                                    {detections.length}
                                </span>
                            )}
                        </div>

                        <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
                            {detections.length === 0 && (
                                <div style={{ padding: "20px 12px", fontSize: 11, color: "#374151", textAlign: "center" }}>
                                    {connected ? "Waiting for detections…" : "Connect feed to begin"}
                                </div>
                            )}
                            {detections.map(d => {
                                const color = CLASS_COLORS[d.cls] || "#22d3ee"
                                return (
                                    <div key={d.id} style={{
                                        display:     "flex",
                                        alignItems:  "center",
                                        gap:         8,
                                        padding:     "5px 12px",
                                        borderBottom:"1px solid rgba(255,255,255,0.03)",
                                    }}>
                                        <span style={{
                                            width: 8, height: 8, borderRadius: "50%",
                                            background: color, flexShrink: 0,
                                            boxShadow: `0 0 5px ${color}66`,
                                        }} />
                                        <span style={{ flex: 1, fontSize: 11, color: "#cbd5e1" }}>
                                            {READABLE[d.cls] || d.cls}
                                        </span>
                                        <span style={{ fontSize: 10, color, fontWeight: 700 }}>
                                            {(d.conf * 100).toFixed(0)}%
                                        </span>
                                        <span style={{ fontSize: 9, color: "#374151", minWidth: 42, textAlign: "right" }}>
                                            {formatAge(d.ts)}
                                        </span>
                                    </div>
                                )
                            })}
                        </div>

                        {/* Stats footer */}
                        {detections.length > 0 && (
                            <div style={{
                                padding:   "6px 12px",
                                borderTop: "1px solid rgba(34,211,238,0.08)",
                                flexShrink: 0,
                                display:   "flex",
                                gap:       16,
                            }}>
                                {Object.entries(
                                    detections.reduce((acc, d) => {
                                        acc[d.cls] = (acc[d.cls] || 0) + 1; return acc
                                    }, {})
                                ).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([cls, n]) => (
                                    <div key={cls} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                                        <span style={{ fontSize: 13, fontWeight: 700, color: CLASS_COLORS[cls] || "#22d3ee" }}>{n}</span>
                                        <span style={{ fontSize: 8, color: "#4b5563", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                                            {READABLE[cls]?.split(" ")[0] || cls}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
