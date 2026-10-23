/**
 * MapLegend.jsx — the map's legend, ONE definition for the desktop and the phone (lib/mapIcons.js legendRows):
 * what a shape says (what kind of knowledge), what a colour says (what it means to you), and the states. Every
 * swatch is the real marker image the maps draw, at its real size.
 */
import { legendRows } from "../lib/mapIcons.js"

export default function MapLegend({ compact = false, className = "", style = null }) {
    const sections = legendRows()
    return (
        <div className={`map-legend ${className}`} data-testid="map-legend" style={{ display: "flex", flexDirection: "column", gap: compact ? 8 : 10, ...style }}>
            {sections.map((s) => (
                <div key={s.section}>
                    <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.6, marginBottom: 4 }}>{s.section}</div>
                    <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr 1fr" : "1fr", gap: "3px 10px" }}>
                        {s.rows.map((r) => (
                            <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 22 }} data-legend-key={r.key}>
                                <span style={{ width: 30, display: "inline-flex", justifyContent: "center", flex: "none" }}>
                                    <img src={r.uri} width={r.w} height={r.h} alt="" style={{ display: "block" }} />
                                </span>
                                <span style={{ fontSize: 12 }}>{r.label}</span>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    )
}
