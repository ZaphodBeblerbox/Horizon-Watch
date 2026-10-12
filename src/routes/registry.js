/**
 * registry.js — the route planner's MODES and hazard PROVIDERS, on the
 * client. The server has the same names (backend/safe_route.py
 * register_mode / register_provider); GET /api/routes/modes lists them.
 *
 * A planner added later (maritime, air, trip, site evacuation, convoy,
 * medevac, truck/blockade, approach path) registers its mode here — its
 * label, the providers it avoids by default, and optionally its own
 * inputs (`fields`) and its own request builder (`toRequest`) — and the
 * panel (RoutePanel.jsx) shows it among the mode chips. See README.md.
 */

const modes = new Map()
const providers = new Map()

/** def: {label, order?, defaultAvoid?: [provider], travel: "walking"|"driving", fields?: [..], toRequest?(state) → body} */
export function registerMode(name, def) { modes.set(name, { name, order: 50, ...def }) }
export function registerProvider(name, def) { providers.set(name, { name, ...def }) }
/** A mode module as the other planners write it — {key, label, order, Component?, relevant?, fetchContext?, open?}.
 *  With a Component, the panel shows that component for the mode instead of the street-route output. */
export function registerModeModule(m) { registerMode(m.key || m.name, m) }
export function getMode(name) { return modes.get(name) || modes.get("foot") }
export function listModes() { return [...modes.values()].sort((a, b) => a.order - b.order) }
export function listProviders() { return [...providers.values()] }
export function defaultAvoid(mode) { return [...(getMode(mode)?.defaultAvoid || listProviders().map((p) => p.name))] }

const ALL = ["unrest", "endangered_calls", "violence", "strikes", "roadblocks"]
registerProvider("unrest", { label: "Unrest", hint: "kettles, charges, tear gas, announced gatherings (Telegram)" })
registerProvider("endangered_calls", { label: "Called gatherings", hint: "public calls to gather or act at a place" })
registerProvider("violence", { label: "Violence", hint: "alerts about violence, unrest, crime; verified footage" })
registerProvider("strikes", { label: "Strikes", hint: "strike pickets" })
registerProvider("roadblocks", { label: "Roadblocks", hint: "called roadblocks, convoys, blockades, closures" })

registerMode("foot", { label: "On foot", order: 10, defaultAvoid: ALL, travel: "walking" })
registerMode("car", { label: "By car", order: 20, defaultAvoid: ALL, travel: "driving" })
registerMode("truck", { label: "Truck", order: 30, defaultAvoid: ALL, travel: "driving", note: "Never crosses a called roadblock, blockade or convoy." })
