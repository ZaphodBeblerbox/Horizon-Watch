/**
 * StartupLayersEditor.jsx — choosing what the app opens with.
 *
 * WHY THERE IS A SAVE BUTTON HERE, when the rest of Settings applies on
 * change. Every other control in Settings is its own confirmation: flip
 * the theme and the theme changes in front of you. This one is not. It
 * describes a state you will see on the NEXT launch, so applying silently
 * gives the reader nothing to check against — and when a write failed
 * there was no way to tell, because the checkbox stayed ticked either way.
 *
 * So the draft is local, Save writes it, and the result is reported. A
 * preference that silently fails to persist is worse than one that visibly
 * did not take: the user believes it is set.
 *
 * Every switch comes from layerRailConfig.js, the one place layer keys are
 * defined, so this list cannot drift from what the map actually offers.
 */

import { useEffect, useState } from "react"
import { STARTUP_GROUPS } from "./layerRailConfig.js"
import { getStartupLayers, saveStartupLayers, clearStartupLayers } from "../state/useChrome.js"

const EMPTY = { groups: {}, context: {}, infra: {}, tracks: {} }
// a first login's clean sheet ({clean: true}) is everything off
const norm = (s) => (s && s.clean ? EMPTY : s)

export default function StartupLayersEditor() {
    const [saved, setSaved] = useState(() => norm(getStartupLayers()))
    const [draft, setDraft] = useState(() => norm(getStartupLayers()) || EMPTY)
    const [state, setState] = useState("idle")   // idle | saving | saved | error
    const [err, setErr] = useState(null)

    // The stored value arrives from the server after first paint, so a
    // single read on mount usually sees nothing.
    useEffect(() => {
        const t = setTimeout(() => {
            const s = norm(getStartupLayers())
            if (s && state === "idle") { setSaved(s); setDraft(s) }
        }, 1200)
        return () => clearTimeout(t)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const dirty = JSON.stringify(draft) !== JSON.stringify(saved || EMPTY)

    const toggle = (groupId, key) => {
        setDraft((d) => ({ ...d, [groupId]: { ...(d[groupId] || {}), [key]: !d[groupId]?.[key] } }))
        setState("idle")
    }

    const save = async () => {
        setState("saving"); setErr(null)
        const r = await saveStartupLayers(draft)
        if (r?.ok === false && !r?.queued) { setState("error"); setErr(r.error); return }
        setSaved(draft); setState("saved")
    }

    const reset = async () => {
        setState("saving"); setErr(null)
        const r = await clearStartupLayers()
        if (r?.ok === false) { setState("error"); setErr(r.error); return }
        setSaved(null); setDraft(EMPTY); setState("saved")
    }

    const count = Object.values(draft).reduce(
        (n, g) => n + Object.values(g || {}).filter(Boolean).length, 0)

    return (
        <div>
            <p style={{ font: "400 11.5px/1.6 var(--font)", color: "var(--txt-3)", margin: "0 0 10px" }}>
                {saved
                    ? "The app opens with exactly these switches. Anything unticked starts off."
                    : "Nothing saved — the app opens with its built-in defaults. Tick what you want, then Save."}
            </p>

            <div style={{
                position: "sticky", top: 0, zIndex: 2, display: "flex", alignItems: "center", gap: 10,
                padding: "8px 0", marginBottom: 6, background: "var(--bg-2)",
                borderBottom: "1px solid var(--line)",
            }}>
                <button className="btn sm primary" onClick={save} disabled={!dirty || state === "saving"}>
                    {state === "saving" ? "Saving…" : "Save default view"}
                </button>
                {saved && (
                    <button className="btn sm" onClick={reset} disabled={state === "saving"}>
                        reset to built-in
                    </button>
                )}
                <span style={{ flex: 1 }} />
                <span style={{ font: "400 11px var(--font)", color:
                    state === "error" ? "var(--red, #f46043)"
                    : state === "saved" ? "var(--green, #4b8b5a)"
                    : dirty ? "var(--amber, #b8863b)" : "var(--txt-4)" }}>
                    {state === "error" ? `Not saved — ${err}`
                     : state === "saved" ? "Saved — applies on next launch"
                     : dirty ? "Unsaved changes"
                     : `${count} layer${count === 1 ? "" : "s"} on`}
                </span>
            </div>

            {STARTUP_GROUPS.map((g) => (
                <div key={g.id} style={{ marginBottom: 14 }}>
                    <div style={{
                        font: "600 10px var(--font)", color: "var(--txt-3)", textTransform: "uppercase",
                        letterSpacing: ".06em", padding: "0 0 5px", borderBottom: "1px solid var(--line)",
                        marginBottom: 5,
                    }}>{g.title}</div>

                    {g.items.map((it) => (
                        <label key={`${g.id}.${it.key}`} style={{
                            display: "flex", alignItems: "center", gap: 8, padding: "3px 0",
                            font: "400 12px var(--font)", color: "var(--txt-2)", cursor: "pointer",
                        }}>
                            <input type="checkbox"
                                   checked={Boolean(draft[g.id]?.[it.key])}
                                   onChange={() => toggle(g.id, it.key)} />
                            <span style={{ flex: 1 }}>{it.label || it.key}</span>
                            {/* Some switches control the same data from two
                                places; saying so beats appearing to offer
                                two independent controls. */}
                            {it.note && (
                                <span style={{ font: "400 10px var(--font)", color: "var(--txt-4)" }}>{it.note}</span>
                            )}
                        </label>
                    ))}
                </div>
            ))}
        </div>
    )
}
