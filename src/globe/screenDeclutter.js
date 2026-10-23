/**
 * screenDeclutter.js — ONE collision pass for every point layer of the globe (owner, 2026-10-22/23: "no
 * overlapping icons, ever"; one unified typology). Each layer registers its points; one pass in SCREEN pixels
 * (lib/liveSignals.js declutterAll, the same pass the phone runs) groups every marker whose box touches another,
 * across layers; a group of one is drawn by its own layer, a larger group is ONE ICON: its most important member's
 * own marker (lib/liveSignals.js representative: priority, then recency), drawn by that member's layer, whose card
 * lists the others (owner, 2026-10-23 evening: one icon per place, never stacked). Nothing is nudged. Recomputed when the points change and when the camera moves (debounced).
 *
 *   useDeclutter(key, items, enabled) -> this layer's share of the layout:
 *       [{ id, cluster:false, lat, lon, item }]                     a marker of its own
 *       [{ id, cluster:true, lat, lon, item, members:[{key,item}], pri }]  several things at one place: drawn as
 *                                           `item` (the most important, members[0]) by its own layer
 *   items: [{ id, lat, lon, size, pri, t, image, pin, title, line }]  (size = the marker's on-screen box in px,
 *          image = its own marker, pin = stands on its point)
 *
 * Traffic (ships, aircraft) is not in the pass: it moves, and a tracker shows every contact.
 */
import { useEffect, useState } from "react"
import { useCesium } from "resium"
import { Cartesian3, SceneTransforms } from "cesium"
import { declutterAll, onNearSide, representative } from "../lib/liveSignals.js"
import { topPriority } from "../lib/mapIcons.js"

/** Who draws a mixed cluster: the first of these among its members. */
export const ORDER = ["assets", "safeHouses", "liveSignals", "protests", "derivedAlerts", "strikes", "imagerySignals", "findings",
                      "geoConfirmed", "endangered", "gfw", "fires", "gdelt", "replay", "chokepoints", "ports", "airports", "facilities"]
const rank = (k) => { const i = ORDER.indexOf(k); return i < 0 ? ORDER.length : i }

const _layers = new Map()          // key -> { items, set }
let _viewer = null, _unhook = null, _timer = 0

function compute() {
    const scene = _viewer?.scene
    if (!scene || scene.isDestroyed?.()) return
    const cam = scene.camera.positionWC
    const W = scene.canvas.clientWidth, H = scene.canvas.clientHeight
    const pts = []
    for (const [key, L] of _layers) {
        for (const it of L.items) {
            if (!Number.isFinite(it.lat) || !Number.isFinite(it.lon)) continue
            const p = Cartesian3.fromDegrees(it.lon, it.lat, 0)
            if (!onNearSide(p, cam)) continue
            const w = SceneTransforms.worldToWindowCoordinates(scene, p)
            const s = it.size || 24
            if (!w || w.x < -s || w.y < -s || w.x > W + s || w.y > H + s) continue
            pts.push({ id: `${key}|${it.id}`, x: w.x, y: w.y, size: s, _k: key, _it: it })
        }
    }
    const groups = declutterAll(pts)
    const out = new Map([..._layers.keys()].map((k) => [k, []]))
    const dbg = []
    for (const g of groups) {
        const ms = g.members.map((m) => ({ key: m._k, item: m._it }))
        if (!g.cluster) {
            const m = ms[0]
            out.get(m.key)?.push({ id: m.item.id, cluster: false, lat: m.item.lat, lon: m.item.lon, item: m.item })
            dbg.push({ id: g.id, x: g.x, y: g.y, size: m.item.size || 24, cluster: false, layer: m.key })
            continue
        }
        // ONE ICON PER PLACE (owner, 2026-10-23 evening): the group is drawn as its most important member's own
        // marker (priority, then the most recent; ORDER breaks a tie), at that member's place, by that member's layer;
        // its card lists the others. Never a count badge.
        const ranked = [...ms].sort((a, b) => rank(a.key) - rank(b.key))
        const top = representative(ranked.map((m) => ({ ...m, pri: m.item.pri, t: m.item.t })))
        const rest = ms.filter((m) => m !== top && !(m.key === top.key && m.item === top.item))
        const members = [{ key: top.key, item: top.item }, ...rest]
        out.get(top.key)?.push({ id: `cl:${g.id}`, cluster: true, lat: top.item.lat, lon: top.item.lon, item: top.item, top: members[0], members,
                                 pri: topPriority(ms.map((m) => m.item.pri).filter(Boolean)) })
        dbg.push({ id: g.id, x: g.x, y: g.y, size: top.item.size || 24, cluster: true, n: ms.length, layer: top.key })
    }
    if (typeof window !== "undefined") window.__plxDeclutter = dbg          // reachable for browser checks
    for (const [k, L] of _layers) L.set(out.get(k) || [])
}
const later = () => { clearTimeout(_timer); _timer = setTimeout(compute, 100) }

function hook(viewer) {
    if (_viewer === viewer) return
    _unhook?.()
    _viewer = viewer
    const scene = viewer?.scene
    if (!scene) { _unhook = null; return }
    const a = scene.camera.moveEnd.addEventListener(later)
    const b = scene.camera.changed.addEventListener(later)
    _unhook = () => { a?.(); b?.(); _viewer = null }
}

export function useDeclutter(key, items, enabled = true) {
    const cesium = useCesium()
    const [layout, setLayout] = useState([])
    useEffect(() => {
        const viewer = cesium?.viewer
        if (!enabled || !viewer || viewer.scene?.isDestroyed?.()) { setLayout([]); return undefined }
        hook(viewer)
        _layers.set(key, { items: Array.isArray(items) ? items : [], set: setLayout })
        later()
        return () => {
            _layers.delete(key)
            later()
            if (!_layers.size) { _unhook?.(); _unhook = null }
        }
    }, [key, enabled, items, cesium?.viewer])
    return layout
}

/**
 * The inspector record of a place with several things: the one list card (kind live_cluster), headed by the most
 * important (the one drawn), its line first, then the others.
 */
export function clusterRecord(g) {
    const top = g.members[0]?.item || {}
    const head = `${top.title || "Here"} · ${g.members.length - 1} more here`
    return { kind: "live_cluster", id: g.id, headline: head, title: head, lat: g.lat, lon: g.lon,
             cluster: g.members.map((m) => ({ title: m.item.title || "", line: m.item.line || "" })) }
}
