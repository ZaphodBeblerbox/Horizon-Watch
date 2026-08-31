import { describe, it, expect } from "vitest"
import {
    normalizeEntity,
    adaptVessel,
    adaptAircraft,
    adaptAlert,
    adaptZone,
    adaptNews,
    adaptInfrastructure,
    adaptGeneric,
} from "./adapters.js"

function findAttr(attributes, label) {
    return attributes.find((a) => a.label === label)
}

describe("adaptVessel — real sanctions corroboration status feeds the status ring, not a shape", () => {
    it("a vessel carrying an uncorroborated ('possible') sanctions hit maps to sanctionsStatus 'possible'", () => {
        const vessel = {
            mmsi: "123456789", name: "MV SHADOW", ship_type: "Crude Oil Tanker",
            sanctions: { status: "possible", hit: { list: "OFAC SDN" }, mmsi: "123456789", vessel_name: "MV SHADOW" },
        }
        const result = adaptVessel(vessel)
        expect(result.identity.sanctionsStatus).toBe("possible")
        expect(result.identity.entityType).toBe("vessel")
        expect(result.identity.subtype).toBe("tanker")
        expect(findAttr(result.attributes, "Sanctions").value).toMatch(/possible/)
    })

    it("a vessel with a corroborated ('confirmed') sanctions hit maps to sanctionsStatus 'confirmed'", () => {
        const vessel = { mmsi: "1", name: "MV BAD", ship_type: "tanker", sanctions: { status: "confirmed" } }
        expect(adaptVessel(vessel).identity.sanctionsStatus).toBe("confirmed")
    })

    it("a clean vessel with no sanctions signal has no sanctionsStatus", () => {
        const vessel = { mmsi: "111222333", name: "MV EXAMPLE", ship_type: "General Cargo Ship", sog: 12.4, heading: 88 }
        const result = adaptVessel(vessel)
        expect(result.identity.sanctionsStatus).toBeNull()
        expect(result.identity.title).toBe("MV EXAMPLE")
        expect(findAttr(result.attributes, "MMSI").value).toBe("111222333")
        expect(findAttr(result.attributes, "Speed").value).toBe("12.4 kn")
        expect(findAttr(result.attributes, "Course").value).toBe("88°")
    })

    it("omits fields that aren't present rather than fabricating them", () => {
        const result = adaptVessel({ mmsi: "1", name: "MV X" })
        expect(findAttr(result.attributes, "Destination")).toBeUndefined()
        expect(findAttr(result.attributes, "Flag")).toBeUndefined()
        expect(result.provenance).toBeNull()
    })

    it("exposes a jump-to-location action only when a real position is present", () => {
        expect(adaptVessel({ mmsi: "1", name: "MV X" }).actions.canJumpToLocation).toBe(false)
        expect(adaptVessel({ mmsi: "1", name: "MV X", lat: 10, lon: 20 }).actions.canJumpToLocation).toBe(true)
    })

    it("surfaces real provenance fields when present, without inventing missing ones", () => {
        const result = adaptVessel({ mmsi: "1", name: "MV X", feed_name: "AIS-STREAM", ingested_at: "2026-01-01T00:00:00Z" })
        expect(result.provenance.feed).toBe("AIS-STREAM")
        expect(result.provenance.ingestedAt).toBeTruthy()
    })
})

describe("adaptAircraft", () => {
    it("maps a commercial aircraft with position/heading/speed/altitude and the real sub-type", () => {
        const ac = { flight: "UAL123", category: "A3", lat: 40.1, lon: -74.2, track: 270, gs: 420, alt_baro: 35000 }
        const result = adaptAircraft(ac)
        expect(result.identity.title).toBe("UAL123")
        expect(result.identity.entityType).toBe("aircraft")
        expect(result.identity.subtype).toBe("commercial")
        expect(findAttr(result.attributes, "Position").value).toContain("40.100")
        expect(findAttr(result.attributes, "Heading").value).toBe("270°")
        expect(findAttr(result.attributes, "Speed").value).toBe("420 kts")
        expect(findAttr(result.attributes, "Altitude").value).toBe("35,000 ft")
    })

    it("classifies a military aircraft distinctly from a general one", () => {
        expect(adaptAircraft({ military: true }).identity.subtype).toBe("military")
        expect(adaptAircraft({}).identity.subtype).toBe("general")
    })

    it("surfaces a real airline/type/registration lookup (GET /api/aviation/route/{icao24}) once merged in, and no fake confidence field", () => {
        const ac = { flight: "AFR816", icao: "394A0E", airline: "Air France", aircraft_type: "777", registration: "F-GSQO" }
        const result = adaptAircraft(ac)
        expect(findAttr(result.attributes, "Airline").value).toBe("Air France")
        expect(findAttr(result.attributes, "Type").value).toBe("777")
        expect(findAttr(result.attributes, "Registration").value).toBe("F-GSQO")
        expect(result.attributes.find(a => /confidence/i.test(a.label))).toBeUndefined()
    })

    it("omits the Airline attribute entirely when no real lookup result exists, rather than a placeholder", () => {
        const result = adaptAircraft({ flight: "UAL123" })
        expect(result.attributes.find(a => a.label === "Airline")).toBeUndefined()
    })

    it("carries a real reference photo (GET /api/aviation/photo/{icao24}) as media when one exists", () => {
        const ac = { flight: "AFR816", photo_url: "https://www.planespotters.net/photo/1903521/...", photographer: "Gerrit Griem" }
        const result = adaptAircraft(ac)
        expect(result.media).toEqual({
            photoUrl: ac.photo_url, photographer: "Gerrit Griem", sourceLabel: "Planespotters.net",
        })
    })

    it("media is null (not a placeholder) when no real photo exists for this aircraft", () => {
        expect(adaptAircraft({ flight: "UAL123" }).media).toBeNull()
    })
})

describe("adaptAlert", () => {
    it("maps severity, domain, timestamp, and evidence/summary when present", () => {
        const alert = {
            severity: "high", source: "AIS", rule_name: "Dark Ship",
            timestamp: "2026-01-01T12:00:00Z",
            message: "Vessel went dark near a strategic chokepoint",
            explanation: "AIS transponder stopped reporting for 6+ hours.",
        }
        const result = adaptAlert(alert)
        expect(findAttr(result.attributes, "Severity").value).toBe("high")
        expect(findAttr(result.attributes, "Domain").value).toBe("AIS")
        expect(findAttr(result.attributes, "Timestamp")).toBeTruthy()
        expect(findAttr(result.attributes, "Summary").value).toMatch(/went dark/)
        expect(findAttr(result.attributes, "Evidence").value).toMatch(/transponder/)
    })

    it("an unconfirmed sanctions alert maps to sanctionsStatus 'possible', not 'confirmed'", () => {
        const alert = {
            rule_name: "Sanctioned Vessel", severity: "medium",
            sanctions_hit: true, sanctions_hit_confirmed: false,
        }
        expect(adaptAlert(alert).identity.sanctionsStatus).toBe("possible")
    })

    it("a confirmed sanctions alert maps to sanctionsStatus 'confirmed'", () => {
        const alert = { rule_name: "Sanctioned Vessel", sanctions_hit: true, sanctions_hit_confirmed: true }
        expect(adaptAlert(alert).identity.sanctionsStatus).toBe("confirmed")
    })

    it("picks the entity glyph by real domain — AIS alerts get the vessel glyph", () => {
        const result = adaptAlert({ alert_category: "DARK_SHIP", domain: "AIS", severity: "high" })
        expect(result.identity.entityType).toBe("vessel")
        expect(result.identity.sanctionsStatus).toBeNull()
    })

    it("picks the aircraft glyph with a military sub-type for a real military-squawk alert", () => {
        const result = adaptAlert({ domain: "ADSB", rule_name: "Military Squawk" })
        expect(result.identity.entityType).toBe("aircraft")
        expect(result.identity.subtype).toBe("military")
    })

    it("falls back to the generic alert glyph for a domain-less alert", () => {
        const result = adaptAlert({ rule_name: "Something Else", severity: "low" })
        expect(result.identity.entityType).toBe("alert")
    })
})

describe("adaptZone", () => {
    it("maps a zone with bbox bounds and associated rules", () => {
        const zone = {
            name: "Strait Watch Zone", zone_type: "CHOKEPOINT_EXTENDED", severity_baseline: "high",
            bbox_min_lon: 43.0, bbox_min_lat: 12.5, bbox_max_lon: 44.0, bbox_max_lat: 13.5,
            rules: ["Dark Ship", "Ship-to-Ship Transfer"],
            description: "Chokepoint approach corridor.",
        }
        const result = adaptZone(zone)
        expect(result.identity.title).toBe("Strait Watch Zone")
        expect(result.identity.entityType).toBe("zone")
        expect(findAttr(result.attributes, "Bounds").value).toContain("43.00")
        expect(findAttr(result.attributes, "Associated rules").value).toBe("Dark Ship, Ship-to-Ship Transfer")
        expect(result.actions.canJumpToLocation).toBe(true)
    })

    it("maps a zone with an explicit bounds object and no rules", () => {
        const zone = { name: "Custom AOI", zone_type: "CUSTOM", bounds: { west: 1, south: 2, east: 3, north: 4 } }
        const result = adaptZone(zone)
        expect(findAttr(result.attributes, "Bounds")).toBeTruthy()
        expect(findAttr(result.attributes, "Associated rules")).toBeUndefined()
    })

    it("does not offer jump-to-location when no bounds/coordinates/point exist", () => {
        const result = adaptZone({ name: "Undefined Zone" })
        expect(result.actions.canJumpToLocation).toBe(false)
    })
})

describe("adaptNews — news/event surface items", () => {
    it("maps a headline, source, timestamp and category", () => {
        const item = {
            headline: "Tanker seized near chokepoint", source_name: "Reuters",
            published_at: "2026-02-01T08:00:00Z", event_type: "maritime", severity_tier: "elevated",
        }
        const result = adaptNews(item)
        expect(result.identity.title).toBe("Tanker seized near chokepoint")
        expect(result.identity.entityType).toBe("news_event")
        expect(findAttr(result.attributes, "Source").value).toBe("Reuters")
        expect(findAttr(result.attributes, "Timestamp")).toBeTruthy()
        expect(findAttr(result.attributes, "Category").value).toBe("maritime")
    })

    it("handles an 'event' payload shape (event_type/title) via the same adapter", () => {
        const result = adaptNews({ title: "Armed clash reported", type: "armed_clash", sources: ["AP", "BBC"] })
        expect(result.identity.title).toBe("Armed clash reported")
        expect(findAttr(result.attributes, "Source").value).toBe("AP, BBC")
    })
})

describe("adaptInfrastructure", () => {
    it("maps a normalized ontology infrastructure record (name/infra_type/location)", () => {
        const infra = { name: "Suez Substation", infra_type: "substation", lat: 30.5, lon: 32.3, operator: "Egyptian Electricity" }
        const result = adaptInfrastructure(infra)
        expect(result.identity.title).toBe("Suez Substation")
        expect(result.identity.entityType).toBe("facility")
        expect(findAttr(result.attributes, "Location")).toBeTruthy()
        expect(findAttr(result.attributes, "Operator").value).toBe("Egyptian Electricity")
    })

    it("maps a raw Overpass/OSM element shape (tags/lat/lon)", () => {
        const infra = { elements: [{ type: "way", lat: 10, lon: 20, tags: { power: "substation", voltage: "220000", operator: "Grid Co" } }] }
        const result = adaptInfrastructure(infra)
        expect(result.identity.subtitle).toBe("Substation")
        expect(findAttr(result.attributes, "Voltage").value).toBe("220000")
    })
})

describe("adaptGeneric — unknown entity types never crash and list raw fields honestly", () => {
    it("falls back cleanly for an entirely unrecognised entity type", () => {
        const data = { region_name: "Bab-el-Mandeb", threat_score: 62, trend: "escalating" }
        expect(() => adaptGeneric(data, "threat_region")).not.toThrow()
        const result = adaptGeneric(data, "threat_region")
        expect(result.identity.title).toBe("Bab-el-Mandeb")
        expect(result.identity.entityType).toBe("generic")
        expect(findAttr(result.attributes, "Threat Score").value).toBe("62")
        expect(findAttr(result.attributes, "Trend").value).toBe("escalating")
    })

    it("never fabricates a field — only lists what's actually present", () => {
        const result = adaptGeneric({ name: "Solo Field" }, "mystery")
        expect(result.attributes).toEqual([])
        expect(result.provenance).toBeNull()
    })

    it("does not crash on null/undefined data", () => {
        expect(() => adaptGeneric(undefined, "mystery")).not.toThrow()
        expect(() => normalizeEntity("mystery", null)).not.toThrow()
        expect(normalizeEntity("mystery", null).identity.entityType).toBe("generic")
    })

    it("skips nested objects/arrays rather than rendering '[object Object]'", () => {
        const result = adaptGeneric({ name: "Fusion X", domains: ["AIS", "NEWS"], payload: { foo: "bar" }, confidence: 0.8 }, "fusion")
        expect(findAttr(result.attributes, "Domains")).toBeUndefined()
        expect(findAttr(result.attributes, "Payload")).toBeUndefined()
        expect(findAttr(result.attributes, "Confidence").value).toBe("0.8")
    })
})

describe("normalizeEntity — dispatch", () => {
    it("routes 'event' and 'news' entity types to the same news adapter", () => {
        const a = normalizeEntity("event", { headline: "X", event_type: "fire" })
        const b = normalizeEntity("news", { headline: "X", event_type: "fire" })
        expect(a.identity.entityType).toBe(b.identity.entityType)
    })

    it("routes 'infra' and 'infrastructure' to the same adapter", () => {
        const a = normalizeEntity("infra", { name: "X", infra_type: "port" })
        const b = normalizeEntity("infrastructure", { name: "X", infra_type: "port" })
        expect(a.identity.entityType).toBe(b.identity.entityType)
    })

    it("routes unknown types through adaptGeneric without throwing", () => {
        expect(() => normalizeEntity("sentinel_detection", { detection_id: "D1", confidence: 0.9 })).not.toThrow()
    })

    it("every adapter's actions.canJumpToLocation is a real boolean, not undefined", () => {
        for (const type of ["vessel", "aircraft", "alert", "zone", "news", "infra", "chokepoint"]) {
            const result = normalizeEntity(type, {})
            expect(typeof result.actions.canJumpToLocation).toBe("boolean")
        }
    })
})
