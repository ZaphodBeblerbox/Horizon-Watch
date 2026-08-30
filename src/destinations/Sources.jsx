/**
 * Sources.jsx — one of the 5 fixed top-level destinations (full UI rebuild
 * spec). Self-contained: fetches/mutates all its own real data against the
 * real backend endpoints; not wired into app.jsx by this file.
 *
 * Absorbs the Watch Area (WatchZone) and Detection Rule (RuleConfig) CRUD
 * that today lives inside ForgePanel.jsx's ~6700-line file — adapted from
 * that file's existing CreateZoneModal/RulesPanel logic (real field names,
 * real endpoints), not a re-guess at the API shape. ForgePanel.jsx itself is
 * untouched by this change; someone else does that extraction/deletion.
 *
 * Real endpoints used:
 *   GET/POST     /api/watch-zones
 *   PUT/DELETE   /api/watch-zones/{system_id}
 *   GET/POST     /api/rules
 *   PUT/DELETE   /api/rules/{id}
 *
 * Skipped sub-feature (per the round's ground rules — an honest skip, not a
 * fabrication): a standing-collection/PIR-deck list. Searched backend/main.py
 * and backend/database.py for "PIR"/"collection_gap"/standing-collection —
 * no real backing model or endpoint exists for this concept anywhere in the
 * codebase, so it is not built here.
 */
import { useEffect, useMemo, useState } from "react"
import API_BASE from "../apiBase.js"
import { Button, Panel, EmptyState } from "../ui/index.js"
import Icon from "../ui/Icon.jsx"
import AoiMiniMap from "./AoiMiniMap.jsx"
import {
    RULE_TRIGGER_TYPES, TRIGGER_FIELD_SPECS,
    validateRuleForm, buildRulePayload, boundsToPolygon,
} from "./sourcesLogic.js"

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

const PRIORITY_COLOR = { critical: "var(--danger)", high: "var(--warn)", medium: "var(--warn)", low: "var(--live)" }

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
        <Panel elevated style={{ marginBottom: "var(--space-3)" }}>
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

function WatchAreaRow({ zone, onToggleEnabled, onDelete }) {
    return (
        <Panel style={{ marginBottom: "var(--space-2)", borderLeft: `3px solid ${PRIORITY_COLOR[zone.priority] || "var(--warn)"}` }}>
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
                    <Button variant="ghost" size="sm" onClick={() => onToggleEnabled(zone)}>{zone.enabled ? "Disable" : "Enable"}</Button>
                    <Button variant="danger" size="sm" onClick={() => onDelete(zone)}>Delete</Button>
                </div>
            </div>
        </Panel>
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
        <Panel elevated style={{ marginBottom: "var(--space-3)" }}>
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

function RuleRow({ rule, onToggleEnabled, onDelete }) {
    return (
        <Panel style={{ marginBottom: "var(--space-2)", borderLeft: `3px solid ${PRIORITY_COLOR[rule.severity] || "var(--warn)"}` }}>
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
                    <Button variant="ghost" size="sm" onClick={() => onToggleEnabled(rule)}>{rule.enabled ? "Disable" : "Enable"}</Button>
                    <Button variant="danger" size="sm" onClick={() => onDelete(rule)}>Delete</Button>
                </div>
            </div>
        </Panel>
    )
}

// ── Root ─────────────────────────────────────────────────────────────────

export default function Sources() {
    const [zones, setZones] = useState([])
    const [rules, setRules] = useState([])
    const [selectedZoneId, setSelectedZoneId] = useState(null)
    const [drawActive, setDrawActive] = useState(false)
    const [drawnBounds, setDrawnBounds] = useState(null)
    const [showRuleForm, setShowRuleForm] = useState(false)

    const reloadZones = () =>
        fetch(`${API}/api/watch-zones`).then(r => r.ok ? r.json() : []).then(d => setZones(Array.isArray(d) ? d : [])).catch(() => {})
    const reloadRules = () =>
        fetch(`${API}/api/rules`).then(r => r.ok ? r.json() : { rules: [] }).then(d => setRules(d.rules || [])).catch(() => {})

    useEffect(() => { reloadZones(); reloadRules() }, [])

    const toggleZoneEnabled = async (zone) => {
        await fetch(`${API}/api/watch-zones/${zone.system_id}`, {
            method: "PUT", headers: forgeHeaders(), body: JSON.stringify({ enabled: !zone.enabled }),
        }).catch(() => {})
        reloadZones()
    }
    const deleteZone = async (zone) => {
        await fetch(`${API}/api/watch-zones/${zone.system_id}`, { method: "DELETE", headers: forgeHeaders() }).catch(() => {})
        reloadZones()
    }
    const toggleRuleEnabled = async (rule) => {
        await fetch(`${API}/api/rules/${rule.id}`, {
            method: "PUT", headers: forgeHeaders(), body: JSON.stringify({ enabled: !rule.enabled }),
        }).catch(() => {})
        reloadRules()
    }
    const deleteRule = async (rule) => {
        await fetch(`${API}/api/rules/${rule.id}`, { method: "DELETE", headers: forgeHeaders() }).catch(() => {})
        reloadRules()
    }

    return (
        <div style={{ display: "flex", height: "100%", fontFamily: "var(--font-sans)" }}>
            {/* Main — collection coverage map */}
            <div style={{ flex: 2, minWidth: 0, borderRight: "1px solid var(--border)" }}>
                <AoiMiniMap
                    zones={zones}
                    selectedZoneId={selectedZoneId}
                    onSelectZone={setSelectedZoneId}
                    drawActive={drawActive}
                    onDrawComplete={(bounds) => { setDrawnBounds(bounds); setDrawActive(false) }}
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

                {zones.length === 0 ? (
                    <EmptyState title="No watch areas yet" description="Draw a rectangle on the map to create one." />
                ) : (
                    zones.map(z => (
                        <WatchAreaRow key={z.system_id} zone={z} onToggleEnabled={toggleZoneEnabled} onDelete={deleteZone} />
                    ))
                )}

                <div style={{ height: 1, background: "var(--border)", margin: "var(--space-3) 0" }} />

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

                {rules.length === 0 ? (
                    <EmptyState title="No detection rules yet" description="Create one of the 7 rule types currently wired into live detection." />
                ) : (
                    rules.map(r => (
                        <RuleRow key={r.id} rule={r} onToggleEnabled={toggleRuleEnabled} onDelete={deleteRule} />
                    ))
                )}
            </div>
        </div>
    )
}
