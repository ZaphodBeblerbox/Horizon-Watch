/**
 * maritime.js — the "Shipping" mode of the route planner: the safest sea
 * route (Suez vs Cape, strike zones, piracy, GPS interference), planned by
 * backend/sea_route.py over POST /api/routes/sea.
 *
 *   key         "sea"
 *   label       "Shipping"
 *   Component   MaritimeRoute.jsx (the panel body; standalone sidebar: SeaRouteSidebar)
 *   relevant    (ctx) → false | {offer, why, reasons} — ctx = {entityType: "vessel", mmsi,
 *               seaContext: GET /api/routes/sea/context?mmsi=…}; fetch it with fetchContext
 *   open        (ctx) opens the panel from a context (the vessel → its destination)
 */
import MaritimeRoute from "./MaritimeRoute.jsx"
import { relevant, seaContext, openSeaRoute, requestFromContext } from "./maritimeCore.js"

const maritime = {
    key: "sea",
    label: "Shipping",
    order: 60,
    Component: MaritimeRoute,
    relevant,
    fetchContext: (ctx) => seaContext(ctx.mmsi).then((seaCtx) => ({ ...ctx, seaContext: seaCtx })),
    open: (ctx) => openSeaRoute(requestFromContext(ctx)),
}

export default maritime
export const { key, label, Component } = maritime
export { relevant }
