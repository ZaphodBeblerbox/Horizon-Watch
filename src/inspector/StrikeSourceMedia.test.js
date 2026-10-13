import { describe, expect, it } from "vitest"
import { strikeMedia } from "./StrikeSourceMedia.jsx"
import { coversOf, coveredIds, setCoveredIds } from "../globe/strikes.js"

describe("a strike pin stands for its reports", () => {
    it("plays the Telegram posts' media and the X posts it cites, once each", () => {
        const e = { sources: [
            { url: "https://t.me/rybar/1", post: { id: "tg-rybar-1", channel: "rybar", msg_id: 1, media: "video", thumb_url: "/api/telegram/media/a.jpg" } },
            { url: "https://x.com/GeoConfirmed/status/1843000000000000000" },
            { url: "https://twitter.com/GeoConfirmed/status/1843000000000000000" },
            { url: "https://t.me/rybar/2", post: null },
            { url: "https://geoconfirmed.org/ukraine/abc" },
        ] }
        const m = strikeMedia(e)
        expect(m.map((x) => x.kind)).toEqual(["telegram", "x"])
        expect(m[0].post.thumb_url).toMatch(/\/api\/telegram\/media\/a\.jpg$/)
    })
    it("hides the markers of the reports the shown pins cover", () => {
        setCoveredIds(coversOf([{ covers: ["tg-rybar-1", "geoconfirmed-9"] }, { covers: [] }, {}]))
        expect([...coveredIds()].sort()).toEqual(["geoconfirmed-9", "tg-rybar-1"])
        setCoveredIds([])
        expect(coveredIds().size).toBe(0)
    })
})
