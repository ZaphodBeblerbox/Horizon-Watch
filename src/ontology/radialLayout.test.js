import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { createElement } from "react"
import { radialLayout } from "./radialLayout.js"
import OntologyGraph from "./OntologyGraph.jsx"

const g = {
    root: { id: "r", label: "Root", group: "action" },
    nodes: [
        { id: "a", label: "Ukraine", group: "place" }, { id: "b", label: "47th", group: "actor" },
        { id: "c", label: "FPV", group: "object" }, { id: "d", label: "Loose", group: "object" },
    ],
    links: [{ src: "r", dst: "a", relation: "in" }, { src: "r", dst: "b", relation: "involves" }, { src: "b", dst: "c", relation: "operates" }],
}

describe("radialLayout", () => {
    it("puts the root in the middle, direct links on ring 1, their links behind them", () => {
        const { pos, ring1, ring2 } = radialLayout(g, { w: 400, h: 400, pad: 20 })
        expect(pos.get("r")).toMatchObject({ x: 200, y: 200, ring: 0 })
        expect(ring1.map((n) => n.id)).toEqual(["b", "a"])          // actors before places
        expect(ring2.map((n) => n.id).sort()).toEqual(["c", "d"])
        const b = pos.get("b"), c = pos.get("c")
        expect(Math.abs(b.angle - c.angle)).toBeLessThan(1e-9)       // FPV sits behind the unit that operates it
        expect(Math.hypot(c.x - 200, c.y - 200)).toBeGreaterThan(Math.hypot(b.x - 200, b.y - 200))
        expect(pos.has("d")).toBe(true)
    })
    it("is deterministic", () => {
        const a = radialLayout(g, { w: 300, h: 200 }).pos, b = radialLayout(g, { w: 300, h: 200 }).pos
        expect([...a.entries()]).toEqual([...b.entries()])
    })
    it("renders every node, labelled", () => {
        const html = renderToStaticMarkup(createElement(OntologyGraph, { graph: g }))
        for (const l of ["Root", "Ukraine", "47th"]) expect(html).toContain(l)
    })
})

import { summarise } from "./radialLayout.js"
describe("summarise", () => {
    it("folds a busy graph into one counted node per relation and kind", () => {
        const nodes = Array.from({ length: 14 }, (_, i) => ({ id: `c${i}`, label: `C${i}`, group: "place" }))
        nodes.push({ id: "v", label: "963 vessels", group: "object", count: 963 })
        const links = nodes.slice(0, 14).map((n) => ({ src: "r", dst: n.id, relation: "uses force against" }))
        links.push({ src: "v", dst: "r", relation: "flagged in" })
        const s = summarise({ root: { id: "r", label: "R", group: "place" }, nodes, links }, 10)
        expect(s.nodes.map((n) => n.label).sort()).toEqual(["14 · uses force against", "963 vessels"])
        expect(s.nodes.find((n) => n.members === 14).sample.length).toBe(8)
    })
    it("leaves a small graph alone", () => {
        const g = { root: { id: "r" }, nodes: [{ id: "a" }], links: [] }
        expect(summarise(g, 10)).toBe(g)
    })
})

describe("summarise, many relations", () => {
    it("keeps the biggest relations and folds the rest into one node", () => {
        const nodes = Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, label: `N${i}`, group: "place" }))
        const links = nodes.map((n, i) => ({ src: "r", dst: n.id, relation: `rel${i % 15}` }))
        const s = summarise({ root: { id: "r", label: "R", group: "place" }, nodes, links }, 10)
        expect(s.nodes.length).toBe(10)
        expect(s.nodes.at(-1).label).toBe("12 · other links")
    })
})
