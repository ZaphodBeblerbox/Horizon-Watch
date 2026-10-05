import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

const SRC = readFileSync(new URL("./useChrome.js", import.meta.url), "utf8")

/* React runs a setState updater during the RENDER phase. A store write
   inside one therefore notifies every other subscriber mid-render, which is
   what produced "Cannot update a component (Situation) while rendering a
   different component (App)" on every panel toggle. */
describe("useChrome's toggle", () => {
    it("writes the setting outside the state updater", () => {
        const toggle = SRC.slice(SRC.indexOf("const toggle ="), SRC.indexOf("return [open, toggle"))
        const updater = toggle.match(/setOpenLocal\(\s*\([^)]*\)\s*=>\s*\{[\s\S]*?\}\s*\)/)
        expect(updater, "toggle must not pass a function to setOpenLocal").toBeNull()
        expect(toggle).toContain("updateSetting(")
    })

    it("takes the next value from the store, not from a stale local", () => {
        // The store is what the other subscribers are about to be told, so
        // it is what this should negate.
        const toggle = SRC.slice(SRC.indexOf("const toggle ="), SRC.indexOf("return [open, toggle"))
        expect(toggle).toContain("readChrome()")
    })
})
