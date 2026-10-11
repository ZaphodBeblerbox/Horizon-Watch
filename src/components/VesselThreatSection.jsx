/**
 * VesselThreatSection.jsx — a Russia-linked vessel loitering off Europe,
 * opened LIVE from its alert card (backend/vessel_threat.py).
 *
 * Opening the section opens the vessel on the globe (GlobeVesselThreatLayer):
 * current position from live AIS, the last 24 h trail, the Shahed/Geran-class
 * drone rings and the targets in reach. Here: the vessel-of-concern score
 * with its reasons, the top ten targets (distance, flight time), and
 * "Simulate" — a drone flown to a target on the globe, labelled as a
 * simulation of what is in reach, never a prediction.
 */
import { useEffect, useState } from "react"
import SectionLabel from "../inspector/SectionLabel.jsx"
import Loading from "../ui/Loading.jsx"
import {
  closeVesselThreat, getVesselThreat, openVesselThreat, simulateVesselThreat, stopSimulation, subscribeVesselThreat,
} from "../state/vesselThreatStore.js"
import { SIM_LABEL, fmtMinutes } from "../globe/vesselThreat.js"

const TIER_COLOR = { critical: "var(--red, #ff3b30)", high: "var(--amber, #ff9f43)", elevated: "var(--amber, #ffd166)", watch: "var(--txt-3)" }

function useVesselThreat() {
  const [s, setS] = useState(getVesselThreat())
  useEffect(() => subscribeVesselThreat(setS), [])
  return s
}

const btn = (primary) => ({
  font: "600 12px var(--font)", padding: "6px 10px", borderRadius: 6, cursor: "pointer",
  border: `1px solid ${primary ? "color-mix(in srgb, var(--amber, #ff9f43) 60%, transparent)" : "var(--border-dim)"}`,
  background: primary ? "color-mix(in srgb, var(--amber, #ff9f43) 18%, transparent)" : "transparent",
  color: "var(--txt, var(--text-primary))",
})

export default function VesselThreatSection({ mmsi, lat, lon }) {
  const s = useVesselThreat()
  useEffect(() => {
    if (!mmsi) return undefined
    window.dispatchEvent(new CustomEvent("akili:open-map"))
    openVesselThreat(mmsi, { lat, lon })
    return () => closeVesselThreat()
  }, [mmsi, lat, lon])

  if (s.mmsi !== String(mmsi) || (s.loading && !s.data)) {
    return (
      <div style={{ marginBottom: "var(--space-4)" }}>
        <SectionLabel>Vessel of concern</SectionLabel>
        <Loading size={18} inline label="Opening the vessel live" />
      </div>
    )
  }
  const d = s.data
  if (!d || d.available === false) {
    return (
      <div style={{ marginBottom: "var(--space-4)" }}>
        <SectionLabel>Vessel of concern</SectionLabel>
        <div style={{ font: "400 11.5px var(--font)", color: "var(--txt-4)" }}>{s.error || d?.reason || "Not available."}</div>
      </div>
    )
  }
  const a = d.assessment || {}
  const simT = s.sim ? d.targets?.[s.sim.index] : null
  return (
    <div style={{ marginBottom: "var(--space-4)" }} data-testid="vessel-threat-section">
      <SectionLabel meta={d.vessel?.position_source}>Vessel of concern</SectionLabel>
      {d.synthetic && (
        <div role="note" style={{ margin: "0 0 6px", padding: "6px 9px", borderRadius: 6, border: "1px dashed var(--border-dim)", font: "600 12px var(--font)" }}>
          Synthetic demonstration vessel — not a real ship.
        </div>
      )}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "2px 0 6px" }}>
        <span style={{ font: "700 22px var(--font)", fontVariantNumeric: "tabular-nums", color: TIER_COLOR[a.tier] || "var(--txt)" }}>{a.score}</span>
        <span style={{ font: "600 12px var(--font)", color: TIER_COLOR[a.tier] || "var(--txt)" }}>{a.tier_label}</span>
        <span style={{ font: "400 11px var(--font)", color: "var(--txt-4)" }}>
          · {a.in_range_count} targets within {d.drone?.in_range_km} km, {a.high_value_count} high-value
        </span>
      </div>
      <ul style={{ margin: "0 0 8px", paddingLeft: 16, font: "400 11.5px/1.45 var(--font)", color: "var(--txt-2, var(--text-primary))" }}>
        {(a.lines || []).slice(0, -1).map((l) => <li key={l}>{l}</li>)}
      </ul>

      <div style={{ font: "600 11px var(--font)", color: "var(--txt-2)", margin: "8px 0 2px" }}>
        In reach — top {d.targets?.length || 0} (weight × importance × proximity; flight time at {d.drone?.cruise_kmh} km/h)
      </div>
      <ol style={{ margin: 0, paddingLeft: 18, font: "400 11.5px var(--font)" }}>
        {(d.targets || []).map((t, i) => (
          <li key={`${t.name}-${i}`} style={{ padding: "3px 0", borderBottom: "1px solid var(--border-dim)", cursor: "pointer" }}
              onClick={() => window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: t.lat, lon: t.lon, altitude: 40_000 } }))}>
            <div style={{ color: "var(--txt, var(--text-primary))" }}>{t.name}</div>
            <div style={{ fontSize: 10.5, color: "var(--txt-4)", fontVariantNumeric: "tabular-nums" }}>
              {t.type_label}{t.country ? ` · ${t.country}` : ""} · {Math.round(t.distance_km)} km · ~{fmtMinutes(t.flight_min)}
              {" "}· weight {t.weight}{t.events?.length ? ` · ${t.events.join(", ")}` : ""}
              <button type="button" style={{ ...btn(false), padding: "1px 6px", marginLeft: 6, fontSize: 10.5 }}
                      onClick={(e) => { e.stopPropagation(); simulateVesselThreat(i) }}>Simulate</button>
            </div>
          </li>
        ))}
      </ol>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0 6px" }}>
        <button type="button" style={btn(true)} onClick={() => simulateVesselThreat(0)} disabled={!d.targets?.length}>
          Simulate drone flight
        </button>
        {s.sim && <button type="button" style={btn(false)} onClick={stopSimulation}>Stop simulation</button>}
        <button type="button" style={btn(false)} onClick={() => openVesselThreat(mmsi, { lat, lon })}>Refresh live</button>
      </div>
      <div role="note" style={{ font: "500 11px var(--font)", color: "var(--txt-3)", padding: "6px 9px", border: "1px solid var(--border-dim)", borderRadius: 6 }}>
        <b>{SIM_LABEL}.</b> {d.drone?.class}: {d.drone?.cruise_kmh} km/h cruise, rings at {(d.rings_km || []).join(" / ")} km —
        public open-source estimates.{simT ? ` Flying to ${simT.name}: ~${fmtMinutes(simT.flight_min)}.` : ""}
      </div>
      {a.weights_source && <div style={{ font: "400 10px var(--font)", color: "var(--txt-4)", marginTop: 4 }}>Target weights: {a.weights_source}</div>}
    </div>
  )
}
