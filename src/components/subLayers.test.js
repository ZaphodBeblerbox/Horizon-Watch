import { describe, it, expect } from "vitest"
import { SUB_LAYERS, DEFAULT_SUBS, LAYER_GROUPS, STARTUP_GROUPS } from "./layerRailConfig.js"

describe("SUB_LAYERS", () => {
    const groups = new Set(LAYER_GROUPS.map((g) => g.key))
    const keys = new Set(SUB_LAYERS.map((l) => l.key))
    it("names only real parent groups", () => {
        for (const l of SUB_LAYERS) if (l.parent) expect(groups.has(l.parent)).toBe(true)
    })
    it("has unique keys", () => expect(keys.size).toBe(SUB_LAYERS.length))
    it("defaults point at sub-layers of their own group", () => {
        for (const [g, list] of Object.entries(DEFAULT_SUBS))
            for (const k of list) expect(SUB_LAYERS.find((l) => l.key === k)?.parent).toBe(g)
    })
    it("is offered in the Settings default-view editor", () => {
        expect(STARTUP_GROUPS.find((g) => g.id === "subs")?.items).toBe(SUB_LAYERS)
    })
})
