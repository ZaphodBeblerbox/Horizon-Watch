import { useState, useEffect, useCallback } from "react"
import { API_BASE } from "../apiBase.js"

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

const INFRA_ICON = {
    airport:     "✈",
    port:        "⚓",
    power_plant: "⚡",
    hospital:    "✚",
    military:    "★",
    pipeline:    "⛓",
    chokepoint:  "◆",
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
                                fontSize: 9,
                                color: "var(--akili-accent)",
                            }}>
                                {INFRA_ICON[n.type] || "◆"}
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
        </div>
    )
}
