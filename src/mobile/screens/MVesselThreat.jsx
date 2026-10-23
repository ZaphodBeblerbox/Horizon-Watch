// Phone: a Russia-linked vessel loitering off Europe, from its alert card.
// The sheet shows the vessel-of-concern score, its reasons and the top ten
// targets in reach; "Show live on the map" draws it on the Leaflet map
// (drawVesselThreat): the last 24 h trail, target markers, and a
// dashed line to the top target with the drone's time to target — the
// phone's version of the desktop's simulated flight.
import { useEffect, useState } from "react"
import { fetchVesselThreat } from "../../state/vesselThreatStore.js"
import { SIM_LABEL, fmtMinutes, mmsiOf } from "../../globe/vesselThreat.js"
import { markerIcon, infraIcon, PHONE_ICON_SCALE } from "../../lib/mapIcons.js"

// markers in the one typology (lib/mapIcons.js): the vessel of concern a derived warning (triangle, flash), the targets
// in reach the typology's infrastructure glyphs (urgent for the ranked ones); no reach rings, no dots (owner, 2026-10-23)
const img = (L, i) => { const w = Math.round(i.w * PHONE_ICON_SCALE), h = Math.round(i.h * PHONE_ICON_SCALE); return L.icon({ iconUrl: i.uri, iconSize: [w, h], iconAnchor: [w / 2, h / 2] }) }


export function VesselThreatBlock({ s, onShowOnMap, onClose }) {
  const mmsi = mmsiOf(s, s?.id)
  // opened from its notification, the live view is already fetched
  const [d, setD] = useState(s?.vesselThreat || undefined)
  useEffect(() => {
    if (!mmsi) return undefined
    if (s?.vesselThreat && String(s.vesselThreat.mmsi) === String(mmsi)) { setD(s.vesselThreat); return undefined }
    let live = true
    setD(undefined)
    fetchVesselThreat(mmsi, { lat: s?.lat, lon: s?.lon }).then((x) => { if (live) setD(x) }).catch((e) => { if (live) setD({ available: false, reason: String(e?.message || e) }) })
    return () => { live = false }
  }, [mmsi]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!mmsi) return null
  if (d === undefined) return <div className="m2-sub" style={{ margin: "0 0 12px" }}>Opening the vessel live…</div>
  if (!d.available) return <div className="m2-sub" style={{ margin: "0 0 12px" }}>{d.reason || "Vessel view unavailable."}</div>
  const a = d.assessment || {}
  return (
    <div style={{ margin: "0 0 12px" }} data-testid="m2-vessel-threat">
      <div className="m2-eyebrow" style={{ marginBottom: 4 }}>Vessel of concern · {a.score}/100 · {a.tier_label}</div>
      {d.vessel?.position_source && <div className="m2-sub" style={{ margin: "0 0 6px" }}>Position: {d.vessel.position_source}</div>}
      <ul style={{ margin: "0 0 8px", paddingLeft: 18, fontSize: 13, lineHeight: 1.45 }}>
        {(a.lines || []).slice(0, 4).map((l) => <li key={l}>{l}</li>)}
      </ul>
      <div className="m2-eyebrow" style={{ marginBottom: 4 }}>In reach — top {d.targets?.length || 0}</div>
      <ol style={{ margin: "0 0 8px", paddingLeft: 20, fontSize: 13 }}>
        {(d.targets || []).map((t, i) => (
          <li key={`${t.name}-${i}`} style={{ padding: "2px 0" }}>
            {t.name} <span className="m2-sub" style={{ display: "inline" }}>· {t.type_label} · {Math.round(t.distance_km)} km · ~{fmtMinutes(t.flight_min)}</span>
          </li>
        ))}
      </ol>
      <button className="m2-btn" onClick={() => { onShowOnMap?.({ lat: d.vessel.lat, lon: d.vessel.lon, vesselThreat: d, _t: Date.now() }); onClose?.() }}>
        Show live on the map
      </button>
      <div className="m2-sub" style={{ marginTop: 6 }}>{SIM_LABEL}. Drone figures are public open-source estimates.</div>
    </div>
  )
}

// A target in reach is infrastructure context: the typology's line glyph for what it is (owner, 2026-10-23 evening:
// no big circles, no black dots; the icons used everywhere else). The ranked ones in the urgent colour.
const targetGlyph = (t) => {
  const k = `${t.type || ""} ${t.type_label || ""}`.toLowerCase()
  if (/port|harbou?r|terminal|lng/.test(k)) return "port"
  if (/air(port|field|base)/.test(k)) return "airport"
  if (/power|plant|nuclear|substation|grid/.test(k)) return "power_plant"
  if (/refiner|oil|fuel|depot/.test(k)) return "refinery"
  if (/cable|telecom|data/.test(k)) return "telecom_mast"
  if (/military|naval|base/.test(k)) return "military"
  return "Sites"
}

/** Draw the live view into a Leaflet layer group; returns bounds to fit. */
export function drawVesselThreat(L, g, d) {
  g.clearLayers()
  if (!d?.vessel) return null
  const { lat, lon } = d.vessel
  // the reach is in the card's words (the drone's range), not drawn as big rings on the map
  const trail = (d.trail || []).map(([a, b]) => [a, b])
  if (trail.length > 1) L.polyline([...trail, [lat, lon]], { color: "#4fc3f7", weight: 3 }).addTo(g)
  ;(d.markers || []).forEach((t) => {
    const rank = (d.targets || []).findIndex((x) => x.name === t.name && x.lat === t.lat)
    const top = rank >= 0
    const m = L.marker([t.lat, t.lon], { icon: img(L, infraIcon({ glyph: targetGlyph(t), priority: top ? "urgent" : null })), keyboard: false })
      .bindTooltip(`${top ? `${rank + 1}. ` : ""}${t.name} · ${t.type_label} · ${Math.round(t.distance_km)} km · ~${fmtMinutes(t.flight_min)}`)
    m.addTo(g)
  })
  const t0 = d.targets?.[0]
  if (t0) {
    L.polyline([[lat, lon], [t0.lat, t0.lon]], { color: "#ffffff", weight: 2, dashArray: "6 6", interactive: false }).addTo(g)
    L.marker([(lat + t0.lat) / 2, (lon + t0.lon) / 2], {
      interactive: false,
      icon: L.divIcon({ className: "", html: `<span style="font:600 11px var(--font);color:#ffe2b8;background:rgba(0,0,0,.6);padding:2px 5px;border-radius:4px;white-space:nowrap">Simulation · ~${fmtMinutes(t0.flight_min)} to ${t0.name}</span>` }),
    }).addTo(g)
  }
  L.marker([lat, lon], { icon: img(L, markerIcon({ kind: "derived", glyph: "Vessels", priority: "flash" })), keyboard: false, zIndexOffset: 600 })
    .bindTooltip(`${d.synthetic ? "SYNTHETIC — " : ""}${d.vessel.name || `MMSI ${d.mmsi}`} · ${d.assessment?.score}/100`, { permanent: true, direction: "top" })
    .addTo(g)
  const r = Math.min(...(d.rings_km || [300]).filter((k) => k >= 250), 400)
  return L.latLng(lat, lon).toBounds(r * 2000)
}
