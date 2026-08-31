import { describe, it, expect } from "vitest"
import { makePulseColor } from "./GlobeThreatHeatmapLayer.jsx"

// Hotfix regression test: an entity's `.material` field needs the OUTER
// assigned value to implement MaterialProperty's real interface — most
// importantly getType(time), which Cesium's per-frame visualizer calls to
// pick a shader before calling getValue(time). A bare CallbackProperty (or
// anything else that only implements getValue()) crashes that update loop
// with "TypeError: t.getType is not a function" the moment a real pulsing
// (escalating/emerging) threat region reaches the screen — Cesium then stops
// rendering entirely for the whole viewer ("Rendering has stopped").
describe("makePulseColor — real Cesium MaterialProperty contract", () => {
    it("returns a value with a real getType() function, not just getValue()", () => {
        const material = makePulseColor(80, 0.02, 0.08, 1000)
        expect(typeof material.getType).toBe("function")
        expect(typeof material.getValue).toBe("function")
    })

    it("getType() resolves to a real material type string ('Color'), never throwing", () => {
        const material = makePulseColor(50, 0.01, 0.05, 2000)
        expect(() => material.getType()).not.toThrow()
        expect(material.getType()).toBe("Color")
    })

    it("getValue() resolves to a real {color} object usable by Cesium's renderer", () => {
        const material = makePulseColor(30, 0.1, 0.4, 1000)
        const value = material.getValue()
        expect(value).toHaveProperty("color")
        expect(typeof value.color.alpha).toBe("number")
        expect(value.color.alpha).toBeGreaterThanOrEqual(0)
    })
})
