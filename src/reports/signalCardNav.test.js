// @vitest-environment jsdom
//
// This exercises real DOM delegation — a card inserted as HTML, then
// clicked — which is the whole mechanism. Asserting on the markup
// alone would pass while the listener was broken.
import { describe, it, expect, beforeEach, vi } from "vitest"
import { signalCardHtml } from "./signalCard.js"
import { installSignalCardNav } from "./signalCardNav.js"

const ITEM = {
    id: "sig:GC-1", region: "Kyiv, Ukraine", lat: 50.45124, lon: 30.44514,
    source: "geoconfirmed", severity: "significant", when: "2026-09-25T18:22:00Z",
}
const TEXT = { headline: "Strike on a business centre in Kyiv", meta: "Kyiv · 2026-09-25 · geoconfirmed" }

describe("a signal card in a document goes to the place", () => {
    let teardown
    beforeEach(() => {
        document.body.innerHTML = ""
        if (teardown) teardown()
        teardown = installSignalCardNav(window)
    })

    it("carries the coordinate it describes", () => {
        const html = signalCardHtml(ITEM, TEXT)
        expect(html).toMatch(/data-signal-lat="50\.45124"/)
        expect(html).toMatch(/data-signal-lon="30\.44514"/)
    })

    it("clicking it asks the map to fly there", () => {
        document.body.innerHTML = signalCardHtml(ITEM, TEXT)
        const fly = vi.fn()
        window.addEventListener("akili:fly-to", fly)
        document.querySelector(".signal-card").click()
        expect(fly).toHaveBeenCalledTimes(1)
        expect(fly.mock.calls[0][0].detail).toMatchObject({ lat: 50.45124, lon: 30.44514 })
    })

    it("and switches to the map, since that is the point of the click", () => {
        document.body.innerHTML = signalCardHtml(ITEM, TEXT)
        const nav = vi.fn()
        window.addEventListener("akili:navigate", nav)
        document.querySelector(".signal-card").click()
        expect(nav.mock.calls[0][0].detail).toMatchObject({ destination: "situation" })
    })

    it("does NOT fire while the document is being edited", () => {
        // Inside contenteditable a click is placing the caret. Flying the
        // map out from under someone mid-sentence is the opposite of
        // useful.
        document.body.innerHTML =
            `<div contenteditable="true">${signalCardHtml(ITEM, TEXT)}</div>`
        const fly = vi.fn()
        window.addEventListener("akili:fly-to", fly)
        document.querySelector(".signal-card").click()
        expect(fly).not.toHaveBeenCalled()
    })

    it("a card with no coordinate is not clickable", () => {
        document.body.innerHTML = signalCardHtml({ ...ITEM, lat: null, lon: null }, TEXT)
        const fly = vi.fn()
        window.addEventListener("akili:fly-to", fly)
        document.querySelector(".signal-card")?.click()
        expect(fly).not.toHaveBeenCalled()
    })

    it("uses no anchor tag, which would be followable inside the editor", () => {
        expect(signalCardHtml(ITEM, TEXT)).not.toMatch(/<a\s/)
    })
})
