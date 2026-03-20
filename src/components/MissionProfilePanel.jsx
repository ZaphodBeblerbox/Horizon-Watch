// MissionProfilePanel — onboarding wizard (mode="onboarding") and
// settings slide-in panel (mode="settings").

import { useState } from "react"
import {
    FOCUS_REGIONS, INFRA_DOMAINS, CHOKEPOINTS, ROLES,
    emptyProfile, loadProfile, saveProfileToStorage,
} from "../constants/profile.js"

// Re-export so existing callers (app.jsx) don't need updating.
export { loadProfile, saveProfileToStorage, emptyProfile,
         FOCUS_REGIONS, INFRA_DOMAINS, CHOKEPOINTS, ROLES }
export { PROFILE_KEY } from "../constants/profile.js"

// ── Shared styles ──────────────────────────────────────────────────────────────

const GLASS = {
    background:           "rgba(10,10,10,0.96)",
    backdropFilter:       "blur(24px)",
    WebkitBackdropFilter: "blur(24px)",
}

const THRESHOLD_LABELS = [
    { label: "Minimal",        desc: "Fatalities >5 or active battles only" },
    { label: "Standard",       desc: "Any fatality, battle, explosion, or civilian violence" },
    { label: "High Sensitivity", desc: "All of the above plus riots, protests, and strategic events" },
]

// ── Multi-select chip grid ─────────────────────────────────────────────────────

function ChipGrid({ items, selected, onToggle, color = "#00E5FF" }) {
    return (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {items.map(item => {
                const on = selected.includes(item)
                return (
                    <button
                        key={item}
                        onClick={() => onToggle(item)}
                        style={{
                            padding:       "4px 10px",
                            fontSize:      10,
                            fontWeight:    on ? 600 : 400,
                            letterSpacing: "0.04em",
                            borderRadius:  4,
                            border:        `1px solid ${on ? color : "rgba(255,255,255,0.12)"}`,
                            background:    on ? `${color}18` : "rgba(255,255,255,0.03)",
                            color:         on ? color : "rgba(255,255,255,0.45)",
                            cursor:        "pointer",
                            transition:    "all 0.12s",
                            userSelect:    "none",
                        }}
                    >
                        {item}
                    </button>
                )
            })}
        </div>
    )
}

function toggle(arr, item) {
    return arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item]
}

// ── Section label ──────────────────────────────────────────────────────────────

function SectionLabel({ children }) {
    return (
        <div style={{
            fontSize:      9,
            fontWeight:    800,
            letterSpacing: "0.13em",
            textTransform: "uppercase",
            color:         "rgba(255,255,255,0.28)",
            marginBottom:  8,
        }}>
            {children}
        </div>
    )
}

// ── Threshold slider ───────────────────────────────────────────────────────────

function ThresholdSlider({ value, onChange }) {
    return (
        <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                {THRESHOLD_LABELS.map((t, i) => (
                    <button
                        key={i}
                        onClick={() => onChange(i)}
                        style={{
                            flex:          1,
                            padding:       "7px 4px",
                            fontSize:      9,
                            fontWeight:    value === i ? 700 : 400,
                            letterSpacing: "0.05em",
                            border:        `1px solid ${value === i ? "rgba(255,179,0,0.6)" : "rgba(255,255,255,0.10)"}`,
                            borderRadius:  4,
                            margin:        "0 2px",
                            background:    value === i ? "rgba(255,179,0,0.12)" : "rgba(255,255,255,0.03)",
                            color:         value === i ? "#FFB300" : "rgba(255,255,255,0.38)",
                            cursor:        "pointer",
                            transition:    "all 0.12s",
                            userSelect:    "none",
                        }}
                    >
                        {t.label}
                    </button>
                ))}
            </div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", lineHeight: 1.5 }}>
                {THRESHOLD_LABELS[value].desc}
            </div>
        </div>
    )
}

// ── Onboarding wizard (3 steps) ────────────────────────────────────────────────

const STEPS = ["Identity", "Focus", "Calibration"]

function OnboardingWizard({ onSave }) {
    const [step, setStep]     = useState(0)
    const [draft, setDraft]   = useState(emptyProfile())

    const upd = (key, val) => setDraft(p => ({ ...p, [key]: val }))

    const canNext = () => {
        if (step === 0) return draft.displayName.trim().length > 0
        if (step === 1) return draft.focusRegions.length > 0
        return true
    }

    const handleFinish = () => {
        saveProfileToStorage(draft)
        onSave(draft)
    }

    return (
        <div style={{
            position:       "fixed",
            inset:          0,
            background:     "rgba(0,0,0,0.85)",
            zIndex:         9000,
            display:        "flex",
            alignItems:     "center",
            justifyContent: "center",
            padding:        16,
        }}>
            <div style={{
                ...GLASS,
                width:        "100%",
                maxWidth:     520,
                borderRadius: 10,
                border:       "1px solid rgba(255,255,255,0.07)",
                overflow:     "hidden",
            }}>
                {/* Header */}
                <div style={{
                    padding:      "20px 24px 16px",
                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                }}>
                    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.22em", color: "#fff", marginBottom: 4 }}>
                        HORIZON WATCH
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.7)", marginBottom: 12 }}>
                        Set up your Mission Profile
                    </div>
                    {/* Step indicators */}
                    <div style={{ display: "flex", gap: 6 }}>
                        {STEPS.map((s, i) => (
                            <div key={s} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                <div style={{
                                    width:        18,
                                    height:       18,
                                    borderRadius: "50%",
                                    background:   i < step ? "#22c55e" : i === step ? "rgba(255,255,255,0.12)" : "transparent",
                                    border:       `1px solid ${i < step ? "#22c55e" : i === step ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.12)"}`,
                                    display:      "flex",
                                    alignItems:   "center",
                                    justifyContent: "center",
                                    fontSize:     8,
                                    fontWeight:   700,
                                    color:        i < step ? "#fff" : i === step ? "#fff" : "rgba(255,255,255,0.25)",
                                    flexShrink:   0,
                                }}>
                                    {i < step ? "✓" : i + 1}
                                </div>
                                <span style={{
                                    fontSize:  9,
                                    fontWeight: i === step ? 700 : 400,
                                    letterSpacing: "0.08em",
                                    color:     i === step ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.25)",
                                }}>
                                    {s}
                                </span>
                                {i < STEPS.length - 1 && (
                                    <div style={{ width: 16, height: 1, background: "rgba(255,255,255,0.1)", marginLeft: 2 }} />
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Step content */}
                <div style={{ padding: "20px 24px", minHeight: 260, maxHeight: "60vh", overflowY: "auto" }}>
                    {step === 0 && (
                        <StepIdentity draft={draft} upd={upd} />
                    )}
                    {step === 1 && (
                        <StepFocus draft={draft} upd={upd} />
                    )}
                    {step === 2 && (
                        <StepCalibration draft={draft} upd={upd} />
                    )}
                </div>

                {/* Footer navigation */}
                <div style={{
                    padding:      "12px 24px 20px",
                    borderTop:    "1px solid rgba(255,255,255,0.06)",
                    display:      "flex",
                    justifyContent: "space-between",
                    alignItems:   "center",
                }}>
                    <button
                        onClick={() => setStep(s => s - 1)}
                        disabled={step === 0}
                        style={{
                            background:    "none",
                            border:        "1px solid rgba(255,255,255,0.10)",
                            borderRadius:  5,
                            padding:       "7px 16px",
                            fontSize:      10,
                            fontWeight:    600,
                            letterSpacing: "0.06em",
                            color:         step === 0 ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.5)",
                            cursor:        step === 0 ? "default" : "pointer",
                        }}
                    >
                        BACK
                    </button>

                    <span style={{ fontSize: 8, color: "rgba(255,255,255,0.18)", letterSpacing: "0.06em" }}>
                        {step + 1} / {STEPS.length}
                    </span>

                    {step < STEPS.length - 1 ? (
                        <button
                            onClick={() => canNext() && setStep(s => s + 1)}
                            style={{
                                background:    canNext() ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.03)",
                                border:        `1px solid ${canNext() ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.07)"}`,
                                borderRadius:  5,
                                padding:       "7px 16px",
                                fontSize:      10,
                                fontWeight:    700,
                                letterSpacing: "0.06em",
                                color:         canNext() ? "#fff" : "rgba(255,255,255,0.2)",
                                cursor:        canNext() ? "pointer" : "default",
                                transition:    "all 0.12s",
                            }}
                        >
                            NEXT
                        </button>
                    ) : (
                        <button
                            onClick={handleFinish}
                            style={{
                                background:    "rgba(34,197,94,0.15)",
                                border:        "1px solid rgba(34,197,94,0.45)",
                                borderRadius:  5,
                                padding:       "7px 20px",
                                fontSize:      10,
                                fontWeight:    700,
                                letterSpacing: "0.06em",
                                color:         "#22c55e",
                                cursor:        "pointer",
                                transition:    "all 0.12s",
                            }}
                        >
                            COMPLETE SETUP
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}

// ── Step 1: Identity ───────────────────────────────────────────────────────────

function StepIdentity({ draft, upd }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div>
                <SectionLabel>Display Name</SectionLabel>
                <input
                    value={draft.displayName}
                    onChange={e => upd("displayName", e.target.value)}
                    placeholder="Your name or callsign"
                    autoFocus
                    style={{
                        width:        "100%",
                        boxSizing:    "border-box",
                        background:   "rgba(255,255,255,0.05)",
                        border:       "1px solid rgba(255,255,255,0.12)",
                        borderRadius: 5,
                        padding:      "9px 12px",
                        fontSize:     12,
                        color:        "#fff",
                        outline:      "none",
                    }}
                />
                <div style={{ fontSize: 8, color: "rgba(255,255,255,0.18)", marginTop: 5 }}>
                    Used to personalise Claude context. Not sent to any server.
                </div>
            </div>

            <div>
                <SectionLabel>Role</SectionLabel>
                <div style={{ display: "flex", gap: 5 }}>
                    {ROLES.map(r => (
                        <button
                            key={r}
                            onClick={() => upd("role", r)}
                            style={{
                                flex:          1,
                                padding:       "8px 4px",
                                fontSize:      10,
                                fontWeight:    draft.role === r ? 700 : 400,
                                letterSpacing: "0.06em",
                                border:        `1px solid ${draft.role === r ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.10)"}`,
                                borderRadius:  4,
                                background:    draft.role === r ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.03)",
                                color:         draft.role === r ? "#fff" : "rgba(255,255,255,0.38)",
                                cursor:        "pointer",
                                transition:    "all 0.12s",
                                userSelect:    "none",
                            }}
                        >
                            {r}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    )
}

// ── Step 2: Focus ──────────────────────────────────────────────────────────────

function StepFocus({ draft, upd }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div>
                <SectionLabel>Primary Focus Regions</SectionLabel>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", marginBottom: 8 }}>
                    Select at least one. These regions get priority weighting in alerts and analysis.
                </div>
                <ChipGrid
                    items={FOCUS_REGIONS}
                    selected={draft.focusRegions}
                    onToggle={item => upd("focusRegions", toggle(draft.focusRegions, item))}
                    color="#00E5FF"
                />
            </div>

            <div>
                <SectionLabel>Infrastructure Domains of Interest</SectionLabel>
                <ChipGrid
                    items={INFRA_DOMAINS}
                    selected={draft.infraDomains}
                    onToggle={item => upd("infraDomains", toggle(draft.infraDomains, item))}
                    color="#00BCD4"
                />
            </div>

            <div>
                <SectionLabel>Global Chokepoints to Monitor</SectionLabel>
                <ChipGrid
                    items={CHOKEPOINTS}
                    selected={draft.chokepoints}
                    onToggle={item => upd("chokepoints", toggle(draft.chokepoints, item))}
                    color="#FFB300"
                />
            </div>
        </div>
    )
}

// ── Step 3: Calibration ────────────────────────────────────────────────────────

function StepCalibration({ draft, upd }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div>
                <SectionLabel>Alert Threshold</SectionLabel>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", marginBottom: 10 }}>
                    Controls what crosses the relevance threshold and surfaces as an alert.
                </div>
                <ThresholdSlider value={draft.threshold} onChange={v => upd("threshold", v)} />
            </div>

            <div>
                <SectionLabel>POI Proximity Alerts</SectionLabel>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", marginBottom: 8 }}>
                    Alert when a person of interest is near a significant event.
                </div>
                <button
                    onClick={() => upd("poiProximityAlerts", !draft.poiProximityAlerts)}
                    style={{
                        display: "flex", alignItems: "center", gap: 8,
                        background: "none", border: "none", cursor: "pointer", padding: 0,
                    }}
                >
                    <div style={{
                        width: 32, height: 18, borderRadius: 9, flexShrink: 0,
                        background: draft.poiProximityAlerts !== false ? "var(--akili-accent)" : "#2d3748",
                        position: "relative", transition: "background 0.2s",
                    }}>
                        <span style={{
                            position: "absolute", top: 2, width: 14, height: 14, borderRadius: "50%",
                            background: "#fff", transition: "left 0.2s",
                            left: draft.poiProximityAlerts !== false ? 16 : 2,
                        }} />
                    </div>
                    <span style={{ fontSize: 11, color: draft.poiProximityAlerts !== false ? "var(--akili-accent)" : "rgba(255,255,255,0.3)" }}>
                        {draft.poiProximityAlerts !== false ? "On" : "Off"}
                    </span>
                </button>
            </div>

            <div>
                <SectionLabel>Active Situations (optional)</SectionLabel>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", marginBottom: 6 }}>
                    Describe any ongoing missions or areas of elevated concern. Claude will frame all analysis around this.
                </div>
                <textarea
                    value={draft.activeSituations}
                    onChange={e => upd("activeSituations", e.target.value)}
                    placeholder="e.g. Monitoring DRC eastern front; assessing Red Sea corridor risk for logistics chain..."
                    rows={4}
                    style={{
                        width:        "100%",
                        boxSizing:    "border-box",
                        background:   "rgba(255,255,255,0.05)",
                        border:       "1px solid rgba(255,255,255,0.10)",
                        borderRadius: 5,
                        padding:      "9px 12px",
                        fontSize:     11,
                        color:        "#fff",
                        outline:      "none",
                        resize:       "vertical",
                        lineHeight:   1.5,
                        fontFamily:   "inherit",
                    }}
                />
            </div>
        </div>
    )
}

// ── Settings panel (slide-in right) ───────────────────────────────────────────

function SettingsPanel({ profile, onSave, onClose }) {
    const [draft,    setDraft]    = useState({ ...profile })
    const [savedMsg, setSavedMsg] = useState(false)

    const upd = (key, val) => setDraft(p => ({ ...p, [key]: val }))

    const handleSave = () => {
        saveProfileToStorage(draft)
        onSave(draft)
        setSavedMsg(true)
        setTimeout(() => { setSavedMsg(false); onClose() }, 2000)
    }

    return (
        <div style={{
            width:         "100%",
            height:        "100%",
            display:       "flex",
            flexDirection: "column",
            boxSizing:     "border-box",
        }}>
            {/* Header */}
            <div style={{
                display:      "flex",
                alignItems:   "center",
                padding:      "14px 14px 10px",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                flexShrink:   0,
            }}>
                <span style={{ flex: 1, fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(255,255,255,0.35)" }}>
                    Mission Profile
                </span>
                <button
                    onClick={onClose}
                    style={{ background: "none", border: "none", color: "rgba(255,255,255,0.25)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }}
                >
                    ✕
                </button>
            </div>

            {/* Purpose note */}
            <div style={{
                margin:       "10px 14px 0",
                padding:      "8px 10px",
                background:   "rgba(0,229,255,0.06)",
                border:       "1px solid rgba(0,229,255,0.12)",
                borderRadius: 5,
                fontSize:     10,
                color:        "rgba(232,237,242,0.45)",
                lineHeight:   1.55,
                flexShrink:   0,
            }}>
                Your profile tells Horizon Watch what to pay attention to. It does not activate any layers.
            </div>

            {/* Scrollable form */}
            <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                    {/* Identity */}
                    <div>
                        <SectionLabel>Display Name</SectionLabel>
                        <input
                            value={draft.displayName}
                            onChange={e => upd("displayName", e.target.value)}
                            placeholder="Your name or callsign"
                            style={{
                                width: "100%", boxSizing: "border-box",
                                background: "rgba(255,255,255,0.05)",
                                border: "1px solid rgba(255,255,255,0.12)",
                                borderRadius: 5, padding: "8px 10px",
                                fontSize: 11, color: "#fff", outline: "none",
                            }}
                        />
                    </div>

                    <div>
                        <SectionLabel>Role</SectionLabel>
                        <div style={{ display: "flex", gap: 4 }}>
                            {ROLES.map(r => (
                                <button
                                    key={r}
                                    onClick={() => upd("role", r)}
                                    style={{
                                        flex: 1, padding: "6px 2px", fontSize: 9,
                                        fontWeight: draft.role === r ? 700 : 400,
                                        letterSpacing: "0.05em",
                                        border: `1px solid ${draft.role === r ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.10)"}`,
                                        borderRadius: 4,
                                        background: draft.role === r ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.03)",
                                        color: draft.role === r ? "#fff" : "rgba(255,255,255,0.38)",
                                        cursor: "pointer", userSelect: "none",
                                    }}
                                >
                                    {r}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <SectionLabel>Focus Regions</SectionLabel>
                        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.22)", marginBottom: 8 }}>Events in these regions score higher</div>
                        <ChipGrid
                            items={FOCUS_REGIONS}
                            selected={draft.focusRegions}
                            onToggle={item => upd("focusRegions", toggle(draft.focusRegions, item))}
                            color="#00E5FF"
                        />
                    </div>

                    <div>
                        <SectionLabel>Infrastructure Priorities</SectionLabel>
                        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.22)", marginBottom: 8 }}>These types load first when contextually relevant</div>
                        <ChipGrid
                            items={INFRA_DOMAINS}
                            selected={draft.infraDomains}
                            onToggle={item => upd("infraDomains", toggle(draft.infraDomains, item))}
                            color="#00BCD4"
                        />
                    </div>

                    <div>
                        <SectionLabel>Chokepoints</SectionLabel>
                        <ChipGrid
                            items={CHOKEPOINTS}
                            selected={draft.chokepoints}
                            onToggle={item => upd("chokepoints", toggle(draft.chokepoints, item))}
                            color="#FFB300"
                        />
                    </div>

                    <div>
                        <SectionLabel>Significance Threshold</SectionLabel>
                        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.22)", marginBottom: 8 }}>Determines which events cross the threshold to appear on the map</div>
                        <ThresholdSlider value={draft.threshold} onChange={v => upd("threshold", v)} />
                    </div>

                    <div>
                        <SectionLabel>POI Proximity Alerts</SectionLabel>
                        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.22)", marginBottom: 8 }}>Alert when a person of interest is near a significant event</div>
                        <button
                            onClick={() => upd("poiProximityAlerts", !draft.poiProximityAlerts)}
                            style={{
                                display: "flex", alignItems: "center", gap: 8,
                                background: "none", border: "none", cursor: "pointer", padding: 0,
                            }}
                        >
                            <div style={{
                                width: 32, height: 18, borderRadius: 9, flexShrink: 0,
                                background: draft.poiProximityAlerts !== false ? "var(--akili-accent)" : "#2d3748",
                                position: "relative", transition: "background 0.2s",
                            }}>
                                <span style={{
                                    position: "absolute", top: 2, width: 14, height: 14, borderRadius: "50%",
                                    background: "#fff", transition: "left 0.2s",
                                    left: draft.poiProximityAlerts !== false ? 16 : 2,
                                }} />
                            </div>
                            <span style={{ fontSize: 11, color: draft.poiProximityAlerts !== false ? "var(--akili-accent)" : "rgba(255,255,255,0.3)" }}>
                                {draft.poiProximityAlerts !== false ? "On" : "Off"}
                            </span>
                        </button>
                    </div>

                    <div>
                        <SectionLabel>Active Situations</SectionLabel>
                        <textarea
                            value={draft.activeSituations}
                            onChange={e => upd("activeSituations", e.target.value)}
                            placeholder="Ongoing missions or areas of elevated concern..."
                            rows={4}
                            style={{
                                width: "100%", boxSizing: "border-box",
                                background: "rgba(255,255,255,0.05)",
                                border: "1px solid rgba(255,255,255,0.10)",
                                borderRadius: 5, padding: "8px 10px",
                                fontSize: 11, color: "#fff", outline: "none",
                                resize: "vertical", lineHeight: 1.5, fontFamily: "inherit",
                            }}
                        />
                    </div>
                </div>
            </div>

            {/* Save footer */}
            <div style={{
                padding: "12px 14px 16px",
                borderTop: "1px solid rgba(255,255,255,0.06)",
                flexShrink: 0,
            }}>
                <button
                    onClick={handleSave}
                    disabled={savedMsg}
                    style={{
                        width: "100%", padding: "9px", fontSize: 10,
                        fontWeight: 700, letterSpacing: "0.08em",
                        background: savedMsg ? "rgba(26,110,181,0.25)" : "var(--akili-accent)",
                        border: savedMsg ? "1px solid rgba(26,110,181,0.4)" : "none",
                        borderRadius: 5,
                        color: savedMsg ? "var(--akili-accent)" : "#e8edf2",
                        cursor: savedMsg ? "default" : "pointer",
                        transition: "all 0.15s",
                    }}
                >
                    {savedMsg ? "SAVED" : "SAVE PROFILE"}
                </button>
            </div>

        </div>
    )
}

// ── Main export ────────────────────────────────────────────────────────────────

export default function MissionProfilePanel({ mode, profile, onSave, onClose }) {
    if (mode === "onboarding") {
        return <OnboardingWizard onSave={onSave} />
    }
    return <SettingsPanel profile={profile || emptyProfile()} onSave={onSave} onClose={onClose} />
}
