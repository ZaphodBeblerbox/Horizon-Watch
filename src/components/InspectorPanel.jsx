import { addToBriefing } from "../state/briefingBasket.js"
import { toast } from "../ui/toast.js"
import { useState, useEffect } from "react"
import API_BASE from "../apiBase.js"
import { entityMarkerSvg } from "../globe/entityIcons.js"
import EntityLinksPanel from "./EntityLinksPanel.jsx"
import { normalizeEntity } from "../inspector/adapters.js"
import { Panel, Button } from "../ui/index.js"
import { useInspectorExtensions } from "../inspector/extensionRegistry.js"
import { buildOntologyRecord, traceRationale } from "../inspector/ontologyRecord.js"
import { linkifyText } from "../lib/linkifyText.jsx"
import Loading from "../ui/Loading.jsx"
import MaritimeAreaSection from "./MaritimeAreaSection.jsx"
import ChokepointFlowSection from "./ChokepointFlowSection.jsx"
import VesselHistorySection from "./VesselHistorySection.jsx"
import SectionLabel from "../inspector/SectionLabel.jsx"
import { embedFor, hostOf, openSource, splitSources } from "../inspector/sourceEmbed.js"

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
    // The bars are absolute limits: this docked panel begins where the top
    // bar ends and ends where the status bar begins. top:0 put its header
    // underneath the top bar, and bottom:0 ran it under the status bar.
    top: "var(--top, 40px)",
    right: 0,
    bottom: "var(--status, 0px)",
    width: 340,
    maxWidth: "100%",
    zIndex: 1400,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    background: "var(--map-tooltip-bg)",
    borderLeft: "1px solid var(--border)",
}

function noop() {}

/**
 * The place a signal is about, for scoping the shared forecast board.
 *
 * Returns null when there is nothing to scope by, so the button is
 * absent rather than present and inert — an action that opens the wrong
 * board is worse than one that is not offered.
 */
export function forecastHint(data) {
    if (!data) return null
    const v = data.country_name || data.country || data.region || data.aoi
    const s = String(v || "").trim()
    return s.length >= 3 ? s : null
}

/** One cited source: what it is, where it lives, and how to read it.
 *  X and Telegram posts open beside the record (SourceViewer); anything
 *  else cannot be framed and opens in a tab. */
function SourceRow({ label, url }) {
    const inPlace = !!embedFor(url)
    const btn = {
        height: 24, padding: "0 9px", font: "500 11.5px var(--font)", cursor: "pointer",
        border: "1px solid var(--gline2, var(--line))", background: "transparent",
        color: "var(--acc-hi, var(--acchi))", textDecoration: "none",
        display: "inline-flex", alignItems: "center", whiteSpace: "nowrap",
    }
    return (
        <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "6px 0",
            borderBottom: "1px solid var(--border-dim)",
        }}>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)" }}>{label}</div>
                <div style={{ font: "400 10.5px var(--mono)", color: "var(--txt-4, var(--text-dim))",
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={url}>
                    {hostOf(url)}
                </div>
            </div>
            {inPlace && <button style={btn} onClick={() => openSource(url)}>Open here</button>}
            <a style={{ ...btn, border: 0, padding: 0 }} href={url} target="_blank" rel="noopener noreferrer" title={url}>
                {inPlace ? "↗" : "Open ↗"}
            </a>
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

/** §10.4's trace block: instance · type · origin · licence · source ref ·
 *  ingested, then the edges as mono chips, then the one-line rationale. */
function OntologyRecordBlock({ entityType, data }) {
    const rec = buildOntologyRecord(entityType, data || {})
    const tagStyle = (ok) => ({
        font: "9.5px var(--mono)", letterSpacing: ".08em", textTransform: "uppercase",
        padding: "1px 5px", border: "1px solid var(--line)",
        color: ok ? "var(--txt-2)" : "var(--amber)", background: "var(--bg-2)",
    })
    // FOLDED, NOT HIDDEN. Every record still carries its trace (§10.4), but
    // a UUID and a type slug are not what someone opening a pin came for.
    // The summary line says whether the trace is complete, so an
    // untraceable record still announces itself without being opened.
    return (
        <details style={{ marginBottom: "var(--space-4)", borderTop: "1px solid var(--line-soft)", paddingTop: "var(--space-3)" }}>
            <summary style={{ cursor: "pointer", listStyle: "revert" }}>
                <SectionLabel style={{ display: "inline-flex", marginBottom: 0 }}
                    meta={rec.complete ? "traced" : "incomplete trace"}>Record details</SectionLabel>
            </summary>
            <div style={{ marginTop: 8 }}>
            <AttributeRow label="Instance" value={rec.instance || "— none —"} />
            <AttributeRow label="Type" value={rec.type || "— untyped —"} />
            <div style={{ display: "flex", gap: 5, margin: "4px 0 6px", flexWrap: "wrap" }}>
                <span style={tagStyle(!!rec.originClass)} title={rec.originMeaning || "No origin class on this record"}>
                    origin {rec.originClass || "?"}
                </span>
                <span style={tagStyle(!!rec.licenceTier)} title={rec.licenceMeaning || "No licence tier on this record"}>
                    {rec.licenceTier || "licence ?"}
                </span>
            </div>
            <AttributeRow
                label="Source ref"
                value={rec.sourceRef.length ? rec.sourceRef.slice(0, 4).join(", ") + (rec.sourceRef.length > 4 ? ` +${rec.sourceRef.length - 4}` : "") : "— none cited —"}
            />
            {rec.ingested && <AttributeRow label="Ingested" value={rec.ingested} />}
            {rec.edges.length > 0 && (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 5 }}>
                    {rec.edges.map((e) => (
                        <span key={e} style={{
                            font: "9.5px var(--mono)", padding: "1px 5px",
                            border: "1px solid var(--line)", color: "var(--txt-3)",
                        }}>{e}</span>
                    ))}
                </div>
            )}
            <p style={{
                margin: "7px 0 0", font: "400 10.5px var(--font)", lineHeight: 1.45,
                color: rec.complete ? "var(--txt-4)" : "var(--amber)",
            }}>
                {traceRationale(rec)}
            </p>
            </div>
        </details>
    )
}

/** A photograph that holds its place while it loads.
 *  The frame is drawn at its final size with the Parallax mark pulsing in it,
 *  so the panel does not jump when the picture arrives; a picture that fails
 *  removes the frame rather than leaving a broken image. `pending` draws the
 *  frame alone, for while the lookup itself is still running. */
function PhotoFrame({ src = null, alt = "", pending = false }) {
    const [loaded, setLoaded] = useState(false)
    const [failed, setFailed] = useState(false)
    useEffect(() => { setLoaded(false); setFailed(false) }, [src])
    if (failed) return null
    const waiting = pending || !loaded
    return (
        <div style={{
            position: "relative", width: "100%", borderRadius: "var(--radius)", overflow: "hidden",
            ...(waiting ? { aspectRatio: "16 / 10", background: "var(--bg-2, var(--glass2))", border: "1px solid var(--gline)" } : {}),
        }}>
            {waiting && (
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
                    <Loading size={34} label="Loading photograph" inline labelHidden />
                </div>
            )}
            {src && (
                // NOT loading="lazy": a lazy image that is display:none is
                // never fetched, so the frame waited forever for it.
                <img src={src} alt={alt}
                     onLoad={() => setLoaded(true)} onError={() => setFailed(true)}
                     style={{ width: "100%", display: loaded ? "block" : "none" }} />
            )}
        </div>
    )
}

// Entity kinds a reference photograph exists for. A chokepoint is a
// strait or canal and Wikipedia has a picture of every one of them; it
// was simply never asked.
const FACILITY_PHOTO_TYPES = new Set(["port", "airport", "chokepoint"])

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
    const [aircraftPending, setAircraftPending] = useState(false)
    useEffect(() => {
        setAircraftInfo(null)
        setAircraftPending(false)
        if (entityType !== "aircraft" || !entityId) return
        // THE ENTITY ID IS NOT THE ICAO24. GlobeADSBLayer registers each
        // aircraft as `adsb-<icao24>` to namespace it in the entity store, so
        // these lookups were asking Planespotters and hexdb for an airframe
        // called "adsb-4b1805" and getting nothing back — which is why the
        // exact-airframe photo quietly stopped appearing.
        const icao24 = String(entityId).replace(/^adsb-/i, "")
        let cancelled = false
        setAircraftPending(true)
        Promise.all([
            fetch(`${API_BASE}/api/aviation/route/${encodeURIComponent(icao24)}`).then(r => r.ok ? r.json() : {}).catch(() => ({})),
            fetch(`${API_BASE}/api/aviation/photo/${encodeURIComponent(icao24)}`).then(r => r.ok ? r.json() : {}).catch(() => ({})),
            // The live record with everything the feed sent (squawk,
            // climb, selected altitude, airspeeds, integrity, flags) —
            // kept out of the map payload, fetched here on open.
            fetch(`${API_BASE}/api/adsb/aircraft/${encodeURIComponent(icao24)}`).then(r => r.ok ? r.json() : {}).catch(() => ({})),
        ]).then(([route, photo, live]) => {
            if (cancelled) return
            setAircraftPending(false)
            const merged = { ...route, ...photo, ...live }
            const hasReal = Object.values(merged).some(v => v != null)
            setAircraftInfo(hasReal ? merged : null)
        })
        return () => { cancelled = true }
    }, [entityType, entityId])

    /**
     * Vessel reference photo. There was no photo lookup for ships at all in
     * the inspector, and the backend's only source — MarineTraffic's photo
     * CDN — now times out on every request, so it would not have worked if
     * there had been. Wikimedia covers named vessels; a ship with no name in
     * the AIS record cannot be looked up by anything, and says so.
     */
    // (The fetch itself sits below the registry lookup, which supplies the IMO.)

    /**
     * Registered owner (GFW vessel registry, GET /api/vessels/{mmsi}/owner)
     * — the hop the flag hides. Fetched on open, reset on every change so
     * one ship's owner never bleeds into the next.
     */
    const [vesselOwner, setVesselOwner] = useState(null)
    useEffect(() => {
        setVesselOwner(null)
        const mmsi = entityType === "vessel" ? String(data?.mmsi || "") : ""
        if (!mmsi) return
        let cancelled = false
        fetch(`${API_BASE}/api/vessels/${encodeURIComponent(mmsi)}/owner`)
            .then(r => (r.ok ? r.json() : null))
            .then(d => { if (!cancelled && d) setVesselOwner(d) })
            .catch(() => {})
        return () => { cancelled = true }
    }, [entityType, entityId]) // eslint-disable-line react-hooks/exhaustive-deps

    // THE IMO GOES WITH THE NAME. Without it the photo service matched on
    // the name alone and showed whatever shared it — a supermarket for
    // "PACITA", a rocket model for "DELTA-D". It is taken from the AIS
    // record or, once loaded, the registry, and the effect re-runs then.
    const [vesselPhoto, setVesselPhoto] = useState(null)
    const [vesselPending, setVesselPending] = useState(false)
    const vesselImo = entityType === "vessel" ? (data?.imo || vesselOwner?.registry?.imo || "") : ""
    useEffect(() => {
        setVesselPhoto(null)
        if (entityType !== "vessel") return
        const shipName = data?.name || data?.shipname || data?.vessel_name
        if (!shipName) return
        let cancelled = false
        const q = new URLSearchParams({ kind: "vessel", name: shipName, ...(vesselImo ? { imo: vesselImo } : {}) })
        setVesselPending(true)
        fetch(`${API_BASE}/api/reference-image?${q}`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (!cancelled && d?.available) setVesselPhoto(d) })
            .catch(() => {})
            .finally(() => { if (!cancelled) setVesselPending(false) })
        return () => { cancelled = true }
    }, [entityType, entityId, vesselImo]) // eslint-disable-line react-hooks/exhaustive-deps

    /**
     * Port and airport photographs.
     *
     * A picture of a terminal answers "what am I looking at" faster than any
     * table — berth layout, crane count, storage yard, runway configuration.
     * Nothing in the console showed one.
     *
     * The image is never generated and never a stock placeholder: it is a
     * real photograph of that named facility from Wikimedia, or nothing.
     */
    const [facilityPhoto, setFacilityPhoto] = useState(null)
    const [facilityPending, setFacilityPending] = useState(false)
    useEffect(() => {
        setFacilityPhoto(null)
        setFacilityPending(false)
        if (!FACILITY_PHOTO_TYPES.has(entityType)) return
        // THE FIELD NAMES ARE NOT THE ONES THIS WAS ASKING FOR. An airport
        // record carries airport_name / icao_code / iata_code, and none of
        // `name`, `iata` or `icao` exists on it — so `facility` was always
        // undefined, the effect returned immediately, and no airport has
        // ever requested a photograph. Ports use port_name, which was
        // covered; chokepoints were never wired at all.
        const facility = data?.name || data?.port_name || data?.airport_name
            || data?.icao_code || data?.iata_code || data?.ident
            || data?.iata || data?.icao
        if (!facility) return
        let cancelled = false
        setFacilityPending(true)
        fetch(`${API_BASE}/api/reference-image?kind=${entityType}&name=${encodeURIComponent(facility)}`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (!cancelled && d?.available) setFacilityPhoto(d) })
            .catch(() => {})
            .finally(() => { if (!cancelled) setFacilityPending(false) })
        return () => { cancelled = true }
    }, [entityType, entityId]) // eslint-disable-line react-hooks/exhaustive-deps

    /**
     * A country's risk score, explained.
     *
     * A band on a choropleth is unarguable and unactionable: "Ukraine 83"
     * invites no next step. Three things make it usable and all three
     * already existed server-side — the score's own decomposition, the
     * EVENTS that produced it, and what the wires are saying now. The
     * panel showed none of them because the type was not even clickable.
     */
    const [countryDetail, setCountryDetail] = useState(null)
    useEffect(() => {
        setCountryDetail(null)
        if (entityType !== "country_risk") return
        const iso = data?.iso3 || data?.iso_code
        if (!iso) return
        let cancelled = false
        fetch(`${API_BASE}/api/risk-index/country/${encodeURIComponent(iso)}/explain?limit=6`,
              { credentials: "include" })
            .then(r => (r.ok ? r.json() : null))
            .then(d => { if (!cancelled && d && !d.detail) setCountryDetail(d) })
            .catch(() => {})
        return () => { cancelled = true }
    }, [entityType, entityId]) // eslint-disable-line react-hooks/exhaustive-deps

    // aircraftInfo fills gaps only — spread first so any real field the raw
    // ADS-B `data` already carries (e.g. a live-feed registration) always
    // wins over the hexdb.io fallback lookup for the same key.
    const enrichedData = (entityType === "aircraft" && aircraftInfo) ? { ...aircraftInfo, ...data }
        // The registry's IMO/callsign fill gaps only; the live record wins.
        : (entityType === "vessel" && vesselOwner)
            ? { ...(vesselOwner.registry || {}), ...data, ownership: vesselOwner }
            : data
    const normalized = normalizeEntity(entityType, enrichedData)
    const { identity, provenance, actions, media, description } = normalized
    const [titleOpen, setTitleOpen] = useState(false)
    useEffect(() => { setTitleOpen(false) }, [entityId])
    // ~3 lines of the 17px headline in a ~260px column.
    const titleLong = String(identity.title || "").length > 80
    // Citations leave the attribute table for their own list (see SourceRow).
    const { attributes, sources } = splitSources(normalized.attributes)

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
                {countryDetail?.flag_url ? (
                    // THE FLAG IS THE FASTEST IDENTIFIER THERE IS. A marker
                    // glyph here says "country", which the reader already
                    // knows; the flag says which one, before the title is
                    // read. Public-domain flags from flagcdn, no key.
                    <img
                        src={countryDetail.flag_url}
                        alt={countryDetail.country || identity.title}
                        style={{ flexShrink: 0, width: 36, height: 27, objectFit: "cover",
                                 borderRadius: 3, border: "1px solid var(--line)" }}
                        onError={(e) => { e.currentTarget.style.display = "none" }}
                    />
                ) : (
                    <div
                        style={{ flexShrink: 0, width: 36, height: 36 }}
                        // entityMarkerSvg() is a pure, trusted, locally-generated SVG
                        // string (src/globe/entityIcons.js) — not user-controlled HTML.
                        dangerouslySetInnerHTML={{ __html: iconSvg }}
                    />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                    {/* THE HEADLINE WRAPS. It was cut to one line, so a
                        record's title could only ever be a short label —
                        usually a date. Three lines hold what happened. */}
                    {/* Clamped at three lines; a longer one opens on click,
                        so the full text is never out of reach. */}
                    <div
                        onClick={() => setTitleOpen((o) => !o)}
                        title={titleLong && !titleOpen ? "Show the full headline" : undefined}
                        style={{
                            fontSize: 17, fontWeight: 650, letterSpacing: "-0.01em",
                            color: "var(--text-primary)", lineHeight: 1.3, wordBreak: "break-word",
                            cursor: titleLong ? "pointer" : "default",
                            ...(titleOpen ? {} : {
                                display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                            }),
                        }}>
                        {identity.title}
                    </div>
                    {identity.subtitle && (
                        <div style={{ font: "400 11px var(--font)", color: "var(--txt-3, var(--text-secondary))", marginTop: 4 }}>
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
                {/* ── what drove this country's score, and what is happening
                    there now. Kept as two clearly separated lists because
                    they are not the same kind of thing: the drivers ARE the
                    score's evidence, the articles did not feed it at all.
                    Blending them would imply the news justified the number. */}
                {countryDetail && (
                    <div style={{ marginBottom: "var(--space-4)" }}>
                        {countryDetail.drivers?.length > 0 && (
                            <>
                                <div style={{ font: "600 10px var(--mono)", color: "var(--text-secondary)",
                                              textTransform: "uppercase", letterSpacing: ".05em",
                                              marginBottom: 6 }}>
                                    What drove this score
                                    <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                                        {" "}· {countryDetail.events_in_window} event(s) in{" "}
                                        {countryDetail.window_days}d
                                    </span>
                                </div>
                                {countryDetail.drivers.map((d, i) => (
                                    <div key={i} style={{ padding: "5px 0",
                                                          borderBottom: "1px solid var(--line-soft)" }}>
                                        <div style={{ font: "400 11px var(--font)", color: "var(--text-primary)" }}>
                                            {d.source_url ? (
                                                <a href={d.source_url} target="_blank" rel="noopener noreferrer"
                                                   style={{ color: "inherit" }}>{d.title || d.event_type}</a>
                                            ) : (d.title || d.event_type)}
                                        </div>
                                        <div style={{ font: "400 10px var(--mono)", color: "var(--text-dim)" }}>
                                            {d.date} · {d.event_type}
                                            {d.goldstein != null ? ` · Goldstein ${d.goldstein}` : ""}
                                            {d.location ? ` · ${d.location}` : ""}
                                            {/* Whether a journalist wrote this line or this
                                                system generated it from CAMEO codes. */}
                                            {d.headline_is_article ? "" : " · machine-worded"}
                                        </div>
                                    </div>
                                ))}
                            </>
                        )}

                        {countryDetail.news?.length > 0 && (
                            <div style={{ marginTop: "var(--space-3)" }}>
                                <div style={{ font: "600 10px var(--mono)", color: "var(--text-secondary)",
                                              textTransform: "uppercase", letterSpacing: ".05em",
                                              marginBottom: 6 }}>
                                    Latest news
                                    <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                                        {" "}· RSS, did not affect the score
                                    </span>
                                </div>
                                {countryDetail.news.map((n, i) => (
                                    <div key={i} style={{ padding: "4px 0" }}>
                                        <a href={n.url} target="_blank" rel="noopener noreferrer"
                                           style={{ font: "400 11px var(--font)", color: "var(--text-primary)",
                                                    textDecoration: "none" }}>
                                            {n.title}
                                        </a>
                                        <div style={{ font: "400 10px var(--mono)", color: "var(--text-dim)" }}>
                                            {n.source}{n.published ? ` · ${String(n.published).slice(0, 16)}` : ""}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Reference photo. Aircraft carry the EXACT airframe from
                    Planespotters by ICAO24; vessels fall back to Wikimedia by
                    ship name, which is the vessel CLASS or that ship on
                    another day — so it is labelled as a reference image and
                    never presented as current imagery of this contact. */}
                {!media?.photoUrl && !facilityPhoto && !vesselPhoto
                    && (facilityPending || vesselPending || aircraftPending) && (
                    <div style={{ marginBottom: "var(--space-4)" }}><PhotoFrame pending /></div>
                )}
                {!media?.photoUrl && facilityPhoto?.thumbnail_url && (
                    <div style={{ marginBottom: "var(--space-4)" }}>
                        <PhotoFrame src={facilityPhoto.thumbnail_url} alt={facilityPhoto.title || identity.title} />
                        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)", marginTop: 4 }}>
                            Reference image · {facilityPhoto.title}
                            {facilityPhoto.page_url && (
                                <> · <a href={facilityPhoto.page_url} target="_blank" rel="noreferrer"
                                        style={{ color: "var(--text-dim)" }}>Wikimedia</a></>
                            )}
                        </div>
                    </div>
                )}
                {!media?.photoUrl && !facilityPhoto && vesselPhoto?.thumbnail_url && (
                    <div style={{ marginBottom: "var(--space-4)" }}>
                        <PhotoFrame src={vesselPhoto.thumbnail_url} alt={vesselPhoto.title || identity.title} />
                        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)", marginTop: 4 }}>
                            Reference image · {vesselPhoto.title}
                            {vesselPhoto.page_url && (
                                <> · <a href={vesselPhoto.page_url} target="_blank" rel="noreferrer"
                                        style={{ color: "var(--text-dim)" }}>Wikimedia</a></>
                            )}
                        </div>
                    </div>
                )}
                {media?.photoUrl && (
                    <div style={{ marginBottom: "var(--space-4)" }}>
                        <PhotoFrame src={media.photoUrl} alt={identity.title} />
                        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-dim)", marginTop: 4 }}>
                            {[media.photographer && `Photo: ${media.photographer}`].filter(Boolean).join(" · ")}
                            {media.linkUrl ? (
                                <> · <a href={media.linkUrl} target="_blank" rel="noreferrer"
                                        style={{ color: "var(--text-dim)" }}>{media.sourceLabel}</a></>
                            ) : media.sourceLabel ? ` · ${media.sourceLabel}` : null}
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

                {/* Where it has been — warnings lead, so they sit above the facts. */}
                {entityType === "vessel" && data?.mmsi && <VesselHistorySection mmsi={String(data.mmsi)} />}

                {/* Key attributes */}
                {attributes.length > 0 && (
                    <div style={{ marginBottom: "var(--space-4)" }}>
                        <SectionLabel>Attributes</SectionLabel>
                        {attributes.map((a) => (
                            <AttributeRow key={a.label} label={a.label} value={a.value} />
                        ))}
                    </div>
                )}

                {sources.length > 0 && (
                    <div style={{ marginBottom: "var(--space-4)" }}>
                        <SectionLabel meta={sources.length > 1 ? sources.length : null}>Sources</SectionLabel>
                        {sources.map((src) => <SourceRow key={src.url + src.label} {...src} />)}
                    </div>
                )}

                {/* WHAT IS IN THIS WATER RIGHT NOW. Only for the two types
                    whose whole subject is a piece of sea. Rendered after the
                    reference attributes because it is the live half and it
                    arrives a moment later — the panel must not sit blank
                    waiting for it. */}
                {(entityType === "eez" || entityType === "chokepoint") && (
                    <div style={{ marginBottom: "var(--space-4)" }}>
                        <SectionLabel>Live traffic</SectionLabel>
                        <MaritimeAreaSection
                            kind={entityType === "chokepoint" ? "chokepoint" : "bbox"}
                            id={data?.system_id || data?.chokepoint_id || data?.id
                                || data?.name || entityId}
                            bounds={entityType === "eez" ? (data?.bounds || null) : null} />
                    </div>
                )}

                {entityType === "chokepoint" && data?.name && (
                    <div style={{ marginBottom: "var(--space-4)" }}>
                        <SectionLabel>Traffic vs normal</SectionLabel>
                        <ChokepointFlowSection name={data.name} />
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
                {/* Shown only when there is something: an empty "linked"
                    block per pin was most of what the panel said. */}
                {entityType === "geoconfirmed" && !forgeConnectionsLoading && forgeConnections.length > 0 && (
                    <div style={{ marginBottom: "var(--space-4)" }}>
                        <SectionLabel meta={forgeConnections.length}>Linked</SectionLabel>
                        {(
                            forgeConnections.map((c) => (
                                <div key={c.id} style={{ fontSize: "var(--text-sm)", color: "var(--text-primary)", padding: "3px 0" }}>
                                    <span style={{ color: "var(--text-dim)", textTransform: "uppercase", fontSize: "var(--text-xs)", marginRight: 6 }}>{c.type}</span>
                                    {c.label}
                                    <span style={{ color: "var(--text-dim)", fontSize: "var(--text-xs)", marginLeft: 6 }}>
                                        ({c.relationship_type}{c.lat == null ? ", no map position" : ""})
                                    </span>
                                </div>
                            ))
                        )}
                    </div>
                )}

                {/* Related links — only when there are some. A failed load
                    still says so: that is a fault, not an absence. */}
                {!linksLoading && (links.length > 0 || linksError) && (
                    <div style={{ marginBottom: "var(--space-4)" }}>
                        <SectionLabel meta={links.length || null}>Related</SectionLabel>
                        {links.length > 0 ? links.map((link) => (
                            <RelatedLinkRow key={link.link_id ?? `${link.entity_type}-${link.entity_id}-${link.source_id}`} link={link} onSelectRelated={onSelectRelated} />
                        )) : (
                            <div style={{ font: "400 11px var(--font)", color: "var(--amber)" }}>Couldn't load related records.</div>
                        )}
                    </div>
                )}

                {/* WHAT ELSE IS THIS ATTACHED TO. Reaching the graph used
                    to mean leaving for the Ontology page and searching by
                    hand; the question arrives here, on the map, in the
                    middle of something else. */}
                <EntityLinksPanel entityType={entityType} data={data} />

                {/* V3 Phase 1, §2.2 — real extensions render here, called by
                    the owner (this component), never injected from outside. */}
                {inspectorExtensions.map((Ext, i) => (
                    <Ext key={i} recordRef={recordRef} record={data} />
                ))}

                {/* §10.4 — EVERY inspector body ends with the ontology record.
                    Part 1's rule 3 is "nothing reaches a view without an
                    ontology record… if it can be seen, it can be traced", and
                    the rule is only worth anything if the trace is visible.
                    Rendered unconditionally: an object with no record still
                    gets the block, saying so, because a silent omission lets
                    an untraceable object look exactly like a traced one. */}
                <OntologyRecordBlock entityType={entityType} data={data} />
            </div>

            {/* Actions */}
            {(actions.canJumpToLocation || (onTrackEntity && entityId) || forecastHint(data) || entityId) && (
                <div style={{
                    display: "flex", gap: "var(--space-2)", flexWrap: "wrap",
                    padding: "var(--space-3) var(--space-4)",
                    borderTop: "var(--elevation-1)", flexShrink: 0,
                }}>
                    {/* Spec addendum F2 — "what happens next" opens the
                        SHARED board scoped to this signal's situation. It
                        never generates a private forecast: one that exists
                        only inside an inspector is a forecast nobody can
                        audit, and nobody can score. */}
                    {forecastHint(data) && (
                        <Button variant="ghost" size="sm" style={{ flex: 1 }}
                                onClick={() => {
                                    window.dispatchEvent(new CustomEvent("akili:open-forecast", {
                                        detail: { place: forecastHint(data) },
                                    }))
                                }}>
                            <svg className="icon sm"><use href="#i-orb" /></svg> what happens next
                        </Button>
                    )}
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
                    {/* SAVE ANYTHING. Whatever this panel can describe can
                        be kept for writing — the coordinates and any crop go
                        with it, because a saved item that is only a name
                        cannot be put on a page. */}
                    {entityId && (
                        <Button variant="ghost" size="sm" style={{ flex: 1 }}
                                onClick={() => {
                                    // THE REAL FIELD NAMES. This read
                                    // data.region and data.severity, which
                                    // a signal does not have — it carries
                                    // `location`, `severity_tier`,
                                    // `published_at` and `source`. So every
                                    // save fell through to the id and a
                                    // coordinate pair, and the sidebar
                                    // filled with "Signal (50.5°N 30.4°E)"
                                    // instead of what happened.
                                    const lat = data?.lat ?? data?.latitude ?? data?.centroid_lat ?? null
                                    const lon = data?.lon ?? data?.longitude ?? data?.centroid_lon ?? null
                                    const headline = data?.headline || data?.title || data?.name || data?.label || null
                                    const ok = addToBriefing(`${entityType || "sig"}:${entityId}`, headline || String(entityId), {
                                        kind: entityType === "detection" ? "imagery" : entityType === "entity" ? "entity" : "signal",
                                        lat, lon,
                                        headline,
                                        region:   data?.location || data?.location_name || data?.region || null,
                                        source:   data?.source || data?.source_type || null,
                                        severity: data?.severity_tier || data?.severity || null,
                                        when:     data?.published_at || data?.occurred_at || data?.created_at || null,
                                        url:      data?.url || null,
                                        context:  typeof data?.context === "string" ? data.context : null,
                                        imageUrl: data?.image_crop_url || data?.overlay_url || data?.thumbnail_url || null,
                                        detail:   data?.object_type || null,
                                    })
                                    toast(ok ? "Saved — it is in the Editor's Saved pane" : "Already saved",
                                          { icon: ok ? "i-check" : "i-info" })
                                }}>
                            Save for briefing
                        </Button>
                    )}
                </div>
            )}
        </Wrapper>
    )
}
