// @vitest-environment jsdom
// "What we found" (WebContext.jsx): the web agent's context on an item, its citations opening in the in-app
// source viewer (an akili:open-source event carrying the citation), nothing when there is no context.
import { describe, it, expect, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { createRoot } from "react-dom/client"
import { act } from "react"
import WebContext from "./WebContext.jsx"

const ctx = {
    summary: "A man was wounded by gunfire near the station; police are looking for the shooter.",
    findings: [
        { url: "https://www.leparisien.fr/a", source: "Le Parisien", published_at: "2026-10-23T19:20:00Z", summary: "One man wounded." },
        { url: "https://bfmtv.com/b", source: "BFMTV", published_at: null, summary: "Police hunt gunman." },
    ],
}

describe("WebContext", () => {
    it("renders nothing without context", () => {
        expect(renderToStaticMarkup(<WebContext item={{}} />)).toBe("")
        expect(renderToStaticMarkup(<WebContext item={{ web_context: { findings: [] } }} />)).toBe("")
    })

    it("shows the summary and each cited outlet", () => {
        const html = renderToStaticMarkup(<WebContext item={{ web_context: ctx }} />)
        expect(html).toContain("What we found")
        expect(html).toContain("police are looking for the shooter")
        expect(html).toContain("Le Parisien")
        expect(html).toContain("BFMTV")
        expect(html).not.toContain("href=")                  // no navigation away
    })

    it("opens a citation in the in-app viewer with its card", () => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true
        const el = document.createElement("div")
        document.body.appendChild(el)
        const seen = vi.fn()
        window.addEventListener("akili:open-source", (e) => seen(e.detail))
        act(() => { createRoot(el).render(<WebContext item={{ web_context: ctx }} />) })
        act(() => { el.querySelector("[data-testid=web-context-link]").click() })
        expect(seen).toHaveBeenCalledWith(expect.objectContaining({ url: "https://www.leparisien.fr/a", card: expect.objectContaining({ source: "Le Parisien" }) }))
    })
})
