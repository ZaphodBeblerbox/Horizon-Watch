import { describe, it, expect } from "vitest"
import { solarElevationDeg, civilTwilightBlend, CIVIL_TWILIGHT_DEG } from "./solarPosition.js"

describe("solarElevationDeg — validated against real astronomical ground truth", () => {
    it("puts the sun almost directly overhead at solar noon on the equator at the real equinox", () => {
        // Real equinox 2026-03-20. On the equator, at true solar noon
        // (lon=0 => solar noon is ~12:00 UTC, real equation-of-time offset
        // is only a few minutes in March), the sun should be within ~1° of
        // the zenith (90°) — a real, physically unimpeachable check that
        // doesn't depend on remembering any published almanac number.
        const el = solarElevationDeg(0, 0, new Date("2026-03-20T12:00:00Z"))
        expect(el).toBeGreaterThan(88)
        expect(el).toBeLessThanOrEqual(90)
    })

    it("crosses the real horizon (elevation ~0°) six real hours from solar noon at the equinox on the equator", () => {
        // Real, direct consequence of a ~12h day at the equinox — sunrise/
        // sunset should sit almost exactly 6h either side of solar noon.
        const morning = solarElevationDeg(0, 0, new Date("2026-03-20T06:00:00Z"))
        const evening = solarElevationDeg(0, 0, new Date("2026-03-20T18:00:00Z"))
        expect(Math.abs(morning)).toBeLessThan(2)
        expect(Math.abs(evening)).toBeLessThan(2)
    })

    it("matches London's real, well-documented summer-solstice sunrise/sunset window (2026-06-21)", () => {
        // Real reference: London (51.5074N, -0.1278W) around the June
        // solstice has a real, widely-published sunrise near 04:43 BST
        // (03:43 UTC) and sunset near 21:21 BST (20:21 UTC). Sunrise/
        // sunset is conventionally defined at elevation ~-0.83° (standard
        // refraction + solar radius), not exactly 0°. A generous +/-20min
        // tolerance is used since this reference is recalled, not looked
        // up live — the point is confirming the calculation lands in the
        // real ballpark of a known real event, not exact-to-the-second.
        const LAT = 51.5074, LON = -0.1278
        const sunrise = solarElevationDeg(LAT, LON, new Date("2026-06-21T03:43:00Z"))
        const sunset = solarElevationDeg(LAT, LON, new Date("2026-06-21T20:21:00Z"))
        expect(sunrise).toBeGreaterThan(-3)
        expect(sunrise).toBeLessThan(3)
        expect(sunset).toBeGreaterThan(-3)
        expect(sunset).toBeLessThan(3)

        // And a real, unambiguous sanity check either side of that window:
        // well before real sunrise it must be clearly night, at real solar
        // noon it must be clearly day.
        const beforeDawn = solarElevationDeg(LAT, LON, new Date("2026-06-21T02:00:00Z"))
        const noon = solarElevationDeg(LAT, LON, new Date("2026-06-21T12:00:00Z"))
        expect(beforeDawn).toBeLessThan(-5)
        expect(noon).toBeGreaterThan(50)
    })

    it("produces a stable, non-oscillating result for a real polar-summer input (never sets)", () => {
        // Real Svalbard-like latitude (78N) in real midsummer — the sun
        // never sets. Sampled across a full real 24h cycle, elevation must
        // stay positive throughout (never crossing into the twilight band),
        // and the resulting blend must be a stable, fully-day 1 the whole
        // time — not oscillating, not stuck mid-fade.
        const LAT = 78.2, LON = 15.6 // Longyearbyen, Svalbard
        for (let h = 0; h < 24; h++) {
            const el = solarElevationDeg(LAT, LON, new Date(`2026-06-21T${String(h).padStart(2, "0")}:00:00Z`))
            expect(el).toBeGreaterThan(CIVIL_TWILIGHT_DEG) // clear of the twilight band entirely
            expect(civilTwilightBlend(el)).toBe(1)
        }
    })

    it("produces a stable, non-oscillating result for a real polar-winter input (never rises)", () => {
        const LAT = 78.2, LON = 15.6
        for (let h = 0; h < 24; h++) {
            const el = solarElevationDeg(LAT, LON, new Date(`2026-12-21T${String(h).padStart(2, "0")}:00:00Z`))
            expect(el).toBeLessThan(-CIVIL_TWILIGHT_DEG)
            expect(civilTwilightBlend(el)).toBe(0)
        }
    })
})

describe("civilTwilightBlend — continuous mapping, real edge behaviour", () => {
    it("is exactly 0.5 at the true horizon (0° elevation)", () => {
        expect(civilTwilightBlend(0)).toBeCloseTo(0.5, 5)
    })
    it("is exactly 0 at and below -6° and exactly 1 at and above +6°", () => {
        expect(civilTwilightBlend(-6)).toBe(0)
        expect(civilTwilightBlend(-20)).toBe(0)
        expect(civilTwilightBlend(6)).toBe(1)
        expect(civilTwilightBlend(40)).toBe(1)
    })
    it("is linear and monotonic across the real twilight band", () => {
        const a = civilTwilightBlend(-3)
        const b = civilTwilightBlend(0)
        const c = civilTwilightBlend(3)
        expect(a).toBeLessThan(b)
        expect(b).toBeLessThan(c)
        expect(b - a).toBeCloseTo(c - b, 5)
    })
})
