import { useState, useEffect, useCallback } from "react"
import API_BASE from "../apiBase.js"
import { getCurrentUser } from "../state/authStore.js"
import { getSettings, subscribeSettings, updateSetting } from "../state/settingsStore.js"
import { listSessions, listViews, deleteSession, deleteView, viewExtraLabels } from "../state/sessionStore.js"
import { KEYBOARD_SHORTCUTS } from "../data/keyboardShortcuts.js"
import PlacePicker from "../search/PlacePicker.jsx"
import InterestsEditor from "./InterestsEditor.jsx"
import { useFreshness } from "./Freshness.jsx"
import { getManualLocation, setManualLocation } from "../state/themeStore.js"
import ThemeControl from "./ThemeControl.jsx"

/**
 * settingsSections.jsx — the sections of the Settings page
 * (destinations/Settings.jsx), and the small controls they share. Was the
 * Settings dialog; the dialog is gone, the page shows these.
 *
 * Originally: real Settings round: 7 real sections, every control
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

export function Toggle({ value, onChange }) {
    return (
        <button
            onClick={() => onChange(!value)}
            aria-pressed={value}
            style={{
                width: 36, height: 20, borderRadius: 10, border: "1px solid var(--gline2)", flexShrink: 0,
                background: value ? "var(--acchi)" : "var(--hov)", cursor: "pointer", position: "relative",
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

export function Row({ label, hint, children }) {
    return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, padding: "10px 0", borderBottom: "1px solid var(--gline)" }}>
            <div style={{ minWidth: 0, maxWidth: 640 }}>
                <div style={{ fontSize: 14, color: "var(--txt)" }}>{label}</div>
                {hint && <div style={{ fontSize: 12, color: "var(--txt3)", marginTop: 3, lineHeight: 1.45 }}>{hint}</div>}
            </div>
            <div style={{ flexShrink: 0 }}>{children}</div>
        </div>
    )
}

export function ChoiceGroup({ value, options, onChange }) {
    return (
        <div style={{ display: "flex", gap: 4 }}>
            {options.map(o => (
                <button
                    key={o.value}
                    onClick={() => onChange(o.value)}
                    style={{
                        height: 28, padding: "0 12px", font: "inherit", fontSize: 12.5, cursor: "pointer",
                        borderRadius: 0, border: `1px solid ${value === o.value ? "var(--acchi)" : "var(--gline2)"}`,
                        background: value === o.value ? "var(--accdim)" : "transparent",
                        color: value === o.value ? "var(--txt)" : "var(--txt2)",
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
                background: "var(--glass2)", border: "1px solid var(--gline2)", borderRadius: 0,
                color: "var(--txt)", font: "inherit", fontSize: 12.5, height: 30, padding: "0 8px", cursor: "pointer",
            }}
        >
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
    )
}

export function SectionTitle({ children }) {
    return (
        <div style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--txt4)", margin: "22px 0 4px" }}>
            {children}
        </div>
    )
}

// ── General ──────────────────────────────────────────────────────────────

/**
 * Where the day/night cycle thinks you are.
 *
 * Auto theme needs a latitude to know how long the day is, and the desktop
 * build cannot ask: the WKWebView never surfaces a geolocation prompt. The
 * fallback derives longitude from the system clock — which is exact, the
 * earth turns fifteen degrees an hour — and then guesses 40 degrees north
 * for latitude. That guess is why sunrise can be hours out in Oslo or
 * Nairobi, and this is the control that replaces it.
 *
 * Longitude is prefilled from the clock because it is already right; the
 * number worth setting is the latitude.
 */
function DayCycleLocation() {
    // NAME THE PLACE. This asked for latitude and longitude; nobody has
    // their own to hand. Pick your city (the search box's suggestions), or
    // let the browser say where you are — the desktop build cannot, which
    // is why the name is the first option, not the second.
    const [saved, setSaved] = useState(() => getManualLocation())
    const [note, setNote] = useState(null)
    const set = (loc) => {
        setManualLocation(loc)
        setSaved({ ...loc })
        setNote("Saved — the day/night cycle is using it now.")
    }
    const useDevice = () => {
        if (!navigator.geolocation) { setNote("This app cannot read your device's location here — name your city instead."); return }
        setNote("Asking your device…")
        navigator.geolocation.getCurrentPosition(
            (p) => set({ lat: +p.coords.latitude.toFixed(2), lon: +p.coords.longitude.toFixed(2), label: "your device's location" }),
            () => setNote("Your device did not share a location — name your city instead."),
            { timeout: 8000, maximumAge: 3_600_000 },
        )
    }
    const clear = () => {
        setManualLocation(null)
        setSaved(null)
        setNote("Cleared — the cycle uses your clock's time zone again.")
    }
    const btn = {
        background: "none", border: "1px solid var(--gline2)", borderRadius: "var(--r)",
        color: "var(--txt2)", font: "400 11px var(--font)", padding: "4px 8px", cursor: "pointer", whiteSpace: "nowrap",
    }
    return (
        <div style={{ padding: "var(--space-2) 0", borderBottom: "1px solid var(--gline)" }}>
            <div style={{ font: "400 12.5px var(--font)", color: "var(--txt)" }}>Where you are, for the day/night cycle</div>
            <div style={{ font: "400 11px var(--font)", color: "var(--txt4)", marginTop: 2, lineHeight: 1.5 }}>
                {saved
                    ? `Set to ${saved.label || `${saved.lat}°, ${saved.lon}°`}.`
                    : "Not set — the time of sunrise and sunset is estimated from your clock, and can be hours out far from mid-northern latitudes."}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <PlacePicker label="Your city" placeholder="Your city — Berlin, Nairobi, Oslo…"
                                 onPick={(p) => set({ lat: +Number(p.lat).toFixed(2), lon: +Number(p.lon).toFixed(2), label: p.label })} />
                </div>
                <button style={btn} onClick={useDevice}>Use my location</button>
                {saved && <button style={btn} onClick={clear}>Clear</button>}
            </div>
            {note && <div style={{ font: "400 11px var(--font)", color: "var(--txt3)", marginTop: 6 }}>{note}</div>}
        </div>
    )
}

export function GeneralSection({ settings }) {
    const user = getCurrentUser()
    const [timezone, setTimezone] = useState(user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
    const [tzSaving, setTzSaving] = useState(false)
    // "UTC" is not in Intl's list, so an account set to UTC — the default —
    // showed the list's first entry, Africa/Abidjan.
    const tzOptions = ["UTC", ...(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [timezone]).filter((z) => z !== "UTC")]

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
            <Row label="Theme" hint="Auto follows daylight where you are.">
                <ThemeControl inline />
            </Row>
            <DayCycleLocation />
            <Row label="Density" hint="Compact reduces spacing app-wide.">
                <ChoiceGroup
                    value={getAtPath(settings, "general.density") || "comfortable"}
                    options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]}
                    onChange={(v) => updateSetting("general.density", v)}
                />
            </Row>
            <SectionTitle>Launch</SectionTitle>
            <Row label="Guided walkthrough"
                 hint="The short introduction to the app. Reopening it does not change anything you have set.">
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
export function MapLayersSection({ settings }) {
    return (
        <div>
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
            {/* ONE DEFAULT. This section listed its own layer toggles under
                "mapLayers.defaultLayers", a setting nothing read — while the
                real launch layers (the ones the Layers pane's "save default"
                writes and the map applies at start) were tucked under
                General. The real editor lives here now; theaters still carry
                their own layers, applied when one is selected. */}
            <SectionTitle>Default layers</SectionTitle>
            <div style={{ font: "400 11px var(--font)", color: "var(--txt4)", marginBottom: "var(--space-2)" }}>
                What the map opens with. Also settable from the map: Layers → "save default".
                Each theater can switch its own set on when you select it (edit the theater).
            </div>
            <div style={{ padding: "4px 0 2px" }}>
                <StartupLayersEditor />
            </div>
        </div>
    )
}

import { setDnd } from "../state/notificationStore.js"

import StartupLayersEditor from "./StartupLayersEditor.jsx"
import Loading from "../ui/Loading.jsx"

// ── Alerts ───────────────────────────────────────────────────────────────
export function AlertsSection({ settings, onOpenSources }) {
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
            <SectionTitle>Detection rules</SectionTitle>
            <div style={{ font: "400 11px var(--font)", color: "var(--txt4)", marginBottom: "var(--space-2)" }}>
                Turn detection rules on or off. Create and edit them in Sources.
            </div>
            {rules === null && <Loading size={18} inline label="Loading" />}
            {rules?.length === 0 && <div style={{ font: "400 11px var(--font)", color: "var(--txt4)" }}>No rules configured yet.</div>}
            {/* Only rules that do something: an unwired rule's switch changed nothing. */}
            {rules?.filter((rule) => rule.wired).map(rule => (
                <Row key={rule.id} label={rule.name} hint={rule.severity}>
                    <Toggle value={rule.enabled} onChange={() => toggleRule(rule)} />
                </Row>
            ))}
            {onOpenSources && (
                <button onClick={onOpenSources} style={{ marginTop: "var(--space-3)", background: "none", border: "none", color: "var(--acchi)", cursor: "pointer", font: "400 11.5px var(--font)", padding: 0 }}>
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

/**
 * The connection itself, stated in full.
 *
 * This used to be a sentence in the top bar. A strip you glance at is the
 * wrong place for "Server unreachable · showing data from 14:32Z · 2h ago",
 * so the top bar keeps a dot and the sentence lives here, next to the
 * per-feed status it belongs with.
 */
function ConnectionHealth() {
    const s = useFreshness(null)
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 9,
                      padding: "var(--space-2) 0 var(--space-3)",
                      borderBottom: "1px solid var(--gline)", marginBottom: "var(--space-3)" }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: s.dot, flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
                <div style={{ font: "600 12.5px var(--font)", color: "var(--txt)" }}>{s.word}</div>
                <div style={{ font: "400 10.5px var(--font)", color: "var(--txt4)", marginTop: 2 }}>{s.text}</div>
            </div>
        </div>
    )
}

export function SourcesSection() {
    const [sources, setSources] = useState(null)
    const load = useCallback(() => {
        fetch(`${API_BASE}/api/health/detailed`).then(r => r.ok ? r.json() : null).then(d => setSources(d?.data_sources || [])).catch(() => setSources([]))
    }, [])
    useEffect(() => { load() }, [load])

    return (
        <div>
            <ConnectionHealth />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-2)" }}>
                <div style={{ font: "400 11px var(--font)", color: "var(--txt4)" }}>
                    Real per-feed status — a stale feed shows stale with its real age, never silently as live.
                </div>
                <button onClick={load} style={{ background: "none", border: "1px solid var(--gline2)", borderRadius: "var(--r)", color: "var(--txt2)", cursor: "pointer", font: "400 11px var(--font)", padding: "3px 8px" }}>
                    Refresh
                </button>
            </div>
            {sources === null && <Loading size={18} inline label="Loading" />}
            {sources?.map(src => (
                <div key={src.id} style={{ padding: "var(--space-2) 0", borderBottom: "1px solid var(--gline)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ width: 7, height: 7, borderRadius: "50%", background: STATUS_COLOR[src.status] || "var(--grey)", flexShrink: 0 }} />
                        <span style={{ font: "400 12.5px var(--font)", color: "var(--txt)" }}>{src.name}</span>
                        <span style={{ font: "400 10.5px var(--font)", color: "var(--txt4)", marginLeft: "auto" }}>{timeAgo(src.last_fetch)}</span>
                    </div>
                    <div style={{ font: "400 10.5px var(--font)", color: "var(--txt4)", marginTop: 2, marginLeft: 15 }}>
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
export function BriefingSection({ settings }) {
    return (
        <div>
            <SectionTitle>Refresh</SectionTitle>
            <Row label="Surface refresh interval">
                <Select value={settings.refreshInterval} onChange={(v) => updateSetting("refreshInterval", Number(v))}
                    options={[5, 10, 15, 30].map(m => ({ value: m, label: `${m} min` }))} />
            </Row>
            <SectionTitle>Document defaults</SectionTitle>
            <Row label="Default classification marking" hint="Used as Generate's initial classification field for every new report.">
                <input
                    value={getAtPath(settings, "briefing.classificationDefault") ?? "UNCLASSIFIED // FOR ANALYTICAL USE ONLY"}
                    onChange={(e) => updateSetting("briefing.classificationDefault", e.target.value)}
                    style={{ background: "var(--glass2)", border: "1px solid var(--gline2)", borderRadius: "var(--r)", color: "var(--txt)", font: "400 11.5px var(--font)", padding: "4px 8px", width: 260 }}
                />
            </Row>
        </div>
    )
}

// ── Keyboard ─────────────────────────────────────────────────────────────
export function KeyboardSection() {
    return (
        <div>
            <div style={{ font: "400 11px var(--font)", color: "var(--txt4)", marginBottom: "var(--space-2)" }}>
                Keyboard shortcuts.
            </div>
            {KEYBOARD_SHORTCUTS.map((s, i) => (
                <div key={i} style={{ display: "flex", gap: "var(--space-3)", padding: "var(--space-2) 0", borderBottom: "1px solid var(--gline)", alignItems: "baseline" }}>
                    <span style={{ font: "600 11px var(--mono)", color: "var(--txt)", background: "var(--glass2)", border: "1px solid var(--gline2)", borderRadius: "var(--r)", padding: "1px 6px", flexShrink: 0, whiteSpace: "nowrap" }}>
                        {s.keys}
                    </span>
                    <div style={{ minWidth: 0 }}>
                        <div style={{ font: "400 12px var(--font)", color: "var(--txt2)" }}>{s.action}</div>
                        <div style={{ font: "400 10.5px var(--font)", color: "var(--txt4)" }}>{s.context}</div>
                    </div>
                </div>
            ))}
        </div>
    )
}

// ── About ────────────────────────────────────────────────────────────────
export function AboutSection() {
    const version = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "—"
    return (
        <div>
            <div style={{ font: "600 14px var(--font)", color: "var(--txt)", marginBottom: 4 }}>Parallax</div>
            <div style={{ font: "400 12px var(--font)", color: "var(--txt3)", marginBottom: "var(--space-3)" }}>Trifecta Technologies</div>
            <Row label="Version"><span style={{ font: "400 11.5px var(--mono)", color: "var(--txt2)" }}>v{version}</span></Row>
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
export function SessionsSection() {
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
                <div key={s.session_id} style={{ borderBottom: "1px solid var(--gline)", padding: "6px 0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ flex: 1, font: "400 12px var(--font)", color: "var(--txt2)" }}>{s.name}</span>
                        <span style={{ font: "9.5px var(--mono)", color: "var(--txt4)" }}>
                            {(s.views || []).length} view{(s.views || []).length === 1 ? "" : "s"}
                        </span>
                        <button type="button" disabled={busy === s.session_id}
                                onClick={() => removeSession(s.session_id)}
                                style={{ background: "none", border: 0, color: "var(--txt4)", cursor: "pointer" }}>✕</button>
                    </div>
                    {(s.views || []).map((v) => (
                        <div key={v.view_id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0 2px 12px" }}>
                            <span style={{ flex: 1, font: "400 11px var(--font)", color: "var(--txt3)" }}>
                                {v.name}
                                {viewExtraLabels(v).map((l) => (
                                    <span key={l} style={{ font: "9.5px var(--mono)", color: "var(--txt4)" }}> · {l}</span>
                                ))}
                            </span>
                            <button type="button" disabled={busy === v.view_id}
                                    onClick={() => removeView(s.session_id, v.view_id)}
                                    style={{ background: "none", border: 0, color: "var(--txt4)", cursor: "pointer" }}>✕</button>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    )
}
