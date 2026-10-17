/**
 * OutlookExplain.jsx — WHY WE THINK IT MAY FOLLOW (owner, 2026-10-17:
 * "'What may follow tonight' should have the explanation of why we think
 * that may follow, and also on the desktop"). A line of the outlook
 * (backend/outlook.py) opened: the statement and its probability, the
 * reason from the signals, the signals it cites (each with its place and a
 * link), what would make it true and by when, and what to watch for.
 *
 * It used to open the map at the first citation's position, which read as
 * "a random point on the map that makes no sense" — the position is now one
 * of the evidence rows, labelled as where that signal was.
 *
 * Shared by the phone (MHome's sheet) and the desktop (Home's dialog); the
 * host gives the type and colours through inherited CSS.
 */
const H = { fontSize: 12.5, fontWeight: 600, color: "var(--txt3, #9aa3b2)", margin: "16px 0 6px" }
const P = { margin: 0, fontSize: 14.5, lineHeight: 1.5, color: "var(--txt2, #c9cfda)" }

export default function OutlookExplain({ o, onShowPlace = null }) {
    if (!o) return null
    const cites = Array.isArray(o.citations) ? o.citations : []
    const watch = Array.isArray(o.watch_for) ? o.watch_for : []
    return (
        <div data-testid="outlook-explain">
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
                {o.probability != null && <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.02em", fontVariantNumeric: "tabular-nums" }}>{o.probability}%</span>}
                <span style={{ fontSize: 13, color: "var(--txt3, #9aa3b2)" }}>{[o.place, o.actor, o.resolves_by && `by ${o.resolves_by}`].filter(Boolean).join(" · ")}</span>
            </div>
            <h2 style={{ margin: "6px 0 0", fontSize: 19, lineHeight: 1.3, fontWeight: 650 }}>{o.statement}</h2>

            {o.because && <><div style={H}>Why we think so</div><p style={P}>{o.because}</p></>}

            {cites.length > 0 && <>
                <div style={H}>The signals behind it</div>
                <div style={{ display: "grid", gap: 8 }}>
                    {cites.map((c, i) => (
                        <div key={i} style={{ padding: "10px 12px", borderRadius: 14, border: "1px solid var(--gline, rgba(255,255,255,.08))", background: "rgba(255,255,255,.03)" }}>
                            <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.35 }}>{c.headline}</div>
                            <div style={{ fontSize: 12.5, color: "var(--txt3, #9aa3b2)", marginTop: 3 }}>
                                {[c.source, String(c.location || "").split(",").slice(0, 2).join(",")].filter(Boolean).join(" · ")}
                            </div>
                            <div style={{ display: "flex", gap: 14, marginTop: 6, fontSize: 12.5 }}>
                                {c.lat != null && c.lon != null && onShowPlace && (
                                    <button type="button" onClick={() => onShowPlace(c)}
                                            style={{ border: 0, background: "none", padding: 0, color: "var(--txt, #eef1f5)", textDecoration: "underline", cursor: "pointer", font: "inherit" }}>
                                        Where this happened
                                    </button>
                                )}
                                {c.url && <a href={c.url} target="_blank" rel="noreferrer" style={{ color: "var(--txt, #eef1f5)" }}>Source</a>}
                            </div>
                        </div>
                    ))}
                </div>
            </>}

            {o.criterion && <>
                <div style={H}>It comes true if</div>
                <p style={P}>{o.criterion}{o.resolves_by ? ` — by ${o.resolves_by}.` : ""}</p>
            </>}

            {watch.length > 0 && <>
                <div style={H}>Watch for</div>
                <ul style={{ ...P, paddingLeft: 18 }}>{watch.map((w, i) => <li key={i} style={{ marginBottom: 4 }}>{w}</li>)}</ul>
            </>}

            <p style={{ ...P, fontSize: 12.5, color: "var(--txt4, #6f7888)", marginTop: 16 }}>
                A forecast from the signals cited above, checked against its criterion when its date comes; never a certainty.
            </p>
        </div>
    )
}
