import { describe, it, expect } from "vitest"
import { formatLatLon } from "./coordinateFormat.js"

const DEG = Math.PI / 180

describe("formatLatLon — radians to decimal-degree display", () => {
    it("formats a real NW-hemisphere point (Los Angeles) with N/W signs", () => {
        expect(formatLatLon(-118.2437 * DEG, 34.0522 * DEG)).toBe("34.0522°N, 118.2437°W")
    })

    it("formats a real NE-hemisphere point (Kyiv) with N/E signs", () => {
        expect(formatLatLon(30.5234 * DEG, 50.4501 * DEG)).toBe("50.4501°N, 30.5234°E")
    })

    it("formats a real SE-hemisphere point (Sydney) with S/E signs", () => {
        expect(formatLatLon(151.2093 * DEG, -33.8688 * DEG)).toBe("33.8688°S, 151.2093°E")
    })

    it("formats a real SW-hemisphere point (Buenos Aires) with S/W signs", () => {
        expect(formatLatLon(-58.3816 * DEG, -34.6037 * DEG)).toBe("34.6037°S, 58.3816°W")
    })

    it("treats the equator/prime-meridian boundary (0, 0) as N/E", () => {
        expect(formatLatLon(0, 0)).toBe("0.0000°N, 0.0000°E")
    })

    it("treats a point exactly on the equator (nonzero longitude) as N", () => {
        expect(formatLatLon(45 * DEG, 0)).toBe("0.0000°N, 45.0000°E")
    })

    it("treats a point exactly on the prime meridian (nonzero latitude) as E", () => {
        expect(formatLatLon(0, -12 * DEG)).toBe("12.0000°S, 0.0000°E")
    })

    it("rounds to 4 decimal places", () => {
        expect(formatLatLon(-0.5 * DEG, 45.123456 * DEG)).toBe("45.1235°N, 0.5000°W")
    })
})
