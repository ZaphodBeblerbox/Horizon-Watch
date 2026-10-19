// @vitest-environment jsdom
// A street report's footage is shown and opens the real thing (owner, 2026-10-19:
// "it only says 'footage at Châtelet' … when I click on it, I want the actual footage").
import { describe, it, expect } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import ReportMedia, { reportMedia } from "./ReportMedia.jsx"

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// the shape /api/routes/demonstrations/street serves (street_reports.build)
const REPORT = {
    id: "tgr-footage-giletsjaunes2026france-11923", kind: "police_action", tactic: "footage", title: "Footage from Châtelet",
    lat: 48.8576, lon: 2.3472, media: "video", thumb_url: "/api/telegram/media/g_11.jpg",
    sources: [
        { channel: "giletsjaunes2026france", channel_title: "Gilets jaunes 2026", msg_id: 10, hhmm: "11:31", media: "video",
          media_msg_id: 11, thumb_url: "/api/telegram/media/g_11.jpg", video_url: "/api/telegram/video/giletsjaunes2026france/11",
          url: "https://t.me/giletsjaunes2026france/10" },
        { channel: "c/12345", channel_title: "Private group", msg_id: 20, hhmm: "11:35", media: "photo", thumb_url: null, url: null },
        { channel: "GJ2026IDF", channel_title: "GJ IDF", msg_id: 30, hhmm: "11:40", media: "photo", thumb_url: "/api/telegram/media/GJ_30.jpg",
          url: "https://t.me/GJ2026IDF/30" },
    ],
}

describe("reportMedia", () => {
    it("reads every post's picture or video, newest first, with the message that carries it", () => {
        const m = reportMedia(REPORT, "https://api.test")
        expect(m.map((x) => x.type)).toEqual(["photo", "photo", "video"])
        expect(m[2].video).toBe("https://api.test/api/telegram/video/giletsjaunes2026france/11")
        expect(m[2].thumb).toBe("https://api.test/api/telegram/media/g_11.jpg")
        expect(m[1].missing).toBe(true)                         // a picture whose still was not kept
        expect(m[0].missing).toBe(false)
    })
    it("a plain post: its own media; a video without a stored url is built from its channel and message", () => {
        const [v] = reportMedia({ id: "tg-c-5", channel: "chan", msg_id: 5, media: "video", thumb_url: null }, "")
        expect(v.video).toBe("/api/telegram/video/chan/5")
        expect(v.missing).toBe(false)
        expect(reportMedia({ media: "none" })).toEqual([])
    })
})

describe("<ReportMedia>", () => {
    it("shows the footage and opens it full screen; says what could not be kept", async () => {
        const host = document.createElement("div")
        document.body.appendChild(host)
        const root = createRoot(host)
        await act(async () => { root.render(<ReportMedia item={REPORT} base="https://api.test" />) })
        const tiles = host.querySelectorAll("[data-media-tile]")
        expect(tiles).toHaveLength(2)
        expect(host.querySelector("[data-testid=report-media-missing]").textContent).toContain("not kept on the server")
        const video = [...tiles].find((t) => t.getAttribute("aria-label").startsWith("Play the video"))
        expect(video.querySelector("img").getAttribute("src")).toBe("https://api.test/api/telegram/media/g_11.jpg")
        await act(async () => { video.click(); await wait(20) })
        const v = document.querySelector(".m2-mv video")
        expect(v).not.toBeNull()
        expect(v.getAttribute("src")).toBe("https://api.test/api/telegram/video/giletsjaunes2026france/11")
        await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); await wait(500) })
        await act(async () => { root.unmount() })
        host.remove()
    })
    it("compact: one thumbnail with the count, for the map card", async () => {
        const host = document.createElement("div")
        document.body.appendChild(host)
        const root = createRoot(host)
        await act(async () => { root.render(<ReportMedia item={REPORT} compact />) })
        expect(host.querySelectorAll("[data-media-tile]")).toHaveLength(1)
        expect(host.textContent).toContain("2")
        await act(async () => { root.unmount() })
        host.remove()
    })
})
