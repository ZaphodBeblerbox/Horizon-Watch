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
import { subscribeCursor, getCursor, subscribeScale, getScale, formatCoord } from "../globe/mapReadout.js"

export default function MapMeta() {
    const [cursor, setCursor] = useState(() => getCursor())
    const [scale, setScale] = useState(() => getScale())

    useEffect(() => subscribeCursor(setCursor), [])
    useEffect(() => subscribeScale(setScale), [])

    return (
        <div className="mapmeta" aria-hidden="true">
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
