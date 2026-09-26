import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const MAIN = readFileSync(fileURLToPath(new URL("./main.jsx", import.meta.url)), "utf8")
const APP = readFileSync(fileURLToPath(new URL("./app.jsx", import.meta.url)), "utf8")

describe("the packaged app cannot come up blank", () => {
    // The DMG rendered nothing. registerSW() ran at module scope,
    // unguarded, and service workers do not exist under tauri://localhost
    // — a throw there meant ReactDOM.render() below it never ran, and the
    // window came up empty with the error nowhere a user could see it.
    // A window that renders nothing is the worst failure available and it
    // was one unguarded call away.

    it("service worker registration is skipped on desktop", () => {
        const call = MAIN.slice(MAIN.indexOf("registerSW({"))
        const before = MAIN.slice(0, MAIN.indexOf("registerSW({"))
        expect(before).toMatch(/if \(!isDesktop\(\)\)/)
        expect(call.length).toBeGreaterThan(0)
    })

    it("service worker registration cannot throw at module scope", () => {
        // Everything between the helper and the render must be inside a
        // try, or a single throw takes the whole render with it.
        const idx = MAIN.indexOf("registerSW({")
        const window = MAIN.slice(Math.max(0, idx - 900), idx)
        expect(window).toMatch(/try\s*\{/)
    })

    it("push initialisation is also guarded", () => {
        const idx = MAIN.indexOf("initPushNotifications()")
        const window = MAIN.slice(Math.max(0, idx - 700), idx)
        expect(window).toMatch(/try\s*\{/)
        expect(window).toMatch(/isDesktop\(\)/)
    })

    it("the boot gate renders a splash, never null", () => {
        // In a browser tab a null render leaves the page frame on screen.
        // In a packaged app the window IS the render, so null is a blank
        // window — indistinguishable from the app being broken, for as
        // long as the session check takes to give up.
        expect(APP).not.toMatch(/if \(!authChecked\) return null/)
        const gate = APP.slice(APP.indexOf("if (!authChecked)"))
        expect(gate.slice(0, 1200)).toMatch(/Parallax/)
    })
})
