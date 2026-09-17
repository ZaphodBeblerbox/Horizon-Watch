import { describe, it, expect } from "vitest"
import { buildOntologyRecord, traceRationale, ORIGIN_CLASS, LICENCE_TIER } from "./ontologyRecord.js"

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
        expect(ORIGIN_CLASS.A).toMatch(/Instrument/)
        expect(ORIGIN_CLASS.D).toMatch(/Derived/)
        expect(LICENCE_TIER.T2).toMatch(/never shipped/)
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
        expect(line).toMatch(/Derived/)
        expect(line).toMatch(/3 contributing sources/)
        expect(line).toMatch(/Derived metrics may ship/)
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
