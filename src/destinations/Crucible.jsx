/**
 * Crucible.jsx — PARALLAX v6, Part B ▣ Crucible.
 *
 * Signals fused into one picture, and an honest account of how.
 *
 * FIVE TABS, as the spec lists them: Pipeline, Side channels, Tip and cue,
 * Camera vision, Boundaries. What replaced it before was AICouncil.jsx, a
 * 129-line placeholder.
 *
 * WHAT IS REAL HERE. Every number comes from a live endpoint:
 *   /api/fusions            50 correlated clusters, each with the four
 *                           components of its score and the weights used
 *   /api/corroborate        the observation pool, by source, with the
 *                           radius and window the matcher ran at
 *   /api/fusion-settings    the rule: window, minimum domains, minimum signals
 *   /api/alerts/surges      the anomaly channel, with its baseline
 *   /api/ontology/clusters  the country plates and the entities bridging them
 *   /api/overwatch/detect-image  the real ONNX detector, three models
 *
 * THE SPEC'S PIPELINE NUMBERS ARE NOT OURS. Its mock reads "18.4k messages
 * per min, Kafka" and "2,311 active H3 cells". There is no Kafka and no H3
 * index in this deployment, and printing those figures would be the single
 * most dishonest thing this screen could do — it would describe somebody
 * else's architecture. The stages below are the five this system actually
 * has, each labelled with the mechanism that implements it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import API_BASE from "../apiBase.js"
import Loading from "../ui/Loading.jsx"
import { MODE_SURFACE } from "../plx6/modeWindow.js"

const safeArray = (v) => (Array.isArray(v) ? v : [])
const ON = "var(--accdim)"

const EYE = {
    fontFamily: "var(--mz-font-mono)", fontWeight: 500, fontSize: 10,
    letterSpacing: ".14em", textTransform: "uppercase", color: "var(--txt4)",
}
const CARD = {
    display: "flex", flexDirection: "column", overflow: "hidden",
    border: "1px solid var(--gline)", borderRadius: 0, minWidth: 0,
}
const SEV = {
    critical: "var(--red)", high: "var(--amber)",
    significant: "var(--amber)", elevated: "var(--acchi)",
}
const pct = (x) => `${Math.round((x || 0) * 100)}%`
const num = (n) => (n ?? 0).toLocaleString()

export default function Crucible({ onOpenModule = () => {}, embedded = false }) {
    const [tab, setTab] = useState("pipe")
    const [fusions, setFusions] = useState(null)
    const [corr, setCorr] = useState(null)
    const [settings, setSettings] = useState(null)
    const [surges, setSurges] = useState(null)
    const [clusters, setClusters] = useState(null)
    const [err, setErr] = useState(null)

    useEffect(() => {
        const o = { credentials: "include" }
        const get = (u) => fetch(`${API_BASE}${u}`, o)
            .then((r) => (r.ok ? r.json() : null)).catch(() => null)
        get("/api/fusions?limit=200").then((d) => setFusions(safeArray(d)))
            .catch(() => setErr("the fusion store did not answer"))
        get("/api/corroborate").then(setCorr)
        get("/api/fusion-settings").then(setSettings)
        get("/api/alerts/surges?limit=40").then(setSurges)
        get("/api/ontology/clusters").then(setClusters)
    }, [])

    const hi = useMemo(
        () => safeArray(fusions).filter((f) => (f.confidence ?? 0) >= 0.7), [fusions])

    const bySource = corr?.by_source || {}
    const srcCount = Object.keys(bySource).length

    /* ── ▣ Pipeline ─────────────────────────────────────────────────── */
    const stages = [
        ["Ingest", num(srcCount), `sources · ${num(corr?.observations_considered)} observations in window`],
        ["Match", num(corr?.clusters_total), `spatial clusters at ${corr?.window?.radius_km ?? "—"} km`],
        ["Corroborate", num(corr?.count), `cross-source, ${corr?.window?.coincidence_window_hours ?? "—"} h coincidence`],
        ["Correlate", num(safeArray(fusions).length), "fusions scored on four components"],
        ["Alert", num(hi.length), "at or above 0.70 confidence"],
    ]

    const pipeTab = () => (
        <>
            <div style={{
                display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,170px),1fr))",
                overflow: "hidden", border: "1px solid var(--gline)",
            }}>
                {stages.map(([k, v, sub], i) => (
                    <div key={k} style={{
                        display: "flex", flexDirection: "column", gap: 6, padding: "14px 16px",
                        borderRight: i < stages.length - 1 ? "1px solid var(--gline)" : 0, minWidth: 0,
                    }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, color: "var(--txt4)" }}>
                                {String(i + 1).padStart(2, "0")}
                            </span>
                            <span style={{ fontSize: 13, color: "var(--txt2)" }}>{k}</span>
                            <span style={{
                                marginLeft: "auto", fontFamily: "var(--mz-font-mono)",
                                fontSize: 10, color: "var(--txt4)",
                            }}>{i < stages.length - 1 ? "→" : ""}</span>
                        </span>
                        <span style={{
                            fontFamily: "var(--mz-font-mono)", fontSize: 22,
                            fontWeight: 500, color: "var(--txt)",
                        }}>{v}</span>
                        <span style={{ fontSize: 12, color: "var(--txt3)", textWrap: "pretty" }}>{sub}</span>
                    </div>
                ))}
            </div>

            <div style={{
                display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,420px),1fr))",
                gap: 16, alignItems: "start",
            }}>
                {/* What is coming in, by source. */}
                <div style={CARD}>
                    <div style={{
                        display: "flex", alignItems: "center", gap: 10, minHeight: 40,
                        padding: "0 14px", borderBottom: "1px solid var(--gline)",
                    }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--txt2)" }}>Feeds in window</span>
                        <span style={{
                            marginLeft: "auto", fontFamily: "var(--mz-font-mono)",
                            fontSize: 10, color: "var(--txt4)",
                        }}>{corr?.window?.hours ?? "—"} h</span>
                    </div>
                    {Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([k, n]) => {
                        const mx = Math.max(1, ...Object.values(bySource))
                        return (
                            <div key={k} style={{
                                display: "grid", gridTemplateColumns: "8px minmax(0,1fr) 72px 64px",
                                gap: "3px 12px", alignItems: "center", padding: "10px 14px",
                                borderBottom: "1px solid var(--gline)",
                            }}>
                                <i style={{ width: 8, height: 8, background: "var(--acchi)" }} />
                                <span style={{
                                    fontSize: 14, overflow: "hidden",
                                    textOverflow: "ellipsis", whiteSpace: "nowrap",
                                }}>{k}</span>
                                <span style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 16 }}>
                                    <i style={{
                                        flex: 1, height: `${Math.max(2, (n / mx) * 16)}px`,
                                        background: "var(--acchi)", opacity: 0.55,
                                    }} />
                                </span>
                                <span style={{
                                    fontFamily: "var(--mz-font-mono)", fontSize: 11,
                                    color: "var(--txt2)", textAlign: "right",
                                }}>{num(n)}</span>
                            </div>
                        )
                    })}
                    {!srcCount && (
                        <div style={{ padding: 14, fontSize: 12, color: "var(--txt3)" }}>
                            No observations in the window.
                        </div>
                    )}
                </div>

                {/* How a fusion scored, component by component. */}
                <div style={CARD}>
                    <div style={{
                        display: "flex", alignItems: "center", gap: 10, minHeight: 40,
                        padding: "0 14px", borderBottom: "1px solid var(--gline)",
                    }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--txt2)" }}>Strongest fusions</span>
                        <span style={{
                            marginLeft: "auto", fontFamily: "var(--mz-font-mono)",
                            fontSize: 10, color: "var(--txt4)",
                        }}>{safeArray(fusions).length} active</span>
                    </div>
                    {safeArray(fusions)
                        .slice()
                        .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
                        .slice(0, 8)
                        .map((f) => {
                            const comps = f.correlation_components?.components || {}
                            const c = SEV[f.severity] || "var(--steel)"
                            return (
                                <div key={f.fusion_id} style={{
                                    display: "grid", gridTemplateColumns: "8px minmax(0,1fr) 72px 64px",
                                    gap: "3px 12px", alignItems: "center", padding: "10px 14px",
                                    borderBottom: "1px solid var(--gline)",
                                }}>
                                    <i style={{ width: 8, height: 8, background: c }} />
                                    <span style={{
                                        fontSize: 14, overflow: "hidden",
                                        textOverflow: "ellipsis", whiteSpace: "nowrap",
                                    }}>{f.location_name || f.title}</span>
                                    {/* The four components, as four bars. The
                                        score is a weighted sum of these, and
                                        seeing which one carried it is the
                                        difference between a number and a
                                        reason. */}
                                    <span style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 16 }}>
                                        {["geo_temporal", "graph", "domain_diversity", "statistical"].map((k) => (
                                            <i key={k} title={`${k.replace(/_/g, " ")} ${pct(comps[k])}`}
                                                style={{
                                                    flex: 1, height: `${Math.max(2, (comps[k] || 0) * 16)}px`,
                                                    background: c, opacity: 0.55,
                                                }} />
                                        ))}
                                    </span>
                                    <span style={{
                                        fontFamily: "var(--mz-font-mono)", fontSize: 11,
                                        color: "var(--txt2)", textAlign: "right",
                                    }}>{pct(f.confidence)}</span>
                                    <span />
                                    <span style={{
                                        gridColumn: "2 / 5", fontSize: 12, color: "var(--txt3)",
                                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                    }}>
                                        {safeArray(f.domains).join(" + ")} · {f.signal_count} signals
                                        {f.radius_km ? ` · ${f.radius_km} km` : ""}
                                    </span>
                                </div>
                            )
                        })}
                </div>
            </div>

            {/* The weights, stated. They are a choice, and the score cannot
                be argued with unless they are on screen. */}
            {safeArray(fusions)[0]?.correlation_components?.weights_used && (
                <div style={{ ...CARD, background: "var(--glass2)" }}>
                    <div style={{ padding: "12px 14px 6px" }}>
                        <span style={EYE}>How a fusion is scored</span>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 18, padding: "0 14px 14px" }}>
                        {Object.entries(safeArray(fusions)[0].correlation_components.weights_used)
                            .map(([k, w]) => (
                                <span key={k} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                    <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 16, color: "var(--txt)" }}>
                                        {pct(w)}
                                    </span>
                                    <span style={{ fontSize: 11.5, color: "var(--txt3)" }}>{k.replace(/_/g, " ")}</span>
                                </span>
                            ))}
                    </div>
                </div>
            )}
        </>
    )

    /* ── ▣ Side channels ────────────────────────────────────────────── */
    const sideTab = () => {
        const rows = safeArray(surges?.surges)
        return (
            <>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 820 }}>
                    <span style={EYE}>Indicates</span>
                    <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: "var(--txt2)", textWrap: "pretty" }}>
                        A surge is a region whose last {surges?.window_days ?? "—"} days sit far enough above its
                        own {surges?.baseline_days ?? "—"}-day baseline to be worth a look. It is a comparison
                        against the region's own history, not against other regions — a busy place is not
                        anomalous for being busy.
                    </p>
                </div>

                <div style={CARD}>
                    <div style={{
                        display: "flex", alignItems: "center", gap: 10, minHeight: 40,
                        padding: "0 14px", borderBottom: "1px solid var(--gline)",
                    }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--txt2)" }}>Active anomalies</span>
                        <span style={{
                            marginLeft: "auto", fontFamily: "var(--mz-font-mono)",
                            fontSize: 10, color: "var(--txt4)",
                        }}>{num(surges?.considered)} considered</span>
                    </div>
                    {rows.map((s, i) => (
                        <div key={s.id || i} style={{
                            display: "grid", gridTemplateColumns: "8px minmax(0,1fr) auto",
                            gap: "3px 12px", alignItems: "center", padding: "10px 14px",
                            borderBottom: "1px solid var(--gline)",
                        }}>
                            <i style={{ width: 8, height: 8, background: "var(--amber)" }} />
                            <span style={{ fontSize: 14 }}>{s.region || s.label || s.id}</span>
                            <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 11, color: "var(--txt2)" }}>
                                {s.ratio ? `${s.ratio.toFixed(1)}×` : s.count ?? ""}
                            </span>
                        </div>
                    ))}
                    {!rows.length && (
                        <div style={{ padding: 14, fontSize: 12.5, color: "var(--txt3)", textWrap: "pretty" }}>
                            Nothing is surging. {num(surges?.considered)} region-windows were compared against
                            their own {surges?.baseline_days ?? "—"}-day baselines and none cleared the
                            threshold. An empty channel is a result, not a failure to load.
                        </div>
                    )}
                </div>
            </>
        )
    }

    /* ── ▣ Tip and cue ──────────────────────────────────────────────── */
    const tipTab = () => {
        const cued = hi.filter((f) => f.lat != null && f.lon != null)
        return (
            <>
                <div style={{
                    display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,200px),1fr))",
                    gap: 0, border: "1px solid var(--gline)",
                }}>
                    {[["Rule", `${settings?.min_signals ?? "—"} signals, ${settings?.min_domains ?? "—"} domains`],
                      ["Time window", `${settings?.fusion_window_hours ?? "—"} h`],
                      ["Cluster radius", `${corr?.window?.radius_km ?? "—"} km`],
                      ["Clusters", num(corr?.clusters_total)]].map(([k, v], i) => (
                        <div key={k} style={{
                            display: "flex", flexDirection: "column", gap: 2, padding: "14px 16px",
                            borderRight: i < 3 ? "1px solid var(--gline)" : 0,
                        }}>
                            <span style={EYE}>{k}</span>
                            <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 18, color: "var(--txt)" }}>{v}</span>
                        </div>
                    ))}
                </div>

                <div style={CARD}>
                    <div style={{
                        display: "flex", alignItems: "center", gap: 10, minHeight: 40,
                        padding: "0 14px", borderBottom: "1px solid var(--gline)",
                    }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--txt2)" }}>Cued tasks</span>
                        <span style={{
                            marginLeft: "auto", fontFamily: "var(--mz-font-mono)",
                            fontSize: 10, color: "var(--txt4)",
                        }}>{cued.length} of {hi.length} high-confidence have a location</span>
                    </div>
                    {cued.slice(0, 20).map((f) => (
                        <div key={f.fusion_id} style={{
                            display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto",
                            gap: "3px 12px", alignItems: "center", padding: "10px 14px",
                            borderBottom: "1px solid var(--gline)",
                        }}>
                            <span style={{
                                fontSize: 14, overflow: "hidden",
                                textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}>{f.location_name || f.title}</span>
                            <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 11, color: "var(--txt2)" }}>
                                {pct(f.confidence)}
                            </span>
                            <button onClick={() => {
                                window.dispatchEvent(new CustomEvent("akili:open-map"))
                                window.dispatchEvent(new CustomEvent("akili:fly-to", {
                                    detail: { lat: f.lat, lon: f.lon, altitude: 220000 },
                                }))
                            }} style={{
                                height: 24, padding: "0 9px", border: "1px solid var(--gline2)",
                                background: "transparent", color: "var(--acchi)", font: "inherit",
                                fontSize: 11, cursor: "pointer", borderRadius: 0, whiteSpace: "nowrap",
                            }}>Show on map →</button>
                            <span style={{
                                gridColumn: "1 / 4", fontSize: 12, color: "var(--txt3)",
                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}>{safeArray(f.domains).join(" + ")} · {f.signal_count} signals · {f.subtitle || ""}</span>
                        </div>
                    ))}
                    {!cued.length && (
                        <div style={{ padding: 14, fontSize: 12.5, color: "var(--txt3)", textWrap: "pretty" }}>
                            No cluster meets the rule. Nothing is cued.
                        </div>
                    )}
                </div>

                <p style={{ margin: 0, fontSize: 12, color: "var(--txt4)", maxWidth: 820, textWrap: "pretty" }}>
                    Cueing here means putting the location in front of you. It does not task a satellite —
                    Overwatch does that, and the pass has to be requested there against a real AOI.
                </p>
            </>
        )
    }

    /* ── ▣ Camera vision ────────────────────────────────────────────── */
    const vlmTab = () => <CameraVision />

    /* ── ▣ Boundaries ───────────────────────────────────────────────── */
    const boundTab = () => {
        /* WHAT THIS STACK CAN AND CANNOT DO, written against what is
           actually wired. Every row is checkable in this repo; none of it
           is aspiration. */
        const rows = [
            ["Locate a reported event", "GDELT and GeoConfirmed, city-level",
             "A sub-city fix needs imagery or a ground report", "global", "none", "open"],
            ["Correlate across domains", `${safeArray(fusions).length} live fusions, four scored components`,
             "Statistical component is 0 until a per-region baseline exists", "where feeds overlap", "none", "open"],
            ["Detect objects in a scene", "ONNX, DOTA and COCO classes, tiled inference",
             "Oriented boxes on small craft need a finer model", "Sentinel-2, 10 m", "model download", "open"],
            ["See through cloud and night", "Sentinel-1 SAR, VH/VV",
             "SAR tells you something is there, not what it is", "revisit-limited", "none", "open"],
            ["Follow a vessel", "AIS, when the transponder is on",
             "A dark vessel needs SAR or imagery to re-acquire", "coastal and open sea", "none", "open"],
            ["Attribute an actor", "Sanctions lists, ownership records",
             "Beneficial ownership behind a shell is not in open data", "patchy", "none",
             "check the list's own licence"],
            ["Forecast escalation", "UCDP history, per-country base rates",
             "No live signal feeds the model yet", "where UCDP has coverage", "none", "open"],
        ]
        return (
            <div style={{ ...CARD, background: "var(--glass2)" }}>
                <div style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0,1.1fr) minmax(0,1.3fr) minmax(0,1.3fr) 110px 110px 90px",
                    gap: 12, padding: "10px 14px", borderBottom: "1px solid var(--gline)",
                    ...EYE, fontSize: 9.5,
                }}>
                    <span>Capability</span><span>With open data</span><span>Would need</span>
                    <span>Coverage</span><span>Setup</span><span>Compliance</span>
                </div>
                {rows.map((r) => (
                    <div key={r[0]} style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0,1.1fr) minmax(0,1.3fr) minmax(0,1.3fr) 110px 110px 90px",
                        gap: 12, padding: "11px 14px", borderBottom: "1px solid var(--gline)",
                        fontSize: 12.5, alignItems: "start",
                    }}>
                        <b style={{ fontWeight: 600, textWrap: "pretty" }}>{r[0]}</b>
                        <span style={{ color: "var(--txt2)", textWrap: "pretty" }}>{r[1]}</span>
                        <span style={{ color: "var(--amber)", textWrap: "pretty" }}>{r[2]}</span>
                        <span style={{ color: "var(--txt3)" }}>{r[3]}</span>
                        <span style={{ color: "var(--txt3)" }}>{r[4]}</span>
                        <span style={{ color: "var(--txt3)" }}>{r[5]}</span>
                    </div>
                ))}
            </div>
        )
    }

    const fzSub = fusions
        ? `${safeArray(fusions).length} fusions · ${hi.length} at or above 0.70 · `
          + `${num(corr?.observations_considered)} observations in the last ${corr?.window?.hours ?? "—"} h`
        : "reading the pipeline"

    return (
        // Embedded: a section of Settings (owner, 2026-10-06 — a view of
        // the engine, not a screen you work in), so no full-screen frame.
        <section data-screen-label="Crucible" style={embedded
            ? { display: "flex", flexDirection: "column", minHeight: 680, margin: "0 -22px -22px", position: "relative" }
            : MODE_SURFACE}>
            <header style={{
                display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
                padding: "14px 20px 0", borderBottom: "1px solid var(--gline)", flex: "none",
            }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingBottom: 12, minWidth: 0 }}>
                    <h1 style={{
                        margin: 0, fontFamily: "var(--mz-font-body)", fontWeight: 600,
                        fontSize: 24, lineHeight: 1.1, letterSpacing: "-.01em",
                    }}>Crucible</h1>
                    <span style={{ fontSize: 13, color: "var(--txt3)" }}>{fzSub}</span>
                </div>
                <div style={{ flex: 1 }} />
                <nav style={{ display: "flex", gap: 2, alignSelf: "flex-end", overflowX: "auto", maxWidth: "100%" }}>
                    {[["Pipeline", "pipe"], ["Side channels", "side"], ["Tip and cue", "tip"],
                      ["Camera vision", "vlm"], ["Boundaries", "bound"]].map(([k, v]) => (
                        <button key={v} onClick={() => setTab(v)} style={{
                            height: 38, padding: "0 14px", border: 0,
                            borderBottom: `2px solid ${tab === v ? "var(--acchi)" : "transparent"}`,
                            background: "transparent",
                            color: tab === v ? "var(--txt)" : "var(--txt3)",
                            font: "inherit", fontSize: 14, cursor: "pointer", whiteSpace: "nowrap",
                        }}>{k}</button>
                    ))}
                </nav>
            </header>

            <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "20px 20px 28px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                    {err && <div style={{ color: "var(--txt3)" }}>Crucible is unavailable ({err}).</div>}
                    {!err && !fusions && tab !== "vlm" && tab !== "bound" && (
                        <Loading size={20} inline label="Reading the pipeline" />
                    )}
                    {!err && (fusions || tab === "vlm" || tab === "bound") && (
                        <>
                            {tab === "pipe" && pipeTab()}
                            {tab === "side" && sideTab()}
                            {tab === "tip" && tipTab()}
                            {tab === "vlm" && vlmTab()}
                            {tab === "bound" && boundTab()}
                        </>
                    )}
                </div>
            </div>
        </section>
    )
}

/**
 * ▣ Camera vision — run the real detector on a frame you supply.
 *
 * This is the same ONNX inference Overwatch uses on satellite scenes
 * (/api/overwatch/detect-image), pointed at whatever image you drop in. It
 * is useful for exactly what the spec implies: checking what the detector
 * sees before trusting it on a scene you cannot ground-truth.
 *
 * THE BOUNDS ARE A FICTION, AND IT SAYS SO. The endpoint geolocates every
 * box, so it requires a bounding box for the image. A photograph off a
 * phone has no georeference, so a unit square is sent and the pixel
 * coordinates are what you read. Pretending the boxes are coordinates
 * would put objects at latitude 0.4.
 */
function CameraVision() {
    const [img, setImg] = useState(null)
    const [model, setModel] = useState("dota")
    const [conf, setConf] = useState(0.15)
    const [running, setRunning] = useState(false)
    const [out, setOut] = useState(null)
    const [err, setErr] = useState(null)
    const fileRef = useRef(null)

    const pick = (file) => {
        if (!file) return
        const fr = new FileReader()
        fr.onload = () => { setImg(String(fr.result)); setOut(null); setErr(null) }
        fr.readAsDataURL(file)
    }

    const run = useCallback(async () => {
        if (!img) return
        setRunning(true); setErr(null); setOut(null)
        try {
            const r = await fetch(`${API_BASE}/api/overwatch/detect-image`, {
                method: "POST", credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    image: img, model, confidence: conf,
                    // A unit square: the detector needs bounds, this frame has none.
                    bounds: { north: 1, south: 0, east: 1, west: 0 },
                }),
            })
            const d = await r.json().catch(() => null)
            if (r.status === 429) throw new Error(d?.error || "the detector is busy — try again")
            if (!r.ok) throw new Error(d?.error || `inference failed (${r.status})`)
            if (d?.error) throw new Error(d.error)
            setOut(d)
        } catch (e) { setErr(String(e.message || e)) } finally { setRunning(false) }
    }, [img, model, conf])

    const dets = safeArray(out?.detections)
    const byClass = useMemo(() => {
        const m = new Map()
        for (const d of dets) m.set(d.class || d.label, (m.get(d.class || d.label) || 0) + 1)
        return [...m.entries()].sort((a, b) => b[1] - a[1])
    }, [dets])

    const BTN = {
        height: 30, padding: "0 12px", border: "1px solid var(--gline2)",
        background: "transparent", color: "var(--txt)", font: "inherit",
        cursor: "pointer", borderRadius: 0, whiteSpace: "nowrap",
    }

    return (
        <>
            <div style={{
                display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap",
                padding: "14px 16px", border: "1px solid var(--gline)", background: "var(--glass2)",
            }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={EYE}>Model</span>
                    <select value={model} onChange={(e) => setModel(e.target.value)} style={{
                        height: 30, padding: "0 8px", border: "1px solid var(--gline2)",
                        background: "var(--solid)", color: "var(--txt)", font: "inherit", borderRadius: 0,
                    }}>
                        <option value="dota">DOTA — overhead, oriented boxes</option>
                        <option value="dota-v2">DOTA v2 — more classes</option>
                        <option value="coco">COCO — ground-level objects</option>
                    </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={EYE}>Confidence floor · {conf.toFixed(2)}</span>
                    <input type="range" min={0.05} max={0.6} step={0.05} value={conf}
                        onChange={(e) => setConf(Number(e.target.value))}
                        style={{ width: 160, accentColor: "var(--acchi)" }} />
                </label>
                <button onClick={() => fileRef.current?.click()} style={BTN}>Choose a frame</button>
                <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
                    onChange={(e) => { pick(e.target.files?.[0]); e.target.value = "" }} />
                <button onClick={run} disabled={!img || running} style={{
                    ...BTN, border: 0,
                    background: img && !running ? "var(--acc)" : "var(--hov)",
                    color: img && !running ? "var(--mz-cream)" : "var(--txt4)",
                    fontWeight: 600,
                }}>{running ? "Analysing…" : "Analyze frame"}</button>
                {running && <Loading size={14} inline label="running inference" />}
                {err && <span style={{ fontSize: 12, color: "var(--red)", textWrap: "pretty" }}>{err}</span>}
            </div>

            <div style={{
                display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,340px),1fr))",
                gap: 16, alignItems: "start",
            }}>
                <div style={CARD}>
                    <div style={{ padding: "12px 14px 8px" }}><span style={EYE}>Frame</span></div>
                    <div style={{
                        position: "relative", borderTop: "1px solid var(--gline)",
                        background: "var(--sea)", minHeight: 220,
                        display: "grid", placeItems: "center", overflow: "hidden",
                    }}>
                        {img
                            ? <img src={img} alt="" style={{ width: "100%", display: "block" }} />
                            : <span style={{ fontSize: 12.5, color: "var(--txt3)", padding: 20, textWrap: "pretty" }}>
                                Choose a frame. This runs the same detector Overwatch uses on satellite
                                scenes — useful for seeing what it does and does not pick up before you
                                trust it on a scene you cannot check.
                            </span>}
                    </div>
                </div>

                <div style={CARD}>
                    <div style={{
                        display: "flex", alignItems: "center", gap: 10, minHeight: 40,
                        padding: "0 14px", borderBottom: "1px solid var(--gline)",
                    }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--txt2)" }}>Objects</span>
                        <span style={{
                            marginLeft: "auto", fontFamily: "var(--mz-font-mono)",
                            fontSize: 10, color: "var(--txt4)",
                        }}>{out ? `${dets.length} found` : ""}</span>
                    </div>
                    {byClass.map(([k, n]) => (
                        <div key={k} style={{
                            display: "flex", alignItems: "center", gap: 12, padding: "9px 14px",
                            borderBottom: "1px solid var(--gline)",
                        }}>
                            <span style={{ flex: 1, minWidth: 0, fontSize: 13.5 }}>{k}</span>
                            <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 11, color: "var(--txt2)" }}>{n}</span>
                        </div>
                    ))}
                    {out && !dets.length && (
                        <div style={{ padding: 14, fontSize: 12.5, color: "var(--txt3)", textWrap: "pretty" }}>
                            Nothing above {conf.toFixed(2)}. Lower the floor, or try the COCO model if this is
                            a ground-level photograph — DOTA is trained on overhead imagery and will not find
                            much in a street scene.
                        </div>
                    )}
                    {!out && (
                        <div style={{ padding: 14, fontSize: 12, color: "var(--txt4)" }}>
                            No run yet.
                        </div>
                    )}
                </div>
            </div>

            {out && (
                <div style={CARD}>
                    <div style={{ padding: "12px 14px 8px" }}><span style={EYE}>Raw output</span></div>
                    <pre style={{
                        margin: 0, padding: "0 14px 14px", maxHeight: 220, overflow: "auto",
                        fontFamily: "var(--mz-font-mono)", fontSize: 11, color: "var(--txt3)",
                        whiteSpace: "pre-wrap",
                    }}>{JSON.stringify({ count: out.count, model, detections: dets.slice(0, 12) }, null, 1)}</pre>
                    <div style={{ padding: "0 14px 14px", fontSize: 11.5, color: "var(--txt4)", textWrap: "pretty" }}>
                        The box coordinates are pixel positions in this frame. A photograph has no
                        georeference, so a unit bounding box was sent — read these as pixels, not degrees.
                    </div>
                </div>
            )}
        </>
    )
}
