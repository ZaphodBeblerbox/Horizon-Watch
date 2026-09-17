import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const css = readFileSync(path.join(root, "src/styles/designSystem.css"), "utf8")
const html = readFileSync(path.join(root, "index.html"), "utf8")

/**
 * --strip-h and .timestrip's height are two statements of the same fact, in
 * two files. They drifted once already and the consequence was invisible:
 * --strip-h was keyed to a selector nothing matched, stayed 0, and every
 * consumer behaved as though there were no strip — the rails ran over it and
 * the notification stack sat on its controls, for as long as that went
 * unnoticed.
 */
const num = (re, src) => {
    const m = src.match(re)
    expect(m, `pattern not found: ${re}`).toBeTruthy()
    return Number(m[1])
}

describe("the strip's height and --strip-h are one fact", () => {
    const cssDensity = num(/\.timestrip \{[^}]*height:\s*(\d+)px/s, css)
    const cssArchive = num(/\.timestrip:has\(#gcstrip:not\(\.hidden\)\) \{ height:\s*(\d+)px/, css)
    const varDensity = num(/html:has\(#timestrip\)\s*\{\s*--strip-h:\s*(\d+)px/, html)
    const varArchive = num(/html:has\(#gcstrip:not\(\.hidden\)\)\s*\{\s*--strip-h:\s*(\d+)px/, html)

    it("agrees on the density face", () => {
        expect(varDensity).toBe(cssDensity)
    })

    it("agrees on the archive face", () => {
        expect(varArchive).toBe(cssArchive)
    })

    it("makes the archive face the taller of the two", () => {
        expect(cssArchive).toBeGreaterThan(cssDensity)
    })

    it("keys --strip-h off elements that actually exist", () => {
        // It was written against #view-map.active, which nothing in this app
        // has ever carried.
        expect(html).not.toMatch(/--strip-h:[^;]*;\s*\}\s*html:has\(#view-map/)
        expect(html).toMatch(/html:has\(#timestrip\)/)
        const strip = readFileSync(path.join(root, "src/components/TimeStrip.jsx"), "utf8")
        expect(strip).toMatch(/id="timestrip"/)
        expect(strip).toMatch(/id="gcstrip"/)
    })

    it("leaves the archive face room for §11.1's 122px of content plus the head", () => {
        expect(cssArchive).toBeGreaterThanOrEqual(26 + 122)
    })
})

describe("the rails end at the strip (§1.5)", () => {
    it("both panes stop where the strip starts", () => {
        const sit = readFileSync(path.join(root, "src/destinations/Situation.jsx"), "utf8")
        const hits = sit.match(/bottom: "var\(--strip-h, 0px\)"/g) || []
        expect(hits.length, "both the Layers and Inspector panes must end at the strip").toBe(2)
    })

    it("both panes scroll, since they no longer have the full height", () => {
        const sit = readFileSync(path.join(root, "src/destinations/Situation.jsx"), "utf8")
        const styles = sit.slice(sit.indexOf("const leftPaneStyle"), sit.indexOf("// Real, dynamic clearance"))
        expect((styles.match(/overflowY: "auto"/g) || []).length).toBe(2)
    })
})

describe("no rule is keyed to a selector nothing carries", () => {
    // Comments stripped: the note explaining the fix necessarily names the
    // dead selectors, and a guard that its own rationale trips is a guard
    // nobody keeps.
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, "")

    it("designSystem.css has no #view-map or .panes selectors left", () => {
        // #view-map.active and .panes.min-r were never in this app's DOM. The
        // damage was not that the rules did nothing — it was that their
        // :not() halves matched ALWAYS, so the notification stack and the
        // toasts were pinned over the Inspector on every screen, which is the
        // one placement §5.4 rules out by name.
        expect(rules).not.toMatch(/#view-map/)
        expect(rules).not.toMatch(/\.panes\.min-r/)
    })

    it("anchors them to elements that do exist", () => {
        for (const sel of ["#notifstack", ".toast-stack"]) {
            expect(css).toContain(`html:not(:has(#timestrip)) ${sel}`)
            expect(css).toContain(`html:has(#timestrip):not(:has([data-testid="glass-inspector-pane"])) ${sel}`)
        }
        const sit = readFileSync(path.join(root, "src/destinations/Situation.jsx"), "utf8")
        expect(sit).toMatch(/data-testid="glass-inspector-pane"/)
    })

    it("keeps the stack in the map channel by default (§5.4)", () => {
        expect(css).toMatch(/#notifstack \{[^}]*right: calc\(var\(--pane-r\) \+ 12px\)/s)
        expect(css).toMatch(/#notifstack \{[^}]*bottom: calc\(var\(--status\) \+ var\(--strip-h\) \+ 12px\)/s)
    })
})
