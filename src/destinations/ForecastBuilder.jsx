/**
 * ForecastBuilder.jsx — the analyst states the scenario; the data answers.
 *
 * WHAT THIS REPLACES. Six hard-coded theatres, chosen from a menu, which
 * meant every conflict was forced into one of four shapes and none of
 * them could be asked for. You name the pairing — Narva, by Russia — and
 * the console says how likely that pairing is at all, which courses of
 * action the ground and the order of battle actually permit, and why the
 * others are refused.
 *
 * THE PRIOR IS THE POINT. An interface that will animate anything must
 * say what the pairing is worth, or the picture is the same for Estonia
 * and for Burundi and the first one stops meaning anything.
 */
import { useEffect, useMemo, useState } from "react"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { assembleScenario } from "./forecastBuild.js"
import { pct } from "./forecastBars.js"

const HORIZON_M = 3

/** Countries offered as either side, from the outlines we actually hold. */
function useWorld() {
    const [world, setWorld] = useState(null)
    useEffect(() => {
        let dead = false
        fetch("/data/world-countries.json")
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (!dead && d) setWorld(d.features) })
            .catch(() => {})
        return () => { dead = true }
    }, [])
    return world
}

function useFields() {
    const [fields, setFields] = useState(null)
    useEffect(() => {
        let dead = false
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
            })
            .catch(() => { if (!dead) setFields([]) })
        return () => { dead = true }
    }, [])
    return fields
}

export default function ForecastBuilder({ onOpen }) {
    const world = useWorld()
    const fields = useFields()

    const [aggressor, setAggressor] = useState("Russia")
    const [target, setTarget] = useState("Estonia")
    const [placeQ, setPlaceQ] = useState("Narva")
    const [places, setPlaces] = useState([])
    const [objective, setObjective] = useState(null)
    const [caps, setCaps] = useState(undefined)      // undefined = not asked
    const [prior, setPrior] = useState(null)
    const [coa, setCoa] = useState(null)
    const [saved, setSaved] = useState([])
    const [busy, setBusy] = useState(false)

    const countries = useMemo(() => (world || [])
        .map((f) => f.properties?.n).filter(Boolean).sort(), [world])

    // Place lookup, local and instant.
    useEffect(() => {
        const q = placeQ.trim()
        if (q.length < 2) { setPlaces([]); return }
        let dead = false
        const id = setTimeout(() => {
            fetch(`${API_BASE}/api/forecast/places?q=${encodeURIComponent(q)}&limit=6`,
                  { credentials: "include" })
                .then((r) => (r.ok ? r.json() : null))
                .then((d) => { if (!dead) setPlaces(safeArray(d?.places)) })
                .catch(() => {})
        }, 180)
        return () => { dead = true; clearTimeout(id) }
    }, [placeQ])

    // What the aggressor fields. Unknown stays unknown.
    useEffect(() => {
        if (!aggressor) return
        let dead = false
        setCaps(undefined)
        fetch(`${API_BASE}/api/forecast/capabilities?force=${encodeURIComponent(aggressor + " Armed Forces")}`,
              { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (!dead) setCaps(d?.known ? safeArray(d.capabilities) : null) })
            .catch(() => { if (!dead) setCaps(null) })
        return () => { dead = true }
    }, [aggressor])

    const built = useMemo(() => {
        if (!world || !fields) return null
        return assembleScenario({
            world, fields, target, aggressor, objective,
            capabilities: caps === undefined ? null : caps, prior, coa,
        })
    }, [world, fields, target, aggressor, objective, caps, prior, coa])

    // The prior, once we know whether they touch.
    //
    // CLEARED THE MOMENT THE PAIRING CHANGES. Without this the previous
    // pairing's number stays on screen while the next one is in flight,
    // and Burundi rendered Estonia's 0.4% under Burundi's name — a wrong
    // number, attributed, which is worse than no number.
    useEffect(() => { setPrior(null) }, [aggressor, target])

    useEffect(() => {
        if (!built?.ok) return
        let dead = false
        const q = new URLSearchParams({
            a: aggressor, b: target, contiguous: String(built.contiguous),
            months: String(HORIZON_M),
        })
        fetch(`${API_BASE}/api/forecast/dyad-risk?${q}`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (!dead && d && !d.error) setPrior(d) })
            .catch(() => {})
        return () => { dead = true }
    }, [aggressor, target, built?.contiguous])

    const loadSaved = () => {
        fetch(`${API_BASE}/api/forecast/scenarios`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => setSaved(safeArray(d?.scenarios)))
            .catch(() => {})
    }
    useEffect(loadSaved, [])

    const save = () => {
        setBusy(true)
        fetch(`${API_BASE}/api/forecast/scenarios`, {
            method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: `${objective?.name || target} — ${coa || "unspecified"}`,
                target, aggressor, coa,
                target_place: objective?.name || null,
                target_lat: objective?.lat ?? null, target_lon: objective?.lon ?? null,
            }),
        }).then((r) => r.json()).then(loadSaved).finally(() => setBusy(false))
    }

    const lab = { font: "600 10px var(--font)", letterSpacing: ".07em",
                  textTransform: "uppercase", color: "var(--txt-3)", marginBottom: 4 }
    const row = { marginBottom: 12 }

    return (
        <div style={{ padding: "0 14px 18px" }}>
            <div style={row}>
                <div style={lab}>Aggressor</div>
                <select className="input" value={aggressor} style={{ width: "100%" }}
                        onChange={(e) => { setAggressor(e.target.value); setCoa(null) }}>
                    {countries.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
            </div>

            <div style={row}>
                <div style={lab}>Target country</div>
                <select className="input" value={target} style={{ width: "100%" }}
                        onChange={(e) => { setTarget(e.target.value); setCoa(null)
                                           setObjective(null) }}>
                    {countries.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
            </div>

            <div style={row}>
                <div style={lab}>Objective (optional)</div>
                <input className="input" value={placeQ} placeholder="a city, e.g. Narva"
                       style={{ width: "100%" }}
                       onChange={(e) => setPlaceQ(e.target.value)} />
                {objective ? (
                    <div style={{ font: "400 11px var(--font)", color: "var(--txt-2)",
                                  marginTop: 4 }}>
                        {objective.name} · {objective.lat.toFixed(2)}, {objective.lon.toFixed(2)}
                        {" "}<button className="btn sm" onClick={() => setObjective(null)}>clear</button>
                    </div>
                ) : places.slice(0, 5).map((p) => (
                    <button key={`${p.name}${p.country_code}`} className="btn sm"
                            style={{ marginTop: 4, marginRight: 4 }}
                            onClick={() => { setObjective(p); setCoa(null) }}>
                        {p.name} ({p.country_code})
                    </button>
                ))}
            </div>

            {/* THE PRIOR. Stated before any picture, because it is what
                decides whether the picture is worth looking at. */}
            {prior ? (
                <div style={{ border: "1px solid var(--line)", background: "var(--bg-1)",
                              padding: "9px 11px", marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                        <span style={{ font: "600 17px var(--mono)", color: "var(--txt)" }}>
                            {pct(prior.p)}
                        </span>
                        <span style={{ font: "400 10.5px var(--font)", color: "var(--txt-3)" }}>
                            chance of interstate fighting in this pairing, next {HORIZON_M} months
                        </span>
                    </div>
                    {safeArray(prior.why).map((w, i) => (
                        <div key={i} style={{ font: "400 10.5px var(--font)",
                                              color: "var(--txt-3)", marginTop: 3 }}>{w}</div>
                    ))}
                </div>
            ) : null}

            {built && !built.ok ? (
                <div style={{ font: "400 11px var(--font)", color: "var(--amber)" }}>
                    {built.reason}
                </div>
            ) : null}

            {built?.ok ? (
                <>
                    <div style={lab}>Courses of action this theatre allows</div>
                    {built.available.length ? built.available.map((c) => (
                        <button key={c.kind}
                                className={`btn sm${coa === c.kind ? " primary" : ""}`}
                                style={{ display: "block", width: "100%", textAlign: "left",
                                         marginBottom: 4 }}
                                onClick={() => setCoa(c.kind)}>
                            {c.label}
                            {c.uncertain?.length ? (
                                <em style={{ display: "block", fontStyle: "normal",
                                             font: "400 10px var(--font)",
                                             color: "var(--amber)" }}>
                                    unverified: {c.uncertain.join("; ")}
                                </em>
                            ) : null}
                        </button>
                    )) : (
                        <div style={{ font: "400 11px var(--font)", color: "var(--txt-3)" }}>
                            None. On this geography and this order of battle there is no
                            course of action to draw.
                        </div>
                    )}

                    {built.excluded.length ? (
                        <details style={{ marginTop: 8 }}>
                            <summary style={{ font: "400 10.5px var(--font)",
                                              color: "var(--txt-4)", cursor: "pointer" }}>
                                {built.excluded.length} ruled out
                            </summary>
                            {built.excluded.map((e) => (
                                <div key={e.kind} style={{ font: "400 10.5px var(--font)",
                                                           color: "var(--txt-3)", marginTop: 3 }}>
                                    <b>{e.kind}</b> — {e.reason}
                                </div>
                            ))}
                        </details>
                    ) : null}

                    <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
                        <button className="btn sm primary" disabled={!coa || busy}
                                onClick={save}>save scenario</button>
                        {coa && onOpen ? (
                            <button className="btn sm"
                                    onClick={() => onOpen({
                                        id: "draft", name: `${objective?.name || target} — ${coa}`,
                                        target, aggressor, coa,
                                        target_place: objective?.name || null,
                                        target_lat: objective?.lat ?? null,
                                        target_lon: objective?.lon ?? null,
                                    })}>
                                animate
                            </button>
                        ) : null}
                    </div>
                </>
            ) : null}

            {saved.length ? (
                <div style={{ marginTop: 16 }}>
                    <div style={lab}>Saved</div>
                    {saved.slice(0, 8).map((s) => (
                        <div key={s.id} style={{ display: "flex", gap: 6, alignItems: "center",
                                                 marginBottom: 3 }}>
                            <button className="btn sm" style={{ flex: 1, textAlign: "left" }}
                                    onClick={() => (onOpen ? onOpen(s) : null)}>
                                {s.name}
                            </button>
                            <button className="btn sm"
                                    onClick={() => fetch(
                                        `${API_BASE}/api/forecast/scenarios/${s.id}`,
                                        { method: "DELETE", credentials: "include" })
                                        .then(loadSaved)}>×</button>
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    )
}
