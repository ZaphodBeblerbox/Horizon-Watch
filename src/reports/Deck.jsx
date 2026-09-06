import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { getReportBundle } from "./reportApi.js"
import { buildDeckSlides } from "./buildDeckSlides.js"

// Deck.jsx — #view-deck. V3 Phase 2: the presentation deck, a third
// rendering of the one real document object (§6.1) — never a rail
// destination, reachable only from the reader toolbar, the print toolbar,
// or Generate's footer (see app.jsx's deckReportId slot, mirroring how
// printReportId already works). All real content comes from
// buildDeckSlides(bundle), which reads the exact same getReportBundle()
// Briefings.jsx/PrintLayout.jsx already use — no second drafting or
// data-shaping pass.

const SEV_COLOR = { critical: "#c4453c", high: "#c98a2c", moderate: "#3f6fa8", low: "#6b7280" }

// Real, fixed US-Letter-landscape page size at 96dpi (1056x816px — the
// same 792x612pt @72dpi confirmed live against this environment's actual
// default @page size). Used only for the always-in-DOM print flow.
const PRINT_PAGE_SCALE = Math.min(1056 / 1920, 816 / 1080)

// Room-scale type ramp (§10) — deliberately far larger than the console's
// own 12.5px body; these are NOT reused anywhere else in the app.
const TYPE = {
    h1: { fontSize: 104, fontWeight: 600, lineHeight: 1.05 },
    h2: { fontSize: 58, fontWeight: 600, lineHeight: 1.1 },
    h3: { fontSize: 36, fontWeight: 600, lineHeight: 1.15 },
    body: { fontSize: 34, fontWeight: 400, lineHeight: 1.5 },
    bigBody: { fontSize: 46, fontWeight: 400, lineHeight: 1.35 },
    quote: { fontSize: 52, fontWeight: 500, lineHeight: 1.25 },
    statistic: { fontSize: 76, fontWeight: 400, fontFamily: "var(--mono, monospace)" },
    table: { fontSize: 27, fontWeight: 400 },
    eyebrow: { fontSize: 22, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" },
    footer: { fontSize: 19, fontWeight: 400 },
}

// Real dark/light palettes, scoped entirely to this component's own
// rendered subtree — this is the one surface in the app allowed a light
// theme (§14: "the deck has a light theme; the console does not"). Never
// touches the console's own :root CSS variables.
const PALETTES = {
    dark:  { bg: "#0d1013", ink: "#e7ebef", dim: "#8b95a1", panel: "#171b20", line: "#2a3138", accent: "#5f95d0" },
    light: { bg: "#f4f2ee", ink: "#1b1f24", dim: "#5a6270", panel: "#ffffff", line: "#d7d2c9", accent: "#3f6fa8" },
}

function SlideLabel({ children, pal }) {
    return <div style={{ ...TYPE.eyebrow, color: pal.accent, marginBottom: 18 }}>{children}</div>
}

function equirectProject(lat, lon, w, h) {
    return [((lon + 180) / 360) * w, ((90 - lat) / 180) * h]
}

// Real, lightweight SVG equirectangular map, NOT a second embedded Cesium
// instance. Deliberate architectural choice — see the report at the end of
// this pass for the reasoning: (1) src/reports/MiniMap.jsx already
// established, for the exact same real reason, that a second live WebGL
// globe instance for a small/secondary view isn't worth doubling real GPU
// cost when the app already keeps one real Cesium globe mounted
// (Situation's); (2) a live embedded Cesium instance would need to frame
// the camera on the evidence set's real extent, which depends on the same
// camera-positioning code path (flyTo/setView) that V3 Phase 1 found has a
// real, unresolved, pre-existing bug (lat/lon changes silently no-op);
// (3) a server-rendered snapshot would require real headless-Cesium
// rendering infrastructure that does not exist anywhere in this backend
// today — building it would be a separate, large project, not a deck
// feature. This renders real current lat/lon markers fresh on every open
// (never a cached image), so it can never go stale.
function DeckMap({ markers, pal }) {
    const w = 1600, h = 800
    return (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ background: pal.panel, borderRadius: 4 }}>
            {Array.from({ length: 13 }, (_, i) => (
                <line key={`v${i}`} x1={(i * w) / 12} x2={(i * w) / 12} y1={0} y2={h} stroke={pal.line} strokeWidth={1} />
            ))}
            {Array.from({ length: 7 }, (_, i) => (
                <line key={`h${i}`} x1={0} x2={w} y1={(i * h) / 6} y2={(i * h) / 6} stroke={pal.line} strokeWidth={1} />
            ))}
            {markers.map((m) => {
                const [x, y] = equirectProject(m.lat, m.lon, w, h)
                const color = m.kind === "scene" ? pal.accent : (SEV_COLOR[m.severity] || pal.dim)
                return (
                    <g key={m.id}>
                        <rect x={x - 7} y={y - 7} width={14} height={14} rx={2} fill={color} stroke={pal.bg} strokeWidth={1.5}
                              transform={`rotate(45 ${x} ${y})`} />
                        {/* Only critical-severity markers get labels (§14) —
                            a deck slide is not an inspector. */}
                        {m.labelled && (
                            <text x={x} y={y - 16} textAnchor="middle" fontSize={16} fill={pal.ink} fontWeight={600}>
                                {m.label}
                            </text>
                        )}
                    </g>
                )
            })}
            {markers.length === 0 && (
                <text x={w / 2} y={h / 2} textAnchor="middle" fontSize={24} fill={pal.dim}>No real geolocated evidence this cycle</text>
            )}
        </svg>
    )
}

function CoverSlide({ s, pal }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", height: "100%", padding: "0 140px" }}>
            <div style={{ ...TYPE.h1, textTransform: "lowercase", color: pal.ink, marginBottom: 40 }}>{s.title}</div>
            <div style={{ ...TYPE.body, color: pal.dim, display: "flex", flexDirection: "column", gap: 10 }}>
                {s.scope && <div>Scope — {s.scope}</div>}
                {s.horizon && <div>Horizon — {s.horizon}</div>}
                {s.audience && <div>Audience — {s.audience}</div>}
                <div>Evidence set — {s.evidenceCount} item{s.evidenceCount === 1 ? "" : "s"}</div>
                {s.issued && <div>Issued — {new Date(s.issued).toISOString().slice(0, 10)}</div>}
                {s.preparedBy && <div>Prepared by — {s.preparedBy}</div>}
            </div>
        </div>
    )
}

function BottomLineSlide({ s, pal }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", height: "100%", padding: "0 140px" }}>
            <SlideLabel pal={pal}>Bottom line</SlideLabel>
            <div style={{ ...TYPE.quote, color: pal.ink, marginBottom: 30 }}>
                {s.judgement || "No bottom-line judgement was generated for this report."}
            </div>
            {s.why && <div style={{ ...TYPE.body, color: pal.dim }}>{s.why}</div>}
        </div>
    )
}

function CycleSlide({ s, pal }) {
    const order = ["critical", "high", "moderate", "low"]
    return (
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", height: "100%", padding: "0 100px" }}>
            <SlideLabel pal={pal}>This cycle</SlideLabel>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 1, background: pal.line, marginBottom: 50 }}>
                {order.map((sev) => (
                    <div key={sev} style={{ background: pal.panel, padding: "24px 20px" }}>
                        <div style={{ ...TYPE.statistic, color: SEV_COLOR[sev] }}>{s.severityCounts[sev]}</div>
                        <div style={{ ...TYPE.footer, color: pal.dim, textTransform: "capitalize" }}>{sev}</div>
                    </div>
                ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {s.regionDist.slice(0, 6).map((r) => {
                    const max = s.regionDist[0]?.count || 1
                    return (
                        <div key={r.region} style={{ display: "flex", alignItems: "center", gap: 16 }}>
                            <div style={{ ...TYPE.table, color: pal.ink, width: 320, flexShrink: 0 }}>{r.region}</div>
                            <div style={{ flex: 1, height: 20, background: pal.line, borderRadius: 2 }}>
                                <div style={{ width: `${(r.count / max) * 100}%`, height: "100%", background: pal.accent, borderRadius: 2 }} />
                            </div>
                            <div style={{ ...TYPE.table, color: pal.dim, width: 60, textAlign: "right" }}>{r.count}</div>
                        </div>
                    )
                })}
                {s.regionDist.length === 0 && <div style={{ ...TYPE.body, color: pal.dim }}>No real region data this cycle.</div>}
            </div>
        </div>
    )
}

function MapSlide({ s, pal }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", height: "100%", padding: "0 100px" }}>
            <SlideLabel pal={pal}>Where</SlideLabel>
            <DeckMap markers={s.markers} pal={pal} />
        </div>
    )
}

function ThemeSlide({ s, pal }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", height: "100%", padding: "0 120px" }}>
            <SlideLabel pal={pal}>{s.title}</SlideLabel>
            <div style={{ ...TYPE.bigBody, color: pal.ink, marginBottom: 34 }}>{s.statement}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 30 }}>
                {s.claims.map((c, i) => (
                    <div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                        {c.severity && <div style={{ width: 16, height: 16, marginTop: 8, flexShrink: 0, transform: "rotate(45deg)", background: SEV_COLOR[c.severity] || pal.dim }} />}
                        <div style={{ ...TYPE.table, color: pal.dim }}>{c.text}</div>
                    </div>
                ))}
            </div>
            {s.dependencies.length > 0 && (
                <div style={{ ...TYPE.footer, color: pal.dim }}>
                    Dependencies touched: {s.dependencies.map((d) => d.asset_name).join(", ")}
                </div>
            )}
        </div>
    )
}

function ExposureSlide({ s, pal }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", height: "100%", padding: "0 100px" }}>
            <SlideLabel pal={pal}>Exposure</SlideLabel>
            {s.matches.length === 0 ? (
                <div style={{ ...TYPE.body, color: pal.dim }}>
                    {s.assetCount === 0 ? "The real asset register is currently empty — no exposure could be scored." : "No real-world assets within range of this window's evidence."}
                </div>
            ) : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr>
                        {["Asset", "Type", "Distance", "Matched signal"].map((h) => (
                            <th key={h} style={{ ...TYPE.footer, textAlign: "left", color: pal.dim, borderBottom: `2px solid ${pal.line}`, padding: "10px 16px 10px 0" }}>{h}</th>
                        ))}
                    </tr></thead>
                    <tbody>
                        {s.matches.map((m, i) => (
                            <tr key={i}>
                                <td style={{ ...TYPE.table, color: pal.ink, borderBottom: `1px solid ${pal.line}`, padding: "14px 16px 14px 0" }}>{m.asset_name}</td>
                                <td style={{ ...TYPE.table, color: pal.dim, borderBottom: `1px solid ${pal.line}`, padding: "14px 16px 14px 0" }}>{m.asset_type}</td>
                                <td style={{ ...TYPE.table, color: pal.dim, borderBottom: `1px solid ${pal.line}`, padding: "14px 16px 14px 0" }}>{m.distance_km} km</td>
                                <td style={{ ...TYPE.table, color: pal.dim, borderBottom: `1px solid ${pal.line}`, padding: "14px 16px 14px 0" }}>{m.matched_label || "—"}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    )
}

function IndicatorsSlide({ s, pal }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", height: "100%", padding: "0 120px" }}>
            <SlideLabel pal={pal}>Indicators</SlideLabel>
            {s.warnings.length === 0 ? (
                <div style={{ ...TYPE.body, color: pal.dim }}>No warnings identified from current evidence.</div>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                    {s.warnings.map((w, i) => (
                        <div key={i} style={{ ...TYPE.bigBody, color: pal.ink, display: "flex", gap: 20 }}>
                            <span style={{ color: pal.accent, flexShrink: 0 }}>{i + 1}</span><span>{w}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

function ActionsSlide({ s, pal }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", height: "100%", padding: "0 120px" }}>
            <SlideLabel pal={pal}>Actions</SlideLabel>
            {s.actions.length === 0 ? (
                <div style={{ ...TYPE.body, color: pal.dim }}>No recommended actions generated for this cycle.</div>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                    {s.actions.map((a, i) => (
                        <div key={i} style={{ display: "flex", gap: 20, alignItems: "baseline" }}>
                            <div style={{ ...TYPE.h3, color: pal.accent, width: 60, flexShrink: 0 }}>{i + 1}</div>
                            <div style={{ flex: 1 }}>
                                <div style={{ ...TYPE.bigBody, color: pal.ink }}>{a[0]}</div>
                                <div style={{ ...TYPE.footer, color: pal.dim }}>{a[1]} · by {a[2]}</div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

// Deliberately the least visually invested slide (§14) — plain text, no
// chart, no ledger fills. It exists to be held back, not walked through.
function SourcingSlide({ s, pal }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", height: "100%", padding: "0 120px" }}>
            <SlideLabel pal={pal}>Sourcing</SlideLabel>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 40, marginBottom: 40 }}>
                <div><div style={{ ...TYPE.statistic, color: pal.ink }}>{s.claimCount}</div><div style={{ ...TYPE.footer, color: pal.dim }}>Claims</div></div>
                <div><div style={{ ...TYPE.statistic, color: pal.ink }}>{s.distinctFeeds}</div><div style={{ ...TYPE.footer, color: pal.dim }}>Distinct feeds</div></div>
                <div><div style={{ ...TYPE.statistic, color: pal.ink }}>{s.linkCount}</div><div style={{ ...TYPE.footer, color: pal.dim }}>Ontology links</div></div>
                <div><div style={{ ...TYPE.statistic, color: pal.ink }}>{s.inferredLinks}</div><div style={{ ...TYPE.footer, color: pal.dim }}>Inferred</div></div>
            </div>
            <div style={{ ...TYPE.body, color: pal.dim }}>{s.methodNote}</div>
        </div>
    )
}

const SLIDE_RENDERERS = {
    cover: CoverSlide, bottomline: BottomLineSlide, cycle: CycleSlide, map: MapSlide,
    theme: ThemeSlide, exposure: ExposureSlide, indicators: IndicatorsSlide,
    actions: ActionsSlide, sourcing: SourcingSlide,
}

function useStageScale(stageRef) {
    const [scale, setScale] = useState(1)
    useEffect(() => {
        const el = stageRef.current
        if (!el) return
        const measure = () => {
            const w = el.clientWidth, h = el.clientHeight
            if (!w || !h) return
            setScale(Math.min(w / 1920, h / 1080))
        }
        measure()
        const ro = new ResizeObserver(measure)
        ro.observe(el)
        return () => ro.disconnect()
    }, [stageRef])
    return scale
}

// Pure CSS media-query-driven print/PDF path — the exact same real
// pattern PrintLayout.jsx already established (no JS state toggle
// hoping window.print()'s dialog blocks long enough): .deck-print-flow
// (every real slide, laid into normal flow) is always in the DOM but
// display:none outside of print; @media print swaps it in and hides the
// interactive stage/rail/notes/toolbar instead. This is what makes
// Page.printToPDF (or a real user's print dialog) produce exactly one
// landscape sheet per real slide regardless of any JS timing.
const PRESENT_PRINT_CSS = `
.deck-print-flow{display:none}
@media print{
  @page{margin:0;size:landscape}
  body{overflow:visible;background:#fff}
  #app{display:block;height:auto}
  .view{display:none!important}
  .view#view-deck{display:block!important;overflow:visible;height:auto}
  .deck-interactive{display:none!important}
  .deck-print-flow{display:block!important}
  .deck-print-flow .deck-print-slide{
    position:relative!important;transform:none!important;width:100%!important;height:100vh!important;
    break-after:page;overflow:hidden;
  }
  .deck-print-flow .deck-print-slide:last-child{break-after:auto}
  .deck-rail,.deck-notes,.deck-toolbar{display:none!important}
}
`

export default function Deck({ reportId, onBack }) {
    const [bundle, setBundle] = useState(null)
    const [activeIndex, setActiveIndex] = useState(0)
    const [theme, setTheme] = useState("dark")
    const [presenting, setPresentingLocal] = useState(false)
    const stageRef = useRef(null)
    const scale = useStageScale(stageRef)

    useEffect(() => {
        if (!reportId) return
        setBundle(null)
        setActiveIndex(0)
        // Real, current data every time the deck is (re)opened — never a
        // cached/stale render standing in for live evidence (§2).
        getReportBundle(reportId).then(setBundle)
    }, [reportId])

    const { meta, slides } = useMemo(() => buildDeckSlides(bundle), [bundle])
    const pal = PALETTES[theme]

    const setPresenting = useCallback((active) => {
        setPresentingLocal(active)
        window.dispatchEvent(new CustomEvent("akili:present-mode", { detail: { active } }))
    }, [])

    // Real keyboard navigation (§3) — always checks focus against form
    // fields first, so typing in any input never accidentally advances
    // slides.
    useEffect(() => {
        const handler = (e) => {
            if (e.target?.matches?.("input,textarea,select")) return
            if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, slides.length - 1)) }
            else if (e.key === "ArrowLeft") { setActiveIndex((i) => Math.max(i - 1, 0)) }
            else if (e.key === "Home") { setActiveIndex(0) }
            else if (e.key === "End") { setActiveIndex(slides.length - 1) }
            else if (e.key === "Escape" && presenting) { setPresenting(false) }
        }
        window.addEventListener("keydown", handler)
        return () => window.removeEventListener("keydown", handler)
    }, [slides.length, presenting, setPresenting])

    useEffect(() => () => { if (presenting) setPresenting(false) }, []) // eslint-disable-line react-hooks/exhaustive-deps

    // Real page count matches real slide count exactly — the always-
    // rendered .deck-print-flow (below) already contains every real slide
    // laid into normal document flow; @media print (see PRESENT_PRINT_CSS)
    // is what actually shows it and hides the interactive stage, so this
    // is just the real trigger, not something that needs to toggle state
    // first and hope a print dialog blocks long enough.
    const exportPdf = useCallback(() => window.print(), [])

    if (!reportId) return null
    const active = slides[activeIndex]
    const Renderer = active ? SLIDE_RENDERERS[active.kind] : null

    return (
        <div id="view-deck" className="view" style={{ display: "flex", flexDirection: "column", height: "100%", background: pal.bg }}>
            <style>{PRESENT_PRINT_CSS}</style>

            {!presenting && (
                <div className="deck-toolbar" style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", borderBottom: `1px solid ${pal.line}`, flexShrink: 0 }}>
                    <button className="btn sm" onClick={onBack}>← back to reader</button>
                    <div style={{ font: "600 12px var(--font)", color: pal.ink }}>
                        {meta ? `${meta.title} · ${meta.classification} · ${slides.length} slides` : "Loading…"}
                    </div>
                    <div style={{ flex: 1 }} />
                    <div className="seg">
                        <button aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}>dark</button>
                        <button aria-pressed={theme === "light"} onClick={() => setTheme("light")}>light</button>
                    </div>
                    <button className="btn sm" onClick={exportPdf} disabled={!slides.length}>pdf</button>
                    <button className="btn sm primary" onClick={() => setPresenting(true)} disabled={!slides.length}>present</button>
                </div>
            )}

            <div className="deck-interactive" style={{ flex: 1, minHeight: 0, display: "flex" }}>
                {!presenting && (
                    <div className="deck-rail" style={{ width: 186, flexShrink: 0, borderRight: `1px solid ${pal.line}`, overflowY: "auto", padding: 8 }}>
                        {slides.map((s, i) => (
                            <div key={s.id} role="button" onClick={() => setActiveIndex(i)}
                                 style={{
                                     padding: "6px 8px", marginBottom: 4, borderRadius: 3, cursor: "pointer",
                                     background: i === activeIndex ? pal.line : "transparent",
                                     font: "400 10px var(--font)", color: i === activeIndex ? pal.ink : pal.dim,
                                 }}>
                                {s.number}. {s.kind === "theme" ? s.title : s.kind}
                            </div>
                        ))}
                    </div>
                )}

                {/* Fixed-size-child fix (§2.3) — the 1920x1080 slide is taken
                    OUT of flex/grid flow entirely (position:absolute) before
                    being scaled, so it can never let an implicit auto track
                    size to its own oversized max-content and get centred
                    off-stage. The whole transform is written in ONE
                    assignment below — a scale-only write would silently
                    drop the centring translate. */}
                <div ref={stageRef} className="deck-stage" style={{ flex: 1, minHeight: 0, position: "relative", padding: 18, overflow: "hidden", background: pal.bg }}>
                    {Renderer ? (
                        <div className="slidewrap" style={{ position: "absolute", top: "50%", left: "50%", width: 1920, height: 1080, transform: `translate(-50%,-50%) scale(${scale})`, transformOrigin: "center center", background: pal.bg }}>
                            <Renderer s={active} pal={pal} />
                        </div>
                    ) : (
                        <div style={{ font: "400 12px var(--font)", color: pal.dim, padding: 20 }}>Loading…</div>
                    )}

                    {presenting && (
                        <button className="btn sm" onClick={() => setPresenting(false)}
                            style={{ position: "absolute", top: 12, right: 12, opacity: 0.5 }}>Esc · exit</button>
                    )}
                </div>

                {!presenting && (
                    <div className="deck-notes" style={{ width: 300, flexShrink: 0, borderLeft: `1px solid ${pal.line}`, padding: 14, overflowY: "auto" }}>
                        <div style={{ font: "600 11px var(--font)", color: pal.dim, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Speaker notes</div>
                        <div style={{ font: "400 13px var(--font)", color: pal.ink, lineHeight: 1.6 }}>
                            {active?.note || "—"}
                        </div>
                    </div>
                )}
            </div>

            {/* Always rendered (display:none outside @media print, see
                PRESENT_PRINT_CSS) — every real slide laid into normal
                document flow, one per landscape sheet. PRINT_PAGE_SCALE is
                a real, fixed US-Letter-landscape assumption (1056x816px @
                96dpi — confirmed against this environment's actual default
                @page size), the same fixed-real-page-size discipline
                PrintLayout.jsx's own docpage already uses rather than a
                live-measured print-time scale, which JS cannot reliably
                get during actual print rendering. */}
            <div className="deck-print-flow">
                {slides.map((s) => {
                    const R = SLIDE_RENDERERS[s.kind]
                    return (
                        <div key={s.id} className="deck-print-slide">
                            <div style={{ position: "absolute", top: "50%", left: "50%", width: 1920, height: 1080, transform: `translate(-50%,-50%) scale(${PRINT_PAGE_SCALE})`, transformOrigin: "center center", background: pal.bg }}>
                                {R && <R s={s} pal={pal} />}
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
