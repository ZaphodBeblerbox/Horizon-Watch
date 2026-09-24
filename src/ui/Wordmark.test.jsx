/**
 * The mark. These are the spec's "don't" list, made mechanical.
 */
import { describe, it, expect } from "vitest"
import { renderToStaticMarkup as html } from "react-dom/server"
import { readFileSync } from "node:fs"
import { Wordmark, Glyph } from "./Wordmark.jsx"

const CSS = readFileSync("src/styles/designSystem.css", "utf8")

describe("Echo X", () => {
    it("draws the letters, so it carries no font dependency", () => {
        const m = html(<Wordmark />)
        expect(m).toContain("<path")
        expect(m).not.toMatch(/<text|font-family/)
    })

    it("gives each instance its own clip id", () => {
        // A repeated id silently clips the second wordmark against the
        // first one's rect, which is invisible until the mark appears
        // twice on one page.
        const a = /id="(plx-clip-\d+)"/.exec(html(<Wordmark />))[1]
        const b = /id="(plx-clip-\d+)"/.exec(html(<Wordmark />))[1]
        expect(a).not.toBe(b)
    })

    it("keeps terminals square-cut", () => {
        // Rounding them is on the spec's don't list: the overshoot-and-
        // clip construction is what makes every terminal flat.
        expect(html(<Wordmark />)).toContain('stroke-linecap="butt"')
        expect(html(<Glyph />)).toContain('stroke-linecap="butt"')
    })

    it("puts the accent ONLY on the echoes", () => {
        // Recolouring the letters with the accent is on the don't list.
        expect(html(<Wordmark />)).toMatch(/stroke="currentColor"/)
        expect(CSS).toContain(".brand .echo { stroke: var(--acc-hi); }")
        expect(CSS).toContain('[data-theme="light"] .brand .echo { stroke: var(--acc); }')
    })

    it("carries two echoes, not one and not three", () => {
        const g = html(<Glyph />)
        const echo = /class="echo" d="([^"]+)"/.exec(g)[1]
        expect(echo.match(/M/g)).toHaveLength(2)
    })

    it("swaps the wordmark for the glyph on a narrow bar", () => {
        expect(CSS).toMatch(/@media \(max-width: 960px\)[\s\S]{0,120}\.brand \.glyph \{ display: block/)
    })

    it("ships a favicon that follows the OS scheme, not the app theme", () => {
        // A favicon is drawn on the browser's chrome, so it cannot read
        // our theme token.
        const fav = readFileSync("public/favicon.svg", "utf8")
        expect(fav).toContain("prefers-color-scheme: dark")
        expect(fav).toContain("#2f5c90")
        expect(fav).toContain("#5f95d0")
    })
})
