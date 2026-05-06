// Procedural GLTF model generators for Cesium entity orientation.
//
// Each model is a flat 2D shape lying in the local XY plane (Z=0).
// When combined with Transforms.headingPitchRollQuaternion(position, HPR(heading, 0, 0)):
//   - The shape lies flat on the globe surface at the entity's position
//   - +Y direction in model space = North when heading=0
//   - heading rotates the shape within the local horizontal plane
//
// Models use KHR_materials_unlit with white base colour so that model.color
// on the Resium Entity controls the final rendered colour (HIGHLIGHT blend:
// result = white × entityColour = entityColour).

function arrayBufferToBase64(buf) {
    const bytes = new Uint8Array(buf)
    let str = ""
    for (let i = 0; i < bytes.byteLength; i++) str += String.fromCharCode(bytes[i])
    return btoa(str)
}

function buildGLTF(positions, indices, min3, max3) {
    const posBytes = positions.byteLength  // Float32 × 3 × nVerts
    const idxBytes = indices.byteLength    // Uint16 × nIdx

    const gltf = {
        asset: { version: "2.0", generator: "HorizonWatch" },
        extensionsUsed: ["KHR_materials_unlit"],
        scene: 0,
        scenes: [{ nodes: [0] }],
        nodes:  [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0, mode: 4 }] }],
        materials: [{
            pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] },
            extensions: { KHR_materials_unlit: {} },
            doubleSided: true,
        }],
        accessors: [
            {
                bufferView: 0, byteOffset: 0,
                componentType: 5126,              // FLOAT
                count: positions.length / 3,
                type: "VEC3",
                max: max3, min: min3,
            },
            {
                bufferView: 1, byteOffset: 0,
                componentType: 5123,              // UNSIGNED_SHORT
                count: indices.length,
                type: "SCALAR",
                max: [Math.max.apply(null, indices)],
                min: [0],
            },
        ],
        bufferViews: [
            { buffer: 0, byteOffset: 0,       byteLength: posBytes, target: 34962 }, // ARRAY_BUFFER
            { buffer: 0, byteOffset: posBytes, byteLength: idxBytes, target: 34963 }, // ELEMENT_ARRAY_BUFFER
        ],
        buffers: [{ byteLength: posBytes + idxBytes }],
    }

    const combined = new ArrayBuffer(posBytes + idxBytes)
    new Uint8Array(combined, 0,       posBytes).set(new Uint8Array(positions.buffer))
    new Uint8Array(combined, posBytes, idxBytes).set(new Uint8Array(indices.buffer))
    gltf.buffers[0].uri = `data:application/octet-stream;base64,${arrayBufferToBase64(combined)}`

    return `data:model/gltf+json;base64,${btoa(JSON.stringify(gltf))}`
}

// ── Aircraft arrow ─────────────────────────────────────────────────────────────
// Chevron: nose at +Y, wings at ±X, tail notch concave rear.
// Dimensions in GLTF metres; Cesium scales via minimumPixelSize / maximumScale.
//   nose (0,30,0) → pointing North (+Y ENU) when heading=0
export const AIRCRAFT_ARROW_URI = buildGLTF(
    new Float32Array([
         0,  30, 0,   // nose
       -15, -10, 0,   // left wing tip
        15, -10, 0,   // right wing tip
         0,  -5, 0,   // tail notch
    ]),
    new Uint16Array([0, 1, 3,  0, 3, 2]),
    [-15, -10, 0], [15, 30, 0]
)

// ── Vessel hull ────────────────────────────────────────────────────────────────
// Kite/hull: bow at +Y, beam at ±X, stern at -Y.
//   bow (0,20,0) → pointing North (+Y ENU) when heading=0
export const VESSEL_HULL_URI = buildGLTF(
    new Float32Array([
         0,  20, 0,   // bow
        -8,   0, 0,   // port beam
         8,   0, 0,   // starboard beam
         0, -15, 0,   // stern
    ]),
    new Uint16Array([0, 1, 3,  0, 3, 2]),
    [-8, -15, 0], [8, 20, 0]
)
