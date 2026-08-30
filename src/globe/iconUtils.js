// Real, still-used vessel/aircraft classification helpers.
//
// This file used to also hold a grab-bag of ad hoc canvas icon builders
// (makeAircraftCanvas, makeVesselCanvas, makeEventCanvas, makeChokepointCanvas,
// makeAlertCanvas, makeAssessmentCanvas, makeFusionCanvas, makeTypedEventCanvas,
// makePortCanvas, makeAirportCanvas, altColorHex) plus their supporting path/
// color tables. All of that has been superseded by the real MIL-STD-inspired
// affiliation+entity-function symbology in ./markerRenderer.js, which every
// globe layer now uses for billboard icons — see that file for the canonical
// icon system. What remains here is real classification logic with no icon-
// drawing code of its own: vesselShipType()/VESSEL_COLORS (used by
// GlobeVesselPopup.jsx for its accent color) and acClassify() (used by
// markerRenderer.js's aircraft entity-function resolver).

// ── Vessel ship-type classification ───────────────────────────────────────────

export const VESSEL_COLORS = {
    tanker:    "#f59e0b",
    cargo:     "#14b8a6",
    container: "#06b6d4",
    military:  "#ef4444",
    passenger: "#3b82f6",
    fishing:   "#84cc16",
    other:     "#64748b",
}

export function vesselShipType(vessel) {
    const t = (vessel.ship_type || "").toLowerCase()
    if (t.includes("tanker") || t.includes("oil") || t.includes("lng") || t.includes("lpg")) return "tanker"
    if (t.includes("container")) return "container"
    if (t.includes("cargo") || t.includes("bulk") || t.includes("general")) return "cargo"
    if (t.includes("passenger") || t.includes("cruise") || t.includes("ferry")) return "passenger"
    if (t.includes("military") || t.includes("naval") || t.includes("warship")) return "military"
    if (t.includes("fishing") || t.includes("trawler")) return "fishing"
    return "other"
}

// ── Aircraft classification ───────────────────────────────────────────────────
export function acClassify(ac) {
    if (ac.military || ac.interesting) return "military"
    const cat = ac.category || ""
    if (cat === "A7") return "helicopter"
    if (["A1", "A2"].includes(cat)) return "general"
    if (["A3", "A4", "A5", "A6"].includes(cat)) return "commercial"
    const cs = (ac.flight || "").trim().toUpperCase()
    if (/^[A-Z]{3}\d/.test(cs)) return "commercial"
    return "general"
}
