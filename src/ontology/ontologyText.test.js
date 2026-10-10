import { describe, it, expect } from "vitest"
import { relationLines } from "./ontologyText.js"

describe("the ontology in words", () => {
    it("names what is at the other end of each relation", () => {
        const g = {
            root: { id: "c", label: "War in Yemen" },
            nodes: [{ id: "ye", label: "Yemen" }, { id: "ir", label: "Iran" }, { id: "h", label: "Ansar Allah" }, { id: "v", label: "963 vessels", count: 963 }],
            links: [{ src: "c", dst: "ye", relation: "fought in" }, { src: "ir", dst: "c", relation: "backs" },
                    { src: "h", dst: "c", relation: "fights" }, { src: "v", dst: "c", relation: "flagged in" }],
        }
        const lines = relationLines(g)
        expect(lines[0]).toMatchObject({ label: "Flagged here" })
        const fought = lines.find((l) => l.label === "Fought in")
        expect(fought.items.map((x) => x.label)).toEqual(["Yemen"])
        expect(lines.find((l) => l.label === "Backed by").items[0].label).toBe("Iran")
        expect(lines.find((l) => l.label === "Fought by").items[0].label).toBe("Ansar Allah")
    })
    it("writes a two-way relation once", () => {
        const g = { root: { id: "r" }, nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
                    links: [{ src: "r", dst: "a", relation: "consulting with" }, { src: "b", dst: "r", relation: "consulting with" }] }
        const lines = relationLines(g)
        expect(lines.length).toBe(1)
        expect(lines[0].items.map((x) => x.label)).toEqual(["A", "B"])
    })
    it("caps a long list and counts the rest", () => {
        const nodes = Array.from({ length: 7 }, (_, i) => ({ id: `n${i}`, label: `N${i}` }))
        const g = { root: { id: "r" }, nodes, links: nodes.map((n) => ({ src: "r", dst: n.id, relation: "allied with" })) }
        const [l] = relationLines(g, { max: 4 })
        expect(l.items.length).toBe(4)
        expect(l.more).toBe(3)
    })
})
