/**
 * air.js — the Flights route mode, for the route planner's mode registry
 * (src/routes/registry.js, README.md):
 *
 *   { key: "air", label: "Flights", Component, relevant(ctx) }
 *
 *   Component     AirRoute.jsx — the mode's body: from/to airports or a live
 *                 aircraft, candidates with exposure bars, extra time, the
 *                 trade-off sentence, the hazards and their sources.
 *   relevant(ctx) true for a selected/tracked aircraft ("trk:adsb-<hex>",
 *                 {icao}) or a trip by air ({kind: "trip", travel: "air",
 *                 from, to}); WHY it is worth a look comes from the server
 *                 (whyRelevant → GET /api/routes/air/context), which says
 *                 whether the path crosses a conflict-zone bulletin area,
 *                 recent strike activity or GPS interference.
 *   open(ctx)     opens the Flights panel (AirRoutePanel) on that context.
 *
 * Importing this file registers the aircraft inspector's offer ("Check this
 * flight's route", AirRouteOffer) as an inspector extension.
 */
import { AirRouteOffer, AirRouteInPanel } from "./AirRoute.jsx"
import { isFlightContext, fetchAirContext, openAirRoute, aircraftHex } from "./airRoute.js"
import { registerInspectorExtension } from "../../inspector/extensionRegistry.js"
import { registerModeModule } from "../registry.js"

export function relevant(ctx) { return isFlightContext(ctx) }

/** {relevant, reason, label, risk} from the server, for a context relevant() accepted. */
export function whyRelevant(ctx) {
    const hex = aircraftHex(ctx)
    return fetchAirContext(hex ? { icao: hex } : { from: ctx.from, to: ctx.to })
}

export function open(ctx) {
    const hex = aircraftHex(ctx)
    openAirRoute(hex ? { icao: hex } : { from: ctx?.from, to: ctx?.to })
}

const airMode = { key: "air", label: "Flights", order: 60, travel: "flying", Component: AirRouteInPanel, relevant, whyRelevant, open }
export default airMode

let registered = false
export function registerAirInspectorOffer() {
    if (registered) return
    registered = true
    registerInspectorExtension(AirRouteOffer)
}
registerAirInspectorOffer()
registerModeModule(airMode)      // the "Flights" chip in the shared route panel (src/routes/README.md)
