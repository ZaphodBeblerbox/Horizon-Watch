/**
 * Asserts the published models are in the frame Cesium will read them in.
 *
 * This is the check that was missing when the aircraft came out rolled
 * on their sides. The earlier verification measured the ENTITY's
 * orientation quaternion and found it correct to 0.1° — which it was.
 * The mesh inside that correct frame was lying on its side, because
 * Cesium remaps a glTF's axes on load and the models were authored in
 * Cesium's frame rather than glTF's.
 *
 * So this deliberately checks the thing the quaternion cannot: where
 * the published geometry actually points once Cesium is done with it.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "fs"
import { Axis, Matrix4, Cartesian3 } from "cesium"

const FAMILIES = ["narrowbody", "widebody", "heavy4", "regional",
                  "turboprop", "lightprop", "fighter", "helicopter"]

/** Real length and wingspan in metres, from make_aircraft_models.py. */
const DIMS = {
    narrowbody: [37.6, 35.8], widebody: [63.7, 64.8], heavy4: [72.7, 79.8],
    regional: [36.2, 28.7], turboprop: [27.2, 27.1], lightprop: [14.4, 16.3],
    fighter: [19.4, 13.1], helicopter: [16.0, 14.6],
}

/** Read a .glb's POSITION accessor bounds without decoding the buffer. */
function bounds(family) {
    const path = `public/models/aircraft/${family}.glb`
    if (!existsSync(path)) return null
    const buf = readFileSync(path)
    expect(buf.readUInt32LE(0)).toBe(0x46546c67)          // "glTF"
    const jsonLen = buf.readUInt32LE(12)
    const gltf = JSON.parse(buf.slice(20, 20 + jsonLen).toString("utf8"))
    const acc = gltf.accessors[0]
    return { min: acc.min, max: acc.max }
}

/**
 * Cesium's own conversion for a glTF loaded with the defaults.
 *
 * READ FROM CESIUM, NOT ASSUMED — an earlier version of this test wrote
 * multiply(Z_UP_TO_X_UP, Y_UP_TO_Z_UP) and passed, while the aircraft
 * on screen pointed at the ground. It was wrong twice over: the
 * composition order, and the fact that the forward correction is not
 * applied at all. ModelUtility.getAxisCorrectionMatrix applies
 * Y_UP_TO_Z_UP for upAxis Y, and Z_UP_TO_X_UP only `if (forwardAxis ===
 * Axis.Z)` — and the default forwardAxis is Axis.X.
 *
 * A test that encodes the same guess as the code it checks proves the
 * two agree, not that either is right.
 */
const TO_CESIUM = Matrix4.clone(Axis.Y_UP_TO_Z_UP, new Matrix4())

/** Model extents as Cesium will render them: [along, across, vertical]. */
function cesiumExtents(b) {
    // Transform every corner, since the mapping permutes and negates axes.
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
    for (const x of [b.min[0], b.max[0]])
        for (const y of [b.min[1], b.max[1]])
            for (const z of [b.min[2], b.max[2]]) {
                const v = Matrix4.multiplyByPointAsVector(
                    TO_CESIUM, new Cartesian3(x, y, z), new Cartesian3())
                lo = [Math.min(lo[0], v.x), Math.min(lo[1], v.y), Math.min(lo[2], v.z)]
                hi = [Math.max(hi[0], v.x), Math.max(hi[1], v.y), Math.max(hi[2], v.z)]
            }
    return [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]]
}

describe("published aircraft models, as Cesium will orient them", () => {
    for (const family of FAMILIES) {
        const [length, span] = DIMS[family]

        it(`${family}: lies flat, wings across the direction of travel`, () => {
            const b = bounds(family)
            expect(b, `${family}.glb is missing — run tools/make_aircraft_models.py`).not.toBeNull()
            const [along, across, vertical] = cesiumExtents(b)

            // The aircraft must be THIN vertically. When the axes were
            // wrong this was the largest extent, which is what "flipped
            // 90 degrees on the roll axis" looks like from the cockpit.
            expect(vertical).toBeLessThan(along / 2)
            expect(vertical).toBeLessThan(across / 2)

            // +X is the direction of travel and must match the real
            // length; +Y is the span. Swapping them is a 90° yaw error.
            expect(along).toBeGreaterThan(length * 0.7)
            expect(along).toBeLessThan(length * 1.3)
            expect(across).toBeGreaterThan(span * 0.7)
            expect(across).toBeLessThan(span * 1.3)
        })
    }

    it("a nose-down or rolled model would fail this", () => {
        // Guard the guard: confirm the assertion can actually fail, by
        // running it against bounds authored in the old (wrong) frame.
        // Bounds as the models were authored BEFORE this was understood:
        // nose +X, starboard +Y, up +Z, handed to Cesium unconverted.
        const wrong = { min: [-1, -18, -3], max: [37, 18, 3] }
        const [along, across, vertical] = cesiumExtents(wrong)
        expect(vertical).toBeGreaterThan(Math.min(along, across))
    })
})
