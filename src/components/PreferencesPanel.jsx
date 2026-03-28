import { useState } from "react"
import API_BASE from "../apiBase.js"

const API = API_BASE
const STORAGE_KEY = "akili-settings-v1"

const DEFAULTS = {
    soundMuted:          false,
    briefingHourUTC:     6,
    refreshInterval:     15,
    alertInterval:       15,
    cacheMaxDays:        7,
    mapStyle:            "satellite",
    toastDuration:       4,
    soundCritical:       true,
    soundSignificant:    true,
    soundElevated:       false,
    toastsEnabled:       true,
    toastsCriticalOnly:  false,
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
    fetch(`${API}/api/settings`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(s),
    }).catch(() => {})
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
                position:     "absolute",
                top:          3,
                left:         value ? 21 : 3,
                width:        16,
                height:       16,
                borderRadius: "50%",
                background:   "#fff",
                transition:   "left 0.2s",
                display:      "block",
            }} />
        </button>
    )
}

const ROW = {
    display:        "flex",
    alignItems:     "center",
    justifyContent: "space-between",
    padding:        "9px 0",
    borderBottom:   "1px solid var(--akili-border)",
}

const LABEL = {
    fontSize:     12,
    color:        "var(--akili-text-primary)",
    fontWeight:   500,
    letterSpacing:"0.02em",
}

const SUB = {
    fontSize:  10,
    color:     "var(--akili-text-secondary)",
    marginTop: 2,
}

const SELECT_STYLE = {
    background:   "var(--akili-hover)",
    border:       "1px solid var(--akili-border)",
    color:        "var(--akili-text-primary)",
    borderRadius: 4,
    padding:      "4px 8px",
    fontSize:     11,
    cursor:       "pointer",
}

function SectionHeader({ children }) {
    return (
        <div style={{
            fontSize:      10,
            fontWeight:    700,
            color:         "var(--akili-accent)",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            borderLeft:    "2px solid var(--akili-accent)",
            paddingLeft:   8,
            marginTop:     20,
            marginBottom:  4,
        }}>
            {children}
        </div>
    )
}

export default function PreferencesPanel({ onClose }) {
    const [s, setS] = useState(loadSettings)

    function update(key, val) {
        setS(prev => {
            const next = { ...prev, [key]: val }
            saveSettings(next)
            return next
        })
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
                    PREFERENCES
                </span>
                <button onClick={onClose} style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: "var(--akili-text-secondary)", fontSize: 16, lineHeight: 1, padding: 4,
                }}>×</button>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 16px" }}>

                {/* ── DISPLAY ────────────────────────────────────────────── */}
                <SectionHeader>Display</SectionHeader>

                <div style={ROW}>
                    <div>
                        <div style={LABEL}>Map style</div>
                        <div style={SUB}>Base layer for the map view</div>
                    </div>
                    <select value={s.mapStyle} onChange={e => update("mapStyle", e.target.value)} style={SELECT_STYLE}>
                        <option value="satellite">Satellite</option>
                        <option value="street">Street</option>
                        <option value="terrain">Terrain</option>
                    </select>
                </div>

                <div style={ROW}>
                    <div>
                        <div style={LABEL}>Language</div>
                        <div style={SUB}>Interface language</div>
                    </div>
                    <select value="en" disabled style={{ ...SELECT_STYLE, opacity: 0.45, cursor: "not-allowed" }}>
                        <option value="en">English</option>
                        <option value="fr">French</option>
                        <option value="ar">Arabic</option>
                        <option value="sw">Swahili</option>
                    </select>
                </div>

                <div style={ROW}>
                    <div>
                        <div style={LABEL}>Timezone</div>
                        <div style={SUB}>All times are displayed in UTC</div>
                    </div>
                    <select value="utc" disabled style={{ ...SELECT_STYLE, opacity: 0.45, cursor: "not-allowed" }}>
                        <option value="utc">UTC (auto)</option>
                    </select>
                </div>

                {/* ── SOUND ──────────────────────────────────────────────── */}
                <SectionHeader>Sound</SectionHeader>

                <div style={ROW}>
                    <div>
                        <div style={LABEL}>Alert sounds</div>
                        <div style={SUB}>Synthesized tones for incoming alerts</div>
                    </div>
                    <Toggle value={!s.soundMuted} onChange={v => update("soundMuted", !v)} />
                </div>

                {/* ── NOTIFICATIONS ──────────────────────────────────────── */}
                <SectionHeader>Notifications</SectionHeader>

                <div style={ROW}>
                    <div>
                        <div style={LABEL}>In-app toast notifications</div>
                        <div style={SUB}>Show pop-up alerts for new events</div>
                    </div>
                    <Toggle value={s.toastsEnabled} onChange={v => update("toastsEnabled", v)} />
                </div>

                <div style={ROW}>
                    <div>
                        <div style={LABEL}>Critical events only</div>
                        <div style={SUB}>Only show toasts for critical severity</div>
                    </div>
                    <Toggle value={s.toastsCriticalOnly} onChange={v => update("toastsCriticalOnly", v)} />
                </div>

                <div style={ROW}>
                    <div>
                        <div style={LABEL}>Critical alerts sound</div>
                        <div style={SUB}>Fatalities, airstrikes, explosions</div>
                    </div>
                    <Toggle value={s.soundCritical} onChange={v => update("soundCritical", v)} />
                </div>

                <div style={ROW}>
                    <div>
                        <div style={LABEL}>Significant alerts sound</div>
                        <div style={SUB}>Armed clashes, displacement</div>
                    </div>
                    <Toggle value={s.soundSignificant} onChange={v => update("soundSignificant", v)} />
                </div>

                <div style={ROW}>
                    <div>
                        <div style={LABEL}>Elevated alerts sound</div>
                        <div style={SUB}>Riots, protests, non-critical events</div>
                    </div>
                    <Toggle value={s.soundElevated} onChange={v => update("soundElevated", v)} />
                </div>

                <div style={ROW}>
                    <div>
                        <div style={LABEL}>Toast duration</div>
                        <div style={SUB}>How long notification toasts are shown</div>
                    </div>
                    <select value={s.toastDuration} onChange={e => update("toastDuration", Number(e.target.value))} style={SELECT_STYLE}>
                        <option value={4}>4 s</option>
                        <option value={6}>6 s</option>
                        <option value={10}>10 s</option>
                        <option value={99999}>Persistent</option>
                    </select>
                </div>

                {/* ── INTELLIGENCE ───────────────────────────────────────── */}
                <SectionHeader>Intelligence</SectionHeader>

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

                {/* ── DATA ───────────────────────────────────────────────── */}
                <SectionHeader>Data</SectionHeader>

                <div style={ROW}>
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

                {/* ── ABOUT ──────────────────────────────────────────────── */}
                <SectionHeader>About</SectionHeader>

                <div style={{
                    padding:    "12px 0",
                    display:    "flex",
                    flexDirection: "column",
                    gap:        4,
                }}>
                    <div style={{ fontSize: 12, color: "var(--akili-text-primary)", fontWeight: 500 }}>
                        Horizon Watch v1.0.0
                    </div>
                    <div style={{ fontSize: 10, color: "var(--akili-text-muted)" }}>
                        by Trifecta Technologies
                    </div>
                    <div style={{ fontSize: 10, color: "var(--akili-text-muted)", marginTop: 2 }}>
                        Intelligence Platform — Early Access
                    </div>
                    <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                        <a href="#" style={{ fontSize: 10, color: "var(--akili-accent)", textDecoration: "none" }}
                            onMouseEnter={e => e.target.style.textDecoration = "underline"}
                            onMouseLeave={e => e.target.style.textDecoration = "none"}>
                            Documentation
                        </a>
                        <a href="mailto:marc-amay.lunau@trifecta-technologies.com"
                            style={{ fontSize: 10, color: "var(--akili-accent)", textDecoration: "none" }}
                            onMouseEnter={e => e.target.style.textDecoration = "underline"}
                            onMouseLeave={e => e.target.style.textDecoration = "none"}>
                            Support
                        </a>
                    </div>
                </div>

            </div>
        </div>
    )
}
