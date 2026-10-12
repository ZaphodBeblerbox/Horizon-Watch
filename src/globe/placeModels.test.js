/**
 * The endangered-place models (tools/make_place_models.py), which model a
 * place shows (placeModels.js), and that no model is drawn on the map.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, existsSync, readdirSync } from "node:fs"
import { MODEL_LABEL, MODEL_TYPES, KIND_DEFAULT, MODEL_VERSION, modelUrl, modelTypeOf, modelLabelOf } from "./placeModels.js"
import { KIND_LABEL } from "./endangeredPlaces.js"

function readGlb(path) {
    const buf = readFileSync(path)
    expect(buf.readUInt32LE(0)).toBe(0x46546c67)          // "glTF"
    expect(buf.readUInt32LE(4)).toBe(2)
    expect(buf.readUInt32LE(8)).toBe(buf.length)
    const jsonLen = buf.readUInt32LE(12)
    expect(buf.readUInt32LE(16)).toBe(0x4e4f534a)         // "JSON"
    const gltf = JSON.parse(buf.slice(20, 20 + jsonLen).toString("utf8"))
    expect(buf.readUInt32LE(20 + jsonLen + 4)).toBe(0x004e4942) // "BIN\0"
    return { gltf, size: buf.length }
}

describe("model types", () => {
    it("are the server's (backend/place_types.py MODEL_LABEL), in the same order", () => {
        const py = readFileSync("backend/place_types.py", "utf8")
        const block = py.slice(py.indexOf("MODEL_LABEL = {"), py.indexOf("}", py.indexOf("MODEL_LABEL = {")))
        const keys = [...block.matchAll(/^\s+"([a-z_]+)":/gm)].map((m) => m[1])
        expect(keys).toEqual(MODEL_TYPES)
        for (const k of keys) expect(block).toContain(`"${k}": "${MODEL_LABEL[k]}"`)
    })

    it("every kind the server sends has a default model", () => {
        for (const k of Object.keys(KIND_LABEL)) {
            expect(KIND_DEFAULT[k], `kind "${k}": give it a default in placeModels.js KIND_DEFAULT`).toBeTruthy()
            expect(MODEL_LABEL[KIND_DEFAULT[k]]).toBeTruthy()
        }
    })

    it("a place's model: the server's type, else its kind's, else a building", () => {
        expect(modelTypeOf({ kind: "gathering", model_type: "town_square" })).toBe("town_square")
        expect(modelTypeOf({ kind: "gathering" })).toBe("rally")
        expect(modelTypeOf({ kind: "arms_company" })).toBe("factory")
        expect(modelTypeOf({ kind: "endangered_place", place_kind: "lobby_office" })).toBe("office_building")
        expect(modelTypeOf({ kind: "castle", model_type: "castle" })).toBe("generic_building")
        expect(modelTypeOf(null)).toBe("generic_building")
        expect(modelLabelOf({ kind: "refinery" })).toBe("Refinery")
        expect(modelLabelOf({ model_type: "bridge", model_label: "Bridge" })).toBe("Bridge")
    })

    it("modelUrl: one versioned neutral file per type", () => {
        expect(modelUrl("town_square")).toBe(`/models/place/town_square.glb?v=${MODEL_VERSION}`)
        expect(modelUrl("castle")).toBe(`/models/place/generic_building.glb?v=${MODEL_VERSION}`)
        expect(MODEL_VERSION).toBeGreaterThanOrEqual(2)
    })
})

describe("place models on disk", () => {
    it("there is exactly one file per model type (no status copies left behind)", () => {
        const files = readdirSync("public/models/place").filter((f) => f.endsWith(".glb")).map((f) => f.replace(/\.glb$/, "")).sort()
        expect(files).toEqual([...MODEL_TYPES].sort())
    })

    for (const t of MODEL_TYPES) {
        it(`${t} is one valid, upright, vertex-coloured mesh of a sane size`, () => {
            const path = `public/models/place/${t}.glb`
            expect(existsSync(path)).toBe(true)
            const { gltf, size } = readGlb(path)
            // the shipped models' conventions: one mesh, one primitive, one material
            expect(gltf.meshes).toHaveLength(1)
            expect(gltf.meshes[0].primitives).toHaveLength(1)
            const prim = gltf.meshes[0].primitives[0]
            expect(Object.keys(prim.attributes).sort()).toEqual(["COLOR_0", "NORMAL", "POSITION"])
            expect(prim.indices).toBeDefined()
            expect(gltf.materials).toHaveLength(1)
            const pos = gltf.accessors[prim.attributes.POSITION]
            // glTF +Y is up: stands on the ground (the river under a bridge
            // and the hull of a ship at the quay dip a little below it)
            expect(pos.min[1]).toBeGreaterThan(-1)
            expect(pos.min[1]).toBeLessThan(0.01)
            const h = pos.max[1] - pos.min[1]
            const w = Math.max(pos.max[0] - pos.min[0], pos.max[2] - pos.min[2])
            expect(h).toBeGreaterThan(3)
            expect(w).toBeGreaterThan(20)
            expect(w).toBeLessThan(140)
            // light enough for a phone on a slow network
            expect(size).toBeLessThan(400 * 1024)
        })
    }
})

describe("never on the map (owner, 2026-10-12)", () => {
    it("the desktop layer draws markers only — no model on its entities", () => {
        const src = readFileSync("src/globe/GlobeEndangeredPlacesLayer.jsx", "utf8")
        expect(src).not.toMatch(/\bmodel=\{/)
        expect(src).not.toMatch(/placeModels/)
        expect(src).toMatch(/billboard=\{/)
    })
    it("the phone's map layer has no model either", () => {
        const src = readFileSync("src/mobile/mapLayers.js", "utf8")
        expect(src).not.toMatch(/\.glb/)
    })
})
