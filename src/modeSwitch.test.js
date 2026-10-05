import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const APP = readFileSync(fileURLToPath(new URL("./app.jsx", import.meta.url)), "utf8")

describe("switching between Watch and Workstation", () => {
    // Two bugs made this look broken. switchMode recorded the outgoing tab
    // inside a setActiveTabId updater — React runs those during render,
    // after the very next line had already read the value back — so the
    // memory was always one switch behind. And the keydown effect's deps
    // were [paletteOpen, openTab], omitting `mode`, so the handler closed
    // over the mode at first render and the toggle stopped working after
    // one use.

    it("reads the current tab synchronously, not through a state setter", () => {
        const fn = APP.slice(APP.indexOf("const switchMode = useCallback"))
        const body = fn.slice(0, fn.indexOf("}, ["))
        expect(body).not.toMatch(/setActiveTabId\(\(/)
        expect(body).toMatch(/activeTabIdRef\.current/)
    })

    it("records the mode it is leaving before reading the one it enters", () => {
        const fn = APP.slice(APP.indexOf("const switchMode = useCallback"))
        const body = fn.slice(0, fn.indexOf("}, ["))
        const write = body.indexOf("lastByMode.current[from]")
        const read = body.indexOf("lastByMode.current[next]")
        expect(write).toBeGreaterThan(-1)
        expect(read).toBeGreaterThan(write)
    })

    it("lands on the section's base page when nothing is remembered", () => {
        const fn = APP.slice(APP.indexOf("const switchMode = useCallback"))
        const body = fn.slice(0, fn.indexOf("}, ["))
        expect(body).toMatch(/MODULE_TO_TAB_TYPE\.cases/)
        expect(body).toMatch(/MODULE_TO_TAB_TYPE\.situation/)
    })

    it("the shortcut handler sees the live mode", () => {
        // Without `mode` in the deps the toggle computes against a stale
        // value and stops switching after the first press.
        //
        // Matched as a SET rather than as an exact array: the list grows
        // when the handler gains a key (Escape needed activeTabType), and
        // a test that spells the whole array out fails on every addition
        // while saying nothing about the thing it is guarding.
        const deps = APP.match(/\}, \[([^\]]*paletteOpen[^\]]*)\]\)/)
        expect(deps, "the keydown effect's dependency array").toBeTruthy()
        for (const needed of ["paletteOpen", "openTab", "mode", "switchMode"]) {
            expect(deps[1], needed).toContain(needed)
        }
    })

    it("the mode toggle is a chord, not a bare key", () => {
        expect(APP).toMatch(/e\.metaKey \|\| e\.ctrlKey\) && e\.shiftKey/)
    })

    it("every way of changing mode goes through switchMode", () => {
        // The TopBar toggle called setMode directly, skipping the
        // last-page memory — so the keyboard shortcut returned you to
        // where you were and clicking the control did not. Any entry
        // point that bypasses switchMode loses the behaviour silently.
        //
        // The v6 chrome removed that TopBar, so this no longer names its
        // props. It asserts the thing the original was protecting: nobody
        // calls the raw setter, and there is still a CLICKABLE way to
        // change mode, not only the ⌘⇧W chord.
        // A bare TOGGLE — "take me to the other mode" with no destination
        // of its own — must go through switchMode, because switchMode is
        // what lands you on the page you last had open there. (setMode is
        // still called directly in three places that each name their own
        // destination, or that follow the active module rather than being
        // a user's decision; those are not toggles and do not want the
        // memory.)
        //
        // And there must still be a CLICKABLE one. The v6 chrome removed
        // the TopBar that used to carry the toggle, which left ⌘⇧W as the
        // only way to change mode at all.
        expect(APP).toMatch(/\(\) => switchMode\(mode === "work" \? "watch" : "work"\), "⇧⌘W"\]/)
        expect(APP).toMatch(/switchMode\(mode === "work" \? "watch" : "work"\)/)
    })
})
