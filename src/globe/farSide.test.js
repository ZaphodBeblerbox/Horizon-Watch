import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { placeNamesProvider, esriLabelsProvider, esriDarkLabelsProvider, esriLightLabelsProvider } from "./imageryProviders.js"

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const walk = (d) => readdirSync(d).flatMap((n) => {
    const p = path.join(d, n)
    if (statSync(p).isDirectory()) return walk(p)
    return /\.jsx?$/.test(n) && !/\.test\./.test(n) ? [p] : []
})

describe("markers on the far side of the globe", () => {
    // Owner, 2026-10-18: "markers visible through the globe when you scroll
    // to the other side". disableDepthTestDistance: Infinity means "never
    // depth test", so the planet never hides the marker. Every layer uses
    // the one finite distance (entityIcons.js MARKER_DEPTH_TEST_M).
    it("no globe layer switches the depth test off at every distance", () => {
        const offenders = walk(src).filter((f) => /disableDepthTestDistance:\s*(Number\.POSITIVE_INFINITY|Infinity)/.test(readFileSync(f, "utf8")))
        expect(offenders.map((f) => path.relative(src, f))).toEqual([])
    })
})

describe("place names", () => {
    // The grey canvas bases already name the countries; the full reference
    // layer named them a second time (owner, 2026-10-18: "Algeria" twice).
    it("pairs the plain map with its own reference layer, imagery with the full one", () => {
        expect(placeNamesProvider("dark", false)).toBe(esriDarkLabelsProvider)
        expect(placeNamesProvider("dark", true)).toBe(esriLightLabelsProvider)
        expect(placeNamesProvider("satellite", false)).toBe(esriLabelsProvider)
        expect(placeNamesProvider("terrain", true)).toBe(esriLabelsProvider)
    })
})
