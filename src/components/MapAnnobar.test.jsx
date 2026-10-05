/**
 * The basemap switch in the annotation toolbar. Static markup, as elsewhere
 * in this repo: it proves the switch names all three maps and marks the
 * current one, which is what failed the last time this control existed.
 */
import { describe, it, expect } from "vitest"
import { renderToStaticMarkup as html } from "react-dom/server"
import MapAnnobar from "./MapAnnobar.jsx"
import { BASEMAPS } from "./MapChrome.jsx"

describe("MapAnnobar basemap switch", () => {
    it("labels every basemap and marks exactly the current one", () => {
        const out = html(<MapAnnobar basemap={{ value: "satellite", onChange: () => {} }} />)
        for (const b of BASEMAPS) expect(out).toContain(`>${b.label}</button>`)
        expect(out.match(/aria-checked="true"/g)).toHaveLength(1)
        expect(out).toMatch(/id="bm-satellite"[^>]*aria-checked="true"/)
    })

    it("is absent when the host gives it no basemap to drive", () => {
        expect(html(<MapAnnobar />)).not.toContain('role="radiogroup"')
    })
})
