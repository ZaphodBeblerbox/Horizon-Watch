import { useState, useEffect, useCallback } from "react"
import API_BASE from "../apiBase.js"
import { useInspectorExtensions } from "../inspector/extensionRegistry.js"

const API = API_BASE

const COLOR_MAP = {
    red:    "#ef4444",
    amber:  "#f59e0b",
    teal:   "var(--akili-accent)",
    orange: "#f97316",
    yellow: "#eab308",
    white:  "#ffffff",
    grey:   "#6b7280",
}

const EVENT_LABEL = {
    explosion:   "Explosion",
    missile:     "Missile",
    armed_clash: "Armed Clash",
    fire:        "Fire",
    aviation:    "Aviation",
    maritime:    "Maritime",
    energy:      "Energy",
    earthquake:  "Earthquake",
    protest:     "Protest",
    medical:     "Medical",
    general:     "General",
}

function InfraIcon({ type }) {
    const s = { width: 10, height: 10, display: "block" }
    if (type === "airport")     return <svg {...s} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M8 1.5L11.5 8L8 7L4.5 8Z"/><path d="M6 7.5L4 10.5H12L10 7.5"/><line x1="8" y1="10.5" x2="8" y2="14"/><line x1="6" y1="13" x2="10" y2="13"/></svg>
    if (type === "port")        return <svg {...s} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="8" cy="4.5" r="2"/><line x1="8" y1="6.5" x2="8" y2="15"/><path d="M4 10C4 10 4 15 8 15C12 15 12 10 12 10"/><line x1="5" y1="4.5" x2="11" y2="4.5"/></svg>
    if (type === "power_plant") return <svg {...s} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><polyline points="10,1 5,9 9,9 6,15"/></svg>
    if (type === "hospital")    return <svg {...s} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg>
    if (type === "military")    return <svg {...s} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M8 2L16 5V9C16 13 8 16.5 8 16.5S0 13 0 9V5L8 2Z"/></svg>
    if (type === "pipeline")    return <svg {...s} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 12C2 12 4 10 5.5 12C7 14 9 10 10.5 12C12 14 14 12 14 12"/></svg>
    return <svg {...s} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="5"/></svg>
}

function colorValue(c) {
    if (!c) return COLOR_MAP.grey
    if (c.startsWith && c.startsWith("#")) return c
    return COLOR_MAP[c] || COLOR_MAP.grey
}

function timeStamp(iso) {
    if (!iso) return ""
    try {
        return new Date(iso).toLocaleString()
    } catch {
        return iso
    }
}

function InfoRow({ label, value }) {
    if (!value) return null
    return (
        <div style={{ display: "flex", gap: 8, fontSize: 11, color: "var(--akili-text-secondary)" }}>
            <span style={{ minWidth: 90, textTransform: "uppercase", letterSpacing: "0.08em", fontSize: 9 }}>
                {label}
            </span>
            <span style={{ color: "var(--akili-text-primary)" }}>{value}</span>
        </div>
    )
}

export default function SurfaceDetailPanel({
    item,
    profile,
    onClose,
    panelStyle = {},
    onContextUpdate,
    onEnrichmentUpdate,
}) {
    const [contextNodes, setContextNodes] = useState(null)
    const [contextLoading, setContextLoading] = useState(false)
    const [enrichment, setEnrichment] = useState(null)
    const [enrichmentLoading, setEnrichmentLoading] = useState(false)
    const [analysing, setAnalysing] = useState(false)
    const [error, setError] = useState(null)
    // V3 Phase 1, §2.2 — real hook-based extension point, owned and called
    // by this component itself (never reassigned from outside). This
    // surface's "event" concept has no clean reference-grammar kind yet
    // (it's GDELT/news-derived, not one of §7.2's real record kinds), so
    // recordRef is honestly null rather than a guessed one — the hook
    // still fires, matching the "always call it" principle.
    const inspectorExtensions = useInspectorExtensions()

    const eventType = item?.type || "general"
    const eventColor = colorValue(item?.color)
    const summary = item?.summary || item?.context || ""

    useEffect(() => {
        if (!item?.id) return
        let cancelled = false
        setContextLoading(true)
        setEnrichmentLoading(true)
        setContextNodes(null)
        setEnrichment(null)
        setError(null)

        const contextReq = fetch(`${API}/api/events/${item.id}/context`).then(r => r.ok ? r.json() : null)
        const enrichReq = fetch(`${API}/api/events/${item.id}/enrichment`).then(r => r.ok ? r.json() : null)

        Promise.allSettled([contextReq, enrichReq]).then(([ctxRes, enrichRes]) => {
            if (cancelled) return

            if (ctxRes.status === "fulfilled" && ctxRes.value) {
                const nodes = ctxRes.value.infra_nodes || []
                setContextNodes(nodes)
                onContextUpdate?.({ infra: nodes, item })
            } else {
                setContextNodes([])
                onContextUpdate?.({ infra: [], item })
            }
            setContextLoading(false)

            if (enrichRes.status === "fulfilled") {
                const val = enrichRes.value
                if (val && val.enrichment) {
                    setEnrichment(val)
                    onEnrichmentUpdate?.({ item, enrichment: val.enrichment, prose: val.prose || "" })
                } else {
                    setEnrichment(null)
                    onEnrichmentUpdate?.(null)
                }
            } else {
                setEnrichment(null)
                onEnrichmentUpdate?.(null)
            }
            setEnrichmentLoading(false)
        })

        return () => { cancelled = true }
    }, [item?.id])  // eslint-disable-line react-hooks/exhaustive-deps

    const handleAnalyse = useCallback(async () => {
        if (analysing || !item?.id) return
        setAnalysing(true)
        setError(null)
        try {
            const r = await fetch(`${API}/api/events/${item.id}/enrich`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ profile }),
            })
            const d = await r.json()
            if (d?.error) {
                setError(d.error)
            } else {
                setEnrichment(d)
                onEnrichmentUpdate?.({ item, enrichment: d.enrichment || {}, prose: d.prose || "" })
            }
        } catch (e) {
            setError(e.message)
        } finally {
            setAnalysing(false)
        }
    }, [analysing, item, profile, onEnrichmentUpdate])

    return (
        <div style={{ ...panelStyle, padding: 12, overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{
                        padding: "4px 8px",
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        color: "#0f172a",
                        background: eventColor,
                        borderRadius: 4,
                    }}>
                        {EVENT_LABEL[eventType] || eventType}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--akili-text-muted)" }}>
                        {item?.source || item?.source_type || ""}
                    </div>
                </div>
                <button
                    onClick={onClose}
                    style={{ background: "none", border: "none", color: "var(--akili-text-muted)", cursor: "pointer", fontSize: 16, lineHeight: 1 }}
                >
                    ×
                </button>
            </div>

            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--akili-text-primary)", marginBottom: 8 }}>
                {item?.headline || "Untitled event"}
            </div>

            {summary && (
                <div style={{ fontSize: 12, color: "var(--akili-text-secondary)", lineHeight: 1.5, marginBottom: 10 }}>
                    {summary}
                </div>
            )}

            <InfoRow label="Timestamp" value={timeStamp(item?.published_at)} />
            <InfoRow label="Coordinates" value={item?.lat != null && item?.lon != null ? `${Number(item.lat).toFixed(3)}, ${Number(item.lon).toFixed(3)}` : ""} />

            {/* Context infrastructure */}
            <div style={{ marginTop: 14, marginBottom: 8, fontSize: 10, fontWeight: 700, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--akili-accent)" }}>
                Infrastructure Context
            </div>
            {contextLoading && (
                <div style={{ fontSize: 11, color: "var(--akili-text-muted)" }}>Loading context…</div>
            )}
            {!contextLoading && (contextNodes?.length ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {contextNodes.map((n, i) => (
                        <div key={`${n.name}-${i}`} style={{ display: "grid", gridTemplateColumns: "18px 1fr auto", gap: 8, alignItems: "center" }}>
                            <div style={{
                                width: 18,
                                height: 18,
                                borderRadius: 9,
                                background: "rgba(26,110,181,0.15)",
                                border: "1px solid rgba(26,110,181,0.6)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: "var(--akili-accent)",
                            }}>
                                <InfraIcon type={n.type} />
                            </div>
                            <div style={{ fontSize: 11, color: "var(--akili-text-primary)" }}>{n.name || n.type}</div>
                            <div style={{ fontSize: 10, color: "var(--akili-text-muted)" }}>
                                {n.distance_km != null ? `${n.distance_km}km` : n.type}
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div style={{ fontSize: 11, color: "var(--akili-text-muted)" }}>No nearby infrastructure cached.</div>
            ))}

            {/* Enrichment */}
            <div style={{ marginTop: 16, marginBottom: 8, fontSize: 10, fontWeight: 700, letterSpacing: "0.10em", textTransform: "uppercase", color: "var(--akili-accent)" }}>
                Analysis
            </div>
            {enrichmentLoading && (
                <div style={{ fontSize: 11, color: "var(--akili-text-muted)" }}>Checking auto-enrichment…</div>
            )}
            {!enrichmentLoading && enrichment?.prose && (
                <div style={{
                    borderLeft: "3px solid var(--akili-accent)",
                    paddingLeft: 10,
                    color: "var(--akili-text-primary)",
                    fontSize: 12,
                    lineHeight: 1.55,
                    whiteSpace: "pre-wrap",
                }}>
                    {enrichment.prose}
                </div>
            )}
            {!enrichmentLoading && !enrichment?.prose && (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <button
                        onClick={handleAnalyse}
                        disabled={analysing}
                        style={{
                            background: "rgba(26,110,181,0.2)",
                            border: "1px solid rgba(26,110,181,0.5)",
                            color: "#e8edf2",
                            padding: "6px 12px",
                            borderRadius: 6,
                            fontSize: 11,
                            cursor: analysing ? "default" : "pointer",
                        }}
                    >
                        {analysing ? "Analysing…" : "Analyse"}
                    </button>
                    {error && <span style={{ fontSize: 11, color: "#ef4444" }}>{error}</span>}
                </div>
            )}
            {inspectorExtensions.map((Ext, i) => (
                <Ext key={i} recordRef={null} record={item} />
            ))}
        </div>
    )
}
