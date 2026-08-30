/**
 * CoordinateReadout — a live cursor-tracking lat/lon readout for a Cesium
 * globe view, in decimal degrees (e.g. "34.0522°N, 118.2437°W").
 *
 * Listens for mouse move on viewer.scene.canvas via a Cesium
 * ScreenSpaceEventHandler (the same handler-setup convention used by
 * src/globe/GlobeOverwatchDrawLayer.jsx: construct on mount, .destroy() on
 * cleanup), unprojects the cursor position via camera.pickEllipsoid(),
 * converts the resulting Cartesian3 to Cartographic via
 * Cartographic.fromCartesian(), and formats the radians via the pure
 * formatLatLon() helper (coordinateFormat.js).
 *
 * Shows a dash placeholder when the cursor isn't over the globe
 * (pickEllipsoid returns undefined/null) or hasn't moved yet.
 *
 * Does not assume useCesium() context — the integrator passes the Cesium
 * Viewer instance explicitly so this can be mounted anywhere.
 *
 * Props:
 *   viewer   Cesium.Viewer — must expose .scene.canvas and
 *            .camera.pickEllipsoid(). Required; renders the dash
 *            placeholder while absent/destroyed.
 *   style    Optional style overrides merged onto the root div, for the
 *            integrator to position this (default render is an
 *            unpositioned inline block — no fixed/absolute positioning is
 *            assumed).
 */

import { useEffect, useState } from "react"
import { ScreenSpaceEventHandler, ScreenSpaceEventType, Cartographic } from "cesium"
import { formatLatLon } from "./coordinateFormat.js"

export default function CoordinateReadout({ viewer, style }) {
    const [label, setLabel] = useState(null) // formatted string | null (not over globe)

    useEffect(() => {
        if (!viewer || viewer.isDestroyed?.()) return

        const canvas = viewer.scene?.canvas
        if (!canvas) return

        const handler = new ScreenSpaceEventHandler(canvas)

        handler.setInputAction((movement) => {
            if (viewer.isDestroyed()) return

            let cart
            try {
                cart = viewer.camera.pickEllipsoid(movement.endPosition)
            } catch (_) {
                cart = null
            }

            if (!cart) {
                setLabel(null)
                return
            }

            const carto = Cartographic.fromCartesian(cart)
            setLabel(formatLatLon(carto.longitude, carto.latitude))
        }, ScreenSpaceEventType.MOUSE_MOVE)

        function handleLeave() { setLabel(null) }
        canvas.addEventListener("mouseleave", handleLeave)

        return () => {
            handler.destroy()
            canvas.removeEventListener("mouseleave", handleLeave)
        }
    }, [viewer])

    return (
        <div
            style={{
                display: "inline-block",
                padding: "6px 10px",
                background: "var(--bg-elevated)",
                border: "var(--elevation-2)",
                borderRadius: "var(--radius)",
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-xs)",
                color: "var(--text-secondary)",
                letterSpacing: "0.02em",
                whiteSpace: "nowrap",
                pointerEvents: "none",
                userSelect: "none",
                minWidth: 168,
                ...style,
            }}
        >
            {label || "—"}
        </div>
    )
}
