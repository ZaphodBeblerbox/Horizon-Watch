import { describe, it, expect } from "vitest"
import { samePlace } from "./liveSignals.js"

describe("samePlace: rings only for one spot (owner, 2026-10-24)", () => {
    it("things within 30 m are one place; 100 m away is its own", () => {
        const at = (id, dLatM, dLonM) => ({ id, lat: 48.8676 + dLatM / 111320, lon: 2.3631 + dLonM / (111320 * Math.cos(48.8676 * Math.PI / 180)) })
        const items = [at("a", 0, 0), at("b", 5, 5), at("c", -10, 12), at("d", 100, 0), at("e", 0, -100)]
        const groups = samePlace(items).map((g) => g.map((x) => x.id).sort().join(""))
        expect(groups.sort()).toEqual(["abc", "d", "e"])
    })
})
