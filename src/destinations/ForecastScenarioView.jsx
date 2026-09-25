/**
 * ForecastScenarioView.jsx — a saved scenario, worked out and drawn.
 *
 * The builder states a pairing; this answers it. Everything on this page
 * is derived for THIS pairing and no other: the border it would cross,
 * the airfields it would fly from, the places doctrine would go after,
 * and the prior that says whether any of it is worth reading.
 *
 * Nothing is cached from a template. Two scenarios over the same country
 * with different aggressors produce different contacts, different
 * origins and different objectives, because they are different
 * questions.
 */
import { useEffect, useMemo, useState } from "react"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { assembleScenario } from "./forecastBuild.js"
import { scenarioBBox, projectUnits } from "./forecastScenario.js"
import { viewFor, project } from "./forecastTerrain.js"
import { Geographic } from "./ForecastTemplate.jsx"
import { RUN_MS, phaseAt } from "./forecastTemplate.js"
import { COA_META } from "./forecastCOA.js"
import { pct } from "./forecastBars.js"

const W = 560, H = 240

export default function ForecastScenarioView({ scenario, onBack }) {
    const [world, setWorld] = useState(null)
    const [fields, setFields] = useState(null)
    const [caps, setCaps] = useState(undefined)
    const [prior, setPrior] = useState(null)
    const [t, setT] = useState(0)
    const [playing, setPlaying] = useState(false)
    const [exportError, setExportError] = useState(null)

    useEffect(() => {
        let dead = false
        fetch("/data/world-countries.json").then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (!dead && d) setWorld(d.features) }).catch(() => {})
        fetch(`${API_BASE}/api/airports?limit=9000`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                if (dead) return
                setFields(safeArray(d?.features).map((f) => ({
                    name: f?.properties?.airport_name || f?.properties?.ident,
                    type: f?.properties?.airport_type,
                    cc: f?.properties?.country_code,
                    lon: f?.geometry?.coordinates?.[0],
                    lat: f?.geometry?.coordinates?.[1],
                })).filter((f) => f.name && Number.isFinite(f.lon)))
            }).catch(() => { if (!dead) setFields([]) })
        return () => { dead = true }
    }, [])

    const force = scenario?.aggressor ? `${scenario.aggressor} Armed Forces` : null
    useEffect(() => {
        if (!force) return
        let dead = false
        fetch(`${API_BASE}/api/forecast/capabilities?force=${encodeURIComponent(force)}`,
              { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (!dead) setCaps(d?.known ? safeArray(d.capabilities) : null) })
            .catch(() => { if (!dead) setCaps(null) })
        return () => { dead = true }
    }, [force])

    const objective = scenario?.target_lat != null
        ? { name: scenario.target_place, lat: scenario.target_lat,
            lon: scenario.target_lon }
        : null

    const built = useMemo(() => {
        if (!world || !fields || !scenario) return null
        return assembleScenario({
            world, fields, target: scenario.target, aggressor: scenario.aggressor,
            objective, capabilities: caps === undefined ? null : caps,
            coa: scenario.coa,
        })
    }, [world, fields, scenario, objective, caps])

    useEffect(() => {
        if (!built?.ok || !scenario) return
        let dead = false
        const q = new URLSearchParams({
            a: scenario.aggressor, b: scenario.target,
            contiguous: String(built.contiguous), months: "3",
        })
        fetch(`${API_BASE}/api/forecast/dyad-risk?${q}`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (!dead && d && !d.error) setPrior(d) })
            .catch(() => {})
        return () => { dead = true }
    }, [scenario, built?.contiguous])

    // The laydown, in the map's own coordinates.
    const drawn = useMemo(() => {
        const lay = built?.laydown
        if (!lay?.ok) return null
        const bbox = scenarioBBox(lay)
        if (!bbox) return null
        const view = viewFor(bbox, { w: W, h: H })
        const units = projectUnits(lay, view, project)
        return { bbox, units, phases: lay.phases, doctrine: lay.doctrine,
                 objectives: lay.objectives, origins: lay.origins }
    }, [built])

    // EXPORT POSTS WHAT THIS PAGE IS SHOWING. The laydown is computed here,
    // in the browser, from the real border, coastline and airfield list; the
    // server stores only the scenario's inputs. Re-deriving it in Python for
    // the PDF would be a second implementation of the same model, and the
    // first time they drifted the document would disagree with the screen
    // that produced it. So the page sends its own result and the server
    // renders it — it still reads the scenario's own fields from the
    // database, so nothing about the heading can be spoofed from here.
    const [exporting, setExporting] = useState(false)
    const exportPdf = async () => {
        if (!scenario?.id || exporting) return
        setExporting(true)
        try {
            const lay = built?.laydown
            const res = await fetch(
                `${API_BASE}/api/forecast/scenarios/${encodeURIComponent(scenario.id)}/export.pdf`,
                {
                    method: "POST", credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        prior: prior || null,
                        assessment: built?.ok ? {
                            contiguous: built.contiguous,
                            targetCoastal: built.targetCoastal,
                            available: built.available,
                            excluded: built.excluded,
                            capabilities: built.capabilities,
                        } : {},
                        laydown: lay?.ok ? {
                            doctrine: lay.doctrine, phases: lay.phases,
                            units: lay.units, objectives: lay.objectives,
                            origins: lay.origins,
                        } : {},
                    }),
                })
            if (!res.ok) throw new Error(`export failed (${res.status})`)
            const blob = await res.blob()
            const url = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = url
            a.download = `scenario-${scenario.name || scenario.id}.pdf`
            a.click()
            URL.revokeObjectURL(url)
        } catch (e) {
            // A failed export says so where the analyst is looking, rather
            // than leaving a button that appears to have done nothing.
            setExportError(e.message || "export failed")
        } finally {
            setExporting(false)
        }
    }

    useEffect(() => { setT(0); setPlaying(false) }, [scenario?.id, drawn?.units?.length])

    useEffect(() => {
        if (!playing) return
        const t0 = performance.now()
        let raf = 0
        const step = () => {
            const k = Math.min(1, (performance.now() - t0) / RUN_MS)
            setT(k)
            if (k < 1) raf = requestAnimationFrame(step)
            else setPlaying(false)
        }
        raf = requestAnimationFrame(step)
        const backstop = setTimeout(() => { setT(1); setPlaying(false) }, RUN_MS + 900)
        return () => { cancelAnimationFrame(raf); clearTimeout(backstop) }
    }, [playing])

    if (!scenario) return null

    const meta = COA_META[scenario.coa]
    const phase = drawn ? phaseAt({ phases: drawn.phases }, t) : null
    const tpl = drawn
        ? { units: drawn.units, phases: drawn.phases,
            doctrine: drawn.doctrine, line: "", lineLabel: "" }
        : null

    const lab = { font: "600 10px var(--font)", letterSpacing: ".07em",
                  textTransform: "uppercase", color: "var(--txt-3)", margin: "14px 0 5px" }

    return (
        <div style={{ padding: "12px 14px 24px" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                {onBack ? <button className="btn sm" onClick={onBack}>← back</button> : null}
                <h2 style={{ font: "600 16px var(--font)", color: "var(--txt)", margin: 0 }}>
                    {scenario.name}
                </h2>
                <span style={{ font: "400 11px var(--font)", color: "var(--txt-3)" }}>
                    {scenario.aggressor} → {scenario.target_place || scenario.target}
                </span>
                <span style={{ flex: 1 }} />
                {prior ? (
                    <span style={{ font: "600 15px var(--mono)", color: "var(--txt)" }}>
                        {pct(prior.p)}
                    </span>
                ) : null}
                <button className="btn sm" onClick={exportPdf} disabled={exporting}
                        title="Download this scenario as a plain document — the prior, the courses of action, and the laydown">
                    {exporting ? "building…" : "export pdf"}
                </button>
            </div>
            {exportError ? (
                <div style={{ font: "400 10.5px var(--font)", color: "var(--amber)",
                              marginTop: 4 }}>{exportError}</div>
            ) : null}
            {prior ? (
                <div style={{ font: "400 10.5px var(--font)", color: "var(--txt-3)",
                              marginTop: 2 }}>
                    chance of interstate fighting in this pairing over 3 months
                    {safeArray(prior.why).length ? ` — ${prior.why[0]}` : ""}
                </div>
            ) : null}

            {!built ? (
                <div style={{ font: "400 11px var(--font)", color: "var(--txt-3)",
                              marginTop: 16 }}>Working out the theatre…</div>
            ) : !built.ok ? (
                <div style={{ font: "400 11px var(--font)", color: "var(--amber)",
                              marginTop: 16 }}>{built.reason}</div>
            ) : !drawn ? (
                <div style={{ marginTop: 16 }}>
                    <div style={{ font: "400 11.5px var(--font)", color: "var(--txt-2)" }}>
                        No laydown for this course of action.
                    </div>
                    <div style={{ font: "400 10.5px var(--font)", color: "var(--txt-3)",
                                  marginTop: 4 }}>
                        {scenario.coa
                            ? `“${COA_META[scenario.coa]?.label || scenario.coa}” is not `
                              + `possible in this theatre. `
                            : "This scenario has no course of action set. "}
                        {safeArray(built.excluded).slice(0, 3)
                            .map((e) => `${e.kind}: ${e.reason}`).join("; ")}
                    </div>
                </div>
            ) : (
                <>
                    <div style={{ display: "flex", gap: 8, alignItems: "center",
                                  margin: "12px 0 6px" }}>
                        <button className="fcmap-btn"
                                onClick={() => { setT(0); setPlaying(true) }}>
                            {playing ? "playing…" : "replay"}
                        </button>
                        {phase ? (
                            <span style={{ font: "600 11px var(--font)",
                                           color: "var(--txt-2)" }}>{phase.label}</span>
                        ) : null}
                        <span style={{ flex: 1 }} />
                        <span style={{ font: "400 10.5px var(--mono)",
                                       color: "var(--txt-4)" }}>
                            {drawn.units.length} formations
                        </span>
                    </div>

                    <Geographic tpl={tpl} t={t} country={scenario.target}
                                bboxOverride={drawn.bbox} aggressorForce={force} />

                    {meta ? (
                        <p style={{ font: "400 11px var(--font)", color: "var(--txt-2)",
                                    lineHeight: 1.5, marginTop: 8 }}>
                            <b>{meta.label}.</b> {meta.doctrine}
                        </p>
                    ) : null}

                    <div style={lab}>Objectives, ranked</div>
                    {drawn.objectives.map((o) => (
                        <div key={o.name} style={{ font: "400 11px var(--font)",
                                                   color: "var(--txt-2)" }}>
                            {o.name} <span style={{ color: "var(--txt-4)" }}>
                                — {o.kind.replace("_", " ")}, {Math.round(o.km)}km from the contact
                            </span>
                        </div>
                    ))}

                    {drawn.origins.length ? (
                        <>
                            <div style={lab}>Where it would come from</div>
                            {drawn.origins.map((o) => (
                                <div key={o.name} style={{ font: "400 11px var(--font)",
                                                           color: "var(--txt-2)" }}>
                                    {o.name} <span style={{ color: "var(--txt-4)" }}>
                                        — {o.kind.replace("_", " ")}, {Math.round(o.km)}km back
                                    </span>
                                </div>
                            ))}
                        </>
                    ) : null}
                </>
            )}
        </div>
    )
}
