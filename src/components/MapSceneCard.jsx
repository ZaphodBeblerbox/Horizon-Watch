/**
 * MapSceneCard.jsx — a satellite pass placed on the Situation map.
 *
 * The Imagery page's "Show on the map" puts the scene where it was taken,
 * with each detection's outline on the ground. This card is how it is read
 * there: which pass, what changed, and a swipe — the pass left of a handle
 * dragged across the map, the previous pass or the sharp reference right of
 * it (Cesium's split imagery, so both stay on the ground, georeferenced).
 *
 * mapSceneOverlay() turns the card's state into what the globe layer draws;
 * MapSplitHandle is the handle itself.
 */
import { useEffect, useRef, useState } from "react"
import API_BASE from "../apiBase.js"
import { DET_COLORS, fmtDay } from "../destinations/imageryModel.js"

const BTN = {
    height: 24, padding: "0 9px", border: "1px solid var(--gline2)", background: "transparent",
    color: "var(--txt2)", font: "inherit", fontSize: 11, cursor: "pointer", borderRadius: 0, whiteSpace: "nowrap",
}
const ON = { background: "var(--accdim)", color: "var(--txt)", borderColor: "var(--acchi)" }

export const MAP_SCENE_UI = { compare: null, split: 0.5, alpha: 1, outlines: true, changesOnly: false }

export function mapSceneOverlay(scene, ui) {
    if (!scene) return null
    const other = ui.compare === "before" ? scene.before : ui.compare === "hires" ? scene.hires : null
    const shown = (scene.changes || []).filter((c) => c.geo_geometry
        && (!ui.changesOnly || c.type === "new" || c.type === "removed"))
    return {
        image_b64: scene.after.b64, bounds: scene.bounds, alpha: ui.alpha,
        compare_b64: other?.b64 || null, split: other ? ui.split : null,
        detections: ui.outlines ? shown : [],
    }
}

/** The swipe handle across the map; only while comparing. */
export function MapSplitHandle({ split, onSplit }) {
    const ref = useRef(null)
    const begin = (e) => {
        e.preventDefault(); e.stopPropagation()
        const box = ref.current?.parentElement?.getBoundingClientRect()
        if (!box) return
        const move = (ev) => onSplit(Math.max(0.02, Math.min(0.98, (ev.clientX - box.left) / box.width)))
        const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up) }
        window.addEventListener("pointermove", move); window.addEventListener("pointerup", up)
    }
    return (
        <div ref={ref} onPointerDown={begin} style={{
            position: "absolute", top: 0, bottom: 0, left: `calc(${split * 100}% - 12px)`, width: 24, zIndex: 7,
            cursor: "ew-resize", display: "flex", alignItems: "center", justifyContent: "center",
        }}>
            <div style={{ position: "absolute", top: 0, bottom: 0, left: 11, width: 2, background: "#fff", boxShadow: "0 0 0 1px rgba(0,0,0,.45)" }} />
            <div style={{ width: 22, height: 44, background: "#fff", border: "1px solid rgba(0,0,0,.35)", boxShadow: "var(--gshadow)",
                          display: "flex", alignItems: "center", justifyContent: "center", color: "#222", font: "600 12px var(--mono)" }}>↔</div>
        </div>
    )
}

export default function MapSceneCard({ scene, ui, onUi, onClose, onScene }) {
    const [hiresState, setHiresState] = useState(null)
    // The sharp reference, fetched the first time it is asked for.
    useEffect(() => {
        if (!scene || ui.compare !== "hires" || scene.hires || !scene.systemId) return undefined
        let live = true
        setHiresState("loading")
        fetch(`${API_BASE}/api/imagery/zones/${scene.systemId}/hires`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
            .then((d) => { if (live) { onScene({ ...scene, hires: { b64: d.image_b64, date: d.date } }); setHiresState(null) } })
            .catch(() => { if (live) setHiresState("failed") })
        return () => { live = false }
    }, [scene, ui.compare]) // eslint-disable-line react-hooks/exhaustive-deps
    if (!scene) return null
    const set = (k, v) => onUi({ ...ui, [k]: v })
    const pick = (k) => onUi({ ...ui, compare: ui.compare === k ? null : k, split: 0.5 })
    const changed = (scene.changes || []).filter((c) => c.type === "new" || c.type === "removed").length
    const hiresLabel = hiresState === "loading" ? "loading…" : hiresState === "failed" ? "unavailable"
        : scene.hires?.date ? `${fmtDay(scene.hires.date)} ${scene.hires.date.slice(0, 4)}` : "sub-metre"
    return (
        <div role="region" aria-label="Satellite pass on the map" style={{
            position: "absolute", left: "calc(var(--map-inset-l) + 12px)", bottom: "calc(var(--pane-bottom, 14px) + 44px)", zIndex: 8, width: 340,
            background: "var(--bar, var(--glass2))", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)",
            border: "1px solid var(--gline2)", boxShadow: "var(--gshadow)", padding: "10px 12px",
            display: "flex", flexDirection: "column", gap: 8, fontSize: 12,
        }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{scene.name}</span>
                <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, color: "var(--txt4)" }}>
                    {scene.instrument === "SAR" ? "radar" : "optical"} · {fmtDay(scene.after?.date)}
                </span>
                <button onClick={onClose} title="Take the scene off the map" style={{ marginLeft: "auto", border: 0, background: "transparent", color: "var(--txt3)", cursor: "pointer", font: "inherit" }}>✕</button>
            </div>
            {scene.headline && <span style={{ color: "var(--txt2)", lineHeight: 1.4, textWrap: "pretty" }}>{scene.headline}</span>}
            <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ color: "var(--txt3)", fontSize: 11 }}>Swipe against</span>
                <button onClick={() => pick("before")} disabled={!scene.before}
                    title={scene.before ? "" : "The previous pass has no image"}
                    style={{ ...BTN, ...(ui.compare === "before" ? ON : null), opacity: scene.before ? 1 : 0.4 }}>
                    previous · {scene.before ? fmtDay(scene.before.date) : "none"}
                </button>
                {scene.systemId && (
                    <button onClick={() => pick("hires")} title="The sharpest image of the place there is (Esri World Imagery) — not current"
                        style={{ ...BTN, ...(ui.compare === "hires" ? ON : null) }}>sharp · {hiresLabel}</button>
                )}
            </div>
            {ui.compare && (
                <span style={{ fontSize: 11, color: "var(--txt3)" }}>Drag the handle on the map: this pass on the left, the comparison on the right.</span>
            )}
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <button onClick={() => set("outlines", !ui.outlines)} style={{ ...BTN, ...(ui.outlines ? ON : null) }}>Outlines</button>
                <button onClick={() => set("changesOnly", !ui.changesOnly)} style={{ ...BTN, ...(ui.changesOnly ? ON : null) }}>
                    Changes only{changed ? ` · ${changed}` : ""}
                </button>
                <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, color: "var(--txt3)", fontSize: 11 }}>
                    opacity
                    <input type="range" min={0.2} max={1} step={0.05} value={ui.alpha}
                        onChange={(e) => set("alpha", Number(e.target.value))} style={{ width: 64, accentColor: "var(--acchi)" }} />
                </label>
            </div>
            <span style={{ display: "flex", gap: 10, fontSize: 10.5, color: "var(--txt3)" }}>
                <span><i style={{ display: "inline-block", width: 10, borderTop: `2px solid ${DET_COLORS.new}`, marginRight: 4, verticalAlign: "middle" }} />new</span>
                <span><i style={{ display: "inline-block", width: 10, borderTop: `2px dashed ${DET_COLORS.removed}`, marginRight: 4, verticalAlign: "middle" }} />gone</span>
                <span><i style={{ display: "inline-block", width: 10, borderTop: `2px solid ${DET_COLORS.existing}`, marginRight: 4, verticalAlign: "middle" }} />there before</span>
            </span>
        </div>
    )
}
