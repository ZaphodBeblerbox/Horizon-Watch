import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import {
    AFFILIATION,
    ENTITY_FUNCTION,
    resolveVesselAffiliation,
    resolveAircraftAffiliation,
    resolveAlertAffiliation,
    resolveAlertEntityFunction,
    vesselTypeToFunction,
    aircraftClassToFunction,
    affiliationColor,
} from "./markerRenderer.js"
import { vesselShipType } from "./iconUtils.js"

const __dirname = dirname(fileURLToPath(import.meta.url))

describe("resolveAlertAffiliation — Suspect vs Hostile (real backend fields)", () => {
    it("a sanctions hit the backend could NOT corroborate (confirmed: false) renders as Suspect, never Hostile", () => {
        // Shape mirrors backend/detectors/correlation_engine.py's
        // SANCTIONS_VESSEL_POSSIBLE branch exactly.
        const alert = {
            rule_id: "SANCTIONS_VESSEL_POSSIBLE",
            alert_category: "SANCTIONS_VIOLATION",
            rule_name: "Sanctioned Vessel",
            severity: "medium",
            sanctions_hit: true,
            sanctions_hit_confirmed: false,
        }
        expect(resolveAlertAffiliation(alert)).toBe(AFFILIATION.SUSPECT)
        expect(resolveAlertAffiliation(alert)).not.toBe(AFFILIATION.HOSTILE)
    })

    it("an STS-pair alert with a flag-mismatched (unconfirmed) sanctions hit in payload also renders as Suspect", () => {
        // Shape mirrors backend/main.py's STS-pair path (payload.is_sanctions_confirmed).
        const alert = {
            rule_name: "Ship-to-Ship Transfer",
            severity: "high",
            payload: { is_sanctions_related: true, is_sanctions_confirmed: false },
        }
        expect(resolveAlertAffiliation(alert)).toBe(AFFILIATION.SUSPECT)
    })

    it("a corroborated (confirmed: true) sanctions hit renders as Hostile", () => {
        const alert = {
            rule_id: "SANCTIONS_VESSEL_DETECTED",
            rule_name: "Sanctioned Vessel",
            severity: "critical",
            sanctions_hit: true,
            sanctions_hit_confirmed: true,
        }
        expect(resolveAlertAffiliation(alert)).toBe(AFFILIATION.HOSTILE)
    })

    it("a plain behavioural anomaly alert (no sanctions signal) renders as Neutral, not Suspect/Hostile", () => {
        const alert = { rule_name: "Reverse Course", severity: "medium" }
        expect(resolveAlertAffiliation(alert)).toBe(AFFILIATION.NEUTRAL)
    })

    it("a dark-ship / unknown-contact alert renders as Unknown", () => {
        expect(resolveAlertAffiliation({ alert_category: "DARK_SHIP", severity: "high" })).toBe(AFFILIATION.UNKNOWN)
        expect(resolveAlertAffiliation({ alert_category: "UNKNOWN_CONTACT" })).toBe(AFFILIATION.UNKNOWN)
    })

    it("Suspect never uses the same colour as Hostile (design requirement, not just a different shape)", () => {
        expect(affiliationColor(AFFILIATION.SUSPECT)).not.toBe(affiliationColor(AFFILIATION.HOSTILE))
    })
})

describe("resolveVesselAffiliation — Neutral vs Unknown", () => {
    it("a vessel with clean, consistent static data (name + ship_type) and no sanctions hit renders as Neutral", () => {
        const vessel = { mmsi: "123456789", name: "MV EXAMPLE", ship_type: "General Cargo Ship" }
        expect(resolveVesselAffiliation(vessel)).toBe(AFFILIATION.NEUTRAL)
    })

    it("a vessel with no identifying data at all defaults to Unknown", () => {
        expect(resolveVesselAffiliation({ mmsi: "123456789" })).toBe(AFFILIATION.UNKNOWN)
        expect(resolveVesselAffiliation({})).toBe(AFFILIATION.UNKNOWN)
        expect(resolveVesselAffiliation(null)).toBe(AFFILIATION.UNKNOWN)
    })

    it("never resolves a base vessel record to Hostile or Suspect (that signal only comes from the alert overlay)", () => {
        const vessel = { mmsi: "1", name: "ANYTHING", ship_type: "tanker" }
        const affiliation = resolveVesselAffiliation(vessel)
        expect(affiliation).not.toBe(AFFILIATION.HOSTILE)
        expect(affiliation).not.toBe(AFFILIATION.SUSPECT)
    })
})

describe("resolveAircraftAffiliation — Neutral vs Unknown", () => {
    it("an aircraft with a callsign renders as Neutral", () => {
        expect(resolveAircraftAffiliation({ flight: "UAL123", category: "A3" })).toBe(AFFILIATION.NEUTRAL)
    })

    it("an aircraft with no callsign/category/icao renders as Unknown", () => {
        expect(resolveAircraftAffiliation({ flight: "", category: "" })).toBe(AFFILIATION.UNKNOWN)
        expect(resolveAircraftAffiliation({})).toBe(AFFILIATION.UNKNOWN)
    })
})

describe("Friendly affiliation is fully defined but wired to zero real callers", () => {
    it("AFFILIATION.FRIENDLY has a real resolved colour distinct from the other four", () => {
        const colors = new Set(Object.values(AFFILIATION).map(affiliationColor))
        expect(colors.size).toBe(5) // unknown/neutral/hostile/suspect/friendly all distinct
    })

    it("no resolver function in this module can ever return Friendly for any input", () => {
        const vesselInputs = [null, {}, { name: "x" }, { ship_type: "military" }, { mmsi: "1", name: "x", ship_type: "y" }]
        const aircraftInputs = [null, {}, { flight: "ABC123" }, { category: "A7" }]
        const alertInputs = [
            {}, { severity: "critical" }, { sanctions_hit_confirmed: true }, { sanctions_hit_confirmed: false },
            { rule_name: "Sanctioned Vessel" }, { rule_name: "Ship-to-Ship Transfer" }, { alert_category: "DARK_SHIP" },
        ]
        for (const v of vesselInputs)   expect(resolveVesselAffiliation(v)).not.toBe(AFFILIATION.FRIENDLY)
        for (const a of aircraftInputs) expect(resolveAircraftAffiliation(a)).not.toBe(AFFILIATION.FRIENDLY)
        for (const a of alertInputs)    expect(resolveAlertAffiliation(a)).not.toBe(AFFILIATION.FRIENDLY)
    })

    it("no globe layer or UI component passes AFFILIATION.FRIENDLY as a literal argument (source scan)", () => {
        // Real, repo-wide confirmation (not just a review of the resolvers
        // above) — walks every .jsx/.js file under src/ except this module's
        // own definition file and asserts the literal "AFFILIATION.FRIENDLY"
        // never appears as a value passed into the marker system.
        const root = join(__dirname, "..") // src/
        const offenders = []
        const walk = (dir) => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                if (entry.name === "node_modules") continue
                const full = join(dir, entry.name)
                if (entry.isDirectory()) { walk(full); continue }
                if (!/\.(jsx?|tsx?)$/.test(entry.name)) continue
                if (full === join(__dirname, "markerRenderer.js")) continue
                if (full === join(__dirname, "markerRenderer.test.js")) continue
                const text = readFileSync(full, "utf8")
                if (text.includes("AFFILIATION.FRIENDLY")) offenders.push(full)
            }
        }
        walk(root)
        expect(offenders).toEqual([])
    })
})

describe("vesselTypeToFunction — real ship_type sub-type glyph selection", () => {
    it("maps a tanker classification to the tanker glyph", () => {
        expect(vesselTypeToFunction(vesselShipType({ ship_type: "Crude Oil Tanker" }))).toBe(ENTITY_FUNCTION.VESSEL_TANKER)
    })

    it("maps a cargo classification to the cargo glyph", () => {
        expect(vesselTypeToFunction(vesselShipType({ ship_type: "General Cargo" }))).toBe(ENTITY_FUNCTION.VESSEL_CARGO)
    })

    it("maps an unrecognised/missing ship_type to the generic vessel glyph, not a guessed sub-type", () => {
        expect(vesselTypeToFunction(vesselShipType({}))).toBe(ENTITY_FUNCTION.VESSEL_OTHER)
        expect(vesselTypeToFunction(vesselShipType({ ship_type: "Something Weird" }))).toBe(ENTITY_FUNCTION.VESSEL_OTHER)
    })

    it("maps a fishing-vessel classification to the fishing glyph", () => {
        expect(vesselTypeToFunction(vesselShipType({ ship_type: "Fishing Trawler" }))).toBe(ENTITY_FUNCTION.VESSEL_FISHING)
    })
})

describe("aircraftClassToFunction — real acClassify() bucket mapping", () => {
    it("maps each of the four real coarse buckets, and falls back to general for anything else", () => {
        expect(aircraftClassToFunction("commercial")).toBe(ENTITY_FUNCTION.AIRCRAFT_COMMERCIAL)
        expect(aircraftClassToFunction("military")).toBe(ENTITY_FUNCTION.AIRCRAFT_MILITARY)
        expect(aircraftClassToFunction("helicopter")).toBe(ENTITY_FUNCTION.AIRCRAFT_HELICOPTER)
        expect(aircraftClassToFunction("general")).toBe(ENTITY_FUNCTION.AIRCRAFT_GENERAL)
        expect(aircraftClassToFunction("nonsense")).toBe(ENTITY_FUNCTION.AIRCRAFT_GENERAL)
    })
})

describe("resolveAlertEntityFunction — domain-based entity function for generic alerts", () => {
    it("routes AIS-domain alerts to a vessel glyph and ADSB-domain alerts to an aircraft glyph", () => {
        expect(resolveAlertEntityFunction({ domain: "AIS" })).toBe(ENTITY_FUNCTION.VESSEL_OTHER)
        expect(resolveAlertEntityFunction({ domain: "ADSB" })).toBe(ENTITY_FUNCTION.AIRCRAFT_GENERAL)
        expect(resolveAlertEntityFunction({ domain: "ADSB", aircraft_military: true })).toBe(ENTITY_FUNCTION.AIRCRAFT_MILITARY)
        expect(resolveAlertEntityFunction({ domain: "NEWS" })).toBe(ENTITY_FUNCTION.NEWS_EVENT)
    })
})
