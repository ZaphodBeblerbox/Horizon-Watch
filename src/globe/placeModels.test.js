/**
 * The endangered-place models (tools/make_place_models.py) and which places
 * get one (placeModels.js).
 */
import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { KIND_FILE, NO_MODEL, FILES, STATUSES, MODEL_VERSION, modelUrl, selectModelPlaces, placeHeadingRad,
         MODEL_MAX_HEIGHT_M, MODEL_BUDGET } from "./placeModels.js"
import { KIND_LABEL, ALARM_COLOR } from "./endangeredPlaces.js"

const fileFor = (f, s) => `public/models/place/${f}${s === "grey" ? "" : `_${s}`}.glb`

function readGlb(path) {
    const buf = readFileSync(path)
    expect(buf.readUInt32LE(0)).toBe(0x46546c67)          // "glTF"
    expect(buf.readUInt32LE(4)).toBe(2)
    expect(buf.readUInt32LE(8)).toBe(buf.length)
    const jsonLen = buf.readUInt32LE(12)
    expect(buf.readUInt32LE(16)).toBe(0x4e4f534a)         // "JSON"
    const gltf = JSON.parse(buf.slice(20, 20 + jsonLen).toString("utf8"))
    const binStart = 20 + jsonLen + 8
    expect(buf.readUInt32LE(20 + jsonLen + 4)).toBe(0x004e4942) // "BIN\0"
    const floats = (accIdx) => {
        const a = gltf.accessors[accIdx], bv = gltf.bufferViews[a.bufferView]
        const start = binStart + (bv.byteOffset || 0)
        return new Float32Array(buf.buffer.slice(buf.byteOffset + start, buf.byteOffset + start + a.count * 12))
    }
    return { gltf, floats }
}

const toLinear = (hex) => [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
})

describe("place models on disk", () => {
    it("every kind the server sends has a model file", () => {
        for (const k of Object.keys(KIND_LABEL)) {
            if (NO_MODEL.includes(k)) expect(modelUrl(k, "red")).toBeNull()
            // a new kind needs a decision: a model file in KIND_FILE, or NO_MODEL
            else expect(KIND_FILE[k], `kind "${k}": map it in placeModels.js KIND_FILE or list it in NO_MODEL`).toBeTruthy()
        }
        expect(FILES.sort()).toEqual(["arms_company", "fuel_depot", "fuel_station", "rally", "refinery", "roundabout"])
    })

    for (const f of FILES) {
        for (const s of STATUSES) {
            it(`${f} (${s}) is one valid, upright, vertex-coloured mesh in the status colour`, () => {
                const path = fileFor(f, s)
                expect(existsSync(path)).toBe(true)
                const { gltf, floats } = readGlb(path)
                // the shipped models' conventions: one mesh, one primitive, one material
                expect(gltf.meshes).toHaveLength(1)
                expect(gltf.meshes[0].primitives).toHaveLength(1)
                const prim = gltf.meshes[0].primitives[0]
                expect(Object.keys(prim.attributes).sort()).toEqual(["COLOR_0", "NORMAL", "POSITION"])
                expect(prim.indices).toBeDefined()
                expect(gltf.materials).toHaveLength(1)
                expect(gltf.materials[0].pbrMetallicRoughness.metallicFactor).toBe(0.25)
                const pos = gltf.accessors[prim.attributes.POSITION]
                // glTF +Y is up (Cesium +Z): stands on the ground, taller than nothing, wider than tall
                expect(pos.min[1]).toBeCloseTo(0, 3)
                const h = pos.max[1] - pos.min[1]
                const w = Math.max(pos.max[0] - pos.min[0], pos.max[2] - pos.min[2])
                expect(h).toBeGreaterThan(3)
                expect(w).toBeGreaterThan(20)
                expect(w).toBeLessThan(140)
                // the plinth carries the status colour
                const col = floats(prim.attributes.COLOR_0)
                const want = toLinear(ALARM_COLOR[s])
                let found = false
                for (let i = 0; i < col.length && !found; i += 3) {
                    found = Math.abs(col[i] - want[0]) < 1e-3 && Math.abs(col[i + 1] - want[1]) < 1e-3 && Math.abs(col[i + 2] - want[2]) < 1e-3
                }
                expect(found).toBe(true)
                // and no other status colour on the plinth of another status
                for (const other of STATUSES.filter((x) => x !== s && x !== "grey" && f !== "rally")) {
                    const o = toLinear(ALARM_COLOR[other])
                    let hit = false
                    for (let i = 0; i < col.length && !hit; i += 3) {
                        hit = Math.abs(col[i] - o[0]) < 1e-3 && Math.abs(col[i + 1] - o[1]) < 1e-3 && Math.abs(col[i + 2] - o[2]) < 1e-3
                    }
                    expect(hit).toBe(false)
                }
            })
        }
    }
})

describe("modelUrl", () => {
    it("maps kind and status to a versioned file", () => {
        expect(modelUrl("refinery", "red")).toBe(`/models/place/refinery_red.glb?v=${MODEL_VERSION}`)
        expect(modelUrl("gathering", "amber")).toBe(`/models/place/rally_amber.glb?v=${MODEL_VERSION}`)
        expect(modelUrl("arms_company", "grey")).toBe(`/models/place/arms_company.glb?v=${MODEL_VERSION}`)
        expect(modelUrl("fuel_depot", undefined)).toBe(`/models/place/fuel_depot.glb?v=${MODEL_VERSION}`)
        expect(modelUrl("castle", "red")).toBeNull()
    })
})

describe("selectModelPlaces (level of detail and the cap)", () => {
    const lyon = { lat: 45.75, lon: 4.85 }
    const mk = (id, lat, lon, alarm = "grey", kind = "fuel_station") => ({ id, lat, lon, alarm, kind })
    const view = (height, bounds = { west: 3.5, south: 45, east: 6, north: 46.5 }) => ({ height, center: lyon, bounds })

    it("draws no models from high up", () => {
        const places = [mk("a", 45.7, 4.8, "red")]
        expect(selectModelPlaces(places, view(MODEL_MAX_HEIGHT_M + 1)).size).toBe(0)
        expect(selectModelPlaces(places, view(MODEL_MAX_HEIGHT_M - 1)).has("a")).toBe(true)
        expect(selectModelPlaces(places, null).size).toBe(0)
    })

    it("only places in view (with a margin), only kinds that have a model", () => {
        const places = [mk("in", 45.8, 4.9), mk("out", 48.85, 2.35), mk("odd", 45.8, 4.9, "red", "castle")]
        const s = selectModelPlaces(places, view(80_000))
        expect([...s]).toEqual(["in"])
    })

    it("caps the count, red first, then amber, then nearest", () => {
        const places = []
        for (let i = 0; i < 400; i++) places.push(mk(`g${i}`, 45.75 + (i % 20) * 0.02, 4.85 + Math.floor(i / 20) * 0.02))
        places.push(mk("far-red", 46.4, 5.9, "red"), mk("far-amber", 46.4, 5.8, "amber"))
        const s = selectModelPlaces(places, view(100_000))
        expect(s.size).toBe(MODEL_BUDGET)
        expect(s.has("far-red")).toBe(true)
        expect(s.has("far-amber")).toBe(true)
        expect(s.has("g0")).toBe(true)                    // at the centre
        expect(s.has("g399")).toBe(false)                 // grey and furthest
        expect(selectModelPlaces(places, view(100_000), { budget: 1 })).toEqual(new Set(["far-red"]))
    })

    it("gives each place a fixed heading", () => {
        expect(placeHeadingRad("gj:1")).toBe(placeHeadingRad("gj:1"))
        expect(placeHeadingRad("gj:1")).not.toBe(placeHeadingRad("gj:2"))
        expect(placeHeadingRad("x")).toBeGreaterThanOrEqual(0)
        expect(placeHeadingRad("x")).toBeLessThan(2 * Math.PI)
    })
})
