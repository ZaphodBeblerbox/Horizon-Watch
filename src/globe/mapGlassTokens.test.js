import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

// Real, permanent regression guard for the map hover-callout/tooltip glass
// treatment (urgent glass-sweep round). These three real, live floating
// elements (GlobePopup's hover-callout + click popup,
// GlobeStrategicZoneTooltip, GlobeSurgeLayer's SurgePopup) only ever
// render when the analyst hovers/clicks a real entity positioned by
// Cesium's own 3D projection — there is no reliable, deterministic way to
// force that interaction in headless Playwright without seeding a fixed
// camera position + real entity and reading back Cesium's own
// scene.cartesianToCanvasCoordinates() projection, which would be a
// second, parallel, much more fragile test mechanism than the thing it's
// testing. So this is a real, still-genuinely-useful STATIC source check
// (not a live getComputedStyle assertion, unlike tests/e2e/theming.spec.js's
// Playwright checks for the panes/panels that ARE reliably triggerable).
//
// Deliberately a positive-only check (file must reference the real shared
// --map-tooltip-bg token + a real backdrop-filter blur) rather than also
// asserting "no hardcoded color anywhere in the file" — these files
// legitimately have plenty of small hardcoded accent colors on internal
// badges/borders/progress-bars (the spec's own "shell only, never on
// interactive content inside" rule), so a blanket hardcoded-color ban
// would false-positive against those. The positive check alone still
// genuinely distinguishes the real pre-fix state from the real post-fix
// state: before this round, none of these three files referenced
// --map-tooltip-bg anywhere at all (confirmed via git history — they used
// #0F1721 / rgba(10,18,35,...) / rgba(10,18,35,...) literals with no
// token reference), so this check would have failed loudly against that
// real historical code.
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const FILES = ["GlobePopup.jsx", "GlobeStrategicZoneTooltip.jsx", "GlobeSurgeLayer.jsx"]

describe("map hover-callout/tooltip glass tokens (static source guard)", () => {
    for (const file of FILES) {
        const src = readFileSync(path.join(__dirname, file), "utf8")

        it(`${file} references the real shared --map-tooltip-bg glass token`, () => {
            expect(src.includes('"var(--map-tooltip-bg)"'), `${file} must reference the real shared var(--map-tooltip-bg) token on its floating-shell background`).toBe(true)
        })

        it(`${file} carries a real backdrop-filter blur (with a Safari prefix) alongside that token`, () => {
            expect(/backdropFilter:\s*"blur\(/.test(src), `${file} must set a real backdropFilter: "blur(...)" (glass treatment)`).toBe(true)
            expect(/WebkitBackdropFilter:\s*"blur\(/.test(src), `${file} must also set WebkitBackdropFilter for Safari`).toBe(true)
        })
    }
})
