/**
 * Sources.jsx — one of the 5 fixed top-level destinations (full UI rebuild
 * spec). Displayed as "Intel" in the primary nav (src/data/destinations.js)
 * per the UI correction pass (Part 11.1) — the `key`/tab-type/file name all
 * deliberately stay "sources": src/app.jsx (off-limits this round) keys tab
 * state off this literal string in three places (DESTINATION_KEYS matching,
 * MODE_LABELS' "SOURCES" mode-strip text, and openTab()'s LABELS map's
 * "Sources" tab title) — renaming the key would require touching app.jsx to
 * keep those working, a bigger blast radius than this destination's own
 * label warrants. Known, documented consequence: the header mode-strip text
 * and any programmatically-opened tab's title still literally read "SOURCES"
 * / "Sources" until app.jsx's own hardcoded maps are updated in a later
 * round — the primary destination nav (which reads DESTINATIONS' `label`)
 * correctly reads "Intel".
 *
 * Self-contained: fetches/mutates all its own real data against the real
 * backend endpoints; not wired into app.jsx by this file.
 *
 * Four tabs, each backed by real, live data — no padding tab for its own
 * sake (UI correction pass Part 11.5's explicit instruction):
 *   - Watch Areas   — WatchZone CRUD, ported from ForgePanel.jsx's
 *                     CreateZoneModal (real field names, real endpoints).
 *   - Detection Rules — RuleConfig CRUD, ported from ForgePanel.jsx's
 *                     RulesPanel.
 *   - Status / Health — real per-source feed health from the same real
 *                     GET /api/health/detailed endpoint src/utils/
 *                     systemHealth.js and src/components/HealthPanel.jsx
 *                     already consume, reusing summarizeHealth() rather
 *                     than re-parsing the payload.
 *   - Ontology      — the real, live, DB-backed entity/link graph
 *                     (src/components/forge/ForceGraph.jsx, reused as-is —
 *                     see this file's own audit note further down for why
 *                     this tab is justified rather than assumed).
 *
 * Real endpoints used:
 *   GET/POST     /api/watch-zones
 *   PUT/DELETE   /api/watch-zones/{system_id}
 *   GET          /api/watch-zones/{system_id}/analytics
 *   GET          /api/watch-zones/{system_id}/detections
 *   GET/POST     /api/rules
 *   PUT/DELETE   /api/rules/{id}
 *   GET          /api/alerts, /api/alerts/{alert_id}   (rule → fired-alerts, best-effort — see RuleInspectPanel)
 *   GET          /api/health/detailed
 *
 * Skipped sub-feature (per the round's ground rules — an honest skip, not a
 * fabrication): a standing-collection/PIR-deck list. Searched backend/main.py
 * and backend/database.py for "PIR"/"collection_gap"/standing-collection —
 * no real backing model or endpoint exists for this concept anywhere in the
 * codebase, so it is not built here.
 *
 * Ontology-tab audit (UI correction pass Part 11.5 — "audit first, only
 * build if genuinely justified"): read ForgePanel.jsx's ~6700-line file
 * (grepped for "ontology") and src/components/forge/ForceGraph.jsx in full.
 * Findings: real, live-wired, NOT fake —
 *   - ForceGraph.jsx fetches real data from GET /api/ontology/graph
 *     (confirmed at backend/main.py:20685) and polls GET /api/ontology/
 *     graph/delta (confirmed at :20847) for incremental updates; clicking a
 *     node fetches the real per-entity profile from GET /api/entities/
 *     {type}/{id}/profile.
 *   - The rendering itself is a genuine, working force-directed canvas
 *     simulation (repulsion/spring/cluster-target physics, drag/pan/zoom,
 *     type-priority node capping at 150, filter pills) — not a placeholder
 *     or a static screenshot-shaped stub.
 *   - This is deliberately a DIFFERENT dataset from ForgePanel.jsx's
 *     "Reviewed Claims Graph" (OntologyClaimsReview / the human-approval
 *     queue for document-extracted relationships) — this tab reuses
 *     ForceGraph.jsx's "Live Operational Graph" specifically, which is the
 *     one that needs no separate review step to be real and current.
 * Decision: build the tab, reusing ForceGraph.jsx directly (imported, not
 * re-implemented) — the bar for "genuinely real and wired to real data" is
 * clearly met.
 */
import { useCallback, useEffect, useState } from "react"
import API_BASE from "../apiBase.js"
import { Button, Panel, EmptyState } from "../ui/index.js"
import Icon from "../ui/Icon.jsx"
import AoiMiniMap from "./AoiMiniMap.jsx"
import ForceGraph from "../components/forge/ForceGraph.jsx"
import { summarizeHealth, STATUS_COLOR_TOKEN, STATUS_WORD } from "../utils/systemHealth.js"
import { timeAgoLabel } from "./dashboardLogic.js"
import {
    RULE_TRIGGER_TYPES, TRIGGER_FIELD_SPECS,
    validateRuleForm, buildRulePayload, boundsToPolygon,
    bboxToLockBounds, zoneFlyTarget, matchAlertsToRule,
} from "./sourcesLogic.js"
import Loading from "../ui/Loading.jsx"

const API = API_BASE

function forgeHeaders() {
    return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("hw-auth-token") || ""}`,
    }
}

const inputStyle = {
    padding: "6px 10px", background: "var(--bg-input)", border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: "var(--text-sm)",
    fontFamily: "var(--font-sans)", outline: "none", width: "100%", boxSizing: "border-box",
}
const labelStyle = { color: "var(--text-secondary)", fontSize: "var(--text-callout-meta)", display: "block", marginBottom: 4 }
const fieldRow = { marginBottom: "var(--space-2)" }
const iconBtnStyle = {
    width: 26, height: 26, borderRadius: "var(--radius-sm)", background: "transparent",
    border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center",
    cursor: "pointer", color: "var(--text-secondary)", flexShrink: 0,
}

// ── Tabs ─────────────────────────────────────────────────────────────────

const TABS = [
    { key: "watchAreas", label: "Watch Areas" },
    { key: "rules", label: "Detection Rules" },
    { key: "health", label: "Status / Health" },
    { key: "ontology", label: "Ontology" },
]

// ── Watch Areas ──────────────────────────────────────────────────────────

function NewWatchAreaForm({ bounds, onCancel, onCreated }) {
    const [name, setName] = useState("")
    const [description, setDescription] = useState("")
    const [priority, setPriority] = useState("medium")
    const [scanInterval, setScanInterval] = useState(120)
    const [alertThreshold, setAlertThreshold] = useState("both")
    const [saving, setSaving] = useState(false)
    const [err, setErr] = useState("")

    const save = async () => {
        const polygon = boundsToPolygon(bounds)
        if (!name.trim() || !polygon) { setErr("Name and a drawn area are both required"); return }
        setSaving(true); setErr("")
        try {
            const res = await fetch(`${API}/api/watch-zones`, {
                method: "POST", headers: forgeHeaders(),
                body: JSON.stringify({
                    name: name.trim(), description: description || null,
                    polygon_geojson: polygon, priority,
                    scan_interval_hours: Number(scanInterval), alert_threshold: alertThreshold,
                }),
            })
            const d = await res.json()
            if (res.ok) onCreated(d)
            else setErr(d.detail || "Failed to create watch area")
        } catch (e) { setErr(e.message) }
        finally { setSaving(false) }
    }

    return (
        <Panel elevated style={{ marginBottom: "var(--space-3)", background: "var(--bg-panel-translucent)" }}>
            <div style={{ fontSize: "var(--text-callout-title)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)", marginBottom: "var(--space-2)" }}>
                New Watch Area
            </div>
            <div style={fieldRow}>
                <label style={labelStyle}>Name *</label>
                <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Strait of Hormuz — Critical Zone" />
            </div>
            <div style={fieldRow}>
                <label style={labelStyle}>Description</label>
                <input style={inputStyle} value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-2)" }}>
                <div style={fieldRow}>
                    <label style={labelStyle}>Priority</label>
                    <select style={inputStyle} value={priority} onChange={e => setPriority(e.target.value)}>
                        {["critical", "high", "medium", "low"].map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                </div>
                <div style={fieldRow}>
                    <label style={labelStyle}>Scan interval</label>
                    <select style={inputStyle} value={scanInterval} onChange={e => setScanInterval(e.target.value)}>
                        <option value={24}>Every 24h</option>
                        <option value={72}>Every 3 days</option>
                        <option value={120}>Every 5 days</option>
                        <option value={168}>Every 7 days</option>
                    </select>
                </div>
            </div>
            <div style={fieldRow}>
                <label style={labelStyle}>Alert threshold</label>
                <select style={inputStyle} value={alertThreshold} onChange={e => setAlertThreshold(e.target.value)}>
                    <option value="digest">Digest only</option>
                    <option value="immediate">Immediate only</option>
                    <option value="both">Both</option>
                </select>
            </div>
            {err && <div style={{ color: "var(--danger)", fontSize: "var(--text-callout-meta)", marginBottom: "var(--space-2)" }}>{err}</div>}
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
                <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
                <Button variant="primary" size="sm" onClick={save} disabled={saving}>{saving ? "Creating…" : "Create Watch Area"}</Button>
            </div>
        </Panel>
    )
}

// Real edit form for an EXISTING zone (PUT /api/watch-zones/{system_id}) —
// the create-only form above can't double as this: it only knows how to
// build a *new* zone from freshly-drawn bounds, not pre-fill from one that
// already exists. Every field here (name/description/priority/
// scan_interval_hours/alert_threshold) is one api_watch_zone_update() in
// backend/main.py actually persists — polygon/bbox editing (which would
// need a redraw interaction) is out of scope for this pass.
function EditWatchAreaForm({ zone, onCancel, onSaved }) {
    const [name, setName] = useState(zone.name || "")
    const [description, setDescription] = useState(zone.description || "")
    const [priority, setPriority] = useState(zone.priority || "medium")
    const [scanInterval, setScanInterval] = useState(zone.scan_interval_hours || 120)
    const [alertThreshold, setAlertThreshold] = useState(zone.alert_threshold || "both")
    const [saving, setSaving] = useState(false)
    const [err, setErr] = useState("")

    const save = async () => {
        if (!name.trim()) { setErr("Name is required"); return }
        setSaving(true); setErr("")
        try {
            const res = await fetch(`${API}/api/watch-zones/${zone.system_id}`, {
                method: "PUT", headers: forgeHeaders(),
                body: JSON.stringify({
                    name: name.trim(), description: description || null, priority,
                    scan_interval_hours: Number(scanInterval), alert_threshold: alertThreshold,
                }),
            })
            const d = await res.json()
            if (res.ok) onSaved(d)
            else setErr(d.detail || "Failed to save watch area")
        } catch (e) { setErr(e.message) }
        finally { setSaving(false) }
    }

    return (
        <Panel elevated style={{ marginBottom: "var(--space-3)", background: "var(--bg-panel-translucent)" }}>
            <div style={{ fontSize: "var(--text-callout-title)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)", marginBottom: "var(--space-2)" }}>
                Edit {zone.name}
            </div>
            <div style={fieldRow}>
                <label style={labelStyle}>Name *</label>
                <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div style={fieldRow}>
                <label style={labelStyle}>Description</label>
                <input style={inputStyle} value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-2)" }}>
                <div style={fieldRow}>
                    <label style={labelStyle}>Priority</label>
                    <select style={inputStyle} value={priority} onChange={e => setPriority(e.target.value)}>
                        {["critical", "high", "medium", "low"].map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                </div>
                <div style={fieldRow}>
                    <label style={labelStyle}>Scan interval</label>
                    <select style={inputStyle} value={scanInterval} onChange={e => setScanInterval(e.target.value)}>
                        <option value={24}>Every 24h</option>
                        <option value={72}>Every 3 days</option>
                        <option value={120}>Every 5 days</option>
                        <option value={168}>Every 7 days</option>
                    </select>
                </div>
            </div>
            <div style={fieldRow}>
                <label style={labelStyle}>Alert threshold</label>
                <select style={inputStyle} value={alertThreshold} onChange={e => setAlertThreshold(e.target.value)}>
                    <option value="digest">Digest only</option>
                    <option value="immediate">Immediate only</option>
                    <option value="both">Both</option>
                </select>
            </div>
            {err && <div style={{ color: "var(--danger)", fontSize: "var(--text-callout-meta)", marginBottom: "var(--space-2)" }}>{err}</div>}
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
                <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
                <Button variant="primary" size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</Button>
            </div>
        </Panel>
    )
}

function WatchAreaRow({ zone, isInspecting, isEditing, onInspect, onEdit, onToggleEnabled, onDelete }) {
    return (
        <Panel
            onClick={() => onInspect(zone)}
            style={{
                marginBottom: "var(--space-2)", cursor: "pointer",
                background: "var(--bg-card-translucent)",
                outline: isInspecting || isEditing ? "1px solid var(--accent-blue)" : "none",
                outlineOffset: -1,
            }}
        >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-2)" }}>
                <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "var(--text-callout-title)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>
                        {zone.name}
                    </div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-callout-meta)", color: "var(--text-muted)", marginTop: 2 }}>
                        {zone.system_id} · {zone.priority} · every {zone.scan_interval_hours}h
                    </div>
                </div>
                <div style={{ display: "flex", gap: "var(--space-1)", flexShrink: 0 }}>
                    <button title="Edit" aria-label="Edit" style={iconBtnStyle} onClick={(e) => { e.stopPropagation(); onEdit(zone) }}>
                        <Icon name="edit" size={14} />
                    </button>
                    <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onToggleEnabled(zone) }}>{zone.enabled ? "Disable" : "Enable"}</Button>
                    <Button variant="danger" size="sm" onClick={(e) => { e.stopPropagation(); onDelete(zone) }}>Delete</Button>
                </div>
            </div>
        </Panel>
    )
}

// Real inspect view for a Watch Area — the new default click target (UI
// correction pass Part 11.4), replacing "click card -> edit form". Shows
// real aggregated findings from GET /api/watch-zones/{id}/analytics and the
// most recent real detections from GET /api/watch-zones/{id}/detections
// (already sorted newest-first server-side; sliced client-side to a
// reasonable "latest findings" length). Also owns the real "Lock View"
// toggle, which threads through to AoiMiniMap's live Cesium viewer via its
// new lockActive/lockBounds props -> AoiLockDimming.
function ZoneInspectPanel({ zone, lockActive, onToggleLock, onClose }) {
    const [analytics, setAnalytics] = useState(null)
    const [detections, setDetections] = useState([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        Promise.all([
            fetch(`${API}/api/watch-zones/${zone.system_id}/analytics`).then(r => r.ok ? r.json() : null).catch(() => null),
            fetch(`${API}/api/watch-zones/${zone.system_id}/detections`).then(r => r.ok ? r.json() : []).catch(() => []),
        ]).then(([a, d]) => {
            if (cancelled) return
            setAnalytics(a)
            setDetections(Array.isArray(d) ? d.slice(0, 8) : [])
            setLoading(false)
        })
        return () => { cancelled = true }
    }, [zone.system_id])

    return (
        <Panel elevation={2} style={{ marginBottom: "var(--space-3)", background: "var(--bg-panel-translucent)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "var(--space-2)" }}>
                <div>
                    <div style={{ fontSize: "var(--text-callout-title)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>
                        {zone.name}
                    </div>
                    <div style={{ fontSize: "var(--text-callout-meta)", color: "var(--text-muted)", marginTop: 2 }}>
                        Latest findings
                    </div>
                </div>
                <div style={{ display: "flex", gap: "var(--space-1)", alignItems: "center" }}>
                    <Button variant={lockActive ? "primary" : "ghost"} size="sm" onClick={onToggleLock}>
                        <Icon name="lock" size={13} style={{ marginRight: 4 }} />
                        {lockActive ? "Unlock View" : "Lock View"}
                    </Button>
                    <button title="Close" aria-label="Close" style={iconBtnStyle} onClick={onClose}>
                        <Icon name="close" size={14} />
                    </button>
                </div>
            </div>

            {loading && (
                <div style={{ color: "var(--text-muted)", fontSize: "var(--text-callout-meta)", padding: "var(--space-2) 0" }}>
                    Loading findings…
                </div>
            )}

            {!loading && analytics && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
                    <StatBox label="Scans (total / 30d)" value={`${analytics.scans_total} / ${analytics.scans_last_30_days}`} />
                    <StatBox label="Vessel trend" value={analytics.vessel_activity_trend} />
                    <StatBox label="Vessels now vs. baseline" value={`${analytics.current_vessel_count} vs. ${analytics.baseline_vessel_count} (${analytics.change_vs_baseline_pct > 0 ? "+" : ""}${analytics.change_vs_baseline_pct}%)`} />
                    <StatBox label="Last fire / smoke" value={
                        [analytics.last_fire_detected && `fire ${timeAgoLabel(analytics.last_fire_detected)}`,
                         analytics.last_smoke_detected && `smoke ${timeAgoLabel(analytics.last_smoke_detected)}`]
                            .filter(Boolean).join(" · ") || "none detected"
                    } />
                </div>
            )}

            {!loading && analytics && Object.keys(analytics.detections_by_type || {}).length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-1)", marginBottom: "var(--space-3)" }}>
                    {Object.entries(analytics.detections_by_type).map(([type, count]) => (
                        <span key={type} style={{
                            fontSize: "var(--text-callout-meta)", padding: "2px 8px", borderRadius: "var(--radius-sm)",
                            background: "var(--bg-card)", color: "var(--text-secondary)", border: "1px solid var(--border)",
                        }}>{type} · {count}</span>
                    ))}
                </div>
            )}

            {!loading && detections.length === 0 && (
                <EmptyState title="No detections yet" description="This watch area hasn't produced any real satellite detections yet — check back after its next scan." />
            )}

            {!loading && detections.length > 0 && (
                <div>
                    <div style={{ fontSize: "var(--text-callout-meta)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "var(--space-1)" }}>
                        Recent detections
                    </div>
                    {detections.map(d => (
                        <div key={d.detection_id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--border)", fontSize: "var(--text-callout-meta)" }}>
                            <span style={{ color: "var(--text-primary)" }}>
                                {d.object_type}{d.nearest_port ? ` · near ${d.nearest_port}` : d.nearest_infrastructure ? ` · near ${d.nearest_infrastructure}` : ""}
                            </span>
                            <span style={{ color: "var(--text-muted)" }}>
                                {Math.round((d.confidence || 0) * 100)}% · {timeAgoLabel(d.created_at)}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </Panel>
    )
}

function StatBox({ label, value }) {
    return (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "var(--space-2)" }}>
            <div style={{ fontSize: "var(--text-callout-meta)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
            <div style={{ fontSize: "var(--text-callout-title)", color: "var(--text-primary)", fontWeight: "var(--weight-semibold)", marginTop: 2 }}>{value}</div>
        </div>
    )
}

function WatchAreasTab({ zones, reloadZones }) {
    const [selectedZoneId, setSelectedZoneId] = useState(null)
    const [inspectingZoneId, setInspectingZoneId] = useState(null)
    const [editingZoneId, setEditingZoneId] = useState(null)
    const [lockActive, setLockActive] = useState(false)
    const [drawActive, setDrawActive] = useState(false)
    const [drawnBounds, setDrawnBounds] = useState(null)

    const inspectingZone = zones.find(z => z.system_id === inspectingZoneId) || null
    const editingZone = zones.find(z => z.system_id === editingZoneId) || null

    const inspect = (zone) => {
        setEditingZoneId(null)
        setSelectedZoneId(zone.system_id)
        setInspectingZoneId(zone.system_id)
        setLockActive(false)
        // Real "fly the map" interaction (UI correction pass Part 11.4) —
        // the same real akili:fly-to window event every other map
        // interaction in this app dispatches (see src/globe/GlobePopup.jsx,
        // src/reports/ReadingWorkspace.jsx). This moves the main Globe's
        // camera even while it's not the visible destination (GlobeView
        // stays mounted behind the 5 destinations) — so the fly is real and
        // takes effect immediately if the analyst switches back to the
        // Globe. The embedded AoiMiniMap on this page *also* flies its own
        // camera directly below, which is the one the analyst can see move
        // without leaving Intel.
        const target = zoneFlyTarget(zone.bbox)
        if (target) window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: target }))
    }

    const toggleZoneEnabled = async (zone) => {
        await fetch(`${API}/api/watch-zones/${zone.system_id}`, {
            method: "PUT", headers: forgeHeaders(), body: JSON.stringify({ enabled: !zone.enabled }),
        }).catch(() => {})
        reloadZones()
    }
    const deleteZone = async (zone) => {
        await fetch(`${API}/api/watch-zones/${zone.system_id}`, { method: "DELETE", headers: forgeHeaders() }).catch(() => {})
        if (inspectingZoneId === zone.system_id) setInspectingZoneId(null)
        if (editingZoneId === zone.system_id) setEditingZoneId(null)
        reloadZones()
    }

    return (
        <div style={{ display: "flex", height: "100%", fontFamily: "var(--font-sans)" }}>
            {/* Main — collection coverage map */}
            <div style={{ flex: 2, minWidth: 0, borderRight: "1px solid var(--border)" }}>
                <AoiMiniMap
                    zones={zones}
                    selectedZoneId={selectedZoneId}
                    onSelectZone={(id) => { const z = zones.find(zz => zz.system_id === id); if (z) inspect(z) }}
                    drawActive={drawActive}
                    onDrawComplete={(bounds) => { setDrawnBounds(bounds); setDrawActive(false) }}
                    flyToZoneId={inspectingZoneId}
                    lockActive={lockActive}
                    lockBounds={inspectingZone ? bboxToLockBounds(inspectingZone.bbox) : null}
                />
            </div>

            {/* Right rail */}
            <div style={{
                flex: 1, minWidth: 320, maxWidth: 420, background: "var(--bg-panel)",
                display: "flex", flexDirection: "column", overflowY: "auto", padding: "var(--space-3)",
            }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-2)" }}>
                    <div style={{ fontSize: "var(--text-section-head)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>
                        Watch Areas
                    </div>
                    <Button
                        variant={drawActive ? "ghost" : "primary"} size="sm"
                        onClick={() => { setDrawActive(v => !v); setDrawnBounds(null) }}
                    >
                        {drawActive ? "Cancel Draw" : "+ New Watch Area"}
                    </Button>
                </div>

                {drawnBounds && (
                    <NewWatchAreaForm
                        bounds={drawnBounds}
                        onCancel={() => setDrawnBounds(null)}
                        onCreated={() => { setDrawnBounds(null); reloadZones() }}
                    />
                )}

                {editingZone && (
                    <EditWatchAreaForm
                        zone={editingZone}
                        onCancel={() => setEditingZoneId(null)}
                        onSaved={() => { setEditingZoneId(null); reloadZones() }}
                    />
                )}

                {inspectingZone && !editingZone && (
                    <ZoneInspectPanel
                        zone={inspectingZone}
                        lockActive={lockActive}
                        onToggleLock={() => setLockActive(v => !v)}
                        onClose={() => { setInspectingZoneId(null); setLockActive(false) }}
                    />
                )}

                {zones.length === 0 ? (
                    <EmptyState title="No watch areas yet" description="Draw a rectangle on the map to create one." />
                ) : (
                    zones.map(z => (
                        <WatchAreaRow
                            key={z.system_id} zone={z}
                            isInspecting={inspectingZoneId === z.system_id}
                            isEditing={editingZoneId === z.system_id}
                            onInspect={inspect}
                            onEdit={(zone) => { setInspectingZoneId(null); setLockActive(false); setEditingZoneId(zone.system_id) }}
                            onToggleEnabled={toggleZoneEnabled}
                            onDelete={deleteZone}
                        />
                    ))
                )}
            </div>
        </div>
    )
}

// ── Detection Rules ──────────────────────────────────────────────────────

function NewRuleForm({ onCancel, onCreated }) {
    const [name, setName] = useState("")
    const [triggerType, setTriggerType] = useState(RULE_TRIGGER_TYPES[0])
    const [severity, setSeverity] = useState("medium")
    const [target, setTarget] = useState("")
    const [threshold, setThreshold] = useState("")
    const [saving, setSaving] = useState(false)
    const [err, setErr] = useState("")

    const spec = TRIGGER_FIELD_SPECS[triggerType]

    const save = async () => {
        const { valid, errors } = validateRuleForm({ name, triggerType, threshold })
        if (!valid) { setErr(Object.values(errors)[0]); return }
        const body = buildRulePayload({ name, triggerType, severity, target, threshold })
        setSaving(true); setErr("")
        try {
            const res = await fetch(`${API}/api/rules`, { method: "POST", headers: forgeHeaders(), body: JSON.stringify(body) })
            const d = await res.json()
            if (res.ok) onCreated(d)
            else setErr(d.detail || "Failed to create rule")
        } catch (e) { setErr(e.message) }
        finally { setSaving(false) }
    }

    return (
        <Panel elevated style={{ marginBottom: "var(--space-3)", background: "var(--bg-panel-translucent)" }}>
            <div style={{ fontSize: "var(--text-callout-title)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)", marginBottom: "var(--space-2)" }}>
                New Detection Rule
            </div>
            <div style={fieldRow}>
                <label style={labelStyle}>Rule name *</label>
                <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Med cable watch" />
            </div>
            <div style={fieldRow}>
                <label style={labelStyle}>Condition type</label>
                <select style={inputStyle} value={triggerType} onChange={e => { setTriggerType(e.target.value); setTarget(""); setThreshold("") }}>
                    {RULE_TRIGGER_TYPES.map(t => <option key={t} value={t}>{TRIGGER_FIELD_SPECS[t].label}</option>)}
                </select>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-2)" }}>
                <div style={fieldRow}>
                    <label style={labelStyle}>Severity</label>
                    <select style={inputStyle} value={severity} onChange={e => setSeverity(e.target.value)}>
                        {["critical", "high", "medium", "low"].map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                </div>
                <div style={fieldRow}>
                    <label style={labelStyle}>{spec.thresholdField.label} ({spec.thresholdField.unit})</label>
                    <input
                        style={inputStyle} type="number" value={threshold}
                        onChange={e => setThreshold(e.target.value)}
                        placeholder={String(spec.thresholdField.default)}
                    />
                </div>
            </div>
            <div style={fieldRow}>
                <label style={labelStyle}>{spec.targetField.label}</label>
                <input
                    style={inputStyle} value={target} onChange={e => setTarget(e.target.value)}
                    placeholder={spec.targetField.default || "ALL"}
                />
            </div>
            {err && <div style={{ color: "var(--danger)", fontSize: "var(--text-callout-meta)", marginBottom: "var(--space-2)" }}>{err}</div>}
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
                <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
                <Button variant="primary" size="sm" onClick={save} disabled={saving}>{saving ? "Creating…" : "Create Rule"}</Button>
            </div>
        </Panel>
    )
}

// Real edit form for an EXISTING rule (PUT /api/rules/{id}). Deliberately
// only exposes target + threshold as editable: backend/main.py's
// api_rules_update() only ever reads `rule_name`/`enabled`/`params` off the
// request body — it silently ignores `name`/`severity` if sent, so a form
// that let an analyst "edit" those fields would look like it worked while
// persisting nothing. Name/severity/trigger type are shown read-only here
// instead of faked as editable.
function EditRuleForm({ rule, onCancel, onSaved }) {
    const spec = TRIGGER_FIELD_SPECS[rule.trigger_type]
    const [target, setTarget] = useState(spec ? (rule.params?.[spec.targetField.key] ?? "") : "")
    const [threshold, setThreshold] = useState(spec ? (rule.params?.[spec.thresholdField.key] ?? "") : "")
    const [saving, setSaving] = useState(false)
    const [err, setErr] = useState("")

    const save = async () => {
        if (!spec) { setErr(`Unrecognized trigger type ${rule.trigger_type}`); return }
        const params = { ...rule.params }
        if (target !== "") params[spec.targetField.key] = target
        if (threshold !== "" && Number.isFinite(Number(threshold))) params[spec.thresholdField.key] = Number(threshold)
        setSaving(true); setErr("")
        try {
            const res = await fetch(`${API}/api/rules/${rule.id}`, {
                method: "PUT", headers: forgeHeaders(), body: JSON.stringify({ params }),
            })
            const d = await res.json()
            if (res.ok) onSaved(d)
            else setErr(d.detail || "Failed to save rule")
        } catch (e) { setErr(e.message) }
        finally { setSaving(false) }
    }

    return (
        <Panel elevated style={{ marginBottom: "var(--space-3)", background: "var(--bg-panel-translucent)" }}>
            <div style={{ fontSize: "var(--text-callout-title)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)", marginBottom: 2 }}>
                Edit {rule.name}
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-callout-meta)", color: "var(--text-muted)", marginBottom: "var(--space-2)" }}>
                {rule.trigger_type} · {rule.severity} severity — name/trigger type/severity aren't editable (not persisted by this rule's update endpoint)
            </div>
            {spec ? (
                <>
                    <div style={fieldRow}>
                        <label style={labelStyle}>{spec.thresholdField.label} ({spec.thresholdField.unit})</label>
                        <input style={inputStyle} type="number" value={threshold} onChange={e => setThreshold(e.target.value)} placeholder={String(spec.thresholdField.default)} />
                    </div>
                    <div style={fieldRow}>
                        <label style={labelStyle}>{spec.targetField.label}</label>
                        <input style={inputStyle} value={target} onChange={e => setTarget(e.target.value)} placeholder={spec.targetField.default || "ALL"} />
                    </div>
                </>
            ) : (
                <div style={{ color: "var(--text-muted)", fontSize: "var(--text-callout-meta)", marginBottom: "var(--space-2)" }}>
                    Unrecognized trigger type — no editable fields.
                </div>
            )}
            {err && <div style={{ color: "var(--danger)", fontSize: "var(--text-callout-meta)", marginBottom: "var(--space-2)" }}>{err}</div>}
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
                <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
                <Button variant="primary" size="sm" onClick={save} disabled={saving || !spec}>{saving ? "Saving…" : "Save Changes"}</Button>
            </div>
        </Panel>
    )
}

function RuleRow({ rule, isInspecting, isEditing, onInspect, onEdit, onToggleEnabled, onDelete }) {
    return (
        <Panel
            onClick={() => onInspect(rule)}
            style={{
                marginBottom: "var(--space-2)", cursor: "pointer",
                background: "var(--bg-card-translucent)",
                outline: isInspecting || isEditing ? "1px solid var(--accent-blue)" : "none",
                outlineOffset: -1,
            }}
        >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-2)" }}>
                <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "var(--text-callout-title)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>
                        {rule.name}
                    </div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-callout-meta)", color: "var(--text-muted)", marginTop: 2 }}>
                        {rule.system_id} · {rule.trigger_type} · {rule.severity}
                    </div>
                    {!rule.wired && (
                        <div style={{ fontSize: "var(--text-callout-meta)", color: "var(--warn)", marginTop: 2 }}>
                            not wired into live detection — has no real effect
                        </div>
                    )}
                </div>
                <div style={{ display: "flex", gap: "var(--space-1)", flexShrink: 0 }}>
                    <button title="Edit" aria-label="Edit" style={iconBtnStyle} onClick={(e) => { e.stopPropagation(); onEdit(rule) }}>
                        <Icon name="edit" size={14} />
                    </button>
                    <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onToggleEnabled(rule) }}>{rule.enabled ? "Disable" : "Enable"}</Button>
                    <Button variant="danger" size="sm" onClick={(e) => { e.stopPropagation(); onDelete(rule) }}>Delete</Button>
                </div>
            </div>
        </Panel>
    )
}

// Real inspect view for a Detection Rule — the new default click target.
// Honest limitation (see sourcesLogic.js's matchAlertsToRule doc comment):
// GET /api/alerts has no rule_id filter and doesn't return raw_json (where
// a detector attaches rule_id), so there's no single real query for "alerts
// this rule fired." This checks the raw_json of a bounded recent window of
// active alerts (GET /api/alerts/{alert_id} per alert) and reports an
// honest "checked N recent alerts" caveat rather than ever fabricating a
// match.
const RULE_ALERT_CHECK_LIMIT = 20

function RuleInspectPanel({ rule, onClose }) {
    const [loading, setLoading] = useState(true)
    const [matches, setMatches] = useState([])
    const [checkedCount, setCheckedCount] = useState(0)
    const [error, setError] = useState(false)

    useEffect(() => {
        let cancelled = false
        setLoading(true); setError(false)
        fetch(`${API}/api/alerts?limit=${RULE_ALERT_CHECK_LIMIT}`)
            .then(r => r.ok ? r.json() : [])
            .then(async (list) => {
                if (cancelled) return
                const arr = Array.isArray(list) ? list : []
                setCheckedCount(arr.length)
                const details = await Promise.all(
                    arr.map(a => fetch(`${API}/api/alerts/${encodeURIComponent(a.alert_id)}`)
                        .then(r => r.ok ? r.json() : null).catch(() => null))
                )
                if (cancelled) return
                setMatches(matchAlertsToRule(details.filter(Boolean), rule.id))
                setLoading(false)
            })
            .catch(() => { if (!cancelled) { setError(true); setLoading(false) } })
        return () => { cancelled = true }
    }, [rule.id])

    return (
        <Panel elevation={2} style={{ marginBottom: "var(--space-3)", background: "var(--bg-panel-translucent)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "var(--space-2)" }}>
                <div>
                    <div style={{ fontSize: "var(--text-callout-title)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>
                        {rule.name}
                    </div>
                    <div style={{ fontSize: "var(--text-callout-meta)", color: "var(--text-muted)", marginTop: 2 }}>
                        Recently fired alerts
                    </div>
                </div>
                <button title="Close" aria-label="Close" style={iconBtnStyle} onClick={onClose}>
                    <Icon name="close" size={14} />
                </button>
            </div>

            {loading && (
                <div style={{ color: "var(--text-muted)", fontSize: "var(--text-callout-meta)", padding: "var(--space-2) 0" }}>
                    Checking recent alerts…
                </div>
            )}
            {!loading && error && (
                <div style={{ color: "var(--danger)", fontSize: "var(--text-callout-meta)" }}>Failed to load alerts.</div>
            )}
            {!loading && !error && matches.length === 0 && (
                <EmptyState
                    title="No fired alerts found"
                    description={`Checked the ${checkedCount} most recent active alerts — none matched this rule. GET /api/alerts has no rule filter, so this checks recent alerts individually rather than one direct query.`}
                />
            )}
            {!loading && !error && matches.length > 0 && (
                <div>
                    <div style={{ fontSize: "var(--text-callout-meta)", color: "var(--text-muted)", marginBottom: "var(--space-1)" }}>
                        {matches.length} match{matches.length !== 1 ? "es" : ""} in the {checkedCount} most recent active alerts
                    </div>
                    {matches.map(a => (
                        <div key={a.alert_id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--border)", fontSize: "var(--text-callout-meta)" }}>
                            <span style={{ color: "var(--text-primary)" }}>{a.title || a.alert_id}</span>
                            <span style={{ color: "var(--text-muted)" }}>{a.severity} · {timeAgoLabel(a.created_at)}</span>
                        </div>
                    ))}
                </div>
            )}
        </Panel>
    )
}

function RulesTab({ rules, reloadRules }) {
    const [inspectingRuleId, setInspectingRuleId] = useState(null)
    const [editingRuleId, setEditingRuleId] = useState(null)
    const [showRuleForm, setShowRuleForm] = useState(false)

    const inspectingRule = rules.find(r => r.id === inspectingRuleId) || null
    const editingRule = rules.find(r => r.id === editingRuleId) || null

    const toggleRuleEnabled = async (rule) => {
        await fetch(`${API}/api/rules/${rule.id}`, {
            method: "PUT", headers: forgeHeaders(), body: JSON.stringify({ enabled: !rule.enabled }),
        }).catch(() => {})
        reloadRules()
    }
    const deleteRule = async (rule) => {
        await fetch(`${API}/api/rules/${rule.id}`, { method: "DELETE", headers: forgeHeaders() }).catch(() => {})
        if (inspectingRuleId === rule.id) setInspectingRuleId(null)
        if (editingRuleId === rule.id) setEditingRuleId(null)
        reloadRules()
    }

    return (
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "var(--space-3)", overflowY: "auto", height: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-2)" }}>
                <div style={{ fontSize: "var(--text-section-head)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>
                    Detection Rules
                </div>
                <Button variant={showRuleForm ? "ghost" : "primary"} size="sm" onClick={() => setShowRuleForm(v => !v)}>
                    {showRuleForm ? "Cancel" : "+ New Rule"}
                </Button>
            </div>

            {showRuleForm && (
                <NewRuleForm onCancel={() => setShowRuleForm(false)} onCreated={() => { setShowRuleForm(false); reloadRules() }} />
            )}

            {editingRule && (
                <EditRuleForm
                    rule={editingRule}
                    onCancel={() => setEditingRuleId(null)}
                    onSaved={() => { setEditingRuleId(null); reloadRules() }}
                />
            )}

            {inspectingRule && !editingRule && (
                <RuleInspectPanel rule={inspectingRule} onClose={() => setInspectingRuleId(null)} />
            )}

            {rules.length === 0 ? (
                <EmptyState title="No detection rules yet" description="Create one of the 7 rule types currently wired into live detection." />
            ) : (
                rules.map(r => (
                    <RuleRow
                        key={r.id} rule={r}
                        isInspecting={inspectingRuleId === r.id}
                        isEditing={editingRuleId === r.id}
                        onInspect={(rule) => { setEditingRuleId(null); setInspectingRuleId(rule.id) }}
                        onEdit={(rule) => { setInspectingRuleId(null); setEditingRuleId(rule.id) }}
                        onToggleEnabled={toggleRuleEnabled}
                        onDelete={deleteRule}
                    />
                ))
            )}
        </div>
    )
}

// ── Status / Health ──────────────────────────────────────────────────────

function StatusDot({ color }) {
    return <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: color, flexShrink: 0 }} />
}

const SOURCE_STATUS_COLOR = { ok: "var(--live)", degraded: "var(--warn)", pending: "var(--text-muted)", error: "var(--danger)" }

function StatusHealthTab() {
    const [data, setData] = useState(null)
    const [loading, setLoading] = useState(true)

    const load = useCallback(() => {
        fetch(`${API}/api/health/detailed`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { setData(d); setLoading(false) })
            .catch(() => setLoading(false))
    }, [])

    useEffect(() => {
        load()
        const iv = setInterval(load, 30000)
        return () => clearInterval(iv)
    }, [load])

    const summary = summarizeHealth(data)
    const sources = data?.data_sources || []

    return (
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "var(--space-3)", overflowY: "auto", height: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
                <div style={{ fontSize: "var(--text-section-head)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>
                    Status / Health
                </div>
                <span style={{
                    display: "flex", alignItems: "center", gap: 6, marginLeft: "auto",
                    fontSize: "var(--text-callout-meta)", color: STATUS_COLOR_TOKEN[summary.status], fontWeight: "var(--weight-semibold)",
                }}>
                    <StatusDot color={STATUS_COLOR_TOKEN[summary.status]} />
                    {STATUS_WORD[summary.status]} — {summary.detail}
                </span>
            </div>

            {loading && !data && (
                <Loading label="Loading sources" />
            )}

            {!loading && sources.length === 0 && (
                <EmptyState title="No source health data" description="GET /api/health/detailed returned no data sources." />
            )}

            {sources.map(src => (
                <Panel key={src.id} style={{ marginBottom: "var(--space-2)", background: "var(--bg-card-translucent)" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-2)" }}>
                        <div style={{ marginTop: 5 }}><StatusDot color={SOURCE_STATUS_COLOR[src.status] || SOURCE_STATUS_COLOR.pending} /></div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: "var(--text-callout-title)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)" }}>
                                {src.name}{src.status_label && <span style={{ color: "var(--text-muted)", fontWeight: "var(--weight-normal)" }}> · {src.status_label}</span>}
                            </div>
                            <div style={{ fontSize: "var(--text-callout-meta)", color: "var(--text-secondary)", marginTop: 2 }}>
                                {src.type}
                                {src.record_count != null && src.record_count > 0 && ` · ${src.record_count.toLocaleString()} records`}
                                {src.event_count != null && src.event_count > 0 && ` · ${src.event_count.toLocaleString()} events`}
                                {src.feeds_ok != null && ` · ${src.feeds_ok}/${src.feeds_total} feeds`}
                                {src.vessel_count != null && src.vessel_count > 0 && ` · ${src.vessel_count.toLocaleString()} vessels`}
                            </div>
                            {src.message && (
                                <div style={{ fontSize: "var(--text-callout-meta)", color: "var(--warn)", marginTop: 2 }}>{src.message}</div>
                            )}
                        </div>
                        <div style={{ fontSize: "var(--text-callout-meta)", color: "var(--text-muted)", textAlign: "right", flexShrink: 0 }}>
                            {timeAgoLabel(src.last_fetch) || "never fetched"}
                            {src.failures > 0 && <div style={{ color: "var(--warn)" }}>{src.failures} err</div>}
                        </div>
                    </div>
                </Panel>
            ))}
        </div>
    )
}

// ── Ontology ─────────────────────────────────────────────────────────────

function OntologyTab() {
    return (
        <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
            <div style={{
                padding: "var(--space-2) var(--space-3)", fontSize: "var(--text-callout-meta)",
                color: "var(--text-muted)", borderBottom: "1px solid var(--border)", flexShrink: 0,
            }}>
                Live Operational Graph — the DB-backed entity/link graph (rules, watch zones, cables, alerts, fusion events), continuously populated from real AIS/ADS-B/cable/news feeds. Unreviewed by an analyst; distinct from ForgePanel's separate human-approval claims queue.
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
                <ForceGraph />
            </div>
        </div>
    )
}

// ── Root ─────────────────────────────────────────────────────────────────

export default function Sources() {
    const [tab, setTab] = useState("watchAreas")
    const [zones, setZones] = useState([])
    const [rules, setRules] = useState([])

    const reloadZones = () =>
        fetch(`${API}/api/watch-zones`).then(r => r.ok ? r.json() : []).then(d => setZones(Array.isArray(d) ? d : [])).catch(() => {})
    const reloadRules = () =>
        fetch(`${API}/api/rules`).then(r => r.ok ? r.json() : { rules: [] }).then(d => setRules(d.rules || [])).catch(() => {})

    useEffect(() => { reloadZones(); reloadRules() }, [])

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: "var(--font-sans)", background: "var(--bg-app)" }}>
            <div style={{
                display: "flex", alignItems: "center", gap: "var(--space-1)",
                padding: "var(--space-2) var(--space-3)", borderBottom: "1px solid var(--border)", flexShrink: 0,
            }}>
                <div style={{ fontSize: "var(--text-section-head)", fontWeight: "var(--weight-semibold)", color: "var(--text-primary)", marginRight: "var(--space-3)" }}>
                    Intel
                </div>
                {TABS.map(t => (
                    <Button key={t.key} variant="ghost" active={tab === t.key} size="sm" onClick={() => setTab(t.key)}>
                        {t.label}
                    </Button>
                ))}
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
                {tab === "watchAreas" && <WatchAreasTab zones={zones} reloadZones={reloadZones} />}
                {tab === "rules" && <RulesTab rules={rules} reloadRules={reloadRules} />}
                {tab === "health" && <StatusHealthTab />}
                {tab === "ontology" && <OntologyTab />}
            </div>
        </div>
    )
}
