/**
 * The non-negotiables of F8, tested.
 *
 * WHY STATIC MARKUP AND NOT A DOM. This repo has no jsdom and no
 * testing-library, and adding both for one component would be a large
 * change to its test posture for a small gain. renderToStaticMarkup
 * uses the react-dom already present and proves the things that fail
 * SILENTLY — a missing stamp still renders a beautiful picture. The one
 * rule it cannot observe, the playback clock, is asserted against the
 * source instead, which is where that bug would actually live.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { renderToStaticMarkup as html } from "react-dom/server"
import ForecastTemplate, { Schematic, Geographic } from "./ForecastTemplate.jsx"
import { TEMPLATE_KEYS, TPL } from "./forecastTemplate.js"

const STAMP = "DOCTRINAL TEMPLATE · NOT AN OBSERVED MOVEMENT"
// The CODE, with comments stripped. The prose in that file discusses
// setInterval and dismissal precisely in order to forbid them, so a
// naive grep over the whole file fails on its own documentation.
const SRC = readFileSync("src/destinations/ForecastTemplate.jsx", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")

describe("the doctrinal template, rendered", () => {
    it("stamps the schematic face of every template, at every t", () => {
        for (const k of TEMPLATE_KEYS) {
            for (const t of [0, 0.5, 1]) {
                expect(html(<Schematic tpl={TPL[k]} t={t} />), `${k}@${t}`).toContain(STAMP)
            }
        }
    })

    it("stamps the geographic face too, before the map has loaded", () => {
        expect(html(<Geographic tpl={TPL.incursion} t={0} country="Sudan" />))
            .toContain(STAMP)
    })

    it("puts the stamp inside the picture, not over it", () => {
        // So a screenshot, a print stylesheet or a stacking-context bug
        // cannot separate the warning from the thing it warns about.
        const m = html(<Schematic tpl={TPL.incursion} t={0} />)
        expect(m.indexOf(STAMP)).toBeLessThan(m.lastIndexOf("</svg>"))
    })

    it("pins the stamp's width so the warning cannot be truncated", () => {
        // It WAS truncated — "…NOT AN OBSERVED MOVEM" — on the first
        // machine it was drawn on, because the box was sized against
        // assumed font metrics. A clipped warning is the exact failure
        // this component exists to prevent, and it varies by font stack,
        // so it would not have reproduced everywhere.
        const m = html(<Schematic tpl={TPL.incursion} t={0} />)
        expect(m).toContain('lengthAdjust="spacingAndGlyphs"')
        const tl = /textLength="(\d+)"/.exec(m)
        const w = /<rect[^>]*width="(\d+)"[^>]*stroke="#FF9F0A"/.exec(m)
        expect(tl, "stamp text has no pinned length").toBeTruthy()
        expect(w, "stamp box not found").toBeTruthy()
        expect(Number(tl[1])).toBeLessThan(Number(w[1]))
    })

    it("offers no way to dismiss the stamp", () => {
        expect(SRC).not.toMatch(/dismiss|setShowStamp|hideStamp|acknowledg/i)
    })

    it("draws at t = 0 on selection, before anything is played", () => {
        // A bordered box containing only a warning label is a
        // quarter-pane of dead space, and dead space is where a reader
        // stops reading warnings. The symbols are on screen at t = 0,
        // and the run starts from there rather than replacing it.
        expect((html(<Schematic tpl={TPL.incursion} t={0} />).match(/<path/g) || []).length)
            .toBeGreaterThan(4)
        const m = html(<ForecastTemplate templateKey="incursion" window="0-3 months" />)
        expect(m).toContain("T+0d")
    })

    it("opens on the map, because that is where movement means something", () => {
        // The schematic shows relationships; the map shows whether they
        // are possible. A reader looking for "what would this look like"
        // wants the second one first.
        const m = html(<ForecastTemplate templateKey="incursion" country="Sudan" />)
        expect(m).toContain("Loading country outlines")
    })

    it("plays itself once, so a movement is not a still picture", () => {
        // t = 0 is still drawn first — the autoplay is deferred, not a
        // replacement for the opening frame.
        expect(SRC).toContain("setTimeout(() => setPlaying(true)")
        expect(SRC).toContain("clearTimeout")
        expect(SRC).toContain("replay")
    })

    it("names the doctrine under the frame", () => {
        const m = html(<ForecastTemplate templateKey="hybrid" />)
        expect(m).toContain("Doctrine.")
        expect(m).toContain(TPL.hybrid.doctrine.slice(0, 40))
    })

    it("says in words, not in a badge, that nothing here was observed", () => {
        expect(html(<ForecastTemplate templateKey="incursion" />))
            .toContain("Nothing above has been observed")
    })

    it("guarantees the run ends even if animation frames never arrive", () => {
        // A10 trap 1: "animation frames are not guaranteed — in a
        // throttled or backgrounded frame the callback never runs."
        // rAF against a wall clock fixes drift, not absence: without a
        // backstop the template freezes at a partial t with the button
        // stuck on "playing…", which reads as a movement that stopped
        // rather than an animation that died.
        expect(SRC).toContain("setTimeout(")
        expect(SRC).toMatch(/RUN_MS \+ \d+/)
        expect(SRC).toContain("clearTimeout(backstop)")
    })

    it("never crops the map, because what gets cropped is the stamp", () => {
        // preserveAspectRatio="slice" scales to fill and cuts the
        // overflow. It cut the stamp off the top of the minimap, and the
        // text was still in the DOM, so a test that only checked for the
        // string passed while the warning was invisible on screen.
        // Precisely the attribute, not the substring: Array.slice is
        // not a cropping bug.
        expect(SRC).toContain('preserveAspectRatio="xMidYMid meet"')
        expect(SRC).not.toMatch(/preserveAspectRatio\s*=\s*"[^"]*slice/)
    })

    it("takes its colours from the theme, not from hardcoded hex", () => {
        // The map has to work in light and dark, so land, sea and borders
        // are theme tokens. The ONE exception is the APP-6 affiliation
        // colours, which are fixed by the standard: an affiliation that
        // changes colour with the UI is an affiliation nobody can trust.
        expect(SRC).toContain("fc-neighbour")
        expect(SRC).toContain("fc-subject")
        expect(SRC).toContain("fc-sea")
        // No hardcoded map backgrounds left behind.
        expect(SRC).not.toContain("#12161a")
        expect(SRC).not.toContain("#242b31")
    })

    it("can be zoomed, panned and enlarged", () => {
        expect(SRC).toContain("onWheel")
        expect(SRC).toContain("onPointerDown")
        expect(SRC).toContain("setPointerCapture")
        expect(SRC).toMatch(/onToggleBig/)
        // Pan/zoom is a transform over the drawn box, never a refit of
        // the projection — refitting moves the units relative to the
        // ground, which is the only thing on this face worth trusting.
        expect(SRC).toMatch(/scale\(\$\{zoom\}\)/)
        // Symbols are counter-scaled: a military symbol is a glyph, not
        // a footprint, so growing it with the zoom invents an area claim
        // and at 8x buries the terrain it exists to be checked against.
        expect(SRC).toContain("scale(\${1 / zoom})")
    })

    it("plays on requestAnimationFrame against a wall clock, never setInterval", () => {
        // setInterval drifts under load and keeps firing in a
        // backgrounded tab, so the six-second run silently becomes
        // something else and two readers see different speeds.
        expect(SRC).toContain("requestAnimationFrame")
        expect(SRC).toContain("performance.now()")
        expect(SRC).not.toContain("setInterval")
        expect(SRC).toContain("cancelAnimationFrame")
    })

    it("renders nothing for a template it does not know", () => {
        // Rather than an empty frame, which reads as "no doctrine"
        // instead of "typo".
        expect(html(<ForecastTemplate templateKey="blitzkrieg" />)).toBe("")
        expect(html(<ForecastTemplate templateKey={null} />)).toBe("")
    })

    it("states every reason there might be no map, rather than drawing around it", () => {
        // A blank panel on this face reads as "no land here", which is a
        // claim about the terrain rather than about the fetch.
        expect(html(<Geographic tpl={TPL.incursion} t={0} country="Sudan" />))
            .toContain("Loading country outlines")
    })

    it("does not present the symbols as surveyed positions", () => {
        // The template is doctrine laid over real ground; a reader who
        // takes these for locations has been misled.
        const src = readFileSync("src/destinations/ForecastTemplate.jsx", "utf8")
        expect(src).toContain("not at surveyed positions")
    })

    it("never reaches for Cesium", () => {
        // "Do not render templated units as Cesium entities on the live
        // globe: that is the one place they would be mistaken for
        // tracks."
        expect(SRC).not.toMatch(/from "cesium"|from "resium"/)
    })
})
