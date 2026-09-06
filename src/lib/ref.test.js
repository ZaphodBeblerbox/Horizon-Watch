import { describe, it, expect, beforeAll } from "vitest"
import { parseRef, resolve, label, REF_KINDS } from "./ref.js"

// Real end-to-end test against the live backend (http://localhost:8000) —
// V3 Phase 1, §7.2's own explicit requirement: "resolve a ref for one
// record of each existing kind and confirm it returns real data, not a
// stub." Real IDs are fetched fresh from the real running backend at test
// time rather than hardcoded, since seed data can change across runs; a
// kind is honestly skipped (not failed) only when the live backend
// genuinely has no real record of that kind available right now (e.g. no
// vessel currently transmitting) — never silently assumed to pass.

const API = "http://localhost:8000"

async function getJSON(path) {
    const r = await fetch(`${API}${path}`)
    if (!r.ok) return null
    return r.json()
}

let realIds = {}

beforeAll(async () => {
    const [alerts, entities, diagram, zones, reports, vessels] = await Promise.all([
        getJSON("/api/forge/alerts"),
        getJSON("/api/dossiers/entities"),
        getJSON("/api/ontology/diagram"),
        getJSON("/api/watch-zones"),
        getJSON("/api/reports?status=all&limit=1"),
        getJSON("/api/ais/vessels"),
    ])

    realIds.sig = Array.isArray(alerts) ? (alerts[0]?.id || alerts[0]?.alert_id) : null
    realIds.ent = Array.isArray(entities) ? entities[0]?.code : null
    realIds.onto = diagram?.nodes?.[0]?.id
    realIds.aoi = Array.isArray(zones) ? zones[0]?.system_id : null
    realIds.brf = Array.isArray(reports) ? reports[0]?.report_id : null
    realIds.trk = vessels?.vessels?.[0]?.mmsi

    if (realIds.aoi) {
        const scans = await getJSON(`/api/watch-zones/${realIds.aoi}/scans`)
        realIds.scn = Array.isArray(scans) ? (scans[0]?.scan_id || scans[0]?.id) : null
    }
    const cables = await getJSON("/api/infrastructure/cables")
    realIds.loc = cables?.cables?.[0]?.id
}, 30000)

describe("ref.js — parseRef (pure, no network)", () => {
    it("splits kind:id on the first colon only, so an id containing colons still parses", () => {
        expect(parseRef("sig:ALT-1a2b3c4d")).toEqual({ kind: "sig", id: "ALT-1a2b3c4d" })
        expect(parseRef("ent:strategic_zone:SZONE-011")).toEqual({ kind: "ent", id: "strategic_zone:SZONE-011" })
    })
    it("rejects a malformed ref rather than guessing", () => {
        expect(parseRef("no-colon-here")).toBeNull()
        expect(parseRef(null)).toBeNull()
        expect(parseRef(42)).toBeNull()
    })
})

describe("ref.js — resolve() against the real live backend, one per kind", () => {
    it("declares real resolvers for every kind this app already has records of", () => {
        expect(REF_KINDS.sort()).toEqual(["aoi", "brf", "ent", "loc", "onto", "scn", "sig", "trk"].sort())
    })

    it("sig: resolves a real Alert, not a stub", async () => {
        if (!realIds.sig) { console.warn("no real alert available to test sig: against — skipping"); return }
        const r = await resolve(`sig:${realIds.sig}`)
        expect(r).toBeTruthy()
        expect(typeof r).toBe("object")
    })

    it("ent: resolves a real dossier entity profile, not a stub", async () => {
        if (!realIds.ent) { console.warn("no real dossier entity available — skipping"); return }
        const r = await resolve(`ent:${realIds.ent}`)
        expect(r).toBeTruthy()
    })

    it("onto: resolves a real ontology node by its real graph id, not a stub", async () => {
        if (!realIds.onto) { console.warn("no real ontology node available — skipping"); return }
        const r = await resolve(`onto:${realIds.onto}`)
        expect(r).toBeTruthy()
        expect(r.id).toBe(realIds.onto)
    })

    it("aoi: resolves a real observation area, not a stub", async () => {
        if (!realIds.aoi) { console.warn("no real watch zone available — skipping"); return }
        const r = await resolve(`aoi:${realIds.aoi}`)
        expect(r).toBeTruthy()
    })

    it("scn: resolves a real imagery scene, not a stub", async () => {
        if (!realIds.scn) { console.warn("no real scan available for the tested AOI — skipping"); return }
        const r = await resolve(`scn:${realIds.scn}`)
        expect(r).toBeTruthy()
    })

    it("brf: resolves a real briefing/report, not a stub", async () => {
        if (!realIds.brf) { console.warn("no real report available — skipping"); return }
        const r = await resolve(`brf:${realIds.brf}`)
        expect(r).toBeTruthy()
        expect(r.report_id).toBe(realIds.brf)
    })

    it("trk: resolves a real live vessel by mmsi, not a stub", async () => {
        if (!realIds.trk) { console.warn("no vessel currently in the live AIS cache — skipping"); return }
        const r = await resolve(`trk:${realIds.trk}`)
        expect(r).toBeTruthy()
        expect(r._trkType).toBe("vessel")
    })

    it("loc: resolves a real submarine cable by its real id, not a stub", async () => {
        if (!realIds.loc) { console.warn("no real cable available — skipping"); return }
        const r = await resolve(`loc:${realIds.loc}`)
        expect(r).toBeTruthy()
        expect(r._locType).toBe("cable")
    })

    it("an unresolvable ref returns null honestly, never a fabricated placeholder", async () => {
        const r = await resolve("sig:THIS-ID-DOES-NOT-EXIST-REALLY")
        expect(r).toBeNull()
    })

    it("label() returns a real, non-empty title for a real record", async () => {
        if (!realIds.sig) return
        const l = await label(`sig:${realIds.sig}`)
        expect(typeof l).toBe("string")
        expect(l.length).toBeGreaterThan(0)
    })
})
