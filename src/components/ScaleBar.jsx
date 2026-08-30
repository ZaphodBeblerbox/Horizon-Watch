/**
 * ScaleBar — a real ground-distance scale bar for a Cesium globe view.
 *
 * On every scene.postRender (Cesium only fires this on an actual render —
 * requestRenderMode is enabled in GlobeView.jsx, so this tracks camera
 * movement live without a busy per-frame loop when the camera is idle), it
 * samples two points a fixed pixel distance apart at the center of the
 * viewport, unprojects both onto the WGS84 ellipsoid via
 * camera.pickEllipsoid(), measures the real geodesic distance between them
 * with Cartesian3.distance(), and derives metersPerPixel from that. The pure
 * pickNiceScale() helper (scaleBarMath.js) then chooses the largest "nice"
 * round km value that fits, and the bar is drawn at that value's true
 * on-screen pixel width.
 *
 * If the camera is looking at the horizon/space and pickEllipsoid() returns
 * null for either sample point, the bar hides itself rather than showing a
 * stale or fabricated value.
 *
 * Does not assume useCesium() context — the integrator passes the Cesium
 * Viewer instance explicitly so this can be mounted anywhere (including
 * outside the <Viewer> tree).
 *
 * Props:
 *   viewer            Cesium.Viewer — must expose .scene (.canvas,
 *                      .postRender) and .camera.pickEllipsoid(). Required;
 *                      renders nothing while absent/destroyed.
 *   style              Optional style overrides merged onto the root div,
 *                      for the integrator to position this (default render
 *                      is an unpositioned inline block — no fixed/absolute
 *                      positioning is assumed).
 *   targetPixelWidth   Optional. Screen-pixel span sampled at the viewport
 *                      center to measure ground distance. Default 100.
 */

import { useEffect, useState } from "react"
import { Cartesian2, Cartesian3 } from "cesium"
import { pickNiceScale, scaleBarWidthPx } from "./scaleBarMath.js"

export default function ScaleBar({ viewer, style, targetPixelWidth = 100 }) {
    const [scale, setScale] = useState(null) // { km, widthPx } | null (hidden)

    useEffect(() => {
        if (!viewer || viewer.isDestroyed?.()) return

        const scene = viewer.scene
        const canvas = scene?.canvas
        if (!canvas) return

        function measure() {
            if (viewer.isDestroyed()) return

            const cx = canvas.clientWidth / 2
            const cy = canvas.clientHeight / 2
            const half = targetPixelWidth / 2

            let p1, p2
            try {
                p1 = viewer.camera.pickEllipsoid(new Cartesian2(cx - half, cy))
                p2 = viewer.camera.pickEllipsoid(new Cartesian2(cx + half, cy))
            } catch (_) {
                p1 = null
                p2 = null
            }

            if (!p1 || !p2) {
                setScale(null)
                return
            }

            const meters = Cartesian3.distance(p1, p2)
            const metersPerPixel = meters / targetPixelWidth
            const km = pickNiceScale(metersPerPixel, targetPixelWidth)

            if (km == null) {
                setScale(null)
                return
            }

            setScale({ km, widthPx: scaleBarWidthPx(km, metersPerPixel) })
        }

        measure()
        const removeListener = scene.postRender.addEventListener(measure)
        return () => removeListener()
    }, [viewer, targetPixelWidth])

    if (!scale) return null

    return (
        <div
            style={{
                display: "inline-flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 4,
                padding: "6px 10px",
                background: "var(--bg-elevated)",
                border: "var(--elevation-2)",
                borderRadius: "var(--radius)",
                pointerEvents: "none",
                userSelect: "none",
                ...style,
            }}
        >
            <div style={{ position: "relative", width: Math.round(scale.widthPx), height: 7 }}>
                <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 2, background: "var(--text-primary)" }} />
                <div style={{ position: "absolute", left: 0, bottom: 0, width: 1, height: 7, background: "var(--text-primary)" }} />
                <div style={{ position: "absolute", right: 0, bottom: 0, width: 1, height: 7, background: "var(--text-primary)" }} />
            </div>
            <span
                style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--text-xs)",
                    color: "var(--text-secondary)",
                    letterSpacing: "0.02em",
                }}
            >
                {scale.km.toLocaleString()} km
            </span>
        </div>
    )
}
