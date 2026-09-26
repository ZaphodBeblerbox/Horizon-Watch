/**
 * MapMeta.jsx — PARALLAX spec §10 (`.mapmeta`) and §8 (the measured scale
 * bar). Bottom-left of the map: cursor coordinate above, scale bar below.
 *
 * Both values are measured by GlobeView against the live Cesium camera and
 * published to mapReadout.js; this component only renders them. It is
 * pointer-events:none by design — it sits over the globe and must never
 * intercept a drag.
 *
 * The cursor line disappears when the pointer is off the globe rather than
 * freezing on its last value. A coordinate readout that keeps showing
 * 48.9904 / 37.7438 while the pointer sits on empty space is asserting a
 * position that is not true.
 */

import { useEffect, useState } from "react"
import {
    subscribeCursor, getCursor, subscribeScale, getScale, formatCoord,
    measureViewerScale,
} from "../globe/mapReadout.js"
import { Cartesian2, Cartesian3, Math as CMath } from "cesium"

/**
 * `viewer` is for a map that is not the main globe — a minimap runs its own
 * Cesium viewer, which the singleton publishers know nothing about. Given
 * one, this measures it directly; given none, it reads what GlobeView
 * publishes. One component either way, so there is only ever one readout
 * shape in the product.
 */
export default function MapMeta({ viewer = null, style = null }) {
    const [cursor, setCursor] = useState(() => (viewer ? null : getCursor()))
    const [scale, setScale] = useState(() => (viewer ? null : getScale()))

    useEffect(() => { if (!viewer) return subscribeCursor(setCursor) }, [viewer])
    useEffect(() => { if (!viewer) return subscribeScale(setScale) }, [viewer])

    useEffect(() => {
        if (!viewer || viewer.isDestroyed?.()) return
        const onRender = () => setScale(measureViewerScale(viewer, Cartesian2, Cartesian3))
        onRender()
        viewer.scene.postRender.addEventListener(onRender)

        const canvas = viewer.scene.canvas
        const onMove = (e) => {
            const r = canvas.getBoundingClientRect()
            let picked = null
            try {
                picked = viewer.camera.pickEllipsoid(
                    new Cartesian2(e.clientX - r.left, e.clientY - r.top))
            } catch { picked = null }
            if (!picked) { setCursor(null); return }
            const c = viewer.scene.globe.ellipsoid.cartesianToCartographic(picked)
            setCursor({ lat: CMath.toDegrees(c.latitude), lon: CMath.toDegrees(c.longitude) })
        }
        const onLeave = () => setCursor(null)
        canvas.addEventListener("mousemove", onMove)
        canvas.addEventListener("mouseleave", onLeave)
        return () => {
            if (!viewer.isDestroyed?.()) viewer.scene.postRender.removeEventListener(onRender)
            canvas.removeEventListener("mousemove", onMove)
            canvas.removeEventListener("mouseleave", onLeave)
        }
    }, [viewer])

    return (
        <div className="mapmeta" aria-hidden="true" style={style || undefined}>
            <span className="coord">
                {cursor
                    ? <>LAT <b>{formatCoord(cursor.lat, 2)}</b>&nbsp;&nbsp;LON <b>{formatCoord(cursor.lon, 3)}</b></>
                    : <>LAT <b>—</b>&nbsp;&nbsp;LON <b>—</b></>}
            </span>
            <span className="scalebar">
                <i id="map-scalebar" style={{ width: `${scale?.px || 78}px` }} />
                <span id="map-scale">{scale?.label || "—"}</span>
            </span>
        </div>
    )
}
