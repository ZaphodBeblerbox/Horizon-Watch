import { useState, useEffect } from "react"
import API_BASE from "../apiBase.js"
import { entityMarkerSvg } from "../globe/entityIcons.js"
import { normalizeEntity } from "../inspector/adapters.js"
import { Panel, Button, EmptyState } from "../ui/index.js"
import { useInspectorExtensions } from "../inspector/extensionRegistry.js"
import { linkifyText } from "../lib/linkifyText.jsx"

// Best-effort entityType -> reference-grammar kind (src/lib/ref.js), used
// only to give registered extensions a real recordRef to key off of.
// Types with no clean 1:1 mapping (news/event/infra/eez/cable/fusion/
// airport/port/sentinel_detection/chokepoint) get recordRef=null — real,
// honest "no reference for this yet," not a guessed/fabricated one.
const ENTITY_TYPE_TO_REF_KIND = { vessel: "trk", aircraft: "trk", alert: "sig", zone: "aoi" }

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
 *     style:              object — optional style override for the root panel
 *   }
 *
 * All callback props are optional and no-op by default — this component
 * only ever invokes them, it never decides what they do.
 *
 * Docked per the full-UI-rebuild spec section 7 exactly: 340px wide, full
 * height, --bg-panel background, 1px --border on the left edge. Closes on
 * Escape (spec section 7's exclusivity rules) — the "close on destination
 * change" half of those rules is the caller's responsibility (this
 * component doesn't know what a "destination" is), see GlobePopup.jsx.
 */

// Theming regression fix, follow-up correction: this self-docking
// (non-`bare`) shell is the real "Inspector pane" reported as not
// translucent (Dashboard.jsx/MapTab.jsx's floating-over-the-map case, via
// GlobePopup's default dockExternally=false path) — it was a flat
// var(--bg-panel) (== --bg-1, fully opaque), unlike the `bare` path which
// correctly relies on the caller's own real `.pane-glass` shell
// (Situation.jsx). Now matched to --map-tooltip-bg + the exact real
// blur/saturate recipe .vessel-popup's own floating card uses (src/
// index.css) — the SAME real translucent treatment every map hover
// bar/popup already uses, per direct user correction, rather than
// `.pane-glass`'s own more see-through tint (a deliberately different,
// more transparent treatment reserved for Situation/Dossiers' large side
// panes). Shell only — the header/attributes/buttons rendered inside stay
// exactly as opaque/flat as before.
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
    background: "var(--map-tooltip-bg)",
    backdropFilter: "blur(20px) saturate(1.4)",
    WebkitBackdropFilter: "blur(20px) saturate(1.4)",
    borderLeft: "1px solid var(--border)",
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
            <span style={{ color: "var(--text-primary)", textAlign: "right", wordBreak: "break-word" }}>{linkifyText(value)}</span>
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
    onTrackEntity = null,
    style,
    slideOut = false,
    // When true, this component renders as a plain flex-column filling
    // whatever container the caller already provides (a real `.pane-glass`
    // shell — see Situation.jsx) instead of its own fixed-position/
    // hardcoded-width/keyframe-animated dock. The caller's own shell owns
    // width, background, minimize-to-rail and the slide transition; this
    // component still owns everything else (header/attributes/provenance/
    // related entities/actions) unchanged. Default false preserves the
    // exact original self-docking behavior for callers that haven't been
    // folded into the shared pane system yet (GlobePopup's dockExternally
    // default-false path — Dashboard.jsx, MapTab.jsx).
    bare = false,
}) {
    const [links, setLinks] = useState([])
    const [linksLoading, setLinksLoading] = useState(false)
    const [linksError, setLinksError] = useState(false)

    // Real GeoConfirmed-specific connections (fix/geoconfirmed-parallax-
    // rebuild, Part 2) — the SQL OntologyLink-backed `links` fetch above
    // has no rows for a GeoConfirmed pin (that store never modeled these
    // ids at all), so this reuses the SAME forge_ontology.json endpoint
    // the Ontology graph's own entity panel uses (never a second, separate
    // "what's near this pin" query that could disagree with it). Lists
    // every real specific link this pin has, including ones with no real
    // map coordinates (a Country/Faction) — those just never got a drawn
    // connector line (see GlobeConnectorLinesLayer.jsx), they still show here.
    const [forgeConnections, setForgeConnections] = useState([])
    const [forgeConnectionsLoading, setForgeConnectionsLoading] = useState(false)
    useEffect(() => {
        setForgeConnections([])
        if (entityType !== "geoconfirmed" || !entityId) return
        const forgeId = entityId.replace(/^geoconfirmed-/, "geoconfirmed_")
        let cancelled = false
        setForgeConnectionsLoading(true)
        fetch(`${API_BASE}/api/forge/ontology/node/${encodeURIComponent(forgeId)}/connections`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (!cancelled) setForgeConnections(d?.connections || []) })
            .catch(() => { if (!cancelled) setForgeConnections([]) })
            .finally(() => { if (!cancelled) setForgeConnectionsLoading(false) })
        return () => { cancelled = true }
    }, [entityType, entityId])

    // V3 Phase 1, §2.2 — the real hook-based extension point. This
    // component (the owner) calls every registered extension itself, from
    // inside its own render, below. Nothing external ever reassigns or
    // wraps this function — that was the reference document's whole
    // point: a wrapped export stops firing the moment the owner's
    // internal call sites (unaffected by an outside reassignment) render
    // again. Zero real extensions are registered as of Phase 1.
    const inspectorExtensions = useInspectorExtensions()
    const refKind = ENTITY_TYPE_TO_REF_KIND[entityType]
    const recordRef = refKind && entityId ? `${refKind}:${entityId}` : null

    // Real airline/aircraft-type/registration (hexdb.io, via GET
    // /api/aviation/route/{icao24}) and a real reference photo
    // (Planespotters.net, via GET /api/aviation/photo/{icao24}) — both real
    // lookups keyed by ICAO24, not AI/vision-derived (no such pipeline
    // exists in this codebase). Reset to null on every entity change so a
    // stale aircraft's enrichment never bleeds into the next one; left null
    // (never a fake/placeholder value) when nothing real comes back.
    const [aircraftInfo, setAircraftInfo] = useState(null)
    useEffect(() => {
        setAircraftInfo(null)
        if (entityType !== "aircraft" || !entityId) return
        let cancelled = false
        Promise.all([
            fetch(`${API_BASE}/api/aviation/route/${encodeURIComponent(entityId)}`).then(r => r.ok ? r.json() : {}).catch(() => ({})),
            fetch(`${API_BASE}/api/aviation/photo/${encodeURIComponent(entityId)}`).then(r => r.ok ? r.json() : {}).catch(() => ({})),
        ]).then(([route, photo]) => {
            if (cancelled) return
            const merged = { ...route, ...photo }
            const hasReal = Object.values(merged).some(v => v != null)
            setAircraftInfo(hasReal ? merged : null)
        })
        return () => { cancelled = true }
    }, [entityType, entityId])

    // aircraftInfo fills gaps only — spread first so any real field the raw
    // ADS-B `data` already carries (e.g. a live-feed registration) always
    // wins over the hexdb.io fallback lookup for the same key.
    const enrichedData = (entityType === "aircraft" && aircraftInfo) ? { ...aircraftInfo, ...data } : data
    const normalized = normalizeEntity(entityType, enrichedData)
    const { identity, attributes, provenance, actions, media, description } = normalized

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

    // Full-UI-rebuild spec section 7: "Pressing Escape... closes the
    // inspector entirely." Self-contained here since this component always
    // represents "the one open inspector" whenever it's mounted at all.
    useEffect(() => {
        const onKey = (e) => { if (e.key === "Escape") onClose() }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [onClose])

    const iconSvg = entityMarkerSvg({
        entityType: identity.entityType,
        subtype: identity.subtype,
        sanctionsStatus: identity.sanctionsStatus,
        size: 36,
    })

    // `bare`: a plain, backgroundless/borderless flex-column — the parent
    // `.pane-glass` shell (Situation.jsx) is the only real background/
    // border here. Panel's own panelStyle() always applies an opaque
    // `--bg-secondary` fill plus a border (no documented way to opt out),
    // which would sit on top of and completely hide the shell's actual
    // frosted-glass blur — so bare mode renders a plain div instead of
    // <Panel>, not <Panel elevation={0}>.
    const Wrapper = bare ? "div" : Panel
    const wrapperProps = bare
        ? { style: { width: "100%", height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", ...style } }
        : {
            as: "div", elevation: 2, padded: false,
            className: slideOut ? "inspector-panel-slide-out" : "inspector-panel-slide-in",
            style: { ...DEFAULT_DOCK_STYLE, ...style, pointerEvents: slideOut ? "none" : undefined },
        }

    return (
        <Wrapper {...wrapperProps}>
            {/* Slides in from the right on mount — same short, no-bounce
                120-160ms ease-out timing used elsewhere in the app (e.g.
                app.jsx's "opacity 150ms ease"), not the unrelated 400ms
                Director-panel entrance. Mirrors Dashboard.jsx's own Watch
                Queue slide-OUT transition so the two read as one motion:
                the inspector takes the Watch Queue's place, it doesn't pop
                in on top of it.

                slideOut (GlobePopup.jsx) briefly renders the OUTGOING
                entity's panel with the reverse animation while the new one
                slides in on top, for the case where the docked panel is
                already open and a different entity is clicked — previously
                that just swapped content in the same mounted instance with
                no transition at all, since only first-mount ever played
                the slide-in keyframe.

                None of this applies in `bare` mode: the caller's own
                `.pane-glass` shell (Situation.jsx) already owns a real
                transition-based slide for its whole pane, so a second,
                keyframe-based slide on the content inside it would fight
                the shell's own transition rather than compose with it. */}
            {!bare && (
                <style>{`
                    @keyframes inspector-panel-slide-in { from { transform: translateX(100%); } to { transform: translateX(0); } }
                    @keyframes inspector-panel-slide-out { from { transform: translateX(0); } to { transform: translateX(100%); } }
                    .inspector-panel-slide-in { animation: inspector-panel-slide-in 150ms ease-out; }
                    .inspector-panel-slide-out { animation: inspector-panel-slide-out 150ms ease-out forwards; }
                `}</style>
            )}
            {/* Header */}
            <div style={{
                display: "flex", alignItems: "flex-start", gap: "var(--space-2)",
                padding: "var(--space-3) var(--space-4)",
                borderBottom: "var(--elevation-1)",
                flexShrink: 0,
            }}>
                <div
                    style={{ flexShrink: 0, width: 36, height: 36 }}
                    // entityMarkerSvg() is a pure, trusted, locally-generated SVG
                    // string (src/globe/entityIcons.js) — not user-controlled HTML.
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
                {/* Real reference photo (aircraft only, only when one really
                    exists for this aircraft — see adaptAircraft's `media`) */}
                {media?.photoUrl && (
                    <div style={{ marginBottom: "var(--space-4)" }}>
                        <img
                            src={media.photoUrl}
                            alt={identity.title}
                            style={{ width: "100%", borderRadius: "var(--radius)", display: "block" }}
                        />
                        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)", marginTop: 4 }}>
                            {[media.photographer && `Photo: ${media.photographer}`, media.sourceLabel].filter(Boolean).join(" · ")}
                        </div>
                    </div>
                )}

                {/* Real, complete, untruncated description/context text —
                    the header title is deliberately short (single-line,
                    ellipsis-truncated by design); this is the one real
                    place the full text always renders, wrapping normally.
                    Only present when an adapter actually has one (see
                    adaptGeoConfirmed) — never fabricated. */}
                {description && (
                    <div style={{ marginBottom: "var(--space-4)" }}>
                        <SectionLabel>Description</SectionLabel>
                        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                            {description}
                        </div>
                    </div>
                )}

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

                {/* Real GeoConfirmed-specific links (Part 2) — separate
                    from the generic "Related entities" section below,
                    since this is forge_ontology.json-sourced, real, and
                    specific (a real ORBAT faction, a real nearby
                    chokepoint), not the SQL OntologyLink store's shape. */}
                {entityType === "geoconfirmed" && (
                    <div style={{ marginBottom: "var(--space-4)" }}>
                        <SectionLabel>Real linked entities</SectionLabel>
                        {forgeConnectionsLoading ? (
                            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-dim)" }}>Loading…</div>
                        ) : forgeConnections.length > 0 ? (
                            forgeConnections.map((c) => (
                                <div key={c.id} style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", padding: "3px 0" }}>
                                    <span style={{ color: "var(--text-dim)", textTransform: "uppercase", fontSize: "var(--text-xs)", marginRight: 6 }}>{c.type}</span>
                                    {c.label}
                                    <span style={{ color: "var(--text-dim)", fontSize: "var(--text-xs)", marginLeft: 6 }}>
                                        ({c.relationship_type}{c.lat == null ? ", no map position" : ""})
                                    </span>
                                </div>
                            ))
                        ) : (
                            <EmptyState description="No real specific links found for this pin." />
                        )}
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

                {/* V3 Phase 1, §2.2 — real extensions render here, called by
                    the owner (this component), never injected from outside. */}
                {inspectorExtensions.map((Ext, i) => (
                    <Ext key={i} recordRef={recordRef} record={data} />
                ))}
            </div>

            {/* Actions */}
            {(actions.canJumpToLocation || (onTrackEntity && entityId)) && (
                <div style={{
                    display: "flex", gap: "var(--space-2)", flexWrap: "wrap",
                    padding: "var(--space-3) var(--space-4)",
                    borderTop: "var(--elevation-1)", flexShrink: 0,
                }}>
                    {actions.canJumpToLocation && (
                        <Button variant="ghost" size="sm" style={{ flex: 1 }} onClick={() => onJumpToLocation(data)}>
                            Jump to globe
                        </Button>
                    )}
                    {onTrackEntity && entityId && (
                        <Button variant="ghost" size="sm" style={{ flex: 1 }} onClick={() => onTrackEntity(entityId)}>
                            Track on globe
                        </Button>
                    )}
                </div>
            )}
        </Wrapper>
    )
}
