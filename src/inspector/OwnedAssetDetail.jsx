/**
 * OwnedAssetDetail.jsx — one of our assets, in the inspector (a click on its
 * pin on the map). Its model turning slowly, how exposed it is, where it
 * is, what identifies it, and the signals nearest in importance — with the
 * full page (brief, map, every signal) one click away.
 */
import { useEffect, useState } from "react"
import API_BASE from "../apiBase.js"
import AssetModel from "../assets/AssetModel.jsx"
import SectionLabel from "./SectionLabel.jsx"
import { agoLabel } from "../utils/formatTime.js"

const EXPO = { high: "#E5484D", elevated: "#F5A524", low: "#8FB4E8", quiet: "#4CAF7A", unknown: "#9AA9BC" }
const EXPO_TEXT = { high: "Exposed — serious events close by", elevated: "Something is happening nearby", low: "Minor activity nearby", quiet: "Quiet around it", unknown: "No position to judge from" }
const SEV = { critical: "#E5484D", high: "#F5A524", significant: "#F5A524", elevated: "#8FB4E8" }
const ID = { mmsi: "MMSI", imo: "IMO", icao: "ICAO hex", registration: "Registration", plate: "Plate" }
const ROW = { display: "grid", gridTemplateColumns: "minmax(100px, max-content) minmax(0, 1fr)", gap: "6px 14px", fontSize: "var(--text-sm)" }
const BTN = { height: 30, padding: "0 12px", border: "1px solid var(--acchi)", background: "var(--accdim)", color: "var(--txt)", font: "inherit", fontSize: 12.5, cursor: "pointer", borderRadius: 6 }

export function openAssetPage(id) {
    window.__plxAssetSel = id
    window.dispatchEvent(new CustomEvent("akili:navigate", { detail: { destination: "assets" } }))
    window.dispatchEvent(new CustomEvent("akili:open-asset", { detail: { id } }))
}

export default function OwnedAssetDetail({ asset }) {
    const a = asset || {}
    const [s, setS] = useState(null)
    useEffect(() => {
        if (!a.id) return undefined
        let live = true
        setS(null)
        fetch(`${API_BASE}/api/my-assets/${encodeURIComponent(a.id)}/situation`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null)).then((d) => { if (live) setS(d || { signals: [] }) }).catch(() => { if (live) setS({ signals: [] }) })
        return () => { live = false }
    }, [a.id])
    const expo = s?.exposure || a.exposure || "unknown"
    const pos = s?.position || a.position
    const facts = [
        ["Type", a.kind_label],
        ["Importance", a.importance],
        ["Where", a.address || (pos ? `${(+pos.lat).toFixed(4)}, ${(+pos.lon).toFixed(4)}` : null)],
        ["Position", pos?.source ? `${pos.source}${pos.as_of ? ` · ${agoLabel(pos.as_of)}` : ""}` : null],
        ["Country", a.country],
        ["Watch radius", a.radius_km ? `${Math.round(a.radius_km)} km` : null],
        ...Object.entries(a.identifiers || {}).map(([k, v]) => [ID[k] || k, v]),
        ["Shared", a.shared ? "with the team" : null],
    ].filter(([, v]) => v)
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", marginBottom: "var(--space-4)" }}>
            <div style={{ position: "relative", border: "1px solid var(--gline)", borderRadius: 8, overflow: "hidden",
                          background: "radial-gradient(ellipse at 50% 62%, rgba(201,162,39,.10), transparent 72%)" }}>
                <AssetModel kind={a.kind} height={250} />
                <span style={{ position: "absolute", left: 10, bottom: 8, fontFamily: "var(--mz-font-mono)", fontSize: 10, letterSpacing: ".12em",
                               textTransform: "uppercase", color: "var(--txt4)" }}>{a.kind_label} · drag to turn</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <i style={{ width: 9, height: 9, borderRadius: "50%", background: EXPO[expo] || EXPO.unknown }} />
                <span style={{ fontSize: 13.5, color: "var(--txt)" }}>{EXPO_TEXT[expo] || expo}</span>
                <div style={{ flex: 1 }} />
                <button style={BTN} onClick={() => openAssetPage(a.id)}>Full page →</button>
            </div>
            <div>
                <SectionLabel>Essentials</SectionLabel>
                <div style={ROW}>
                    {facts.map(([k, v]) => [
                        <span key={`k-${k}`} style={{ color: "var(--txt3)" }}>{k}</span>,
                        <span key={`v-${k}`} style={{ color: "var(--txt)", wordBreak: "break-word" }}>{String(v)}</span>,
                    ])}
                </div>
                {a.notes && <div style={{ fontSize: 12.5, color: "var(--txt2)", marginTop: 8, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{a.notes}</div>}
            </div>
            <div>
                <SectionLabel meta={s?.signals ? `${s.signals.length} within ${Math.round(a.radius_km || 0)} km · 72 h` : null}>What matters near it</SectionLabel>
                {!s && <span style={{ fontSize: 12.5, color: "var(--txt3)" }}>Ranking what is near it…</span>}
                {s?.signals?.length === 0 && <span style={{ fontSize: 12.5, color: "var(--txt3)" }}>{s.why || "Nothing reported within its radius in the last three days."}</span>}
                {(s?.signals || []).slice(0, 6).map((x) => (
                    <button key={x.id} onClick={() => window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: x.lat, lon: x.lon, altitude: 30_000 } }))} style={{
                        display: "grid", gridTemplateColumns: "10px minmax(0,1fr)", gap: "2px 8px", width: "100%", textAlign: "left", border: 0,
                        borderTop: "1px solid var(--gline)", padding: "7px 0", background: "transparent", color: "var(--txt)", font: "inherit", cursor: "pointer",
                    }}>
                        <i style={{ width: 7, height: 7, borderRadius: "50%", marginTop: 6, background: SEV[String(x.severity).toLowerCase()] || "#9AA9BC" }} />
                        <span style={{ fontSize: 13, lineHeight: 1.4 }}>{x.title}</span>
                        <span />
                        <span style={{ fontSize: 11.5, color: "var(--txt3)" }}>{[`${x.km} km`, x.when ? agoLabel(x.when) : null, x.source].filter(Boolean).join(" · ")}</span>
                    </button>
                ))}
            </div>
        </div>
    )
}
