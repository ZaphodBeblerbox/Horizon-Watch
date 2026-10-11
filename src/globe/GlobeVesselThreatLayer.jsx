// The vessel of concern, LIVE on the desktop globe: the ship, its last 24 h
// trail, the Shahed/Geran-class drone rings, the targets in reach (top ten
// highlighted), and — on request — a SIMULATED drone flight to a target,
// clearly labelled "Simulation — what is in reach, not a prediction".
// Driven by src/state/vesselThreatStore.js. Removable: everything it adds is
// tracked and removed on close/unmount.
import { useEffect, useRef } from "react"
import { useCesium } from "resium"
import {
  BoundingSphere, CallbackProperty, Cartesian2, Cartesian3, Color, ColorBlendMode, DistanceDisplayCondition,
  HeadingPitchRoll, HorizontalOrigin, LabelStyle, NearFarScalar, PolylineDashMaterialProperty,
  PolylineGlowMaterialProperty, Transforms, VerticalOrigin, HeadingPitchRange, Math as CMath,
} from "cesium"
import { getVesselThreat, subscribeVesselThreat } from "../state/vesselThreatStore.js"
import {
  SIM_LABEL, buildFlightPath, fmtMinutes, flightMinutes, modelHeadingRad, pathLengthKm, positionAlong,
  ringPoints, shahedModelUri,
} from "./vesselThreat.js"

const FONT = "600 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif"
const FONT_SM = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif"
const RING_COLORS = ["#ff5a4f", "#ff9f43", "#ffd166"]
const SIM_SECONDS = 24          // the flight is replayed compressed; the label shows real minutes

const deg2 = (p, h = 0) => Cartesian3.fromDegrees(p.lon, p.lat, h)

export default function GlobeVesselThreatLayer() {
  const { viewer } = useCesium()
  const ids = useRef([])
  const simIds = useRef([])
  const raf = useRef(null)
  const drawnKey = useRef(null)
  const simKey = useRef(null)

  useEffect(() => {
    if (!viewer) return
    const add = (e, bag = ids) => { const ent = viewer.entities.add(e); bag.current.push(ent.id); return ent }
    const removeAll = (bag) => {
      if (viewer.isDestroyed()) return
      bag.current.forEach((id) => { const e = viewer.entities.getById(id); if (e) viewer.entities.remove(e) })
      bag.current = []
    }
    const stopSim = () => {
      if (raf.current) cancelAnimationFrame(raf.current)
      raf.current = null
      removeAll(simIds)
      simKey.current = null
    }
    const render = () => { if (!viewer.isDestroyed()) viewer.scene.requestRender() }

    const draw = (data, fly) => {
      removeAll(ids)
      const v = data.vessel
      const c = { lat: v.lat, lon: v.lon }
      const pre = `vthreat-${data.mmsi}`
      // Rings (drone reach at public open-source figures).
      ;(data.rings_km || []).forEach((km, i) => {
        const pts = ringPoints(c, km, 180)
        add({
          id: `${pre}-ring-${km}`,
          polyline: {
            positions: pts.map((p) => deg2(p)), width: 2, clampToGround: false,
            material: new PolylineDashMaterialProperty({ color: Color.fromCssColorString(RING_COLORS[i] || "#ffd166").withAlpha(0.95), dashLength: 18 }),
          },
        })
        add({
          id: `${pre}-ringlabel-${km}`,
          position: deg2(pts[0], 200),
          label: {
            text: `${km.toLocaleString("en-GB")} km — drone reach`, font: FONT_SM, fillColor: Color.fromCssColorString(RING_COLORS[i] || "#ffd166"),
            outlineColor: Color.BLACK, outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE, verticalOrigin: VerticalOrigin.BOTTOM,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        })
      })
      // Last 24 h trail.
      const trail = (data.trail || []).map(([la, lo]) => ({ lat: la, lon: lo }))
      if (trail.length > 1) {
        add({
          id: `${pre}-trail`,
          polyline: { positions: [...trail, c].map((p) => deg2(p, 20)), width: 3,
            material: new PolylineGlowMaterialProperty({ color: Color.fromCssColorString("#4fc3f7"), glowPower: 0.2 }) },
        })
      }
      // Targets: the in-range markers, the top ten highlighted and named.
      const top = new Set((data.targets || []).map((t) => `${t.name}|${t.lat}|${t.lon}`))
      ;(data.markers || []).forEach((t, i) => {
        const isTop = top.has(`${t.name}|${t.lat}|${t.lon}`)
        const rank = isTop ? data.targets.findIndex((x) => x.name === t.name && x.lat === t.lat) + 1 : null
        add({
          id: `${pre}-tgt-${i}`,
          name: t.name,
          position: deg2(t, 50),
          point: {
            pixelSize: isTop ? 11 : 6, color: Color.fromCssColorString(isTop ? "#ff3b30" : "#c9c9c9").withAlpha(isTop ? 1 : 0.8),
            outlineColor: Color.BLACK, outlineWidth: isTop ? 2 : 1, disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: isTop ? {
            text: `${rank}. ${t.name} · ${Math.round(t.distance_km)} km`,
            font: FONT_SM, fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 3,
            style: LabelStyle.FILL_AND_OUTLINE, horizontalOrigin: HorizontalOrigin.LEFT, verticalOrigin: VerticalOrigin.CENTER,
            pixelOffset: new Cartesian2(10, 0), disableDepthTestDistance: Number.POSITIVE_INFINITY,
            translucencyByDistance: new NearFarScalar(2.5e6, 1, 6e6, 0),
          } : undefined,
        })
      })
      // The ship itself.
      add({
        id: `${pre}-vessel`,
        position: deg2(c, 30),
        point: { pixelSize: 15, color: Color.fromCssColorString("#ff3b30"), outlineColor: Color.WHITE, outlineWidth: 3, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: {
          text: `${data.synthetic ? "SYNTHETIC — " : ""}${v.name || `MMSI ${v.mmsi}`}\n${data.assessment?.tier_label || ""} · ${data.assessment?.score ?? "—"}/100`,
          font: FONT, fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 4, style: LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: VerticalOrigin.BOTTOM, pixelOffset: new Cartesian2(0, -14), disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })
      if (fly) {
        const km = Math.min(...(data.rings_km || [300]).filter((k) => k >= 250), 400)
        viewer.camera.flyToBoundingSphere(new BoundingSphere(deg2(c), km * 1000), {
          duration: 1.6, offset: new HeadingPitchRange(0, CMath.toRadians(-90), km * 1000 * 4.6),
        })
      }
      render()
    }

    const simulate = (data, sim) => {
      stopSim()
      const t = data.targets?.[sim.index] || data.targets?.[0]
      if (!t) return
      const from = { lat: data.vessel.lat, lon: data.vessel.lon }
      const cruise = data.drone?.cruise_kmh || 170
      const path = buildFlightPath(from, t, { seed: `${data.mmsi}-${t.name}`, altitude: data.drone?.altitude_m || [100, 500] })
      const total = pathLengthKm(path)
      const pre = `vthreat-sim-${sim.id}`
      simKey.current = sim.id
      // Frame the flight so the drone itself is legible.
      const mid = positionAlong(path, total / 2)
      viewer.camera.flyToBoundingSphere(new BoundingSphere(deg2(mid), Math.max(15, total * 0.6) * 1000), {
        duration: 1.2, offset: new HeadingPitchRange(0, CMath.toRadians(-60), Math.max(15, total * 0.6) * 1000 * 2.4),
      })
      const t0 = performance.now()
      const kmNow = () => Math.min(total, ((performance.now() - t0) / 1000 / SIM_SECONDS) * total)
      const posNow = () => { const p = positionAlong(path, kmNow()); return deg2(p, p.alt) }
      add({
        id: `${pre}-path`,
        polyline: { positions: path.map((p) => deg2(p, p.alt)), width: 2,
          material: new PolylineDashMaterialProperty({ color: Color.fromCssColorString("#ffffff").withAlpha(0.85), dashLength: 10 }) },
      }, simIds)
      add({
        id: `${pre}-flown`,
        polyline: { positions: new CallbackProperty(() => {
          const d = kmNow()
          return [...path.filter((p) => p.km <= d).map((p) => deg2(p, p.alt)), posNow()]
        }, false), width: 3, material: Color.fromCssColorString("#ff9f43") },
      }, simIds)
      add({
        id: `${pre}-drone`,
        name: "Simulated drone",
        position: new CallbackProperty(posNow, false),
        orientation: new CallbackProperty(() => {
          const p = positionAlong(path, kmNow())
          return Transforms.headingPitchRollQuaternion(deg2(p, p.alt), new HeadingPitchRoll(modelHeadingRad(p.heading), 0, 0))
        }, false),
        model: { uri: shahedModelUri(), minimumPixelSize: 96, maximumScale: 80000, color: Color.fromCssColorString("#d9cdb8"), colorBlendMode: ColorBlendMode.MIX, colorBlendAmount: 0.25 },
        label: {
          text: new CallbackProperty(() => {
            const left = flightMinutes(total - kmNow(), cruise)
            return `${SIM_LABEL}\nShahed/Geran-class → ${t.name}: ${left > 0.5 ? `${fmtMinutes(left)} to target` : "reached"} (${Math.round(total)} km at ${cruise} km/h, ${fmtMinutes(flightMinutes(total, cruise))} total)`
          }, false),
          font: FONT_SM, fillColor: Color.fromCssColorString("#ffe2b8"), outlineColor: Color.BLACK, outlineWidth: 4,
          style: LabelStyle.FILL_AND_OUTLINE, verticalOrigin: VerticalOrigin.TOP, pixelOffset: new Cartesian2(0, 30),
          showBackground: true, backgroundColor: Color.BLACK.withAlpha(0.55), disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new DistanceDisplayCondition(0, 2.0e7),
        },
      }, simIds)
      const tick = () => {
        render()
        if (kmNow() < total && simKey.current === sim.id) raf.current = requestAnimationFrame(tick)
        else render()
      }
      raf.current = requestAnimationFrame(tick)
    }

    const onState = (s) => {
      if (!s.mmsi || !s.data || s.data.available === false) {
        if (drawnKey.current) { stopSim(); removeAll(ids); drawnKey.current = null; render() }
        return
      }
      const key = `${s.data.mmsi}|${s.data.vessel?.lat}|${s.data.vessel?.lon}|${s.req}`
      if (drawnKey.current !== key) {
        stopSim()
        draw(s.data, s.fly !== false && !String(drawnKey.current || "").startsWith(`${s.data.mmsi}|`))
        drawnKey.current = key
      }
      if (s.sim && simKey.current !== s.sim.id) simulate(s.data, s.sim)
      if (!s.sim && simKey.current) { stopSim(); render() }
    }
    const unsub = subscribeVesselThreat(onState)
    onState(getVesselThreat())
    return () => { unsub(); stopSim(); removeAll(ids); drawnKey.current = null }
  }, [viewer])

  return null
}
