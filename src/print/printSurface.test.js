import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const SRC = fileURLToPath(new URL("..", import.meta.url))

function walk(dir, out = []) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) walk(p, out)
        else if (/\.jsx?$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p)
    }
    return out
}

const files = walk(SRC)
const surface = readFileSync(join(SRC, "print/printSurface.jsx"), "utf8")

describe("PDF export is an allowlist, not a denylist", () => {
    // The whole-UI-in-the-PDF bug was a denylist: PrintLayout named the
    // chrome to hide, and every panel added afterwards printed because
    // nobody updated the list. These tests fail closed instead.

    it("hides every body child that is not the print root", () => {
        expect(surface).toMatch(/body\s*>\s*\*:not\(#print-root\)\s*\{\s*display:\s*none!important\s*\}/)
    })

    it("shows the print root", () => {
        expect(surface).toMatch(/#print-root\{display:block!important/)
    })

    it("no print stylesheet hides named app chrome", () => {
        // If this trips, someone has gone back to naming chrome. The
        // allowlist already covers it; a denylist beside it only rots.
        const CHROME = /\.(topbar|tabstrip|statusbar|doctools|docaside|scrim|layerrail|dock)\b[^{}]*\{[^{}]*display:\s*none/i
        const offenders = files.filter((f) => {
            const t = readFileSync(f, "utf8")
            if (!t.includes("@media print")) return false
            const block = t.slice(t.indexOf("@media print"))
            return CHROME.test(block)
        })
        expect(offenders.map((f) => f.replace(SRC, ""))).toEqual([])
    })

    it("nothing calls window.print() outside the shared entry point", () => {
        // Two call sites means two behaviours; the surface has to be
        // mounted and laid out before the dialog opens.
        const offenders = files.filter((f) =>
            !f.endsWith("print/printSurface.jsx") && /window\.print\(\)/.test(readFileSync(f, "utf8")))
        expect(offenders.map((f) => f.replace(SRC, ""))).toEqual([])
    })
})

describe("every exported page carries the two marks", () => {
    it("PageFrame renders the Parallax mark and the Trifecta footer", () => {
        const frame = readFileSync(join(SRC, "print/PageFrame.jsx"), "utf8")
        expect(frame).toMatch(/Parallax/)
        expect(frame).toMatch(/Trifecta Technologies/)
    })

    it("the report pages brand every page, not just the first", () => {
        const pl = readFileSync(join(SRC, "reports/PrintLayout.jsx"), "utf8")
        const pages = (pl.match(/<section className="docpage"/g) || []).length
        expect(pages).toBeGreaterThan(0)
        expect((pl.match(/<PageBrand \/>/g) || []).length).toBe(pages)
        expect((pl.match(/<PageFooterMark \/>/g) || []).length).toBe(pages)
    })
})
