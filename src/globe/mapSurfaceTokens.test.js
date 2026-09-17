import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

// Regression guard for the map hover-callout/tooltip SURFACE treatment.
//
// This file was previously mapGlassTokens.test.js and asserted the opposite
// of what it asserts now: that each of these three floating elements carried
// a real backdrop-filter blur. That was a correct guard for the design it was
// written against — the shells were deliberately translucent glass over the
// globe. The design has since changed: every panel, popup and tooltip in the
// app is opaque, because translucent shells over a moving 3D map made the
// text underneath them unreadable and the shells themselves hard to locate.
//
// The test is inverted rather than deleted. What made the original guard
// worth having still holds: these three elements only render when the analyst
// hovers or clicks a real entity positioned by Cesium's own 3D projection, so
// there is no reliable way to force that interaction in headless Playwright
// without seeding a fixed camera and reading back
// scene.cartesianToCanvasCoordinates() — a second, far more fragile test
// mechanism than the thing being tested. A static source check is still the
// right tool; only the property it checks for has flipped.
//
// Deliberately narrow: it checks the shared --map-tooltip-bg token is used
// on the shell and that no blur has crept back. It does NOT ban rgba() inside
// these files. A first draft of this guard did, and it failed immediately and
// correctly — these files legitimately use rgba() for progress-bar tracks, a
// round close button, and severity badge tints, none of which are shells and
// all of which are meant to tint what they sit on (the spec's "shell only,
// never on interactive content inside" rule). Banning them would have been a
// guard that enforced something the design never asked for.
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// GlobeSurgeLayer.jsx went with the old surge layer and
// GlobeStrategicZoneTooltip.jsx with the conflict zones; GlobePopup is the
// one map surface still painting a floating shell.
const FILES = ["GlobePopup.jsx"]

describe("map hover-callout/tooltip surface tokens (static source guard)", () => {
    for (const file of FILES) {
        const src = readFileSync(path.join(__dirname, file), "utf8")

        it(`${file} references the shared --map-tooltip-bg surface token`, () => {
            expect(
                src.includes('"var(--map-tooltip-bg)"'),
                `${file} must reference the shared var(--map-tooltip-bg) token on its floating-shell background`,
            ).toBe(true)
        })

        it(`${file} carries no backdrop blur — these shells are opaque`, () => {
            expect(
                /backdropFilter/i.test(src),
                `${file} must not set backdropFilter: floating shells over the globe are opaque, ` +
                `so text under them stays readable and the shell edge stays findable`,
            ).toBe(false)
        })

    }
})
