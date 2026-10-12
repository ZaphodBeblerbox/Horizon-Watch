/**
 * EndangeredPlaceDetail.jsx — the top of an endangered place's inspector
 * card: the place's 3D model turning slowly (owner, 2026-10-12: "all we
 * want is the 3D model slowly rotating in the sidebar" — never on the map),
 * and, when the place has no call of its own but one is near ("Active
 * only"), which call, where and how far. The rows below are the adapter's
 * (adapters.js adaptEndangeredPlace).
 */
import PlaceModel from "../assets/PlaceModel.jsx"
import { distanceLabel } from "../globe/endangeredPlaces.js"

const flyTo = (lat, lon, altitude = 6_000) => window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat, lon, altitude } }))

export default function EndangeredPlaceDetail({ place }) {
    const p = place || {}
    const near = Array.isArray(p.nearby_calls) ? p.nearby_calls : []
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3, 12px)", marginBottom: "var(--space-4, 16px)" }}>
            <PlaceModel key={p.id} place={p} height={230} />
            {p.active === "nearby" && near.length > 0 && (
                <div data-testid="nearby-call" style={{ border: "1px solid rgba(245,165,36,.45)", background: "rgba(245,165,36,.08)",
                                                        borderRadius: 8, padding: "10px 12px", fontSize: "var(--text-sm, 13px)", lineHeight: 1.45 }}>
                    <div style={{ fontWeight: 600, color: "#F5A524", marginBottom: 4 }}>
                        Nearby call · {distanceLabel(near[0].distance_km)} away
                    </div>
                    <div style={{ color: "var(--txt)" }}>
                        No call here, but{" "}
                        <button type="button" onClick={() => flyTo(near[0].lat, near[0].lon)}
                                style={{ border: 0, padding: 0, background: "none", color: "var(--acchi, #8fb4e8)", font: "inherit", cursor: "pointer", textDecoration: "underline" }}>
                            {near[0].name}{near[0].city && !String(near[0].name || "").includes(near[0].city) ? ` (${near[0].city})` : ""}
                        </button>
                        {" "}has one: {near[0].line || near[0].call}
                    </div>
                    {near.length > 1 && (
                        <div style={{ color: "var(--txt3)", marginTop: 4 }}>
                            Also within reach: {near.slice(1, 4).map((n) => `${n.name} (${distanceLabel(n.distance_km)}${n.call ? `, ${n.call.toLowerCase()}` : ""})`).join("; ")}
                            {(p.nearby_count || near.length) > 4 ? `; and ${(p.nearby_count || near.length) - 4} more` : ""}.
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
