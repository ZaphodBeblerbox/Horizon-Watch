import { describe, expect, it } from "vitest"
import { exactTime, isCardClick, itemKey, mediaOf, nextTab, placeOf, scrollMemo, teamPostIn, theaterTabs } from "./deskFeed.js"

describe("deskFeed", () => {
    const theaters = [{ id: 7, name: "Paris" }, { id: "b", name: "Red Sea watch" }]

    it("tabs start with All, then the user's theatres", () => {
        expect(theaterTabs(theaters).map((t) => [t.id, t.label])).toEqual([[null, "All"], ["7", "Paris"], ["b", "Red Sea watch"]])
        expect(theaterTabs(null)).toEqual([{ id: null, label: "All" }])
    })

    it("a swipe steps one tab and holds at the edges", () => {
        const tabs = theaterTabs(theaters)
        expect(nextTab(tabs, null, 1)).toBe("7")
        expect(nextTab(tabs, "7", 1)).toBe("b")
        expect(nextTab(tabs, "b", 1)).toBe("b")
        expect(nextTab(tabs, "7", -1)).toBe(null)
        expect(nextTab(tabs, null, -1)).toBe(null)
    })

    it("a team post is in a theatre by name or by the place it carries", () => {
        const paris = theaters[0]
        const inside = ({ lat }) => lat > 48 && lat < 49
        expect(teamPostIn({ theater: " paris " }, paris, inside)).toBe(true)
        expect(teamPostIn({ attachment: { lat: 48.85, lon: 2.35 } }, paris, inside)).toBe(true)
        expect(teamPostIn({ attachment: { lat: 50, lon: 2 } }, paris, inside)).toBe(false)
        expect(teamPostIn({ body: "words only" }, paris, inside)).toBe(false)
        expect(teamPostIn({ body: "x" }, null, inside)).toBe(true)
    })

    it("item keys keep what the server accepts", () => {
        expect(itemKey({ id: "rybar/1234" })).toBe("rybar/1234")
        expect(itemKey({ id: "sig:ALT-1 2" })).toBe("sig:ALT-1_2")
        expect(itemKey({})).toBe(null)
    })

    it("the exact time is the full date and clock, a day-precision event only its day", () => {
        const t = exactTime("2026-10-24T12:32:00", { timeZone: "UTC" })
        expect(t).toMatch(/2026/)
        expect(t).toMatch(/12:32|12.32/)
        expect(exactTime("2026-10-24T23:59:59", { precision: "day" })).not.toMatch(/23:59/)
        expect(exactTime("nonsense")).toBe("")
    })

    it("media of a Telegram post, through our proxy", () => {
        const m = mediaOf({ media: "video", channel: "c/123", msg_id: 9, thumb_url: "/api/telegram/media/c_123_9.jpg" })
        expect(m.type).toBe("video")
        expect(m.video).toMatch(/\/api\/telegram\/video\/-100123\/9$/)
        expect(m.thumb).toMatch(/\/api\/telegram\/media\/c_123_9\.jpg$/)
        expect(mediaOf({ media: "none" })).toBe(null)
        expect(mediaOf({ media: "photo", thumb_url: "https://x/y.jpg" })).toEqual({ type: "photo", thumb: "https://x/y.jpg", video: null })
    })

    it("a place only when there is a real one", () => {
        expect(placeOf({ lat: 48.8, lon: 2.3, place: "Paris, Île-de-France, France" })).toEqual({ lat: 48.8, lon: 2.3, label: "Paris, Île-de-France" })
        expect(placeOf({ lat: 0, lon: 0 })).toBe(null)
        expect(placeOf({ lat: null, lon: null })).toBe(null)
        expect(placeOf({ attachment: { lat: 10, lon: 20, name: "Port" } })).toEqual({ lat: 10, lon: 20, label: "Port" })
    })

    it("Back returns to the same scroll position", () => {
        const memo = scrollMemo()
        const el = { scrollTop: 1234 }
        memo.save("all", el)
        el.scrollTop = 0
        memo.restore("all", el)
        expect(el.scrollTop).toBe(1234)
        memo.restore("other", el)
        expect(el.scrollTop).toBe(1234)
    })

    it("a click on a control or the media does not open the post", () => {
        const on = (sel) => ({ target: { closest: (q) => (q.split(", ").includes(sel) ? {} : null) } })
        expect(isCardClick(on("button"))).toBe(false)
        expect(isCardClick(on("video"))).toBe(false)
        expect(isCardClick({ target: { closest: () => null } })).toBe(true)
    })
})
