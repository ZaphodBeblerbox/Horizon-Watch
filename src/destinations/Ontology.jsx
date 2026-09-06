import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import API_BASE from "../apiBase.js"
import { addToBriefing } from "../state/briefingBasket.js"
import { toast } from "../ui/toast.js"
import { useInspectorExtensions } from "../inspector/extensionRegistry.js"

// Ontology — page-by-page rebuild, Part A. A fixed four-tier diagram, never
// a force simulation. Built on the real Forge ontology (forge_ontology.json,
// via GET /api/ontology/diagram) since that's the one real ontology dataset
// with a real anti-fabrication safeguard already wired to it — see
// backend/main.py's _forge_ontology_integrity_check. No glass panes (the
// spec doesn't call for them here, unlike Situation/Dossiers) — plain
// docked panes matching Generate.jsx's convention.

const TIER_NAME = ["Geography", "Actors", "Assets & sites", "Observations"]
const NODE_TYPE_ICON = {
    person: "i-node-person", org: "i-node-org", faction: "i-node-faction",
    facility: "i-node-facility", country: "i-node-country", corridor: "i-node-corridor",
    event: "i-node-event", vessel: "i-ship", aircraft: "i-plane",
}
const LINK_KINDS = ["operates", "owns", "flagged in", "transits", "located in", "affiliated with",
    "supplies", "sanctioned by", "observed at", "controls", "contracted to"]

const PLATE_W = 92, PLATE_H = 40, STEP_X = 112, STAGGER_Y = 26, TIER_HEIGHT = 170

function riskBand(risk) {
    if (risk >= 75) return "critical"
    if (risk >= 50) return "high"
    if (risk >= 25) return "moderate"
    return "low"
}
const BAND_COLOR = { critical: "var(--sev-critical)", high: "var(--sev-high)", moderate: "var(--sev-moderate)", low: "var(--sev-low)" }

// §A9 — the animation-frame hazard. Probed once at module load; auto-fit
// routes through this so a throttled/backgrounded tab still lands on the
// correct transform instead of silently no-op'ing.
let rafOK = null
;(function probeRaf() {
    let fired = false
    requestAnimationFrame(() => { fired = true; rafOK = true })
    setTimeout(() => { if (!fired) rafOK = false }, 260)
})()
function applyFit(setTransform, next, ms) {
    if (rafOK && ms) {
        const start = performance.now()
        let from = null
        setTransform((prev) => { from = prev; return prev })
        function frame(now) {
            const t = Math.min(1, (now - start) / ms)
            setTransform({
                x: from.x + (next.x - from.x) * t, y: from.y + (next.y - from.y) * t,
                k: from.k + (next.k - from.k) * t,
            })
            if (t < 1) requestAnimationFrame(frame)
        }
        requestAnimationFrame(frame)
    } else {
        setTransform(next)
    }
}

/** §A3 — three barycentre passes over neighbor indices, seeded by descending
 * risk, so links run short and mostly vertical between adjacent tiers. */
function computeLayout(nodes, links) {
    const byTier = [[], [], [], []]
    for (const n of nodes) byTier[n.tier].push(n)
    for (const arr of byTier) arr.sort((a, b) => b.risk - a.risk)

    const order = byTier.map((arr) => arr.map((n) => n.id))
    const neighborsOf = new Map()
    for (const n of nodes) neighborsOf.set(n.id, [])
    for (const l of links) {
        neighborsOf.get(l.s)?.push(l.t)
        neighborsOf.get(l.t)?.push(l.s)
    }
    const idToTier = new Map(nodes.map((n) => [n.id, n.tier]))

    for (let pass = 0; pass < 3; pass++) {
        for (let tier = 0; tier < 4; tier++) {
            const positionOf = (id) => {
                const t = idToTier.get(id)
                return t == null ? -1 : order[t].indexOf(id)
            }
            const withBary = order[tier].map((id, i) => {
                const neighbors = (neighborsOf.get(id) || []).filter((nid) => {
                    const t = idToTier.get(nid)
                    return t === tier - 1 || t === tier + 1
                })
                const positions = neighbors.map(positionOf).filter((p) => p >= 0)
                const bary = positions.length ? positions.reduce((a, b) => a + b, 0) / positions.length : i
                return { id, bary, i }
            })
            withBary.sort((a, b) => a.bary - b.bary || a.i - b.i)
            order[tier] = withBary.map((x) => x.id)
        }
    }

    const positions = {}
    order.forEach((ids, tier) => {
        ids.forEach((id, i) => {
            positions[id] = {
                x: i * STEP_X, y: tier * TIER_HEIGHT + (i % 2 === 1 ? STAGGER_Y : 0),
            }
        })
    })
    return positions
}

function NodePlate({ node, pos, selected, onSelect, onDragStart }) {
    const band = riskBand(node.risk)
    return (
        <g
            transform={`translate(${pos.x},${pos.y})`} style={{ cursor: "grab" }}
            onPointerDown={(e) => onDragStart(e, node.id)}
            onClick={(e) => { e.stopPropagation(); onSelect(node) }}
        >
            <rect width={PLATE_W} height={PLATE_H} rx={2} fill="var(--bg-2)"
                stroke={selected ? "var(--acc-hi)" : "var(--line-strong)"} strokeWidth={selected ? 1.5 : 1} />
            <svg x={4} y={4} width={15} height={15} className="icon"><use href={`#${NODE_TYPE_ICON[node.type] || "i-node-event"}`} /></svg>
            <text x={22} y={14} style={{ font: "400 10.5px var(--font)", fill: "var(--txt)" }}>{node.label.slice(0, 14)}</text>
            <text x={5} y={27} style={{ font: "400 8.5px var(--font)", fill: "var(--txt-3)" }}>{node.type} · {node.risk}</text>
            <rect x={0} y={PLATE_H - 3} width={PLATE_W} height={3} fill={BAND_COLOR[band]} />
        </g>
    )
}

function linkPath(a, b) {
    const ax = a.x + PLATE_W / 2, ay = a.y + (a.y < b.y ? PLATE_H : 0)
    const bx = b.x + PLATE_W / 2, by = b.y + (b.y < a.y ? PLATE_H : 0)
    const midY = (ay + by) / 2
    return `M${ax},${ay} C${ax},${midY} ${bx},${midY} ${bx},${by}`
}

export default function Ontology({ onOpenGenerate }) {
    const [data, setData] = useState(null)
    const [positions, setPositions] = useState({})
    const [selected, setSelected] = useState(null) // {kind:"node"|"link", item}
    // V3 Phase 1, §2.2 — real hook-based extension point, owned and called
    // by this component itself (never reassigned from outside).
    const inspectorExtensions = useInspectorExtensions()
    const [typeFilter, setTypeFilter] = useState(null)
    const [confFloor, setConfFloor] = useState(0)
    const [showInferred, setShowInferred] = useState(true)
    const [linkMode, setLinkMode] = useState(false)
    const [linkFirst, setLinkFirst] = useState(null)
    const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 })
    const [investigations, setInvestigations] = useState(() => {
        try { return JSON.parse(localStorage.getItem("ontology_investigations") || "[]") } catch { return [] }
    })
    const layoutKeyRef = useRef(null)
    const dragRef = useRef(null)
    const svgRef = useRef(null)
    const containerRef = useRef(null)

    const pendingSelectNodeRef = useRef(null)

    useEffect(() => {
        fetch(`${API_BASE}/api/ontology/diagram`).then((r) => r.json()).then((d) => {
            setData(d)
            const key = d.nodes.map((n) => n.id).sort().join(",") + "|layered"
            if (layoutKeyRef.current !== key) {
                setPositions(computeLayout(d.nodes, d.links))
                layoutKeyRef.current = key
            }
            requestAutoFit(d.nodes)
            if (pendingSelectNodeRef.current) {
                const id = pendingSelectNodeRef.current
                pendingSelectNodeRef.current = null
                const node = d.nodes.find((n) => n.id === id)
                if (node) {
                    setSelected({ kind: "node", item: node })
                    setTimeout(() => requestAutoFit([node]), 30)
                }
            }
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Real deep-link entry point — the Briefings reader's "open in ontology"
    // xref action (and any other future caller) selects and locates a real
    // node by its real Forge id, the same way a direct click on it would.
    useEffect(() => {
        const handler = (e) => {
            const id = e.detail?.id
            if (!id) return
            if (!data) { pendingSelectNodeRef.current = id; return }
            const node = data.nodes.find((n) => n.id === id)
            if (node) {
                setSelected({ kind: "node", item: node })
                requestAutoFit([node])
            }
        }
        window.addEventListener("akili:ontology-select-node", handler)
        return () => window.removeEventListener("akili:ontology-select-node", handler)
    }, [data])

    function requestAutoFit(nodes) {
        if (!nodes.length || !containerRef.current) return
        const pos = positions
        const xs = nodes.map((n) => pos[n.id]?.x ?? 0)
        const ys = nodes.map((n) => pos[n.id]?.y ?? 0)
        const minX = Math.min(...xs) - 40, maxX = Math.max(...xs) + PLATE_W + 40
        const minY = Math.min(...ys) - 40, maxY = Math.max(...ys) + PLATE_H + 40
        const rect = containerRef.current.getBoundingClientRect()
        const scale = Math.max(0.3, Math.min(1.2, Math.min(rect.width / (maxX - minX || 1), rect.height / (maxY - minY || 1))))
        applyFit(setTransform, { x: -minX * scale, y: -minY * scale, k: scale }, 260)
    }

    function rebuild() {
        if (!data) return
        setPositions(computeLayout(data.nodes, data.links))
        setTimeout(() => requestAutoFit(data.nodes), 20)
    }

    const visibleNodes = useMemo(() => {
        if (!data) return []
        return data.nodes.filter((n) => !typeFilter || n.type === typeFilter)
    }, [data, typeFilter])
    const visibleIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes])
    const visibleLinks = useMemo(() => {
        if (!data) return []
        return data.links.filter((l) =>
            visibleIds.has(l.s) && visibleIds.has(l.t) && l.conf >= confFloor && (showInferred || !l.inferred)
        )
    }, [data, visibleIds, confFloor, showInferred])

    function handleNodeClick(node) {
        if (linkMode) {
            if (!linkFirst) { setLinkFirst(node); toast(`Selected ${node.label} — click a second node to link`, {}) }
            else if (linkFirst.id !== node.id) {
                fetch(`${API_BASE}/api/forge/ontology/edge`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ source: linkFirst.id, target: node.id, type: "affiliated with" }),
                }).then((r) => r.json()).then(() => {
                    toast("Link created", { icon: "i-check" })
                    setLinkMode(false); setLinkFirst(null)
                    reload()
                })
            }
            return
        }
        setSelected({ kind: "node", item: node })
    }

    function reload() {
        fetch(`${API_BASE}/api/ontology/diagram`).then((r) => r.json()).then((d) => {
            setData(d)
            const key = d.nodes.map((n) => n.id).sort().join(",") + "|layered"
            if (layoutKeyRef.current !== key) {
                setPositions((prev) => ({ ...computeLayout(d.nodes, d.links), ...prev }))
                layoutKeyRef.current = key
            }
        })
    }

    function onDragStart(e, nodeId) {
        e.stopPropagation()
        const startX = e.clientX, startY = e.clientY
        const orig = positions[nodeId]
        dragRef.current = { nodeId, startX, startY, orig }
        function onMove(ev) {
            const dx = (ev.clientX - startX) / transform.k, dy = (ev.clientY - startY) / transform.k
            setPositions((prev) => ({ ...prev, [nodeId]: { x: orig.x + dx, y: orig.y + dy } }))
        }
        function onUp() {
            window.removeEventListener("pointermove", onMove)
            window.removeEventListener("pointerup", onUp)
            dragRef.current = null
        }
        window.addEventListener("pointermove", onMove)
        window.addEventListener("pointerup", onUp)
    }

    function onBackgroundDrag(e) {
        const startX = e.clientX, startY = e.clientY
        const orig = transform
        function onMove(ev) {
            setTransform({ ...orig, x: orig.x + (ev.clientX - startX), y: orig.y + (ev.clientY - startY) })
        }
        function onUp() { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp) }
        window.addEventListener("pointermove", onMove)
        window.addEventListener("pointerup", onUp)
    }

    function onWheel(e) {
        e.preventDefault()
        const next = Math.max(0.3, Math.min(1.2, transform.k * (e.deltaY > 0 ? 0.92 : 1.08)))
        setTransform((t) => ({ ...t, k: next }))
    }

    function locate(node) {
        if (node.lat == null || node.lon == null) { toast("No real geometry for this object", {}); return }
        window.dispatchEvent(new CustomEvent("akili:open-map"))
        setTimeout(() => window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: node.lat, lon: node.lon, altitude: 300000 } })), 50)
    }

    function briefSelection() {
        if (!selected) return
        if (selected.kind === "node") {
            const n = selected.item
            if (n.props?.source?.startsWith("live:")) {
                addToBriefing(n.id, n.label)
                toast(`${n.label} added to briefing basket`, { icon: "i-check" })
                onOpenGenerate?.()
            } else {
                toast("No directly associated real signal for this object", {})
            }
        }
    }

    function saveInvestigation() {
        const name = prompt("Name this investigation")
        if (!name) return
        const next = [...investigations, { name, typeFilter, confFloor, showInferred, savedAt: new Date().toISOString() }]
        setInvestigations(next)
        localStorage.setItem("ontology_investigations", JSON.stringify(next))
    }
    function loadInvestigation(inv) {
        setTypeFilter(inv.typeFilter); setConfFloor(inv.confFloor); setShowInferred(inv.showInferred)
    }

    const typeCounts = data?.type_counts || {}

    return (
        <div style={{ display: "grid", gridTemplateColumns: "236px 1fr 316px", height: "100%", overflow: "hidden", background: "var(--bg-0)" }}>
            <div style={{ borderRight: "1px solid var(--line)", overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                    <div style={{ font: "600 11px var(--font)", color: "var(--txt-3)", marginBottom: 6 }}>Types</div>
                    <div role="button" onClick={() => setTypeFilter(null)} style={{ font: "400 12px var(--font)", color: !typeFilter ? "var(--txt)" : "var(--txt-3)", cursor: "pointer", marginBottom: 4 }}>All</div>
                    {Object.entries(typeCounts).map(([t, c]) => (
                        <div key={t} role="button" onClick={() => setTypeFilter(t)}
                            style={{ display: "flex", justifyContent: "space-between", font: "400 12px var(--font)", color: typeFilter === t ? "var(--txt)" : "var(--txt-3)", cursor: "pointer", padding: "2px 0" }}>
                            <span style={{ textTransform: "capitalize" }}>{t}</span><span style={{ fontFamily: "var(--mono)" }}>{c}</span>
                        </div>
                    ))}
                </div>
                <div className="field"><label>Link confidence floor — {confFloor.toFixed(2)}</label>
                    <input type="range" min={0} max={1} step={0.05} value={confFloor} onChange={(e) => setConfFloor(Number(e.target.value))} />
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 7, font: "400 12px var(--font)", color: "var(--txt-2)" }}>
                    <input type="checkbox" className="check" checked={showInferred} onChange={(e) => setShowInferred(e.target.checked)} />
                    Show inferred links
                </label>
                <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <span style={{ font: "600 11px var(--font)", color: "var(--txt-3)" }}>Investigations</span>
                        <button className="btn ghost sm" onClick={saveInvestigation}>save</button>
                    </div>
                    {investigations.length === 0 ? (
                        <div style={{ font: "400 11px var(--font)", color: "var(--txt-4)" }}>No saved investigations yet.</div>
                    ) : investigations.map((inv, i) => (
                        <div key={i} role="button" onClick={() => loadInvestigation(inv)} style={{ font: "400 12px var(--font)", color: "var(--txt-2)", cursor: "pointer", padding: "3px 0" }}>{inv.name}</div>
                    ))}
                </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <div style={{ height: 28, flexShrink: 0, background: "var(--bg-2)", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 8, padding: "0 10px" }}>
                    <button className="btn sm" onClick={() => data && requestAutoFit(data.nodes)}>find</button>
                    <div className="seg"><button aria-pressed>layered</button><button disabled title="Radial layout not built in this pass">radial</button></div>
                    <button className="btn sm" onClick={rebuild}>rebuild</button>
                    <button className="btn sm" onClick={() => {
                        fetch(`${API_BASE}/api/forge/ontology/node`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "person", label: "New object" }) })
                            .then((r) => r.json()).then(() => { toast("Object created", { icon: "i-check" }); reload() })
                    }}>new object</button>
                    <button className={`btn sm${linkMode ? " primary" : ""}`} onClick={() => { setLinkMode((v) => !v); setLinkFirst(null) }}>link objects</button>
                    <button className="btn sm" onClick={() => selected?.kind === "node" && locate(selected.item)} disabled={selected?.kind !== "node"}>plot on map</button>
                    <button className="btn sm" onClick={briefSelection} disabled={!selected}>brief selection</button>
                    {linkMode && <span style={{ font: "400 11px var(--font)", color: "var(--acc-hi)" }}>{linkFirst ? `${linkFirst.label} → click target` : "click first node"}</span>}
                </div>
                <div ref={containerRef} style={{ flex: 1, overflow: "hidden", position: "relative" }} onWheel={onWheel}>
                    <svg ref={svgRef} width="100%" height="100%" onPointerDown={onBackgroundDrag} style={{ cursor: "grab" }}>
                        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
                            {TIER_NAME.map((name, i) => (
                                <g key={name}>
                                    <text x={-10} y={i * TIER_HEIGHT - 8} style={{ font: "600 11px var(--font)", fill: "var(--txt-3)" }}>{name}</text>
                                    <line x1={-10} x2={5000} y1={i * TIER_HEIGHT} y2={i * TIER_HEIGHT} stroke="var(--line-soft)" strokeDasharray="4 4" />
                                </g>
                            ))}
                            {visibleLinks.map((l) => {
                                const a = positions[l.s], b = positions[l.t]
                                if (!a || !b) return null
                                const mx = (a.x + b.x) / 2 + PLATE_W / 2, my = (a.y + b.y) / 2 + PLATE_H / 2
                                return (
                                    <g key={l.id}>
                                        <path d={linkPath(a, b)} fill="none" stroke="var(--line-strong)"
                                            strokeWidth={l.conf >= 0.9 ? 2 : 1} strokeDasharray={l.inferred ? "4 3" : "none"}
                                            onClick={(e) => { e.stopPropagation(); setSelected({ kind: "link", item: l }) }} style={{ cursor: "pointer" }} />
                                        <text x={mx} y={my} textAnchor="middle" style={{ font: "400 9px var(--font)", fill: "var(--txt-4)" }}>{l.kind}</text>
                                    </g>
                                )
                            })}
                            {visibleNodes.map((n) => positions[n.id] && (
                                <NodePlate key={n.id} node={n} pos={positions[n.id]} selected={selected?.item?.id === n.id}
                                    onSelect={handleNodeClick} onDragStart={onDragStart} />
                            ))}
                        </g>
                    </svg>
                </div>
            </div>

            <div style={{ borderLeft: "1px solid var(--line)", overflowY: "auto", padding: 12 }}>
                {!selected ? (
                    <div style={{ font: "400 12px var(--font)", color: "var(--txt-3)" }}>Select an object or link to inspect/edit it.</div>
                ) : selected.kind === "node" ? (
                    <NodeEditor node={selected.item} onChanged={reload} onLocate={() => locate(selected.item)} />
                ) : (
                    <LinkEditor link={selected.item} onChanged={reload} />
                )}
                {inspectorExtensions.map((Ext, i) => (
                    <Ext key={i} recordRef={selected?.kind === "node" ? `onto:${selected.item.id}` : null} record={selected?.item} />
                ))}
            </div>
        </div>
    )
}

function NodeEditor({ node, onChanged, onLocate }) {
    const [label, setLabel] = useState(node.label)
    const [risk, setRisk] = useState(node.risk)
    useEffect(() => { setLabel(node.label); setRisk(node.risk) }, [node.id]) // eslint-disable-line react-hooks/exhaustive-deps

    function save() {
        fetch(`${API_BASE}/api/forge/ontology/node/${node.id}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label }),
        }).then(() => { toast("Saved", { icon: "i-check" }); onChanged() })
    }
    function del() {
        fetch(`${API_BASE}/api/forge/ontology/node/${node.id}`, { method: "DELETE" }).then(() => onChanged())
    }
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="field"><label>Label</label><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} /></div>
            <div className="field"><label>Type</label><input className="input" value={node.type} disabled /></div>
            <div className="field"><label>Risk — {risk} ({riskBand(risk)})</label><input type="range" min={0} max={100} value={risk} disabled title="Risk is computed server-side from real severity/connectivity signals" /></div>
            <div style={{ font: "400 11px var(--mono)", color: "var(--txt-4)" }}>{JSON.stringify(node.props)}</div>
            <div style={{ display: "flex", gap: 8 }}>
                <button className="btn primary sm" onClick={save}>save</button>
                <button className="btn sm" onClick={onLocate} disabled={node.lat == null}>locate</button>
                <button className="btn danger sm" onClick={del}>delete</button>
            </div>
        </div>
    )
}

function LinkEditor({ link, onChanged }) {
    const [kind, setKind] = useState(link.kind)
    const [conf, setConf] = useState(link.conf)
    const [note, setNote] = useState(link.note || "")
    useEffect(() => { setKind(link.kind); setConf(link.conf); setNote(link.note || "") }, [link.id]) // eslint-disable-line react-hooks/exhaustive-deps

    function save() {
        fetch(`${API_BASE}/api/forge/ontology/edge/${link.id}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, conf, note }),
        }).then(() => { toast("Saved", { icon: "i-check" }); onChanged() })
    }
    function del() {
        fetch(`${API_BASE}/api/forge/ontology/edge/${link.id}`, { method: "DELETE" }).then(() => onChanged())
    }
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="field"><label>Kind</label>
                <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
                    {!LINK_KINDS.includes(kind) && <option value={kind}>{kind} (real, not in LINK_KINDS)</option>}
                    {LINK_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
            </div>
            <div className="field"><label>Confidence — {conf.toFixed(2)}</label><input type="range" min={0} max={1} step={0.05} value={conf} onChange={(e) => setConf(Number(e.target.value))} /></div>
            <div className="field"><label>Basis / note</label><textarea className="input" style={{ minHeight: 60 }} value={note} onChange={(e) => setNote(e.target.value)} /></div>
            <div style={{ display: "flex", gap: 8 }}>
                <button className="btn primary sm" onClick={save}>save</button>
                <button className="btn danger sm" onClick={del}>delete</button>
            </div>
        </div>
    )
}
