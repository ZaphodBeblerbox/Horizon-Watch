import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const SRC = fileURLToPath(new URL("..", import.meta.url))

function walk(dir, out = []) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) walk(p, out)
        else if (/\.jsx$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p)
    }
    return out
}

describe("the bars are absolute limits", () => {
    // Four fixed panels had four different hardcoded top values — 0, 40,
    // 44 and 48 — for one top bar that is 40px, or 34px at compact
    // density. So every one of them was wrong in at least one mode, and
    // InspectorPanel at top:0 sat underneath the top bar entirely. They
    // all used bottom:0, which ran them under the status bar.
    //
    // A panel begins where the top bar ends and ends where the status bar
    // begins. Nothing overlaps.

    const PANELS = [
        "components/InspectorPanel.jsx",
        "components/OverwatchSidebar.jsx",
        "components/ChatPanel.jsx",
        "components/WorkspacesPanel.jsx",
    ]

    it.each(PANELS)("%s pins its top edge to --top", (rel) => {
        const t = readFileSync(join(SRC, rel), "utf8")
        const fixed = t.slice(t.indexOf('position'))
        expect(fixed).toMatch(/top:\s*("|')?\s*var\(--top/)
    })

    it.each(PANELS)("%s pins its bottom edge to --status", (rel) => {
        const t = readFileSync(join(SRC, rel), "utf8")
        expect(t).toMatch(/bottom:\s*[^,\n]*var\(--status/)
    })

    it("no fixed panel hardcodes a top that is meant to clear the top bar", () => {
        // 34/40/44/48 are the values that have been guessed at for this
        // one bar. A literal there is a value that will be wrong the next
        // time the bar or the density changes.
        const offenders = []
        for (const f of walk(SRC)) {
            const t = readFileSync(f, "utf8")
            if (!/position:\s*("|')fixed/.test(t)) continue
            if (/top:\s*(34|40|44|48)\s*,/.test(t)) offenders.push(f.replace(SRC, ""))
        }
        expect(offenders).toEqual([])
    })
})

describe("collapsing a bar gives the space back", () => {
    const HTML = readFileSync(fileURLToPath(new URL("../../index.html", import.meta.url)), "utf8")

    it("--status follows the status bar's collapsed state", () => {
        // Otherwise a panel pinned to bottom:var(--status) floats above a
        // gap where the bar used to be.
        expect(HTML).toMatch(/html:has\(#statusbar\.collapsed\)\s*\{\s*--status:/)
    })

    it("--strip-h follows the time strip's collapsed state", () => {
        expect(HTML).toMatch(/html:has\(#timestrip\.collapsed\)\s*\{\s*--strip-h:/)
    })

    it("--status is 0 now that the bar is gone, and still a token", () => {
        // The status bar was removed. --status is kept and set to 0 rather
        // than deleted, because every docked panel and map overlay is
        // positioned against it — a token that still exists can be given a
        // height again without hunting down its consumers.
        expect(HTML).toMatch(/--status:\s*0px/)
    })
})
