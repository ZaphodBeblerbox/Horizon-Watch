/**
 * StrikeTiming.jsx — Insight › What happens next: the quiet indicators that
 * come before a strike (backend/strike_timing.py). Folded to one line by
 * default; never a notification. Each indicator says what it measured,
 * against what, and whether that is unusual — an analyst glances at it,
 * nothing acts on it automatically.
 */
import { useEffect, useState } from "react"
import API_BASE from "../apiBase.js"

const EYEBROW = { fontFamily: "var(--mz-font-mono)", fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--txt4)" }

export default function StrikeTiming({ onOpenModule = () => {} }) {
    const [d, setD] = useState(null)
    const [open, setOpen] = useState(() => { try { return localStorage.getItem("plx-strike-timing-open") === "1" } catch { return false } })
    const [detail, setDetail] = useState(null)
    useEffect(() => {
        let live = true
        const load = () => fetch(`${API_BASE}/api/indicators/strike-timing`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null)).then((x) => { if (live && x) setD(x) }).catch(() => {})
        load()
        const t = setInterval(load, 5 * 60_000)
        return () => { live = false; clearInterval(t) }
    }, [])
    if (!d) return null
    const toggle = () => { const v = !open; setOpen(v); try { localStorage.setItem("plx-strike-timing-open", v ? "1" : "0") } catch { /* private mode */ } }
    return (
        <div data-testid="strike-timing" style={{ border: "1px solid var(--gline)", background: "var(--glass2)", marginBottom: 18 }}>
            <button onClick={toggle} aria-expanded={open} style={{ display: "flex", alignItems: "baseline", gap: 10, width: "100%", padding: "10px 14px", border: 0, background: "none", cursor: "pointer", textAlign: "left", color: "var(--txt)" }}>
                <span style={{ font: "400 10px var(--mono)", color: "var(--txt4)" }}>{open ? "▾" : "▸"}</span>
                <span style={EYEBROW}>Strike-timing indicators</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: d.elevated ? "var(--txt)" : "var(--txt3)" }}>{d.summary}</span>
            </button>
            {open && (
                <div style={{ padding: "0 14px 12px" }}>
                    {d.indicators.map((i) => (
                        <div key={i.id} style={{ borderTop: "1px solid var(--gline)", padding: "8px 0" }}>
                            <div style={{ display: "grid", gridTemplateColumns: "12px minmax(0, 220px) 70px minmax(0, 1fr)", gap: 10, alignItems: "baseline" }}>
                                <i aria-label={i.elevated ? "elevated" : "normal"} style={{ width: 7, height: 7, transform: "rotate(45deg)", background: i.elevated ? "var(--sev-high)" : "transparent", border: i.elevated ? 0 : "1px solid var(--txt4)" }} />
                                <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--txt)" }}>{i.label}</span>
                                <span style={{ font: "500 13px var(--mono)", color: "var(--txt)" }}>{i.value}</span>
                                <span style={{ fontSize: 12, color: "var(--txt2)", lineHeight: 1.5 }}>
                                    {i.text}
                                    {i.detail?.length > 0 && (
                                        <button onClick={() => setDetail(detail === i.id ? null : i.id)} style={{ marginLeft: 6, border: 0, background: "none", padding: 0, cursor: "pointer", font: "400 11px var(--mono)", color: "var(--acc-hi, var(--acchi))" }}>
                                            {detail === i.id ? "hide" : i.id === "week" ? "the list" : "which"}
                                        </button>
                                    )}
                                </span>
                            </div>
                            {detail === i.id && i.id === "week" && (
                                <div style={{ margin: "6px 0 0 22px", display: "grid", gridTemplateColumns: "88px 84px 1fr", gap: "2px 10px", fontSize: 11.5 }}>
                                    {i.detail.map((h) => (
                                        <div key={h.date} style={{ display: "contents", color: h.in_window ? "var(--txt2)" : "var(--txt4)" }}>
                                            <span style={{ fontFamily: "var(--mono)" }}>{h.date}</span><span>{h.weekday}</span><span>{h.what}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {detail === i.id && i.id === "c2isr" && (
                                <div style={{ margin: "6px 0 0 22px", display: "flex", flexWrap: "wrap", gap: 6 }}>
                                    {i.detail.map((a) => (
                                        <button key={a.callsign} onClick={() => { onOpenModule("map"); window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: a.lat, lon: a.lon, altitude: 900_000 } })) }}
                                                style={{ height: 24, padding: "0 10px", border: "1px solid var(--gline2)", background: "transparent", color: "var(--txt2)", font: "inherit", fontSize: 11.5, cursor: "pointer" }}>
                                            {a.type} {a.callsign} · show on the map
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                    <div style={{ fontSize: 11, color: "var(--txt4)", marginTop: 6 }}>{d.note} The reference list covers opening strikes of major US and Israeli operations since 1998.</div>
                </div>
            )}
        </div>
    )
}
