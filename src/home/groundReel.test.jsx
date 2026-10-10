// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import GroundReel from "./GroundReel.jsx"

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const vid = (i, extra = {}) => ({ id: `tg-${i}`, channel: "chan", msg_id: i, media: "video", headline: `Story ${i}`, lat: 1, lon: 1, ...extra })

let host, root
beforeEach(() => {
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host)
    window.HTMLMediaElement.prototype.play = () => Promise.resolve()
    window.HTMLMediaElement.prototype.pause = () => {}
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

const current = () => host.querySelector("[aria-current=true]")?.getAttribute("aria-label")
const info = (v, at, n) => <span data-info>{v.headline} {at + 1}/{n}</span>

describe("Home's ground reel", () => {
    it("plays one video at a time and moves on when it ends, round to the first", async () => {
        await act(async () => root.render(<GroundReel videos={[vid(1), vid(2), vid(3)]} renderInfo={info} />))
        expect(host.querySelectorAll("video")).toHaveLength(1)
        expect(current()).toBe("Story 1 of 3")
        for (const want of ["Story 2 of 3", "Story 3 of 3", "Story 1 of 3"]) {
            await act(async () => host.querySelector("video").dispatchEvent(new Event("ended")))
            expect(current()).toBe(want)
        }
        expect(host.querySelector("video").loop).toBe(false)
    })
    it("skips what cannot play after a moment", async () => {
        vi.useFakeTimers()
        await act(async () => root.render(<GroundReel videos={[vid(1, { media: "photo" }), vid(2)]} renderInfo={info} />))
        expect(current()).toBe("Story 1 of 2")
        await act(async () => { vi.advanceTimersByTime(2100) })
        expect(current()).toBe("Story 2 of 2")
    })
    it("keeps the sound on from one video to the next", async () => {
        await act(async () => root.render(<GroundReel videos={[vid(1), vid(2)]} renderInfo={info} />))
        await act(async () => host.querySelector("button[aria-label='Sound on']").click())
        await act(async () => host.querySelector("video").dispatchEvent(new Event("ended")))
        expect(host.querySelector("button[aria-label='Sound off']")).not.toBeNull()
    })
})
