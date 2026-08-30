import { describe, it, expect } from "vitest"
import { ICON_NAMES } from "./Icon.jsx"

// Every semantic name the full-UI-rebuild spec (section 2) explicitly lists:
// "aircraft, ship/vessel, generic point/POI, satellite, facility/building,
// warning triangle, lock, ruler, camera, bell (with count badge), stacked
// layers, filter sliders, target/crosshair, zoom in/out, expand/fullscreen,
// pencil/edit, floppy disk/save, paper-plane/submit, upload, download,
// clipboard."
const REQUIRED_NAMES = [
    "aircraft", "vessel", "poi", "satellite", "facility", "warning", "lock",
    "ruler", "camera", "bell", "layers", "filter", "target", "zoomIn",
    "zoomOut", "expand", "edit", "save", "submit", "upload", "download",
    "clipboard",
]

describe("Icon set", () => {
    it("defines every semantically-required icon from the spec", () => {
        for (const name of REQUIRED_NAMES) {
            expect(ICON_NAMES).toContain(name)
        }
    })

    it("has no duplicate names", () => {
        expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length)
    })
})
