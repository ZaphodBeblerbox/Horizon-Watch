// @vitest-environment jsdom
// The viewer mounts itself inside the phone (.m2) on the first tap, hides the
// page's copy while open, gives it back on close, and leaves the desktop alone.
import { describe, it, expect } from "vitest"
import { act } from "react"
import { captureMedia, openMedia } from "./MediaViewer.jsx"

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

describe("MediaViewer", () => {
    it("opens from a tap inside .m2, and closes back into place", async () => {
        const m2 = document.createElement("div")
        m2.className = "m2"
        m2.innerHTML = `<div id="box"><img id="pic" src="https://example.test/a.jpg"></div>`
        document.body.appendChild(m2)
        const pic = m2.querySelector("#pic")
        const ev = { target: pic, preventDefault() { this.prevented = true }, stopPropagation() {} }
        await act(async () => { captureMedia(ev); await wait(10) })
        expect(ev.prevented).toBe(true)
        const mv = m2.querySelector(".m2-mv")
        expect(mv).not.toBeNull()
        expect(mv.querySelector("img").getAttribute("src")).toBe("https://example.test/a.jpg")
        expect(pic.style.visibility).toBe("hidden")
        await act(async () => { await wait(450); window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); await wait(450) })
        expect(m2.querySelector(".m2-mv")).toBeNull()
        expect(pic.style.visibility).toBe("")
        m2.remove()
    })

    it("shows the player for a video", async () => {
        const m2 = document.createElement("div")
        m2.className = "m2"
        document.body.appendChild(m2)
        await act(async () => { openMedia({ src: "https://example.test/v.mp4", type: "video" }); await wait(10) })
        const mv = document.querySelector(".m2-mv")
        expect(mv.querySelector("video")).not.toBeNull()
        expect(mv.querySelector('[role="slider"]')).not.toBeNull()
        expect([...mv.querySelectorAll(".m2-mv-time")].map((n) => n.textContent)).toEqual(["0:00", "0:00"])
        await act(async () => { await wait(450); window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); await wait(450) })
        m2.remove()
    })

    it("does nothing outside the phone", () => {
        const img = document.createElement("img")
        img.src = "https://example.test/b.jpg"
        document.body.appendChild(img)
        const ev = { target: img, preventDefault() { this.prevented = true }, stopPropagation() {} }
        captureMedia(ev)
        expect(ev.prevented).toBeUndefined()
        img.remove()
    })
})
