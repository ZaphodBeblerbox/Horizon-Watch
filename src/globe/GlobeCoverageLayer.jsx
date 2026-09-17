/**
 * GlobeCoverageLayer.jsx — PARALLAX §13.
 *
 * The only layer that draws what we CANNOT know. It renders the GAPS by
 * default: "Rendering what works is decoration; rendering what does not is
 * the product."
 */
import { useEffect, useState } from "react"
import { Entity, useCesium } from "resium"
import { Rectangle, Color, HeightReference } from "cesium"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { showTip, hideTip } from "./mapTip.js"
import { setEntity, deleteEntity } from "./entityStore.js"
import { classify, isGap, MOD, scoreNote } from "./coverage.js"

const css = (v, a) => Color.fromCssColorString(
    getComputedStyle(document.documentElement).getPropertyValue(v).trim() || "#888",
).withAlpha(a)

export default function GlobeCoverageLayer({ enabled = false, showCovered = false }) {
    const { viewer } = useCesium()
    const [cells, setCells] = useState([])

    useEffect(() => {
        if (!enabled) { setCells([]); return }
        let cancelled = false
        fetch(`${API_BASE}/api/coverage/cells?window_days=30`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (!cancelled) setCells(safeArray(d?.cells)) })
            .catch(() => {})
        return () => { cancelled = true }
    }, [enabled])

    useEffect(() => {
        const ids = []
        for (const c of cells) {
            const state = classify(c.mods, { tasked: c.tasked })
            const id = `coverage-${c.cell}`
            setEntity(id, "heatmap_cell", { ...c, coverage_state: state.key })
            ids.push(id)
        }
        return () => ids.forEach(deleteEntity)
    }, [cells])

    if (!enabled || !cells.length) return null

    return (
        <>
            {cells.map((c) => {
                const state = classify(c.mods, { tasked: c.tasked })
                if (!showCovered && !isGap(state)) return null
                const instruments = Object.keys(c.mods || {})
                    .filter((k) => MOD[k] && MOD[k].cls !== "D" && c.mods[k] >= 0.5).length
                return (
                    <Entity
                        key={c.cell}
                        id={`coverage-${c.cell}`}
                        onMouseMove={(_m, mv) => {
                            const rect = viewer?.scene?.canvas?.getBoundingClientRect?.()
                            if (!rect || !mv?.endPosition) return
                            showTip(
                                <>
                                    <div className="tipk">
                                        <svg><use href="#i-grid" /></svg><span>Coverage</span>
                                        <em>{state.label}</em>
                                    </div>
                                    <b>{state.label} · {instruments} instrument{instruments === 1 ? "" : "s"}</b>
                                    <p className="tipp">{state.meaning}</p>
                                    <div className="tipmods">
                                        {Object.entries(c.mods || {}).map(([k, v]) => (
                                            <span className="tipmod" key={k}>
                                                {MOD[k]?.label || k}
                                                {MOD[k]?.cls === "D" ? " · D" : ""} {Math.round(v * 100)}%
                                            </span>
                                        ))}
                                    </div>
                                    <p className="tiphint">{scoreNote(instruments)}</p>
                                </>,
                                rect.left + mv.endPosition.x, rect.top + mv.endPosition.y,
                            )
                        }}
                        onMouseLeave={hideTip}
                        rectangle={{
                            coordinates: Rectangle.fromDegrees(c.bounds.west, c.bounds.south, c.bounds.east, c.bounds.north),
                            material: state.fill ? css(state.fill.replace(/var\(|\)/g, ""), 1) : Color.TRANSPARENT,
                            outline: true,
                            outlineColor: css(state.color.replace(/var\(|\)/g, ""), 0.3),
                            outlineWidth: 1,
                            heightReference: HeightReference.CLAMP_TO_GROUND,
                        }}
                    />
                )
            })}
        </>
    )
}
