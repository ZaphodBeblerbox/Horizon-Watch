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
        expect(APP).toMatch(/\}, \[paletteOpen, openTab, mode, switchMode\]\)/)
    })

    it("the mode toggle is a chord, not a bare key", () => {
        expect(APP).toMatch(/e\.metaKey \|\| e\.ctrlKey\) && e\.shiftKey/)
    })
})
