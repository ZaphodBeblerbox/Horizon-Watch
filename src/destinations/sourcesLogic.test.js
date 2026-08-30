import { describe, it, expect } from "vitest"
import {
    RULE_TRIGGER_TYPES, TRIGGER_FIELD_SPECS,
    validateRuleForm, buildRulePayload, boundsToPolygon,
} from "./sourcesLogic.js"

describe("RULE_TRIGGER_TYPES / TRIGGER_FIELD_SPECS", () => {
    it("has exactly the 7 real wired rule types, each with a field spec", () => {
        expect(RULE_TRIGGER_TYPES).toHaveLength(7)
        for (const t of RULE_TRIGGER_TYPES) {
            expect(TRIGGER_FIELD_SPECS[t]).toBeTruthy()
            expect(TRIGGER_FIELD_SPECS[t].thresholdField.key).toBeTruthy()
            expect(TRIGGER_FIELD_SPECS[t].targetField.key).toBeTruthy()
        }
    })
})

describe("validateRuleForm", () => {
    it("passes for a valid form", () => {
        const { valid, errors } = validateRuleForm({ name: "Cable watch", triggerType: "AIS_DARK_SHIP", threshold: 60 })
        expect(valid).toBe(true)
        expect(errors).toEqual({})
    })

    it("requires a name", () => {
        const { valid, errors } = validateRuleForm({ name: "  ", triggerType: "AIS_DARK_SHIP" })
        expect(valid).toBe(false)
        expect(errors.name).toBeTruthy()
    })

    it("rejects a trigger type outside the 7 wired ones", () => {
        const { valid, errors } = validateRuleForm({ name: "x", triggerType: "SOMETHING_MADE_UP" })
        expect(valid).toBe(false)
        expect(errors.triggerType).toBeTruthy()
    })

    it("rejects a non-numeric threshold", () => {
        const { valid, errors } = validateRuleForm({ name: "x", triggerType: "AIS_DARK_SHIP", threshold: "not-a-number" })
        expect(valid).toBe(false)
        expect(errors.threshold).toBeTruthy()
    })

    it("allows an omitted threshold (falls back to the type's real default)", () => {
        const { valid } = validateRuleForm({ name: "x", triggerType: "AIS_DARK_SHIP" })
        expect(valid).toBe(true)
    })
})

describe("buildRulePayload", () => {
    it("builds a real AIS_LOITERING_NEAR_INFRA payload with threshold/target mapped into params", () => {
        const body = buildRulePayload({
            name: "Med cable watch", triggerType: "AIS_LOITERING_NEAR_INFRA",
            severity: "high", target: "REG-MED", threshold: 90,
        })
        expect(body.trigger_type).toBe("AIS_LOITERING_NEAR_INFRA")
        expect(body.severity).toBe("high")
        expect(body.params.target).toBe("REG-MED")
        expect(body.params.min_duration_minutes).toBe(90)
        // Untouched real defaults survive
        expect(body.params.infra_type).toBe("Port")
        expect(body.params.proximity_km).toBe(0.5)
    })

    it("builds a real NEWS_PATTERN payload mapping threshold to article_count_threshold", () => {
        const body = buildRulePayload({ name: "Surge watch", triggerType: "NEWS_PATTERN", threshold: 6 })
        expect(body.params.article_count_threshold).toBe(6)
        expect(body.params.pattern_type).toBe("RISING_TENSIONS")
    })

    it("falls back to the trigger_type as the name when name is blank", () => {
        const body = buildRulePayload({ triggerType: "AIS_DARK_SHIP" })
        expect(body.name).toBe("AIS_DARK_SHIP")
    })

    it("defaults enabled to true and omits icon_type when not given", () => {
        const body = buildRulePayload({ name: "x", triggerType: "AIS_DARK_SHIP" })
        expect(body.enabled).toBe(true)
        expect(body.icon_type).toBeUndefined()
    })

    it("returns null for an unrecognized trigger type rather than posting garbage", () => {
        expect(buildRulePayload({ name: "x", triggerType: "NOT_REAL" })).toBeNull()
    })

    it("ignores a non-numeric threshold rather than corrupting params", () => {
        const body = buildRulePayload({ name: "x", triggerType: "AIS_DARK_SHIP", threshold: "abc" })
        expect(body.params.min_gap_minutes).toBe(60) // real default, unmodified
    })
})

describe("boundsToPolygon", () => {
    it("converts rectangle bounds into a closed GeoJSON Polygon ring", () => {
        const poly = boundsToPolygon({ north: 30, south: 20, east: 60, west: 50 })
        expect(poly.type).toBe("Polygon")
        expect(poly.coordinates[0]).toHaveLength(5)
        expect(poly.coordinates[0][0]).toEqual(poly.coordinates[0][4]) // closed ring
        expect(poly.coordinates[0][0]).toEqual([50, 20]) // [lon, lat] = [west, south]
    })

    it("returns null for missing/invalid bounds", () => {
        expect(boundsToPolygon(null)).toBeNull()
        expect(boundsToPolygon({ north: 30, south: 20, east: 60 })).toBeNull()
        expect(boundsToPolygon({ north: "x", south: 20, east: 60, west: 50 })).toBeNull()
    })
})
