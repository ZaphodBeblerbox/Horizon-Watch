import { useState, useEffect } from "react"
import API_BASE from "../apiBase.js"

const API = API_BASE
const STORAGE_KEY = "akili-settings-v1"

const DEFAULTS = {
    themeMode:        "auto",       // "auto" | "day" | "night"
    soundMuted:       false,
    briefingHourUTC:  6,            // 0–23
    refreshInterval:  15,           // minutes: 5 | 10 | 15 | 30
    alertInterval:    15,           // seconds: 10 | 15 | 30
    cacheMaxDays:     7,            // 1 | 7 | 30
}

export function loadSettings() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
    } catch {}
    return { ...DEFAULTS }
}

function saveSettings(s) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch {}
    // Sync to backend (fire-and-forget)
    fetch(`${API}/api/settings`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(s),
    }).catch(() => {})
}

const ROW = {
    display:        "flex",
    alignItems:     "center",
    justifyContent: "space-between",
    padding:        "10px 0",
    borderBottom:   "1px solid var(--akili-border)",
}

const LABEL = {
    fontSize:    12,
    color:       "var(--akili-text-primary)",
    fontWeight:  500,
    letterSpacing: "0.02em",
}

const SUB = {
    fontSize: 10,
    color:    "var(--akili-text-secondary)",
    marginTop: 2,
}

const SELECT_STYLE = {
    background:  "var(--akili-hover)",
    border:      "1px solid var(--akili-border)",
    color:       "var(--akili-text-primary)",
    borderRadius: 4,
    padding:     "4px 8px",
    fontSize:    11,
    cursor:      "pointer",
}

function Toggle({ value, onChange }) {
    return (
        <button
            onClick={() => onChange(!value)}
            style={{
                width:        40,
                height:       22,
                borderRadius: 11,
                border:       "none",
                background:   value ? "var(--akili-accent)" : "var(--akili-hover-strong)",
                cursor:       "pointer",
                position:     "relative",
                transition:   "background 0.2s",
                flexShrink:   0,
            }}
        >
            <span style={{
                position:   "absolute",
                top:        3,
                left:       value ? 21 : 3,
                width:      16,
                height:     16,
                borderRadius: "50%",
                background: "#fff",
                transition: "left 0.2s",
                display:    "block",
            }} />
        </button>
    )
}

export default function SettingsPanel({ onClose }) {
    const [s, setS] = useState(loadSettings)

    function update(key, val) {
        setS(prev => {
            const next = { ...prev, [key]: val }
            saveSettings(next)
            return next
        })
    }

    // Apply theme change immediately when changed here
    useEffect(() => {
        const event = new CustomEvent("akili-theme-change", { detail: s.themeMode })
        window.dispatchEvent(event)
    }, [s.themeMode])

    const H = {
        fontSize:      11,
        fontWeight:    700,
        color:         "var(--akili-accent)",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        marginTop:     20,
        marginBottom:  4,
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            {/* Header */}
            <div style={{
                display:        "flex",
                alignItems:     "center",
                justifyContent: "space-between",
                padding:        "14px 16px 12px",
                borderBottom:   "1px solid var(--akili-border)",
                flexShrink:     0,
            }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--akili-text-primary)", letterSpacing: "0.04em" }}>
                    SETTINGS
                </span>
                <button onClick={onClose} style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: "var(--akili-text-secondary)", fontSize: 16, lineHeight: 1, padding: 4,
                }}>×</button>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 16px" }}>

                {/* Display */}
                <div style={H}>Display</div>

                <div style={ROW}>
                    <div>
                        <div style={LABEL}>Theme</div>
                        <div style={SUB}>Auto uses sunrise/sunset at your location</div>
                    </div>
                    <select value={s.themeMode} onChange={e => update("themeMode", e.target.value)} style={SELECT_STYLE}>
                        <option value="auto">Auto</option>
                        <option value="day">Day</option>
                        <option value="night">Night</option>
                    </select>
                </div>

                {/* Sound */}
                <div style={H}>Sound</div>

                <div style={ROW}>
                    <div>
                        <div style={LABEL}>Alert sounds</div>
                        <div style={SUB}>Synthesized tones for incoming alerts</div>
                    </div>
                    <Toggle value={!s.soundMuted} onChange={v => update("soundMuted", !v)} />
                </div>

                {/* Intelligence */}
                <div style={H}>Intelligence</div>

                <div style={ROW}>
                    <div>
                        <div style={LABEL}>Daily briefing time (UTC)</div>
                        <div style={SUB}>Hour when auto-briefing is generated</div>
                    </div>
                    <select value={s.briefingHourUTC} onChange={e => update("briefingHourUTC", Number(e.target.value))} style={SELECT_STYLE}>
                        {Array.from({ length: 24 }, (_, i) => (
                            <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>
                        ))}
                    </select>
                </div>

                <div style={ROW}>
                    <div>
                        <div style={LABEL}>Surface refresh interval</div>
                        <div style={SUB}>How often surface/news data is re-fetched</div>
                    </div>
                    <select value={s.refreshInterval} onChange={e => update("refreshInterval", Number(e.target.value))} style={SELECT_STYLE}>
                        <option value={5}>5 min</option>
                        <option value={10}>10 min</option>
                        <option value={15}>15 min</option>
                        <option value={30}>30 min</option>
                    </select>
                </div>

                <div style={ROW}>
                    <div>
                        <div style={LABEL}>Alert polling interval</div>
                        <div style={SUB}>WebSocket / SSE check frequency</div>
                    </div>
                    <select value={s.alertInterval} onChange={e => update("alertInterval", Number(e.target.value))} style={SELECT_STYLE}>
                        <option value={10}>10 s</option>
                        <option value={15}>15 s</option>
                        <option value={30}>30 s</option>
                    </select>
                </div>

                {/* Data */}
                <div style={H}>Data</div>

                <div style={{ ...ROW, borderBottom: "none" }}>
                    <div>
                        <div style={LABEL}>Analysis cache duration</div>
                        <div style={SUB}>How long Claude analysis results are stored</div>
                    </div>
                    <select value={s.cacheMaxDays} onChange={e => update("cacheMaxDays", Number(e.target.value))} style={SELECT_STYLE}>
                        <option value={1}>1 day</option>
                        <option value={7}>7 days</option>
                        <option value={30}>30 days</option>
                    </select>
                </div>
            </div>
        </div>
    )
}
