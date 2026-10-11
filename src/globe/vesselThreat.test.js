import { describe, expect, it } from "vitest"
import {
  ALERT_TYPE, bearingDeg, buildFlightPath, buildShahedGlb, destination, flightMinutes, fmtMinutes, greatCircleAt,
  haversineKm, isVesselThreatAlert, mmsiOf, modelHeadingRad, pathLengthKm, positionAlong, ringPoints, shahedGeometry,
} from "./vesselThreat.js"

const SHIP = { lat: 55.3, lon: 12.75 }
const CPH = { lat: 55.618, lon: 12.656 }
const BERLIN = { lat: 52.52, lon: 13.405 }

describe("alert recognition", () => {
  it("knows a vessel-of-concern alert by type or id, and reads the MMSI", () => {
    expect(isVesselThreatAlert({ alert_type: ALERT_TYPE })).toBe(true)
    expect(isVesselThreatAlert({ id: "RUL-273123450-1800000000" })).toBe(true)
    expect(isVesselThreatAlert({ id: "x" }, "alert-forge-RUL-273123450-1800000000")).toBe(true)
    expect(isVesselThreatAlert({ id: "GPS-12_3-1" })).toBe(false)
    expect(mmsiOf({ id: "RUL-273123450-1800000000" })).toBe("273123450")
    expect(mmsiOf({ entity_id: "636000001", id: "RUL-1-2" })).toBe("636000001")
  })
})

describe("ring geometry", () => {
  it("every ring point is the radius away from the centre, and the ring closes", () => {
    for (const km of [100, 300, 1000]) {
      const pts = ringPoints(SHIP, km, 72)
      expect(pts).toHaveLength(73)
      for (const p of pts) expect(haversineKm(SHIP, p)).toBeCloseTo(km, 3)
      expect(pts[0].lat).toBeCloseTo(pts[72].lat, 9)
      expect(pts[0].lon).toBeCloseTo(pts[72].lon, 9)
    }
  })
  it("destination and bearing agree", () => {
    const p = destination(SHIP, 90, 50)
    expect(haversineKm(SHIP, p)).toBeCloseTo(50, 6)
    expect(bearingDeg(SHIP, p)).toBeCloseTo(90, 0)
    expect(destination({ lat: 0, lon: 179.9 }, 90, 50).lon).toBeLessThan(-179)   // wraps the antimeridian
  })
})

describe("flight path", () => {
  it("great-circle interpolation hits the ends and the middle lies on the arc", () => {
    expect(greatCircleAt(SHIP, BERLIN, 0).lat).toBeCloseTo(SHIP.lat, 9)
    expect(greatCircleAt(SHIP, BERLIN, 1).lon).toBeCloseTo(BERLIN.lon, 9)
    const m = greatCircleAt(SHIP, BERLIN, 0.5)
    expect(haversineKm(SHIP, m) + haversineKm(m, BERLIN)).toBeCloseTo(haversineKm(SHIP, BERLIN), 6)
  })
  it("starts at the vessel, ends at the target, stays low, and is only a little longer than the great circle", () => {
    const path = buildFlightPath(SHIP, BERLIN, { seed: "t", altitude: [100, 500] })
    expect(path[0].lat).toBeCloseTo(SHIP.lat, 9)
    expect(path.at(-1).lat).toBeCloseTo(BERLIN.lat, 9)
    for (const p of path) { expect(p.alt).toBeGreaterThanOrEqual(100); expect(p.alt).toBeLessThanOrEqual(500) }
    const gc = haversineKm(SHIP, BERLIN)
    expect(pathLengthKm(path)).toBeGreaterThanOrEqual(gc - 1e-6)
    expect(pathLengthKm(path)).toBeLessThan(gc * 1.08)
    // monotone cumulative distance
    for (let i = 1; i < path.length; i++) expect(path[i].km).toBeGreaterThanOrEqual(path[i - 1].km)
    // deterministic per seed, different across seeds
    expect(buildFlightPath(SHIP, BERLIN, { seed: "t" })).toEqual(path)
    expect(buildFlightPath(SHIP, BERLIN, { seed: "u" })[10].lat).not.toBeCloseTo(path[10].lat, 6)
  })
  it("positionAlong interpolates and clamps; heading points down the path", () => {
    const path = buildFlightPath(SHIP, CPH, { seed: "x", jitterKm: 0 })
    const total = pathLengthKm(path)
    expect(positionAlong(path, -5).lat).toBeCloseTo(SHIP.lat, 6)
    const end = positionAlong(path, total + 10)
    expect(end.done).toBe(true)
    expect(end.lat).toBeCloseTo(CPH.lat, 6)
    const mid = positionAlong(path, total / 2)
    expect(haversineKm(SHIP, mid)).toBeCloseTo(total / 2, 0)
    expect(Math.abs(mid.heading - bearingDeg(SHIP, CPH))).toBeLessThan(2)
  })
  it("flight time at cruise speed", () => {
    expect(flightMinutes(170, 170)).toBe(60)
    expect(fmtMinutes(14.2)).toBe("14 min")
    expect(fmtMinutes(125)).toBe("2 h 05 min")
    expect(modelHeadingRad(90)).toBeCloseTo(Math.PI / 2, 9)   // measured on the globe: nose at bearing = heading
  })
})

describe("the procedural drone model", () => {
  it("is a valid GLB with two materials and the right proportions", () => {
    const glb = buildShahedGlb()
    const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength)
    expect(dv.getUint32(0, true)).toBe(0x46546c67)
    expect(dv.getUint32(4, true)).toBe(2)
    expect(dv.getUint32(8, true)).toBe(glb.byteLength)
    expect(glb.byteLength % 4).toBe(0)
    const jsonLen = dv.getUint32(12, true)
    const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLen)))
    expect(json.asset.version).toBe("2.0")
    expect(json.meshes[0].primitives).toHaveLength(2)
    expect(json.materials.map((m) => m.name)).toEqual(["airframe", "propeller"])
    const binLen = dv.getUint32(20 + jsonLen, true)
    expect(binLen).toBeGreaterThanOrEqual(json.buffers[0].byteLength)
    const pos = json.accessors[0]
    // ~3.5 m long, ~2.5 m span, nose forward (+X), propeller at the back
    expect(pos.max[0] - pos.min[0]).toBeGreaterThan(3.2)
    expect(pos.max[2] - pos.min[2]).toBeCloseTo(2.55, 1)
    expect(json.accessors[2].max[0]).toBeLessThan(pos.min[0] + 0.1)
  })
  it("has fins above and below the wing at both tips", () => {
    const { body } = shahedGeometry()
    const ys = [], zs = []
    for (let i = 0; i < body.pos.length; i += 3) if (Math.abs(Math.abs(body.pos[i + 2]) - 1.25) < 0.03) { ys.push(body.pos[i + 1]); zs.push(body.pos[i + 2]) }
    expect(Math.max(...ys)).toBeGreaterThan(0.3)
    expect(Math.min(...ys)).toBeLessThan(-0.3)
    expect(zs.some((z) => z > 0)).toBe(true)
    expect(zs.some((z) => z < 0)).toBe(true)
  })
})
