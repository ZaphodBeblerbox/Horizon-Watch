import { describe, it, expect } from "vitest"
import { buildOntologyRecord, traceRationale, ORIGIN_CLASS, LICENCE_TIER } from "./ontologyRecord.js"
import { readFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"

describe("§10.4 / rule 3 — if it can be seen, it can be traced", () => {
    it("reads the record an entity already carries", () => {
        const r = buildOntologyRecord("geoconfirmed", {
            id: "GC-00042", origin_class: "B", licence_tier: "T3",
            source_ref: ["ref-1", "ref-2"], edges: ["located_in", "mentioned_with"],
            ingested: "2026-09-17T10:00:00Z",
        })
        expect(r.instance).toBe("GC-00042")
        expect(r.originClass).toBe("B")
        expect(r.licenceTier).toBe("T3")
        expect(r.sourceRef).toHaveLength(2)
        expect(r.edges).toEqual(["located_in", "mentioned_with"])
        expect(r.complete).toBe(true)
    })

    it("keeps origin and licence as TWO judgements, never one", () => {
        // origin_class is evidential, licence_tier is legal. Collapsing them
        // loses the ability to answer either question.
        expect(ORIGIN_CLASS.A).toMatch(/instrument/i)
        // D is the weakest class — open reporting. These three assertions
        // previously encoded the WRONG definitions (C as analyst-produced,
        // D as derived), which is how a mistake in a provenance panel
        // survives a green test run.
        expect(ORIGIN_CLASS.D).toMatch(/open reporting/i)
        expect(LICENCE_TIER.T2).toMatch(/never leaves the building/i)
    })

    it("NEVER fabricates a record it was not given", () => {
        const r = buildOntologyRecord("vessel", { mmsi: 123456789 })
        expect(r.originClass).toBeNull()
        expect(r.licenceTier).toBeNull()
        expect(r.complete).toBe(false)
    })

    it("says so, loudly, when an object arrived with no record at all", () => {
        // A silent omission lets an untraceable object look identical to a
        // traced one, which is the state the rule exists to prevent.
        const r = buildOntologyRecord("mystery", {})
        expect(traceRationale(r)).toMatch(/without an ontology record/)
        expect(traceRationale(r)).toMatch(/cannot be traced/)
    })

    it("names exactly what is missing when the record is partial", () => {
        const r = buildOntologyRecord("alert", { id: "A-1", origin_class: "A" })
        expect(traceRationale(r)).toMatch(/Partially traceable/)
        expect(traceRationale(r)).toMatch(/licence tier/)
    })

    it("states the evidence and the licence in the rationale when complete", () => {
        const r = buildOntologyRecord("surge", {
            id: "SRG-1", origin_class: "D", licence_tier: "T3", source_ref: ["a", "b", "c"],
        })
        const line = traceRationale(r)
        expect(line).toMatch(/open reporting/i)
        expect(line).toMatch(/3 contributing sources/)
        expect(line).toMatch(/derived metrics only/i)
    })

    it("says 'no cited source' rather than implying one", () => {
        const r = buildOntologyRecord("x", { id: "1", origin_class: "B", licence_tier: "T1" })
        expect(traceRationale(r)).toMatch(/no cited source/)
    })
})

describe("field shapes in the wild", () => {
    it("accepts a JSON-encoded array, a comma list, or a real array", () => {
        expect(buildOntologyRecord("x", { edges: '["a","b"]' }).edges).toEqual(["a", "b"])
        expect(buildOntologyRecord("x", { edges: "a, b" }).edges).toEqual(["a", "b"])
        expect(buildOntologyRecord("x", { edges: ["a"] }).edges).toEqual(["a"])
        expect(buildOntologyRecord("x", {}).edges).toEqual([])
    })

    it("falls back across the id spellings real payloads use", () => {
        expect(buildOntologyRecord("x", { alert_id: "AL-9" }).instance).toBe("AL-9")
        expect(buildOntologyRecord("x", { detection_id: "D-9" }).instance).toBe("D-9")
        expect(buildOntologyRecord("x", { system_id: "S-9", id: 1 }).instance).toBe("S-9")
    })
})

describe("the definitions must not drift from the backend", () => {
    // backend/provenance.py is the single source of truth for this mapping,
    // and this block is the only place an analyst reads its meaning. A
    // definition that disagrees with the backend is worse than none: it is
    // confident and wrong in the one panel whose whole job is traceability.
    const py = readFileSync(
        path.join(path.dirname(fileURLToPath(import.meta.url)), "../../backend/provenance.py"),
        "utf8",
    ).toLowerCase()

    it("describes each origin class the way the backend does", () => {
        expect(ORIGIN_CLASS.A.toLowerCase()).toContain("instrument")
        expect(py).toContain("a = primary instrument")

        expect(ORIGIN_CLASS.B.toLowerCase()).toContain("registry")
        expect(py).toContain("b = authoritative registry")

        // C is commercial redistribution, NOT "analyst-produced".
        expect(ORIGIN_CLASS.C.toLowerCase()).toContain("commercial")
        expect(py).toContain("c = commercial/aggregated redistribution")

        // D is open reporting — the WEAKEST class. Calling it "derived by
        // this system" would invite more trust, not less.
        expect(ORIGIN_CLASS.D.toLowerCase()).toContain("open reporting")
        expect(py).toContain("d = open reporting")
        expect(ORIGIN_CLASS.D.toLowerCase()).not.toContain("derived")
    })

    it("keeps T4 as 'illegal in a paid deliverable', not 'internal only'", () => {
        // T4 is the entire reason origin and licence are two fields.
        expect(LICENCE_TIER.T4.toLowerCase()).toContain("illegal in a paid deliverable")
        expect(py).toContain("illegal in a paid deliverable")
        // T2 is the "internal only" one.
        expect(LICENCE_TIER.T2.toLowerCase()).toContain("internal only")
    })
})
