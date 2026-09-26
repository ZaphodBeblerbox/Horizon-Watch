/**
 * Capturable.jsx — "keep this exact thing".
 *
 * Wraps any element and puts a small capture control on it. Pressing it
 * rasterises THAT element — not the screen, not a region you have to draw
 * — and saves it with a caption already attached.
 *
 * WHY PER-ELEMENT AND NOT JUST THE CROP TOOL. A chart has an exact
 * boundary the component already knows. Asking someone to draw a rectangle
 * around something the program could measure itself produces a slightly
 * wrong crop every time, and the caption has to be typed by hand. This
 * knows what it is and says so.
 *
 * The globe is composited from Cesium's own buffer for the same reason as
 * the screen capture: a DOM rasteriser reads a WebGL canvas as black.
 */

import { useCallback, useRef, useState } from "react"
import { saveForBriefing } from "../state/savedForBriefing.js"
import { toast } from "../ui/toast.js"

function cesiumDataUrl() {
    try {
        const cv = document.querySelector(".cesium-widget canvas")
        if (!cv) return null
        const viewer = window.__parallaxViewer
        if (viewer?.scene && !viewer.isDestroyed?.()) viewer.scene.render()
        return cv.toDataURL("image/png")
    } catch { return null }
}

export async function captureElement(el, { scale } = {}) {
    const { default: html2canvas } = await import("html2canvas")
    const globe = cesiumDataUrl()
    const canvas = await html2canvas(el, {
        backgroundColor: getComputedStyle(document.documentElement)
            .getPropertyValue("--bg-1")?.trim() || "#1b1f24",
        // Two, not devicePixelRatio: these end up on a printed page, where
        // a 1x raster of a chart is visibly soft.
        scale: scale || Math.max(2, window.devicePixelRatio || 1),
        logging: false,
        useCORS: true,
        ignoreElements: (n) => n.dataset?.captureControl === "1",
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
    return canvas.toDataURL("image/png")
}

export default function Capturable({ label, kind = "chart", detail = null, children, style = {} }) {
    const ref = useRef(null)
    const [busy, setBusy] = useState(false)

    const grab = useCallback(async () => {
        if (!ref.current) return
        setBusy(true)
        try {
            const dataUrl = await captureElement(ref.current)
            const ok = saveForBriefing({
                id: `capture:${kind}:${label}:${Date.now()}`,
                kind: "capture",
                headline: label,
                detail,
                imageUrl: dataUrl,
                when: new Date().toISOString(),
                source: "analytics",
            })
            toast(ok === false ? "Already saved" : `Saved "${label}" — it is in the Editor's Saved pane`,
                  { icon: "i-check" })
        } catch (e) {
            toast(`Could not capture: ${e?.message || e}`, { icon: "i-alert" })
        } finally { setBusy(false) }
    }, [label, kind, detail])

    return (
        <div ref={ref} style={{ position: "relative", ...style }}>
            {children}
            <button
                data-capture-control="1"
                onClick={grab}
                disabled={busy}
                title={`Save "${label}" as an image for a document`}
                aria-label={`Save ${label} as an image`}
                style={{
                    position: "absolute", top: 6, right: 6, zIndex: 3,
                    width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center",
                    background: "var(--bg-2)", border: "1px solid var(--line)", borderRadius: 3,
                    color: busy ? "var(--txt-4)" : "var(--txt-3)", cursor: busy ? "default" : "pointer",
                    opacity: busy ? 1 : 0.55, transition: "opacity .12s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = "1" }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = busy ? "1" : "0.55" }}
            >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                    <rect x="1.5" y="4" width="13" height="9.5" rx="1.5" />
                    <circle cx="8" cy="8.75" r="2.6" />
                    <path d="M5.5 4l1-1.6h3L10.5 4" />
                </svg>
            </button>
        </div>
    )
}
