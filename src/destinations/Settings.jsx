/**
 * Settings.jsx — how the console behaves, as a page.
 *
 * Reached from the gear at the bottom of the rail (which replaced the "?"
 * that opened the old Settings dialog) and from anything that used to open
 * that dialog (akili:open-settings, the File menu). Same shell as the
 * account page: a sticky nav on the left, the section in a glass card on
 * the right. The account itself — name, picture, password — stays on the
 * account page, linked from the top of the nav.
 *
 * The sections are SettingsModal.jsx's, every control backed by real
 * per-user state and applied the moment it changes; no Save button.
 * Voice and AI is new: the model behind spoken commands and the cheap
 * readers, what it has cost this month against the cap.
 */
import { useEffect, useState } from "react"
import API_BASE from "../apiBase.js"
import { MODE_SURFACE } from "../plx6/modeWindow.js"
import { getSettings, subscribeSettings, updateSetting } from "../state/settingsStore.js"
import InterestsEditor from "../components/InterestsEditor.jsx"
import {
    GeneralSection, MapLayersSection, AlertsSection, SourcesSection, BriefingSection,
    KeyboardSection, AboutSection, SessionsSection, Row, SectionTitle, Toggle,
} from "../components/SettingsModal.jsx"

const CARD = {
    display: "flex", flexDirection: "column", padding: "8px 22px 22px",
    border: "1px solid var(--gline)", background: "var(--glass2)", minWidth: 0,
}

const NAV = [
    ["General", "general"], ["Your interests", "interests"], ["Map and layers", "mapLayers"],
    ["Alerts and notifications", "alerts"], ["Voice and AI", "ai"], ["Sessions and views", "sessions"],
    ["Feeds and health", "sources"], ["Briefings", "briefing"], ["Shortcuts", "keyboard"], ["About", "about"],
]
const LEAD = {
    general: "Theme, density, time zone.",
    interests: "What you watch: it decides what reaches you first.",
    mapLayers: "What the map opens with.",
    alerts: "What interrupts you, and how loudly.",
    ai: "The model behind spoken commands and the readers, and what it costs.",
    sessions: "Saved desks and views.",
    sources: "Every feed, and when it last delivered.",
    briefing: "Defaults for generated reports.",
    keyboard: "Every shortcut.",
    about: "",
}

const usd = (v) => (v == null ? "—" : `$${Number(v).toFixed(v < 1 ? 3 : 2)}`)

/** Voice and AI: the spend against the monthly cap, and the voice switch. */
function AiSection({ settings }) {
    const [st, setSt] = useState(null)
    useEffect(() => {
        fetch(`${API_BASE}/api/voice/ai-status`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null)).then(setSt).catch(() => setSt(null))
    }, [])
    const pct = st && st.budget_usd ? Math.min(100, (st.spent_usd / st.budget_usd) * 100) : 0
    return (
        <div>
            <SectionTitle>This month</SectionTitle>
            {st ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "6px 0 10px" }}>
                    <span style={{ fontSize: 14 }}>
                        {usd(st.spent_usd)} of {usd(st.budget_usd)} spent in {st.month}
                        <span style={{ color: "var(--txt3)" }}> · {usd(st.remaining_usd)} left</span>
                    </span>
                    <div style={{ height: 6, background: "var(--hov)", border: "1px solid var(--gline)" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: st.over_budget ? "var(--red)" : "var(--acchi)" }} />
                    </div>
                    <span style={{ fontSize: 12, color: "var(--txt3)", lineHeight: 1.45 }}>
                        {st.configured ? `Model: ${st.model}. ` : "No OpenAI key is set — spoken commands use the built-in rules only. "}
                        {st.over_budget ? "The cap is reached: the model is off until next month; the rules still work." :
                            "When the cap is reached the model switches off and the built-in rules take over; nothing else stops."}
                    </span>
                </div>
            ) : <span style={{ fontSize: 12, color: "var(--txt3)" }}>Reading the budget…</span>}

            <SectionTitle>Voice</SectionTitle>
            <Row label="Spoken commands"
                 hint="Hold fn and speak (Wispr Flow types into the bar at the bottom of every page). Every sentence is read by the model — about a hundredth of a cent each — and turned into what the console can do: search, open a page, switch a layer, fly somewhere, explain a place.">
                <Toggle value={settings?.voice?.enabled !== false} onChange={(v) => updateSetting("voice.enabled", v)} />
            </Row>
            <Row label="Read by the model"
                 hint="Off: only the built-in phrasings work (go to …, note …, file this under …), offline and free.">
                <Toggle value={settings?.voice?.model !== false} onChange={(v) => updateSetting("voice.model", v)} />
            </Row>

            <SectionTitle>What uses the model</SectionTitle>
            <div style={{ fontSize: 12.5, color: "var(--txt2)", lineHeight: 1.6, paddingTop: 4 }}>
                {(st?.purposes || []).length ? st.purposes.map((p) => (
                    <div key={p}>{{
                        voice: "Spoken commands", explain: "Explaining a place", enrich: "Reading news, Telegram and satellite scenes",
                        forecast: "Forecasts", outlook: "Outlooks", fusion: "Fusing signals into events",
                    }[p] || p}</div>
                )) : "—"}
                <div style={{ color: "var(--txt3)", marginTop: 6 }}>Briefings and decks are written by Claude, outside this budget.</div>
            </div>
        </div>
    )
}

export default function Settings({ section = null, onClose = null, onAccount = null, onOpenSources = null }) {
    const [sec, setSec] = useState(section || "general")
    useEffect(() => { if (section) setSec(section) }, [section])
    const [settings, setSettings] = useState(getSettings)
    useEffect(() => subscribeSettings(setSettings), [])
    useEffect(() => {
        if (!onClose) return undefined
        const k = (e) => { if (e.key === "Escape" && !e.target.closest?.("input, textarea, select")) onClose() }
        window.addEventListener("keydown", k)
        return () => window.removeEventListener("keydown", k)
    }, [onClose])
    const title = NAV.find(([, k]) => k === sec)?.[0] || "Settings"

    return (
        <section data-screen-label="Settings" style={{ ...MODE_SURFACE, position: "relative" }}>
            {onClose && (
                <button onClick={onClose} title="Close (Esc)" aria-label="Close settings" style={{
                    position: "absolute", right: 10, top: 10, zIndex: 3, width: 28, height: 28,
                    border: "1px solid var(--gline2)", background: "transparent", color: "var(--txt3)",
                    font: "inherit", cursor: "pointer", borderRadius: 0,
                }}>✕</button>
            )}
            <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "24px 52px 96px 24px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,220px) minmax(0,1fr)", gap: 32 }}>
                    <nav style={{ display: "flex", flexDirection: "column", gap: 2, alignSelf: "start", position: "sticky", top: 0 }}>
                        <span style={{ fontFamily: "var(--mz-font-body)", fontWeight: 600, fontSize: 24, marginBottom: 14 }}>Settings</span>
                        {onAccount && (
                            <button onClick={onAccount} style={{
                                display: "flex", alignItems: "center", height: 34, padding: "0 12px", marginBottom: 8,
                                border: "1px solid var(--gline)", borderRadius: 0, background: "transparent",
                                color: "var(--txt2)", font: "inherit", fontSize: 13.5, textAlign: "left", cursor: "pointer",
                            }}>Your account — profile, password →</button>
                        )}
                        {NAV.map(([label, k]) => (
                            <button key={k} onClick={() => setSec(k)} style={{
                                display: "flex", alignItems: "center", height: 34, padding: "0 12px",
                                border: 0, borderRadius: 4,
                                background: sec === k ? "var(--accdim)" : "transparent",
                                color: sec === k ? "var(--txt)" : "var(--txt3)",
                                font: "inherit", fontSize: 14, textAlign: "left", cursor: "pointer",
                            }}>{label}</button>
                        ))}
                    </nav>
                    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
                        <div>
                            <h2 style={{ margin: 0, fontFamily: "var(--mz-font-body)", fontWeight: 600, fontSize: 20 }}>{title}</h2>
                            {LEAD[sec] && <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--txt3)" }}>{LEAD[sec]}</p>}
                        </div>
                        <div style={CARD}>
                            {sec === "general" && <GeneralSection settings={settings} />}
                            {sec === "interests" && <InterestsEditor />}
                            {sec === "mapLayers" && <MapLayersSection settings={settings} />}
                            {sec === "alerts" && <AlertsSection settings={settings} onOpenSources={onOpenSources} />}
                            {sec === "ai" && <AiSection settings={settings} />}
                            {sec === "sessions" && <SessionsSection />}
                            {sec === "sources" && <SourcesSection />}
                            {sec === "briefing" && <BriefingSection settings={settings} />}
                            {sec === "keyboard" && <KeyboardSection />}
                            {sec === "about" && <AboutSection />}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    )
}
