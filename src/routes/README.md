# Route planning (src/routes)

One sidebar, `RoutePanel.jsx`, for every route the app plans. Today it does the safest exit (on foot, by car) and
deliveries/access by truck. Other modes plug into the same panel: maritime, air, trip, site evacuation, convoy,
medevac, truck/blockade and approach path.

## Pieces

| file | what |
|---|---|
| `RoutePanel.jsx` | the panel. `variant="desktop"` is a right-side panel over the globe (GlobeView); `variant="phone"` is a full-height sheet with its own Leaflet map (MobileApp). |
| `store.js` | `openRoutePanel({request, planId?, title?})`, `updateRequest(patch)`, `closeRoutePanel()`, `publishPlan(plan)` |
| `usePlan.js` | plans (`POST /api/routes/plan`) or opens a saved plan (`GET /api/routes/{id}`), then re-checks it every minute |
| `api.js` | `planRoute`, `getPlan`, `sendPlan`, `routeContext` |
| `registry.js` | **mode registry** (`registerMode`) and **provider registry** (`registerProvider`) |
| `contexts.js` | **when the panel opens on its own**: `registerRouteContext(kind, {title, request})`, `openContext`, `openFromNotification` |
| `RouteContextCards.jsx` | the "Exit route" and "Deliveries / access route" cards (inspector, phone asset sheet) |
| `routeLayer.leaflet.js` / `routeLayer.cesium.jsx` | the plan drawn on a Leaflet map and on the globe: hazard rings, the safest route in green, the fastest grey and dashed, the start and the safe point |
| `view.js` | pure words and states (tested in `routes.test.js`) |

## The request

```js
openRoutePanel({ request: {
  from: { asset_id } | { me: true } | { lat, lon, label },   // null with purpose "access": the approach starts outside
  to:   null /* nearest safe point */ | { lat, lon, name } | { asset_id },
  mode: "foot" | "car" | "truck" | <registered>,
  depart_at: ISO | null,
  avoid: [provider names] | null /* the mode's defaults */,
  purpose: "exit" | "access" | <yours>,
}})
```

The server answers with `{id, candidates: [{key, role, why, exposure, distance_m, duration_s, steps, coords …}],
safest, fastest, hazards, explanation, links, subject: {can_send, …}, status}`. The full contract is in the
`backend/safe_route.py` docstring. The endpoints are in `backend/routers/routes.py`.

## Adding a planner

1. Backend (`backend/safe_route.py`): `register_mode(name, label, valhalla=…, osrm=…, speed_mps, providers,
   kind_weight, hard, dest_m)`. Add `register_provider(name, label, fn)` for the hazards your mode cares about,
   e.g. piracy zones or NOTAMs. A mode whose router is not Valhalla or OSRM (sea lanes, airways) needs its own
   candidate generator. Plug it in where `plan()` gathers `jobs`. `exposure()` and the scoring then work unchanged.
2. Frontend: `registerMode(name, {label, order, defaultAvoid, travel})` and `registerProvider(name, {label, hint})`
   in `registry.js`. The chips appear in the panel. A planner with its own UI registers a module instead,
   `registerModeModule({key, label, order, Component})`. When its chip is chosen, the panel shows
   `<Component panel request variant onClose />` in place of the street-route output, and skips the street planner.
3. If your planner opens on its own, have `GET /api/routes/context` return `{kind: "<yours>", title, reason, …}`
   and call `registerRouteContext("<yours>", {title, request: (ctx, subject) => ({...})})`.

## Safe houses / multi-hop (backend)

`plan(..., destinations=[{lat, lon, name, id?}, …])` takes up to 5 explicit destinations.
`await safe_route.nearest_reachable(lat, lon, destinations, mode, …)` returns the least-exposed destination that can be
reached without crossing a core: `{destination, route, plan, tried}`. Over HTTP, `POST /api/routes/plan` with
`to: {lat, lon, name}` plans to one destination.

## Triggers wired today

- A "Leave now" notification (`backend/exit_watch.py`) opens the panel on that person's exit route
  (`notify/openSignal.js`, action `exit`). It uses the saved plan the alert was raised with, re-checked.
- An asset or person within 1 km of a hazard shows an "Exit route" card in the inspector and on the phone's
  asset sheet.
- A site with an endangered-place call within 2 km in the next 48 h shows a "Deliveries / access route" card,
  planned by truck, which never crosses a called roadblock.
- "Get me out" on the phone map, and "Safest route" or "Send safest route" on an asset.
