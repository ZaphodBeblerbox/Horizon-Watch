import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const SRC = readFileSync(fileURLToPath(new URL("./Situation.jsx", import.meta.url)), "utf8")

describe("the side panes sit inside the chrome, not under it", () => {
    // Measured in a real browser at 1440x900 with the app rendering:
    //   top bar        0 .. 40
    //   situation    40 .. 876   (the panes' containing block)
    //   time strip  846 .. 876
    //   status bar  876 .. 900
    // A pane is absolutely positioned inside `situation`, so top:0 puts it
    // at y=40 — directly under the top bar, not beneath it — and
    // bottom:var(--pane-bottom) stops it above the strip, whichever
    // face the strip is currently showing.

    const paneStyle = (name) => {
        const i = SRC.indexOf(`const ${name} = {`)
        expect(i).toBeGreaterThan(-1)
        return SRC.slice(i, SRC.indexOf("}", i))
    }

    it.each(["leftPaneStyle", "rightPaneStyle"])("%s is positioned inside its container", (n) => {
        const s = paneStyle(n)
        expect(s).toMatch(/position: "absolute"/)
        /* v6 A4 — INSET, NOT FLUSH. This asked for `top: 0`, which was
           right while the panes were columns of the layout. They are now
           sheets of glass lying ON the map: inset on all four sides with a
           border and a shadow, which is the whole reason the map stays
           legible underneath them. Still absolutely positioned inside the
           same container — that part of the original point stands. */
        expect(s).toMatch(/top: 10/)
    })

    it.each(["leftPaneStyle", "rightPaneStyle"])("%s stops where the time strip starts", (n) => {
        // Not bottom:0 — that would run the pane under the strip and,
        // below it, the status bar.
        expect(paneStyle(n)).toMatch(/bottom: "var\(--pane-bottom\)"/)
    })

    it("the container itself is bounded by the chrome, not the viewport", () => {
        // It is a flex child of the row between the top bar and the status
        // bar. If it were position:fixed or height:100vh the panes would
        // inherit the whole window and run under both bars.
        const root = SRC.slice(SRC.indexOf('data-testid="view-root-situation"'))
        const style = root.slice(0, root.indexOf(">"))
        expect(style).toMatch(/position: "relative"/)
        expect(style).not.toMatch(/100vh/)
    })
})
