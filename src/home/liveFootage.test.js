// Home's Live footage: both feeds merged, one card per video, videos first
// and newest first, and new cards only slide in while the strip is at its start.
import { describe, it, expect } from "vitest"
import { dedupe, durLabel, footageFromPosts, MIN_VIDEOS, order, reconcile, shortPlace } from "./liveFootage.js"

const post = (chan, mid, at, extra = {}) => ({
    id: `tg-${chan}-${mid}`, channel: chan, msg_id: mid, channel_title: chan.toUpperCase(), posted_at: at,
    media: "video", thumb_url: `/api/telegram/media/${chan}_${mid}.jpg`, text: "", ...extra,
})

describe("footageFromPosts — the two feeds as one", () => {
    it("keeps posts with a picture or video and a still, once, newest video first", () => {
        const feed = [post("a", 1, "2026-10-18T10:00:00Z", { headline: "Strike on Kharkiv" }),
                      post("b", 2, "2026-10-18T11:00:00Z", { media: "none", thumb_url: null }),
                      post("c", 3, "2026-10-18T12:00:00Z", { media: "photo" })]
        const located = [post("a", 1, "2026-10-18T10:00:00Z", { headline: "Strike on Kharkiv", place: "Kharkiv, Ukraine", lat: 50, lon: 36.2 }),
                         post("d", 4, "2026-10-18T10:30:00Z", { summary_en: "Drone over Odesa" })]
        const got = footageFromPosts(feed, located)
        expect(got.map((x) => x.id)).toEqual(["tg-d-4", "tg-a-1", "tg-c-3"])
        const a = got.find((x) => x.id === "tg-a-1")
        expect(a.place).toBe("Kharkiv, Ukraine")                      // learnt from the second list
        expect(a.caption).toBe("Strike on Kharkiv")
        expect(got.find((x) => x.id === "tg-d-4").caption).toBe("Drone over Odesa")
    })

    it("opens a street report into its footage, marked on the ground with the report's place", () => {
        const report = { id: "tgr-tear_gas-grp-10", unified: true, street_report: true, headline: "Tear gas at République",
            place: "Place de la République", lat: 48.867, lon: 2.363, media: "video", thumb_url: "/api/telegram/media/grp_11.jpg",
            sources: [
                { channel: "grp", msg_id: 10, channel_title: "Paris luttes", posted_at: "2026-10-18T18:00:00Z", media: "video",
                  thumb_url: "/api/telegram/media/grp_11.jpg", translation: "They are gassing at Répu", text: "ça gaze à Répu" },
                { channel: "grp", msg_id: 12, channel_title: "Paris luttes", posted_at: "2026-10-18T18:03:00Z", media: "none", thumb_url: null },
            ] }
        const position = { id: "tgu-x", unified: true, signal_kind: "at", media: "none", thumb_url: null }
        const got = footageFromPosts([report, position])
        expect(got).toHaveLength(1)
        expect(got[0]).toMatchObject({ id: "tg-grp-10", on_ground: true, ground_kind: "street_report", caption: "They are gassing at Répu",
                                       place: "Place de la République", lat: 48.867 })
    })
})

describe("dedupe — one card per video", () => {
    it("a forward (same media id) is one card, the first post kept, the other chat listed", () => {
        const got = dedupe([post("fwd", 9, "2026-10-18T10:05:00Z", { media_key: "d1", duration: 42 }),
                            post("orig", 1, "2026-10-18T10:00:00Z", { media_key: "d1" })])
        expect(got).toHaveLength(1)
        expect(got[0].id).toBe("tg-orig-1")
        expect(got[0].also_in).toEqual(["FWD"])
        expect(got[0].duration).toBe(42)
    })
    it("same words under the same kind of media are one card; a picture with those words is not the video", () => {
        const t = "Explosion at the port of Odesa — video https://t.me/x/1"
        const got = dedupe([post("a", 1, "2026-10-18T10:00:00Z", { text: t }), post("b", 2, "2026-10-18T10:01:00Z", { text: t.replace("https://t.me/x/1", "@b") }),
                            post("c", 3, "2026-10-18T10:02:00Z", { text: t, media: "photo" }), post("d", 4, "2026-10-18T10:03:00Z", { text: "ok" }),
                            post("e", 5, "2026-10-18T10:04:00Z", { text: "ok" })])
        expect(got.map((x) => x.id)).toEqual(["tg-a-1", "tg-c-3", "tg-d-4", "tg-e-5"])   // short words prove nothing
    })
    it("a card that is on the ground anywhere is on the ground", () => {
        const got = dedupe([post("a", 1, "2026-10-18T10:00:00Z", { media_key: "k" }), post("b", 2, "2026-10-18T10:01:00Z", { media_key: "k", on_ground: true, ground_kind: "position" })])
        expect(got[0]).toMatchObject({ on_ground: true, ground_kind: "position" })
    })
})

describe("order — videos lead", () => {
    it("pictures follow videos only while videos are few", () => {
        const few = order([post("p", 1, "2026-10-18T12:00:00Z", { media: "photo" }), post("v", 2, "2026-10-18T09:00:00Z"), post("w", 3, "2026-10-18T10:00:00Z")])
        expect(few.map((x) => x.id)).toEqual(["tg-w-3", "tg-v-2", "tg-p-1"])
        const many = Array.from({ length: MIN_VIDEOS }, (_, i) => post("v", i, `2026-10-18T0${i}:00:00Z`))
        expect(order([...many, post("p", 9, "2026-10-18T12:00:00Z", { media: "photo" })]).every((x) => x.media === "video")).toBe(true)
    })
})

describe("reconcile — new cards and the thumb", () => {
    const A = post("a", 1, "2026-10-18T10:00:00Z"), B = post("b", 2, "2026-10-18T11:00:00Z"), C = post("c", 3, "2026-10-18T12:00:00Z")
    it("the first answer is shown as it is, nothing announced", () => {
        expect(reconcile([], [B, A], false)).toEqual({ shown: [B, A], pending: 0, fresh: [] })
    })
    it("at the start, new cards slide in at the start", () => {
        expect(reconcile([B, A], [C, B, A], true)).toEqual({ shown: [C, B, A], pending: 0, fresh: ["tg-c-3"] })
    })
    it("scrolled along, nothing moves: the cards stay, refreshed in place, and the new ones wait as a count", () => {
        const B2 = { ...B, place: "Kyiv" }
        const r = reconcile([B, A], [C, B2, A], false)
        expect(r.shown.map((x) => x.id)).toEqual(["tg-b-2", "tg-a-1"])
        expect(r.shown[0].place).toBe("Kyiv")
        expect(r.pending).toBe(1)
        expect(r.fresh).toEqual([])
    })
    it("a card gone from the feed stays while the reader is along the strip", () => {
        expect(reconcile([B, A], [C, B], false).shown.map((x) => x.id)).toEqual(["tg-b-2", "tg-a-1"])
    })
})

describe("labels", () => {
    it("durations and places", () => {
        expect(durLabel(42)).toBe("0:42")
        expect(durLabel(725.4)).toBe("12:05")
        expect(durLabel(3725)).toBe("1:02:05")
        expect(durLabel(null)).toBeNull()
        expect(shortPlace("Obolon, Kyiv, Kyiv Oblast, Ukraine")).toBe("Obolon, Kyiv")
        expect(shortPlace("None")).toBe("")
    })
})
