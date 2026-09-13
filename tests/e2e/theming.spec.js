// Real-browser regression guard for the console's theming system.
//
// Why this exists: PR #43 (real dark/light token layer) shipped a real
// regression — Generate, Briefings, and every Workstation window (My
// work/Mail/Cases/Team) inherited a hardcoded #050c1c app-shell background
// that never responded to [data-theme="light"] (fixed in PR #44), and the
// Inspector/Layers glass treatment was reported "already correct" without
// ever actually being checked against these two real panes (also fixed in
// PR #44, then corrected again in PR #47 to match the map hover-bar's real
// tint recipe). Both of those fixes shipped as pure visual/manual claims
// with no automated check that could ever fail loudly — so the same class
// of regression could recur silently. This spec is that check.
//
// It reads REAL computed styles (getComputedStyle) from a REAL running
// instance of this app in a REAL browser (jsdom cannot compute
// backdrop-filter or resolve CSS custom properties the way a real engine
// does) — never a re-assertion of "this looks right" from source alone.
//
// Requires a real backend reachable at E2E_API_BASE (default
// http://localhost:8000). There's no public self-service registration
// endpoint (accounts are invite-only/approved), so this spec creates its
// own real throwaway account by shelling out to
// backend/e2e_theming_fixture.py (the same "real DB row, created and
// cleaned up directly" pattern this repo's backend test_*.py scripts
// already use) in beforeAll/afterAll — no manual setup step required to
// run this test. Skips (not fails) if the backend isn't reachable at all —
// same disclosed-environment-dependency pattern as this repo's own
// src/lib/ref.test.js.
import { test, expect } from "@playwright/test"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { PNG } from "pngjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BACKEND_DIR = path.resolve(__dirname, "../../backend")
const FIXTURE_SCRIPT = path.join(BACKEND_DIR, "e2e_theming_fixture.py")

const EMAIL = "e2e-theming-probe@test.local"
const PASSWORD = "ThemingProbe-2026!"
const API_BASE = process.env.E2E_API_BASE || "http://localhost:8000"

function runFixture(cmd) {
    try {
        execFileSync("python3", [FIXTURE_SCRIPT, cmd], { cwd: BACKEND_DIR, stdio: "pipe", timeout: 20_000 })
        return true
    } catch {
        return false // backend/DB not reachable from this environment — beforeAll's own reachability check handles skipping honestly
    }
}

// Every real console pane/window this round's regression touched or must
// guard, keyed by its data-testid="view-root-<key>" hook (added alongside
// this spec — see Generate.jsx/Briefings.jsx/MyWork.jsx/Cases.jsx/
// Team.jsx/Mail.jsx/Ontology.jsx/Analytics.jsx/Situation.jsx). Situation is
// the real reference window every other window's background is compared
// against — it was never affected by the historical regression.
const REFERENCE = "situation"
const WINDOWS = [
    { key: "situation", label: "Situation", mode: "watch" },
    { key: "ontology", label: "Ontology", mode: "watch" },
    { key: "analytics", label: "Analytics", mode: "watch" },
    { key: "generate", label: "Generate", mode: "watch" },
    { key: "briefings", label: "Briefings", mode: "watch" },
    { key: "mywork", label: "My work", mode: "work" },
    { key: "mail", label: "Mail", mode: "work" },
    { key: "cases", label: "Cases", mode: "work" },
    { key: "team", label: "Team", mode: "work" },
]

let backendReachable = true
test.beforeAll(async () => {
    backendReachable = false
    for (let attempt = 0; attempt < 4 && !backendReachable; attempt++) {
        try {
            const r = await fetch(API_BASE, { signal: AbortSignal.timeout(15000) })
            backendReachable = r.status < 500 // even a 404 proves the server itself answered
        } catch {
            await new Promise((res) => setTimeout(res, 2000))
        }
    }
    if (backendReachable) backendReachable = runFixture("create")
})

test.afterAll(() => {
    if (backendReachable) runFixture("cleanup")
})

async function login(page) {
    await page.goto("/")
    // Generous timeout: this repo's real backend does real, sometimes
    // CPU-heavy background work (AIS/GDELT ingestion, on-demand ML
    // inference) against a real ~3GB SQLite DB, and can be transiently
    // slow to answer even a first request — same real-environment
    // tolerance src/lib/ref.test.js's own live calls already assume.
    await page.waitForSelector('input[type="email"], button[title="Settings"]', { timeout: 45000 })
    const emailInput = await page.$('input[type="email"]')
    if (emailInput) {
        await emailInput.fill(EMAIL)
        await page.fill('input[type="password"]', PASSWORD)
        await page.click('button[type="submit"]')
    }
    await page.waitForSelector('button[title="Settings"]', { timeout: 45000 })
}

async function setTheme(page, theme) {
    const btn = await page.$('button[title="Switch to light theme"], button[title="Switch to dark theme"]')
    const title = await btn.getAttribute("title")
    const current = title.includes("dark theme") ? "light" : "dark"
    if (current !== theme) {
        await btn.click()
        await page.waitForTimeout(200)
    }
    const actual = await page.evaluate(() => document.documentElement.getAttribute("data-theme") || "dark")
    expect(actual, `theme toggle must actually reach ${theme}`).toBe(theme)
}

async function openWindow(page, win) {
    const modeTitle = await page.evaluate(() =>
        document.querySelector('button[title*="Workstation mode"], button[title*="Watch mode"]')?.getAttribute("title") || ""
    )
    if (win.mode === "work" && modeTitle.includes("Workstation mode")) {
        await page.click('button[title*="Workstation mode"]')
        await page.waitForTimeout(150)
    } else if (win.mode === "watch" && modeTitle.includes("Watch mode")) {
        await page.click('button[title*="Watch mode"]')
        await page.waitForTimeout(150)
    }
    await page.click(`button[title="${win.label}"]`)
    await page.waitForSelector(`[data-testid="view-root-${win.key}"]`, { timeout: 10000 })
    await page.waitForTimeout(150)
}

async function computedOf(page, selector) {
    return await page.evaluate((sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const cs = getComputedStyle(el)
        return { backgroundColor: cs.backgroundColor, backdropFilter: cs.backdropFilter }
    }, selector)
}

// Round 4 fix — a getComputedStyle match is NECESSARY but not SUFFICIENT
// evidence that a pane is genuinely visually translucent: this exact repo
// shipped Layers/Inspector with a fully correct token + backdrop-filter
// (confirmed by this same computedOf check, every prior round) while the
// map canvas underneath them never actually extended behind their real
// screen position at all (a layout bug — flex siblings, not an overlay —
// found only by real pixel sampling). This helper does what
// getComputedStyle structurally cannot: it reads real, rendered, post-
// compositing pixel values from an actual PNG screenshot (pngjs — Node's
// built-in zlib does the real DEFLATE decompression PNG requires; no
// headless-browser canvas trick can capture a real backdrop-filter's
// actual compositor output any other way) and asserts they are NOT all
// identical — a flat, unvarying color under a pane is exactly the
// signature of "nothing real is behind this to blur", regardless of what
// its own computed style claims.
async function samplePaneEdgeColors(page, selector, { edgeOffset = 6, fromEdge = "left", sampleCount = 40 } = {}) {
    const el = await page.$(selector)
    const box = await el.boundingBox()
    const buffer = await page.screenshot({ clip: box })
    const png = PNG.sync.read(buffer)
    const x = fromEdge === "left" ? edgeOffset : png.width - 1 - edgeOffset
    const colors = []
    for (let i = 0; i < sampleCount; i++) {
        const y = Math.floor((i / sampleCount) * (png.height - 1))
        const idx = (png.width * y + x) << 2
        colors.push(`${png.data[idx]},${png.data[idx + 1]},${png.data[idx + 2]}`)
    }
    return colors
}

test.describe("theming regression guard — pane backgrounds + glass treatment", () => {
    // Collected per-theme so the "does it actually flip between themes"
    // assertion (the exact symptom of the historical regression) can be
    // made after both passes, not just "matches Situation right now".
    const collected = { dark: {}, light: {} }

    for (const theme of ["dark", "light"]) {
        test(`${theme} theme — every window's background resolves against real tokens`, async ({ page }) => {
            test.skip(!backendReachable, `backend not reachable at ${API_BASE} — same disclosed dependency as src/lib/ref.test.js`)
            await login(page)
            await setTheme(page, theme)

            for (const win of WINDOWS) {
                await openWindow(page, win)
                const style = await computedOf(page, `[data-testid="view-root-${win.key}"]`)
                expect(style, `view-root-${win.key} must be present in the DOM`).not.toBeNull()
                collected[theme][win.key] = style.backgroundColor
            }

            // Every real window must match the real reference window
            // (Situation) in this same theme — not merely "some color".
            const refBg = collected[theme][REFERENCE]
            for (const win of WINDOWS) {
                expect(
                    collected[theme][win.key],
                    `${win.key} background in ${theme} theme must equal Situation's real ${theme}-theme background (${refBg}) — got ${collected[theme][win.key]}. ` +
                    `A mismatch here means this window is not reading the real --bg-0 token, the exact PR #44 regression (hardcoded #050c1c app-shell background).`
                ).toBe(refBg)
            }

            // Real glass-pane check (Inspector + Layers), Situation only —
            // the one real screen that hosts both docked glass panes.
            if (theme === "dark" || theme === "light") {
                await openWindow(page, { key: "situation", label: "Situation", mode: "watch" })
                for (const testid of ["glass-layers-pane", "glass-inspector-pane"]) {
                    const style = await computedOf(page, `[data-testid="${testid}"]`)
                    expect(style, `${testid} must be present`).not.toBeNull()
                    expect(
                        style.backdropFilter,
                        `${testid} must carry a real backdrop-filter blur in ${theme} theme (glass treatment) — got "${style.backdropFilter}"`
                    ).toMatch(/blur/)
                    collected[theme][testid] = style.backgroundColor
                }

                // Round 4 fix — real pixel-sampling check, the exact gap
                // that let Layers/Inspector ship with correct computed
                // styles but zero real visible translucency (the map
                // canvas's own real layout never extended behind these
                // panes at all — a flex-sibling, not overlay, bug found
                // only by sampling actual rendered pixels). Fly to a real,
                // visually-varied coastline first so there's real content
                // to detect variation against.
                await page.evaluate(() => {
                    window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: 36.5, lon: -5.5, altitude: 400000 } }))
                })
                await page.waitForTimeout(2000)
                for (const [testid, fromEdge] of [["glass-layers-pane", "left"], ["glass-inspector-pane", "right"]]) {
                    const colors = await samplePaneEdgeColors(page, `[data-testid="${testid}"]`, { fromEdge })
                    const uniqueColors = new Set(colors)
                    expect(
                        uniqueColors.size,
                        `${testid} in ${theme} theme shows a real pixel-flat, unvarying color (${colors[0]}) across its whole height — this is the exact "glass mechanism is correct but nothing real is behind it to blur" regression (a layout bug: the map canvas's own real bounding rect must extend behind this pane, confirmed via document.querySelector('canvas').getBoundingClientRect() in the real browser). A getComputedStyle match alone cannot catch this.`
                    ).toBeGreaterThan(1)
                }

                // GeoConfirmed historic-timeline panel (urgent glass-sweep
                // round) — a real floating window over the map, auto-shown
                // by the News toggle; must carry the same real glass
                // treatment as Inspector/Layers, never a private tint.
                await page.click('button[title="News"]')
                await page.waitForSelector('[data-testid="glass-geoconfirmed-timeline-panel"]', { timeout: 10000 })
                await page.waitForTimeout(500) // real content load, so its real measured height (and therefore the chrome push-up below) has settled
                const gcStyle = await computedOf(page, '[data-testid="glass-geoconfirmed-timeline-panel"]')
                expect(gcStyle, "glass-geoconfirmed-timeline-panel must be present once News is toggled on").not.toBeNull()
                expect(
                    gcStyle.backdropFilter,
                    `GeoConfirmed timeline panel must carry a real backdrop-filter blur in ${theme} theme — got "${gcStyle.backdropFilter}"`
                ).toMatch(/blur/)
                // Round 3 fix — the panel previously used --map-tooltip-bg
                // (a real, theme-flipping, blur-bearing token — which is
                // exactly why the OLD version of this very assertion block
                // still reported passing) instead of the same --pane-
                // glass-bg family Layers/Inspector use, and read as
                // near-black at this panel's scale as a result. A test that
                // only checks "has some blur, in some theme-reactive color"
                // can't catch "the wrong real token" — it must compare
                // against the actual reference value.
                const layersStyle = await computedOf(page, '[data-testid="glass-layers-pane"]')
                expect(
                    gcStyle.backgroundColor,
                    `GeoConfirmed timeline panel's background in ${theme} theme must match the real Layers/Inspector glass tint (${layersStyle.backgroundColor}) — got ${gcStyle.backgroundColor}. A mismatch here is exactly the "reads as near-black, not the app's blue-grey family" regression.`
                ).toBe(layersStyle.backgroundColor)
                collected[theme]["glass-geoconfirmed-timeline-panel"] = gcStyle.backgroundColor

                // Round 3 fix — the map's real scale-bar/coordinate-readout
                // chrome must render ABOVE (not spatially overlapping) the
                // open GeoConfirmed panel. Real bounding-box check, not a
                // z-index/computed-style one: the prior bug had the chrome
                // technically on top per z-index already (confirmed via
                // elementsFromPoint) while still visually overlapping the
                // panel's own text at the same screen position.
                const overlap = await page.evaluate(() => {
                    const chrome = document.querySelector('[data-testid="map-bottom-chrome"]')
                    const panel = document.querySelector('[data-testid="glass-geoconfirmed-timeline-panel"]')
                    if (!chrome || !panel) return null
                    const c = chrome.getBoundingClientRect(), p = panel.getBoundingClientRect()
                    return { chromeBottom: c.bottom, panelTop: p.top }
                })
                expect(overlap, "map-bottom-chrome and the GeoConfirmed panel must both be present to check their layout").not.toBeNull()
                expect(
                    overlap.chromeBottom,
                    `the map's scale-bar/coordinate-readout chrome (bottom edge at ${overlap.chromeBottom}) must not extend below the GeoConfirmed panel's top edge (${overlap.panelTop}) — an overlap here is the exact "scale bar rendering underneath/covered by the panel" regression, even if both are technically visible per z-index.`
                ).toBeLessThanOrEqual(overlap.panelTop)

                await page.click('button[title="News"]') // real toggle-off — confirms it un-mounts, not just visually hides
                await expect(page.locator('[data-testid="glass-geoconfirmed-timeline-panel"]')).toHaveCount(0)
            }
        })
    }

    test("every window's background actually changes between dark and light (doesn't get stuck)", async () => {
        test.skip(!backendReachable, `backend not reachable at ${API_BASE}`)
        for (const win of WINDOWS) {
            expect(
                collected.dark[win.key],
                `${win.key} must resolve a real background in dark theme before this comparison can run`
            ).toBeTruthy()
            expect(
                collected.light[win.key],
                `${win.key} must resolve a real background in light theme before this comparison can run`
            ).toBeTruthy()
            expect(
                collected.dark[win.key],
                `${win.key}'s background must actually flip between themes — dark (${collected.dark[win.key]}) and light (${collected.light[win.key]}) resolved identically, meaning this window ignores data-theme entirely (the exact "same dark background in light mode too" regression).`
            ).not.toBe(collected.light[win.key])
        }
        for (const testid of ["glass-layers-pane", "glass-inspector-pane", "glass-geoconfirmed-timeline-panel"]) {
            expect(
                collected.dark[testid],
                `${testid}'s glass tint must actually flip between themes — got identical values in both`
            ).not.toBe(collected.light[testid])
        }
    })
})
