import { describe, it, expect } from "vitest"
import { buildZoneTree, isBackground, isProposal } from "./overwatchTree.js"

const z = (id, meta = {}, extra = {}) => ({ system_id: id, name: id, status: "active", metadata: meta, ...extra })

describe("buildZoneTree", () => {
    it("groups by metadata.group/subgroup, ungrouped under Other, Other last", () => {
        const tree = buildZoneTree([
            z("Z1", { group: "Ukraine", subgroup: "Strike targets" }),
            z("Z2"),
            z("Z3", { group: "Ukraine", subgroup: "Air bases" }),
            z("Z4", { group: "Gaza", subgroup: "Hot right now" }),
        ])
        expect(tree.map((g) => g.group)).toEqual(["Gaza", "Ukraine", "Other"])
        expect(tree[1].subgroups.map((s) => s.subgroup)).toEqual(["Air bases", "Strike targets"])
        expect(tree[2].subgroups[0].zones[0].system_id).toBe("Z2")
        expect(tree[1].count).toBe(2)
    })

    it("counts proposals and lists them first, best score first", () => {
        const tree = buildZoneTree([
            z("A", { group: "Ukraine", subgroup: "Air bases", score: 60 }),
            z("B", { group: "Ukraine", subgroup: "Air bases", score: 70 }, { status: "proposed" }),
            z("C", { group: "Ukraine", subgroup: "Air bases", score: 90 }, { status: "proposed" }),
        ])
        const s = tree[0].subgroups[0]
        expect(s.proposed).toBe(2)
        expect(tree[0].proposed).toBe(2)
        expect(s.zones.map((x) => x.system_id)).toEqual(["C", "B", "A"])
    })

    it("puts unknown subgroups after the generator's own, and survives junk", () => {
        const tree = buildZoneTree([
            z("A", { group: "Ukraine", subgroup: "Zebra" }),
            z("B", { group: "Ukraine", subgroup: "Found by sweep" }),
            z("C", { group: "Ukraine", subgroup: "Air bases" }),
        ])
        expect(tree[0].subgroups.map((s) => s.subgroup)).toEqual(["Air bases", "Found by sweep", "Zebra"])
        expect(buildZoneTree(null)).toEqual([])
        expect(buildZoneTree([{ system_id: "X" }])[0].group).toBe("Other")
    })

    it("keeps proposals, the sweep plan and sweep tiles out of the strip", () => {
        expect(isProposal({ status: "proposed" })).toBe(true)
        expect(isBackground({ status: "active", aoi_class: "sweep_plan" })).toBe(true)
        expect(isBackground({ status: "active", aoi_class: "sweep" })).toBe(true)
        expect(isBackground({ status: "active", aoi_class: "airport" })).toBe(false)
    })
})
