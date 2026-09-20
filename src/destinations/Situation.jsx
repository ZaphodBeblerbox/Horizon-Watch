/**
 * Situation.jsx — redesign Round 2, §8. The new globe home screen,
 * replacing Dashboard.jsx as the app's default view (Dashboard.jsx itself
 * is left in place, unreached from the new module rail — its Watch-Queue-
 * style right panel and layer-flyout pattern are real precedent this reuses,
 * but Round 2's spec calls for a materially different layout: a real docked
 * Layers rail instead of a flyout, a severity floor + time window this app
 * never had, a density strip, and a real legend — different enough to be a
 * new component rather than a patch on the old one).
 *
 * Data: the exact same real polling Dashboard.jsx already established —
 * GET /api/surface + GET /api/fusions merged via mergeNotificationItems(),
 * GET /api/health/detailed, GET /api/reports?status=in_review — no second
 * fetching mechanism invented. The severity floor and time window are new
 * REAL client-side filters applied on top of that one real merged list, and
 * every count shown (layer rows, legend, inspector stat grid) derives from
 * that SAME filtered list — never independently recomputed, so they can't
 * disagree.
 */
import { useEffect, useMemo, useState, useRef, useCallback, Fragment } from "react"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import GlobeView from "../components/GlobeView.jsx"
import { GDELT_EVENT_TYPES } from "../globe/GlobeGdeltLayer.jsx"
import MapAnnobar from "../components/MapAnnobar.jsx"
import MapChrome from "../components/MapChrome.jsx"
import MapMeta from "../components/MapMeta.jsx"
import MapTip from "../components/MapTip.jsx"
import { LAYER_GROUPS } from "../components/layerRailConfig.js"
import { mergeNotificationItems } from "../components/notificationsNormalize.js"
import { summarizeHealth } from "../utils/systemHealth.js"
import { buildWatchQueueRows, sortRowsBySeverity, timeAgoLabel } from "./dashboardLogic.js"
import { isSignalVisible, ageHoursSince } from "../lib/signalVisibility.js"
import { addToBriefing } from "../state/briefingBasket.js"
import { toast } from "../ui/toast.js"
import { useAnnotations, renameAnnotation, removeAnnotation } from "../state/annotationStore.js"
import { getActiveViews, subscribeActiveSession, saveCurrentAsView, applyView, deleteActiveSessionView, viewExtraLabels } from "../state/sessionStore.js"
import { replayOnMap } from "../services/replayOnMap.js"
import { useInspectorExtensions } from "../inspector/extensionRegistry.js"
import { publishFilterState } from "../state/situationFilterState.js"
import SignalsExportPanel from "./SignalsExportPanel.jsx"
import RiskIndexPanel from "../components/RiskIndexPanel.jsx"
import CoveragePanel from "../components/CoveragePanel.jsx"
import InspectorPanel from "../components/InspectorPanel.jsx"
import TimeStrip from "../components/TimeStrip.jsx"
import ImagerySidebar from "../components/ImagerySidebar.jsx"
import { getSettings, subscribeSettings } from "../state/settingsStore.js"

const API = API_BASE
const REFRESH_MS = 60000

const SEVERITY_TIER_ORDER = ["critical", "significant", "elevated", "low"]
const SEVERITY_FLOORS = [
    { key: "critical", label: "Critical+", maxRank: 0 },
    { key: "high",     label: "High+",     maxRank: 1 },
    { key: "moderate", label: "Moderate+", maxRank: 2 },
    { key: "low",      label: "Low+",      maxRank: 3 },
]
const TIME_WINDOWS = [
    { key: "24h", label: "24h", hours: 24 },
    { key: "72h", label: "72h", hours: 72 },
    { key: "7d",  label: "7d",  hours: 24 * 7 },
    { key: "30d", label: "30d", hours: 24 * 30 },
]
const SEV_LEGEND = [
    { rank: 0, tier: "critical",    label: "Critical", cls: "critical" },
    { rank: 1, tier: "significant", label: "High",     cls: "high" },
    { rank: 2, tier: "elevated",    label: "Moderate", cls: "moderate" },
    { rank: 3, tier: "low",         label: "Low",      cls: "low" },
]
const SEV_CLASS_BY_RANK = { 0: "critical", 1: "high", 2: "moderate", 3: "low" }

// §3 — the five annotation tools, in this exact order.
const ANNOTATION_TOOLS = [
    { key: "select", label: "Select", icon: "i-cursor" },
    { key: "marker", label: "Marker", icon: "i-pin" },
    { key: "route", label: "Route", icon: "i-path" },
    { key: "area", label: "Area", icon: "i-poly" },
    { key: "measure", label: "Measure", icon: "i-measure" },
]
// §10.1 names the four map tools select / measure / pin / poly. GlobeView's
// annotation layer has always spoken select / measure / marker / area, and it
// is the thing that actually draws. Rather than rename working draw code to
// match a label, the spec's names live in the DOM and are translated here at
// the single boundary where the two vocabularies meet.
/**
 * §L5's infrastructure layers, with §L2's `<em>` sub-line stating each one's
 * epistemic status rather than leaving the analyst to assume.
 */
const INFRA_LAYERS = [
    { key: "chokepoints", label: "Chokepoints", note: "With substitution cost", color: "var(--red)" },
    { key: "ports", label: "Ports & terminals", note: "Positions real; congestion not yet derived", color: "var(--acc-hi)" },
    { key: "airfields", label: "Airports & airfields", note: "OurAirports, full roster", color: "var(--steel)" },
    { key: "cables", label: "Submarine cables", note: "Indicative trunk routes, not survey data", color: "var(--acc-hi)" },
    { key: "power", label: "Power grid", note: "OpenInfraMap raster, community-maintained", color: "var(--amber)" },
    { key: "nautical", label: "Nautical chart", note: "OpenSeaMap raster overlay", color: "var(--green)" },
]

const SPEC_TO_TOOL = { select: "select", measure: "measure", pin: "marker", poly: "area" }
const TOOL_TO_SPEC = { select: "select", measure: "measure", marker: "pin", area: "poly", route: "select" }

// Quick-layer buttons — the same real groupsOn state the Layers pane's own
// domain rows use (one shared toggle, never a second independent list).
// The imagery kill switch, from the production event-loop freeze.
//
// This used to be a hardcoded `false` mirroring the backend switch, with a
// note to "flip both back together". They were not: the backend was
// re-enabled and this stayed dead, so the Situation imagery toggle sat
// permanently disabled with nothing in any log to explain why. Two copies
// of one fact drift, and the drift is silent.
//
// So it is no longer a copy. The backend reports whether imagery is on and
// the UI asks. Default false, because a control that errors is worse than
// one that is honestly unavailable while we do not yet know.
function useImageryEnabled() {
    const [enabled, setEnabled] = useState(false)
    useEffect(() => {
        let cancelled = false
        fetch(`${API_BASE}/api/health/detailed`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (!cancelled && d) setEnabled(Boolean(d.imagery_enabled)) })
            .catch(() => {})
        return () => { cancelled = true }
    }, [])
    return enabled
}

// The "activate all satellite imagery" quick-layer button (key: "imagery",
// icon: i-sat) that used to live here is removed this round — it was a
// second, visually-identical top-bar icon sitting right next to the real
// Imagery/detection entry point button below, a confirmed source of UX
// confusion. groupsOn.imagery (satelliteEnabled/infraEnabled on GlobeView)
// is untouched and still real — it's just no longer reachable from a
// top-bar icon; the Layers pane's own "Event domains" → "Imagery" row
// (DomainRow, driven by the same LAYER_GROUPS/groupsOn state) is the one
// real, unchanged home for it now.
const QUICK_LAYERS = [
    { key: "maritime", label: "Maritime", icon: "i-ship" },
    { key: "air", label: "Air", icon: "i-plane" },
    { key: "news", label: "News", icon: "i-read" },
    { key: "zones", label: "Zones", icon: "i-target" },
    { key: "alerts", label: "Alerts", icon: "i-flag" },
]

// Real Cesium camera presets, build spec v2 §8 — "implemented as camera
// presets rather than a projection change." Center/altitude computed from
// the reference spec's own real regional bounding boxes (world
// [[-170,78],[178,-58]], emea [[-22,62],[62,-12]], apac [[62,46],[150,-12]],
// amer [[-128,52],[-32,-46]]), not guessed.
const CAMERA_PRESETS = [
    { key: "world", label: "World", lat: 10, lon: 4, altitude: 18_000_000 },
    { key: "emea", label: "EMEA", lat: 25, lon: 20, altitude: 7_000_000 },
    { key: "apac", label: "APAC", lat: 17, lon: 106, altitude: 7_500_000 },
    { key: "amer", label: "AMER", lat: 3, lon: -80, altitude: 10_000_000 },
]

function DomainRow({ group, count, on, onToggle }) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 12px" }}>
            <span className="swatch" style={{ background: "var(--cat-6)", width: 7, height: 7, transform: "rotate(45deg)", flexShrink: 0 }} />
            <span style={{ flex: 1, font: "400 12px var(--font)", color: "var(--txt-2)" }}>{group.label}</span>
            <span style={{ font: "400 11px var(--mono)", color: "var(--txt-4)" }}>{count == null ? "—" : count}</span>
            <button
                onClick={onToggle}
                title={on ? "Hide layer" : "Show layer"}
                style={{ width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", cursor: "pointer", color: on ? "var(--txt-2)" : "var(--txt-4)" }}
            >
                <svg className="icon sm"><use href={on ? "#i-eye" : "#i-eye-off"} /></svg>
            </button>
        </div>
    )
}

// A layer that lives UNDER a domain rather than beside it.
//
// The Layers panel is group-level by design — one row per domain — but
// GDELT cannot share the News switch with GeoConfirmed. One is a machine
// that read a wire story, the other is a human who found the building in
// the video, and a reader has to be able to trust the second without
// accepting the first. Indented, dimmer, and disabled while its parent
// domain is off, so the hierarchy is legible rather than implied.
function SubLayerRow({ label, hint, on, parentOn, onToggle }) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 8,
                      padding: "3px 12px 3px 27px", opacity: parentOn ? 1 : 0.4 }}
             title={parentOn ? hint : `${hint} — turn on the parent domain first`}>
            <span className="swatch" style={{ background: "var(--sev-high)", width: 6, height: 6,
                                              transform: "rotate(45deg)", flexShrink: 0 }} />
            <span style={{ flex: 1, font: "400 11px var(--font)", color: "var(--txt-3)" }}>{label}</span>
            <button
                onClick={parentOn ? onToggle : undefined}
                disabled={!parentOn}
                title={on ? "Hide" : "Show"}
                style={{ width: 18, height: 18, display: "flex", alignItems: "center",
                         justifyContent: "center", background: "none", border: "none",
                         cursor: parentOn ? "pointer" : "default",
                         color: on && parentOn ? "var(--txt-2)" : "var(--txt-4)" }}
            >
                <svg className="icon sm"><use href={on ? "#i-eye" : "#i-eye-off"} /></svg>
            </button>
        </div>
    )
}

// Views group (§5.2, Sessions & Views full round) — a real filter preset
// living INSIDE the active session, deliberately the literal first group
// in the Layers panel, above Event domains. Applying a view changes ONLY
// filter-level state (severity/window/domains/context) via
// sessionStore.js's applyView() — never camera, tabs, or basket, which stay
// whole-session concerns. No native prompt() for naming a new view — an
// inline field, same no-native-dialogs rule as SessionControl.jsx.
function ViewsGroup({ views, onApply, onDelete, onSaveCurrent }) {
    const [naming, setNaming] = useState(false)
    const [name, setName] = useState("")

    function commit() {
        const trimmed = name.trim()
        setNaming(false)
        setName("")
        if (trimmed) onSaveCurrent(trimmed)
    }

    return (
        <div style={{ padding: "8px 0", borderBottom: "1px solid var(--line-soft)" }}>
            <div style={{ padding: "2px 12px 4px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ font: "600 11px var(--font)", color: "var(--txt-3)" }}>Views</span>
                {naming ? (
                    <input
                        autoFocus className="input" value={name} placeholder="View name"
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setNaming(false); setName("") } }}
                        onBlur={commit}
                        style={{ font: "400 11px var(--font)", width: 110, padding: "1px 6px" }}
                    />
                ) : (
                    <span role="button" tabIndex={0} onClick={() => setNaming(true)}
                        style={{ font: "400 11px var(--font)", color: "var(--acc-hi)", cursor: "pointer" }}>save current view</span>
                )}
            </div>
            {views.length === 0 ? (
                <div style={{ padding: "2px 12px 4px", font: "400 11px var(--font)", color: "var(--txt-4)" }}>
                    No saved views in this session yet.
                </div>
            ) : views.map((v) => (
                <div key={v.view_id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 12px" }}>
                    <span style={{ flex: 1, minWidth: 0, font: "400 12px var(--font)", color: "var(--txt-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {v.name}
                        {/* §16 — the row says what will be restored before it
                            is restored, so "apply" is not a guess. */}
                        {viewExtraLabels(v).map((l) => (
                            <span key={l} style={{ font: "400 10px var(--mono)", color: "var(--txt-4)" }}> · {l}</span>
                        ))}
                    </span>
                    <span role="button" tabIndex={0} onClick={() => onApply(v)} title="Apply view"
                        style={{ font: "400 11px var(--font)", color: "var(--acc-hi)", cursor: "pointer" }}>apply</span>
                    <span role="button" tabIndex={0} onClick={() => onDelete(v.view_id)} title="Delete view"
                        style={{ color: "var(--txt-4)", cursor: "pointer", padding: "0 2px" }}>✕</span>
                </div>
            ))}
        </div>
    )
}

// §4 — the severity legend, now a real Inspector section (never a map
// overlay). Content/behavior unchanged from the old floating version: four
// rows, real live counts from the same `legendCounts` (derived from
// visibleRows) every other real count on this screen shares — the map,
// the density strip, and the Layers pane's domain rows can never disagree
// with this because none of them recompute their own separate figure.
function SeverityLegend({ legendCounts }) {
    return (
        <div className="card">
            <span className="lbl">Severity legend</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {SEV_LEGEND.map((s) => (
                    <div key={s.tier} className={`sev ${s.cls}`} style={{ justifyContent: "space-between", gap: 14 }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <span className={`dia ${s.cls}`} />
                            <span style={{ color: "var(--txt-2)" }}>{s.label}</span>
                        </span>
                        <span style={{ font: "400 11px var(--mono)", color: "var(--txt-3)" }}>{legendCounts[s.rank]}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}

export default function Situation({ onOpenDossier }) {
    const [surfaceItems, setSurfaceItems] = useState([])
    // Real "as of" honesty indicator — GET /api/surface can genuinely serve
    // a real persisted snapshot (its own DB cache, up to 4h old) rather than
    // a freshly-built pool, especially right after a cold backend start.
    // updated_at was already in the real response but never surfaced to the
    // analyst; now shown so a snapshot is never silently presented as live.
    const [surfaceUpdatedAt, setSurfaceUpdatedAt] = useState(null)
    const [fusionEvents, setFusionEvents] = useState([])
    const [health, setHealth] = useState(null)
    const [selected, setSelected] = useState(null)
    // A map-marker click (GlobePopup, via GlobeView's dockExternally path)
    // now renders INSIDE this same real Inspector pane instead of a second,
    // uncoordinated fixed-position overlay — see the pane content below.
    // Clearing whichever of the two "detail" states isn't the active one
    // keeps them from fighting over this one slot.
    const [inspectorPopup, setInspectorPopup] = useState(null)
    // Real root-cause fix for a confirmed "Maximum update depth exceeded"
    // loop: this was previously an inline arrow function passed directly as
    // the onInspectorPopupChange prop below — a brand-new function
    // reference on every render of Situation.jsx. GlobePopup.jsx's own
    // effect that calls this prop has it in its dependency array (alongside
    // `popup`), so a new reference each render made that effect re-fire
    // every render, which calls setInspectorPopup(...) here, which
    // re-renders Situation.jsx, which created yet another new inline
    // function reference — a self-sustaining loop. useCallback gives this a
    // stable identity across renders, so GlobePopup's effect only re-fires
    // when its OTHER real dependency (the actual popup selection) changes.
    const handleInspectorPopupChange = useCallback((p) => {
        if (p) setSelected(null)
        setInspectorPopup(p)
    }, [])
    // V3 Phase 1, §2.2 — real hook-based extension point. This component
    // owns this Inspector pane (a separate real surface from the map's
    // own InspectorPanel/GlobePopup) and calls every registered extension
    // itself, from inside its own render, below — never reassigned from
    // outside. Fires for both the "nothing selected" and "selected"
    // branches, matching the reference pattern (an interrupt-style
    // extension needs to render regardless of selection).
    const inspectorExtensions = useInspectorExtensions()
    const selectedRef = selected && selected.kind !== "fusion" ? `sig:${selected.id}` : null
    const [severityFloor, setSeverityFloor] = useState("low")
    const [timeWindow, setTimeWindow] = useState("72h")
    // Fidelity pass §1 — the app's base/default state is ALL LAYERS OFF (a
    // bare map until the analyst turns something on). Was defaulting every
    // group to true; severity floor/time window are filter settings, not
    // layer toggles, and keep their own sensible defaults since they don't
    // clutter an empty map on their own.
    const [groupsOn, setGroupsOn] = useState(() => Object.fromEntries(LAYER_GROUPS.map((g) => [g.key, false])))
    // Default OFF. Machine-coded pins are opt-in: the reader should choose
    // to accept them, not discover them mixed in with verified events.
    const [gdeltOn, setGdeltOn] = useState(false)
    // Which CAMEO codings to draw. Starts as every kind rather than a
    // curated subset: a reader who has not chosen yet should see the whole
    // feed, not a silently narrowed one.
    const [gdeltTypes, setGdeltTypes] = useState(() => GDELT_EVENT_TYPES.map((t) => t.key))
    // Default ON: a thermal anomaly is a real instrument reading and it is
    // what decides where imagery gets tasked, so hiding it by default
    // conceals the system's own reasoning.
    const [firesOn, setFiresOn] = useState(true)
    // Which theatres the frontline layer should draw. Ukraine is the only
    // one with an open control feed today; the roster comes from the
    // backend so adding a source later needs no frontend change.
    // Ukraine defaults on; the point-based theatres do not, because
    // Syria alone carries 7,576 marks and turning them all on unasked
    // would bury the rest of the map.
    const [theatresOn, setTheatresOn] = useState({ ukraine: true })
    const [frontlineTheatres, setFrontlineTheatres] = useState([])
    const [contextOn, setContextOn] = useState({ risk: false, frontlines: false, facilities: false, coverage: false, graticule: false, flows: false, aois: false, labels: false })
    // The Ukraine time slider. `null` means live; any other value is a
    // published snapshot date. Index rather than date so the control is
    // evenly spaced in SNAPSHOTS, which is what exists, rather than in
    // days, which would put long gaps where nobody drew a map.
    const [snapshots, setSnapshots] = useState([])
    const [snapIdx, setSnapIdx] = useState(null)
    useEffect(() => {
        if (!contextOn.frontlines) return
        fetch(`${API_BASE}/api/frontlines/timeline?limit=200`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => setSnapshots(safeArray(d?.snapshots)))
            .catch(() => {})
    }, [contextOn.frontlines])
    const frontlinesAt = (snapIdx == null || !snapshots.length)
        ? null
        : String(snapshots[Math.min(snapIdx, snapshots.length - 1)]?.at || "").slice(0, 10)
    useEffect(() => {
        fetch(`${API_BASE}/api/frontlines/theatres`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => setFrontlineTheatres(safeArray(d?.theatres)))
            .catch(() => {})
    }, [])

    /**
     * PARALLAX layers addendum §L5 — Global infrastructure is its OWN group.
     *
     * These layers were riding event-domain toggles that have nothing to do
     * with them: submarine cables were switched by "Maritime" (the vessel
     * SIGNAL domain) and the OpenInfraMap power grid by "Imagery", so you
     * could not see a cable without every maritime signal, or the grid
     * without the satellite raster. Ports and airports shared a single track
     * toggle. Infrastructure is context you reach for deliberately, not a
     * by-product of another question.
     */
    const [infraOn, setInfraOn] = useState({
        cables: false, chokepoints: true, ports: true, airfields: true,
        power: false, nautical: false,
    })
    const [tracksOn, setTracksOn] = useState({ vessels: false, aircraft: false, sanctionedOnly: false })
    const [exportOpen, setExportOpen] = useState(false)
    // Imagery/detection top-bar entry point — real audit (Part 0) confirmed
    // no draw-to-scan tool existed in this top bar at all (the old
    // "activate all satellite imagery" quick-layer button only toggled the
    // base satellite overlay's visibility — it never opened anything; that
    // button is now removed from QUICK_LAYERS below, leaving this as the
    // one real top-bar imagery/detection entry point).
    const imageryEnabled = useImageryEnabled()
    const [imageryPanelOpen, setImageryPanelOpen] = useState(false)
    // Round 2 UX correction of PR #64 — the drawn shape, loaded scene
    // overlay, and detections all live here (not inside the sidebar
    // component) because GlobeView (a sibling, not a child, of the
    // sidebar) needs them too, via the real GlobeOverwatchLayer.jsx /
    // GlobeOverwatchDrawLayer.jsx plumbing already built into GlobeView.jsx
    // (confirmed live but with zero real consumers anywhere in the app
    // until this round).
    const [imageryDrawMode, setImageryDrawMode] = useState("rectangle")
    const [imageryDrawActive, setImageryDrawActive] = useState(false)
    const [imageryDrawn, setImageryDrawn] = useState(null) // {bounds, polygonVertices|null}
    const [imageryScene, setImageryScene] = useState(null) // {image_b64, image_b64_composited, bounds, sensor, capture_timestamp, cloud_cover}
    const [imageryDetections, setImageryDetections] = useState([])
    const handleImageryBounds = useCallback((bounds) => {
        setImageryDrawn({ bounds, polygonVertices: null })
        setImageryDrawActive(false)
    }, [])
    const handleImageryPolygon = useCallback(({ vertices, bounds }) => {
        setImageryDrawn({ bounds, polygonVertices: vertices })
        setImageryDrawActive(false)
    }, [])
    const closeImageryPanel = useCallback(() => {
        setImageryPanelOpen(false)
        setImageryDrawActive(false)
        setImageryDrawn(null)
        setImageryScene(null)
        setImageryDetections([])
    }, [])

    // GeoConfirmed historic-timeline round — real per-user, server-
    // persisted theatre selection (Part 3.4), same settingsStore.js
    // apply-then-persist pattern every other real filter/view setting in
    // this app already uses. geoConfirmedEndDate (the scrub-slider
    // position) is deliberately NOT persisted — Part 1.2 only asks the
    // slider to default sensibly on open, not to remember a scrubbed
    // historic position across sessions the way the theatre filter does.
    const [geoConfirmedTheatres, setGeoConfirmedTheatres] = useState(() => getSettings()?.mapLayers?.geoConfirmedTheatres || [])
    const [geoConfirmedEndDate, setGeoConfirmedEndDate] = useState(null)
    // Round 3 fix (Part 6.3) — the panel's own real measured height, so the
    // map's scale-bar/coordinate-readout chrome can be pushed up above it
    // rather than overlapping/interleaving with its text at the same
    // screen position (both were technically visible per z-index already —
    // this isn't a stacking-order bug, it's a spatial-collision one).
    useEffect(() => subscribeSettings((s) => setGeoConfirmedTheatres(s?.mapLayers?.geoConfirmedTheatres || [])), [])
    // The scrub used to reset whenever the News layer went off, because the
    // panel it lived in unmounted with that toggle and a stale filter would
    // have had no visible control. §11's strip is always present, so the
    // playhead now stands on its own — switching a map layer off must not
    // silently undo a scrub whose slider is still on screen.

    // V3 Phase 1, §5.1 — real live mirror of this filter state, published
    // on every change so a session-save action can read the current
    // desk's actual filters (see src/state/situationFilterState.js).
    useEffect(() => {
        publishFilterState({ severityFloor, timeWindow, groupsOn, contextOn, tracksOn })
    }, [severityFloor, timeWindow, groupsOn, contextOn, tracksOn])

    // Sessions & Views full round (§5.2) — this pane's own real mirror of
    // the ACTIVE session's real views (SessionControl.jsx owns switching
    // sessions; this just reflects whichever one is currently active).
    const [views, setViews] = useState(getActiveViews())
    useEffect(() => subscribeActiveSession((_session, v) => setViews(v)), [])
    // applyView() writes through situationFilterState.js's restore channel
    // (akili:apply-session-filters), which this component already listens
    // for below (real whole-session restore) — reused as-is, no second
    // mirroring pass needed.
    const applyViewToFilters = (v) => applyView(v)

    // Real session restore — applies every filter field atomically in one
    // pass, matching how it was captured.
    useEffect(() => {
        const h = (e) => {
            const s = e.detail || {}
            if (s.severityFloor) setSeverityFloor(s.severityFloor)
            if (s.timeWindow) setTimeWindow(s.timeWindow)
            if (s.groupsOn) setGroupsOn(s.groupsOn)
            if (s.contextOn) setContextOn(s.contextOn)
            if (s.tracksOn) setTracksOn(s.tracksOn)
        }
        window.addEventListener("akili:apply-session-filters", h)
        return () => window.removeEventListener("akili:apply-session-filters", h)
    }, [])
    const [annotationTool, setAnnotationTool] = useState("select")
    const [basemap, setBasemap] = useState("dark")
    const annotations = useAnnotations()
    const globeApiRef = useRef(null)

    // Real Live-tracks counts for the Layers pane rows — fetched only while
    // the corresponding track is actually on, independent of GlobeView's own
    // internal fetch (GlobeView doesn't expose its fetched counts upward, so
    // this is a second real fetch of the same real endpoints rather than a
    // fabricated or reused-stale number).
    const [trackCounts, setTrackCounts] = useState({ vessels: null, aircraft: null, sanctioned: null })
    useEffect(() => {
        let cancelled = false
        if (!tracksOn.vessels) { setTrackCounts((p) => ({ ...p, vessels: null })); return }
        const load = () => fetch(`${API}/api/ais/vessels`).then((r) => (r.ok ? r.json() : null)).then((d) => {
            if (cancelled || !d?.vessels) return
            setTrackCounts((p) => ({ ...p, vessels: d.vessels.length }))
        }).catch(() => {})
        load()
        const t = setInterval(load, 60000)
        return () => { cancelled = true; clearInterval(t) }
    }, [tracksOn.vessels])
    useEffect(() => {
        let cancelled = false
        if (!tracksOn.aircraft) { setTrackCounts((p) => ({ ...p, aircraft: null })); return }
        const load = () => fetch(`${API}/adsb?lat=20.0000&lon=10.0000&dist=2000`).then((r) => (r.ok ? r.json() : null)).then((d) => {
            if (cancelled || !d) return
            setTrackCounts((p) => ({ ...p, aircraft: (d.aircraft || d.states || []).length }))
        }).catch(() => {})
        load()
        const t = setInterval(load, 10000)
        return () => { cancelled = true; clearInterval(t) }
    }, [tracksOn.aircraft])

    // Build spec v2, §4.6 — real panel slide-in on mount, and a real
    // minimize/restore toggle. `entered` starts false so the panels render
    // in their slid-out position for one frame, then a single real
    // transition (never a keyframe — see designSystem.css's .pane-glass
    // comment on the animation-fill-mode trap) carries them to rest. Uses
    // setTimeout rather than requestAnimationFrame per the build spec's own
    // §2.1 guidance against relying on rAF for anything layout-adjacent.
    const [entered, setEntered] = useState(false)
    const [leftMin, setLeftMin] = useState(false)
    const [rightMin, setRightMin] = useState(false)
    useEffect(() => {
        const t = setTimeout(() => setEntered(true), 20)
        return () => clearTimeout(t)
    }, [])

    useEffect(() => {
        let cancelled = false
        const loadSurface = () => fetch(`${API}/api/surface`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (!cancelled && d) { setSurfaceItems(d.items || []); setSurfaceUpdatedAt(d.updated_at || null) } }).catch(() => {})
        const loadFusions = () => fetch(`${API}/api/fusions?status=active&limit=50`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (!cancelled && Array.isArray(d)) setFusionEvents(d) }).catch(() => {})
        const loadHealth = () => fetch(`${API}/api/health/detailed`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (!cancelled) setHealth(d) }).catch(() => {})
        const loadAll = () => { loadSurface(); loadFusions(); loadHealth() }
        loadAll()
        const t = setInterval(loadAll, REFRESH_MS)
        return () => { cancelled = true; clearInterval(t) }
    }, [])

    const maxRank = SEVERITY_FLOORS.find((f) => f.key === severityFloor)?.maxRank ?? 3
    const windowHours = TIME_WINDOWS.find((w) => w.key === timeWindow)?.hours ?? 24
    const nowMs = Date.now()

    // windowRows: severity-floor + time-window filtered only — the real
    // basis for the Layers pane's own per-domain row counts, which the
    // build spec explicitly wants to "reflect the window, not the current
    // filter, so toggling a layer off doesn't hide the fact that it has
    // data" (§4.6.1). NOT gated on groupsOn — a row count must stay real
    // and visible even while its own layer is off, precisely so an analyst
    // can see there's something to turn on.
    const windowRows = useMemo(() => {
        const merged = mergeNotificationItems(surfaceItems, fusionEvents)
        const rows = sortRowsBySeverity(buildWatchQueueRows(merged))
        // The one real shared window/severity-floor decision (src/lib/
        // signalVisibility.js) — the map's own "signal" layers
        // (GlobeGeoConfirmedLayer/GlobeDerivedAlertsLayer) now
        // call the exact same function over their own raw data, real
        // root-cause fix for the map previously ignoring both dimensions
        // entirely rather than a second, ad-hoc filter added there.
        return rows.filter((r) => isSignalVisible(
            { ageHours: ageHoursSince(r.publishedAt, nowMs), severityRank: r.severityRank },
            { windowHours, maxRank },
        ))
    }, [surfaceItems, fusionEvents, maxRank, windowHours, nowMs])

    // visibleRows: fidelity pass §1 — the base/default state is all layers
    // off, and every OTHER count on this screen (legend, inspector stat
    // grid, density strip, "newest critical") must correctly show zero
    // until a layer is actually switched on — distinct from windowRows
    // above. A row counts as visible only if a domain group it can
    // genuinely be attributed to is on (fusion events carry a real
    // domains[] array; anything else is treated as a News-domain item,
    // the pool it actually comes from — never guessed as some other
    // domain it can't be verified against).
    const anyDomainOn = groupsOn.maritime || groupsOn.air || groupsOn.news || groupsOn.imagery || groupsOn.zones || groupsOn.alerts
    const visibleRows = useMemo(() => {
        if (!anyDomainOn) return []
        return windowRows.filter((r) => {
            if (r.kind === "fusion") {
                if (groupsOn.alerts) return true
                const domains = (r.raw?.domains || []).map((d) => String(d).toUpperCase())
                if (domains.includes("AIS") && groupsOn.maritime) return true
                if (domains.includes("ADSB") && groupsOn.air) return true
                return false
            }
            return groupsOn.news
        })
    }, [windowRows, anyDomainOn, groupsOn.maritime, groupsOn.air, groupsOn.news, groupsOn.alerts])

    const healthSummary = useMemo(() => summarizeHealth(health), [health])

    const legendCounts = useMemo(() => {
        const c = { 0: 0, 1: 0, 2: 0, 3: 0 }
        for (const r of visibleRows) if (r.severityRank in c) c[r.severityRank] += 1
        return c
    }, [visibleRows])

    // Real per-domain counts where the data actually supports attribution
    // (fusion events carry a real `domains` array); News/Imagery/Zones
    // groups show "—" rather than a fabricated split, since the merged
    // list doesn't carry a clean per-item domain field for plain surface
    // items today. Deliberately derived from windowRows, NOT visibleRows —
    // per the build spec's own §4.6.1, a domain row's count must "reflect
    // the window, not the current filter, so toggling a layer off doesn't
    // hide the fact that it has data."
    const domainCounts = useMemo(() => {
        const out = {}
        for (const g of LAYER_GROUPS) out[g.key] = null
        for (const r of windowRows) {
            const domains = r.kind === "fusion" ? (r.raw?.domains || []) : []
            if (domains.some((d) => String(d).toUpperCase() === "AIS")) out.maritime = (out.maritime || 0) + 1
            if (domains.some((d) => String(d).toUpperCase() === "ADSB")) out.air = (out.air || 0) + 1
        }
        out.news = windowRows.filter((r) => r.kind !== "fusion").length
        out.alerts = windowRows.length
        return out
    }, [windowRows])

    // 12-bucket density histogram over the current window — real counts,
    // real time axis.
    const densityBuckets = useMemo(() => {
        const buckets = 12
        const bucketMs = (windowHours * 3600000) / buckets
        const counts = new Array(buckets).fill(0)
        const hot = new Array(buckets).fill(false)
        for (const r of visibleRows) {
            if (!r.publishedAt) continue
            const age = nowMs - new Date(r.publishedAt).getTime()
            const idx = buckets - 1 - Math.min(buckets - 1, Math.floor(age / bucketMs))
            if (idx >= 0 && idx < buckets) {
                counts[idx] += 1
                if (r.severityRank <= 1) hot[idx] = true
            }
        }
        return { counts, hot, max: Math.max(1, ...counts) }
    }, [visibleRows, windowHours, nowMs])

    const byRegion = useMemo(() => {
        const m = new Map()
        for (const r of visibleRows) {
            const key = r.aoi || "Unknown"
            m.set(key, (m.get(key) || 0) + 1)
        }
        return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6)
    }, [visibleRows])

    const newestCritical = useMemo(() => visibleRows.filter((r) => r.severityRank <= 1).slice(0, 6), [visibleRows])

    const handleAddToBriefing = (row) => {
        addToBriefing(row.id, row.title)
        toast(`Added "${row.title.slice(0, 40)}" to briefing basket`)
    }

    // Round 4 fix — real root cause of "Layers/Inspector glass never
    // visibly blurs anything" (confirmed with hard evidence, not assumed):
    // this layout was flexbox siblings — Layers | map | Inspector — so the
    // real Cesium canvas's own bounding rect started exactly at x=250
    // (--pane-l's width) and ended exactly at var(--pane-r) from the right
    // edge. There was never any real map content behind these panes to
    // blur; backdrop-filter was compositing over the flat app-shell
    // background the whole time, which is why real pixel-sampling (not
    // just getComputedStyle) showed a perfectly uniform color with zero
    // correlation to the map. Confirmed live via
    // document.querySelector('canvas').getBoundingClientRect().
    //
    // Real fix: Layers/Inspector are now real absolutely-positioned
    // overlays on top of a full-bleed map (the aside.pane "glass side
    // panel" semantics the reference spec actually describes — a pane
    // that floats OVER content, not one that sits beside it), inside the
    // exact same real position:relative map container the map chrome
    // already overlays. Minimize/restore no
    // longer needs a flex-reflow at all — the map is already full-bleed
    // underneath at all times, so minimizing an overlay pane just reveals
    // more of the real map that was already there.
    // §1.5 — "The rails end above the strip. They must not overlap it —
    // that is what starved the archive chart to 33px." Both panes stop where
    // the time strip starts, so the strip is never underneath them and is
    // never covered; --strip-h tracks which face the strip is showing.
    const leftPaneStyle = {
        position: "absolute", left: 0, top: 0, bottom: "var(--strip-h, 0px)", zIndex: 3,
        width: "var(--pane-l)", borderRight: "1px solid var(--line)",
        display: "flex", flexDirection: "column", minHeight: 0, overflowY: "auto",
        transform: entered ? "translateX(0)" : "translateX(-14px)",
        opacity: entered ? 1 : 0,
    }
    const rightPaneStyle = {
        // Real shared token (index.html :root — "the map fit AND every map
        // overlay inset derive from these two tokens, so they can never
        // drift apart"), not a hardcoded literal that happens to match it —
        // this is also now the Inspector's real width when a map marker is
        // clicked (see the pane content below), so one token now drives
        // Layers, this pane's default view, AND the marker-click Inspector.
        position: "absolute", right: 0, top: 0, bottom: "var(--strip-h, 0px)", zIndex: 3,
        width: "var(--pane-r)", borderLeft: "1px solid var(--line)",
        display: "flex", flexDirection: "column", minHeight: 0, overflowY: "auto",
        transform: entered ? "translateX(0)" : "translateX(14px)",
        opacity: entered ? 1 : 0,
    }
    // Real, dynamic clearance for the map's own bottom-right control stack
    // (zIndex 40, so it always stays clickable/visible above these panes)
    // — it must shift left by the Inspector's real width whenever Inspector
    // is open, now that Inspector overlays that corner instead of sitting
    // beside it. The GeoConfirmed timeline panel's own right-inset (Part
    // 6 of an earlier round) needs the same real shift, on top of its
    // existing button-column clearance.
    const inspectorOverlayWidth = rightMin ? 0 : 312 // px, matches --pane-r
    // The Imagery sidebar occupies the exact same real right-edge slot as
    // Inspector (var(--pane-r), same 312px width) — while open it visually
    // covers Inspector, so map chrome should clear THIS width instead of
    // Inspector's whenever it's the active right-side overlay.
    const activeRightOverlayWidth = imageryPanelOpen ? 312 : inspectorOverlayWidth

    return (
        <div data-testid="view-root-situation" style={{ display: "flex", position: "relative", height: "100%", minHeight: 0, background: "var(--bg-0)" }}>
            {/* Left — Layers (real frosted glass per build spec v2 §4.6 —
                corrects an earlier round's "no translucency anywhere"
                reversal of this; only the panel's own background is glass,
                everything inside — .chip/.card/.seg etc — stays flat/opaque) */}
            {leftMin ? (
                <div className="panetab" role="button" tabIndex={0} onClick={() => setLeftMin(false)} title="Restore Layers">Layers</div>
            ) : (
            <div className="pane-glass" data-testid="glass-layers-pane" style={leftPaneStyle}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", borderBottom: "1px solid var(--line)" }}>
                    <span style={{ font: "600 11px var(--font)", color: "var(--txt)" }}>Layers</span>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span role="button" tabIndex={0} onClick={() => {
                            setGroupsOn(Object.fromEntries(LAYER_GROUPS.map((g) => [g.key, true])))
                            setContextOn({ risk: true, coverage: true, graticule: true, flows: true, aois: true, labels: true })
                            setInfraOn({ cables: true, chokepoints: true, ports: true, airfields: true, power: true, nautical: true })
                            setTracksOn({ vessels: true, aircraft: true, sanctionedOnly: false })
                        }} style={{ font: "400 11px var(--font)", color: "var(--acc-hi)", cursor: "pointer" }}>all</span>
                        <span role="button" tabIndex={0} onClick={() => {
                            setGroupsOn(Object.fromEntries(LAYER_GROUPS.map((g) => [g.key, false])))
                            setContextOn({ risk: false, coverage: false, graticule: false, flows: false, aois: false, labels: false })
                            setInfraOn({ cables: false, chokepoints: false, ports: false, airfields: false, power: false, nautical: false })
                            setTracksOn({ vessels: false, aircraft: false, sanctionedOnly: false })
                        }} style={{ font: "400 11px var(--font)", color: "var(--acc-hi)", cursor: "pointer" }}>none</span>
                        <button onClick={() => setLeftMin(true)} title="Minimize" style={{ background: "none", border: "none", color: "var(--txt-3)", cursor: "pointer", padding: 0, display: "flex" }}>
                            <svg className="icon sm"><use href="#i-collapse-l" /></svg>
                        </button>
                    </div>
                </div>

                {/* Views — §5.2, literal first group in this panel (a
                    genuinely separate structure from the session itself). */}
                <ViewsGroup
                    views={views}
                    onApply={applyViewToFilters}
                    onDelete={(viewId) => { deleteActiveSessionView(viewId).catch(() => toast("Could not delete view", { icon: "i-alert" })) }}
                    onSaveCurrent={(name) => { saveCurrentAsView(name).catch(() => toast("Could not save view", { icon: "i-alert" })) }}
                />

                <div style={{ padding: "8px 0", borderBottom: "1px solid var(--line-soft)" }}>
                    <div style={{ padding: "2px 12px 4px", font: "600 11px var(--font)", color: "var(--txt-3)" }}>Event domains</div>
                    {LAYER_GROUPS.map((g) => (
                        <Fragment key={g.key}>
                            <DomainRow group={g} count={domainCounts[g.key]} on={groupsOn[g.key]} onToggle={() => setGroupsOn((p) => ({ ...p, [g.key]: !p[g.key] }))} />
                            {g.key === "imagery" && (
                                <SubLayerRow
                                    label="Thermal Anomalies"
                                    hint="NASA FIRMS — the feed that tasks imagery. A gas flare, burning stubble and a strike look identical to the instrument."
                                    on={firesOn} parentOn={groupsOn.imagery}
                                    onToggle={() => setFiresOn((v) => !v)} />
                            )}
                            {g.key === "news" && (
                                <SubLayerRow
                                    label="GDELT Events"
                                    hint="Machine-coded from news wire · city-level only · every pin cites its article"
                                    on={gdeltOn} parentOn={groupsOn.news}
                                    onToggle={() => setGdeltOn((v) => !v)} />
                            )}
                            {g.key === "news" && gdeltOn && groupsOn.news && (
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 3,
                                              padding: "2px 12px 6px 27px" }}>
                                    {GDELT_EVENT_TYPES.map((t) => {
                                        const on = gdeltTypes.includes(t.key)
                                        return (
                                            <button key={t.key} className="chip" aria-pressed={on}
                                                title={t.label}
                                                onClick={() => setGdeltTypes((prev) => on
                                                    ? prev.filter((k) => k !== t.key)
                                                    : [...prev, t.key])}
                                                style={{ font: "400 10px var(--mono)", padding: "1px 5px",
                                                         opacity: on ? 1 : 0.45 }}>
                                                {t.key}
                                            </button>
                                        )
                                    })}
                                </div>
                            )}
                        </Fragment>
                    ))}
                </div>

                {/* Context layers — build spec v2 §4.2. "Satellite tasking
                    (none)" is deliberately unavailable — a real, honest
                    unavailable capability, not a silently-broken toggle. */}
                <div style={{ padding: "8px 0", borderBottom: "1px solid var(--line-soft)" }}>
                    <div style={{ padding: "2px 12px 4px", font: "600 11px var(--font)", color: "var(--txt-3)" }}>Context layers</div>
                    {[
                        ["risk", "Country risk index"],
                        // Bases, hospitals, police. Context rather than
                        // findings, so off by default and near-zoom only.
                        ["facilities", "Bases, hospitals, police"],
                        ["graticule", "Graticule 10°"],
                        ["flows", "Trade & energy flows"],
                        ["aois", "Areas of interest"],
                        ["labels", "Marker labels"],
                    ].map(([key, label]) => (
                        <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 12px" }}>
                            <span style={{ flex: 1, font: "400 12px var(--font)", color: "var(--txt-2)" }}>{label}</span>
                            <button
                                onClick={() => setContextOn((p) => ({ ...p, [key]: !p[key] }))}
                                title={contextOn[key] ? "Hide layer" : "Show layer"}
                                style={{ width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", cursor: "pointer", color: contextOn[key] ? "var(--txt-2)" : "var(--txt-4)" }}
                            >
                                <svg className="icon sm"><use href={contextOn[key] ? "#i-eye" : "#i-eye-off"} /></svg>
                            </button>
                        </div>
                    ))}
                    {/* Frontlines, per theatre. The unavailable ones are
                        listed rather than hidden: a control layer offering
                        only Ukraine implies the other wars have no front
                        line, and each row carries the actual reason. */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 12px" }}>
                        <span style={{ flex: 1, font: "400 12px var(--font)", color: "var(--txt-2)" }}>Frontlines</span>
                        <button
                            onClick={() => setContextOn((p) => ({ ...p, frontlines: !p.frontlines }))}
                            title={contextOn.frontlines ? "Hide layer" : "Show layer"}
                            style={{ width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", cursor: "pointer", color: contextOn.frontlines ? "var(--txt-2)" : "var(--txt-4)" }}
                        >
                            <svg className="icon sm"><use href={contextOn.frontlines ? "#i-eye" : "#i-eye-off"} /></svg>
                        </button>
                    </div>
                    {frontlineTheatres.map((t) => (
                        <Fragment key={t.key}>
                        <div
                             title={t.available
                                 ? `${t.label} — ${t.source}`
                                 : `${t.label} — ${t.reason}`}
                             style={{ display: "flex", alignItems: "center", gap: 8,
                                      padding: "3px 12px 3px 27px",
                                      opacity: contextOn.frontlines && t.available ? 1 : 0.4 }}>
                            <span style={{ flex: 1, font: "400 11px var(--font)", color: "var(--txt-3)" }}>
                                {t.label}
                                {/* Two different absences, said differently. No
                                    open source means there is no map; no legend
                                    means there is a map whose sides we cannot
                                    name — and the second is still worth drawing. */}
                                {!t.available ? (
                                    <span style={{ color: "var(--txt-4)" }}> · no open source</span>
                                ) : t.legend_known === false ? (
                                    <span style={{ color: "var(--txt-4)" }}> · factions unavailable</span>
                                ) : null}
                            </span>
                            <button
                                onClick={t.available && contextOn.frontlines
                                    ? () => setTheatresOn((p) => ({ ...p, [t.key]: !p[t.key] }))
                                    : undefined}
                                disabled={!t.available || !contextOn.frontlines}
                                title={t.available ? (theatresOn[t.key] ? "Hide" : "Show") : t.reason}
                                style={{ width: 18, height: 18, display: "flex", alignItems: "center",
                                         justifyContent: "center", background: "none", border: "none",
                                         cursor: t.available && contextOn.frontlines ? "pointer" : "default",
                                         color: theatresOn[t.key] && t.available && contextOn.frontlines
                                             ? "var(--txt-2)" : "var(--txt-4)" }}
                            >
                                <svg className="icon sm"><use href={theatresOn[t.key] && t.available ? "#i-eye" : "#i-eye-off"} /></svg>
                            </button>
                        </div>
                        {/* Only Ukraine has a published snapshot history to
                            scrub through; the wiki theatres have revisions
                            but not a map per day. */}
                        {t.key === "ukraine" && contextOn.frontlines && theatresOn.ukraine
                            && snapshots.length > 1 && (
                            <div style={{ padding: "2px 12px 8px 27px" }}>
                                <input
                                    type="range" min={0} max={snapshots.length - 1}
                                    value={snapIdx == null ? snapshots.length - 1 : snapIdx}
                                    onChange={(e) => setSnapIdx(Number(e.target.value))}
                                    style={{ width: "100%", accentColor: "var(--acc-hi)" }}
                                    aria-label="Frontline date"
                                />
                                <div style={{ display: "flex", justifyContent: "space-between",
                                              font: "400 10px var(--mono)", color: "var(--txt-4)" }}>
                                    <span>{String(snapshots[0]?.at || "").slice(0, 10)}</span>
                                    <span style={{ color: frontlinesAt ? "var(--acc-hi)" : "var(--txt-3)" }}>
                                        {frontlinesAt || "live"}
                                    </span>
                                    <span
                                        role="button" tabIndex={0}
                                        onClick={() => setSnapIdx(null)}
                                        style={{ cursor: "pointer",
                                                 color: snapIdx == null ? "var(--txt-4)" : "var(--acc-hi)" }}>
                                        {snapIdx == null ? "now" : "back to now"}
                                    </span>
                                </div>
                            </div>
                        )}
                        </Fragment>
                    ))}
                    <div
                        role="button" tabIndex={0}
                        onClick={() => toast("Satellite tasking is not a real capability in this build yet", { icon: "icon-eye-off" })}
                        style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 12px", cursor: "pointer", opacity: 0.55 }}
                    >
                        <span style={{ flex: 1, font: "400 12px var(--font)", color: "var(--txt-3)" }}>Satellite tasking (none)</span>
                        <svg className="icon sm" style={{ color: "var(--txt-4)" }}><use href="#i-eye-off" /></svg>
                    </div>
                </div>

                {/* §10.3 puts the risk index fifth in this pane, after the
                    severity floor. Its map shading is gone with the threat
                    heatmap; sort order and the breakdown are what remain, and
                    they were always the falsifiable half. */}
                <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--line-soft)" }}>
                    <div style={{ font: "600 11px var(--font)", color: "var(--txt-3)", marginBottom: 8 }}>Severity floor</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {SEVERITY_FLOORS.map((f) => (
                            <button key={f.key} className="chip" aria-pressed={severityFloor === f.key} onClick={() => setSeverityFloor(f.key)}>{f.label}</button>
                        ))}
                    </div>
                </div>

                {/* §L5 — Global infrastructure. Each row carries an
                    epistemic sub-line (§L2): "the cheapest honesty mechanism
                    in the product, and it costs one line per row." */}
                <div style={{ padding: "8px 0", borderBottom: "1px solid var(--line-soft)" }}>
                    <div style={{ padding: "2px 12px 4px", font: "600 11px var(--font)", color: "var(--txt-3)" }}>
                        Global infrastructure
                        <span style={{ float: "right", font: "10px var(--mono)", color: "var(--txt-4)" }}>
                            {Object.values(infraOn).filter(Boolean).length}/{Object.keys(infraOn).length}
                        </span>
                    </div>
                    {INFRA_LAYERS.map((l) => (
                        <button key={l.key} type="button" className="layer"
                                aria-pressed={!!infraOn[l.key]}
                                onClick={() => setInfraOn((p) => ({ ...p, [l.key]: !p[l.key] }))}>
                            <i className="sw" style={{ background: l.color }} />
                            <span className="n">{l.label}<em>{l.note}</em></span>
                            <span className="c" />
                            <span className="eye">
                                <svg className="icon sm"><use href={infraOn[l.key] ? "#i-eye" : "#i-eye-off"} /></svg>
                            </span>
                        </button>
                    ))}
                </div>

                {contextOn.risk && <RiskIndexPanel />}

                {/* §13 — seventh in §10.3's pane order. Its own on/off lives
                    in the panel head rather than the Context-layers list,
                    because the panel is useless without the layer and vice
                    versa: the map poses the question and the asset list at the
                    bottom is the answer. */}
                <CoveragePanel
                    on={contextOn.coverage}
                    onToggle={() => setContextOn((p) => ({ ...p, coverage: !p.coverage }))}
                />

                <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--line-soft)" }}>
                    <div style={{ font: "600 11px var(--font)", color: "var(--txt-3)", marginBottom: 8 }}>Time window</div>
                    <div className="seg">
                        {TIME_WINDOWS.map((w) => (
                            <button key={w.key} aria-pressed={timeWindow === w.key} onClick={() => setTimeWindow(w.key)}>{w.label}</button>
                        ))}
                    </div>
                </div>

                {/* Live tracks — real AIS/ADS-B position rendering, build
                    spec v2 §4.2/§6. All off by default per §1. */}
                <div style={{ padding: "8px 0" }}>
                    <div style={{ padding: "2px 12px 4px", font: "600 11px var(--font)", color: "var(--txt-3)" }}>Live tracks</div>
                    {[
                        ["vessels", "Vessels (AIS)", trackCounts.vessels],
                        ["aircraft", "Aircraft (ADS-B)", trackCounts.aircraft],
                        ["sanctionedOnly", "Sanctioned/watchlisted only", trackCounts.sanctioned],
                        // "Ports & airports" moved to Global infrastructure
                        // (§L5) and split in two. They are fixed facilities,
                        // not live tracks, and they were sharing one switch.
                    ].map(([key, label, count]) => (
                        <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 12px" }}>
                            <span style={{ flex: 1, font: "400 12px var(--font)", color: "var(--txt-2)" }}>{label}</span>
                            <span style={{ font: "400 11px var(--mono)", color: "var(--txt-4)" }}>{count == null ? "—" : count}</span>
                            <button
                                onClick={() => setTracksOn((p) => ({ ...p, [key]: !p[key] }))}
                                title={tracksOn[key] ? "Hide layer" : "Show layer"}
                                style={{ width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", cursor: "pointer", color: tracksOn[key] ? "var(--txt-2)" : "var(--txt-4)" }}
                            >
                                <svg className="icon sm"><use href={tracksOn[key] ? "#i-eye" : "#i-eye-off"} /></svg>
                            </button>
                        </div>
                    ))}
                </div>

                {/* Annotations — the management surface for the same real
                    shared list the map header's annotation toolbar creates
                    into (§3). Inline rename, fly-to, delete per row. */}
                <div style={{ padding: "8px 0", borderTop: "1px solid var(--line-soft)" }}>
                    <div style={{ padding: "2px 12px 4px", font: "600 11px var(--font)", color: "var(--txt-3)" }}>Annotations</div>
                    {annotations.length === 0 ? (
                        <div style={{ padding: "3px 12px", font: "400 11.5px var(--font)", color: "var(--txt-4)" }}>No annotations yet — draw one from the map header toolbar.</div>
                    ) : annotations.map((a) => (
                        <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 12px" }}>
                            <span style={{ width: 7, height: 7, borderRadius: 1, background: "#c8a04a", flexShrink: 0 }} />
                            <input
                                className="input" defaultValue={a.name}
                                onBlur={(e) => { if (e.target.value.trim() && e.target.value !== a.name) renameAnnotation(a.id, e.target.value.trim()) }}
                                onKeyDown={(e) => { if (e.key === "Enter") e.target.blur() }}
                                style={{ flex: 1, height: 20, padding: "0 4px", font: "400 11.5px var(--font)" }}
                            />
                            <button
                                onClick={() => window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: a.points[0].lat, lon: a.points[0].lon, altitude: 250000 } }))}
                                title="Fly to" style={{ width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", cursor: "pointer", color: "var(--txt-3)" }}
                            ><svg className="icon sm"><use href="#i-recentre" /></svg></button>
                            <button
                                onClick={() => removeAnnotation(a.id)}
                                title="Delete" style={{ width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", cursor: "pointer", color: "var(--txt-3)" }}
                            ><svg className="icon sm"><use href="#i-trash" /></svg></button>
                        </div>
                    ))}
                </div>
            </div>
            )}

            {/* Center — globe + density strip */}
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                {/* Header band — the map-overlay-geometry table's authority on
                    placement: annotation toolbar + quick-layer buttons live
                    HERE, in this band, never floating on the map surface.
                    position:relative + z-index:4 + solid --bg-2 so this band
                    sits above the glass side panes rather than underneath
                    them (the asides' own slide transform never overlaps this
                    row). Overflow defense: min-width:0 + overflow-x:auto on
                    the row, flex:none + white-space:nowrap on every control,
                    so a long live-count string can push controls into a
                    scroll region instead of rendering them underneath a
                    glass pane where they'd be unclickable and invisible. */}
                <div style={{
                    height: 28, flexShrink: 0, background: "var(--bg-2)", borderBottom: "1px solid var(--line)",
                    display: "flex", alignItems: "center", gap: 10, padding: "0 12px", zIndex: 4, position: "relative",
                    minWidth: 0, overflowX: "auto",
                }}>
                    <span style={{ flex: "none", whiteSpace: "nowrap", font: "400 11.5px var(--font)", color: "var(--txt-2)" }}>{visibleRows.length} signals · {timeWindow} window</span>
                    {surfaceUpdatedAt && (
                        <span title="Real GET /api/surface updated_at — may be a persisted snapshot rather than a freshly-built pool (e.g. right after a cold backend start)" style={{ flex: "none", whiteSpace: "nowrap", font: "400 11px var(--mono)", color: "var(--txt-4)" }}>
                            as of {timeAgoLabel(surfaceUpdatedAt, nowMs)}
                        </span>
                    )}

                    {/* The annotation toolbar that used to sit in this band has
                        moved onto the map itself, as PARALLAX §10.1's vertical
                        `.annobar` (top-left, 28px buttons). The earlier comment
                        here asserted these controls must "never float on the map
                        surface" — true when the side panes were translucent
                        overlays a floating control could end up unreachable
                        under, but the panes are opaque grid columns now and §10
                        is explicit about the placement. */}
                    {/* Quick-layer buttons — immediately next to the annotation
                        toolbar, same shared groupsOn state the Layers pane's
                        domain rows use (one real toggle, never a duplicate). */}
                    <div style={{ display: "flex", alignItems: "center", flex: "none" }}>
                        {QUICK_LAYERS.map((l, i) => (
                            <button
                                key={l.key}
                                onClick={() => setGroupsOn((p) => ({ ...p, [l.key]: !p[l.key] }))}
                                title={l.label}
                                aria-pressed={groupsOn[l.key]}
                                style={{
                                    flex: "none", whiteSpace: "nowrap", width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center",
                                    background: groupsOn[l.key] ? "var(--bg-4)" : "none", border: "none",
                                    borderRight: i < QUICK_LAYERS.length - 1 ? "1px solid var(--line-soft)" : "none",
                                    cursor: "pointer", color: groupsOn[l.key] ? "var(--txt)" : "var(--txt-3)",
                                }}
                            >
                                <svg className="icon sm"><use href={`#${l.icon}`} /></svg>
                            </button>
                        ))}
                    </div>

                    <div style={{ flex: 1 }} />
                    {/* The imagery entry point is now the single `#t-imagery`
                        control in `.annobar` — §10.1 calls out by name that
                        there must be ONE imagery icon, not two. */}
                    <button
                        onClick={() => setExportOpen(true)}
                        title="Export signals for a time period (CSV/PDF)"
                        style={{
                            flex: "none", whiteSpace: "nowrap", width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center",
                            background: "none", border: "1px solid var(--line-soft)", borderRadius: 3, cursor: "pointer", color: "var(--txt-3)",
                        }}
                    >
                        <svg className="icon sm"><use href="#i-export" /></svg>
                    </button>
                    <div className="seg" style={{ flex: "none" }}>
                        {CAMERA_PRESETS.map((p) => (
                            <button
                                key={p.key}
                                onClick={() => window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: p.lat, lon: p.lon, altitude: p.altitude } }))}
                                title={`Fly to ${p.label}`}
                                style={{ flex: "none", whiteSpace: "nowrap" }}
                            >{p.label}</button>
                        ))}
                    </div>
                </div>
                <div style={{
                    flex: 1, minHeight: 0, position: "relative",
                    // The map chrome positions itself against the VISIBLE map,
                    // not the canvas — the panes overlay the canvas, so without
                    // these the annobar lands on top of the Layers pane and the
                    // scale bar disappears underneath it. Same real widths the
                    // GlobeView insets below already use.
                    "--map-inset-l": leftMin ? "0px" : "250px",
                    "--map-inset-r": `${activeRightOverlayWidth || 0}px`,
                }}>
                    {/* Event domains — real signal/alert visualization, per group.
                        Fixed a real bug here: precisionEventsEnabled defaults to
                        true INSIDE GlobeView itself when omitted, so News being
                        "off" didn't actually turn off precision event markers —
                        it's now explicitly wired to the same real toggle. */}
                    <GlobeView
                        eventsEnabled={groupsOn.news} precisionEventsEnabled={groupsOn.news}
                        geoConfirmedEnabled={groupsOn.news}
                        gdeltEnabled={groupsOn.news && gdeltOn}
                        gdeltTypes={gdeltTypes}
                        firesEnabled={groupsOn.imagery && firesOn}
                        geoConfirmedTheatres={geoConfirmedTheatres}
                        geoConfirmedEndDate={geoConfirmedEndDate}
                        derivedAlertsEnabled={groupsOn.alerts}
                        coverageEnabled={contextOn.coverage}
                        mapChromeLeftInset={leftMin ? 0 : 250}
                        /* Real root-cause fix — the Time window/severity-
                           floor selector previously never reached the map
                           at all (only the domain on/off toggles did); the
                           "signal" layers below now apply the exact same
                           real src/lib/signalVisibility.js decision this
                           screen's own header/legend/histogram counts use. */
                        signalWindowHours={windowHours} signalMaxRank={maxRank}
                        dockExternally
                        onInspectorPopupChange={handleInspectorPopupChange}
                        cablesEnabled={infraOn.cables} chokepointsEnabled={infraOn.chokepoints}
                        riskEnabled={contextOn.risk}
                        frontlinesEnabled={contextOn.frontlines && !!theatresOn.ukraine}
                        frontlinesAt={frontlinesAt}
                        facilitiesEnabled={contextOn.facilities}
                        warmapTheatres={contextOn.frontlines
                            ? frontlineTheatres
                                .filter((t) => t.kind === "points" && theatresOn[t.key])
                                .map((t) => t.key)
                            : []}
                        satelliteEnabled={groupsOn.imagery} infraEnabled={infraOn.power}
                        nauticalEnabled={infraOn.nautical}
                        eezEnabled={groupsOn.zones}
                        /* Context layers — separate from event domains, per build spec v2 §4.2 */
                        graticuleEnabled={contextOn.graticule}
                        cityLabelsEnabled={contextOn.labels}
                        /* Live tracks — real raw position rendering, independent of the
                           event-domain toggles above (a vessel's SIGNAL can be shown
                           without its live position, and vice versa). All off by
                           default per §1. */
                        aisEnabled={tracksOn.vessels} adsbEnabled={tracksOn.aircraft}
                        portsEnabled={infraOn.ports} airportsEnabled={infraOn.airfields}
                        annotationTool={annotationTool}
                        basemap={basemap}
                        /* Real Imagery/detection draw + overlay + detection
                           rendering — GlobeOverwatchDrawLayer.jsx /
                           GlobeOverwatchLayer.jsx, real components already
                           built into GlobeView.jsx with no live consumer
                           anywhere in the app until this round (confirmed:
                           neither app.jsx's own Overwatch sidebar nor
                           Dashboard.jsx's <GlobeView> ever wired these props
                           through). */
                        overwatchEnabled={imageryPanelOpen}
                        overwatchDetections={imageryDetections}
                        overwatchDrawActive={imageryDrawActive}
                        overwatchDrawMode={imageryDrawMode}
                        onOverwatchBounds={handleImageryBounds}
                        onOverwatchPolygon={handleImageryPolygon}
                        overwatchSentinelOverlay={imageryScene ? { image_b64: imageryScene.image_b64_composited, bounds: imageryScene.bounds } : null}
                    />
                    {/* §10.1 / §10.2 / §10 `.mapmeta` — the map's own chrome,
                        inside the map container so it is positioned against the
                        canvas rather than the screen. Replaces MapControlStack's
                        lower-right 32px stack, which predates these tokens and
                        put zoom in a different corner from the spec.

                        Tool vocabulary is translated at this boundary: §10 names
                        the tools select/measure/pin/poly, while GlobeView's
                        annotation layer has always spoken select/measure/marker/
                        area. The spec's ids are what appear in the DOM; the
                        existing layer keeps its own vocabulary rather than being
                        renamed underneath working draw code. */}
                    <MapAnnobar
                        tool={TOOL_TO_SPEC[annotationTool] || "select"}
                        onToolChange={(k) => setAnnotationTool(SPEC_TO_TOOL[k] || "select")}
                        toggles={{
                            imagery: imageryPanelOpen,
                            grat: contextOn.graticule,
                            label: contextOn.labels,
                        }}
                        disabledToggles={{ imagery: !imageryEnabled }}
                        onToggle={(k) => {
                            if (k === "imagery") {
                                if (!imageryEnabled) return
                                imageryPanelOpen ? closeImageryPanel() : setImageryPanelOpen(true)
                                return
                            }
                            // Explicit map, no fallthrough default: "risk" used
                            // to be the default arm, so an unrecognised key
                            // silently toggled the risk layer. With that layer
                            // gone the same shape would write a field nothing
                            // reads, which is a toggle that appears to work.
                            const field = k === "grat" ? "graticule" : k === "label" ? "labels" : null
                            if (!field) return
                            setContextOn((p) => ({ ...p, [field]: !p[field] }))
                        }}
                    />
                    <MapChrome basemap={{ value: basemap, onChange: setBasemap }} />
                    <MapMeta />
                    {/* §6 — the ONE map tooltip. Mounted here, driven by any
                        layer through mapTip.js; no layer renders its own. */}
                    <MapTip />
                    {/* The severity legend used to float here, bottom-right —
                        per the map-overlay-geometry table it does not belong
                        on the map surface at all; it now lives inside the
                        Inspector pane only (both its states, below). */}
                    {/* The GeoConfirmed archive used to float here as its own
                        overlay, measuring itself with a ResizeObserver and
                        pushing the map chrome around from the outside. §11
                        makes it the timeline FACE of the strip below, so the
                        strip's height is a fact about the layout rather than
                        something reported after the fact. */}
                    {imageryPanelOpen && (
                        <ImagerySidebar
                            onClose={closeImageryPanel}
                            drawMode={imageryDrawMode} onDrawModeChange={setImageryDrawMode}
                            onDrawActiveChange={setImageryDrawActive}
                            drawn={imageryDrawn}
                            scene={imageryScene} onSceneChange={setImageryScene}
                            detections={imageryDetections} onDetectionsChange={setImageryDetections}
                        />
                    )}
                </div>

                {/* §11 — two faces, one element. The archive face is the
                    same real playhead the map filters by (geoConfirmedEndDate),
                    so scrubbing here and the pins on the globe cannot
                    disagree. */}
                <TimeStrip
                    densityBuckets={densityBuckets}
                    windowHours={windowHours}
                    nowMs={nowMs}
                    theatres={geoConfirmedTheatres}
                    endDate={geoConfirmedEndDate}
                    onEndDateChange={setGeoConfirmedEndDate}
                />
            </div>

            {/* Right — Inspector (real frosted glass, see Layers pane comment above) */}
            {rightMin ? (
                <div className="panetab" role="button" tabIndex={0} onClick={() => setRightMin(false)} title="Restore Inspector">Inspector</div>
            ) : (
            <div className="pane-glass" data-testid="glass-inspector-pane" style={rightPaneStyle}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
                    <span style={{ font: "600 11px var(--font)", color: "var(--txt)" }}>Inspector</span>
                    <button onClick={() => setRightMin(true)} title="Minimize" style={{ background: "none", border: "none", color: "var(--txt-3)", cursor: "pointer", padding: 0, display: "flex" }}>
                        <svg className="icon sm"><use href="#i-collapse-r" /></svg>
                    </button>
                </div>
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                {inspectorPopup ? (
                    // A real map-marker click (GlobePopup, via GlobeView's
                    // dockExternally) — same real InspectorPanel component
                    // GlobePopup used to self-render as a fixed 340px
                    // overlay with its own bespoke tokens/keyframe slide;
                    // `bare` makes it fill this pane instead, so it now
                    // shares this pane's real width (var(--pane-r)), real
                    // frosted-glass background, real minimize rail, and
                    // real transition-based slide — not a second, out-of-
                    // sync panel with its own copy of all of that.
                    <InspectorPanel
                        bare
                        entityType={inspectorPopup.entityType}
                        entityId={inspectorPopup.entityId}
                        data={inspectorPopup.data}
                        onClose={() => { inspectorPopup.onClose?.(); setInspectorPopup(null) }}
                        onSelectRelated={inspectorPopup.onSelectRelated}
                        onJumpToLocation={inspectorPopup.onJumpToLocation}
                        onTrackEntity={inspectorPopup.onTrackEntity}
                    />
                ) : !selected ? (
                    <div style={{ padding: 12 }}>
                        <div className="statgrid" style={{ marginBottom: 12 }}>
                            <div className="stat"><span className="value">{visibleRows.length}</span><span className="label">Signals in window</span></div>
                            <div className="stat"><span className="value">{legendCounts[0] + legendCounts[1]}</span><span className="label">Critical + high</span></div>
                            <div className="stat"><span className="value">{byRegion.length}</span><span className="label">Regions touched</span></div>
                        </div>
                        <div className="card">
                            <span className="lbl">By region</span>
                            {byRegion.length === 0 ? (
                                <div style={{ font: "400 12px var(--font)", color: "var(--txt-4)" }}>No real region data in this window.</div>
                            ) : byRegion.map(([name, count]) => (
                                <div key={name} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", font: "400 12px var(--font)", color: "var(--txt-2)" }}>
                                    <span>{name}</span><span style={{ font: "400 11.5px var(--mono)", color: "var(--txt-3)" }}>{count}</span>
                                </div>
                            ))}
                        </div>
                        <div style={{ marginTop: 12 }}>
                            <SeverityLegend legendCounts={legendCounts} />
                        </div>
                        <div style={{ marginTop: 12 }}>
                            <div style={{ font: "600 11px var(--font)", color: "var(--txt-3)", marginBottom: 6 }}>Newest critical</div>
                            {newestCritical.length === 0 ? (
                                <div style={{ font: "400 12px var(--font)", color: "var(--txt-4)" }}>No critical or high-severity signals in this window.</div>
                            ) : newestCritical.map((r) => (
                                <div key={r.id} className="evrow" onClick={() => { setInspectorPopup(null); setSelected(r) }}>
                                    <span className={`dia ${SEV_CLASS_BY_RANK[r.severityRank] || "moderate"}`} />
                                    <div>
                                        <div className="title">{r.title}</div>
                                        <div className="meta"><span>{r.aoi || "Unknown location"}</span></div>
                                    </div>
                                    {r.lat != null && r.lon != null && (
                                        <button className="btn ghost sm" title="Replay on map" onClick={(e) => { e.stopPropagation(); replayOnMap({ lat: r.lat, lon: r.lon, publishedAt: r.publishedAt, title: r.title }) }} style={{ padding: 2 }}>
                                            <svg className="icon sm"><use href="#i-clock" /></svg>
                                        </button>
                                    )}
                                    <span className="time">{timeAgoLabel(r.publishedAt, nowMs)}</span>
                                </div>
                            ))}
                        </div>
                        {inspectorExtensions.map((Ext, i) => (
                            <Ext key={i} recordRef={null} record={null} />
                        ))}
                    </div>
                ) : (
                    <div style={{ padding: 12 }}>
                        <span role="button" tabIndex={0} onClick={() => setSelected(null)} style={{ font: "400 11px var(--font)", color: "var(--acc-hi)", cursor: "pointer" }}>← Back</span>
                        <div className={`sev ${SEV_CLASS_BY_RANK[selected.severityRank] || "moderate"}`} style={{ marginTop: 10 }}>
                            <span className={`dia ${SEV_CLASS_BY_RANK[selected.severityRank] || "moderate"}`} />
                            <span>{SEV_LEGEND[selected.severityRank]?.label || "Moderate"}</span>
                            <span style={{ color: "var(--txt-4)" }}>· {selected.kind === "fusion" ? "Fusion" : "Signal"}</span>
                            <span style={{ marginLeft: "auto", color: "var(--txt-4)" }}>{timeAgoLabel(selected.publishedAt, nowMs)}</span>
                        </div>
                        <div style={{ font: "600 15px var(--font)", color: "var(--txt)", margin: "8px 0" }}>{selected.title}</div>
                        <div className="card">
                            <span className="lbl">Assessment</span>
                            <div style={{ font: "400 12.5px var(--font)", color: "var(--txt-2)", lineHeight: 1.5 }}>
                                {selected.description || "No real assessment text available for this signal."}
                            </div>
                        </div>
                        <div className="card">
                            <span className="lbl">Geolocation</span>
                            <dl className="kv">
                                <dt>Place</dt><dd>{selected.aoi || "Unknown"}</dd>
                                {selected.lat != null && selected.lon != null && (
                                    <><dt>Coordinates</dt><dd style={{ fontFamily: "var(--mono)" }}>{selected.lat.toFixed(4)}, {selected.lon.toFixed(4)}</dd></>
                                )}
                                {selected.confidencePct != null && <><dt>Confidence</dt><dd><div className="conf"><span className="value">{selected.confidencePct}%</span><span className="bar"><span style={{ width: `${selected.confidencePct}%` }} /></span></div></dd></>}
                            </dl>
                        </div>
                        <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                            <button className="btn primary sm" onClick={() => handleAddToBriefing(selected)}>Add to briefing</button>
                            {selected.lat != null && selected.lon != null && (
                                <button className="btn sm" onClick={() => window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: selected.lat, lon: selected.lon, altitude: 250000 } }))}>Centre map</button>
                            )}
                            {selected.lat != null && selected.lon != null && (
                                <button className="btn sm" onClick={() => replayOnMap({ lat: selected.lat, lon: selected.lon, publishedAt: selected.publishedAt, title: selected.title })}>Replay on map</button>
                            )}
                            <button className="btn sm" onClick={() => onOpenDossier?.(selected)}>Open dossier</button>
                        </div>
                        <div style={{ marginTop: 12 }}>
                            <SeverityLegend legendCounts={legendCounts} />
                        </div>
                        {inspectorExtensions.map((Ext, i) => (
                            <Ext key={i} recordRef={selectedRef} record={selected} />
                        ))}
                    </div>
                )}
                </div>
            </div>
            )}

            {exportOpen && (
                <SignalsExportPanel
                    defaultFrom={new Date(Date.now() - windowHours * 3600 * 1000)}
                    defaultTo={new Date()}
                    defaultMinSeverity={severityFloor === "low" ? "" : severityFloor}
                    onClose={() => setExportOpen(false)}
                />
            )}
        </div>
    )
}
