/**
 * TrackFilterPanel.jsx — filter the live vessels or aircraft on the map.
 *
 * Types as chips; flags, airlines and airline countries as a searchable
 * list of what is actually present (with counts), so no option leads to an
 * empty map. Shows how many are drawn of how many received.
 */
import { useState } from "react"
import { AIRCRAFT_KINDS, VESSEL_TYPES } from "../globe/trackFilters.js"

const chip = (on) => ({
    height: 22, padding: "0 8px", borderRadius: 0, cursor: "pointer", whiteSpace: "nowrap",
    border: `1px solid ${on ? "var(--acc-line, var(--acchi))" : "var(--gline, var(--line))"}`,
    background: on ? "var(--accdim, var(--acc-dim))" : "transparent",
    color: on ? "var(--txt)" : "var(--txt-3)", font: "400 11px var(--font)",
})

function toggleIn(set, v, all) {
    const base = set ? new Set(set) : new Set(all)
    if (base.has(v)) base.delete(v); else base.add(v)
    return base.size === all.length ? null : base
}

function ValuePicker({ label, options, selected, onChange }) {
    const [q, setQ] = useState("")
    const shown = options.filter(([v]) => !q || String(v).toLowerCase().includes(q.toLowerCase())).slice(0, q ? 30 : 8)
    return (
        <div style={{ marginTop: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ font: "600 10px var(--font)", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--txt-4)" }}>{label}</span>
                {selected && <button onClick={() => onChange(null)} style={{ ...chip(false), height: 18, padding: "0 5px", fontSize: 10 }}>all</button>}
            </div>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Find a ${label.toLowerCase().replace(/s$/, "")}…`}
                   style={{ width: "100%", boxSizing: "border-box", height: 24, margin: "4px 0", padding: "0 7px", font: "400 11.5px var(--font)",
                            background: "var(--glass2)", border: "1px solid var(--gline)", color: "var(--txt)", outline: "none" }} />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {shown.map(([v, n]) => {
                    const on = !!selected?.has(v)
                    return (
                        <button key={v} style={chip(on)} onClick={() => {
                            const next = new Set(selected || [])
                            if (on) next.delete(v); else next.add(v)
                            onChange(next.size ? next : null)
                        }}>{v} <span style={{ color: "var(--txt-4)" }}>{n}</span></button>
                    )
                })}
            </div>
        </div>
    )
}

export function VesselFilterPanel({ filter, onChange, facets }) {
    const all = VESSEL_TYPES.map(([k]) => k)
    const counts = Object.fromEntries(facets?.types || [])
    return (
        <div style={{ padding: "4px 12px 8px 22px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {VESSEL_TYPES.map(([k, l]) => (
                    <button key={k} style={chip(!filter.types || filter.types.has(k))}
                            onClick={() => onChange({ ...filter, types: toggleIn(filter.types, k, all) })}>
                        {l} <span style={{ color: "var(--txt-4)" }}>{counts[k] || 0}</span>
                    </button>
                ))}
            </div>
            <ValuePicker label="Flags" options={facets?.flags || []} selected={filter.flags}
                         onChange={(flags) => onChange({ ...filter, flags })} />
            <div style={{ font: "400 10.5px var(--font)", color: "var(--txt-4)", marginTop: 6 }}>
                Showing {facets?.shown ?? "—"} of {facets?.total ?? "—"} vessels
            </div>
        </div>
    )
}

export function AircraftFilterPanel({ filter, onChange, facets }) {
    const all = AIRCRAFT_KINDS.map(([k]) => k)
    const counts = Object.fromEntries(facets?.kinds || [])
    return (
        <div style={{ padding: "4px 12px 8px 22px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {AIRCRAFT_KINDS.map(([k, l]) => (
                    <button key={k} style={chip(!filter.kinds || filter.kinds.has(k))}
                            onClick={() => onChange({ ...filter, kinds: toggleIn(filter.kinds, k, all) })}>
                        {l} <span style={{ color: "var(--txt-4)" }}>{counts[k] || 0}</span>
                    </button>
                ))}
            </div>
            <ValuePicker label="Airlines" options={facets?.airlines || []} selected={filter.airlines}
                         onChange={(airlines) => onChange({ ...filter, airlines })} />
            <ValuePicker label="Airline countries" options={facets?.countries || []} selected={filter.countries}
                         onChange={(countries) => onChange({ ...filter, countries })} />
            <div style={{ font: "400 10.5px var(--font)", color: "var(--txt-4)", marginTop: 6 }}>
                Showing {facets?.shown ?? "—"} of {facets?.total ?? "—"} aircraft
            </div>
        </div>
    )
}
