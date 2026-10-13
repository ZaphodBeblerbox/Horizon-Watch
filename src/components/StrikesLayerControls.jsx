/**
 * StrikesLayerControls.jsx — under the "Strikes & control" row in the
 * layers panel: the time-window chip (24 h / 7 d / 14 d / 30 d), one chip
 * per act that is also its legend (the act's own marker), and the actor
 * colour key. State lives in globe/strikes.js so the globe layer reads the
 * same choice.
 */
import {
    STRIKE_ACTS, STRIKE_WINDOWS, ACTOR_COLOR, UNKNOWN_ACTOR_COLOR, strikeIconUri, setStrikeWindow, toggleStrikeAct,
} from "../globe/strikes.js"
import { useStrikeSettings } from "../globe/useStrikeSettings.js"

const KEY_ACTORS = ["Saudi-led coalition", "Houthis", "Israel", "Iran", "Russia", "Ukraine", "United States"]

export default function StrikesLayerControls({ variant = "desktop" }) {
    const { window: win, acts } = useStrikeSettings()
    const chip = { font: "400 10px var(--font)", padding: "1px 6px", cursor: "pointer" }
    return (
        <div data-testid="strikes-controls" data-variant={variant}
             style={{ display: "flex", flexDirection: "column", gap: 5, padding: "2px 12px 8px 27px" }}>
            <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }} role="group" aria-label="Time window">
                {STRIKE_WINDOWS.map((w) => (
                    <button key={w.key} className="chip" aria-pressed={win === w.key} onClick={() => setStrikeWindow(w.key)}
                            style={{ ...chip, opacity: win === w.key ? 1 : 0.5 }}>{w.label}</button>
                ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3 }} role="group" aria-label="Acts">
                {STRIKE_ACTS.map((a) => {
                    const on = acts.includes(a.key)
                    return (
                        <button key={a.key} className="chip" aria-pressed={on} data-act={a.key} onClick={() => toggleStrikeAct(a.key)}
                                title={`${on ? "Hide" : "Show"} ${a.label.toLowerCase()}`}
                                style={{ ...chip, display: "flex", alignItems: "center", gap: 4, opacity: on ? 1 : 0.4, textAlign: "left" }}>
                            <img src={strikeIconUri({ act: a.key, color: "#D7DCE4", size: 14 })} width={14} height={14} alt="" />
                            {a.label}
                        </button>
                    )
                })}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 8px", font: "400 10px var(--font)", color: "var(--txt-3)" }}>
                {KEY_ACTORS.map((k) => (
                    <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 4, background: ACTOR_COLOR[k] }} />{k}
                    </span>
                ))}
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 4, background: UNKNOWN_ACTOR_COLOR }} />actor not stated
                </span>
            </div>
            <div style={{ font: "400 10px var(--font)", color: "var(--txt-4)", lineHeight: 1.35 }}>
                Colour is who acted · hollow is a place known only roughly · faded is older · bigger is more casualties
            </div>
        </div>
    )
}
