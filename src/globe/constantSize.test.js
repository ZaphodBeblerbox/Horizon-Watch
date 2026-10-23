import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { markerIcon, svgOf, ICON_PX, EDGE, STROKE, SIZE } from "../lib/mapIcons.js"
import { actIcon, ACTS } from "../lib/liveSignals.js"

const read = (f) => readFileSync(f, "utf8")
const ls = (d, re) => readdirSync(d).filter((x) => re.test(x) && !/\.test\./.test(x)).map((x) => `${d}/${x}`)

// every file that draws a point marker on the globe or the phone map
const GLOBE = ls("src/globe", /\.(jsx|js)$/)
const PHONE = ["src/mobile/mapLayers.js", "src/mobile/screens/MMap.jsx", "src/mobile/liveMarkers.js", "src/mobile/trackLeaflet.js",
               "src/mobile/findingsLeaflet.js", "src/mobile/screens/MVesselThreat.jsx"]
const SHARED = ["src/lib/liveSignals.js", "src/lib/protests.js", "src/evacuation/safeHouseIcon.js"]
const ALL = [...GLOBE, ...PHONE, ...SHARED]

describe("constant on-screen size (owner, 2026-10-23: no dot that grows with zoom)", () => {
    it("nothing on the globe or the phone map scales a marker by camera distance or draws a ground-sized ellipse", () => {
        for (const f of ALL) {
            const s = read(f)
            expect(s, f).not.toMatch(/scaleByDistance\s*:|scaleByDistance=\{|new NearFarScalar/)
            expect(s, f).not.toMatch(/\bellipse=\{\{|ellipse:\s*\{/)
            expect(s, f).not.toMatch(/sizeInMeters\s*:\s*true/)
        }
    })
    it("the phone map draws no ground-radius circle and no pulsing halo", () => {
        expect(read("src/mobile/screens/MMap.jsx")).not.toMatch(/L\.circle\(/)
        expect(read("src/mobile/m2.css")).not.toMatch(/m2-me-pulse|m2-here-glow/)
    })
    it("no marker size depends on the data or the zoom: no size tables keyed by class, count or casualties", () => {
        for (const f of ALL) {
            const s = read(f)
            expect(s, f).not.toMatch(/PORT_ICON_SIZE|AIRPORT_ICON_SIZE|INFRA_POINT_SIZE|RING_PX\b/)
            expect(s, f).not.toMatch(/size\s*=\s*list\.length\s*>=/)
        }
    })
})

describe("every layer's markers come from lib/mapIcons.js (one typology)", () => {
    // A marker image built anywhere else is a second style. Allowed: text labels (a label is not a marker) and
    // the frontline unit symbol (milsymbol, drawn on a line, constant size).
    const OWN_SVG = /data:image\/svg\+xml/
    // entityIcons.js keeps the lucide glyphs of the ontology graph (ForceGraph), which is not a map
    const ALLOW = { "src/mobile/mapLayers.js": /textLabelUri|lineSwatch|areaSwatch/, "src/globe/frontlineClaims.js": /milSymbol|pillUri/,
                    "src/globe/entityIcons.js": /entityMarkerDataUri|entityMarkerSvg/ }
    it("no layer file builds its own SVG marker image", () => {
        for (const f of ALL) {
            const s = read(f)
            if (!OWN_SVG.test(s)) continue
            const lines = s.split("\n").filter((l) => OWN_SVG.test(l))
            const ctx = (i) => s.slice(Math.max(0, s.indexOf(lines[i]) - 1500), s.indexOf(lines[i]))
            lines.forEach((l, i) => {
                const ok = ALLOW[f] && ALLOW[f].test(ctx(i) + l)
                expect(ok ? "" : l.trim(), `${f} builds its own marker image`).toBe("")
            })
        }
    })
    it("no globe layer draws a raw Cesium point as a marker (a point is a dot of its own style)", () => {
        for (const f of GLOBE.filter((x) => /\.jsx$/.test(x))) {
            expect(read(f), f).not.toMatch(/pixelSize\s*:/)
        }
    })
    it("the phone draws no divIcon marker of its own (a wrapper round the module's image, the selected ring aside)", () => {
        // a divIcon may only wrap the module's image (a ship turned to its heading, the team's dot with its name
        // label), be the selected ring or a text label; any other divIcon is a marker style of its own
        for (const f of PHONE) {
            const s = read(f)
            const calls = s.split(/L\.divIcon\(/).slice(1).map((c) => c.slice(0, 400))
            for (const c of calls) expect(/<img src="\$\{|m2-picked|html: `<span /.test(c) ? "" : c.slice(0, 120), `${f} divIcon`).toBe("")
        }
    })
    it("every layer imports the one module", () => {
        const drawing = ALL.filter((f) => /billboard=\{\{|billboard:\s*\{|L\.marker\(|iconUri:|L\.icon\(/.test(read(f)))
        for (const f of drawing) expect(read(f), f).toMatch(/lib\/mapIcons\.js|\.\/mapIcons\.js|liveSignals\.js|protests\.js|strikes\.js|endangeredPlaces\.js|farIcons\.js|infraGlyphs\.js|entityIcons\.js|safeHouseIcon\.js|gfwEvents\.js|mapLayers\.js/)
    })
})

describe("one icon style", () => {
    it("every act badge is a filled circle with the one dark edge and the one stroke weight, at the one size", () => {
        for (const a of Object.keys(ACTS)) {
            const svg = svgOf(actIcon(a))
            expect(svg).toContain(`stroke="${EDGE}" stroke-width="${STROKE}"`)
            expect(svg).toContain(`width="${ICON_PX * 2}"`)
            expect(svg).toMatch(/<circle[^>]*fill="#[0-9A-F]{6}"/i)
        }
    })
    it("the sensor family is the same style in another shape", () => {
        const svg = svgOf(markerIcon({ kind: "confirmed", glyph: "imagery", priority: "flash" }).uri)
        expect(svg).toContain(`stroke="${EDGE}" stroke-width="${STROKE}"`)
        expect(svg).toContain("<rect")
        expect(svg).toContain(`width="${SIZE.event * 2}"`)
    })
})
