import { describe, it, expect } from "vitest"
import { isRealFiniteNumber, selectRealConnectorTargets } from "./connectorLineGeometry.js"

describe("isRealFiniteNumber — the real fix for the isFinite(null)===true crash", () => {
    it("rejects null (the actual reported crash cause — bare isFinite(null) is true)", () => {
        expect(isRealFiniteNumber(null)).toBe(false)
    })
    it("rejects undefined", () => {
        expect(isRealFiniteNumber(undefined)).toBe(false)
    })
    it("rejects a non-numeric object/array", () => {
        expect(isRealFiniteNumber({})).toBe(false)
        expect(isRealFiniteNumber([56.4])).toBe(false)
    })
    it("rejects a numeric-looking string (never coerces, unlike bare isFinite)", () => {
        expect(isRealFiniteNumber("56.4")).toBe(false)
    })
    it("accepts a real finite number, including the real edge case of exactly 0 (equator/prime meridian)", () => {
        expect(isRealFiniteNumber(56.4)).toBe(true)
        expect(isRealFiniteNumber(0)).toBe(true)
        expect(isRealFiniteNumber(-12.34)).toBe(true)
    })
    it("rejects NaN/Infinity", () => {
        expect(isRealFiniteNumber(NaN)).toBe(false)
        expect(isRealFiniteNumber(Infinity)).toBe(false)
    })
})

describe("selectRealConnectorTargets — real production data shape", () => {
    // Real shape confirmed live against production data (GET /api/forge/
    // ontology/node/geoconfirmed_f8c690dd.../connections): a GeoConfirmed
    // event real-linked to an abstract Faction (no coordinates) AND a real
    // chokepoint (real coordinates) — exactly the mix that crashed before
    // this fix, since the Faction connection's null lat/lng used to slip
    // through the old isFinite() filter.
    const realConnections = [
        {
            id: "faction_iranian_armed_forces", type: "faction", label: "Iranian Armed Forces",
            relationship_type: "faction_of", auto: true, claim_id: null, lat: null, lng: null,
        },
        {
            id: "choke_CHOKE-001", type: "chokepoint", label: "Strait of Hormuz",
            relationship_type: "near", auto: true, claim_id: null, lat: 26.5, lng: 56.4,
        },
    ]

    it("never crashes on and correctly excludes the real null-coordinate Faction connection", () => {
        const targets = selectRealConnectorTargets(realConnections)
        expect(targets.find(t => t.id === "faction_iranian_armed_forces")).toBeUndefined()
    })

    it("still includes the real chokepoint connection with real coordinates", () => {
        const targets = selectRealConnectorTargets(realConnections)
        expect(targets).toHaveLength(1)
        expect(targets[0].id).toBe("choke_CHOKE-001")
    })

    it("handles a real empty/undefined connections list without throwing", () => {
        expect(selectRealConnectorTargets([])).toEqual([])
        expect(selectRealConnectorTargets(undefined)).toEqual([])
        expect(selectRealConnectorTargets(null)).toEqual([])
    })
})
