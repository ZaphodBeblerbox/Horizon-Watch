/**
 * ScreenCapture.jsx — take a picture of any part of the screen, crop it,
 * and keep it where the work is.
 *
 * WHY NOT "JUST USE THE OS SCREENSHOT TOOL". The point is not the image,
 * it is that the image lands in the Saved pane and from there in a
 * document, captioned. A system screenshot goes to Downloads and has to be
 * found, dragged and labelled by hand — enough friction that people stop.
 *
 * HOW IT CAPTURES. html2canvas rasterises the live DOM, which covers the
 * charts, the panels and the document. It cannot read inside a WebGL
 * canvas, which is what the globe is, so the globe is read from Cesium's
 * own buffer and composited into the clone. Skipping that yields a black
 * rectangle where the map was — the classic failure of DOM rasterisers on
 * a 3D page.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { saveForBriefing } from "../state/savedForBriefing.js"
import { toast } from "../ui/toast.js"

/** Ask Cesium for its own pixels — a DOM rasteriser cannot reach them. */
function cesiumDataUrl() {
    try {
        const cv = document.querySelector(".cesium-widget canvas")
        if (!cv) return null
        // Cesium clears its drawing buffer after each frame, so a plain
        // toDataURL usually returns transparent black. Forcing a render
        // immediately before the read is what makes the buffer valid at
        // the moment it is sampled.
        const viewer = window.__parallaxViewer
        if (viewer?.scene && !viewer.isDestroyed?.()) viewer.scene.render()
        return cv.toDataURL("image/png")
    } catch {
        return null
    }
}

export default function ScreenCapture({ open, onClose, onCaptured }) {
    const [rect, setRect] = useState(null)
    const [busy, setBusy] = useState(false)
    const startRef = useRef(null)

    useEffect(() => { if (!open) { setRect(null); startRef.current = null } }, [open])

    useEffect(() => {
        if (!open) return
        const onKey = (e) => { if (e.key === "Escape") onClose?.() }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [open, onClose])

    const down = (e) => {
        startRef.current = { x: e.clientX, y: e.clientY }
        setRect({ x: e.clientX, y: e.clientY, w: 0, h: 0 })
    }
    const move = (e) => {
        const s = startRef.current
        if (!s) return
        setRect({
            x: Math.min(s.x, e.clientX), y: Math.min(s.y, e.clientY),
            w: Math.abs(e.clientX - s.x), h: Math.abs(e.clientY - s.y),
        })
    }

    const up = useCallback(async () => {
        const r = rect
        startRef.current = null
        // A click with no drag is a cancel, not a one-pixel capture.
        if (!r || r.w < 8 || r.h < 8) { setRect(null); return }
        setBusy(true)
        try {
            const { default: html2canvas } = await import("html2canvas")
            const globe = cesiumDataUrl()
            const shot = await html2canvas(document.body, {
                x: r.x + window.scrollX, y: r.y + window.scrollY,
                width: r.w, height: r.h,
                backgroundColor: null,
                scale: window.devicePixelRatio || 1,
                logging: false,
                useCORS: true,
                // The overlay is doing the capturing; including it would
                // put the selection rectangle in the picture.
                ignoreElements: (el) => el.dataset?.captureOverlay === "1",
                onclone: (doc) => {
                    if (!globe) return
                    const cv = doc.querySelector(".cesium-widget canvas")
                    if (!cv) return
                    const img = doc.createElement("img")
                    img.src = globe
                    img.style.cssText = "position:absolute;inset:0;width:100%;height:100%"
                    cv.parentNode?.insertBefore(img, cv)
                    cv.style.visibility = "hidden"
                },
            })
            onCaptured?.(shot.toDataURL("image/png"), r)
        } catch (e) {
            toast(`Capture failed: ${e?.message || e}`, { icon: "i-alert" })
        } finally {
            setBusy(false); setRect(null); onClose?.()
        }
    }, [rect, onCaptured, onClose])

    if (!open) return null

    return (
        <div
            data-capture-overlay="1"
            onMouseDown={down} onMouseMove={move} onMouseUp={up}
            style={{ position: "fixed", inset: 0, zIndex: 4000, cursor: "crosshair", background: "rgba(8,10,13,.28)" }}
        >
            <div style={{
                position: "absolute", top: 14, left: "50%", transform: "translateX(-50%)",
                padding: "6px 12px", borderRadius: 3, background: "var(--bg-2, #1e212c)",
                border: "1px solid var(--line)", font: "400 11px var(--font)",
                color: "var(--txt-2)", whiteSpace: "nowrap",
            }}>
                {busy ? "Capturing…" : "Drag to select an area · Esc to cancel"}
            </div>

            {rect && rect.w > 0 && (
                <>
                    {/* A hole cut in the dimming rather than a box drawn on
                        top of it, so what you are about to capture is shown
                        at full brightness. */}
                    <div style={{
                        position: "absolute", left: rect.x, top: rect.y, width: rect.w, height: rect.h,
                        boxShadow: "0 0 0 9999px rgba(8,10,13,.28)",
                        border: "1px solid var(--acc-hi, #a0b2d2)", background: "transparent",
                    }} />
                    <div style={{
                        position: "absolute", left: rect.x, top: Math.max(0, rect.y - 20),
                        font: "400 10px var(--mono)", color: "var(--txt-2)",
                        background: "var(--bg-2, #1e212c)", padding: "1px 5px", borderRadius: 2,
                    }}>{Math.round(rect.w)} × {Math.round(rect.h)}</div>
                </>
            )}
        </div>
    )
}

/** Keep a capture where the rest of the work already is. */
export function saveCapture(dataUrl, { label = "Screen capture", region = null, of = null } = {}) {
    return saveForBriefing({
        id: `capture:${Date.now()}`,
        kind: "capture",
        // Which surface it was taken on, so it files itself under
        // Screenshots/Analytics, Screenshots/Maps and so on rather than
        // landing in one undifferentiated pile.
        captureOf: of,
        headline: label,
        region,
        imageUrl: dataUrl,
        when: new Date().toISOString(),
        source: "screen capture",
    })
}
