/**
 * StartupLayersEditor.jsx — choosing what the app opens with.
 *
 * The Settings row for this could previously only CLEAR a saved default;
 * to set one you had to go to Situation, arrange the map and press "save
 * default" there. That is fine as a shortcut and useless as the only way,
 * because it means the settings screen shows a state it cannot change.
 *
 * Every switch here comes from layerRailConfig.js, the one place layer keys
 * are defined, so this list cannot drift from what the map actually offers
 * — which it had: the old control implied layers that do not exist and
 * omitted ones that do.
 */

import { useState } from "react"
import { STARTUP_GROUPS } from "./layerRailConfig.js"
import { getStartupLayers, saveStartupLayers, clearStartupLayers } from "../state/useChrome.js"

export default function StartupLayersEditor() {
    const [saved, setSaved] = useState(() => getStartupLayers())
    const [busy, setBusy] = useState(false)

    // null means "never saved one" — the built-in per-view defaults apply.
    // That is deliberately different from a saved set with everything off.
    const draft = saved || { groups: {}, context: {}, infra: {}, tracks: {} }

    const setKey = (groupId, key, on) => {
        const next = {
            ...draft,
            [groupId]: { ...(draft[groupId] || {}), [key]: on },
        }
        setSaved(next)
        setBusy(true)
        saveStartupLayers(next).finally(() => setBusy(false))
    }

    const clear = () => {
        setSaved(null)
        setBusy(true)
        clearStartupLayers().finally(() => setBusy(false))
    }

    return (
        <div>
            <p style={{ font: "400 11.5px/1.6 var(--font)", color: "var(--txt-3)", margin: "0 0 12px" }}>
                {saved
                    ? "The app opens with exactly these switches. Anything not ticked starts off."
                    : "Nothing saved — the app opens with its built-in defaults. Tick anything below to start saving your own."}
                {busy && <span style={{ color: "var(--txt-4)" }}> · saving…</span>}
            </p>

            {STARTUP_GROUPS.map((g) => (
                <div key={g.id} style={{ marginBottom: 14 }}>
                    <div style={{
                        font: "600 10px var(--font)", color: "var(--txt-3)", textTransform: "uppercase",
                        letterSpacing: ".06em", padding: "0 0 5px", borderBottom: "1px solid var(--line)",
                        marginBottom: 5,
                    }}>{g.title}</div>

                    {g.items.map((it) => {
                        const on = Boolean(draft[g.id]?.[it.key])
                        return (
                            <label key={`${g.id}.${it.key}`} style={{
                                display: "flex", alignItems: "center", gap: 8, padding: "3px 0",
                                font: "400 12px var(--font)", color: "var(--txt-2)", cursor: "pointer",
                            }}>
                                <input
                                    type="checkbox"
                                    checked={on}
                                    onChange={(e) => setKey(g.id, it.key, e.target.checked)}
                                />
                                <span style={{ flex: 1 }}>{it.label || it.key}</span>
                                {/* Some switches control the same data from two
                                    places. Saying so beats appearing to offer
                                    two independent controls. */}
                                {it.note && (
                                    <span style={{ font: "400 10px var(--font)", color: "var(--txt-4)" }}>{it.note}</span>
                                )}
                            </label>
                        )
                    })}
                </div>
            ))}

            {saved && (
                <button className="btn sm" onClick={clear} disabled={busy}>
                    reset to built-in defaults
                </button>
            )}
        </div>
    )
}
