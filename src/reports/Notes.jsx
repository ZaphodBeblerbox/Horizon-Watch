/**
 * Notes.jsx — everything you have written down, in one place.
 *
 * Notes were being saved and had nowhere to be read. A voice note, a
 * selection sent from a document, an observation with no endpoint to go to
 * — all of them landed in savedForBriefing with `kind: "note"` and then
 * existed only as a line in an aside that is sorted by what you are
 * writing about, not by what you wrote. Something you dictate and cannot
 * find again is something you stop dictating.
 *
 * They are the same store the briefing basket reads, so a note here is
 * already an input to the generator and already insertable in the editor.
 * This is a view of that store, not a second one.
 */
import { useMemo, useState } from "react"
import { useSaved, removeSaved, savedLabel, savedMeta } from "../state/savedForBriefing.js"
import Minimap from "../components/Minimap.jsx"

const EYE = {
    fontFamily: "var(--mz-font-mono)", fontWeight: 500, fontSize: 10,
    letterSpacing: ".14em", textTransform: "uppercase", color: "var(--txt4)",
}
const BTN = {
    height: 24, padding: "0 9px", border: "1px solid var(--gline2)",
    background: "transparent", color: "var(--txt2)", font: "inherit",
    fontSize: 11, cursor: "pointer", borderRadius: 0, whiteSpace: "nowrap",
}

const when = (n) => {
    const t = Date.parse(n.when) || n.savedAt
    if (!t) return ""
    const mins = Math.round((Date.now() - t) / 60000)
    if (mins < 1) return "just now"
    if (mins < 60) return `${mins}m ago`
    if (mins < 1440) return `${Math.round(mins / 60)}h ago`
    return new Date(t).toISOString().slice(0, 10)
}

export default function Notes({ onInsert = null }) {
    const saved = useSaved()
    const [sel, setSel] = useState(null)

    const notes = useMemo(
        () => saved.filter((s) => s.kind === "note")
            .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)),
        [saved])
    const located = useMemo(() => notes.filter((n) => n.lat != null && n.lon != null), [notes])
    const focused = notes.find((n) => n.id === sel) || located[0] || null

    return (
        <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 12, minWidth: 0 }}>
            <div style={{
                flex: 1, minWidth: 0, display: "flex", flexDirection: "column",
                overflow: "hidden", border: "1px solid var(--gline)",
            }}>
                <div style={{
                    display: "flex", alignItems: "center", gap: 10, minHeight: 40, flex: "none",
                    padding: "6px 14px", borderBottom: "1px solid var(--gline)",
                }}>
                    <span style={EYE}>Notes</span>
                    <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, color: "var(--txt4)" }}>
                        {notes.length} · {located.length} located
                    </span>
                    <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--txt4)", textWrap: "pretty" }}>
                        These are already in the briefing basket — the generator reads them, and the
                        writer can insert them.
                    </span>
                </div>

                <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                    {notes.map((n) => (
                        <div key={n.id} onClick={() => setSel(n.id)} style={{
                            display: "grid", gridTemplateColumns: "minmax(0,1fr) auto",
                            gap: "4px 12px", padding: "12px 14px",
                            borderBottom: "1px solid var(--gline)",
                            background: n.id === sel ? "var(--accdim)" : "transparent",
                            cursor: "pointer",
                        }}>
                            <span style={{ fontSize: 13.5, lineHeight: 1.5, textWrap: "pretty" }}>
                                {savedLabel(n)}
                            </span>
                            <span style={{ display: "flex", gap: 4, alignItems: "flex-start" }}>
                                {onInsert && (
                                    <button onClick={(e) => { e.stopPropagation(); onInsert(n) }} style={BTN}>insert</button>
                                )}
                                {n.lat != null && (
                                    <button onClick={(e) => {
                                        e.stopPropagation()
                                        window.dispatchEvent(new CustomEvent("akili:open-map"))
                                        window.dispatchEvent(new CustomEvent("akili:fly-to", {
                                            detail: { lat: n.lat, lon: n.lon, altitude: 200000 },
                                        }))
                                    }} style={BTN}>on map →</button>
                                )}
                                <button onClick={(e) => { e.stopPropagation(); removeSaved(n.id) }}
                                    title="Delete this note" style={{ ...BTN, border: 0, color: "var(--txt4)" }}>✕</button>
                            </span>
                            <span style={{
                                gridColumn: "1 / 3", fontFamily: "var(--mz-font-mono)",
                                fontSize: 10, color: "var(--txt4)",
                            }}>
                                {[when(n), savedMeta(n)].filter(Boolean).join(" · ") || "no attribution recorded"}
                            </span>
                        </div>
                    ))}
                    {!notes.length && (
                        <div style={{ padding: "16px 14px", fontSize: 12.5, color: "var(--txt3)", textWrap: "pretty" }}>
                            Nothing written down yet. On the map, hold <b style={{ fontWeight: 600 }}>fn</b> and
                            say <i>“note that …”</i>, or select text in a document and press
                            <b style={{ fontWeight: 600 }}> + briefing</b>.
                        </div>
                    )}
                </div>
            </div>

            <aside style={{
                flex: "0 0 320px", minHeight: 0, display: "flex", flexDirection: "column",
                overflow: "hidden", border: "1px solid var(--gline)",
            }}>
                <div style={{
                    display: "flex", alignItems: "center", height: 36, flex: "none",
                    padding: "0 12px", borderBottom: "1px solid var(--gline)",
                }}>
                    <b style={{ fontWeight: 600, fontSize: 12.5 }}>Where they were taken</b>
                </div>
                <div style={{ height: 210, flex: "none", borderBottom: "1px solid var(--gline)", background: "var(--sea)" }}>
                    <Minimap
                        focus={focused?.lat != null ? { lat: focused.lat, lon: focused.lon } : null}
                        context={located.filter((n) => n.id !== focused?.id)
                            .map((n) => ({ id: n.id, lat: n.lat, lon: n.lon, ts: n.savedAt }))}
                        framing="signal" width={318} height={210}
                        label={focused ? savedLabel(focused).slice(0, 26) : ""}
                        title="Notes"
                        subtitle={located.length ? "" : "no note has a location yet"}
                    />
                </div>
                <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 14 }}>
                    {focused ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <span style={EYE}>Selected</span>
                            <span style={{ fontSize: 13, lineHeight: 1.55, textWrap: "pretty" }}>
                                {savedLabel(focused)}
                            </span>
                            <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10.5, color: "var(--txt4)" }}>
                                {[when(focused), savedMeta(focused)].filter(Boolean).join(" · ")}
                            </span>
                        </div>
                    ) : (
                        <span style={{ fontSize: 12, color: "var(--txt3)" }}>Pick a note to see it here.</span>
                    )}
                </div>
            </aside>
        </div>
    )
}
