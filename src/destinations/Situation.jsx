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
import MapSceneCard, { MAP_SCENE_UI, MapSplitHandle, mapSceneOverlay } from "../components/MapSceneCard.jsx"
import { EMPTY_VESSEL_FILTER, EMPTY_AIRCRAFT_FILTER } from "../globe/trackFilters.js"
import { VesselFilterPanel, AircraftFilterPanel } from "../components/TrackFilterPanel.jsx"
import { useChrome, getStartupLayers, saveStartupLayers, clearStartupLayers } from "../state/useChrome.js"
import { createPortal } from "react-dom"
import { captureElement } from "../capture/Capturable.jsx"
import { saveForBriefing } from "../state/savedForBriefing.js"
import { useEffect, useMemo, useState, useRef, useCallback, Fragment } from "react"
import API_BASE from "../apiBase.js"
import ConflictContext from "../conflicts/ConflictContext.jsx"
import Columns, { BarList } from "../charts/Columns.jsx"
import { safeArray } from "../utils/safeArray.js"
import GlobeView from "../components/GlobeView.jsx"
import { GDELT_EVENT_TYPES } from "../globe/GlobeGdeltLayer.jsx"
import MapAnnobar from "../components/MapAnnobar.jsx"
import MapChrome from "../components/MapChrome.jsx"
import MapMeta from "../components/MapMeta.jsx"
import MapTip from "../components/MapTip.jsx"
import { LAYER_GROUPS, SEVERITY_FLOORS, TIME_WINDOWS } from "../components/layerRailConfig.js"
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
import { tintBackground } from "./criticalTint.js"
import SignalsExportPanel from "./SignalsExportPanel.jsx"
import RiskIndexPanel from "../components/RiskIndexPanel.jsx"
import CoveragePanel from "../components/CoveragePanel.jsx"
import InspectorPanel from "../components/InspectorPanel.jsx"
import LayerGroup from "../components/LayerGroup.jsx"
import TimeStrip from "../components/TimeStrip.jsx"
import VoiceBar from "../voice/VoiceBar.jsx"
import { setVoiceSelection } from "../voice/voiceContext.js"
import ImagerySidebar, { IMAGERY_PANE_W } from "../components/ImagerySidebar.jsx"
import { getSettings, subscribeSettings } from "../state/settingsStore.js"
import LayerSubGroup from "../components/LayerSubGroup.jsx"
import LayerStatus from "../components/LayerStatus.jsx"
import FlowsPanel from "../components/FlowsPanel.jsx"
import { whenLabel } from "../utils/formatTime.js"

const API = API_BASE
// How often the surface pool, fusions and health are re-read. This
// drives "newest critical" and the signal counts, so it is the number
// that decides whether the page feels live or looks like a snapshot
// somebody took a minute ago. Twenty seconds is well inside the rate at
// which the backend loops publish, and these are small cached reads.
const REFRESH_MS = 20000

const SEVERITY_TIER_ORDER = ["critical", "significant", "elevated", "low"]
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
    { key: "airfields", label: "Airports & airfields", note: "full roster", color: "var(--steel)" },
    { key: "cables", label: "Submarine cables", note: "Indicative trunk routes, not survey data", color: "var(--acc-hi)" },
    { key: "power", label: "Power grid", note: "community-maintained raster", color: "var(--amber)" },
    { key: "nautical", label: "Nautical chart", note: "nautical raster overlay", color: "var(--green)" },
    // Facilities live here rather than under Context layers: they are
    // infrastructure, and they belong beside ports and airfields, which
    // is where someone looking for "what is on the ground" will look.
    // One row per kind so the three can be asked for separately —
    // "where are the hospitals" and "where are the barracks" are
    // different questions asked at different moments.
    { key: "facMilitary", label: "Military sites", note: "bases, barracks, bunkers", color: "#C084FC" },
    { key: "facMedical", label: "Hospitals & clinics", note: "crowd-mapped, uneven coverage", color: "#3DDC97" },
    { key: "facSecurity", label: "Police & fire", note: "OSM — crowd-mapped, uneven coverage", color: "#3D8BFF" },
]

// Which ontology entity_type each facility row draws.
export const FACILITY_ROW_TYPE = {
    facMilitary: "Military Facility",
    facMedical: "Medical Facility",
    facSecurity: "Security Facility",
}

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
/** Puts its children in the top bar's slot, or nowhere if there isn't one.
 *
 * The map's tools belong in the chrome rather than floating over the
 * geography they operate on, but they need Situation's state — so the DOM
 * moves and the ownership does not. Rendering null when the slot is absent
 * means a destination without a top bar (presentation mode, mobile) simply
 * does not show them, rather than crashing. */
function MapToolsPortal({ children }) {
    const [slot, setSlot] = useState(null)
    useEffect(() => {
        const find = () => setSlot(document.getElementById("topbar-map-tools"))
        find()
        // The top bar mounts in the same commit; one retry covers the race
        // without a polling loop.
        const t = setTimeout(find, 0)
        return () => clearTimeout(t)
    }, [])
    return slot ? createPortal(children, slot) : null
}

// The zones/EEZ quick button is deliberately absent. EEZ boundaries are
// reference geography rather than something you flick on and off while
// working, and the switch still lives in the Layers rail where the rest of
// the reference layers are.
const QUICK_LAYERS = [
    { key: "maritime", label: "Maritime", icon: "i-ship" },
    { key: "air", label: "Air", icon: "i-plane" },
    { key: "news", label: "News", icon: "i-read" },
    { key: "alerts", label: "Alerts", icon: "i-flag" },
]

// Real Cesium camera presets, build spec v2 §8 — "implemented as camera
// presets rather than a projection change." Center/altitude computed from
// the reference spec's own real regional bounding boxes (world
// [[-170,78],[178,-58]], emea [[-22,62],[62,-12]], apac [[62,46],[150,-12]],
// amer [[-128,52],[-32,-46]]), not guessed.

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

export default function Situation({ onOpenDossier, asCanvas = false }) {
    /* ▣ Canvas — this screen doubles as the app's background.
       When another mode is on top, everything here except the map itself
       has to go: the Layers and Inspector panes sit at z 25/26 and the
       time strip at z 24, all of them ABOVE the z-22 glass sheet the mode
       renders into, so leaving them mounted would punch Situation's
       furniture straight through Home. The map stays, which is the whole
       point — it is what the glass is blurring. */
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
    // 48 hours by default (the owner, 2026-10-07): the last two days on the map
    const [timeWindow, setTimeWindow] = useState("48h")
    // Fidelity pass §1 — the app's base/default state is ALL LAYERS OFF (a
    // bare map until the analyst turns something on). Was defaulting every
    // group to true; severity floor/time window are filter settings, not
    // layer toggles, and keep their own sensible defaults since they don't
    // clutter an empty map on their own.
    // DEFAULT MAP STATE: news, GDELT and country risk on; everything
    // else off. A globe that opens with every layer lit is not a map of
    // anything — the reader has to turn things OFF to find the picture,
    // which is backwards.
    const [groupsOn, setGroupsOn] = useState(() => Object.fromEntries(
        // News and alerts on: an alert or a fusion the map does not show is
        // one nobody sees — the Alerts group was off unless switched on.
        // Imagery on too: it no longer means "cover the map in satellite
        // imagery" — that is its own switch (satImageOn), off by default.
        LAYER_GROUPS.map((g) => [g.key, g.key === "news" || g.key === "alerts" || g.key === "imagery"])))
    // Default OFF. Machine-coded pins are opt-in: the reader should choose
    // to accept them, not discover them mixed in with verified events.
    // CONFIRMED AND UNCONFIRMED ARE SEPARATE SWITCHES because they are
    // separate claims. A GeoConfirmed pin is a person who found the building
    // in the video; a wire report is a machine's reading of a news story.
    // They were both tied to one "News" toggle, so an analyst who wanted
    // only what had been verified could not have it.
    const [geoConfirmedOn, setGeoConfirmedOn] = useState(true)
    const [gdeltOn, setGdeltOn] = useState(true)
    const [telegramOn, setTelegramOn] = useState(true)
    // Riots, protests and civil unrest, and the gatherings announced for
    // the coming days — kept apart from the fighting by their own toggle.
    const [unrestOn, setUnrestOn] = useState(true)
    // Which CAMEO codings to draw. Starts as every kind rather than a
    // curated subset: a reader who has not chosen yet should see the whole
    // feed, not a silently narrowed one.
    const [gdeltTypes, setGdeltTypes] = useState(() => GDELT_EVENT_TYPES.map((t) => t.key))
    // Default ON: a thermal anomaly is a real instrument reading and it is
    // what decides where imagery gets tasked, so hiding it by default
    // conceals the system's own reasoning.
    const [firesOn, setFiresOn] = useState(false)
    // The Imagery group's three switches, independent of each other: the
    // signals a pass raised, the heat detections, and the full satellite
    // base image — which used to come on with the group and hide the map.
    const [imagerySignalsOn, setImagerySignalsOn] = useState(true)
    // Our assets on the map (GlobeAssetsLayer): on — they are the point.
    const [assetsOn, setAssetsOn] = useState(true)
    const [satImageOn, setSatImageOn] = useState(false)
    // Default off: it is a specialist reading, and a globe that
    // opens with every layer lit is not a map of anything.
    const [gpsInterferenceOn, setGpsInterferenceOn] = useState(false)
    // Which theatres the frontline layer should draw. Ukraine is the only
    // one with an open control feed today; the roster comes from the
    // backend so adding a source later needs no frontend change.
    // Ukraine defaults on; the point-based theatres do not, because
    // Syria alone carries 7,576 marks and turning them all on unasked
    // would bury the rest of the map.
    const [theatresOn, setTheatresOn] = useState({})
    const [frontlineTheatres, setFrontlineTheatres] = useState([])
    const [contextOn, setContextOn] = useState({ risk: true, frontlines: false, coverage: false, graticule: false, flows: false, aois: false, labels: false })
    // Global Fishing Watch events, per kind. Off by default: they are
    // days old by nature and belong on the map only when asked for.
    const [gfwOn, setGfwOn] = useState({
        encounters: false, gaps: false, loitering: false, "port-visits": false })
    // Controlled airspace volumes. Off by default and only drawn close
    // in — 31 volumes over one German state is a wash at wider zoom.
    const [airspaceOn, setAirspaceOn] = useState(false)
    const [airspaceStatus, setAirspaceStatus] = useState(null)
    const [gfwHeatOn, setGfwHeatOn] = useState(false)
    // Every switch inside a group, by its SUB_LAYERS key (layerRailConfig),
    // as [value, setter], so a saved default view and a theater can carry
    // them. Rebuilt each render for the values; the setters are stable, so
    // handlers registered once can use them.
    const subLayers = useRef(null)
    subLayers.current = {
        assets: [assetsOn, setAssetsOn],
        imagerySignals: [imagerySignalsOn, setImagerySignalsOn],
        fires: [firesOn, setFiresOn],
        satImage: [satImageOn, setSatImageOn],
        gpsInterference: [gpsInterferenceOn, setGpsInterferenceOn],
        geoConfirmed: [geoConfirmedOn, setGeoConfirmedOn],
        gdelt: [gdeltOn, setGdeltOn],
        telegram: [telegramOn, setTelegramOn],
        unrest: [unrestOn, setUnrestOn],
        airspace: [airspaceOn, setAirspaceOn],
        gfwHeat: [gfwHeatOn, setGfwHeatOn],
        ...Object.fromEntries(Object.keys(gfwOn).map((k) =>
            [`gfw:${k}`, [gfwOn[k], (v) => setGfwOn((p) => ({ ...p, [k]: v }))]])),
    }
    const currentSubs = () => Object.fromEntries(
        Object.entries(subLayers.current).map(([k, [v]]) => [k, !!v]))
    // {key: bool} sets the keys it names; a list sets exactly those on and
    // every other sub-layer off.
    const applySubs = (subs) => {
        const want = Array.isArray(subs) ? Object.fromEntries(Object.keys(subLayers.current).map((k) => [k, subs.includes(k)])) : subs
        for (const [k, v] of Object.entries(want || {})) {
            const entry = subLayers.current[k]
            if (entry && typeof v === "boolean") entry[1](v)
        }
    }
    const [flowsStatus, setFlowsStatus] = useState(null)
    const [basemapHealth, setBasemapHealth] = useState(null)
    // The Ukraine time slider. `null` means live; any other value is a
    // published snapshot date. Index rather than date so the control is
    // evenly spaced in SNAPSHOTS, which is what exists, rather than in
    // days, which would put long gaps where nobody drew a map.
    const [snapshots, setSnapshots] = useState([])
    const [snapIdx, setSnapIdx] = useState(null)
    // Every other war scrubs too, through the wiki's own revisions.
    // Keyed by theatre: {stops: [{revid, at}], idx: number|null}.
    const [warTimelines, setWarTimelines] = useState({})
    // What the facilities layer is doing, so a 20-second Overpass query
    // reads as "loading" rather than as a layer that does not work.
    const [facStatus, setFacStatus] = useState(null)
    useEffect(() => {
        if (!contextOn.frontlines) return
        fetch(`${API_BASE}/api/frontlines/timeline?limit=200`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => setSnapshots(safeArray(d?.snapshots)))
            .catch(() => {})
    }, [contextOn.frontlines])
    // Load a wiki theatre's revision list the first time it is switched on.
    useEffect(() => {
        if (!contextOn.frontlines) return
        for (const t of frontlineTheatres) {
            if (t.kind !== "points" || !theatresOn[t.key]) continue
            if (warTimelines[t.key]) continue
            fetch(`${API_BASE}/api/warmap/${encodeURIComponent(t.key)}/timeline?limit=120`,
                  { credentials: "include" })
                .then((r) => (r.ok ? r.json() : null))
                .then((d) => setWarTimelines((prev) => ({
                    ...prev, [t.key]: { stops: safeArray(d?.revisions), idx: null },
                })))
                .catch(() => {})
        }
    }, [contextOn.frontlines, frontlineTheatres, theatresOn, warTimelines])

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
        facMilitary: false, facMedical: false, facSecurity: false,
    })
    const [tracksOn, setTracksOn] = useState({ vessels: false, aircraft: false, sanctionedOnly: false })
    // What kind of vessel / aircraft is drawn (globe/trackFilters.js).
    const [vesselFilter, setVesselFilter] = useState(EMPTY_VESSEL_FILTER)
    const [aircraftFilter, setAircraftFilter] = useState(EMPTY_AIRCRAFT_FILTER)
    const [trackFacets, setTrackFacets] = useState(null)
    const vesselFilterOn = useMemo(() => ({ ...vesselFilter, sanctionedOnly: tracksOn.sanctionedOnly }), [vesselFilter, tracksOn.sanctionedOnly])
    const aircraftFilterOn = useMemo(() => ({ ...aircraftFilter, watchlistedOnly: tracksOn.sanctionedOnly }), [aircraftFilter, tracksOn.sanctionedOnly])

    // THE LAUNCH STATE THE USER SAVED. Applied once, and only if they have
    // actually saved one — getStartupLayers() returns null when they never
    // have, which is deliberately different from a saved set with
    // everything off. Treating those two the same would either ignore a
    // user who wants a bare map or silently override the built-in defaults
    // for everyone who never touched the feature.
    //
    // It runs on a subscription rather than on mount because settings
    // arrive from the server after first paint; reading once on mount would
    // usually read the built-in defaults and do nothing.
    const startupApplied = useRef(false)
    useEffect(() => {
        const apply = () => {
            if (startupApplied.current) return
            const saved = getStartupLayers()
            if (!saved) return
            startupApplied.current = true
            if (saved.clean) {
                // a first login's clean sheet: every layer off
                const off = (o) => Object.fromEntries(Object.keys(o).map((k) => [k, false]))
                setGroupsOn(off); setContextOn(off); setInfraOn(off); setTracksOn(off)
                return
            }
            if (saved.groups)  setGroupsOn(saved.groups)
            if (saved.context) setContextOn(saved.context)
            if (saved.infra)   setInfraOn(saved.infra)
            if (saved.tracks)  setTracksOn(saved.tracks)
            if (saved.subs)    applySubs(saved.subs)
            // severity and time window stay with the session, which brings them back itself
            applyLayerExtrasRef.current({ ...saved, severityFloor: undefined, timeWindow: undefined })
        }
        apply()
        return subscribeSettings(apply)
    }, [])
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

    // ESCAPE LEAVES DRAW MODE. A mode that changes what a click does must
    // have an exit that does not require finding the control that started
    // it — especially this one, where the control lives in a panel the
    // reader may have collapsed to see the map they are drawing on.
    useEffect(() => {
        if (!imageryDrawActive) return
        const onKey = (e) => { if (e.key === "Escape") setImageryDrawActive(false) }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [imageryDrawActive])
    const [imageryDrawn, setImageryDrawn] = useState(null) // {bounds, polygonVertices|null}
    const [imageryScene, setImageryScene] = useState(null) // {image_b64, image_b64_composited, bounds, sensor, capture_timestamp, cloud_cover}
    const [imageryDetections, setImageryDetections] = useState([])
    // A pass sent from the Imagery page ("Show on the map").
    const [mapScene, setMapScene] = useState(() => window.__plxMapScene || null)
    const [mapSceneUi, setMapSceneUi] = useState(MAP_SCENE_UI)
    const [mapSceneRect, setMapSceneRect] = useState(null)      // the image on screen, for the swipe handle
    // A swipe starts in the middle of the IMAGE, wherever that is on screen.
    useEffect(() => {
        const r = mapSceneRect
        if (!r || !r.width) return
        const x = mapSceneUi.split * r.width
        if (x < r.left || x > r.right) setMapSceneUi((u) => ({ ...u, split: ((r.left + r.right) / 2) / r.width }))
    }, [mapSceneRect]) // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        const h = (e) => { setMapScene(e.detail || null); setMapSceneUi(MAP_SCENE_UI) }
        window.addEventListener("akili:map-show-scene", h)
        return () => window.removeEventListener("akili:map-show-scene", h)
    }, [])
    const mapSceneLayer = useMemo(() => mapSceneOverlay(mapScene, mapSceneUi), [mapScene, mapSceneUi])
    // Drawing for the Imagery page: a new area (the panel's own "Watch this
    // area" takes it from there) or a new boundary for an existing one,
    // saved as soon as the shape is closed.
    const redrawTarget = useRef(null)          // {systemId, name} while redrawing
    useEffect(() => {
        const h = (e) => {
            redrawTarget.current = e.detail?.systemId ? { systemId: e.detail.systemId, name: e.detail.name } : null
            setImageryPanelOpen(true)
            setImageryDrawMode(e.detail?.mode || "rectangle")
            setImageryDrawn(null)
            setImageryDrawActive(true)
            toast(redrawTarget.current
                ? `Draw the new boundary of ${redrawTarget.current.name} — two clicks for a box, Esc to cancel`
                : "Draw the area to watch — two clicks for a box, Esc to cancel")
        }
        window.addEventListener("akili:imagery-draw", h)
        return () => window.removeEventListener("akili:imagery-draw", h)
    }, [])
    const saveRedraw = useCallback(async (polygon) => {
        const t = redrawTarget.current
        redrawTarget.current = null
        try {
            const r = await fetch(`${API_BASE}/api/watch-zones/${t.systemId}`, {
                method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ polygon_geojson: polygon }),
            })
            if (!r.ok) throw new Error(`HTTP ${r.status}`)
            await fetch(`${API_BASE}/api/watch-zones/${t.systemId}/scan-now`, { method: "POST", credentials: "include" }).catch(() => {})
            toast(`${t.name}: new boundary saved — a pass over it is being fetched`, { icon: "i-check" })
            setImageryPanelOpen(false); setImageryDrawn(null)
            window.__plxImageryTarget = { systemId: t.systemId }
            window.dispatchEvent(new CustomEvent("akili:navigate", { detail: { destination: "imagery" } }))
        } catch (e) { toast(`Could not save the boundary — ${e.message}`, { icon: "i-alert" }) }
    }, [])
    const handleImageryBounds = useCallback((bounds) => {
        setImageryDrawActive(false)
        if (redrawTarget.current) {
            const { north: n, south: so, east: e, west: w } = bounds
            saveRedraw({ type: "Polygon", coordinates: [[[w, so], [e, so], [e, n], [w, n], [w, so]]] })
            return
        }
        setImageryDrawn({ bounds, polygonVertices: null })
    }, [saveRedraw])
    const handleImageryPolygon = useCallback(({ vertices, bounds }) => {
        setImageryDrawActive(false)
        if (redrawTarget.current) {
            const ring = vertices.map(([lat, lon]) => [lon, lat])
            saveRedraw({ type: "Polygon", coordinates: [[...ring, ring[0]]] })
            return
        }
        setImageryDrawn({ bounds, polygonVertices: vertices })
    }, [saveRedraw])
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
        // Global, so the count matches what the map draws.
        const load = () => fetch(`${API}/adsb`).then((r) => (r.ok ? r.json() : null)).then((d) => {
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
    // BOTH PANES START CLOSED (v4.3 §2). The map is the product; two
    // panes open on load leave a strip of it visible and make the first
    // action a reader takes "close things". They reopen from their edge
    // tabs and the state is theirs from then on.
    // Persisted per user, not per mount. These were useState(true), so
    // every remount re-minimised both panes and an analyst who works with
    // Layers open had to reopen it every single time.
    //
    // Stored as "is the panel open", the way a person would describe it;
    // the local names stay inverted because the layout below is written in
    // terms of minimised.
    const [leftOpen, , setLeftOpen] = useChrome("leftPanel")
    const [rightOpen, , setRightOpen] = useChrome("rightPanel")
    const leftMin = !leftOpen
    const rightMin = !rightOpen
    const setLeftMin = (v) => setLeftOpen(!v)
    const setRightMin = (v) => setRightOpen(!v)

    /* CLICKING A SIGNAL HAS TO SHOW THE SIGNAL. Selecting a marker set
       `inspectorPopup`, but nothing opened the pane that renders it — so
       with the Inspector collapsed (its persisted default for anyone who
       had ever closed it) a click on the map did nothing at all. The
       selection was real and invisible, which is the worst of both: the
       marker highlighted and no reason for it appeared anywhere.

       Opening on selection, rather than asking people to find the pane
       first, is also what A4 describes: `openObj(id)` opens the object
       view as part of selecting. */
    useEffect(() => {
        if (inspectorPopup) setRightOpen(true)
    }, [inspectorPopup, setRightOpen])
    useEffect(() => {
        const t = setTimeout(() => setEntered(true), 20)
        return () => clearTimeout(t)
    }, [])

    useEffect(() => {
        let cancelled = false
        const loadSurface = () => fetch(`${API}/api/surface`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (!cancelled && d) { setSurfaceItems(d.items || []); setSurfaceUpdatedAt(d.updated_at || null) } }).catch(() => {})
        const loadFusions = () => fetch(`${API}/api/fusions?status=active&limit=200`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (!cancelled && Array.isArray(d)) setFusionEvents(d) }).catch(() => {})
        const loadHealth = () => fetch(`${API}/api/health/detailed`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (!cancelled) setHealth(d) }).catch(() => {})
        const loadAll = () => { loadSurface(); loadFusions(); loadHealth() }
        loadAll()
        const t = setInterval(loadAll, REFRESH_MS)
        return () => { cancelled = true; clearInterval(t) }
    }, [])

    const maxRank = SEVERITY_FLOORS.find((f) => f.key === severityFloor)?.maxRank ?? 3
    const windowHours = TIME_WINDOWS.find((w) => w.key === timeWindow)?.hours ?? 24
    // A CLOCK THAT TICKS, NOT ONE READ EVERY RENDER. This was
    // `Date.now()` evaluated inline, and it is a dependency of the
    // row-filtering and density memos below — so it changed on every
    // single render and those memos never hit once. Every hover, every
    // toggle, every keystroke in a filter box recomputed the whole
    // window over 50,000 surface items. Ticking it on an interval makes
    // the memos actually memoise, and 30-second granularity is far finer
    // than anything that reads it needs: the coarsest consumer is an
    // "N minutes ago" label.
    const [nowMs, setNowMs] = useState(() => Date.now())
    useEffect(() => {
        const iv = setInterval(() => setNowMs(Date.now()), 30000)
        return () => clearInterval(iv)
    }, [])

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

    // DENSITY OVER THE WINDOW, AT A RESOLUTION THAT SHOWS SHAPE.
    //
    // This was 12 buckets whatever the window, so at 72h each bar was
    // six hours wide — wide enough that a burst and a steady trickle
    // drew the same block, which is precisely the complaint that it
    // showed "huge blocks" and said nothing. 48 buckets puts a 72h
    // window at 90 minutes a bar, which is where a surge starts to be
    // visible as a shape rather than as one taller rectangle.
    //
    // Each bucket now carries what it is made of, because "14 signals"
    // is not a fact anybody can use: the hours it covers, how many were
    // critical or high, and where most of them were.
    const DENSITY_BUCKETS = 48
    const densityBuckets = useMemo(() => {
        const buckets = DENSITY_BUCKETS
        const bucketMs = (windowHours * 3600000) / buckets
        const start = nowMs - windowHours * 3600000
        const cells = Array.from({ length: buckets }, (_, i) => ({
            count: 0, critical: 0, hot: false,
            from: start + i * bucketMs, to: start + (i + 1) * bucketMs,
            regions: new Map(),
        }))
        for (const r of visibleRows) {
            if (!r.publishedAt) continue
            const age = nowMs - new Date(r.publishedAt).getTime()
            const idx = buckets - 1 - Math.min(buckets - 1, Math.floor(age / bucketMs))
            if (idx < 0 || idx >= buckets) continue
            const c = cells[idx]
            c.count += 1
            if (r.severityRank <= 1) { c.hot = true; c.critical += 1 }
            const key = r.aoi || "Unknown"
            c.regions.set(key, (c.regions.get(key) || 0) + 1)
        }
        for (const c of cells) {
            let top = null, topN = 0
            for (const [k, n] of c.regions) if (n > topN) { top = k; topN = n }
            c.topRegion = top
            c.topRegionCount = topN
            delete c.regions
        }
        return {
            cells,
            counts: cells.map((c) => c.count),
            hot: cells.map((c) => c.hot),
            max: Math.max(1, ...cells.map((c) => c.count)),
            bucketMinutes: Math.round(bucketMs / 60000),
            windowHours,
        }
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

    /* THE OVERVIEW'S CHARTS. Signals over the window, stacked by severity,
       and the regions as bars — both clickable: a column lists its signals
       below the chart, a region flies the map there and lists its own. */
    const SEV_PARTS = [
        { key: "3", label: "Low", color: "var(--sev-low)" },
        { key: "2", label: "Moderate", color: "var(--sev-moderate)" },
        { key: "1", label: "High", color: "var(--sev-high)" },
        { key: "0", label: "Critical", color: "var(--sev-critical)" },
    ]
    const timeColumns = useMemo(() => {
        // Boundaries fixed to the clock (multiples of the step), so the
        // 30-second tick does not move a signal into the next column
        // between hovering one and clicking it.
        const n = 24, span = windowHours * 3600000, step = span / n
        const start = (Math.floor(nowMs / step) + 1) * step - span
        const fmt = (t) => {
            const d = new Date(t)
            return windowHours <= 72 ? `${d.toISOString().slice(11, 16)}Z ${d.getUTCDate()}/${d.getUTCMonth() + 1}`
                                     : `${d.getUTCDate()}/${d.getUTCMonth() + 1}`
        }
        const cols = Array.from({ length: n }, (_, i) => ({ key: String(i), from: start + i * step, to: start + (i + 1) * step, label: fmt(start + i * step), value: 0, counts: { 0: 0, 1: 0, 2: 0, 3: 0 }, rows: [] }))
        for (const r of visibleRows) {
            const t = r.publishedAt ? Date.parse(r.publishedAt) : NaN
            if (!Number.isFinite(t) || t < start) continue
            const c = cols[Math.min(n - 1, Math.floor((t - start) / step))]
            c.value += 1; c.counts[r.severityRank in c.counts ? r.severityRank : 2] += 1; c.rows.push(r)
        }
        return cols.map((c) => ({ ...c, parts: Object.entries(c.counts).map(([key, value]) => ({ key, value })) }))
    }, [visibleRows, windowHours, nowMs])
    const [overviewPick, setOverviewPick] = useState(null)   // {kind: "time"|"region", key}
    const pickedRows = useMemo(() => {
        if (!overviewPick) return null
        if (overviewPick.kind === "time") return timeColumns.find((c) => c.key === overviewPick.key)?.rows || []
        return visibleRows.filter((r) => (r.aoi || "Unknown") === overviewPick.key)
    }, [overviewPick, timeColumns, visibleRows])
    // A Telegram post opens its own panel: headline, then the video or
    // photo, then the translation; anything else selects the row.
    const openOverviewRow = (r) => {
        if (r.raw?.source_type === "telegram") {
            const d = r.raw
            window.dispatchEvent(new CustomEvent("akili:open-inspector", { detail: {
                entityType: "telegram", entityId: d.id,
                data: { ...d, thumb_url: d.thumb_url && !d.thumb_url.startsWith("http") ? `${API_BASE}${d.thumb_url}` : d.thumb_url },
            } }))
            return
        }
        setInspectorPopup(null); setSelected(r)
    }
    const flyToRegion = (name) => {
        const pts = visibleRows.filter((r) => (r.aoi || "Unknown") === name && Number.isFinite(+r.lat) && Number.isFinite(+r.lon))
        if (!pts.length) return
        const lat = pts.reduce((a, r) => a + +r.lat, 0) / pts.length, lon = pts.reduce((a, r) => a + +r.lon, 0) / pts.length
        window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat, lon, altitude: 900_000 } }))
    }

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
    /* v6 A4 — THE PANES FLOAT, they are not welded to the window edge.
       A pane flush to all three edges reads as a column of the layout; the
       same pane inset 10/12px with a border on all four sides and a shadow
       under it reads as a sheet of glass lying ON the map. That difference
       is the entire reason the map stays legible underneath. */
    /* ▣ Canvas — SCENERY DOES NOT FETCH.
       While this screen is the app's background it must draw the basemap
       and nothing else. Leaving the data layers on cost far more than GPU:
       every camera move re-issued /api/airports/in-viewport,
       /api/ports/in-viewport and friends, and with the globe now rendering
       behind every other mode those requests never stopped. Chrome allows
       six connections per origin and /api/stream permanently holds one, so
       the queue stayed full and any screen that mounted later — Home,
       Insight — had its own fetches starved behind them. Measured: 19
       requests in flight, /api/surface unresolved after 16s, while the
       same endpoint answered curl in 4ms.

       So off-mode every toggle reads false. The user's real settings are
       untouched in state and come straight back when Map is opened. */
    /* ▣ Theater tabs — SELECTING ONE CHANGES THE SUBJECT.
       app.jsx owns the tab strip but this screen owns the layer state and
       the camera, so the tab dispatches and we apply. Everything the
       theater does not name is switched off: a theater is a statement
       about what matters here, and leaving the previous one's layers on
       turns it into an accumulation instead. */
    useEffect(() => {
        const onTheater = (e) => {
            const d = e.detail || {}
            const L = d.layers || {}
            const set = (list) => Object.fromEntries((list || []).map((k) => [k, true]))
            // ALERTS ARE NOT A THEATER'S TO SWITCH OFF. Alerts and fusions
            // are what the system found, not scenery; no seeded theater named
            // the group, so selecting any theater hid every alert and fusion
            // on the map. They keep whatever state the user gave them.
            if (L.groups) setGroupsOn((prev) =>
                Object.fromEntries(Object.keys(prev).map((k) => [k, k === "alerts" ? prev[k] : L.groups.includes(k)])))
            if (L.infra) setInfraOn((prev) =>
                Object.fromEntries(Object.keys(prev).map((k) => [k, L.infra.includes(k)])))
            if (L.tracks) setTracksOn((prev) =>
                Object.fromEntries(Object.keys(prev).map((k) => [k, L.tracks.includes(k)])))
            if (L.context) setContextOn((prev) =>
                Object.fromEntries(Object.keys(prev).map((k) => [k, L.context.includes(k)])))
            // A theater saved before sub-layers existed has no list and
            // leaves them as they are.
            if (Array.isArray(L.subs)) applySubs(L.subs)
            applyLayerExtrasRef.current(L)
            void set
            if (d.view && Number.isFinite(d.view.lat) && Number.isFinite(d.view.lon)) {
                window.dispatchEvent(new CustomEvent("akili:set-camera", {
                    detail: {
                        lat: d.view.lat, lon: d.view.lon,
                        height: d.view.height || 2_000_000,
                        heading: 0, pitch: -Math.PI / 2, roll: 0,
                    },
                }))
            }
        }
        window.addEventListener("akili:theater-select", onTheater)
        return () => window.removeEventListener("akili:theater-select", onTheater)
    }, [])

    /* The event-density strip is opt-in, driven by the rail's Timeline
       button through the shared chrome store. It used to be unconditional
       while that button toggled a flag nothing read. */
    /* ── Voice: what is selected, and what a spoken filter does ──────
       The parser needs to know what "this" means, and the only thing that
       knows is this screen. Filters are applied here too rather than in the
       dispatcher, because the toggles are this component's state — and the
       previous set is kept so Undo can put it back exactly. */
    useEffect(() => { setVoiceSelection(inspectorPopup || null) }, [inspectorPopup])

    const voicePrev = useRef(null)
    useEffect(() => {
        const GROUP_FOR = { maritime: "maritime", air: "air", news: "news", imagery: "imagery", zones: "zones" }
        const onFilter = (e) => {
            const { typeIds = [], sinceHours } = e.detail || {}
            voicePrev.current = { groups: groupsOn, window: timeWindow }
            if (typeIds.length) {
                const want = new Set(typeIds.map((t) => GROUP_FOR[t]).filter(Boolean))
                if (want.size) setGroupsOn((prev) =>
                    Object.fromEntries(Object.keys(prev).map((k) => [k, want.has(k)])))
            }
            if (Number.isFinite(sinceHours)) {
                /* The window is one of four fixed steps, not a free number,
                   so "last 48 hours" lands on the nearest one the map can
                   actually show rather than being quietly ignored. */
                const best = TIME_WINDOWS.reduce((a, b) =>
                    Math.abs(b.hours - sinceHours) < Math.abs(a.hours - sinceHours) ? b : a)
                setTimeWindow(best.key)
            }
        }
        const onRestore = () => {
            const p = voicePrev.current
            if (!p) return
            setGroupsOn(p.groups)
            setTimeWindow(p.window)
            voicePrev.current = null
        }
        window.addEventListener("akili:voice-filter", onFilter)
        window.addEventListener("akili:voice-filter-restore", onRestore)
        return () => {
            window.removeEventListener("akili:voice-filter", onFilter)
            window.removeEventListener("akili:voice-filter-restore", onRestore)
        }
    }, [groupsOn, timeWindow])

    /* EVERYTHING THE LAYERS PANEL CAN SWITCH, in a theater's shape: lists of
       what is on, the two chip choices, and the track filters with their
       sets as lists (null = no filter on that axis). A theater and the
       saved default view both carry it, so nothing the panel offers falls
       back to a built-in value when one of them is applied. Published on
       window for the theater editor's "take it from the map", the same
       way the camera is (window.__akiliCamera). */
    const onKeys = (o) => Object.keys(o || {}).filter((k) => o[k])
    const setToList = (x) => (x instanceof Set ? [...x] : null)
    const listToSet = (a) => (Array.isArray(a) ? new Set(a.map(String)) : null)
    const layerSnapshot = useRef(null)
    layerSnapshot.current = () => ({
        groups: onKeys(groupsOn), context: onKeys(contextOn), infra: onKeys(infraOn), tracks: onKeys(tracksOn),
        subs: onKeys(currentSubs()), gdeltTypes: [...gdeltTypes], theatres: onKeys(theatresOn),
        severityFloor, timeWindow,
        vessel: { types: setToList(vesselFilter.types), flags: setToList(vesselFilter.flags) },
        aircraft: { kinds: setToList(aircraftFilter.kinds), airlines: setToList(aircraftFilter.airlines), countries: setToList(aircraftFilter.countries) },
    })
    useEffect(() => {
        window.__akiliLayers = () => layerSnapshot.current?.()
        return () => { if (window.__akiliLayers) delete window.__akiliLayers }
    }, [])
    // The parts beyond the on/off groups. Each applies only when named, so
    // a theater or default saved before it existed leaves it alone.
    const applyLayerExtras = (L) => {
        if (Array.isArray(L.gdeltTypes)) setGdeltTypes(L.gdeltTypes.filter((k) => GDELT_EVENT_TYPES.some((t) => t.key === k)))
        if (Array.isArray(L.theatres)) setTheatresOn(Object.fromEntries(L.theatres.map((k) => [k, true])))
        if (SEVERITY_FLOORS.some((f) => f.key === L.severityFloor)) setSeverityFloor(L.severityFloor)
        if (TIME_WINDOWS.some((w) => w.key === L.timeWindow)) setTimeWindow(L.timeWindow)
        if (L.vessel && typeof L.vessel === "object") setVesselFilter((p) => ({
            ...p, types: listToSet(L.vessel.types), flags: listToSet(L.vessel.flags) }))
        if (L.aircraft && typeof L.aircraft === "object") setAircraftFilter((p) => ({
            ...p, kinds: listToSet(L.aircraft.kinds), airlines: listToSet(L.aircraft.airlines), countries: listToSet(L.aircraft.countries) }))
    }
    const applyLayerExtrasRef = useRef(applyLayerExtras)
    applyLayerExtrasRef.current = applyLayerExtras

    /* SPOKEN LAYER SWITCHES ("turn on the heat layer", "hide GDELT").
       The names are the backend's LAYERS list (routers/voice_ai.py); a
       child layer brings its group on with it, or switching it on would
       show nothing. on: null flips. The previous value is kept per layer
       for Undo. */
    const voiceLayerPrev = useRef({})
    const voiceLayers = useRef(null)
    voiceLayers.current = {
        vessels: [tracksOn.vessels, (v) => setTracksOn((p) => ({ ...p, vessels: v }))],
        aircraft: [tracksOn.aircraft, (v) => setTracksOn((p) => ({ ...p, aircraft: v }))],
        sanctioned_only: [tracksOn.sanctionedOnly, (v) => setTracksOn((p) => ({ ...p, sanctionedOnly: v, vessels: v || p.vessels }))],
        heat: [firesOn, setFiresOn, "imagery"],
        imagery_signals: [imagerySignalsOn, setImagerySignalsOn, "imagery"],
        satellite_image: [satImageOn, setSatImageOn, "imagery"],
        gdelt: [gdeltOn, setGdeltOn, "news"],
        telegram: [telegramOn, setTelegramOn, "news"],
        unrest: [unrestOn, setUnrestOn, "news"],
        geoconfirmed: [geoConfirmedOn, setGeoConfirmedOn, "news"],
        gps_interference: [gpsInterferenceOn, setGpsInterferenceOn, "air"],
        airspace: [airspaceOn, setAirspaceOn],
        assets: [assetsOn, setAssetsOn],
        alerts: [groupsOn.alerts, (v) => setGroupsOn((p) => ({ ...p, alerts: v }))],
        zones: [groupsOn.zones, (v) => setGroupsOn((p) => ({ ...p, zones: v }))],
        ...Object.fromEntries(["risk", "frontlines", "flows", "aois", "labels"].map((k) =>
            [k, [contextOn[k], (v) => setContextOn((p) => ({ ...p, [k]: v }))]])),
        ...Object.fromEntries([["cables", "cables"], ["ports", "ports"], ["airfields", "airfields"], ["chokepoints", "chokepoints"],
            ["power", "power"], ["military_sites", "facMilitary"]].map(([k, key]) =>
            [k, [infraOn[key], (v) => setInfraOn((p) => ({ ...p, [key]: v }))]])),
    }
    useEffect(() => {
        const onLayer = (e) => {
            const { layer, on } = e.detail || {}
            const entry = voiceLayers.current[layer]
            if (!entry) return
            const [cur, set, parent] = entry
            const next = on == null ? !cur : !!on
            voiceLayerPrev.current[layer] = { value: !!cur, parent: parent ? !!groupsOn[parent] : null }
            set(next)
            if (next && parent) setGroupsOn((p) => ({ ...p, [parent]: true }))
            if (e.detail.report) e.detail.report(next)
        }
        const onUndo = (e) => {
            const { layer } = e.detail || {}
            const prev = voiceLayerPrev.current[layer]
            const entry = voiceLayers.current[layer]
            if (!prev || !entry) return
            entry[1](prev.value)
            if (entry[2] && prev.parent === false) setGroupsOn((p) => ({ ...p, [entry[2]]: false }))
            delete voiceLayerPrev.current[layer]
        }
        window.addEventListener("akili:voice-layer", onLayer)
        window.addEventListener("akili:voice-layer-undo", onUndo)
        return () => {
            window.removeEventListener("akili:voice-layer", onLayer)
            window.removeEventListener("akili:voice-layer-undo", onUndo)
        }
    }, [groupsOn])

    const [timelineOn] = useChrome("timeline")

    const off = (o) => (asCanvas ? {} : o)
    const groupsOnV   = off(groupsOn)
    const infraOnV    = off(infraOn)
    const tracksOnV   = off(tracksOn)
    const contextOnV  = off(contextOn)
    const theatresOnV = off(theatresOn)
    const gfwOnV      = off(gfwOn)

    const leftPaneStyle = {
        position: "absolute", left: 10, top: 10,
        bottom: "var(--pane-bottom)", zIndex: 25,
        width: "var(--pane-l)", border: "1px solid var(--gline)",
        display: "flex", flexDirection: "column", minHeight: 0, overflowY: "auto",
        // SLIDES, NEVER POPS (owner). Kept mounted; closed means off the
        // left edge, not gone — so opening and closing are one motion.
        transform: leftMin ? "translateX(calc(-100% - 24px))" : (entered ? "translateX(0)" : "translateX(-14px)"),
        opacity: leftMin ? 0 : (entered ? 1 : 0),
        transition: "transform 260ms cubic-bezier(.2,.8,.2,1), opacity 200ms ease",
        pointerEvents: leftMin ? "none" : undefined,
    }
    const rightPaneStyle = {
        // Real shared token (index.html :root — "the map fit AND every map
        // overlay inset derive from these two tokens, so they can never
        // drift apart"), not a hardcoded literal that happens to match it —
        // this is also now the Inspector's real width when a map marker is
        // clicked (see the pane content below), so one token now drives
        // Layers, this pane's default view, AND the marker-click Inspector.
        position: "absolute", right: 12, top: 10,
        bottom: "var(--pane-bottom)", zIndex: 25,
        width: "var(--pane-r)", border: "1px solid var(--gline)",
        display: "flex", flexDirection: "column", minHeight: 0, overflowY: "auto",
        transform: rightMin ? "translateX(calc(100% + 24px))" : (entered ? "translateX(0)" : "translateX(14px)"),
        opacity: rightMin ? 0 : (entered ? 1 : 0),
        transition: "transform 260ms cubic-bezier(.2,.8,.2,1), opacity 200ms ease",
        pointerEvents: rightMin ? "none" : undefined,
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
    const activeRightOverlayWidth = imageryPanelOpen ? IMAGERY_PANE_W : inspectorOverlayWidth

    /* ROOM FOR A SOURCE. SourceViewer announces itself (akili:source-viewer).
       Beside the inspector it takes ~470px of map, so the map chrome moves
       clear of it; and when what is left would be under ~480px, the Layers
       pane closes for as long as the source is open and comes back after —
       panes give way rather than stack over the map. */
    const [sourceDock, setSourceDock] = useState({ open: false, docked: false, width: 0 })
    useEffect(() => {
        const on = (e) => setSourceDock(e.detail || { open: false })
        window.addEventListener("akili:source-viewer", on)
        return () => window.removeEventListener("akili:source-viewer", on)
    }, [])
    const sourceW = sourceDock.open && sourceDock.docked ? sourceDock.width + 10 : 0
    const closedLeftForSource = useRef(false)
    useEffect(() => {
        if (sourceDock.open && sourceDock.docked && !leftMin) {
            const free = window.innerWidth - 48 - 270 - (activeRightOverlayWidth + 12) - sourceW
            if (free < 480) { closedLeftForSource.current = true; setLeftMin(true) }
        } else if (!sourceDock.open && closedLeftForSource.current) {
            closedLeftForSource.current = false
            setLeftMin(false)
        }
    }, [sourceDock.open, sourceDock.docked]) // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div data-testid="view-root-situation" style={{ display: "flex", position: "relative", height: "100%", minHeight: 0, background: "var(--bg-0)" }}>
            {/* Left — Layers (real frosted glass per build spec v2 §4.6 —
                corrects an earlier round's "no translucency anywhere"
                reversal of this; only the panel's own background is glass,
                everything inside — .chip/.card/.seg etc — stays flat/opaque) */}
            {/* THE ROTATED EDGE TAB IS GONE. A minimised pane used to leave
                the word "Layers" turned on its side against the window
                edge — a control with no home, discoverable only by
                noticing it. These panes are reached from the rail's tools
                group now, which is where every other way into a surface
                already lives. */}
            {asCanvas ? null : (
            <div className="pane-glass" data-testid="glass-layers-pane" data-open={!leftMin} aria-hidden={leftMin || undefined} style={leftPaneStyle}>
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
                        {/* Saves what is on right now as the launch state,
                            per user. The alternative — a separate settings
                            screen listing every layer again — asks the
                            reader to rebuild a view they are already
                            looking at. */}
                        <span role="button" tabIndex={0}
                              title="Open the app with exactly these layers next time"
                              onClick={() => {
                                  saveStartupLayers({ groups: groupsOn, context: contextOn, infra: infraOn, tracks: tracksOn, subs: currentSubs(), gdeltTypes,
                                      theatres: onKeys(theatresOn), vessel: layerSnapshot.current().vessel, aircraft: layerSnapshot.current().aircraft })
                                      .then((r) => (r?.ok !== false
                                          ? toast("Saved as your default view", { icon: "i-check" })
                                          : r?.queued
                                              ? toast("Saved on this device — sent to the server as soon as it is back", { icon: "i-check" })
                                              : toast(`Could not save default view (${r?.error || "error"})`, { icon: "i-alert" })))
                                      .catch(() => toast("Could not save default view", { icon: "i-alert" }))
                              }}
                              style={{ font: "400 11px var(--font)", color: "var(--acc-hi)", cursor: "pointer" }}>save default</span>
                        {getStartupLayers() && (
                            <span role="button" tabIndex={0}
                                  title="Go back to the built-in default layers"
                                  onClick={() => {
                                      clearStartupLayers()
                                          .then(() => toast("Default view cleared", { icon: "i-check" }))
                                          .catch(() => toast("Could not clear default view", { icon: "i-alert" }))
                                  }}
                                  style={{ font: "400 11px var(--font)", color: "var(--txt-3)", cursor: "pointer" }}>reset</span>
                        )}
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

                <LayerGroup id="our-assets" title="Our assets" activeCount={assetsOn ? 1 : 0}>
                    <SubLayerRow
                        label="Assets in the register"
                        hint="Your vessels, aircraft, sites and people, each ringed in how exposed it is now, with its watch radius close in. A click opens it."
                        on={assetsOn} parentOn={true}
                        onToggle={() => setAssetsOn((v) => !v)} />
                </LayerGroup>

                <LayerGroup id="event-domains" title="Event domains"
                            activeCount={LAYER_GROUPS.filter((g) => groupsOn[g.key]).length}>
                    {LAYER_GROUPS.map((g) => (
                        <Fragment key={g.key}>
                            <DomainRow group={g} count={domainCounts[g.key]} on={groupsOn[g.key]} onToggle={() => setGroupsOn((p) => ({ ...p, [g.key]: !p[g.key] }))} />
                            {g.key === "imagery" && (<>
                                <SubLayerRow
                                    label="Imagery signals"
                                    hint="Passes over your watched areas that counted: a new smoke plume, tankers massing, a vessel leaving a naval base, a structure gone. Opening one shows the image."
                                    on={imagerySignalsOn} parentOn={groupsOn.imagery}
                                    onToggle={() => setImagerySignalsOn((v) => !v)} />
                                <SubLayerRow
                                    label="Heat (thermal anomalies)"
                                    hint="NASA FIRMS fire detections. A gas flare, burning stubble and a strike look identical to the instrument."
                                    on={firesOn} parentOn={groupsOn.imagery}
                                    onToggle={() => setFiresOn((v) => !v)} />
                                <SubLayerRow
                                    label="Satellite base image"
                                    hint="The latest Sentinel-2 picture under everything else. Heavy, and hides the map's own detail — off unless you want it."
                                    on={satImageOn} parentOn={groupsOn.imagery}
                                    onToggle={() => setSatImageOn((v) => !v)} />
                            </>)}
                            {g.key === "air" && (
                                <SubLayerRow
                                    label="Nav Interference"
                                    hint="Where aircraft are losing their satellite fix, from the navigation integrity they report themselves. Jamming and spoofing are not separated."
                                    on={gpsInterferenceOn} parentOn={groupsOn.air}
                                    onToggle={() => setGpsInterferenceOn((v) => !v)} />
                            )}
                            {g.key === "news" && (
                                <SubLayerRow
                                    label="Confirmed"
                                    hint="Human-verified geolocation — somebody found the building in the video."
                                    on={geoConfirmedOn} parentOn={groupsOn.news}
                                    onToggle={() => setGeoConfirmedOn((v) => !v)} />
                            )}
                            {g.key === "news" && (
                                <SubLayerRow
                                    label="Unconfirmed"
                                    hint="Machine-coded from a news wire · city-level only · every pin cites its article"
                                    on={gdeltOn} parentOn={groupsOn.news}
                                    onToggle={() => setGdeltOn((v) => !v)} />
                            )}
                            {g.key === "news" && (
                                <SubLayerRow
                                    label="Telegram"
                                    hint="Channels you joined · AI-screened for relevance · pinned only where the post names a precise place · unverified"
                                    on={telegramOn} parentOn={groupsOn.news}
                                    onToggle={() => setTelegramOn((v) => !v)} />
                            )}
                            {g.key === "news" && (
                                <SubLayerRow
                                    label="Unrest & protests"
                                    hint="Riots, protests and clashes with police filmed and posted on Telegram, and the gatherings announced for the coming days (hollow pins) · unverified"
                                    on={unrestOn} parentOn={groupsOn.news}
                                    onToggle={() => setUnrestOn((v) => !v)} />
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
                </LayerGroup>

                {/* Context layers — build spec v2 §4.2. "Satellite tasking
                    (none)" is deliberately unavailable — a real, honest
                    unavailable capability, not a silently-broken toggle. */}
                <LayerGroup id="context" title="Context layers"
                            activeCount={Object.values(contextOn).filter(Boolean).length
                                         + (airspaceOn ? 1 : 0)
                                         + (gfwHeatOn ? 1 : 0)
                                         + Object.values(gfwOn).filter(Boolean).length}>
                    {[
                        ["risk", "Country risk index"],
                        ["graticule", "Graticule 10°"],
                        ["flows", "Trade & energy flows"],
                        ["aois", "Areas of interest"],
                        ["labels", "Marker labels"],
                    ].map(([key, label]) => (
                        <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 12px" }}>
                            <span style={{ flex: 1, font: "400 12px var(--font)", color: "var(--txt-2)" }}>
                                {label}
                                {/* A layer called "trade AND energy" that
                                    silently shows only trade is worse than
                                    one that says which half is missing: the
                                    pipeline source has been 404ing since
                                    March and nothing said so. */}
                                {key === "flows" && contextOn.flows && flowsStatus ? (
                                    <span style={{ display: "block", font: "400 10px var(--font)",
                                                   color: "var(--txt-4)" }}>
                                        <LayerStatus status={flowsStatus} />
                                        {/* What the lines are. */}
                                        <span style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 3 }}>
                                            <span><i style={{ display: "inline-block", width: 14, borderTop: "2px dashed #8E9BAA", verticalAlign: "middle", marginRight: 4 }} />shipping route</span>
                                            <span><i style={{ display: "inline-block", width: 14, borderTop: "2px solid #2BB3A3", verticalAlign: "middle", marginRight: 4 }} />gas pipeline</span>
                                            <span><i style={{ display: "inline-block", width: 14, borderTop: "2px solid #9B6B3D", verticalAlign: "middle", marginRight: 4 }} />oil pipeline</span>
                                        </span>
                                    </span>
                                ) : null}
                            </span>
                            <button
                                onClick={() => setContextOn((p) => ({ ...p, [key]: !p[key] }))}
                                title={contextOn[key] ? "Hide layer" : "Show layer"}
                                style={{ width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", cursor: "pointer", color: contextOn[key] ? "var(--txt-2)" : "var(--txt-4)" }}
                            >
                                <svg className="icon sm"><use href={contextOn[key] ? "#i-eye" : "#i-eye-off"} /></svg>
                            </button>
                        </div>
                    ))}
                    {/* The corridors' own numbers, where the switch that
                        draws them is. A panel three clicks away from the
                        layer it describes is a panel nobody opens. */}
                    {contextOn.flows && (
                        <LayerSubGroup id="flows-detail" title="Corridor traffic" defaultOpen>
                            <FlowsPanel />
                        </LayerSubGroup>
                    )}

                    <LayerSubGroup id="airspace" title="Airspace"
                                   activeCount={airspaceOn ? 1 : 0}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 12px" }}>
                        <span style={{ flex: 1, font: "400 12px var(--font)", color: "var(--txt-2)" }}>
                            Controlled airspace
                            <span style={{ display: "block", font: "400 10px var(--font)",
                                           color: "var(--txt-4)" }}>
                                {airspaceOn ? (
                                    <>
                                        floor to ceiling&nbsp;·{" "}
                                        <LayerStatus status={airspaceStatus} fallback="zoom in to draw" />
                                    </>
                                ) : "floor to ceiling"}
                            </span>
                        </span>
                        <button
                            onClick={() => setAirspaceOn((v) => !v)}
                            title={airspaceOn ? "Hide layer" : "Show layer"}
                            style={{ width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", cursor: "pointer", color: airspaceOn ? "var(--txt-2)" : "var(--txt-4)" }}
                        >
                            <svg className="icon sm"><use href={airspaceOn ? "#i-eye" : "#i-eye-off"} /></svg>
                        </button>
                    </div>
                    </LayerSubGroup>

                    <LayerSubGroup id="gfw-events" title="Vessel activity events"
                                   note="published days behind"
                                   activeCount={Object.values(gfwOn).filter(Boolean).length}>
                    {[
                        ["encounters", "Encounters", "two vessels meeting at sea"],
                        ["gaps", "AIS gaps", "transmission stopped, then resumed"],
                        ["loitering", "Loitering", "holding station away from port"],
                        ["port-visits", "Port visits", "arrivals and departures"],
                    ].map(([key, label, why]) => (
                        <div key={key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 12px" }}>
                            <span style={{ flex: 1, font: "400 12px var(--font)", color: "var(--txt-2)" }}>
                                {label}
                                <span style={{ display: "block", font: "400 10px var(--font)", color: "var(--txt-4)" }}>{why}</span>
                            </span>
                            <button
                                onClick={() => setGfwOn((p) => ({ ...p, [key]: !p[key] }))}
                                title={gfwOn[key] ? "Hide layer" : "Show layer"}
                                style={{ width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", cursor: "pointer", color: gfwOn[key] ? "var(--txt-2)" : "var(--txt-4)" }}
                            >
                                <svg className="icon sm"><use href={gfwOn[key] ? "#i-eye" : "#i-eye-off"} /></svg>
                            </button>
                        </div>
                    ))}
                    {/* DENSITY, NOT INCIDENTS. The marker layers above answer
                        "what happened here". This answers "where does this
                        happen" — the thing GFW's own map is good at and this
                        one was not: one transhipment is an incident, four
                        hundred in a patch of ocean is a pattern, and that
                        pattern is invisible when every event is an identical
                        hollow circle at the same size as all the others. */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 12px" }}>
                        <span style={{ flex: 1, font: "400 12px var(--font)", color: "var(--txt-2)" }}>
                            Encounter density
                            <span style={{ display: "block", font: "400 10px var(--font)", color: "var(--txt-4)" }}>
                                30 days gridded at 0.5° · worldwide
                            </span>
                        </span>
                        <button
                            onClick={() => setGfwHeatOn((v) => !v)}
                            title={gfwHeatOn ? "Hide layer" : "Show layer"}
                            style={{ width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", cursor: "pointer", color: gfwHeatOn ? "var(--txt-2)" : "var(--txt-4)" }}
                        >
                            <svg className="icon sm"><use href={gfwHeatOn ? "#i-eye" : "#i-eye-off"} /></svg>
                        </button>
                    </div>
                    </LayerSubGroup>

                    {/* Frontlines, per theatre. The unavailable ones are
                        listed rather than hidden: a control layer offering
                        only Ukraine implies the other wars have no front
                        line, and each row carries the actual reason. */}
                    <LayerSubGroup id="frontlines" title="Frontlines"
                                   activeCount={(contextOn.frontlines ? 1 : 0)
                                                + Object.values(theatresOn).filter(Boolean).length}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 12px" }}>
                        <span style={{ flex: 1, font: "400 12px var(--font)", color: "var(--txt-2)" }}>Show frontlines</span>
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
                        {/* Ukraine scrubs published snapshots; every other
                            war scrubs the wiki's own revisions. Same control,
                            two histories. */}
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
                        {t.kind === "points" && contextOn.frontlines && theatresOn[t.key]
                            && (warTimelines[t.key]?.stops?.length || 0) > 1 && (() => {
                            const tl = warTimelines[t.key]
                            const last = tl.stops.length - 1
                            const cur = tl.idx == null ? last : tl.idx
                            const setIdx = (v) => setWarTimelines((prev) => ({
                                ...prev, [t.key]: { ...prev[t.key], idx: v },
                            }))
                            return (
                                <div style={{ padding: "2px 12px 8px 27px" }}>
                                    <input
                                        type="range" min={0} max={last} value={cur}
                                        onChange={(e) => setIdx(Number(e.target.value))}
                                        style={{ width: "100%", accentColor: "var(--acc-hi)" }}
                                        aria-label={`${t.label} frontline date`} />
                                    <div style={{ display: "flex", justifyContent: "space-between",
                                                  font: "400 10px var(--mono)", color: "var(--txt-4)" }}>
                                        <span>{String(tl.stops[0]?.at || "").slice(0, 10)}</span>
                                        <span style={{ color: tl.idx == null ? "var(--txt-3)" : "var(--acc-hi)" }}>
                                            {String(tl.stops[cur]?.at || "").slice(0, 10)}
                                        </span>
                                        <span role="button" tabIndex={0}
                                              onClick={() => setIdx(null)}
                                              style={{ cursor: "pointer",
                                                       color: tl.idx == null ? "var(--txt-4)" : "var(--acc-hi)" }}>
                                            {tl.idx == null ? "now" : "back to now"}
                                        </span>
                                    </div>
                                </div>
                            )
                        })()}
                        </Fragment>
                    ))}
                    </LayerSubGroup>

                    <div
                        role="button" tabIndex={0}
                        onClick={() => toast("Satellite tasking is not a real capability in this build yet", { icon: "icon-eye-off" })}
                        style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 12px", cursor: "pointer", opacity: 0.55 }}
                    >
                        <span style={{ flex: 1, font: "400 12px var(--font)", color: "var(--txt-3)" }}>Satellite tasking (none)</span>
                        <svg className="icon sm" style={{ color: "var(--txt-4)" }}><use href="#i-eye-off" /></svg>
                    </div>
                </LayerGroup>

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
                <LayerGroup id="infrastructure" title="Global infrastructure"
                            note={`${Object.values(infraOn).filter(Boolean).length}/${Object.keys(infraOn).length}`}
                            activeCount={Object.values(infraOn).filter(Boolean).length}>
                    {INFRA_LAYERS.map((l) => (
                        <button key={l.key} type="button" className="layer"
                                aria-pressed={!!infraOn[l.key]}
                                onClick={() => setInfraOn((p) => ({ ...p, [l.key]: !p[l.key] }))}>
                            <i className="sw" style={{ background: l.color }} />
                            <span className="n">{l.label}<em>{l.note}</em></span>
                            <span className="c">
                                {FACILITY_ROW_TYPE[l.key] && infraOn[l.key] && facStatus
                                    ? <LayerStatus status={facStatus} /> : ""}
                            </span>
                            <span className="eye">
                                <svg className="icon sm"><use href={infraOn[l.key] ? "#i-eye" : "#i-eye-off"} /></svg>
                            </span>
                        </button>
                    ))}
                </LayerGroup>

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
                        ["vessels", "Vessels", trackCounts.vessels],
                        ["aircraft", "Aircraft", trackCounts.aircraft],
                        ["sanctionedOnly", "Sanctioned/watchlisted only", trackCounts.sanctioned],
                        // "Ports & airports" moved to Global infrastructure
                        // (§L5) and split in two. They are fixed facilities,
                        // not live tracks, and they were sharing one switch.
                    ].map(([key, label, count]) => (
                        <Fragment key={key}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 12px" }}>
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
                        {key === "vessels" && tracksOn.vessels && (
                            <VesselFilterPanel filter={vesselFilter} onChange={setVesselFilter} facets={trackFacets?.vessels} />
                        )}
                        {key === "aircraft" && tracksOn.aircraft && (
                            <AircraftFilterPanel filter={aircraftFilter} onChange={setAircraftFilter} facets={trackFacets?.aircraft} />
                        )}
                        </Fragment>
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
                {/* THE FILTER BAR IS GONE. It carried a signal count, an
                    "as of" stamp and the live tape — a summary of a window,
                    a restatement of something the status line already said,
                    and a ticker. None of them were things anyone acted on,
                    and together they cost a 28px band across the top of the
                    map and put the side panes underneath themselves.

                    Its map tools survive, portalled into the top bar: they
                    belong in the chrome, not floating over the geography
                    they operate on. */}
                <MapToolsPortal>
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

                    {/* The imagery entry point is now the single `#t-imagery`
                        control in `.annobar` — §10.1 calls out by name that
                        there must be ONE imagery icon, not two. */}
                    {/* A picture of the map as it stands, detections and
                        all, straight into the Saved pane. The globe is a
                        WebGL canvas, so this goes through Capturable's
                        Cesium compositing rather than a DOM rasteriser,
                        which would render it black. */}
                    <button
                        onClick={async () => {
                            const el = document.querySelector('[data-testid="view-root-situation"]')
                            if (!el) return
                            try {
                                const url = await captureElement(el)
                                saveForBriefing({
                                    id: `capture:map:${Date.now()}`, kind: "capture",
                                    headline: "Map view", source: "situation",
                                    when: new Date().toISOString(), imageUrl: url,
                                })
                                toast("Map saved \u2014 it is in the Editor's Saved pane", { icon: "i-check" })
                            } catch (e) {
                                toast(`Could not capture the map: ${e?.message || e}`, { icon: "i-alert" })
                            }
                        }}
                        title="Save a picture of the map for a document"
                        style={{
                            flex: "none", whiteSpace: "nowrap", width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center",
                            background: "none", border: "1px solid var(--line-soft)", borderRadius: 3, cursor: "pointer", color: "var(--txt-3)",
                        }}
                    >
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                            <rect x="1.5" y="4" width="13" height="9.5" rx="1.5" />
                            <circle cx="8" cy="8.75" r="2.6" />
                            <path d="M5.5 4l1-1.6h3L10.5 4" />
                        </svg>
                    </button>
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
                    {/* The World/EMEA/APAC/AMER jumps are gone. Four
                        buttons permanently in the chrome for something the
                        search palette and a drag already do, and three of
                        them were wrong for any given analyst's patch. */}
                </MapToolsPortal>

                <div style={{
                    flex: 1, minHeight: 0, position: "relative",
                    // The map chrome positions itself against the VISIBLE map,
                    // not the canvas — the panes overlay the canvas, so without
                    // these the annobar lands on top of the Layers pane and the
                    // scale bar disappears underneath it. Same real widths the
                    // GlobeView insets below already use.
                    // THE PANE'S OUTER EDGE, NOT ITS WIDTH. The panes sit 10/12px
                    // in from the canvas edge, so insetting by the width alone
                    // put the annobar and the scale readout flush against the
                    // Layers pane (0px apart). The source viewer, when open,
                    // is part of the right-hand stack too.
                    "--map-inset-l": leftMin ? "0px" : "calc(var(--pane-l, 250px) + 10px)",
                    "--map-inset-r": `${(activeRightOverlayWidth ? activeRightOverlayWidth + 12 : 0) + sourceW}px`,
                }}>
                    {/* A BASEMAP THAT FAILS SAYS SO. Cesium retries a tile,
                        gives up, and reports it nowhere visible — so a dead
                        provider, a lost network, our own tile proxy timing
                        out and simply being below the deepest zoom the
                        provider publishes all looked identical: blank. */}
                    {basemapHealth ? (
                        <div style={{
                            position: "absolute", top: 8,
                            left: "calc(var(--map-inset-l) + 12px)",
                            zIndex: 6, pointerEvents: "none",
                            background: "var(--bg-2)",
                            border: `1px solid ${basemapHealth.state === "error" ? "var(--amber)" : "var(--line)"}`,
                            borderRadius: 2, padding: "4px 8px",
                            font: "400 10px var(--font)",
                            color: basemapHealth.state === "error" ? "var(--amber)" : "var(--txt-4)",
                        }}>
                            {basemapHealth.text}
                        </div>
                    ) : null}

                    {/* Event domains — real signal/alert visualization, per group.
                        Fixed a real bug here: precisionEventsEnabled defaults to
                        true INSIDE GlobeView itself when omitted, so News being
                        "off" didn't actually turn off precision event markers —
                        it's now explicitly wired to the same real toggle. */}
                    
                    <GlobeView
                        eventsEnabled={groupsOnV.news} precisionEventsEnabled={groupsOnV.news && geoConfirmedOn}
                        geoConfirmedEnabled={groupsOnV.news && geoConfirmedOn}
                        gdeltEnabled={groupsOnV.news && gdeltOn}
                        telegramEnabled={groupsOnV.news && telegramOn}
                        unrestEnabled={groupsOnV.news && unrestOn}
                        vesselFilter={vesselFilterOn}
                        aircraftFilter={aircraftFilterOn}
                        onTrackFacets={setTrackFacets}
                        gdeltTypes={gdeltTypes}
                        firesEnabled={groupsOnV.imagery && firesOn}
                        geoConfirmedTheatres={geoConfirmedTheatres}
                        geoConfirmedEndDate={geoConfirmedEndDate}
                        derivedAlertsEnabled={groupsOnV.alerts}
                        coverageEnabled={contextOnV.coverage}
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
                        cablesEnabled={infraOnV.cables} chokepointsEnabled={infraOnV.chokepoints}
                        riskEnabled={contextOnV.risk}
                        frontlinesEnabled={contextOnV.frontlines && !!theatresOnV.ukraine}
                        frontlinesAt={frontlinesAt}
                        gfwKinds={Object.keys(gfwOnV).filter((k) => gfwOnV[k])}
                        gfwHeatmapEnabled={(!asCanvas && gfwHeatOn)}
                        airspaceEnabled={(!asCanvas && airspaceOn)}
                        onAirspaceStatus={setAirspaceStatus}
                        flowsEnabled={contextOnV.flows}
                        onFlowsStatus={setFlowsStatus}
                        onBasemapHealth={setBasemapHealth}
                        onFacilityStatus={setFacStatus}
                        facilityTypes={Object.entries(FACILITY_ROW_TYPE)
                            .filter(([k]) => infraOnV[k])
                            .map(([, v]) => v)}
                        warmapTheatres={contextOnV.frontlines
                            ? frontlineTheatres
                                .filter((t) => t.kind === "points" && theatresOnV[t.key])
                                .map((t) => {
                                    const tl = warTimelines[t.key]
                                    const stop = (tl && tl.idx != null)
                                        ? tl.stops[Math.min(tl.idx, tl.stops.length - 1)]
                                        : null
                                    return { key: t.key, revid: stop?.revid ?? null }
                                })
                            : []}
                        gpsInterferenceEnabled={groupsOnV.air && (!asCanvas && gpsInterferenceOn)}
                        satelliteEnabled={groupsOnV.imagery && satImageOn} infraEnabled={infraOnV.power}
                        imagerySignalsEnabled={groupsOnV.imagery && imagerySignalsOn}
                        assetsEnabled={!asCanvas && assetsOn}
                        nauticalEnabled={infraOnV.nautical}
                        eezEnabled={groupsOnV.zones}
                        /* Context layers — separate from event domains, per build spec v2 §4.2 */
                        graticuleEnabled={contextOnV.graticule}
                        cityLabelsEnabled={contextOnV.labels}
                        /* Live tracks — real raw position rendering, independent of the
                           event-domain toggles above (a vessel's SIGNAL can be shown
                           without its live position, and vice versa). All off by
                           default per §1. */
                        aisEnabled={tracksOnV.vessels} adsbEnabled={tracksOnV.aircraft}
                        portsEnabled={infraOnV.ports} airportsEnabled={infraOnV.airfields}
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
                        overwatchEnabled={(!asCanvas && imageryPanelOpen)}
                        overwatchDetections={imageryDetections}
                        overwatchDrawActive={imageryDrawActive}
                        onOverwatchDrawCancel={() => setImageryDrawActive(false)}
                        overwatchDrawMode={imageryDrawMode}
                        onOverwatchBounds={handleImageryBounds}
                        onOverwatchPolygon={handleImageryPolygon}
                        overwatchSentinelOverlay={imageryScene ? { image_b64: imageryScene.image_b64_composited, bounds: imageryScene.bounds } : null}
                        sceneOverlay={mapSceneLayer} onSceneRect={setMapSceneRect}
                    />
                    {!asCanvas && mapScene && mapSceneLayer?.split != null && (
                        <MapSplitHandle split={mapSceneUi.split} rect={mapSceneRect} onSplit={(v) => setMapSceneUi((u) => ({ ...u, split: v }))} />
                    )}
                    {!asCanvas && mapScene && (
                        <MapSceneCard scene={mapScene} ui={mapSceneUi} onUi={setMapSceneUi} onScene={setMapScene}
                            onClose={() => { setMapScene(null); window.__plxMapScene = null }} />
                    )}
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
                        basemap={asCanvas ? null : { value: basemap, onChange: setBasemap }}
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
                    {!asCanvas && <MapChrome basemap={{ value: basemap, onChange: setBasemap }} />}
                    {/* MapMeta is rendered by GlobeView itself — one readout
                        per map. Rendering a second one here is what put two
                        coordinate/scale stacks in the same corner. */}
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
                    {!asCanvas && imageryPanelOpen && (
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
                {!asCanvas && <VoiceBar active={!asCanvas} />}
                {!asCanvas && timelineOn && <TimeStrip
                    densityBuckets={densityBuckets}
                    windowHours={windowHours}
                    nowMs={nowMs}
                    theatres={geoConfirmedTheatres}
                    endDate={geoConfirmedEndDate}
                    onEndDateChange={setGeoConfirmedEndDate}
                />}
            </div>

            {/* Right — Inspector (real frosted glass, see Layers pane comment above) */}
            {/* Same as the Layers tab above — reached from the rail. */}
            {asCanvas ? null : (
            <div className="pane-glass" data-testid="glass-inspector-pane" data-open={!rightMin} aria-hidden={rightMin || undefined} style={rightPaneStyle}>
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
                        // Esc and ✕ CLEAR THE SELECTION, not just the
                        // panel (v4.3 §2). Closing the inspector while the
                        // map stays selected leaves a highlighted contact
                        // with nothing explaining why it is highlighted.
                        onClose={() => {
                            inspectorPopup.onClose?.()
                            setInspectorPopup(null)
                            setSelected(null)
                        }}
                        onSelectRelated={inspectorPopup.onSelectRelated}
                        onJumpToLocation={inspectorPopup.onJumpToLocation}
                        onTrackEntity={inspectorPopup.onTrackEntity}
                    />
                ) : !selected ? (
                    <div style={{ padding: 12 }}>
                        {/* The wars in view, folded: open one for who fights,
                            why, what is at stake and where it stands now. */}
                        <ConflictContext near="camera" />
                        <div className="statgrid" style={{ marginBottom: 12 }}>
                            <div className="stat"><span className="value">{visibleRows.length}</span><span className="label">Signals in window</span></div>
                            <div className="stat"><span className="value">{legendCounts[0] + legendCounts[1]}</span><span className="label">Critical + high</span></div>
                            <div className="stat"><span className="value">{byRegion.length}</span><span className="label">Regions touched</span></div>
                        </div>
                        <div className="card">
                            <span className="lbl">Signals over the last {timeWindow}</span>
                            <Columns data={timeColumns} parts={SEV_PARTS} height={84}
                                     selected={overviewPick?.kind === "time" ? overviewPick.key : null}
                                     onSelect={(k) => setOverviewPick(k == null ? null : { kind: "time", key: k })}
                                     tip={(c) => `signals from ${c.label}`} label="Signals over time, by severity" />
                        </div>
                        <div className="card">
                            <span className="lbl">By region</span>
                            {byRegion.length === 0 ? (
                                <div style={{ font: "400 12px var(--font)", color: "var(--txt-4)" }}>No real region data in this window.</div>
                            ) : (
                                <BarList rows={byRegion.map(([name, count]) => ({ key: name, label: name, value: count, title: `${name}: ${count} signals — click to go there` }))}
                                         selected={overviewPick?.kind === "region" ? overviewPick.key : null}
                                         onSelect={(k) => { setOverviewPick(k == null ? null : { kind: "region", key: k }); if (k) flyToRegion(k) }} />
                            )}
                        </div>
                        {pickedRows && (
                            <div className="card" data-testid="overview-picked">
                                <span className="lbl" style={{ display: "flex", justifyContent: "space-between" }}>
                                    <span>{overviewPick.kind === "time" ? `From ${timeColumns.find((c) => c.key === overviewPick.key)?.label}` : overviewPick.key} · {pickedRows.length}</span>
                                    <button onClick={() => setOverviewPick(null)} style={{ border: 0, background: "none", color: "var(--txt-3)", cursor: "pointer", font: "inherit" }}>clear</button>
                                </span>
                                {pickedRows.slice(0, 8).map((r) => (
                                    <div key={r.id} className="evrow" onClick={() => openOverviewRow(r)} style={{ cursor: "pointer" }}>
                                        <span className={`dia ${SEV_CLASS_BY_RANK[r.severityRank] || "moderate"}`} />
                                        <div>
                                            <div className="title">{r.title}</div>
                                            <div className="meta">{r.aoi && <span>{r.aoi}</span>}<span className="time">{whenLabel(r.publishedAt, nowMs) || timeAgoLabel(r.publishedAt, nowMs)}</span></div>
                                        </div>
                                    </div>
                                ))}
                                {pickedRows.length > 8 && <div style={{ font: "400 11px var(--font)", color: "var(--txt-4)", paddingTop: 4 }}>and {pickedRows.length - 8} more</div>}
                            </div>
                        )}
                        <div style={{ marginTop: 12 }}>
                            <SeverityLegend legendCounts={legendCounts} />
                        </div>
                        <div style={{ marginTop: 12 }}>
                            <div style={{ font: "600 11px var(--font)", color: "var(--txt-3)", marginBottom: 6 }}>Newest critical</div>
                            {newestCritical.length === 0 ? (
                                <div style={{ font: "400 12px var(--font)", color: "var(--txt-4)" }}>No critical or high-severity signals in this window.</div>
                            ) : newestCritical.map((r) => (
                                <div key={r.id} className="evrow"
                                     style={{ background: tintBackground(r.severityRank, r.publishedAt, nowMs) }}
                                     onClick={() => openOverviewRow(r)}>
                                    <span className={`dia ${SEV_CLASS_BY_RANK[r.severityRank] || "moderate"}`} />
                                    <div>
                                        <div className="title">{r.title}</div>
                                        <div className="meta">
                                            {r.aoi && <span>{r.aoi}</span>}
                                            <span className="time">{whenLabel(r.publishedAt, nowMs) || timeAgoLabel(r.publishedAt, nowMs)}</span>
                                        </div>
                                    </div>
                                    {r.lat != null && r.lon != null && (
                                        <button className="btn ghost sm" title="Replay on map" onClick={(e) => { e.stopPropagation(); replayOnMap({ lat: r.lat, lon: r.lon, publishedAt: r.publishedAt, title: r.title }) }} style={{ padding: 2 }}>
                                            <svg className="icon sm"><use href="#i-clock" /></svg>
                                        </button>
                                    )}
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
                            <span style={{ marginLeft: "auto", color: "var(--txt-4)" }}>{whenLabel(selected.publishedAt, nowMs) || timeAgoLabel(selected.publishedAt, nowMs)}</span>
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
