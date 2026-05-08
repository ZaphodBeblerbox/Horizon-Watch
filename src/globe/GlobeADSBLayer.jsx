import { useEffect, useMemo, useState, useRef } from "react"
import { Entity } from "resium"
import {
    Cartesian3, Cartesian2, Color,
    Math as CesiumMath, Transforms, HeadingPitchRoll,
    NearFarScalar, DistanceDisplayCondition, ColorBlendMode,
} from "cesium"
import { altColorHex } from "./iconUtils.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { isMobile, ADSB_CAP } from "./isMobile.js"

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

export default function GlobeADSBLayer({ aircraft }) {
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

    // On mobile, prefer high-altitude (commercial) aircraft and cap count to prevent OOM/crash.
    const filtered = useMemo(() => {
        if (!smooth?.length) return []
        if (!isMobile) return smooth
        return [...smooth]
            .filter(ac => (ac.alt_baro ?? ac.altitude ?? ac.baro_altitude ?? 0) > 5000)
            .sort((a, b) => (b.alt_baro ?? b.altitude ?? 0) - (a.alt_baro ?? a.altitude ?? 0))
            .slice(0, ADSB_CAP)
    }, [smooth])

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
                if (lat == null || lon == null || !isFinite(lat) || !isFinite(lon)) return null

                const alt    = ac.alt_baro ?? ac.altitude ?? ac.baro_altitude ?? 0
                const altNum = isFinite(Number(alt)) ? Number(alt) : 0
                const altM   = altNum * 0.3048
                const track  = isFinite(Number(ac.track ?? ac.heading))
                    ? Number(ac.track ?? ac.heading ?? 0) : 0
                const icao   = ac.icao ?? ac.icao24 ?? ""
                const cs     = (ac.flight || ac.callsign || "").trim()

                const hexCol  = altColorHex(altNum)
                const color   = Color.fromCssColorString(hexCol)
                const position = Cartesian3.fromDegrees(lon, lat, altM)

                const hpr         = new HeadingPitchRoll(CesiumMath.toRadians(track), 0, 0)
                const orientation = Transforms.headingPitchRollQuaternion(position, hpr)

                return (
                    <Entity
                        id={`adsb-${icao}`}
                        key={icao || `${lat}-${lon}`}
                        position={position}
                        orientation={orientation}
                        model={{
                            uri:              "/models/aircraft.glb",
                            minimumPixelSize: 28,
                            maximumScale:     400,
                            color,
                            colorBlendMode:   ColorBlendMode.REPLACE,
                            distanceDisplayCondition: new DistanceDisplayCondition(0, 20_000_000),
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
                            material: color.withAlpha(0.25),
                        }}
                    />
                )
            })}
        </>
    )
}
