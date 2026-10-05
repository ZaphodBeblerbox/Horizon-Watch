import { describe, it, expect } from "vitest"
import { renderToStaticMarkup as html } from "react-dom/server"
import { linkifyText } from "./linkifyText.jsx"

const render = (v) => html(<span>{linkifyText(v)}</span>)

describe("linkifyText", () => {
    it("shows Source with an arrow and the host, keeping the full URL as href and title", () => {
        const url = "https://x.com/GeoConfirmed/status/1843000000000000000"
        const out = render(url)
        expect(out).toContain(`href="${url}"`)
        expect(out).toContain(`title="${url}"`)
        expect(out).toContain("Source ↗")
        expect(out).toContain("x.com")
        expect(out.replace(/href="[^"]*"|title="[^"]*"/g, "")).not.toContain("/status/")
    })

    it("numbers several links in one value and keeps the separator", () => {
        const out = render("https://a.org/1, https://b.org/2")
        expect(out).toContain("Source 1 ↗")
        expect(out).toContain("Source 2 ↗")
        expect(out).toContain(", ")
    })

    it("leaves text without a URL alone", () => {
        expect(linkifyText("Kherson Oblast")).toEqual(["Kherson Oblast"])
    })
})
