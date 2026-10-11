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
