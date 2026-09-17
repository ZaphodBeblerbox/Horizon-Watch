/**
 * CoveragePanel.jsx — PARALLAX §13's panel.
 *
 * "The panel must end in a list of your assets you cannot see, sorted by
 * fewest instruments, each row tagged `thin` or `none`. A coverage map that
 * does not end in that list is wallpaper."
 */
import { useEffect, useMemo, useState } from "react"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { classify, isGap, STATE, MOD, cellKey, underCoveredAssets } from "../globe/coverage.js"

const ORDER = ["blind", "presswatch", "archive", "instrumented"]

export default function CoveragePanel({ on, onToggle }) {
    const [cells, setCells] = useState([])
    const [meta, setMeta] = useState(null)
    const [assets, setAssets] = useState([])

    useEffect(() => {
        if (!on) return
        let cancelled = false
        fetch(`${API_BASE}/api/coverage/cells?window_days=30`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (!cancelled && d) { setCells(safeArray(d.cells)); setMeta(d) } })
            .catch(() => {})
        // Your assets — the real watch zones this desk is responsible for.
        fetch(`${API_BASE}/api/imagery/aois`)
            .then((r) => (r.ok ? r.json() : []))
            .then((d) => { if (!cancelled) setAssets(safeArray(d)) })
            .catch(() => {})
        return () => { cancelled = true }
    }, [on])

    const { tally, byCell } = useMemo(() => {
        const t = { instrumented: 0, archive: 0, presswatch: 0, blind: 0 }
        const map = {}
        for (const c of cells) {
            const state = classify(c.mods, { tasked: c.tasked })
            t[state.key] += 1
            const instruments = Object.keys(c.mods || {})
                .filter((k) => MOD[k] && MOD[k].cls !== "D" && c.mods[k] >= 0.5).length
            map[c.cell] = { state, instruments }
        }
        return { tally: t, byCell: map }
    }, [cells])

    const blindSpots = useMemo(() => {
        const rows = (assets || []).map((z) => {
            const lat = z.center_lat ?? (z.bbox_min_lat != null ? (z.bbox_min_lat + z.bbox_max_lat) / 2 : null)
            const lon = z.center_lon ?? (z.bbox_min_lon != null ? (z.bbox_min_lon + z.bbox_max_lon) / 2 : null)
            return { ...z, lat, lon }
        })
        return underCoveredAssets(rows, byCell)
    }, [assets, byCell])

    return (
        <div className="group coverage">
            <div className="grouphead">
                <h4>Coverage & blind spots</h4>
                <button type="button" className="covtoggle" aria-pressed={on} onClick={onToggle}>
                    {on ? "on" : "off"}
                </button>
            </div>

            {!on ? (
                <p className="risknote">
                    Draws what we cannot know. Press-only is the state to watch: it looks
                    like coverage and reports like coverage.
                </p>
            ) : (
                <>
                    <div className="covstates">
                        {ORDER.map((k) => (
                            <div key={k} className="covstate" title={STATE[k].meaning}>
                                <i style={{ background: STATE[k].color }} />
                                <span className="n">{STATE[k].label}</span>
                                <b>{tally[k]}</b>
                            </div>
                        ))}
                    </div>

                    {meta?.modalities_unavailable?.length > 0 && (
                        <p className="risknote">
                            No feed deployed for {meta.modalities_unavailable.map((m) => MOD[m]?.label || m).join(", ")} —
                            those are absent from this map, not zero. A sensor we do not have and a sensor
                            that saw nothing are different statements.
                        </p>
                    )}

                    {/* §13's closing requirement. */}
                    <div className="covassets">
                        <span className="tipl">Your assets you cannot see</span>
                        {!blindSpots.length ? (
                            <p className="risknote">
                                {assets.length
                                    ? "Every asset on file sits in an instrumented cell."
                                    : "No assets on file to check."}
                            </p>
                        ) : blindSpots.slice(0, 12).map((r) => (
                            <div key={r.asset.system_id || r.asset.name} className="covrow">
                                <i style={{ background: r.state.color }} />
                                <span className="n">{r.asset.name}</span>
                                <span className={`tag ${r.tag}`}>{r.tag}</span>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    )
}
