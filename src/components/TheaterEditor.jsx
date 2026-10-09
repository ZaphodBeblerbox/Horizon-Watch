/**
 * TheaterEditor.jsx — making and changing a theater.
 *
 * A theater is three decisions: what it is called, where it looks, and
 * what is switched on there. The editor asks exactly those three.
 *
 * WHERE IT LOOKS IS TAKEN FROM THE MAP, not typed. Nobody knows the
 * latitude of the Bab el-Mandeb or what height shows the whole strait;
 * everybody can fly there and press a button. The numbers are shown and
 * editable underneath for the case where somebody does have a coordinate.
 */
import { useEffect, useMemo, useState } from "react"
import { LAYER_GROUPS, SUB_LAYERS, DEFAULT_SUBS, CONTEXT_TOGGLES, GDELT_EVENT_TYPES, SEVERITY_FLOORS, TIME_WINDOWS } from "./layerRailConfig.js"
import { VESSEL_TYPES, AIRCRAFT_KINDS } from "../globe/trackFilters.js"
import API_BASE from "../apiBase.js"
import PlacePicker from "../search/PlacePicker.jsx"

const fmtHeight = (h) => (Number(h) >= 1000 ? `${Math.round(Number(h) / 1000).toLocaleString()} km up` : `${Math.round(Number(h))} m up`)

const SEVERITIES = [
    ["critical", "Critical"],
    ["elevated", "Elevated"],
    ["steady", "Steady"],
]

/* The same keys the map uses. Infra is listed here rather than imported
   from Situation.jsx because that module pulls the whole globe in with it,
   and this dialog only needs the names. */
const INFRA = [
    ["chokepoints", "Chokepoints"],
    ["ports", "Ports & terminals"],
    ["airfields", "Airports & airfields"],
    ["cables", "Submarine cables"],
    ["power", "Power grid"],
    ["nautical", "Nautical chart"],
    ["facMilitary", "Military sites"],
    ["facMedical", "Hospitals & clinics"],
    ["facSecurity", "Police & fire"],
]
const TRACKS = [["vessels", "Vessels"], ["aircraft", "Aircraft"], ["sanctionedOnly", "Sanctioned/watchlisted only"]]

const BTN = {
    height: 28, padding: "0 12px", border: "1px solid var(--gline2)",
    background: "transparent", color: "var(--txt-2)",
    font: "400 12px var(--font)", cursor: "pointer", borderRadius: 0,
}
const PRIMARY = {
    ...BTN, border: "1px solid var(--acc-line)", background: "var(--acc-dim)",
    color: "var(--txt)", fontWeight: 600,
}
const DANGER = { ...BTN, color: "var(--red)", borderColor: "rgba(196,69,60,.45)" }
const EYE = {
    font: "500 10px var(--mono)", letterSpacing: ".14em",
    textTransform: "uppercase", color: "var(--txt-3)",
}
const INPUT = {
    width: "100%", height: 30, padding: "0 9px", background: "var(--glass2)",
    border: "1px solid var(--gline)", color: "var(--txt)",
    font: "400 13px var(--font)", outline: "none", borderRadius: 0,
}

function Pill({ on, children, onClick }) {
    return (
        <button type="button" onClick={onClick} style={{
            height: 24, padding: "0 9px", cursor: "pointer", borderRadius: 0,
            border: `1px solid ${on ? "var(--acc-line)" : "var(--gline)"}`,
            background: on ? "var(--acc-dim)" : "transparent",
            color: on ? "var(--txt)" : "var(--txt-3)",
            font: "400 11.5px var(--font)", whiteSpace: "nowrap",
        }}>{children}</button>
    )
}

/**
 * @param theater   the one being edited, or null to make a new one
 * @param readView  () => ({lat, lon, height}) for where the map is now
 */
/* layersOnly: the Global theater — always the whole world, no name to give;
   only what it switches on is the user's to choose. */
/* A list choice where null means "no filter": every pill lit. The first
   click narrows to everything but the one clicked. */
const flip = (list, key, all) => {
    const cur = list == null ? all : list
    const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]
    return next.length === all.length ? null : next
}
const lit = (list, key) => list == null || list.includes(key)

export default function TheaterEditor({ theater = null, readView = null, readLayers = null, onSave, onDelete, onClose, canDelete = true, layersOnly = false }) {
    const [name, setName] = useState(theater?.name || "")
    const [sev, setSev] = useState(theater?.sev || "steady")
    const [view, setView] = useState(theater?.view?.lat != null ? theater.view : null)
    const [placeName, setPlaceName] = useState(null)
    const [showCoords, setShowCoords] = useState(false)
    const [layers, setLayers] = useState(() => ({
        groups: theater?.layers?.groups || ["news"],
        infra: theater?.layers?.infra || [],
        tracks: theater?.layers?.tracks || [],
        context: theater?.layers?.context || [],
        // A theater from before sub-layers were saved gets the ones its
        // groups bring by default, so editing it does not switch them off.
        subs: theater?.layers?.subs || (theater?.layers?.groups || ["news"]).flatMap((g) => DEFAULT_SUBS[g] || []),
        gdeltTypes: theater?.layers?.gdeltTypes ?? null,
        theatres: theater?.layers?.theatres || [],
        severityFloor: theater?.layers?.severityFloor || null,
        timeWindow: theater?.layers?.timeWindow || null,
        vessel: theater?.layers?.vessel || { types: null, flags: null },
        aircraft: theater?.layers?.aircraft || { kinds: null, airlines: null, countries: null },
    }))
    // The frontline theatres the map can draw (same roster as its Layers panel).
    const [frontTheatres, setFrontTheatres] = useState([])
    useEffect(() => {
        fetch(`${API_BASE}/api/frontlines/theatres`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => setFrontTheatres(Array.isArray(d?.theatres) ? d.theatres.filter((t) => t.available) : []))
            .catch(() => {})
    }, [])
    const [took, setTook] = useState(false)
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState(null)

    useEffect(() => {
        const k = (e) => { if (e.key === "Escape") onClose() }
        window.addEventListener("keydown", k)
        return () => window.removeEventListener("keydown", k)
    }, [onClose])

    // A new theater starts wherever the map already is — which is almost
    // always the place somebody was looking at when they decided to make one.
    useEffect(() => {
        if (!theater && !view && readView) setView(readView())
    }, [theater, view, readView])

    const toggle = (key, value) => setLayers((p) => {
        const list = p[key] || []
        return { ...p, [key]: list.includes(value) ? list.filter((x) => x !== value) : [...list, value] }
    })

    // Choosing a group brings its usual sub-layers with it; a group with
    // nothing inside switched on would draw nothing.
    const toggleGroup = (g) => setLayers((p) => {
        if (p.groups.includes(g)) return { ...p, groups: p.groups.filter((x) => x !== g) }
        const inside = SUB_LAYERS.filter((l) => l.parent === g).map((l) => l.key)
        const subs = inside.some((k) => p.subs.includes(k)) ? p.subs : [...p.subs, ...(DEFAULT_SUBS[g] || [])]
        return { ...p, groups: [...p.groups, g], subs }
    })

    const count = useMemo(
        () => ["groups", "context", "infra", "tracks", "subs", "theatres"].reduce((a, k) => a + (layers[k]?.length || 0), 0), [layers])

    const save = async () => {
        setErr(null)
        if (!name.trim()) { setErr("A theater needs a name."); return }
        setBusy(true)
        try {
            await onSave({ name: name.trim(), sev, view, layers })
        } catch (e) {
            setErr(e.message || "That did not save")
        } finally { setBusy(false) }
    }

    return (
        <div onClick={onClose} style={{
            position: "fixed", inset: 0, zIndex: 9000, display: "grid", placeItems: "center",
            background: "rgba(10,14,31,.55)", padding: 20,
        }}>
            <div onClick={(e) => e.stopPropagation()} data-testid="theater-editor" style={{
                width: 520, maxWidth: "100%", maxHeight: "86vh", display: "flex", flexDirection: "column",
                background: "var(--glass)", backdropFilter: "blur(22px) saturate(1.15)",
                WebkitBackdropFilter: "blur(22px) saturate(1.15)",
                border: "1px solid var(--gline2)", boxShadow: "var(--gshadow)",
            }}>
                <div style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "13px 16px",
                    borderBottom: "1px solid var(--gline)",
                }}>
                    <b style={{ flex: 1, minWidth: 0, font: "600 13px var(--font)", color: "var(--txt)" }}>
                        {layersOnly ? "Global — what it shows" : theater ? "Edit theater" : "New theater"}
                    </b>
                    <button onClick={onClose} style={{ ...BTN, border: 0, flex: "none", padding: "0 6px" }}>✕</button>
                </div>

                <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 18 }}>
                    {!layersOnly && (<>
                    <div>
                        <div style={{ ...EYE, marginBottom: 5 }}>Name</div>
                        <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
                               placeholder="Bab el-Mandeb" maxLength={60} style={INPUT}
                               onKeyDown={(e) => { if (e.key === "Enter") save() }} />
                    </div>

                    <div>
                        <div style={{ ...EYE, marginBottom: 5 }}>Standing</div>
                        <div style={{ display: "flex", gap: 5 }}>
                            {SEVERITIES.map(([k, l]) => (
                                <Pill key={k} on={sev === k} onClick={() => setSev(k)}>{l}</Pill>
                            ))}
                        </div>
                    </div>

                    <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                            <span style={EYE}>Where it looks</span>
                            <div style={{ flex: 1 }} />
                            {readView && (
                                <button style={{ ...BTN, height: 22 }} onClick={() => { setView(readView()); setPlaceName("the current map view") }}>
                                    Use the current map view
                                </button>
                            )}
                        </div>
                        <PlacePicker label="Find the place this theater watches" onPick={(p) => {
                            setView({ lat: +Number(p.lat).toFixed(4), lon: +Number(p.lon).toFixed(4), height: Math.round(p.altitude || 600_000) })
                            setPlaceName(p.label)
                            if (!name.trim()) setName(p.label)
                            // Show it, so the choice is visibly right before saving.
                            window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: p.lat, lon: p.lon, altitude: p.altitude || 600_000 } }))
                        }} />
                        <div style={{ marginTop: 7, font: "400 12px/1.6 var(--font)", color: "var(--txt-3)" }}>
                            {view ? (
                                <>
                                    Looks at <b style={{ color: "var(--txt)", fontWeight: 600 }}>{placeName || "the view you set"}</b>
                                    {" "}· {fmtHeight(view.height)}{" "}
                                    <button type="button" onClick={() => setShowCoords((v) => !v)}
                                            style={{ border: 0, background: "none", color: "var(--acc-hi, var(--acchi))", cursor: "pointer", font: "inherit", padding: 0 }}>
                                        {showCoords ? "hide coordinates" : "coordinates"}
                                    </button>
                                </>
                            ) : "Not set — selecting this theater will leave the map where it is."}
                        </div>
                        {view && showCoords && (
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 6 }}>
                                {[["lat", "Latitude"], ["lon", "Longitude"], ["height", "Height (m)"]].map(([k, l]) => (
                                    <label key={k} style={{ display: "block" }}>
                                        <span style={{ font: "400 10.5px var(--font)", color: "var(--txt-3)" }}>{l}</span>
                                        <input
                                            value={view[k] ?? ""} inputMode="decimal"
                                            onChange={(e) => setView((p) => ({ ...p, [k]: e.target.value }))}
                                            onBlur={(e) => {
                                                const n = Number(e.target.value)
                                                setView((p) => ({ ...p, [k]: Number.isFinite(n) ? n : 0 }))
                                            }}
                                            style={{ ...INPUT, height: 28, font: "400 12px var(--mono)" }}
                                        />
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>
                    </>)}

                    <div>
                        <div style={{ ...EYE, marginBottom: 5 }}>
                            What is on here · {count} layer{count === 1 ? "" : "s"}
                        </div>
                        <p style={{ margin: "0 0 9px", font: "400 11.5px/1.6 var(--font)", color: "var(--txt-3)" }}>
                            Selecting the theater turns these on and everything else off, so switching is a
                            change of subject rather than an accumulation.
                        </p>
                        {readLayers && (
                            <button type="button" style={{ ...BTN, height: 26, marginBottom: 6 }}
                                    title="Copy every switch, filter and choice from the map's Layers panel as it is now"
                                    onClick={() => { const L = readLayers(); if (L) { setLayers((p) => ({ ...p, ...L })); setTook(true) } }}>
                                Take everything from the map as it is now
                            </button>
                        )}
                        {took && (
                            <div style={{ font: "400 11px var(--font)", color: "var(--txt-3)", marginBottom: 6 }}>
                                Copied from the map, including its track filters by flag, airline and country.
                            </div>
                        )}

                        <div style={{ ...EYE, fontSize: 9.5, margin: "8px 0 4px" }}>Domains</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {LAYER_GROUPS.map((g) => {
                                const on = layers.groups.includes(g.key)
                                const inside = SUB_LAYERS.filter((l) => l.parent === g.key)
                                return (
                                    <div key={g.key} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
                                        <Pill on={on} onClick={() => toggleGroup(g.key)}>{g.label || g.key}</Pill>
                                        {on && inside.length > 0 && <span style={{ color: "var(--txt-4)", font: "400 11px var(--font)", padding: "0 2px" }}>›</span>}
                                        {on && inside.map((l) => (
                                            <Pill key={l.key} on={layers.subs.includes(l.key)}
                                                  onClick={() => toggle("subs", l.key)}>{l.label}</Pill>
                                        ))}
                                    </div>
                                )
                            })}
                        </div>

                        <div style={{ ...EYE, fontSize: 9.5, margin: "12px 0 4px" }}>Context</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {CONTEXT_TOGGLES.map((t) => (
                                <Pill key={t.key} on={layers.context.includes(t.key)}
                                      onClick={() => toggle("context", t.key)}>{t.label}</Pill>
                            ))}
                            {SUB_LAYERS.filter((l) => !l.parent).map((l) => (
                                <Pill key={l.key} on={layers.subs.includes(l.key)}
                                      onClick={() => toggle("subs", l.key)}>{l.label}</Pill>
                            ))}
                        </div>

                        <div style={{ ...EYE, fontSize: 9.5, margin: "12px 0 4px" }}>Infrastructure</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {INFRA.map(([k, l]) => (
                                <Pill key={k} on={layers.infra.includes(k)}
                                      onClick={() => toggle("infra", k)}>{l}</Pill>
                            ))}
                        </div>

                        <div style={{ ...EYE, fontSize: 9.5, margin: "12px 0 4px" }}>Live tracks</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {TRACKS.map(([k, l]) => (
                                <Pill key={k} on={layers.tracks.includes(k)}
                                      onClick={() => toggle("tracks", k)}>{l}</Pill>
                            ))}
                        </div>
                        {layers.tracks.includes("vessels") && (
                            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, marginTop: 6 }}>
                                <span style={{ font: "400 11px var(--font)", color: "var(--txt-3)", width: 62 }}>Vessels</span>
                                {VESSEL_TYPES.map(([k, l]) => (
                                    <Pill key={k} on={lit(layers.vessel.types, k)}
                                          onClick={() => setLayers((p) => ({ ...p, vessel: { ...p.vessel, types: flip(p.vessel.types, k, VESSEL_TYPES.map(([x]) => x)) } }))}>{l}</Pill>
                                ))}
                            </div>
                        )}
                        {layers.tracks.includes("aircraft") && (
                            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, marginTop: 6 }}>
                                <span style={{ font: "400 11px var(--font)", color: "var(--txt-3)", width: 62 }}>Aircraft</span>
                                {AIRCRAFT_KINDS.map(([k, l]) => (
                                    <Pill key={k} on={lit(layers.aircraft.kinds, k)}
                                          onClick={() => setLayers((p) => ({ ...p, aircraft: { ...p.aircraft, kinds: flip(p.aircraft.kinds, k, AIRCRAFT_KINDS.map(([x]) => x)) } }))}>{l}</Pill>
                                ))}
                            </div>
                        )}
                        {(layers.vessel.flags || layers.aircraft.airlines || layers.aircraft.countries) && (
                            <div style={{ font: "400 11px/1.5 var(--font)", color: "var(--txt-3)", marginTop: 6 }}>
                                Also filtered by {[layers.vessel.flags && `${layers.vessel.flags.length} flag${layers.vessel.flags.length === 1 ? "" : "s"}`,
                                    layers.aircraft.airlines && `${layers.aircraft.airlines.length} airline${layers.aircraft.airlines.length === 1 ? "" : "s"}`,
                                    layers.aircraft.countries && `${layers.aircraft.countries.length} airline countr${layers.aircraft.countries.length === 1 ? "y" : "ies"}`]
                                    .filter(Boolean).join(", ")}{" "}
                                <button type="button" style={{ border: 0, background: "none", color: "var(--acc-hi, var(--acchi))", cursor: "pointer", font: "inherit", padding: 0 }}
                                        onClick={() => setLayers((p) => ({ ...p, vessel: { ...p.vessel, flags: null }, aircraft: { ...p.aircraft, airlines: null, countries: null } }))}>
                                    clear
                                </button>
                            </div>
                        )}

                        {layers.groups.includes("news") && layers.subs.includes("gdelt") && (<>
                            <div style={{ ...EYE, fontSize: 9.5, margin: "12px 0 4px" }}>Wire report kinds</div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                {GDELT_EVENT_TYPES.map((t) => (
                                    <Pill key={t.key} on={lit(layers.gdeltTypes, t.key)}
                                          onClick={() => setLayers((p) => ({ ...p, gdeltTypes: flip(p.gdeltTypes, t.key, GDELT_EVENT_TYPES.map((x) => x.key)) }))}>{t.label}</Pill>
                                ))}
                            </div>
                        </>)}

                        {layers.context.includes("frontlines") && frontTheatres.length > 0 && (<>
                            <div style={{ ...EYE, fontSize: 9.5, margin: "12px 0 4px" }}>Frontlines drawn</div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                {frontTheatres.map((t) => (
                                    <Pill key={t.key} on={layers.theatres.includes(t.key)}
                                          onClick={() => toggle("theatres", t.key)}>{t.label || t.name || t.key}</Pill>
                                ))}
                            </div>
                        </>)}

                        <div style={{ ...EYE, fontSize: 9.5, margin: "12px 0 4px" }}>Severity floor</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            <Pill on={!layers.severityFloor} onClick={() => setLayers((p) => ({ ...p, severityFloor: null }))}>Leave as is</Pill>
                            {SEVERITY_FLOORS.map((f) => (
                                <Pill key={f.key} on={layers.severityFloor === f.key}
                                      onClick={() => setLayers((p) => ({ ...p, severityFloor: f.key }))}>{f.label}</Pill>
                            ))}
                        </div>

                        <div style={{ ...EYE, fontSize: 9.5, margin: "12px 0 4px" }}>Time window</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            <Pill on={!layers.timeWindow} onClick={() => setLayers((p) => ({ ...p, timeWindow: null }))}>Leave as is</Pill>
                            {TIME_WINDOWS.map((w) => (
                                <Pill key={w.key} on={layers.timeWindow === w.key}
                                      onClick={() => setLayers((p) => ({ ...p, timeWindow: w.key }))}>{w.label}</Pill>
                            ))}
                        </div>
                    </div>

                    {err && (
                        <div role="alert" style={{
                            font: "400 12px/1.6 var(--font)", color: "var(--red)",
                            border: "1px solid rgba(196,69,60,.4)", padding: "8px 11px",
                        }}>{err}</div>
                    )}
                </div>

                <div style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "11px 16px",
                    borderTop: "1px solid var(--gline)",
                }}>
                    {theater && canDelete && (
                        <button style={{ ...DANGER, flex: "none" }} disabled={busy}
                                onClick={() => {
                                    if (confirm(`Delete “${theater.name}”? Anything you filed while watching it stays where it is.`)) onDelete(theater)
                                }}>Delete</button>
                    )}
                    <div style={{ flex: 1 }} />
                    <button style={{ ...BTN, flex: "none" }} onClick={onClose}>Cancel</button>
                    <button style={{ ...PRIMARY, flex: "none" }} disabled={busy} onClick={save}>
                        {busy ? "Saving…" : theater ? "Save" : "Create theater"}
                    </button>
                </div>
            </div>
        </div>
    )
}
