// @vitest-environment jsdom
// Owner, 2026-10-12: "In the Imagery UI, why does it redirect us to the map
// to see new detections?" A finding clicked in Imagery opens on its image
// THERE; the map is a button, never automatic.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { act } from "react"
import { createRoot } from "react-dom/client"
import Imagery from "../../destinations/Imagery.jsx"

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const TILE = { min_lon: 37.167361, min_lat: 50.592885, max_lon: 37.457731, max_lat: 50.77686 }
const FINDING = {
    id: "sweep:ZONE-054:0", kind: "sweep_find", label: "Possible tent or vehicle group", lat: 50.59866, lon: 37.23606,
    box: [37.2335, 50.5970, 37.2390, 50.6003], box_source: "pixel_extent", tone: "red", area_m2: 57200, size: "5.7 ha",
    date: "2026-10-11", scan_id: "6f94d8fd-8b36", zone_id: "ZONE-054", t_peak: 16.79, landcover: "grassland",
    sensor: "Sentinel-1 radar", radar_images: false,
}

function answer(url, init) {
    const u = String(url)
    if (/\/api\/watch-zones\?|\/api\/watch-zones$/.test(u)) {
        return [{ system_id: "ZONE-054", name: "Possible new vehicle or tent concentration", status: "active", bbox: TILE,
                  created_at: "2026-10-01T00:00:00", metadata: {} }]
    }
    if (/\/scans$/.test(u)) return { scans: [] }
    if (/\/findings\/crop/.test(u)) return { image_b64: null, why: "No image of this area is held yet." }
    if (/\/findings\?/.test(u)) return { zone: { system_id: "ZONE-054", bbox: TILE }, findings: [FINDING], counts: {} }
    if (/\/radar-images\//.test(u)) {
        if (init?.method === "POST") return { status: "running", done: 0, total: 6 }
        return { status: "missing", regenerable: true, requests: 6, why: "This comparison ran before its images were kept." }
    }
    return {}
}

let root, host, events
beforeEach(() => {
    events = []
    globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} }
    globalThis.fetch = vi.fn(async (url, init) => ({ ok: true, status: 200, json: async () => answer(url, init) }))
    for (const t of ["akili:open-map", "akili:fly-to", "akili:map-show-scene"]) {
        window.addEventListener(t, () => events.push(t))
    }
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)) }) }

describe("a finding clicked in Imagery", () => {
    it("opens on its image inside Imagery and does not go to the map", async () => {
        await act(async () => { root.render(<Imagery />) })
        await flush()
        const row = host.querySelector("[data-finding-row]")
        expect(row).not.toBeNull()
        await act(async () => { row.click() })
        await flush()
        expect(host.querySelector("[data-finding-viewer]")).not.toBeNull()
        expect(events).toEqual([])
        // an older comparison offers its radar images, with the cost on the button
        const load = host.querySelector("[data-load-radar]")
        expect(load?.textContent).toMatch(/Load the radar images · 6 requests/)
        // and says what "new bright" means
        expect(host.querySelector("[data-radar-explain]")?.textContent).toMatch(/sends much more back than before/)
    })
    it("the map is an option: one button, pressed on purpose", async () => {
        await act(async () => { root.render(<Imagery />) })
        await flush()
        await act(async () => { host.querySelector("[data-finding-row]").click() })
        await flush()
        await act(async () => { host.querySelector("[data-finding-map]").click() })
        expect(events).toContain("akili:open-map")
    })
    it("with no image held, the first action is the image, not the map", async () => {
        await act(async () => { root.render(<Imagery />) })
        await flush()
        const open = host.querySelector("[data-image-state='none'] [data-open-finding]")
        expect(open?.textContent).toMatch(/See the findings on their image/)
        await act(async () => { open.click() })
        await flush()
        expect(host.querySelector("[data-finding-viewer]")).not.toBeNull()
        expect(events).toEqual([])
    })
})
