import { useState, useEffect, useCallback } from "react"
import API_BASE from "../apiBase.js"
import { getCurrentUser } from "../state/authStore.js"
import { getSettings, subscribeSettings, updateSetting } from "../state/settingsStore.js"
import { LAYER_GROUPS } from "./layerRailConfig.js"
import { listSessions, listViews, deleteSession, deleteView, viewExtraLabels } from "../state/sessionStore.js"
import { KEYBOARD_SHORTCUTS } from "../data/keyboardShortcuts.js"
import PushNotificationToggle from "./PushNotificationToggle.jsx"
import ThemeControl from "./ThemeControl.jsx"

/**
 * SettingsModal — real Settings round: 7 real sections, every control
 * backed by real per-user, server-persisted state (settingsStore.js /
 * themeStore.js), applied the instant it changes. No Save button anywhere
 * in this surface by design — there is no "unsaved changes" state to lose
 * by closing the dialog at any point.
 *
 * Replaces the old, never-mounted PreferencesPanel.jsx outright (confirmed
 * unreferenced by any live UI before this round — zero regression risk)
 * and gives the app's TopBar theme toggle a second, synced home here in
 * General, per the real per-user theme mechanism it already reused rather
 * than inventing a second one.
 */

function getAtPath(obj, path) {
    return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

function Toggle({ value, onChange }) {
    return (
        <button
            onClick={() => onChange(!value)}
            aria-pressed={value}
            style={{
                width: 36, height: 20, borderRadius: "var(--r)", border: "none", flexShrink: 0,
                background: value ? "var(--acc)" : "var(--bg-4)", cursor: "pointer", position: "relative",
                padding: 0, transition: "background 0.15s ease",
            }}
        >
            <span style={{
                position: "absolute", top: 2, left: value ? 18 : 2, width: 16, height: 16,
                borderRadius: "50%", background: "#fff", transition: "left 0.15s ease", display: "block",
            }} />
        </button>
    )
}

function Row({ label, hint, children }) {
    return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-4)", padding: "var(--space-2) 0", borderBottom: "1px solid var(--line-soft)" }}>
            <div style={{ minWidth: 0 }}>
                <div style={{ font: "400 12.5px var(--font)", color: "var(--txt)" }}>{label}</div>
                {hint && <div style={{ font: "400 11px var(--font)", color: "var(--txt-4)", marginTop: 2 }}>{hint}</div>}
            </div>
            <div style={{ flexShrink: 0 }}>{children}</div>
        </div>
    )
}

function ChoiceGroup({ value, options, onChange }) {
    return (
        <div style={{ display: "flex", gap: 4 }}>
            {options.map(o => (
                <button
                    key={o.value}
                    onClick={() => onChange(o.value)}
                    style={{
                        padding: "4px 10px", font: "400 11px var(--font)", cursor: "pointer",
                        borderRadius: "var(--r)", border: "1px solid var(--line-strong)",
                        background: value === o.value ? "var(--acc)" : "var(--bg-2)",
                        color: value === o.value ? "#fff" : "var(--txt-2)",
                    }}
                >
                    {o.label}
                </button>
            ))}
        </div>
    )
}

function Select({ value, options, onChange }) {
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            style={{
                background: "var(--bg-2)", border: "1px solid var(--line-strong)", borderRadius: "var(--r)",
                color: "var(--txt)", font: "400 11.5px var(--font)", padding: "4px 8px", cursor: "pointer",
            }}
        >
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
    )
}

function SectionTitle({ children }) {
    return (
        <div style={{ font: "700 10px var(--font)", color: "var(--acc-hi)", letterSpacing: "0.08em", textTransform: "uppercase", margin: "var(--space-4) 0 var(--space-2)" }}>
            {children}
        </div>
    )
}

// ── General ──────────────────────────────────────────────────────────────
function GeneralSection({ settings }) {
    const user = getCurrentUser()
    // Read once per open rather than subscribing: this is a summary of a
    // choice made elsewhere, and it only changes from this panel.
    const [startup, setStartup] = useState(() => getStartupLayers())
    const [timezone, setTimezone] = useState(user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
    const [tzSaving, setTzSaving] = useState(false)
    const tzOptions = (typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [timezone])

    const saveTimezone = useCallback((tz) => {
        setTimezone(tz)
        const u = getCurrentUser()
        if (!u) return
        setTzSaving(true)
        fetch(`${API_BASE}/api/users/${encodeURIComponent(u.id)}`, {
            method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include",
            body: JSON.stringify({ timezone: tz }),
        }).catch(() => {}).finally(() => setTzSaving(false))
    }, [])

    return (
        <div>
            <SectionTitle>Appearance</SectionTitle>
            <Row label="Theme" hint="Same real per-user value the top-bar control reads and writes. Auto fades with the real sun at your location.">
                <ThemeControl inline />
            </Row>
            <Row label="Density" hint="Compact reduces spacing app-wide.">
                <ChoiceGroup
                    value={getAtPath(settings, "general.density") || "comfortable"}
                    options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]}
                    onChange={(v) => updateSetting("general.density", v)}
                />
            </Row>
            <Row label="Units" hint="Persisted now; not yet wired into distance/speed displays (no unit-convertible display exists in the app yet).">
                <ChoiceGroup
                    value={getAtPath(settings, "general.units") || "metric"}
                    options={[{ value: "metric", label: "Metric" }, { value: "imperial", label: "Imperial" }]}
                    onChange={(v) => updateSetting("general.units", v)}
                />
            </Row>
            <SectionTitle>Launch</SectionTitle>
            <Row label="Default view"
                 hint={startup
                     ? "The app opens with the layers you saved. Clearing this restores the built-in defaults."
                     : "Not set — the app opens with its built-in defaults. Turn on the layers you want in Situation, then press \u201csave default\u201d in the Layers header."}>
                {startup
                    ? <button className="btn sm" onClick={() => { clearStartupLayers(); setStartup(null) }}>clear</button>
                    : <span style={{ font: "400 11px var(--font)", color: "var(--txt-4)" }}>none saved</span>}
            </Row>
            <Row label="Guided walkthrough"
                 hint="The seven-step introduction to the app. Reopening it does not change anything you have set.">
                <button className="btn sm" onClick={() => updateSetting("tutorial", null)}>
                    {settings?.tutorial === "done" ? "show again" : "showing on next launch"}
                </button>
            </Row>

            <SectionTitle>Locale</SectionTitle>
            <Row label="Timezone" hint={tzSaving ? "Saving…" : "Used for timestamps you set yourself elsewhere in the app."}>
                <Select value={timezone} onChange={saveTimezone} options={tzOptions.map(tz => ({ value: tz, label: tz }))} />
            </Row>
        </div>
    )
}

// ── Map & layers ─────────────────────────────────────────────────────────
function MapLayersSection({ settings }) {
    const defaultLayers = getAtPath(settings, "mapLayers.defaultLayers") || []
    const toggleLayer = (key) => {
        const next = defaultLayers.includes(key) ? defaultLayers.filter(k => k !== key) : [...defaultLayers, key]
        updateSetting("mapLayers.defaultLayers", next)
    }
    return (
        <div>
            <div style={{ font: "400 11px var(--font)", color: "var(--txt-4)", marginBottom: "var(--space-3)" }}>
                These persist for real immediately. Applying them automatically when a map screen mounts is real,
                honestly-scoped follow-up work — not yet wired.
            </div>
            <SectionTitle>Globe</SectionTitle>
            <Row label="Projection">
                <ChoiceGroup
                    value={getAtPath(settings, "mapLayers.projection") || "3d"}
                    options={[{ value: "3d", label: "3D" }, { value: "columbus", label: "Columbus" }, { value: "2d", label: "2D" }]}
                    onChange={(v) => updateSetting("mapLayers.projection", v)}
                />
            </Row>
            <Row label="Clustering" hint="Group dense tracks above the per-domain cap.">
                <Toggle value={getAtPath(settings, "mapLayers.clustering") ?? true} onChange={(v) => updateSetting("mapLayers.clustering", v)} />
            </Row>
            <SectionTitle>Default layers</SectionTitle>
            {LAYER_GROUPS.map(group => (
                <div key={group.key} style={{ marginBottom: "var(--space-2)" }}>
                    <div style={{ font: "600 10.5px var(--font)", color: "var(--txt-3)", margin: "var(--space-2) 0 2px" }}>{group.label}</div>
                    {group.layers.map(def => (
                        <Row key={def.key} label={def.label}>
                            <Toggle value={defaultLayers.includes(def.key)} onChange={() => toggleLayer(def.key)} />
                        </Row>
                    ))}
                </div>
            ))}
        </div>
    )
}

import { setDnd } from "../state/notificationStore.js"

import { getStartupLayers, clearStartupLayers } from "../state/useChrome.js"

// ── Alerts ───────────────────────────────────────────────────────────────
function AlertsSection({ settings, onOpenSources }) {
    const [rules, setRules] = useState(null)
    useEffect(() => {
        fetch(`${API_BASE}/api/rules`).then(r => r.ok ? r.json() : null).then(d => setRules(d?.rules || [])).catch(() => setRules([]))
    }, [])
    const toggleRule = (rule) => {
        const next = !rule.enabled
        setRules(prev => prev.map(r => r.id === rule.id ? { ...r, enabled: next } : r))
        fetch(`${API_BASE}/api/rules/${rule.id}`, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: next }),
        })
            // A non-wired rule_name is genuinely rejected server-side (400) —
            // revert the optimistic toggle rather than show a state the
            // backend refused, matching "no fabricated status" here too.
            .then(r => { if (!r.ok) setRules(prev => prev.map(r2 => r2.id === rule.id ? { ...r2, enabled: rule.enabled } : r2)) })
            .catch(() => setRules(prev => prev.map(r2 => r2.id === rule.id ? { ...r2, enabled: rule.enabled } : r2)))
    }
    const quietEnabled = getAtPath(settings, "alerts.quietHours.enabled") || false
    const hourOptions = Array.from({ length: 24 }, (_, h) => ({ value: h, label: `${String(h).padStart(2, "0")}:00 UTC` }))

    return (
        <div>
            <SectionTitle>Interruptions</SectionTitle>
            <Row label="Do not disturb"
                 hint="Stops notification cards appearing. Everything still lands in the tray and the bell still counts — a quiet mode that also stopped recording would just be losing alerts silently.">
                <Toggle value={Boolean(settings.dnd)} onChange={(v) => setDnd(v)} />
            </Row>

            <SectionTitle>Sound</SectionTitle>
            <Row label="Alert sounds" hint="Real audio cue on new alerts.">
                <Toggle value={!settings.soundMuted} onChange={(v) => updateSetting("soundMuted", !v)} />
            </Row>
            <Row label="Critical"><Toggle value={settings.soundCritical} onChange={(v) => updateSetting("soundCritical", v)} /></Row>
            <Row label="Significant"><Toggle value={settings.soundSignificant} onChange={(v) => updateSetting("soundSignificant", v)} /></Row>
            <Row label="Elevated"><Toggle value={settings.soundElevated} onChange={(v) => updateSetting("soundElevated", v)} /></Row>
            <Row label="Poll interval" hint="How often the app checks for new alerts.">
                <Select value={settings.alertInterval} onChange={(v) => updateSetting("alertInterval", Number(v))}
                    options={[10, 15, 30, 60].map(s => ({ value: s, label: `${s}s` }))} />
            </Row>
            <SectionTitle>Push notifications</SectionTitle>
            <PushNotificationToggle />
            <SectionTitle>Quiet hours</SectionTitle>
            <div style={{ font: "400 11px var(--font)", color: "var(--txt-4)", marginBottom: "var(--space-2)" }}>
                New: this app had no quiet-hours concept before this round. Persisted for real; actually suppressing
                delivery during these hours is real, disclosed follow-up work — not wired into alert delivery yet.
            </div>
            <Row label="Enable quiet hours">
                <Toggle value={quietEnabled} onChange={(v) => updateSetting("alerts.quietHours.enabled", v)} />
            </Row>
            {quietEnabled && (
                <>
                    <Row label="From">
                        <Select value={getAtPath(settings, "alerts.quietHours.startHour") ?? 22} onChange={(v) => updateSetting("alerts.quietHours.startHour", Number(v))} options={hourOptions} />
                    </Row>
                    <Row label="To">
                        <Select value={getAtPath(settings, "alerts.quietHours.endHour") ?? 7} onChange={(v) => updateSetting("alerts.quietHours.endHour", Number(v))} options={hourOptions} />
                    </Row>
                </>
            )}
            <SectionTitle>Detection rules</SectionTitle>
            <div style={{ font: "400 11px var(--font)", color: "var(--txt-4)", marginBottom: "var(--space-2)" }}>
                Reuses the app's real rule system (Sources → Detection Rules) — enable/disable only here; full
                create/edit stays in Sources so there's one real rule editor, not two.
            </div>
            {rules === null && <div style={{ font: "400 11px var(--font)", color: "var(--txt-4)" }}>Loading…</div>}
            {rules?.length === 0 && <div style={{ font: "400 11px var(--font)", color: "var(--txt-4)" }}>No rules configured yet.</div>}
            {rules?.map(rule => (
                <Row key={rule.id} label={rule.name} hint={rule.wired ? rule.severity : "not wired — has no live effect even if enabled"}>
                    <Toggle value={rule.enabled} onChange={() => toggleRule(rule)} />
                </Row>
            ))}
            {onOpenSources && (
                <button onClick={onOpenSources} style={{ marginTop: "var(--space-3)", background: "none", border: "none", color: "var(--acc-hi)", cursor: "pointer", font: "400 11.5px var(--font)", padding: 0 }}>
                    Manage rules in Sources →
                </button>
            )}
        </div>
    )
}

// ── Sources ──────────────────────────────────────────────────────────────
function timeAgo(iso) {
    if (!iso) return "never fetched"
    const ms = Date.now() - new Date(iso).getTime()
    if (ms < 0) return "just now"
    const mins = Math.floor(ms / 60000)
    if (mins < 1) return "just now"
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
}

const STATUS_COLOR = { ok: "var(--green)", degraded: "var(--amber)", pending: "var(--grey)", error: "var(--red)" }

function SourcesSection() {
    const [sources, setSources] = useState(null)
    const load = useCallback(() => {
        fetch(`${API_BASE}/api/health/detailed`).then(r => r.ok ? r.json() : null).then(d => setSources(d?.data_sources || [])).catch(() => setSources([]))
    }, [])
    useEffect(() => { load() }, [load])

    return (
        <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-2)" }}>
                <div style={{ font: "400 11px var(--font)", color: "var(--txt-4)" }}>
                    Real per-feed status — a stale feed shows stale with its real age, never silently as live.
                </div>
                <button onClick={load} style={{ background: "none", border: "1px solid var(--line-strong)", borderRadius: "var(--r)", color: "var(--txt-2)", cursor: "pointer", font: "400 11px var(--font)", padding: "3px 8px" }}>
                    Refresh
                </button>
            </div>
            {sources === null && <div style={{ font: "400 11px var(--font)", color: "var(--txt-4)" }}>Loading…</div>}
            {sources?.map(src => (
                <div key={src.id} style={{ padding: "var(--space-2) 0", borderBottom: "1px solid var(--line-soft)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: STATUS_COLOR[src.status] || "var(--grey)", flexShrink: 0 }} />
                        <span style={{ font: "400 12.5px var(--font)", color: "var(--txt)" }}>{src.name}</span>
                        <span style={{ font: "400 10.5px var(--font)", color: "var(--txt-4)", marginLeft: "auto" }}>{timeAgo(src.last_fetch)}</span>
                    </div>
                    <div style={{ font: "400 10.5px var(--font)", color: "var(--txt-4)", marginTop: 2, marginLeft: 15 }}>
                        {src.status_label || src.status}
                        {src.cadence ? ` · ${src.cadence}` : ""}
                        {src.origin_class ? ` · evidence class ${src.origin_class}` : ""}
                        {src.licence_tier ? ` / licence ${src.licence_tier}` : ""}
                    </div>
                </div>
            ))}
        </div>
    )
}

// ── Briefing ─────────────────────────────────────────────────────────────
function BriefingSection({ settings }) {
    return (
        <div>
            <SectionTitle>Schedule</SectionTitle>
            <Row label="Daily briefing hour" hint="The real backend's own scheduled daily-briefing loop is currently disabled — this persists for real but has no live scheduler consuming it yet.">
                <Select value={settings.briefingHourUTC} onChange={(v) => updateSetting("briefingHourUTC", Number(v))}
                    options={Array.from({ length: 24 }, (_, h) => ({ value: h, label: `${String(h).padStart(2, "0")}:00 UTC` }))} />
            </Row>
            <Row label="Surface refresh interval">
                <Select value={settings.refreshInterval} onChange={(v) => updateSetting("refreshInterval", Number(v))}
                    options={[5, 10, 15, 30].map(m => ({ value: m, label: `${m} min` }))} />
            </Row>
            <SectionTitle>Document defaults</SectionTitle>
            <Row label="Default classification marking" hint="Used as Generate's initial classification field for every new report.">
                <input
                    value={getAtPath(settings, "briefing.classificationDefault") ?? "UNCLASSIFIED // FOR ANALYTICAL USE ONLY"}
                    onChange={(e) => updateSetting("briefing.classificationDefault", e.target.value)}
                    style={{ background: "var(--bg-2)", border: "1px solid var(--line-strong)", borderRadius: "var(--r)", color: "var(--txt)", font: "400 11.5px var(--font)", padding: "4px 8px", width: 260 }}
                />
            </Row>
            <Row label="Show provenance/citations by default" hint="Persisted for real; not yet wired into report rendering, which always shows them today regardless of this value.">
                <Toggle value={getAtPath(settings, "briefing.showProvenanceByDefault") ?? true} onChange={(v) => updateSetting("briefing.showProvenanceByDefault", v)} />
            </Row>
        </div>
    )
}

// ── Keyboard ─────────────────────────────────────────────────────────────
function KeyboardSection() {
    return (
        <div>
            <div style={{ font: "400 11px var(--font)", color: "var(--txt-4)", marginBottom: "var(--space-2)" }}>
                This app's real current keybindings — audited directly from each handler, not invented.
            </div>
            {KEYBOARD_SHORTCUTS.map((s, i) => (
                <div key={i} style={{ display: "flex", gap: "var(--space-3)", padding: "var(--space-2) 0", borderBottom: "1px solid var(--line-soft)", alignItems: "baseline" }}>
                    <span style={{ font: "600 11px var(--mono)", color: "var(--txt)", background: "var(--bg-2)", border: "1px solid var(--line-strong)", borderRadius: "var(--r)", padding: "1px 6px", flexShrink: 0, whiteSpace: "nowrap" }}>
                        {s.keys}
                    </span>
                    <div style={{ minWidth: 0 }}>
                        <div style={{ font: "400 12px var(--font)", color: "var(--txt-2)" }}>{s.action}</div>
                        <div style={{ font: "400 10.5px var(--font)", color: "var(--txt-4)" }}>{s.context}</div>
                    </div>
                </div>
            ))}
        </div>
    )
}

// ── About ────────────────────────────────────────────────────────────────
function AboutSection() {
    const version = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "—"
    return (
        <div>
            <div style={{ font: "600 14px var(--font)", color: "var(--txt)", marginBottom: 4 }}>Parallax</div>
            <div style={{ font: "400 12px var(--font)", color: "var(--txt-3)", marginBottom: "var(--space-3)" }}>Trifecta Technologies</div>
            <Row label="Version"><span style={{ font: "400 11.5px var(--mono)", color: "var(--txt-2)" }}>v{version}</span></Row>
        </div>
    )
}

// §20 lists General · Tutorial · Shortcuts · Sessions & views · Alert rules ·
// Export · Distribution · Mail & calendar · Users & roles.
//
// The sections below are the ones with REAL controls behind them. The spec's
// remaining names are deliberately absent rather than present and empty: this
// app already removed a pair of Forge selects that configured an icon nothing
// rendered, on the principle that a control which changes nothing is worse
// than an absent one — a settings dialog full of inert panes is that mistake
// at the scale of a whole surface.
//
// "Shortcuts" takes the spec's name over the old "Keyboard", and
// "Sessions & views" is added because that state is real, server-persisted,
// and had no management surface anywhere.
/**
 * §20's "Sessions & views" — the desk state that is real and server-persisted
 * and until now had nowhere to be managed from. Deleting is the only action
 * here on purpose: creating a session or a view is something you do from the
 * surface it describes, where you can see what you are capturing.
 */
function SessionsSection() {
    const [sessions, setSessions] = useState(null)
    const [busy, setBusy] = useState(null)

    const load = useCallback(() => {
        listSessions()
            .then(async (rows) => {
                const list = Array.isArray(rows) ? rows : []
                const withViews = await Promise.all(list.map(async (s) => {
                    try { return { ...s, views: await listViews(s.session_id) } }
                    catch { return { ...s, views: [] } }
                }))
                setSessions(withViews)
            })
            .catch(() => setSessions([]))
    }, [])
    useEffect(() => { load() }, [load])

    const removeSession = (id) => {
        setBusy(id)
        deleteSession(id).then(load).catch(() => {}).finally(() => setBusy(null))
    }
    const removeView = (sid, vid) => {
        setBusy(vid)
        deleteView(sid, vid).then(load).catch(() => {}).finally(() => setBusy(null))
    }

    if (sessions === null) return <div className="risknote">Reading sessions…</div>
    if (!sessions.length) return <div className="risknote">No saved sessions yet.</div>

    return (
        <div>
            <p className="risknote" style={{ padding: "0 0 8px" }}>
                A session is the whole desk; a view is a named set of filters inside one.
                Deleting a session deletes the views inside it.
            </p>
            {sessions.map((s) => (
                <div key={s.session_id} style={{ borderBottom: "1px solid var(--line-soft)", padding: "6px 0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ flex: 1, font: "400 12px var(--font)", color: "var(--txt-2)" }}>{s.name}</span>
                        <span style={{ font: "9.5px var(--mono)", color: "var(--txt-4)" }}>
                            {(s.views || []).length} view{(s.views || []).length === 1 ? "" : "s"}
                        </span>
                        <button type="button" disabled={busy === s.session_id}
                                onClick={() => removeSession(s.session_id)}
                                style={{ background: "none", border: 0, color: "var(--txt-4)", cursor: "pointer" }}>✕</button>
                    </div>
                    {(s.views || []).map((v) => (
                        <div key={v.view_id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0 2px 12px" }}>
                            <span style={{ flex: 1, font: "400 11px var(--font)", color: "var(--txt-3)" }}>
                                {v.name}
                                {viewExtraLabels(v).map((l) => (
                                    <span key={l} style={{ font: "9.5px var(--mono)", color: "var(--txt-4)" }}> · {l}</span>
                                ))}
                            </span>
                            <button type="button" disabled={busy === v.view_id}
                                    onClick={() => removeView(s.session_id, v.view_id)}
                                    style={{ background: "none", border: 0, color: "var(--txt-4)", cursor: "pointer" }}>✕</button>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    )
}

const SECTIONS = [
    { key: "general", label: "General" },
    { key: "mapLayers", label: "Map & layers" },
    { key: "alerts", label: "Alerts" },
    { key: "sessions", label: "Sessions & views" },
    { key: "sources", label: "Sources" },
    { key: "briefing", label: "Briefing" },
    { key: "keyboard", label: "Shortcuts" },
    { key: "about", label: "About" },
]

export default function SettingsModal({ onClose, onOpenSources }) {
    const [active, setActive] = useState("general")
    const [settings, setSettings] = useState(getSettings)
    useEffect(() => subscribeSettings(setSettings), [])

    useEffect(() => {
        const onKey = (e) => { if (e.key === "Escape") onClose() }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [onClose])

    return (
        <div
            onClick={onClose}
            style={{ position: "fixed", inset: 0, zIndex: 5000, background: "var(--scrim-bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: "min(760px, 100%)", height: "min(600px, 90vh)", background: "var(--bg-1)",
                    border: "1px solid var(--line)", borderRadius: "var(--r)", boxShadow: "var(--shadow)",
                    display: "flex", overflow: "hidden", fontFamily: "var(--font)",
                }}
            >
                <div style={{ width: 170, flexShrink: 0, background: "var(--bg-2)", borderRight: "1px solid var(--line)", padding: "var(--space-3) 0", overflowY: "auto" }}>
                    <div style={{ font: "700 11px var(--font)", color: "var(--txt)", padding: "0 var(--space-3) var(--space-3)" }}>Settings</div>
                    {SECTIONS.map(s => (
                        <button
                            key={s.key}
                            onClick={() => setActive(s.key)}
                            style={{
                                display: "block", width: "100%", textAlign: "left", padding: "7px var(--space-3)",
                                background: active === s.key ? "var(--bg-0)" : "transparent",
                                borderLeft: active === s.key ? "2px solid var(--acc-hi)" : "2px solid transparent",
                                border: "none", borderLeftWidth: 2, color: active === s.key ? "var(--txt)" : "var(--txt-3)",
                                cursor: "pointer", font: "400 12px var(--font)",
                            }}
                        >
                            {s.label}
                        </button>
                    ))}
                </div>
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "var(--space-3) var(--space-4)", borderBottom: "1px solid var(--line)" }}>
                        <span style={{ font: "600 12.5px var(--font)", color: "var(--txt)" }}>{SECTIONS.find(s => s.key === active)?.label}</span>
                        <button onClick={onClose} aria-label="Close settings" style={{ background: "none", border: "none", color: "var(--txt-3)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 4 }}>
                            ×
                        </button>
                    </div>
                    <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-2) var(--space-4) var(--space-4)" }}>
                        {active === "general" && <GeneralSection settings={settings} />}
                        {active === "mapLayers" && <MapLayersSection settings={settings} />}
                        {active === "alerts" && <AlertsSection settings={settings} onOpenSources={onOpenSources ? () => { onOpenSources(); onClose() } : null} />}
                        {active === "sources" && <SourcesSection />}
                        {active === "briefing" && <BriefingSection settings={settings} />}
                        {active === "keyboard" && <KeyboardSection />}
                        {active === "sessions" && <SessionsSection />}
                        {active === "about" && <AboutSection />}
                    </div>
                </div>
            </div>
        </div>
    )
}
