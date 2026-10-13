/**
 * SafeHouseFields.jsx — a safe house's own fields in the add / edit asset
 * forms (desktop Assets.jsx, phone MMore.jsx): open or closed, capacity and
 * how many are there now, the contact (who to call, how to get in), and who
 * may be sent there — people and teams; nobody named means anyone who can
 * see the house. Stored as the asset's `details` (owned_assets.clean_details).
 */
import { useEffect, useState } from "react"
import API_BASE from "../apiBase.js"

/** The groups whose assets can be declared a safe house: buildings and sites, never what moves. */
export const MOBILE_GROUPS = ["Vessels", "Aircraft", "Vehicles", "People"]
export const declarable = (kind) => !!kind && kind.key !== "safe_house" && !MOBILE_GROUPS.includes(kind.group)
export const isSafeHouse = (a) => !!a && (a.kind === "safe_house" || !!a.is_safe_house || (!!a.details?.safe_house && !MOBILE_GROUPS.includes(a.group)))

export const emptyDetails = () => ({ status: "open", capacity: "", occupancy: "", contact: "", allowed_users: [], allowed_teams: [] })

/** The form's values → what the server takes (numbers as numbers, blanks dropped). */
export function detailsBody(d) {
    const n = (v) => (v === "" || v == null ? null : Number(v))
    return {
        ...(d?.safe_house ? { safe_house: true } : {}),          // a building declared a safe house keeps its kind
        status: d?.status === "closed" ? "closed" : "open",
        capacity: n(d?.capacity), occupancy: n(d?.occupancy),
        contact: (d?.contact || "").trim() || null,
        allowed_users: d?.allowed_users || [],
        allowed_teams: (Array.isArray(d?.allowed_teams) ? d.allowed_teams : String(d?.allowed_teams || "").split(","))
            .map((x) => String(x).trim()).filter(Boolean),
    }
}

export default function SafeHouseFields({ value, onChange, inputStyle, labelStyle }) {
    const d = { ...emptyDetails(), ...(value || {}) }
    const set = (k, v) => onChange({ ...d, [k]: v })
    const [users, setUsers] = useState([])
    useEffect(() => {
        fetch(`${API_BASE}/api/users`, { credentials: "include" }).then((r) => (r.ok ? r.json() : [])).then((x) => setUsers(Array.isArray(x) ? x : (x.users || []))).catch(() => {})
    }, [])
    const IN = inputStyle || {}
    const LB = labelStyle || { fontSize: 12, opacity: 0.75, marginBottom: 5, display: "block" }
    const teams = Array.isArray(d.allowed_teams) ? d.allowed_teams.join(", ") : d.allowed_teams
    return (
        <fieldset data-testid="safe-house-fields" style={{ border: "1px solid rgba(46,158,91,.45)", padding: "10px 12px 12px", margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            <legend style={{ padding: "0 6px", fontSize: 12.5, fontWeight: 650, color: "#4fd08a" }}>Safe house</legend>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 10 }}>
                <label><span style={LB}>Status</span>
                    <select style={IN} value={d.status} onChange={(e) => set("status", e.target.value)} data-testid="sh-status">
                        <option value="open">Open</option><option value="closed">Closed</option>
                    </select></label>
                <label><span style={LB}>Capacity (people)</span>
                    <input style={IN} inputMode="numeric" value={d.capacity ?? ""} onChange={(e) => set("capacity", e.target.value.replace(/\D/g, ""))} placeholder="not tracked" data-testid="sh-capacity" /></label>
                <label><span style={LB}>There now</span>
                    <input style={IN} inputMode="numeric" value={d.occupancy ?? ""} onChange={(e) => set("occupancy", e.target.value.replace(/\D/g, ""))} placeholder="0" /></label>
            </div>
            <label><span style={LB}>Contact — who to call, how to get in</span>
                <input style={IN} value={d.contact || ""} onChange={(e) => set("contact", e.target.value)} placeholder="Ring twice, ask for Marc · +33 …" data-testid="sh-contact" /></label>
            <label><span style={LB}>Teams or companies that may use it — comma-separated; empty: anyone who can see it</span>
                <input style={IN} value={teams || ""} onChange={(e) => set("allowed_teams", e.target.value)} placeholder="e.g. Trifecta" /></label>
            {users.length > 0 && (
                <div>
                    <span style={LB}>People who may use it {d.allowed_users.length ? `(${d.allowed_users.length})` : "— none named"}</span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {users.slice(0, 40).map((u) => {
                            const on = d.allowed_users.includes(String(u.id))
                            return (
                                <button type="button" key={u.id} aria-pressed={on}
                                        onClick={() => set("allowed_users", on ? d.allowed_users.filter((x) => x !== String(u.id)) : [...d.allowed_users, String(u.id)])}
                                        style={{ font: "inherit", fontSize: 12, padding: "3px 9px", borderRadius: 12, cursor: "pointer", color: "inherit",
                                                 border: `1px solid ${on ? "#2E9E5B" : "rgba(255,255,255,.2)"}`, background: on ? "rgba(46,158,91,.25)" : "transparent" }}>
                                    {u.name || u.email}
                                </button>
                            )
                        })}
                    </div>
                </div>
            )}
        </fieldset>
    )
}
