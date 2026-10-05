/**
 * ExplanationPanel.jsx — what the model said, and what it read.
 *
 * "Explain the current situation in Mali" answers in prose, so it cannot
 * be a toast. It is a sheet with the explanation and, under it, every
 * signal the explanation was written from — because an explanation whose
 * evidence the reader cannot see is an opinion, and this one will be acted
 * on.
 *
 * Each signal flies the map to itself. The point of explaining a place
 * inside a console that already holds the place is that checking a claim
 * is one click, not a second search.
 */
import { useEffect, useState } from "react"

const EYE = {
    font: "500 10px var(--mono)", letterSpacing: ".14em",
    textTransform: "uppercase", color: "var(--txt-3)",
}
const SEV = {
    critical: "var(--red)", significant: "var(--amber)",
    high: "var(--amber)", elevated: "var(--acc-hi)", routine: "var(--steel)",
}

export default function ExplanationPanel() {
    const [d, setD] = useState(null)

    useEffect(() => {
        const on = (e) => setD(e.detail || null)
        window.addEventListener("akili:explanation", on)
        return () => window.removeEventListener("akili:explanation", on)
    }, [])

    useEffect(() => {
        if (!d) return undefined
        const k = (e) => { if (e.key === "Escape") { e.stopPropagation(); setD(null) } }
        // Capture, so this closes before app.jsx's Escape takes the view
        // back to the map — the nearest thing you opened is the thing you
        // meant to close.
        window.addEventListener("keydown", k, true)
        return () => window.removeEventListener("keydown", k, true)
    }, [d])

    if (!d) return null

    return (
        <div
            data-testid="explanation-panel"
            style={{
                position: "absolute", right: 12, top: 84, bottom: "var(--pane-bottom)",
                width: 420, maxWidth: "calc(100% - 72px)", zIndex: 28,
                display: "flex", flexDirection: "column", overflow: "hidden",
                background: "var(--glass)", backdropFilter: "blur(22px) saturate(1.15)",
                WebkitBackdropFilter: "blur(22px) saturate(1.15)",
                border: "1px solid var(--gline)", boxShadow: "var(--gshadow)",
            }}
        >
            <div style={{
                display: "flex", alignItems: "center", gap: 9, padding: "11px 13px",
                borderBottom: "1px solid var(--gline)", flexShrink: 0,
            }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ font: "600 13px var(--font)", color: "var(--txt)" }}>{d.place}</div>
                    <div style={EYE}>
                        {d.count ? `from ${d.count} signal${d.count === 1 ? "" : "s"}` : "nothing held"}
                        {d.sources?.length ? ` · ${d.sources.join(", ")}` : ""}
                    </div>
                </div>
                <button onClick={() => setD(null)} aria-label="Close" style={{
                    width: 24, height: 24, border: "1px solid var(--gline2)",
                    background: "transparent", color: "var(--txt-3)",
                    cursor: "pointer", borderRadius: 0, font: "400 11px var(--font)",
                }}>✕</button>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 13 }}>
                {d.explanation
                    ? <div style={{
                        font: "400 13.5px/1.7 var(--font)", color: "var(--txt)",
                        whiteSpace: "pre-wrap", textWrap: "pretty",
                      }}>{d.explanation}</div>
                    : <p style={{
                        margin: 0, font: "400 12.5px/1.7 var(--font)", color: "var(--txt-3)",
                        textWrap: "pretty",
                      }}>{d.note || "Nothing to explain."}</p>}

                {d.signals?.length > 0 && (
                    <>
                        <div style={{ ...EYE, margin: "18px 0 7px" }}>What it read</div>
                        {d.signals.map((s, i) => (
                            <div
                                key={i}
                                onClick={() => {
                                    if (s.lat == null) return
                                    window.dispatchEvent(new CustomEvent("akili:fly-to", {
                                        detail: { lat: s.lat, lon: s.lon },
                                    }))
                                }}
                                style={{
                                    display: "flex", gap: 8, padding: "7px 0",
                                    borderBottom: "1px solid var(--gline)",
                                    cursor: s.lat != null ? "pointer" : "default",
                                }}
                            >
                                <i style={{
                                    width: 6, height: 6, marginTop: 5, flexShrink: 0,
                                    background: SEV[String(s.severity || "").toLowerCase()] || "var(--steel)",
                                }} />
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ font: "400 12px/1.5 var(--font)", color: "var(--txt-2)" }}>
                                        {s.headline}
                                    </div>
                                    <div style={{ font: "400 10px var(--mono)", color: "var(--txt-3)" }}>
                                        {[s.location, s.source].filter(Boolean).join(" · ")}
                                        {s.lat != null ? " · on the map →" : ""}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </>
                )}
            </div>

            {d.explanation && (
                <div style={{
                    flexShrink: 0, padding: "8px 13px", borderTop: "1px solid var(--gline)",
                    font: "400 10.5px/1.5 var(--font)", color: "var(--txt-3)",
                }}>
                    Written by a model from the signals above. It is not an assessment and
                    nothing in it was checked.
                </div>
            )}
        </div>
    )
}
