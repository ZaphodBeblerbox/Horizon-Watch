/**
 * ForecastTemplate.jsx — the doctrinal template, drawn and played.
 *
 * READ THIS BEFORE CHANGING ANYTHING HERE (spec F8). This component
 * draws an animation of military units moving. It is the one object in
 * the console most likely to be mistaken for intelligence, because it
 * looks exactly like the product an intelligence system would emit. It
 * is not. It is a doctrine, drawn.
 *
 * Four things are therefore not negotiable, and each has a test:
 *
 *   1. The stamp is on EVERY frame of BOTH faces, and cannot be
 *      dismissed. Not a tooltip, not a first-run notice.
 *   2. The doctrine is NAMED, so the reader can disagree with the
 *      doctrine rather than with the picture.
 *   3. t = 0 draws on SELECTION, not on play. A bordered box containing
 *      only a warning label is a quarter-pane of dead space, and dead
 *      space is where a reader stops reading warnings.
 *   4. Playback runs on requestAnimationFrame against a WALL CLOCK.
 *      setInterval drifts under load and, worse, keeps firing in a
 *      backgrounded tab, so the "6 second" run silently becomes
 *      something else and two readers see different speeds.
 *
 * And one prohibition: templated units are never rendered as Cesium
 * entities on the live globe. That is the single place they would be
 * indistinguishable from tracks.
 */
import { useEffect, useRef, useState } from "react"
import API_BASE from "../apiBase.js"
import { num } from "../utils/strictNumber.js"
import {
    FRAME, SIZE, TPL, RUN_MS, isMoving, positionAt, chevron, elapsedLabel,
} from "./forecastTemplate.js"
import {
    matchCountry, bboxOf, viewFor, project, pathFor,
} from "./forecastTerrain.js"
import {
    frameFor, iconFor, tintFor, fillFor, SIZE as ECHELON,
    INSTALLATION_TAB, facilityIcon, strengthOf, equipmentFor,
} from "./forecastSymbols.js"
import { unproject } from "./forecastTerrain.js"
import { checkUnit } from "./forecastFeasibility.js"
import { phaseAt } from "./forecastTemplate.js"
import Loading from "../ui/Loading.jsx"

const W = 560, H = 240

/**
 * The stamp. Rendered inside the SVG rather than over it, so it cannot
 * be separated from the picture by a screenshot, a print stylesheet or
 * a stacking-context bug.
 */
function Stamp() {
    return (
        <g aria-hidden="false">
            <rect x={W - 300} y={8} width={292} height={22} rx={3}
                  fill="rgba(255,159,10,0.12)" stroke="#FF9F0A" strokeWidth="1" />
            {/* textLength PINS the width instead of trusting font
                metrics. Hand-tuned sizing clipped this to "...NOT AN
                OBSERVED MOVEM" on the first machine it was drawn on, and
                a truncated warning is the exact failure this component
                exists to prevent. The glyphs compress; the sentence
                always arrives whole, on any font stack. */}
            <text x={W - 294} y={23} fill="#FF9F0A" fontSize="10"
                  fontWeight="700" textLength={280}
                  lengthAdjust="spacingAndGlyphs">
                DOCTRINAL TEMPLATE · NOT AN OBSERVED MOVEMENT
            </text>
        </g>
    )
}

/**
 * One APP-6 symbol: frame, function glyph, echelon tick, designator.
 *
 * The frame carries BOTH affiliation and battle dimension, so an air
 * formation is visibly not a ground one — its frame arches over the top
 * and is open at the base. Drawing everything in a land frame, which is
 * what this did first, says every movement is a march.
 */
function Unit({ u, t, zoom = 1, onSelect = null, selected = false }) {
    const { x, y } = positionAt(u, t)
    const tint = tintFor(u)
    const frame = frameFor(u)
    const icon = iconFor(u)
    // The symbol is counter-scaled against the map's zoom. A military
    // symbol is a glyph, not a footprint: it marks a position and says
    // nothing about how much ground the formation covers, so growing it
    // with the zoom would invent an area claim and, at 8x, bury the
    // terrain it exists to be checked against.
    return (
        <g transform={`translate(${x},${y}) scale(${1 / zoom})`}
           onClick={onSelect ? (e) => { e.stopPropagation(); onSelect(u) } : undefined}
           style={onSelect ? { cursor: "pointer" } : undefined}>
            {/* A hit target larger than the glyph. A 26px diamond is a
                hard thing to hit on a map you are also dragging. */}
            {onSelect ? <circle r="17" fill="transparent" /> : null}
            {selected ? (
                <circle r="19" fill="none" stroke={tintFor(u)} strokeWidth="1"
                        strokeDasharray="2 2" opacity="0.9" />
            ) : null}
            {/* APP-6 pairs a light fill with a saturated frame: the fill
                carries at a glance over dark or light ground, the frame
                keeps the edge. An air frame is open, so it is not filled. */}
            <path d={frame.d}
                  fill={frame.closed ? fillFor(u) : "none"}
                  fillOpacity={frame.closed ? 0.22 : 0}
                  stroke={tint} strokeWidth="1.6" strokeLinejoin="round" />
            {icon ? (
                <path d={icon} fill={u.icon === "artillery" ? tint : "none"}
                      stroke={tint} strokeWidth="1.2" opacity="0.95" />
            ) : null}
            <text x={0} y={-16} textAnchor="middle" fill={tint}
                  fontSize="9" fontWeight="700">{ECHELON[u.size] || ""}</text>
            <text x={0} y={19} textAnchor="middle" fill={tint}
                  fontSize="8.5" fontWeight="600" opacity="0.85">{u.id}</text>
        </g>
    )
}

/**
 * What the reader clicked.
 *
 * A symbol is a compressed sentence and most readers cannot decompress
 * it. This says the same thing in words — what the formation is, roughly
 * how many people that echelon means, and what that army actually fields
 * for that arm — so the map is readable by someone who does not speak
 * APP-6.
 *
 * The strength is a RANGE and the equipment is what Wikipedia lists for
 * that force, named as such. Neither is a claim about this formation:
 * there is no such formation. It is what one would be.
 */
function UnitDetail({ u, items, force, onClose }) {
    const kit = equipmentFor(u, items)
    const strength = strengthOf(u.size)
    return (
        <div style={{ marginTop: 8, padding: "9px 11px", background: "var(--bg-1)",
                      border: "1px solid var(--line)" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <b style={{ font: "600 12px var(--font)", color: "var(--txt)" }}>
                    {u.id} · {u.domain}
                </b>
                <span style={{ flex: 1 }} />
                <button className="fcmap-btn" onClick={onClose}>close</button>
            </div>
            {u.what ? (
                <div style={{ font: "400 11px var(--font)", color: "var(--txt-2)",
                              marginTop: 4, lineHeight: 1.45 }}>{u.what}</div>
            ) : null}
            <div style={{ font: "400 10.5px var(--font)", color: "var(--txt-3)",
                          marginTop: 5 }}>
                {strength ? <>Typically <b>{strength}</b> personnel at this echelon. </> : null}
                {u.icon && u.icon !== "none" ? <>Arm: {u.icon}.</> : null}
            </div>
            {kit.length ? (
                <div style={{ marginTop: 6 }}>
                    <div style={{ font: "600 9.5px var(--font)", letterSpacing: ".06em",
                                  textTransform: "uppercase", color: "var(--txt-4)" }}>
                        What {force || "this force"} fields for this arm
                    </div>
                    <div style={{ font: "400 10.5px var(--font)", color: "var(--txt-2)",
                                  marginTop: 2, lineHeight: 1.5 }}>
                        {kit.join(" · ")}
                    </div>
                    <div style={{ font: "400 9.5px var(--font)", color: "var(--txt-4)",
                                  marginTop: 3 }}>
                        From this force's published equipment list — what the army
                        has, not what this formation carries.
                    </div>
                </div>
            ) : (
                <div style={{ font: "400 10px var(--font)", color: "var(--txt-4)",
                              marginTop: 6 }}>
                    No published equipment list for this arm.
                </div>
            )}
        </div>
    )
}

/**
 * A facility as an APP-6 INSTALLATION: the affiliation frame plus a small
 * filled tab on its top edge. That tab separates a PLACE from a
 * FORMATION; without it an airfield is drawn as though a unit were
 * standing on it.
 *
 * Drawn only in forecast, and only while a scenario is on the map. An
 * APP-6 frame asserts an affiliation, and an airport is not a belligerent
 * outside a scenario — coding every airfield on the live globe that way
 * would be a claim nobody made.
 */
function Facility({ f, x, y, zoom = 1 }) {
    const u = { aff: f.aff || "neutral", domain: "ground" }
    const frame = frameFor(u)
    const tint = tintFor(u)
    return (
        <g className="fc-facility"
           transform={`translate(${x},${y}) scale(${0.58 / zoom})`}>
            <path d={frame.d} fill={fillFor(u)} fillOpacity="0.2"
                  stroke={tint} strokeWidth="2" strokeLinejoin="round" />
            <path d={INSTALLATION_TAB} fill={tint} stroke="none" />
            {facilityIcon(f.kind) ? (
                <path d={facilityIcon(f.kind)} fill="none" stroke={tint}
                      strokeWidth="1.6" />
            ) : null}
        </g>
    )
}

/** The schematic face: relationships, without the terrain arguing. */
export function Schematic({ tpl, t }) {
    return (
        <svg viewBox={`0 0 ${W} ${H}`} width="100%"
             style={{ display: "block", background: "#0A0C10", borderRadius: 4 }}
             role="img"
             aria-label="Doctrinal template, schematic. Not an observed movement.">
            {/* The line the template is about — a border, a chokepoint,
                a terminal. Dashed, because it is a concept here and not
                a surveyed boundary. */}
            <path d={tpl.line} stroke="#3A3F4B" strokeWidth="1.4"
                  strokeDasharray="5 4" fill="none" />
            <text x={4} y={H - 8} fill="#6B7280" fontSize="9">{tpl.lineLabel}</text>

            {/* Axes first, so symbols sit on top of their own tracks. */}
            {tpl.units.filter(isMoving).map((u, i) => (
                <g key={`ax${i}`}>
                    <line x1={u.x} y1={u.y} x2={u.to[0]} y2={u.to[1]}
                          stroke={tintFor(u)} strokeWidth="1"
                          strokeDasharray="3 5" opacity="0.35" />
                    {chevron(u, t) ? (
                        <path d={chevron(u, t)} stroke={tintFor(u)}
                              strokeWidth="1.6" fill="none" opacity="0.9" />
                    ) : null}
                </g>
            ))}
            {tpl.units.map((u, i) => <Unit key={i} u={u} t={t} />)}
            <Stamp />
        </svg>
    )
}

/**
 * The geographic face: the same doctrine, over real ground.
 *
 * A schematic can be elegant and geographically impossible. Axes that
 * read beautifully as relationships may, on the ground, run into a sea
 * or across a border that is not where the diagram implies. This face
 * exists so the reader can see that, and it is drawn from the country
 * outlines the app already ships — no projection library, because
 * equirectangular is linear and "is this axis in the sea" is the only
 * question this face is asked.
 *
 * WHAT IT DOES NOT CLAIM, AND SAYS SO. The units are not at surveyed
 * positions. The template is generic doctrine; the board supplies a
 * country; the diagram is laid over that country at operational scale so
 * its geometry can be judged against real coastline. A reader who takes
 * these for locations has been misled, so the caption says it plainly
 * and the stamp is here too.
 */
export function Geographic({ tpl, t, country, big = false, onToggleBig,
                             aggressorForce = null, bboxOverride = null }) {
    const [world, setWorld] = useState(null)
    const [fields, setFields] = useState(null)
    const [failed, setFailed] = useState(false)
    // Pan and zoom are a TRANSFORM over the drawn box, never a refit of
    // the projection: refitting would move the units relative to the
    // ground, and their position relative to the ground is the only
    // thing on this face worth trusting.
    const [zoom, setZoom] = useState(1)
    const [pan, setPan] = useState({ x: 0, y: 0 })
    const [picked, setPicked] = useState(null)
    const [items, setItems] = useState(null)
    const drag = useRef(null)

    useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }); setPicked(null) }, [country, tpl])

    // What this force fields, so a clicked symbol can say more than its
    // own glyph. Absent is fine: the panel then says so.
    useEffect(() => {
        if (!aggressorForce) { setItems(null); return }
        let dead = false
        fetch(`${API_BASE}/api/forecast/capabilities?force=${encodeURIComponent(aggressorForce)}`,
              { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (!dead) setItems(d?.items || null) })
            .catch(() => { if (!dead) setItems(null) })
        return () => { dead = true }
    }, [aggressorForce])

    useEffect(() => {
        let dead = false
        fetch("/data/world-countries.json")
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (!dead) (d ? setWorld(d) : setFailed(true)) })
            .catch(() => { if (!dead) setFailed(true) })
        return () => { dead = true }
    }, [])

    // Real airfields, for the one check that decides whether an air axis
    // is a movement or an assertion. Failure is not fatal: the check
    // then reports "unknown" rather than passing everything.
    useEffect(() => {
        let dead = false
        fetch(`${API_BASE}/api/airports?limit=4000`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                if (dead) return
                // GeoJSON: coordinates are [lon, lat], in that order.
                // Reading them as [lat, lon] puts every airfield in the
                // wrong hemisphere and quietly fails every air check.
                const feats = d?.features || (Array.isArray(d) ? d : [])
                setFields(feats.map((f) => {
                    const c = f?.geometry?.coordinates || []
                    return {
                        name: f?.properties?.airport_name || f?.properties?.ident
                              || "airfield",
                        lon: num(c[0]), lat: num(c[1]),
                    }
                }).filter((a) => a.lat !== null && a.lon !== null))
            })
            .catch(() => { if (!dead) setFields([]) })
        return () => { dead = true }
    }, [])

    const feature = world ? matchCountry(country, world.features) : null
    // A generated scenario frames its OWN operational area — the contact,
    // the origins and the objectives — because fitting the whole country
    // draws formations that span a thousand kilometres.
    const view = bboxOverride
        ? viewFor(bboxOverride, { w: W, h: H })
        : (feature ? viewFor(bboxOf(feature.geometry), { w: W, h: H }) : null)

    // Every reason there might be no map is stated, never drawn around.
    const why = failed ? "The country outlines could not be loaded."
        : !world ? null
        : !country ? "This scenario is not attached to a country."
        // With an explicit frame the map can draw without matching the
        // subject country — the neighbours and the coast are still real.
        : (!feature && !bboxOverride) ? `No outline for ${country} in the country file.`
        : null

    // `world` is required, not merely usual: with an explicit frame a
    // view exists before the outlines have loaded, so the old guard let
    // the render through and the feasibility pass read .features off
    // null.
    if (why || !view || !world) {
        return (
            <div style={{ padding: "14px", background: "#0A0C10", borderRadius: 4,
                          border: "1px solid #1C1F26" }}>
                <svg viewBox={`0 0 ${W} 34`} width="100%" style={{ display: "block" }}>
                    <Stamp />
                </svg>
                <p style={{ color: "#9AA0AA", fontSize: 12, lineHeight: 1.55,
                            margin: "10px 0 0" }}>
                    {why || <Loading size={16} inline label="Loading country outlines" />}
                    {why ? " Without it you cannot check the schematic against real"
                         + " ground — the axes there are relationships, not routes,"
                         + " and nothing asserts the terrain permits them." : ""}
                </p>
            </div>
        )
    }

    // Neighbours first and faint, the subject country picked out: the
    // border that matters is the one the template is about.
    const others = (world?.features || []).filter((f) => f !== feature)

    // THE CHECK THE WHOLE FACE IS FOR. Each unit's schematic axis is
    // turned back into real coordinates and asked whether that movement
    // is physically possible: an air axis needs an airfield behind it, a
    // surface contact cannot drive inland, a ground axis cannot cross
    // open water. Ground trafficability comes back "unknown" and says
    // so — there is no road network loaded, and pretending otherwise
    // would be a lie about the hardest part of the question.
    const verdicts = (tpl?.units || []).map((u) => {
        const from = unproject(u.x, u.y, view)
        const to = unproject(u.to[0], u.to[1], view)
        return checkUnit(u, { from, to }, world.features, fields || [])
    })
    const impossible = verdicts.filter((v) => v.status === "impossible")

    const phase = phaseAt(tpl, t)
    const kmAcross = Math.round((view.maxLon - view.minLon) * 111 *
        Math.cos((view.cLat * Math.PI) / 180))

    // Facilities inside the frame, as APP-6 installations. Capped,
    // because 49,260 airfields projected into one pane is not a map, it
    // is a texture — and the ones that matter here are the larger fields
    // an air movement could actually originate from.
    const shownFacilities = (fields || [])
        .filter((f) => f.lon >= view.minLon && f.lon <= view.maxLon
                    && f.lat >= view.minLat && f.lat <= view.maxLat)
        .map((f) => {
            const xy = project(f.lon, f.lat, view)
            return xy ? { kind: "airfield", aff: "neutral", name: f.name,
                          px: xy[0], py: xy[1] } : null
        })
        .filter(Boolean)
        // Thinned by SCREEN distance, not count. Forty airfields inside
        // one frame overlap into clumps of glyphs that read as one large
        // unreadable object, which is worse than showing fewer.
        .reduce((keep, f) => {
            if (keep.every((k) => Math.hypot(k.px - f.px, k.py - f.py) > 26)) {
                keep.push(f)
            }
            return keep
        }, [])
        .slice(0, 18)

    return (
        <div>
            {/* The house locator minimap, reference_src A4.4: 196px,
                mm-land #242b31 on #12161a, so this reads as the same
                object as the Replay and Reader minimaps rather than a
                second, differently-coloured map in the same product.

                preserveAspectRatio is "meet" and must never be "slice":
                slice scales to fill and crops the overflow, and what it
                cropped was the stamp. The warning text stayed in the DOM
                the whole time, so a test that only looked for the string
                passed while it was invisible on screen. */}
            <div className="fcmap" style={{ height: big ? 520 : 240 }}>
                <div className="fcmap-bar">
                    {onToggleBig ? (
                        <button className="fcmap-btn" onClick={onToggleBig}>
                            {big ? "shrink" : "enlarge"}
                        </button>
                    ) : null}
                    <button className="fcmap-btn" title="zoom in"
                            onClick={() => setZoom((z) => Math.min(8, z * 1.5))}>+</button>
                    <button className="fcmap-btn" title="zoom out"
                            onClick={() => setZoom((z) => Math.max(1, z / 1.5))}>−</button>
                    <button className="fcmap-btn"
                            onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}>reset</button>
                </div>
                {phase ? <div className="fcmap-phase">{phase.label}</div> : null}
                <div className="fcmap-scale">{Math.round(kmAcross / zoom)} km across</div>

                <svg viewBox={`0 0 ${W} ${H}`} height="100%"
                     preserveAspectRatio="xMidYMid meet"
                     onWheel={(e) => setZoom((z) => Math.max(1, Math.min(8,
                         z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))))}
                     onPointerDown={(e) => {
                         // NO POINTER CAPTURE YET. Capturing here sends
                         // every later event to the svg, so the click
                         // never reaches the symbol under the cursor and
                         // units simply could not be selected. Capture
                         // starts when a DRAG does.
                         drag.current = { sx: e.clientX, sy: e.clientY,
                                          px: pan.x, py: pan.y, moved: false }
                     }}
                     onPointerMove={(e) => {
                         if (!drag.current) return
                         if (!drag.current.moved) {
                             const far = Math.hypot(e.clientX - drag.current.sx,
                                                    e.clientY - drag.current.sy) > 3
                             if (!far) return
                             drag.current.moved = true
                             e.currentTarget.setPointerCapture(e.pointerId)
                             e.currentTarget.classList.add("dragging")
                         }
                         // Screen pixels into viewBox units, so a drag
                         // tracks the pointer at any zoom or pane width.
                         const r = e.currentTarget.getBoundingClientRect()
                         const k = W / (r.width || W)
                         setPan({
                             x: drag.current.px + (e.clientX - drag.current.sx) * k,
                             y: drag.current.py + (e.clientY - drag.current.sy) * k,
                         })
                     }}
                     onPointerUp={(e) => {
                         if (drag.current?.moved) {
                             try { e.currentTarget.releasePointerCapture(e.pointerId) }
                             catch { /* already released */ }
                         }
                         drag.current = null
                         e.currentTarget.classList.remove("dragging")
                     }}
                     role="img"
                     aria-label={`Doctrinal template over ${country}. Not an observed movement.`}>
                    <rect x={0} y={0} width={W} height={H} className="fc-sea" />
                    <g transform={`translate(${pan.x},${pan.y}) `
                                + `translate(${W / 2},${H / 2}) scale(${zoom}) `
                                + `translate(${-W / 2},${-H / 2})`}>
                        {others.map((f, i) => {
                            const d = pathFor(f.geometry, view)
                            return d ? <path key={i} d={d} className="fc-neighbour" /> : null
                        })}
                        {feature ? (
                            <path d={pathFor(feature.geometry, view)} className="fc-subject" />
                        ) : null}

                        {/* Facilities: APP-6 installations, only here and
                            only while a scenario is on the map. Labelled,
                            because an unlabelled installation symbol tells
                            a reader there is something there and refuses
                            to say what. */}
                        {shownFacilities.map((f, i) => (
                            <g key={`f${i}`}>
                                <Facility f={f} x={f.px} y={f.py} zoom={zoom} />
                                {zoom > 1.6 ? (
                                    <text x={f.px} y={f.py + 13 / zoom}
                                          textAnchor="middle" className="fc-label"
                                          style={{ fontSize: 7.5 / zoom }}>
                                        {f.name}
                                    </text>
                                ) : null}
                            </g>
                        ))}

                        {tpl.units.map((u, i) => (!isMoving(u) ? null : (
                            <g key={`a${i}`}>
                                <line x1={u.x} y1={u.y}
                                      x2={(u.to || [u.x, u.y])[0]} y2={(u.to || [u.x, u.y])[1]}
                                      stroke={verdicts[i].status === "impossible"
                                          ? "#FF3030" : tintFor(u)}
                                      strokeWidth={verdicts[i].status === "impossible" ? 1.4 : 1}
                                      strokeDasharray={verdicts[i].status === "impossible"
                                          ? "1 3" : "3 5"}
                                      vectorEffect="non-scaling-stroke"
                                      opacity={verdicts[i].status === "impossible" ? 0.95 : 0.4} />
                                {chevron(u, t) ? (
                                    <path d={chevron(u, t)} stroke={tintFor(u)}
                                          strokeWidth="1.6" fill="none" opacity="0.9"
                                          vectorEffect="non-scaling-stroke" />
                                ) : null}
                            </g>
                        )))}
                        {tpl.units.map((u, i) => (
                            <Unit key={i} u={u} t={t} zoom={zoom}
                                  onSelect={setPicked}
                                  selected={picked?.id === u.id && picked?.icon === u.icon} />
                        ))}
                    </g>
                    <Stamp />
                </svg>
            </div>

            {picked ? (
                <UnitDetail u={picked} items={items} force={aggressorForce}
                            onClose={() => setPicked(null)} />
            ) : null}

            {/* Refusals are named, not just drawn red. A dotted line the
                reader has to interpret is not a finding. */}
            {impossible.length ? (
                <div style={{ margin: "8px 0 0", padding: "8px 10px",
                              border: "1px solid rgba(255,59,48,0.4)",
                              background: "rgba(255,59,48,0.07)" }}>
                    <div style={{ color: "#FF3B30", fontSize: 10.5, fontWeight: 700,
                                  letterSpacing: ".06em", marginBottom: 4 }}>
                        {impossible.length} MOVEMENT{impossible.length > 1 ? "S" : ""} NOT
                        POSSIBLE HERE
                    </div>
                    {verdicts.map((v, i) => (v.status !== "impossible" ? null : (
                        <div key={i} style={{ color: "#C8CDD6", fontSize: 11,
                                              lineHeight: 1.45 }}>
                            {tpl.units[i].id} ({tpl.units[i].domain}) — {v.reason}
                        </div>
                    )))}
                </div>
            ) : null}
            <p style={{ color: "#6B7280", fontSize: 11, lineHeight: 1.5,
                        margin: "8px 0 0" }}>
                Doctrine over real ground. Symbols are <b>not to scale and not
                surveyed positions</b> — the map is here so you can see whether the
                geometry is possible at all.
            </p>
        </div>
    )
}

/**
 * The key. APP-6 is a language, and a reader who does not speak it sees
 * coloured shapes moving — which is worse than no symbols at all,
 * because shapes moving with confidence look like knowledge.
 *
 * Collapsed by default so it does not compete with the map, and drawn
 * from the same FRAMES and ICONS the symbols use, so it cannot drift out
 * of step with what is actually on screen.
 */
function Legend({ units }) {
    const [open, setOpen] = useState(false)
    // Only what is actually on this template: a key to symbols that are
    // not present teaches the wrong things to look for.
    const doms = [...new Set(units.map((u) => u.domain))]
    const icons = [...new Set(units.map((u) => u.icon))].filter((i) => i && i !== "none")
    const affs = [...new Set(units.map((u) => u.aff))]
    const sizes = [...new Set(units.map((u) => u.size))]

    const cell = { display: "flex", alignItems: "center", gap: 6,
                   color: "#9AA0AA", fontSize: 10.5 }
    const swatch = (u, label) => (
        <div style={cell} key={label}>
            <svg width="34" height="28" viewBox="-17 -14 34 28">
                <g transform="scale(0.72)">
                    <path d={frameFor(u).d}
                          fill={frameFor(u).closed ? "rgba(10,12,16,0.85)" : "none"}
                          stroke={tintFor(u)} strokeWidth="2" strokeLinejoin="round" />
                    {iconFor(u) ? (
                        <path d={iconFor(u)} fill={u.icon === "artillery" ? tintFor(u) : "none"}
                              stroke={tintFor(u)} strokeWidth="1.6" />
                    ) : null}
                </g>
            </svg>
            <span>{label}</span>
        </div>
    )

    return (
        <div style={{ marginTop: 8 }}>
            <button onClick={() => setOpen(!open)}
                    style={{ background: "transparent", border: "1px solid #2A2F3A",
                             color: "#8A909B", borderRadius: 3, padding: "3px 9px",
                             fontSize: 10.5, cursor: "pointer" }}>
                {open ? "hide key" : "what do these symbols mean?"}
            </button>
            {!open ? null : (
                <div style={{ marginTop: 8, padding: "10px 12px", background: "#0A0C10",
                              border: "1px solid #1C1F26", borderRadius: 3,
                              display: "grid", gap: 10 }}>
                    <Row title="Affiliation — the frame's shape and colour">
                        {affs.map((a) => swatch(
                            { aff: a, domain: "ground", icon: "none" }, a))}
                    </Row>
                    <Row title="Dimension — an air frame is open at the base">
                        {doms.map((d) => swatch(
                            { aff: "unknown", domain: d, icon: "none" },
                            d === "sea" ? "sea (surface)" : d))}
                    </Row>
                    {icons.length ? (
                        <Row title="Arm — the glyph inside the frame">
                            {icons.map((ic) => swatch(
                                { aff: "unknown", domain: "ground", icon: ic }, ic))}
                        </Row>
                    ) : null}
                    <Row title="Echelon — the tick above the frame">
                        {sizes.map((sz) => (
                            <div style={cell} key={sz}>
                                <span style={{ width: 34, textAlign: "center",
                                               color: "#C8CDD6", fontWeight: 700,
                                               fontSize: 11 }}>{ECHELON[sz]}</span>
                                <span>{ECHELON_NAME[sz] || sz}</span>
                            </div>
                        ))}
                    </Row>
                    <p style={{ color: "#6B7280", fontSize: 10.5, lineHeight: 1.5,
                                margin: 0 }}>
                        A red dotted axis is a movement this ground will not permit.
                    </p>
                </div>
            )}
        </div>
    )
}

const ECHELON_NAME = {
    team: "team", squad: "squad", plt: "platoon", coy: "company",
    bn: "battalion", regt: "regiment", bde: "brigade", div: "division",
    corps: "corps",
}

function Row({ title, children }) {
    return (
        <div>
            <div style={{ color: "#6B7280", fontSize: 10, letterSpacing: ".06em",
                          textTransform: "uppercase", marginBottom: 5 }}>{title}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 18px" }}>
                {children}
            </div>
        </div>
    )
}

export default function ForecastTemplate({ templateKey, window: window_ = "",
                                           country = "", aggressorForce = null }) {
    const tpl = TPL[templateKey]
    const [face, setFace] = useState("terrain")
    const [big, setBig] = useState(false)
    const [t, setT] = useState(0)
    const [playing, setPlaying] = useState(false)
    const raf = useRef(0)

    // Rule 3 still holds: t = 0 is drawn the moment a template is
    // selected, so the frame is never empty. It then plays itself once,
    // because a movement nobody presses play on is a still picture, and
    // the whole claim of this panel is about motion over a window.
    useEffect(() => {
        setT(0)
        setPlaying(false)
        const id = setTimeout(() => setPlaying(true), 450)
        return () => clearTimeout(id)
    }, [templateKey])

    useEffect(() => {
        if (!playing) return
        // Rule 4: against a wall clock. performance.now() is monotonic,
        // so a stalled frame catches up rather than stretching the run,
        // and two readers see the same six seconds.
        const t0 = performance.now()
        const step = () => {
            const k = Math.min(1, (performance.now() - t0) / RUN_MS)
            setT(k)
            if (k < 1) raf.current = requestAnimationFrame(step)
            else setPlaying(false)
        }
        raf.current = requestAnimationFrame(step)

        // A10 trap 1: "animation frames are not guaranteed — in a
        // throttled or backgrounded frame the callback never runs."
        // rAF against a wall clock fixes DRIFT, which was F8's concern,
        // and does nothing about the frame never arriving at all: the
        // template then freezes at a partial t with the button stuck on
        // "playing…", which reads as a movement that stopped rather than
        // an animation that died.
        //
        // So rAF still drives it — it is the smooth, drift-free path and
        // F8 is right that setInterval is not — and a single stepped
        // timer guarantees the run terminates. It is a backstop, not the
        // clock: if rAF kept up, this fires after the run is already
        // finished and finds nothing to do.
        const backstop = setTimeout(() => {
            setT(1)
            setPlaying(false)
        }, RUN_MS + 900)

        return () => {
            cancelAnimationFrame(raf.current)
            clearTimeout(backstop)
        }
    }, [playing])

    if (!tpl) return null

    const btn = {
        background: "transparent", border: "1px solid #2A2F3A", color: "#C8CDD6",
        borderRadius: 3, padding: "4px 10px", fontSize: 11, cursor: "pointer",
    }
    const tab = (k) => ({
        ...btn,
        borderColor: face === k ? "#4A5160" : "#2A2F3A",
        color: face === k ? "#E6E9EF" : "#8A909B",
        background: face === k ? "#161A21" : "transparent",
    })

    return (
        <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center",
                          marginBottom: 8 }}>
                <button style={tab("schematic")}
                        onClick={() => setFace("schematic")}>schematic</button>
                <button style={tab("terrain")}
                        onClick={() => setFace("terrain")}>on the terrain</button>
                <span style={{ flex: 1 }} />
                <span style={{ color: "#6B7280", fontSize: 11,
                               fontVariantNumeric: "tabular-nums" }}>
                    {elapsedLabel(t, window_)}
                </span>
                <button style={btn} onClick={() => { setT(0); setPlaying(true) }}>
                    {playing ? "playing…" : "replay"}
                </button>
            </div>

            {face === "schematic"
                ? <Schematic tpl={tpl} t={t} />
                : <Geographic tpl={tpl} t={t} country={country}
                              big={big} onToggleBig={() => setBig((b) => !b)}
                              aggressorForce={aggressorForce} />}

            <Legend units={tpl.units} />

            {/* Rule 2: the doctrine, named, under the frame. */}
            <p style={{ color: "#8A909B", fontSize: 11, lineHeight: 1.55,
                        margin: "8px 0 0" }}>
                <strong style={{ color: "#C8CDD6" }}>Doctrine.</strong>{" "}
                {tpl.doctrine}
            </p>
            {/* The caveat, in words rather than in a badge, because a
                badge is skimmed and a sentence is read. */}
            <p style={{ color: "#FF9F0A", fontSize: 11, lineHeight: 1.55,
                        margin: "6px 0 0", opacity: 0.85 }}>
                Nothing here has been observed. It is what the doctrine would produce —
                compare it against what you actually see.</p>
        </div>
    )
}
