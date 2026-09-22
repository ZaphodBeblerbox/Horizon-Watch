import { describe, it, expect } from "vitest"
import { hash01, connectedCore, layout, bridgePosition, summarise, pluralise } from "./clusterLayout.js"

const CL = (id, links = 0, counts = {}) => ({ id, label: id, links, counts })

describe("cluster layout", () => {
    it("is deterministic across runs", () => {
        // An analyst learns where things are; a layout that reshuffles
        // on refresh destroys that and makes two screenshots
        // incomparable.
        const clusters = [CL("country:UA", 2), CL("country:RU", 1), CL("country:IR", 1)]
        const links = [{ src: "country:UA", dst: "country:RU" }]
        const bridges = [{ id: "equipment:Shahed", countries: ["country:IR", "country:UA"] }]
        const a = layout(clusters, links, bridges, { iterations: 30 })
        const b = layout(clusters, links, bridges, { iterations: 30 })
        expect([...a.positions.entries()]).toEqual([...b.positions.entries()])
    })

    it("hash01 is stable and in range", () => {
        expect(hash01("country:UA")).toBe(hash01("country:UA"))
        for (const s of ["", "a", "country:ZZ"]) {
            const v = hash01(s)
            expect(v).toBeGreaterThanOrEqual(0)
            expect(v).toBeLessThan(1)
        }
    })

    it("lays out only the connected core", () => {
        // 150 inert plates on screen is slower and harder to read.
        const clusters = [CL("country:UA"), CL("country:RU"), CL("country:XX")]
        const { core, rest } = connectedCore(
            clusters, [{ src: "country:UA", dst: "country:RU" }], [])
        expect(core.map((c) => c.id)).toEqual(["country:UA", "country:RU"])
        expect(rest.map((c) => c.id)).toEqual(["country:XX"])
    })

    it("counts a country reached only by a bridge as connected", () => {
        // A plate that looks isolated when a bridge reaches it misleads.
        const { core } = connectedCore(
            [CL("country:IR")], [],
            [{ id: "equipment:Shahed", countries: ["country:IR", "country:UA"] }])
        expect(core.map((c) => c.id)).toEqual(["country:IR"])
    })

    it("keeps every plate inside the viewport", () => {
        const clusters = Array.from({ length: 40 }, (_, i) => CL(`country:C${i}`, 1))
        const links = clusters.slice(1).map((c) => ({ src: "country:C0", dst: c.id }))
        const { positions } = layout(clusters, links, [], { width: 800, height: 600 })
        for (const p of positions.values()) {
            expect(p.x).toBeGreaterThanOrEqual(0)
            expect(p.x).toBeLessThanOrEqual(800)
            expect(p.y).toBeGreaterThanOrEqual(0)
            expect(p.y).toBeLessThanOrEqual(600)
        }
    })

    it("separates coincident plates instead of dividing by zero", () => {
        const { positions } = layout([CL("a"), CL("b")],
                                     [{ src: "a", dst: "b" }], [],
                                     { iterations: 5 })
        for (const p of positions.values()) {
            expect(Number.isFinite(p.x)).toBe(true)
            expect(Number.isFinite(p.y)).toBe(true)
        }
    })

    it("handles an empty graph", () => {
        const r = layout([], [], [])
        expect(r.positions.size).toBe(0)
    })

    it("puts a bridge between the plates it touches, not on one", () => {
        const positions = new Map([
            ["country:IR", { x: 0, y: 0 }],
            ["country:UA", { x: 100, y: 50 }],
        ])
        expect(bridgePosition({ countries: ["country:IR", "country:UA"] }, positions))
            .toEqual({ x: 50, y: 25 })
    })

    it("has no position for a bridge whose countries are not drawn", () => {
        expect(bridgePosition({ countries: ["country:ZZ"] }, new Map())).toBeNull()
        expect(bridgePosition(null, new Map())).toBeNull()
    })

    it("summarises a plate by its largest kinds", () => {
        expect(summarise({ vessel: 828, facility: 9 })).toBe("828 vessels · 9 facilities")
        expect(summarise({ vessel: 1 })).toBe("1 vessel")
        expect(summarise({ a: 3, b: 2, c: 1 })).toContain("+1 more")
    })

    it("pluralises the node types it actually has", () => {
        // "facilitys" and "aircrafts" are not words, and a graph of the
        // brain reading like a machine undermines it.
        expect(summarise({ facility: 3 })).toBe("3 facilities")
        expect(summarise({ aircraft: 4 })).toBe("4 aircraft")
        expect(summarise({ equipment: 2 })).toBe("2 equipment")
        expect(summarise({ person: 2 })).toBe("2 people")
        expect(summarise({ vessel: 1 })).toBe("1 vessel")
    })

    it("says so when a plate has nothing in it", () => {
        // Rule 5: an empty thing explains itself.
        expect(summarise({})).toBe("nothing registered")
        expect(summarise(null)).toBe("nothing registered")
    })
})
