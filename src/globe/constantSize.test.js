import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { badgeUri, ICON_PX, EDGE, STROKE } from "../lib/mapIcons.js"
import { actIcon, ACTS } from "../lib/liveSignals.js"

const read = (d, f) => readFileSync(`${d}/${f}`, "utf8")

describe("constant on-screen size (owner, 2026-10-23: no dot that grows with zoom)", () => {
    it("no globe layer scales a marker by camera distance or draws a ground-sized ellipse", () => {
        for (const f of readdirSync("src/globe").filter((x) => /\.jsx$/.test(x))) {
            const s = read("src/globe", f)
            expect(s, f).not.toMatch(/scaleByDistance/)
            expect(s, f).not.toMatch(/\bellipse=\{\{|ellipse:\s*\{/)
        }
    })
    it("the phone map draws no ground-radius circle and no pulsing halo", () => {
        expect(read("src/mobile/screens", "MMap.jsx")).not.toMatch(/L\.circle\(/)
        expect(read("src/mobile", "m2.css")).not.toMatch(/m2-me-pulse|m2-here-glow/)
    })
})

describe("one icon style", () => {
    it("every act badge is a filled circle with the one dark edge and the one stroke weight, at the one size", () => {
        for (const a of Object.keys(ACTS)) {
            const svg = Buffer.from(actIcon(a).split(",")[1], "base64").toString()
            expect(svg).toContain(`stroke="${EDGE}" stroke-width="${STROKE}"`)
            expect(svg).toContain(`width="${ICON_PX * 2}"`)
            expect(svg).toMatch(/<circle[^>]*fill="#[0-9A-F]{6}"/i)
        }
    })
    it("the sensor family is the same style in another shape", () => {
        const svg = Buffer.from(badgeUri({ shape: "square", color: "#E5484D", glyph: "M16 9v14" }).split(",")[1], "base64").toString()
        expect(svg).toContain(`stroke="${EDGE}" stroke-width="${STROKE}"`)
        expect(svg).toContain("<rect")
    })
})
