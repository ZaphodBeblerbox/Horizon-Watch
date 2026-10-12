// "Assess with AI" never runs the model by itself: rendering only shows the
// button (and, in an effect, asks for free whether it was already assessed);
// the paid POST is made only by the button's click.
import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { renderToStaticMarkup } from "react-dom/server"

const apiFetch = vi.fn()
vi.mock("../auth.js", () => ({ apiFetch: (...a) => apiFetch(...a) }))
const { default: AssessWithAI, usd } = await import("./AssessWithAI.jsx")

describe("AssessWithAI", () => {
    it("renders the button and calls nothing while rendering", () => {
        const html = renderToStaticMarkup(<AssessWithAI zoneId="ZONE-005" findingId="chg:CHG-1" />)
        expect(html).toContain("Assess with AI")
        expect(apiFetch).not.toHaveBeenCalled()
    })
    it("nothing without a finding", () => {
        expect(renderToStaticMarkup(<AssessWithAI zoneId="ZONE-005" findingId={null} />)).toBe("")
    })
    it("the paid POST is only in the click handler", () => {
        const src = readFileSync(new URL("./AssessWithAI.jsx", import.meta.url), "utf8")
        const posts = src.match(/"POST"/g) || []
        expect(posts).toHaveLength(1)
        const run = src.slice(src.indexOf("const run = async"), src.indexOf("const p = st.preview"))
        expect(run).toContain('"POST"')
        // run is only ever wired to a click
        expect(src).not.toMatch(/\brun\(\)/)            // never called directly
        expect(src).toContain("onClick={run}")
        // the effect on show only GETs (free: the cache, and the estimate)
        const effect = src.slice(src.indexOf("useEffect("), src.indexOf("if (!zoneId || !findingId) return null"))
        expect(effect).not.toContain("POST")
    })
    it("shows a cost estimate in plain dollars", () => {
        expect(usd(0.00218)).toBe("about $0.0022")
        expect(usd(0.5)).toBe("about $0.50")
    })
})
