// Passive globe auto-mode.
// Fetches news events, flies to each one, shows a minimal tooltip,
// then moves to the next. Runs a continuous loop while enabled.
// Must be rendered inside a resium <Viewer> so useCesium() works.

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useCesium } from "resium"
import {
    Cartesian3, EasingFunction, SceneTransforms,
} from "cesium"
import API_BASE from "../apiBase.js"

const SEV_COLORS = {
    critical: "#FF3B30",
    high:     "#FF9500",
    medium:   "#FFCC00",
    low:      "#8E8E93",
}

function relTime(iso) {
    if (!iso) return ""
    const diff = Date.now() - new Date(iso).getTime()
    if (diff < 60_000)    return "just now"
    if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`
    if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`
    return `${Math.round(diff / 86_400_000)}d ago`
}

function shuffle(arr) {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
}

function buildSequence(events) {
    // Bucket into 10 longitude slices (west → east), pick ≤ 2 per bucket
    const buckets = Array.from({ length: 10 }, () => [])
    events.forEach(ev => {
        const lon = ev.lon ?? ev.lng ?? ev.longitude ?? 0
        const idx = Math.min(9, Math.max(0, Math.floor(((lon + 180) / 360) * 10)))
        buckets[idx].push(ev)
    })
    const seq = []
    buckets.forEach(b => seq.push(...shuffle(b).slice(0, 2)))
    return seq.filter(ev => {
        const lat = ev.lat ?? ev.latitude
        const lon = ev.lon ?? ev.longitude ?? ev.lng
        return lat != null && lon != null && isFinite(lat) && isFinite(lon)
    })
}

function sleep(ms, cancelRef) {
    return new Promise(resolve => {
        let done = false
        const finish = () => { if (!done) { done = true; resolve() } }
        const t = setTimeout(finish, ms)
        const chk = setInterval(() => { if (cancelRef.current) { clearTimeout(t); clearInterval(chk); finish() } }, 80)
        setTimeout(() => clearInterval(chk), ms + 300)
    })
}

export default function GlobeAutoMode({ enabled, isMobile = false }) {
    const { viewer } = useCesium()
    const cancelRef   = useRef(false)
    const rotateRef   = useRef(false)
    const evRef       = useRef(null)  // current event (for position updates)
    const frameRef    = useRef(null)

    const [tooltip, setTooltip] = useState(null)
    // { ev, x, y, opacity }

    // ── Gentle rotation during hold ──────────────────────────────────────────
    useEffect(() => {
        if (!viewer) return
        const cb = () => { if (rotateRef.current) viewer.scene.camera.rotateRight(0.00003) }
        viewer.scene.postRender.addEventListener(cb)
        return () => { try { viewer.scene.postRender.removeEventListener(cb) } catch (_) {} }
    }, [viewer])

    // ── Track tooltip screen position every frame ────────────────────────────
    useEffect(() => {
        if (frameRef.current) { cancelAnimationFrame(frameRef.current); frameRef.current = null }
        if (!viewer || !tooltip) return

        const tick = () => {
            const ev = evRef.current
            if (!ev) return
            const lat = ev.lat ?? ev.latitude
            const lon = ev.lon ?? ev.longitude ?? ev.lng
            try {
                const sp = SceneTransforms.worldToWindowCoordinates(
                    viewer.scene,
                    Cartesian3.fromDegrees(lon, lat)
                )
                if (sp) setTooltip(prev => prev ? { ...prev, x: sp.x, y: sp.y } : prev)
            } catch (_) {}
            frameRef.current = requestAnimationFrame(tick)
        }
        frameRef.current = requestAnimationFrame(tick)
        return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current) }
    }, [viewer, !!tooltip])

    // ── Main sequence loop ───────────────────────────────────────────────────
    useEffect(() => {
        if (!enabled || !viewer) {
            setTooltip(null); evRef.current = null; rotateRef.current = false; return
        }
        cancelRef.current = false

        async function run() {
            let events = []
            try {
                const r = await fetch(`${API_BASE}/api/v2/events?mode=events&max_age_hours=168&limit=300`)
                if (r.ok) { const d = await r.json(); events = d?.events ?? [] }
            } catch (_) {}

            if (cancelRef.current || !events.length) return

            let seq = buildSequence(events)
            if (!seq.length) return

            while (!cancelRef.current) {
                for (const ev of seq) {
                    if (cancelRef.current) break
                    const lat = ev.lat ?? ev.latitude
                    const lon = ev.lon ?? ev.longitude ?? ev.lng
                    if (lat == null || lon == null) continue

                    // 1. Fly
                    rotateRef.current = false
                    const currentAlt = viewer.camera.positionCartographic?.height ?? 8_000_000
                    await new Promise(res => {
                        viewer.camera.flyTo({
                            destination:    Cartesian3.fromDegrees(lon, lat, currentAlt),
                            duration:       4.0,
                            easingFunction: EasingFunction.SINUSOIDAL_IN_OUT,
                            complete: res, cancel: res,
                        })
                    })
                    if (cancelRef.current) break

                    // 2. Initial screen position
                    let sp = null
                    try {
                        sp = SceneTransforms.worldToWindowCoordinates(
                            viewer.scene, Cartesian3.fromDegrees(lon, lat)
                        )
                    } catch (_) {}

                    evRef.current = ev
                    setTooltip({ ev, x: sp?.x ?? 0, y: sp?.y ?? 0, opacity: 1 })
                    rotateRef.current = true

                    // 3. Hold 20–30s
                    await sleep(20_000 + Math.random() * 10_000, cancelRef)
                    if (cancelRef.current) break

                    // 4. Fade out
                    setTooltip(prev => prev ? { ...prev, opacity: 0 } : null)
                    await sleep(550, cancelRef)
                    setTooltip(null); evRef.current = null; rotateRef.current = false

                    // 5. Brief pause before next
                    await sleep(1000, cancelRef)
                }
                if (!cancelRef.current) seq = buildSequence(events) // reshuffle
            }
            setTooltip(null); evRef.current = null; rotateRef.current = false
        }

        run()
        return () => {
            cancelRef.current = true
            setTooltip(null); evRef.current = null; rotateRef.current = false
            if (frameRef.current) { cancelAnimationFrame(frameRef.current); frameRef.current = null }
        }
    }, [enabled, viewer, isMobile])

    if (!tooltip) return null

    const { ev, x, y, opacity } = tooltip
    const sev   = (ev?.severity || "low").toLowerCase()
    const color = SEV_COLORS[sev] || SEV_COLORS.low
    const title = ev?.title || ev?.headline || ev?.summary || "Intelligence Event"
    const loc   = ev?.country || ev?.location || ev?.theater || ev?.region || ""
    const ts    = ev?.published_at || ev?.created_at || ev?.timestamp

    // Position: tooltip floats above-right of the screen point
    // Mobile: pin to bottom centre
    const TW = 240
    const tipX = isMobile ? "50%" : Math.min(x + 48, window.innerWidth - TW - 12)
    const tipY = isMobile ? "auto"  : Math.max(8, y - 88)
    const tipB = isMobile ? 76     : "auto"
    const xform = isMobile ? "translateX(-50%)" : "none"

    // Line from event screen point to tooltip left-centre
    const lineX2 = isMobile ? window.innerWidth / 2 - TW / 2 : tipX
    const lineY2 = isMobile ? window.innerHeight - 76 - 40    : (y - 88) + 40

    return createPortal(
        <>
            {/* Connector line */}
            {!isMobile && (
                <svg style={{
                    position: "fixed", inset: 0, width: "100%", height: "100%",
                    zIndex: 1999, pointerEvents: "none", overflow: "visible",
                }}>
                    <line
                        x1={x} y1={y}
                        x2={lineX2} y2={lineY2}
                        stroke={color}
                        strokeWidth={1.5}
                        strokeOpacity={opacity * 0.4}
                    />
                </svg>
            )}

            {/* Tooltip card */}
            <div style={{
                position:        "fixed",
                left:            tipX,
                top:             tipY,
                bottom:          tipB,
                transform:       xform,
                maxWidth:        TW,
                minWidth:        180,
                background:      "rgba(8,12,22,0.90)",
                border:          "1px solid rgba(255,255,255,0.07)",
                borderLeft:      `3px solid ${color}`,
                borderRadius:    7,
                padding:         "10px 12px",
                zIndex:          2000,
                opacity,
                transition:      "opacity 0.5s ease",
                pointerEvents:   "none",
                fontFamily:      "system-ui, -apple-system, sans-serif",
                backdropFilter:  "blur(10px)",
                WebkitBackdropFilter: "blur(10px)",
                boxShadow:       "0 6px 28px rgba(0,0,0,0.55)",
            }}>
                <div style={{
                    color: "#f1f5f9", fontSize: 12, fontWeight: 600,
                    lineHeight: 1.45, marginBottom: 4,
                    overflow: "hidden", display: "-webkit-box",
                    WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                }}>
                    {title}
                </div>
                {loc && (
                    <div style={{ color: "#475569", fontSize: 10, marginBottom: 2 }}>{loc}</div>
                )}
                {ts && (
                    <div style={{ color: "#334155", fontSize: 10 }}>{relTime(ts)}</div>
                )}
                <div style={{
                    marginTop: 6, display: "inline-block",
                    background: `${color}1a`, color, fontSize: 8,
                    fontWeight: 700, letterSpacing: "0.08em",
                    padding: "1px 5px", borderRadius: 3,
                }}>
                    {sev.toUpperCase()}
                </div>
            </div>
        </>,
        document.body
    )
}
