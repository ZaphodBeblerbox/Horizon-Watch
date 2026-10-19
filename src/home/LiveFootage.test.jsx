// @vitest-environment jsdom
// The strip on screen: new footage slides in at the start only when the
// reader is there; scrolled along, a "N new" pill waits and brings them in.
import { describe, it, expect, afterEach } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import LiveFootage from "./LiveFootage.jsx"

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const card = (chan, mid, at, extra = {}) => ({
    id: `tg-${chan}-${mid}`, channel: chan, msg_id: mid, channel_title: chan.toUpperCase(), posted_at: at, media: "video",
    thumb_url: `/api/telegram/media/${chan}_${mid}.jpg`, caption: `Footage ${mid}`, duration: 42, also_in: [], ...extra,
})
const A = card("a", 1, "2026-10-18T10:00:00Z"), B = card("b", 2, "2026-10-18T11:00:00Z", { on_ground: true, place: "Place de la République, Paris" })
const C = card("c", 3, "2026-10-18T12:00:00Z")

let box, root
const mount = async (items) => {
    box = document.createElement("div")
    document.body.appendChild(box)
    root = createRoot(box)
    await act(async () => { root.render(<LiveFootage variant="phone" items={items} />) })
}
const update = async (items) => { await act(async () => { root.render(<LiveFootage variant="phone" items={items} />) }) }
const ids = () => [...box.querySelectorAll("[data-lf-id]")].map((n) => n.getAttribute("data-lf-id"))
afterEach(() => { act(() => root.unmount()); box.remove() })

describe("LiveFootage", () => {
    it("shows each card with its play mark, length, chat, caption, place and the on-the-ground mark", async () => {
        await mount([B, A])
        expect(ids()).toEqual(["tg-b-2", "tg-a-1"])
        const b = box.querySelector('[data-lf-id="tg-b-2"]')
        expect(b.querySelector(".lf-play")).not.toBeNull()
        expect(b.querySelector(".lf-dur").textContent).toBe("0:42")
        expect(b.querySelector(".lf-ground").textContent).toMatch(/on the ground/)
        expect(b.querySelector(".lf-place").textContent).toBe("Place de la République, Paris")
        expect(b.querySelector(".lf-meta").textContent).toMatch(/B/)
        expect(box.querySelector('[data-lf-id="tg-a-1"] .lf-ground')).toBeNull()
        expect(box.querySelector(".lf-strip").classList.contains("m2-hscroll")).toBe(true)   // the phone's swipes leave it alone
    })

    it("at the start, new footage slides in at the start", async () => {
        await mount([B, A])
        await update([C, B, A])
        expect(ids()).toEqual(["tg-c-3", "tg-b-2", "tg-a-1"])
        expect(box.querySelector('[data-lf-id="tg-c-3"]').classList.contains("lf-new")).toBe(true)
        expect(box.querySelector('[data-testid="lf-new-pill"]')).toBeNull()
    })

    it("scrolled along, nothing moves; a pill counts the new ones and brings them in", async () => {
        await mount([B, A])
        const strip = box.querySelector(".lf-strip")
        strip.scrollLeft = 300
        strip.scrollTo = () => { strip.scrollLeft = 0 }
        await update([C, B, A])
        expect(ids()).toEqual(["tg-b-2", "tg-a-1"])
        const pill = box.querySelector('[data-testid="lf-new-pill"]')
        expect(pill.textContent).toMatch(/1 new/)
        await act(async () => { pill.click() })
        expect(ids()).toEqual(["tg-c-3", "tg-b-2", "tg-a-1"])
        expect(box.querySelector('[data-testid="lf-new-pill"]')).toBeNull()
    })

    it("back at the start by hand, what waited comes in", async () => {
        await mount([B, A])
        const strip = box.querySelector(".lf-strip")
        strip.scrollLeft = 300
        await update([C, B, A])
        expect(ids()).toEqual(["tg-b-2", "tg-a-1"])
        strip.scrollLeft = 0
        await act(async () => { strip.dispatchEvent(new Event("scroll")) })
        expect(ids()).toEqual(["tg-c-3", "tg-b-2", "tg-a-1"])
    })

    it("a tap opens the viewer on that video, with the list to swipe through", async () => {
        const m2 = document.createElement("div")
        m2.className = "m2"
        document.body.appendChild(m2)
        await mount([B, A])
        await act(async () => { box.querySelector('[data-lf-id="tg-a-1"] .lf-media').click(); await new Promise((r) => setTimeout(r, 20)) })
        const mv = document.querySelector(".m2-mv")
        expect(mv).not.toBeNull()
        expect(mv.querySelector("video").getAttribute("src")).toMatch(/\/api\/telegram\/video\/a\/1$/)
        expect(mv.querySelector(".m2-mv-count").textContent).toBe("2 / 2")
        expect(mv.querySelector('[data-testid="mv-caption"]').textContent).toMatch(/Footage 1/)
        await act(async () => { await new Promise((r) => setTimeout(r, 450)); window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" })); await new Promise((r) => setTimeout(r, 450)) })
        expect(document.querySelector(".m2-mv video").getAttribute("src")).toMatch(/\/b\/2$/)
        expect(document.querySelector(".m2-mv .m2-mv-count").textContent).toBe("1 / 2")
        await act(async () => { await new Promise((r) => setTimeout(r, 400)); window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); await new Promise((r) => setTimeout(r, 450)) })
        expect(document.querySelector(".m2-mv")).toBeNull()
        m2.remove()
    })
})
