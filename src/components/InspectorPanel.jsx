import { useState, useEffect } from "react"
import API_BASE from "../apiBase.js"
import { markerSvg } from "../globe/markerRenderer.js"
import { normalizeEntity } from "../inspector/adapters.js"
import { Panel, Button, EmptyState } from "../ui/index.js"

/**
 * InspectorPanel — the single, unified entity detail panel that replaces the
 * ~9 bespoke Globe*Popup / SurfaceDetailPanel components (GlobeVesselPopup,
 * GlobeAlertPopup, GlobeEventPopup, GlobeEEZPopup, GlobeCablePopup,
 * GlobeInfraPopup, GlobeHeatmapPopup, GlobeAssessmentPopup, GlobeFusionPopup,
 * GlobeAirportPopup, GlobePortPopup, GlobeChokepointPopup,
 * SentinelDetectionPopup, SurfaceDetailPanel).
 *
 * This component is intentionally NOT wired into app.jsx or GlobePopup.jsx —
 * that integration (deleting/rewiring the old dispatch in GlobePopup.jsx,
 * replacing SurfaceDetailPanel's rightPanel slot) happens in a later step.
 * This file only needs to be correct and ready to drop in.
 *
 * Docking: unlike the old popups (floating at an x/y screen position next to
 * the clicked entity), this is a fixed, docked panel — right-side by default,
 * matching app.jsx's existing `rightPanel` slot convention. Pass `style` to
 * override placement if the integrator embeds it differently (e.g. inside an
 * existing flex rightPanel container instead of as a fixed overlay).
 *
 * Prop shape (the "normalized entity descriptor"):
 *   {
 *     entityType:      string   — e.g. "vessel" | "aircraft" | "alert" | "zone" |
 *                                 "news" | "event" | "infra" | ...anything else
 *                                 (mirrors GlobePopup.jsx's popup.type)
 *     entityId:        string   — used for the /links and /profile-style fetch
 *                                 and passed back through the on* callbacks
 *     data:            object   — whatever raw payload the caller already has
 *                                 from the click (same shape the old bespoke
 *                                 popup for that type received as `data`)
 *     onClose:            () => void
 *     onSelectRelated:    (entityType, entityId) => void
 *     onJumpToLocation:   (data) => void
 *     onOpenInOntology:   (entityType, entityId) => void
 *     style:              object — optional style override for the root panel
 *   }
 *
 * All callback props are optional and no-op by default — this component
 * only ever invokes them, it never decides what they do.
 */

const DEFAULT_DOCK_STYLE = {
    position: "fixed",
    top: 0,
    right: 0,
    bottom: 0,
    width: 340,
    maxWidth: "100%",
    zIndex: 1400,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
}

function noop() {}

function SectionLabel({ children }) {
    return (
        <div style={{
            fontSize: "var(--text-xs)", fontWeight: "var(--weight-semibold)",
            color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.08em",
            marginBottom: "var(--space-2)",
        }}>
            {children}
        </div>
    )
}

function AttributeRow({ label, value }) {
    return (
        <div style={{
            display: "flex", justifyContent: "space-between", gap: "var(--space-2)",
            padding: "5px 0", borderBottom: "1px solid var(--border-dim)",
            fontSize: "var(--text-sm)",
        }}>
            <span style={{ color: "var(--text-secondary)", flexShrink: 0 }}>{label}</span>
            <span style={{ color: "var(--text-primary)", textAlign: "right", wordBreak: "break-word" }}>{value}</span>
        </div>
    )
}

function RelatedLinkRow({ link, onSelectRelated }) {
    const name = link.entity_name || link.entity_id || link.source_id || "Related entity"
    const linkType = (link.link_type || "").replace(/_/g, " ")
    const distance = link.distance_km != null ? `${Number(link.distance_km).toFixed(1)} km` : null
    return (
        <button
            onClick={() => onSelectRelated(link.entity_type, link.entity_id)}
            style={{
                display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2,
                width: "100%", textAlign: "left", padding: "6px 8px", marginBottom: 4,
                background: "transparent", border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius)", cursor: "pointer", fontFamily: "var(--font-sans)",
            }}
        >
            <span style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", fontWeight: "var(--weight-semibold)" }}>
                {name}
            </span>
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)" }}>
                {[linkType, distance].filter(Boolean).join(" · ")}
            </span>
        </button>
    )
}

export default function InspectorPanel({
    entityType,
    entityId,
    data,
    onClose = noop,
    onSelectRelated = noop,
    onJumpToLocation = noop,
    onOpenInOntology = noop,
    style,
}) {
    const [links, setLinks] = useState([])
    const [linksLoading, setLinksLoading] = useState(false)
    const [linksError, setLinksError] = useState(false)

    const normalized = normalizeEntity(entityType, data)
    const { identity, attributes, provenance, actions } = normalized

    useEffect(() => {
        if (!entityType || !entityId) { setLinks([]); setLinksError(false); return }
        let cancelled = false
        setLinksLoading(true)
        setLinksError(false)
        fetch(`${API_BASE}/api/entities/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}/links`)
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad status"))))
            .then((d) => { if (!cancelled) setLinks(Array.isArray(d) ? d : []) })
            .catch(() => { if (!cancelled) { setLinks([]); setLinksError(true) } })
            .finally(() => { if (!cancelled) setLinksLoading(false) })
        return () => { cancelled = true }
    }, [entityType, entityId])

    const iconSvg = markerSvg({ affiliation: identity.affiliation, entityFunction: identity.entityFunction, size: 36 })

    return (
        <Panel
            as="div"
            elevation={2}
            padded={false}
            style={{ ...DEFAULT_DOCK_STYLE, ...style }}
        >
            {/* Header */}
            <div style={{
                display: "flex", alignItems: "flex-start", gap: "var(--space-2)",
                padding: "var(--space-3) var(--space-4)",
                borderBottom: "var(--elevation-1)",
                flexShrink: 0,
            }}>
                <div
                    style={{ flexShrink: 0, width: 36, height: 36 }}
                    // markerSvg() is a pure, trusted, locally-generated SVG string
                    // from Round 1's markerRenderer.js — not user-controlled HTML.
                    dangerouslySetInnerHTML={{ __html: iconSvg }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                        fontSize: "var(--text-lg)", fontWeight: "var(--weight-bold)",
                        color: "var(--text-primary)", lineHeight: 1.3,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                        {identity.title}
                    </div>
                    {identity.subtitle && (
                        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)", marginTop: 2 }}>
                            {identity.subtitle}
                        </div>
                    )}
                </div>
                <button
                    onClick={onClose}
                    aria-label="Close"
                    style={{
                        background: "none", border: "none", color: "var(--text-secondary)",
                        cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 0, flexShrink: 0,
                    }}
                >×</button>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-3) var(--space-4)" }}>
                {/* Key attributes */}
                {attributes.length > 0 && (
                    <div style={{ marginBottom: "var(--space-4)" }}>
                        <SectionLabel>Attributes</SectionLabel>
                        {attributes.map((a) => (
                            <AttributeRow key={a.label} label={a.label} value={a.value} />
                        ))}
                    </div>
                )}

                {/* Provenance */}
                {provenance && (provenance.feed || provenance.ingestedAt) && (
                    <div style={{ marginBottom: "var(--space-4)" }}>
                        <SectionLabel>Provenance</SectionLabel>
                        {provenance.feed && <AttributeRow label="Feed" value={provenance.feed} />}
                        {provenance.ingestedAt && <AttributeRow label="Ingested" value={provenance.ingestedAt} />}
                    </div>
                )}

                {/* Related links */}
                <div style={{ marginBottom: "var(--space-4)" }}>
                    <SectionLabel>Related entities</SectionLabel>
                    {linksLoading ? (
                        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-dim)" }}>Loading…</div>
                    ) : links.length > 0 ? (
                        links.map((link) => (
                            <RelatedLinkRow key={link.link_id ?? `${link.entity_type}-${link.entity_id}-${link.source_id}`} link={link} onSelectRelated={onSelectRelated} />
                        ))
                    ) : (
                        <EmptyState
                            description={linksError ? "Couldn't load related entities." : "No related entities found."}
                        />
                    )}
                </div>
            </div>

            {/* Actions */}
            {(actions.canJumpToLocation || actions.canOpenInOntology) && (
                <div style={{
                    display: "flex", gap: "var(--space-2)",
                    padding: "var(--space-3) var(--space-4)",
                    borderTop: "var(--elevation-1)", flexShrink: 0,
                }}>
                    {actions.canJumpToLocation && (
                        <Button variant="ghost" size="sm" style={{ flex: 1 }} onClick={() => onJumpToLocation(data)}>
                            Jump to globe
                        </Button>
                    )}
                    {actions.canOpenInOntology && (
                        <Button variant="ghost" size="sm" style={{ flex: 1 }} onClick={() => onOpenInOntology(entityType, entityId)}>
                            Open in Forge ontology view
                        </Button>
                    )}
                </div>
            )}
        </Panel>
    )
}
