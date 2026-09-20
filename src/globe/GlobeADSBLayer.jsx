import { useEffect, useMemo, useState, useRef } from "react"
import { Entity } from "resium"
import {
    Cartesian3, Cartesian2, Color,
    CallbackProperty,
    NearFarScalar, DistanceDisplayCondition,
} from "cesium"
import { getAircraftMarkerDataUri } from "./vesselAircraftGlyphs.js"
import { getRenderedTheme, subscribeRenderedTheme } from "../state/themeStore.js"
import { acClassify } from "./iconUtils.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { isMobile, ADSB_CAP } from "./isMobile.js"
import { safeCartesian, billboardRotation } from "./markerOrientation.js"
import useCameraHeading from "./useCameraHeading.js"

const adsbLat = (ac) => ac.lat ?? ac.latitude
const adsbLon = (ac) => ac.lon ?? ac.longitude

const BILLBOARD_SIZE = 26

function drCalc(lat, lon, track, gs, dt) {
    if (!gs || gs < 10) return [lat, lon]
    const dist = gs * 0.514444 * dt
    const R = 6371000, d = dist / R, θ = track * Math.PI / 180
    const φ1 = lat * Math.PI / 180, λ1 = lon * Math.PI / 180
    const sinφ2 = Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ)
    const φ2 = Math.asin(sinφ2)
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * sinφ2)
    return [φ2 * 180 / Math.PI, λ2 * 180 / Math.PI]
}

const DESKTOP_ADSB_CAP = 150

export default function GlobeADSBLayer({ aircraft, viewBounds, watchlistedIcaos }) {
    // §7's shading is a neutral overlay burned into the glyph image, and a
    // data URI cannot read a CSS variable — so the theme has to reach the
    // renderer as a value, and the glyph must be rebuilt when it turns.
    const cameraHeading = useCameraHeading()
    const [theme, setTheme] = useState(getRenderedTheme)
    useEffect(() => subscribeRenderedTheme(setTheme), [])

    const drBaseRef = useRef({})
    const rawRef    = useRef([])
    const [smooth, setSmooth] = useState([])

    useEffect(() => {
        rawRef.current = aircraft ?? []
        const now = Date.now()
        ;(aircraft ?? []).forEach(ac => {
            const icao = ac.icao ?? ac.icao24 ?? ""
            const lat  = ac.lat  ?? ac.latitude
            const lon  = ac.lon  ?? ac.longitude
            if (icao && lat != null && lon != null)
                drBaseRef.current[icao] = { lat, lon, track: ac.track ?? ac.heading ?? 0, gs: ac.gs ?? 0, ts: now }
        })
        const live = new Set((aircraft ?? []).map(a => a.icao ?? a.icao24 ?? ""))
        Object.keys(drBaseRef.current).forEach(k => { if (!live.has(k)) delete drBaseRef.current[k] })
        setSmooth(aircraft ?? [])
    }, [aircraft])

    useEffect(() => {
        const iv = setInterval(() => {
            if (!rawRef.current.length) return
            const now = Date.now()
            setSmooth(rawRef.current.map(ac => {
                const icao = ac.icao ?? ac.icao24 ?? ""
                const base = drBaseRef.current[icao]
                if (!base) return ac
                const dt = (now - base.ts) / 1000
                if (dt < 0.1 || dt > 30) return ac
                const [lat, lon] = drCalc(base.lat, base.lon, base.track, base.gs, dt)
                return { ...ac, lat, lon }
            }))
        }, 100)
        return () => clearInterval(iv)
    }, [])

    const { filtered } = useMemo(() => {
        if (!smooth?.length) return { filtered: [] }
        if (isMobile) {
            return {
                filtered: [...smooth]
                    .filter(ac => (ac.alt_baro ?? ac.altitude ?? ac.baro_altitude ?? 0) > 5000)
                    .sort((a, b) => (b.alt_baro ?? b.altitude ?? 0) - (a.alt_baro ?? a.altitude ?? 0))
                    .slice(0, ADSB_CAP),
            }
        }
        const valid = smooth.filter(ac => ac.lat != null && (ac.lon ?? ac.longitude) != null)
        if (valid.length <= DESKTOP_ADSB_CAP) return { filtered: valid }
        const centerLat = viewBounds ? (viewBounds.south + viewBounds.north) / 2 : 0
        const centerLng = viewBounds ? (viewBounds.west  + viewBounds.east)  / 2 : 0
        const sorted = [...valid].sort((a, b) => {
            const da = Math.abs(a.lat - centerLat) + Math.abs((a.lon ?? a.longitude ?? 0) - centerLng)
            const db = Math.abs(b.lat - centerLat) + Math.abs((b.lon ?? b.longitude ?? 0) - centerLng)
            return da - db
        })
        // Above the cap the nearest aircraft to the view centre are drawn and
        // the rest are not. The cluster markers are gone: a numbered blob is
        // not an aircraft, it cannot be inspected, and it covered the very
        // airframes it was summarising.
        return { filtered: sorted.slice(0, DESKTOP_ADSB_CAP) }
    }, [smooth, viewBounds])

    useEffect(() => {
        if (!filtered.length) return
        const ids = []
        filtered.forEach(ac => {
            const icao = ac.icao ?? ac.icao24 ?? ""
            if (icao) {
                setEntity(`adsb-${icao}`, "aircraft", ac)
                ids.push(`adsb-${icao}`)
            }
        })
        return () => ids.forEach(deleteEntity)
    }, [filtered])

    if (!filtered.length) return null
    return (
        <>
            {filtered.map(ac => {
                const lon = ac.lon ?? ac.longitude
                const lat = ac.lat ?? ac.latitude
                const alt    = ac.alt_baro ?? ac.altitude ?? ac.baro_altitude ?? 0
                const altNum = isFinite(Number(alt)) ? Number(alt) : 0
                const altM   = altNum * 0.3048
                const track  = isFinite(Number(ac.track ?? ac.heading))
                    ? Number(ac.track ?? ac.heading ?? 0) : 0

                // Before any glyph work, and null rather than a throw:
                // Cesium's fromDegrees raises on a coordinate that is not
                // a number (a numeric STRING raises too, which is why an
                // isFinite check never protected anything), and a raise
                // inside render unmounts the entire globe rather than
                // dropping one aircraft.
                const position = safeCartesian(lon, lat, altM)
                if (!position) return null
                const icao   = ac.icao ?? ac.icao24 ?? ""
                const cs     = (ac.flight || ac.callsign || "").trim()

                // Fidelity pass, build spec v2 §7 — real triangle glyph,
                // amber when this real icao matches a real "Military
                // Aircraft" watchlist alert (backend/main.py's rule_004,
                // the closest real existing "flagged for review" aircraft
                // signal — reused, not reinvented), otherwise colour-coded
                // by real classification (iconUtils.js's acClassify() — the
                // same real military/helicopter/commercial/general logic
                // the inspector panel already uses for its subtype badge,
                // now also wired into the globe billboard itself).
                const watchlisted = !!(icao && watchlistedIcaos?.has(String(icao).toUpperCase()))
                const classification = acClassify(ac)
                const icon = getAircraftMarkerDataUri({ watchlisted, classification, size: BILLBOARD_SIZE, theme })
                const dropColor = Color.fromCssColorString("#8899aa") // mirrors --text-secondary


                return (
                    <Entity
                        id={`adsb-${icao}`}
                        key={icao || `${lat}-${lon}`}
                        position={position}
                        billboard={{
                            image:           icon,
                            width:           BILLBOARD_SIZE,
                            height:          BILLBOARD_SIZE,
                            // A TRUE TRACK AT ANY CAMERA ANGLE — see
                            // markerOrientation.js. Billboard rotation is
                            // applied in screen space, so a bare -track is
                            // only right while north points up the screen.
                            // Subtracting the camera heading each frame keeps
                            // the nose on the real track, and facing the
                            // viewer keeps the airframe level with the
                            // horizon instead of standing on a wingtip.
                            rotation: new CallbackProperty(
                                () => billboardRotation(track, cameraHeading.current), false),
                            alignedAxis:     Cartesian3.ZERO,
                            // Stage 1 fidelity — no scaleByDistance on the
                            // glyph itself; constant size regardless of
                            // camera distance.
                            // Visible out to a hemisphere view, same as vessels.
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 60_000_000),
                        }}
                        label={isMobile ? undefined : {
                            text:       cs || icao,
                            font:       "12px Arial",
                            fillColor:  Color.fromCssColorString("#E8ECF1"),
                            outlineColor: Color.fromCssColorString("#0F1721"),
                            outlineWidth: 2,
                            style:      2,
                            pixelOffset: new Cartesian2(0, -20),
                            scaleByDistance:          new NearFarScalar(1000, 1.0, 3_000_000, 0.3),
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 1_500_000),
                            showBackground: true,
                            backgroundColor: Color.fromCssColorString("#1A2433").withAlpha(0.8),
                        }}
                        polyline={isMobile ? undefined : {
                            positions: [position, Cartesian3.fromDegrees(lon, lat, 0)],
                            width:    1,
                            material: dropColor.withAlpha(0.25),
                        }}
                    />
                )
            })}
        </>
    )
}
