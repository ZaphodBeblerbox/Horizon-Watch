/**
 * OntologyOrbat.jsx — PARALLAX §17.1. Four tiers, left to right:
 * theatre → country → actor → formation.
 *
 * The rule that shapes this surface is the hollow country: "Countries come
 * from the full roster, filtered by theatre. A country with no held ORBAT
 * draws HOLLOW — dashed stroke, 0.5 opacity. ABSENCE OF EVIDENCE IS A STATE
 * WORTH SHOWING, NOT A COUNTRY WORTH HIDING."
 *
 * Positions are deterministic so the graph does not reshuffle when a node
 * opens — see ontologyModes.layoutTier.
 */
import { useEffect, useMemo, useState } from "react"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import {
    THEATRES, THEATRE_SLUGS, countriesForTheatre, layoutTier,
    confidenceRing, cappedConfidence, TIER_W,
} from "./ontologyModes.js"

/** Slug → the ISO code its held ORBAT belongs to. Explicit, never inferred. */
const SLUG_ISO = {
    ukraine: "UKR", israel: "ISR", iran: "IRN", yemen: "YEM",
    syria: "SYR", myanmar: "MMR", drc: "COD", ven: "VEN", indpak: "IND",
}

export default function OntologyOrbat({ onSelect, selectedId }) {
    const [nodes, setNodes] = useState([])
    const [loaded, setLoaded] = useState(false)
    const [theatreId, setTheatreId] = useState("TH-BLACK")
    const [openIso, setOpenIso] = useState(null)
    const [openActor, setOpenActor] = useState(null)

    useEffect(() => {
        let cancelled = false
        fetch(`${API_BASE}/api/geoconfirmed/orbat`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (!cancelled) { setNodes(safeArray(d?.nodes)); setLoaded(true) } })
            .catch(() => { if (!cancelled) setLoaded(true) })
        return () => { cancelled = true }
    }, [])

    const theatre = THEATRES.find((t) => t.id === theatreId)

    // How much ORBAT we actually hold, per ISO — the input to "hollow".
    const heldByIso = useMemo(() => {
        const out = {}
        for (const n of nodes) {
            const iso = SLUG_ISO[n.theatre_slug]
            if (iso) out[iso] = (out[iso] || 0) + 1
        }
        return out
    }, [nodes])

    const countries = countriesForTheatre(theatre, heldByIso)

    // Actors are the roots we hold for the open country; formations are their
    // children. Both come from the same real tree, so an empty tier means we
    // hold nothing — never that something was filtered away.
    const slugsForIso = (iso) => Object.entries(SLUG_ISO).filter(([, v]) => v === iso).map(([k]) => k)

    const actors = useMemo(() => {
        if (!openIso) return []
        const slugs = slugsForIso(openIso)
        return nodes.filter((n) => slugs.includes(n.theatre_slug) && !n.parent_id)
    }, [nodes, openIso])

    const formations = useMemo(() => {
        if (!openActor) return []
        return nodes.filter((n) => n.parent_id === openActor)
    }, [nodes, openActor])

    const tTheatres = layoutTier(THEATRES, 0)
    const tCountries = layoutTier(countries, 1)
    const tActors = layoutTier(actors.slice(0, 14), 2)
    const tFormations = layoutTier(formations.slice(0, 14), 3)

    const height = Math.max(
        360,
        40 + Math.max(tTheatres.length, tCountries.length, tActors.length, tFormations.length) * 46 + 30,
    )

    const plate = (x, y, w, { label, sub, hollow, active, onClick, ring }) => (
        <g key={`${x}-${y}-${label}`} transform={`translate(${x},${y})`}
           style={{ cursor: onClick ? "pointer" : "default" }} onClick={onClick}>
            <rect width={w} height={34} rx="2"
                  fill={active ? "var(--acc-dim)" : "var(--bg-2)"}
                  stroke={active ? "var(--acc-line)" : "var(--line)"}
                  strokeDasharray={hollow ? "4 3" : undefined}
                  opacity={hollow ? 0.5 : 1} />
            <text x="9" y="15" fill="var(--txt-2)" style={{ font: "12px var(--font)" }}>
                {String(label).length > 22 ? `${String(label).slice(0, 20)}…` : label}
            </text>
            {sub != null && (
                <text x="9" y="27" fill="var(--txt-4)" style={{ font: "9.5px var(--mono)" }}>{sub}</text>
            )}
            {ring && <circle cx={w - 12} cy="17" r="4" fill="none" stroke={ring} strokeWidth="1.6" />}
        </g>
    )

    return (
        <div style={{ height: "100%", overflow: "auto", padding: 12 }}>
            {!loaded ? (
                <div className="risknote">Reading the held order of battle…</div>
            ) : (
                <>
                    <svg width={940} height={height} style={{ display: "block" }}>
                        {/* theatre → country leaders */}
                        {tCountries.map((c) => (
                            <path key={`l-${c.item.iso}`}
                                  d={`M${70 + TIER_W[0]},${(tTheatres.find((t) => t.item.id === theatreId)?.y ?? 40) + 17} C${180},${c.y + 17} ${200},${c.y + 17} ${250},${c.y + 17}`}
                                  fill="none" stroke="var(--line)" strokeWidth="1" opacity={c.item.hollow ? 0.3 : 0.7} />
                        ))}
                        {tTheatres.map((t) => plate(t.x, t.y, t.w, {
                            label: t.item.name, sub: `${t.item.iso.length} countries`,
                            active: t.item.id === theatreId,
                            onClick: () => { setTheatreId(t.item.id); setOpenIso(null); setOpenActor(null) },
                        }))}
                        {tCountries.map((c) => plate(c.x, c.y, c.w, {
                            label: c.item.iso,
                            sub: c.item.held ? `${c.item.held} held` : "no ORBAT held",
                            hollow: c.item.hollow,
                            active: c.item.iso === openIso,
                            onClick: () => { setOpenIso(c.item.iso); setOpenActor(null) },
                        }))}
                        {tActors.map((a) => plate(a.x, a.y, a.w, {
                            label: a.item.name, sub: a.item.theatre_slug,
                            active: a.item.node_id === openActor,
                            onClick: () => setOpenActor(a.item.node_id),
                        }))}
                        {tFormations.map((f) => plate(f.x, f.y, f.w, {
                            label: f.item.name,
                            sub: f.item.structure_path || (f.item.disbanded ? "disbanded" : "formation"),
                            // A formation held from one source can never read
                            // above 50% — confidence is agreement BETWEEN
                            // sources, and one source agrees with nothing.
                            ring: confidenceRing(cappedConfidence(1, 1)),
                            active: `orbat-${f.item.node_id}` === selectedId,
                            onClick: () => onSelect?.({
                                kind: "orbat", id: `orbat-${f.item.node_id}`, item: f.item,
                                sources: 1, confidence: cappedConfidence(1, 1),
                            }),
                        }))}
                    </svg>

                    <p className="risknote" style={{ maxWidth: 620 }}>
                        Countries with no held order of battle are drawn hollow rather than
                        omitted — absence of evidence is a state worth showing, not a country
                        worth hiding. Confidence is the agreement between sources, not an
                        average of them, so a single-source formation never exceeds 50%.
                    </p>
                </>
            )}
        </div>
    )
}
