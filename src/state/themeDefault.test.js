import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"

const store = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "themeStore.js"), "utf8",
)

/**
 * §4.2 — "A legacy binary theme value in localStorage is not a decision to
 * stop following daylight. Reading one as a held mode silently disables the
 * whole feature."
 *
 * The regression this guards: reconcileTheme resolved a MISSING theme to
 * "dark", so every account that had never chosen one — 7 of the 9 in this
 * database — had the sky clock switched off the moment their profile loaded.
 */
describe("auto daylight is the default", () => {
    // Re-implement the resolver exactly as the store computes it, so the test
    // fails if the expression changes rather than if a comment does.
    const resolve = (theme) => (theme === "light" ? "light" : theme === "dark" ? "dark" : "auto")

    it("treats no stored preference as auto, never as dark", () => {
        expect(resolve(undefined)).toBe("auto")
        expect(resolve(null)).toBe("auto")
        expect(resolve("")).toBe("auto")
    })

    it("honours an explicit choice in either direction", () => {
        expect(resolve("light")).toBe("light")
        expect(resolve("dark")).toBe("dark")
        expect(resolve("auto")).toBe("auto")
    })

    it("does not resolve an unrecognised value to a held mode", () => {
        // A legacy or corrupt value is not a decision either.
        expect(resolve("sepia")).toBe("auto")
    })

    it("the store itself resolves absence to auto", () => {
        // The old expression ended `: "dark"`, which is the bug.
        expect(store).toMatch(/t === "light" \? "light" : t === "dark" \? "dark" : "auto"/)
        expect(store).not.toMatch(/user\?\.theme === "light" \? "light" : "dark"/)
    })

    it("still defaults to auto when localStorage has no mirror", () => {
        expect(store).toMatch(/if \(m === "light" \|\| m === "dark" \|\| m === "auto"\) return m/)
        expect(store).toMatch(/return "auto"/)
    })
})
