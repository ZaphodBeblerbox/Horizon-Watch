import { useState, lazy, Suspense, Component } from "react"
import "../styles/mobileShell.css"
import AlertsTab from "./tabs/AlertsTab.jsx"
import BriefTab from "./tabs/BriefTab.jsx"
import NoteTab from "./tabs/NoteTab.jsx"

// MapTab now renders the real Cesium globe (src/components/GlobeView.jsx) —
// still lazy so its real weight (Cesium, terrain, live tracks) only loads
// once the analyst actually opens Map, exactly like every other Cesium-
// bearing destination in the desktop console already does implicitly by
// living behind its own tab.
const MapTab = lazy(() => import("./tabs/MapTab.jsx"))

const TABS = [
    { id: "alerts", label: "Alerts", icon: "◆" },
    { id: "brief",  label: "Brief",  icon: "▤" },
    { id: "map",    label: "Map",    icon: "⬡" },
    { id: "note",   label: "Note",   icon: "◈" },
]

/**
 * The real phone-mode shell — rendered by app.jsx in place of the desktop
 * console below the phone breakpoint (see app.jsx's `phoneMode` state),
 * never a second standalone page. `initialBriefingReportId` carries the
 * desktop's own currently-open briefing across the mode switch (the one
 * concrete "don't lose what the analyst was looking at" case the
 * correction prompt names) — Brief opens to that same real document
 * instead of defaulting to "most recent" when one was already open.
 */
export default function MobileApp({ initialBriefingReportId }) {
    const [tab, setTab] = useState("alerts")
    // Real state (not a picker-local list) carrying a reference from
    // anywhere in the app into the Note tab — the exact fix for the
    // reference-picker data-loss bug: a moderate-severity signal reached
    // via a Brief reference must still be attached when the analyst jumps
    // to Note, never silently dropped to "None".
    const [pendingNoteRef, setPendingNoteRef] = useState(null)

    function openNoteWithReference(ref) {
        setPendingNoteRef(ref)
        setTab("note")
    }

    // Real "show on map" — the exact same akili:fly-to event GlobeView
    // already listens for (the desktop console's own real mechanism, per
    // src/components/GlobeView.jsx), not a mobile-only parallel event. The
    // globe stays mounted (display:none) behind every other tab, so the fly
    // happens immediately; switching tabs just lets the analyst see it.
    function showOnMap(lat, lon) {
        if (lat == null || lon == null) return
        setTab("map")
        window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat, lon, altitude: 60000 } }))
    }

    return (
        <div className={`phone-shell m-body${tab === "map" ? " map-active" : ""}`}>
            <div />
            <div className="m-header">Horizon Watch</div>

            {/* No inline `position` here — an inline style always wins over
                the stylesheet, which would silently defeat mobileShell.css's
                `.phone-shell.map-active .m-map-content { position: absolute }`
                full-bleed rule (confirmed live: this was exactly why the
                globe's canvas rendered at zero height the first time). */}
            <div className="m-map-content" style={{ minHeight: 0, overflow: "hidden" }}>
                <TabPanel active={tab === "alerts"}><AlertsTab onOpenNoteWithReference={openNoteWithReference} onShowOnMap={showOnMap} /></TabPanel>
                <TabPanel active={tab === "brief"}><BriefTab onOpenNoteWithReference={openNoteWithReference} initialReportId={initialBriefingReportId} /></TabPanel>
                <TabPanel active={tab === "map"}>
                    <MapErrorBoundary>
                        <Suspense fallback={<Loading />}>
                            <MapTab active={tab === "map"} />
                        </Suspense>
                    </MapErrorBoundary>
                </TabPanel>
                <TabPanel active={tab === "note"}>
                    <NoteTab pendingReference={pendingNoteRef} onReferenceConsumed={() => setPendingNoteRef(null)} />
                </TabPanel>
            </div>

            <div className="m-tabbar">
                {TABS.map((t) => (
                    <button key={t.id} className="m-tab-btn m-tap" aria-current={tab === t.id} onClick={() => setTab(t.id)}>
                        <span style={{ fontSize: 18 }}>{t.icon}</span>
                        <span>{t.label}</span>
                    </button>
                ))}
            </div>
        </div>
    )
}

function TabPanel({ active, children }) {
    return <div style={{ display: active ? "flex" : "none", flexDirection: "column", height: "100%", minHeight: 0 }}>{children}</div>
}

function Loading() {
    return <div style={{ padding: 20, color: "var(--txt-3)", fontSize: 13 }}>Loading map…</div>
}

// Real offline degradation: a genuinely failed dynamic import of the Map
// tab's own chunk (a real possible failure on a bad connection) throws past
// Suspense and needs a real error boundary, or it would take the whole
// phone shell down instead of leaving Alerts/Brief/Note working.
class MapErrorBoundary extends Component {
    constructor(props) { super(props); this.state = { failed: false } }
    static getDerivedStateFromError() { return { failed: true } }
    componentDidCatch(err) { console.error("[phone map] chunk load failed:", err) }
    render() {
        if (this.state.failed) {
            return (
                <div style={{ padding: 20, color: "var(--txt-3)", fontSize: 14, lineHeight: 1.5 }}>
                    Map unavailable offline. Alerts, Brief and Note still work.
                </div>
            )
        }
        return this.props.children
    }
}
