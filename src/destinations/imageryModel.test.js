import { describe, it, expect } from "vitest"
import { acquisitions, changeHeadline, countSeries, groupDetections } from "./imageryModel.js"

const scan = (id, image, when, extra = {}) => ({
    scan_id: id, image_id: image, image_timestamp_utc: when, status: "completed", has_image: true,
    created_at: `2026-10-0${id.length}`, triggered_by: "schedule", result_summary: { by_type: { vessel: 2 } }, ...extra,
})

describe("imagery passes", () => {
    it("shows one pass per acquisition, however often it was checked", () => {
        const p = acquisitions([
            scan("a", "S2A_1", "2026-10-04T07:02:39"), scan("bb", "S2A_1", "2026-10-04T07:02:39"),
            scan("ccc", "S2A_1", "2026-10-04T07:02:39", { triggered_by: "firms_fire" }),
            scan("d", "S2B_2", "2026-09-29T07:02:37"),
            { scan_id: "e", status: "error", triggered_by: "schedule" },
        ])
        expect(p.map((x) => x.key)).toEqual(["OPTICAL:2026-10-04", "OPTICAL:2026-09-29"])
        expect(p[0].checks).toBe(3)
        expect(p[0].fire).toBe(true)
        expect(p[0].scanId).toBe("ccc")       // newest check of that pass
    })
    it("leaves a pass that was never counted out of the charts, rather than as zero", () => {
        const s = countSeries(acquisitions([scan("a", "1", "2026-10-04"), scan("b", "2", "2026-09-29", { result_summary: null })]))
        expect(s[0].points.map((x) => x.n)).toEqual([2])
    })
    it("charts each class across passes, oldest first", () => {
        const s = countSeries(acquisitions([scan("a", "1", "2026-10-04"), scan("b", "2", "2026-09-29", { result_summary: { by_type: { vessel: 5 } } })]))
        expect(s[0].points.map((x) => x.n)).toEqual([5, 2])
    })
})

describe("change headline", () => {
    it("says what changed against the previous pass, in words", () => {
        expect(changeHeadline([["vessel", 2, -1], ["storage_tank", 15, 0]], "2026-09-29T07:02:37"))
            .toBe("Since 29 Sep: 1 vessel fewer (2 now); storage tanks unchanged.")
        expect(changeHeadline([["vessel", 4, 2]], "2026-09-29")).toBe("Since 29 Sep: 2 more vessels (4 now).")
        expect(changeHeadline([["storage_tank", 15, 0]], "2026-09-29")).toBe("Since 29 Sep: no change — 15 storage tanks, as before.")
        expect(changeHeadline([["vessel", 1, 1]], null)).toBe("First pass over this area: 1 vessel.")
    })
    it("groups detections, changed kinds first", () => {
        const g = groupDetections([{ label: "storage_tank", type: "existing" }, { label: "vessel", type: "new" }])
        expect(g[0].label).toBe("vessel")
    })
})

import { pickInitialPass } from "./imageryModel.js"

describe("pickInitialPass — what an area opens on", () => {
    const opt = (id, day, img = true) => ({ scan_id: id, status: "completed", image_timestamp_utc: `2026-10-${day}T08:00:00`, instrument: "OPTICAL", has_image: img, created_at: `2026-10-${day}T09:00:00` })
    const sar = (id, day, img = true, trig = "schedule") => ({ ...opt(id, day, img), instrument: "SAR", triggered_by: trig })
    it("a radar-only area (a border-sweep find) opens on radar, not on 'not photographed yet'", () => {
        expect(pickInitialPass([sar("s1", "10"), sar("c1", "11", false, "change-detect")])).toEqual({ sensor: "radar", scanId: "s1" })
    })
    it("the newest optical pass that still holds its image, over a newer one that lost it", () => {
        expect(pickInitialPass([opt("o2", "11", false), opt("o1", "09")])).toEqual({ sensor: "optical", scanId: "o1" })
    })
    it("the pass a notification asked for, on its own sensor", () => {
        expect(pickInitialPass([opt("o1", "09"), sar("s1", "10")], "s1")).toEqual({ sensor: "radar", scanId: "s1" })
        expect(pickInitialPass([opt("o1", "09"), sar("s1", "10")], "o1")).toEqual({ sensor: "optical", scanId: "o1" })
    })
    it("nothing at all: optical, no pass", () => {
        expect(pickInitialPass([])).toEqual({ sensor: "optical", scanId: null })
    })
})

import {
    CLASS_COLORS, CLASS_LABELS, classColor, classDetail, classLabel, FEEDBACK_CLASSES, feedbackLabel,
    findingDetections, isFindingClass, kindDash, legendClasses, noun,
} from "./imageryModel.js"

const MAIN = ["smoke_plume", "burn_scar", "active_fire", "runway", "airfield", "port_infrastructure", "storage_tank", "aircraft", "vessel"]
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))

describe("detection classes", () => {
    it("gives every main class its own clearly different colour", () => {
        const cols = MAIN.map(classColor)
        expect(new Set(cols).size).toBe(MAIN.length)
        for (let i = 0; i < cols.length; i++) {
            for (let j = i + 1; j < cols.length; j++) {
                const [a, b] = [rgb(cols[i]), rgb(cols[j])]
                const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
                expect(d, `${MAIN[i]} vs ${MAIN[j]}`).toBeGreaterThan(90)
            }
        }
        // smoke is no longer the colour of a runway or a burn scar
        expect(classColor("smoke_plume")).not.toBe(classColor("runway"))
        expect(classColor("smoke_plume")).not.toBe(classColor("burn_scar"))
    })

    it("labels every class in words, and an unknown one readably", () => {
        for (const k of MAIN) expect(CLASS_LABELS[k]).toBeTruthy()
        expect(classLabel("runway")).toBe("Runway / landing strip")
        expect(classLabel("burn_scar")).toBe("Burn scar / impact point")
        expect(classLabel("some_new_thing")).toBe("Some new thing")
        expect(classColor("some_new_thing")).toMatch(/^#/)
        expect(CLASS_COLORS.vehicle).toBeTruthy()
    })

    it("never treats cloud, cloud shadow or field change as findings", () => {
        const dets = ["cloud", "cloud_shadow", "field_change", "runway", "smoke_plume"].map((label, i) => ({ id: String(i), label, type: "new" }))
        expect(findingDetections(dets).map((d) => d.label)).toEqual(["runway", "smoke_plume"])
        expect(isFindingClass({ object_type: "cloud_shadow" })).toBe(false)
        expect(isFindingClass("vessel")).toBe(true)
        expect(legendClasses(dets).map((c) => c.key).sort()).toEqual(["runway", "smoke_plume"])
    })

    it("lists the classes present in a pass, most first, findings of the watch left out", () => {
        const l = legendClasses([{ label: "vessel" }, { label: "runway" }, { label: "vessel" }, { label: "x", type: "finding" }])
        expect(l.map((c) => [c.key, c.count])).toEqual([["vessel", 2], ["runway", 1]])
        expect(l[0].color).toBe(classColor("vessel"))
    })

    it("offers the analyst's answers, cloud and shadow among them", () => {
        expect(FEEDBACK_CLASSES.map((c) => c.key)).toEqual(["field", "runway", "cloud", "cloud_shadow", "port_infrastructure", "smoke_plume", "burn_scar", "other"])
        expect(FEEDBACK_CLASSES.find((c) => c.key === "cloud_shadow").label).toBe("Shadow")
        expect(feedbackLabel("runway")).toBe("Runway")
    })

    it("says runway and burn scar in the singular and plural", () => {
        expect(noun("runway", 1)).toBe("runway")
        expect(noun("runway", 3)).toBe("runways")
        expect(noun("burn_scar", 1)).toBe("burn scar")
        expect(noun("burn_scar", 2)).toBe("burn scars")
    })

    it("draws what changed as the line style", () => {
        expect(kindDash({ type: "new" })).toBeNull()
        expect(kindDash({ type: "existing" })).toBeNull()
        expect(kindDash({ type: "removed" })).toBeTruthy()
        expect(kindDash({ type: "new", tier: "probable" })).not.toBe(kindDash({ type: "removed" }))
    })

    it("reads the classifier's detail from attributes, as an object or JSON", () => {
        const reasons = [{ kind: "spectral", text: "dark in SWIR, not bright", sign: "-" }, { kind: "shape", text: "long straight strip", sign: "+" }]
        const a = classDetail({ attributes: JSON.stringify({ class_confidence: 0.82, classifier: "rules v1", reasons, tier: "confirmed" }) })
        expect(a).toMatchObject({ classConfidence: 0.82, classifier: "rules v1", tier: "confirmed" })
        expect(a.reasons).toHaveLength(2)
        expect(classDetail({ class_confidence: 0, reasons: [{ text: "x" }, null] })).toMatchObject({ classConfidence: 0, reasons: [{ text: "x" }] })
        expect(classDetail({ attributes: "not json" })).toMatchObject({ classConfidence: null, reasons: [] })
    })
})
