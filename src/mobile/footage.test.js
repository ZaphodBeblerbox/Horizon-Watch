import { describe, expect, it } from "vitest"
import { footageOf } from "./footage.js"

describe("footage an item carries", () => {
    it("a Telegram post's video", () => {
        const f = footageOf({ channel: "rybar", msg_id: 9, media: "video", thumb_url: "/api/telegram/media/rybar_9.jpg" })
        expect(f).toHaveLength(1)
        expect(f[0]).toMatchObject({ media: "video", channel: "rybar", msg_id: 9, thumb_url: "/api/telegram/media/rybar_9.jpg" })
    })
    it("a live signal's attachment and its other media, videos first, no repeats", () => {
        const v = { kind: "video", thumb_url: "/t/a.jpg", video_url: "/api/telegram/video/a/1", channel: "a", msg_id: 1 }
        const p = { kind: "photo", thumb_url: "/t/b.jpg", channel: "a", msg_id: 2 }
        const f = footageOf({ kind: "live_signal", media: p, all_media: [p, v] })
        expect(f.map((m) => m.media)).toEqual(["video", "photo"])
    })
    it("nothing when there is none", () => {
        expect(footageOf({ media: "none", headline: "x" })).toEqual([])
        expect(footageOf(null)).toEqual([])
        expect(footageOf({ media: null, thumb_url: null })).toEqual([])
    })
})
