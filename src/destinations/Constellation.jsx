/**
 * Constellation.jsx — PARALLAX v6, Part H's Constellation, on our graph.
 *
 * This is what used to be called Ontology. The v6 spec renames it:
 * Constellation is the graph you move through, Semantics is the rulebook
 * behind it, and they are two views of one screen rather than two screens.
 *
 * FOUR VIEWS. The spec ships three — Trace, Map, Semantics. Pathways is a
 * deliberate fourth, and the reason it exists is that the backend has been
 * answering "could something get from here to there, and through where"
 * since before this screen was written (/api/ontology/chains, 50 real
 * origin→via→destination statements with evidence) and nothing has ever
 * shown them. The spec has no slot for it because the spec's mock graph
 * had no such data.
 *
 * WHAT A PATH HERE MEANS, which is the whole design. The country graph is
 * distilled from reported events: who was described as doing what with
 * whom. It is not a manifest, a customs record or a track. So a chain is a
 * sequence of recorded relationships that a route COULD ride on, never a
 * route that was taken, and every step says which kind of relationship it
 * is — material cooperation reads differently from a state visit, and a
 * chain made only of visits is contact, not transfer. See
 * constellationPath.js, which carries the scoring and the caveats.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import API_BASE from "../apiBase.js"
import Loading from "../ui/Loading.jsx"
import Minimap from "../components/Minimap.jsx"
import { MODE_SURFACE } from "../plx6/modeWindow.js"
import {
    FAMILY, DEFAULT_FAMILIES, findRoute, routeStatement, findEntityPath, stepConfidence,
} from "./constellationPath.js"
import {
    searchGraph, neighbourhood, liveSignals, reviewClaims, graphStats,
    TYPE as GTYPE, typeOf as gTypeOf,
} from "./constellationGraph.js"

const safeArray = (v) => (Array.isArray(v) ? v : [])
const ON = "var(--accdim)"

const I = ({ href, size = 15, color = null, style = null }) => (
    <svg width={size} height={size} style={{ flex: "none", ...(color ? { color } : null), ...style }} aria-hidden>
        <use href={href} />
    </svg>
)

/* The node vocabulary now comes from constellationGraph.js, which is
   written against the real graph's types rather than the summary's. */
const TYPE = GTYPE
const typ = gTypeOf

const EYE = {
    fontFamily: "var(--mz-font-mono)", fontWeight: 500, fontSize: 10,
    letterSpacing: ".12em", textTransform: "uppercase", color: "var(--txt4)",
}
const pct = (x) => {
    const n = x * 100
    // 0% is a lie when the value is merely small: a four-hop chain really
    // is worth under one per cent, and rounding it to zero reads as "no".
    if (n > 0 && n < 1) return "<1%"
    return `${Math.round(n)}%`
}

function Btn({ children, onClick, active = false, title, icon = null, primary = false, style = null }) {
    return (
        <button onClick={onClick} title={title} style={{
            display: "flex", alignItems: "center", gap: 6, height: 30,
            padding: primary ? "0 12px" : "0 11px",
            border: primary ? 0 : `1px solid ${active ? "var(--acchi)" : "var(--gline2)"}`,
            background: primary ? "var(--acc)" : active ? ON : "transparent",
            color: primary ? "var(--mz-cream)" : "var(--txt)",
            fontWeight: primary ? 600 : 400, font: "inherit",
            cursor: "pointer", whiteSpace: "nowrap", borderRadius: 0, ...style,
        }}>
            {icon && <I href={icon} size={14} />}
            {children}
        </button>
    )
}


/* COLLAPSE FROM THE EDGE IT COLLAPSED TO.
   The header has toggles for both asides, but once a pane is shut the only
   way back is a 30px icon at the far end of a 48px bar, which is nowhere
   near where the pane was. A handle on the seam is where the hand already
   is — the same affordance a split pane has anywhere else. */
function EdgeHandle({ side, open, onClick, label }) {
    const arrow = side === "left" ? (open ? "‹" : "›") : (open ? "›" : "‹")
    return (
        <button onClick={onClick} title={`${open ? "Hide" : "Show"} ${label}`} aria-label={`${open ? "Hide" : "Show"} ${label}`}
            style={{
                position: "absolute", top: "50%", transform: "translateY(-50%)",
                [side]: 0, zIndex: 28, width: 14, height: 46, padding: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                border: "1px solid var(--gline)",
                borderLeft: side === "left" ? 0 : "1px solid var(--gline)",
                borderRight: side === "right" ? 0 : "1px solid var(--gline)",
                borderRadius: side === "left" ? "0 7px 7px 0" : "7px 0 0 7px",
                background: "var(--glass)",
                backdropFilter: "blur(22px) saturate(1.15)",
                WebkitBackdropFilter: "blur(22px) saturate(1.15)",
                color: "var(--txt3)", font: "inherit", fontSize: 12,
                cursor: "pointer", lineHeight: 1,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--txt)" }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--txt3)" }}
        >{arrow}</button>
    )
}

export default function Constellation({ theater = "", onOpenModule = () => {} }) {
    const [view, setView] = useState("trace")
    const [panL, setPanL] = useState(true)
    const [panR, setPanR] = useState(true)
    const [vw, setVw] = useState(() => window.innerWidth)

    const [rel, setRel] = useState(null)          // /api/ontology/relations
    const [chains, setChains] = useState(null)    // /api/ontology/chains
    const [countries, setCountries] = useState([])
    const [err, setErr] = useState(null)

    const [focus, setFocus] = useState(null)
    const [crumbs, setCrumbs] = useState([])
    const [q, setQ] = useState("")
    const [pins, setPins] = useState([])
    const [pathPick, setPathPick] = useState(false)
    const [path, setPath] = useState(null)
    const [toast, setToast] = useState(null)
    /* ▣ Time — how far back the trace is reading. The spec's bar is a
       0–30 day scrubber with a tick per day that has signals on it. It
       filters the SIGNALS, which are the only thing here that has a time:
       a graph relation like "located in" is not a thing that happened on a
       Tuesday, and pretending the whole trace rewinds would be theatre. */
    const [day, setDay] = useState(0)
    const [playing, setPlaying] = useState(false)

    // Pathways
    const [from, setFrom] = useState("FRA")
    const [to, setTo] = useState("SYR")
    const [via, setVia] = useState("")
    const [fams, setFams] = useState(DEFAULT_FAMILIES)
    const [asked, setAsked] = useState(null)

    useEffect(() => {
        const r = () => setVw(window.innerWidth)
        window.addEventListener("resize", r)
        return () => window.removeEventListener("resize", r)
    }, [])

    /* The locator needs its real box, not a guess: its projection is built
       for the viewBox width it is given, so a measured size is the
       difference between a map and a stretched one. */
    const mapBox = useRef(null)
    const [mapSize, setMapSize] = useState({ w: 900, h: 600 })
    useEffect(() => {
        const el = mapBox.current
        if (!el || typeof ResizeObserver !== "function") return undefined
        const ob = new ResizeObserver(([e]) => {
            const { width, height } = e.contentRect
            if (width > 40 && height > 40) setMapSize({ w: Math.round(width), h: Math.round(height) })
        })
        ob.observe(el)
        return () => ob.disconnect()
    }, [view])
    useEffect(() => {
        if (!playing) return undefined
        const iv = setInterval(() => setDay((d) => (d <= 0 ? 30 : d - 1)), 650)
        return () => clearInterval(iv)
    }, [playing])

    useEffect(() => {
        if (!toast) return undefined
        const t = setTimeout(() => setToast(null), 2600)
        return () => clearTimeout(t)
    }, [toast])

    /* ── THE REAL GRAPH, NOT THE SUMMARY ────────────────────────────
       `diagram` is a dashboard payload: 160 nodes out of 25,280, mostly
       `correlates_with` at 0.6. The trace now walks
       /api/ontology/graph/neighbourhood, which has named relations with a
       method and a basis behind each one. Nothing is loaded up front
       except what you are standing on — 87,599 nodes is not a thing to
       fetch and lay out, it is a thing to walk. */
    const [nodes, setNodes] = useState([])      // everything seen so far
    const [links, setLinks] = useState([])
    const [loadingHood, setLoadingHood] = useState(false)
    const [signals, setSignals] = useState([])
    const [sigMeta, setSigMeta] = useState(null)
    const [claims, setClaims] = useState([])
    const [stats, setStats] = useState(null)
    const [results, setResults] = useState([])

    useEffect(() => {
        const o = { credentials: "include" }
        fetch(`${API_BASE}/api/ontology/relations?level=country&limit=400`, o)
            .then((r) => (r.ok ? r.json() : null)).then(setRel).catch(() => {})
        fetch(`${API_BASE}/api/ontology/chains`, o)
            .then((r) => (r.ok ? r.json() : null)).then(setChains).catch(() => {})
        fetch(`${API_BASE}/api/ontology/countries`, o)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => setCountries(safeArray(d?.countries))).catch(() => {})
        graphStats().then(setStats)
        reviewClaims().then(setClaims)
        liveSignals().then(({ signals: sg, unplaced, total }) => {
            setSignals(sg)
            setSigMeta({ unplaced, total })
        }).catch(() => setErr("the live surface did not load"))
    }, [])

    const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])

    /** Merge a neighbourhood into what we already have, without duplicates. */
    const absorb = useCallback((hood) => {
        setNodes((prev) => {
            const m = new Map(prev.map((n) => [n.id, n]))
            for (const n of hood.nodes) m.set(n.id, n)
            return [...m.values()]
        })
        setLinks((prev) => {
            const m = new Map(prev.map((l) => [l.id || `${l.src}>${l.dst}`, l]))
            for (const l of hood.links) m.set(l.id || `${l.src}>${l.dst}`, l)
            return [...m.values()]
        })
    }, [])

    /** Walk to an entity: load its neighbourhood, then stand on it. */
    const walkTo = useCallback(async (id, label) => {
        if (!id) return
        setLoadingHood(true)
        try {
            const hood = await neighbourhood(id, { hops: 1, perHop: 60 })
            if (!hood.nodes.length) {
                // A stub answer means the id is not in this store — say so
                // rather than showing an entity with no connections.
                setToast(`${label || id} is not in the graph.`)
                return
            }
            absorb(hood)
            setPath(null)
            setCrumbs((c) => (c.includes(id) ? c.slice(0, c.indexOf(id) + 1) : [...c, id].slice(-6)))
            setFocus(id)
        } finally { setLoadingHood(false) }
    }, [absorb])

    // OPENED ON A NODE from the sidebar's "See detail" (EntityLinksPanel):
    // same id, same model, more room. Pending if this page was not open,
    // an event if it was.
    const bootstrapped = useRef(false)
    useEffect(() => {
        const go = (f) => {
            if (!f?.id) return
            bootstrapped.current = true
            window.__plxOntologyFocus = null
            setView("trace")
            walkTo(f.id, f.label)
        }
        go(window.__plxOntologyFocus)
        const on = (e) => go(e.detail)
        window.addEventListener("akili:ontology-focus", on)
        return () => window.removeEventListener("akili:ontology-focus", on)
    }, [walkTo])

    // Open on a country that actually has signals on it today, so the first
    // screen is about what is happening rather than whatever sorts first.
    useEffect(() => {
        if (bootstrapped.current || !signals.length) return
        const counts = new Map()
        for (const s of signals) if (s.countryId) counts.set(s.countryId, (counts.get(s.countryId) || 0) + 1)
        const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
        if (!top) return
        bootstrapped.current = true
        walkTo(top[0])
    }, [signals, walkTo])

    // Search runs against the real graph, debounced.
    useEffect(() => {
        const t = setTimeout(() => { searchGraph(q).then(setResults) }, 220)
        return () => clearTimeout(t)
    }, [q])

    const nameOfIso = useMemo(() => {
        const m = new Map(countries.map((c) => [c.iso3, c.name]))
        return (iso) => m.get(iso) || iso
    }, [countries])

    const isoOptions = useMemo(() => {
        const seen = new Set()
        safeArray(rel?.edges).forEach((e) => { seen.add(e.source); seen.add(e.target) })
        return [...seen].map((iso) => ({ iso, name: nameOfIso(iso) }))
            .sort((a, b) => a.name.localeCompare(b.name))
    }, [rel, nameOfIso])

    const goTo = (id, label) => {
        if (pathPick && id !== focus) {
            /* Pathfinding runs over what has been WALKED, not over the
               whole graph — 94,191 edges is not something to BFS in a
               click handler, and a path through entities you have never
               seen is not a trace, it is an assertion. */
            const p = findEntityPath(
                links.map((l) => ({ ...l, s: l.src, t: l.dst })), focus, id)
            setPathPick(false)
            if (p) setPath(p)
            else setToast("No chain connects them in what you have opened so far.")
            return
        }
        walkTo(id, label)
    }

    /* ── Trace columns ──────────────────────────────────────────────
       The real graph's links are {src, dst, relation, conf, method, basis}
       — a named relation with the reason it exists. The summary's were
       {s, t, kind}, which is why this had to be rewritten rather than
       renamed. */
    const nbrs = useMemo(() => {
        if (!focus) return []
        return links
            .filter((l) => l.src === focus || l.dst === focus)
            .map((l) => ({ other: l.src === focus ? l.dst : l.src, l, out: l.src === focus }))
            .filter((x) => byId.has(x.other))
    }, [focus, links, byId])

    /** Signals that happened in whatever we are standing on. */
    /** The moment the trace is being read at. day 0 = now. */
    const asOfMs = useMemo(() => Date.now() - day * 86400000, [day])

    const inWindow = useCallback((sg) => {
        if (!day) return true
        const t = Date.parse(sg.when)
        // A signal with no timestamp is shown at every position rather than
        // vanishing — an unparseable date is missing metadata, not evidence
        // that it happened in the future.
        return !Number.isFinite(t) || t <= asOfMs
    }, [day, asOfMs])

    const focusSignals = useMemo(
        () => signals.filter((s) => s.countryId === focus && inWindow(s)),
        [focus, signals, inWindow])

    /** One tick per day that has signals on it, for the scrubber. */
    const ticks = useMemo(() => {
        const byDay = new Map()
        for (const sg of signals) {
            const t = Date.parse(sg.when)
            if (!Number.isFinite(t)) continue
            const d = Math.floor((Date.now() - t) / 86400000)
            if (d < 0 || d > 30) continue
            byDay.set(d, (byDay.get(d) || 0) + 1)
        }
        const mx = Math.max(1, ...byDay.values())
        return [...byDay.entries()].map(([d, n]) => ({ d, n, h: Math.round((n / mx) * 12) + 3 }))
    }, [signals])

    const cols = useMemo(() => {
        if (path) {
            // In path mode the columns ARE the path, left to right.
            return path.map((p, i) => ({
                k: i === 0 ? "from" : i === path.length - 1 ? "to" : `step ${i}`,
                n: "", cards: [{ node: byId.get(p.id), link: p.l }],
            }))
        }
        const f = byId.get(focus)
        if (!f) return []
        const group = { who: [], where: [], what: [] }
        nbrs.forEach((x) => {
            const n = byId.get(x.other)
            if (n) group[typ(n.type).side].push({ node: n, link: x.l, out: x.out })
        })
        /* Signals sit in `what`, at the front. They are the reason anyone
           opened this screen, and they were not in the graph at all until
           they were joined on by place — see constellationGraph.js. */
        const sigCards = focusSignals.map((sg) => ({ node: sg, link: null, signal: true }))
        return [
            { k: "focus", n: "", cards: [{ node: f, link: null }] },
            { k: "who", n: String(group.who.length), cards: group.who },
            { k: "where", n: String(group.where.length), cards: group.where },
            { k: "what", n: String(group.what.length + sigCards.length),
              cards: [...sigCards, ...group.what] },
        ]
    }, [focus, byId, nbrs, path, focusSignals])

    const pend = useMemo(() => claims.slice(0, 14), [claims])

    const route = asked
    const askRoute = () => {
        const edges = safeArray(rel?.edges)
        if (!edges.length) { setToast("The country relation graph has not loaded."); return }
        const r = findRoute(edges, from, to, { families: fams, via: via || null })
        setAsked({ r, from, to, via, fams })
        if (!r) setToast(`No chain of recorded relations connects ${nameOfIso(from)} to ${nameOfIso(to)}.`)
    }

    const L = panL && view !== "sem"
    const R = panR && view !== "sem"
    const gridCols = view === "sem"
        ? "minmax(0,1fr)"
        : `${L ? (vw < 1440 ? "260px " : "300px ") : ""}minmax(0,1fr)${R ? (vw < 1440 ? " 320px" : " 360px") : ""}`
    // the screen sits inside the shell (rail, margins), so its own width is
    // well under the window's: labels go before the buttons are pushed out
    const narrow = vw < 1360 ? "none" : "inline"

    /* The counters name the WHOLE graph, not the slice on screen. Showing
       "43 entities" while standing on a corner of 87,599 reads as the graph
       being nearly empty, which was half of why it looked broken. */
    const corpusMeta = stats
        ? `${(stats.nodes ?? 0).toLocaleString()} entities · ${(stats.edges ?? 0).toLocaleString()} links`
          + ` · ${signals.length} live signals` + (loadingHood ? " · walking…" : "")
        : "reading the graph"

    const VIEWS = [["Trace", "trace", "#g-trace"], ["Pathways", "path", "#g-path"],
                   ["Map", "map", "#g-map"], ["Semantics", "sem", "#g-schema"]]

    /* ══ views ═══════════════════════════════════════════════════════ */

    const traceView = () => (
        <>
            <div style={{
                flex: "none", display: "flex", alignItems: "center", gap: 10,
                minHeight: 42, padding: "6px 16px", borderBottom: "1px solid var(--gline)",
                flexWrap: "wrap",
            }}>
                <span style={EYE}>{path ? "Path" : "Trace"}</span>
                {(path ? [] : crumbs).map((id, i) => {
                    const n = byId.get(id)
                    if (!n) return null
                    return (
                        <span key={id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <button onClick={() => goTo(id)} style={{
                                display: "flex", alignItems: "center", gap: 6, height: 26, padding: "0 9px",
                                border: "1px solid var(--gline)", background: id === focus ? ON : "transparent",
                                color: "var(--txt)", font: "inherit", fontSize: 12, cursor: "pointer",
                                whiteSpace: "nowrap", borderRadius: 0,
                            }}>
                                <I href={typ(n.type).icon} size={12} color="var(--txt3)" />{n.label}
                            </button>
                            {i < crumbs.length - 1 && <span style={{ color: "var(--txt4)" }}>›</span>}
                        </span>
                    )
                })}
                <div style={{ flex: 1 }} />
                {path && (() => {
                    const confs = path.slice(1).map((p) => p.l?.conf ?? 0.5)
                    const comb = confs.reduce((m, c) => m * c, 1)
                    return (
                        <>
                            <span style={{ fontSize: 12, color: "var(--txt2)" }}>
                                {path.length - 1} steps · weakest link {pct(Math.min(...confs))} · combined {pct(comb)}
                            </span>
                            <Btn onClick={() => setPath(null)} style={{ height: 26, fontSize: 12 }}>Back to trace</Btn>
                        </>
                    )
                })()}
                {pathPick && (
                    <span style={{ fontSize: 12, color: "var(--acchi)" }}>
                        Click a second entity to find the path from {byId.get(focus)?.label}
                    </span>
                )}
            </div>

            <div style={{ position: "relative", flex: 1, minHeight: 0, overflow: "auto", background: "transparent" }}>
                <div style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${Math.max(1, cols.length)},minmax(210px,1fr))`,
                    gap: "0 40px", alignItems: "start", padding: "20px 22px 28px",
                    minWidth: cols.length * 240,
                }}>
                    {cols.map((col) => (
                        <div key={col.k} style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
                            <div style={{
                                display: "flex", alignItems: "baseline", gap: 8,
                                paddingBottom: 6, borderBottom: "1px solid var(--gline)",
                            }}>
                                <span style={EYE}>{col.k}</span>
                                <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, color: "var(--txt4)" }}>{col.n}</span>
                            </div>
                            {col.cards.map((cd, i) => {
                                const n = cd.node
                                if (!n) return null
                                const t = typ(n.type)
                                // The real graph has no `inferred` flag; a low
                                // confidence is what "not asserted" looks like here.
                                const inferred = cd.link ? (cd.link.conf ?? 1) < 0.75 : false
                                return (
                                    <button key={n.id + i} onClick={() => {
                                        if (cd.signal) {
                                            // A signal is not a graph node: there is
                                            // nothing to walk to. Show it where it is.
                                            if (n.lat != null) {
                                                window.dispatchEvent(new CustomEvent("akili:open-map"))
                                                window.dispatchEvent(new CustomEvent("akili:fly-to", {
                                                    detail: { lat: n.lat, lon: n.lon, altitude: 300000 },
                                                }))
                                            }
                                            return
                                        }
                                        goTo(n.id, n.label)
                                    }} style={{
                                        display: "grid", gridTemplateColumns: "28px minmax(0,1fr)",
                                        gap: "2px 10px", alignItems: "center", width: "100%",
                                        padding: "10px 12px",
                                        border: `1px ${inferred ? "dashed" : "solid"} ${n.id === focus ? "var(--acchi)" : "var(--gline2)"}`,
                                        background: n.id === focus ? ON : "var(--solid)",
                                        color: "var(--txt)", textAlign: "left", cursor: "pointer",
                                        font: "inherit", borderRadius: 0,
                                    }}>
                                        <span style={{
                                            gridRow: "span 2", display: "flex", alignItems: "center",
                                            justifyContent: "center", width: 28, height: 28,
                                            border: "1px solid var(--gline2)", color: "var(--txt2)",
                                        }}><I href={t.icon} size={16} /></span>
                                        <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                                            <b style={{
                                                fontWeight: 600, overflow: "hidden",
                                                textOverflow: "ellipsis", whiteSpace: "nowrap",
                                            }}>{n.label}</b>
                                            {pins.includes(n.id) && <I href="#g-pin" size={11} color="var(--acchi)" />}
                                        </span>
                                        <span style={{
                                            fontSize: 11.5, color: "var(--txt3)", overflow: "hidden",
                                            textOverflow: "ellipsis", whiteSpace: "nowrap",
                                        }}>{cd.signal ? (n.place || t.label) : t.label}</span>
                                        {/* A SIGNAL SAYS WHY IT IS HERE.
                                            It has no graph link — it was joined
                                            on by the country in its place
                                            string — so without this it sits in
                                            the column looking like an asserted
                                            relationship, which it is not. */}
                                        {cd.signal && (
                                            <span style={{
                                                gridColumn: "1 / 3", display: "flex", alignItems: "center", gap: 6,
                                                marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--gline)",
                                                fontSize: 11, color: "var(--txt2)",
                                            }}>
                                                <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, color: "var(--acchi)" }}>◦</span>
                                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                    reported here · {n.source || "feed"}
                                                </span>
                                                <span style={{
                                                    marginLeft: "auto", fontFamily: "var(--mz-font-mono)",
                                                    fontSize: 10, color: "var(--txt3)", whiteSpace: "nowrap",
                                                }}>{n.severity || ""}</span>
                                            </span>
                                        )}
                                        {cd.link && (
                                            <span style={{
                                                gridColumn: "1 / 3", display: "flex", alignItems: "center", gap: 6,
                                                marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--gline)",
                                                fontSize: 11, color: "var(--txt2)",
                                            }}>
                                                <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, color: "var(--acchi)" }}>
                                                    {cd.out ? "→" : "←"}
                                                </span>
                                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                    {(cd.link.relation || cd.link.kind || "linked").replace(/_/g, " ")}
                                                </span>
                                                <span style={{
                                                    marginLeft: "auto", fontFamily: "var(--mz-font-mono)",
                                                    fontSize: 10, color: "var(--txt3)", whiteSpace: "nowrap",
                                                }}>{pct(cd.link.conf ?? 0)}</span>
                                            </span>
                                        )}
                                    </button>
                                )
                            })}
                            {!col.cards.length && (
                                /* NAME THE GAP. "Nothing of this kind is
                                   linked here" reads as a UI that failed to
                                   load. The graph holds 613 factions and 476
                                   organisations and none of them are joined
                                   to a country by any relation it carries —
                                   that is a fact about the data worth
                                   stating, not an empty box. */
                                <span style={{ fontSize: 11.5, color: "var(--txt4)", padding: "6px 0", textWrap: "pretty" }}>
                                    {col.k === "who" && stats?.nodes_by_type
                                        ? `No actor is linked to this. The graph holds `
                                          + `${((stats.nodes_by_type.faction || 0) + (stats.nodes_by_type.org || 0)).toLocaleString()} `
                                          + `factions and organisations, but none of its relations connect them to a country.`
                                        : "Nothing of this kind is linked here."}
                                </span>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </>
    )

    /* ── Pathways · the question, asked out loud ──────────────────── */
    const pathwaysView = () => {
        const r = route?.r
        const q1 = `How could something reach ${nameOfIso(route?.to || to)} from ${nameOfIso(route?.from || from)}`
        const q2 = route?.via ? ` via ${nameOfIso(route.via)}?` : "?"
        return (
            <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "22px 24px 40px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 1100 }}>

                    {/* the ask */}
                    <div style={{
                        display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 10,
                        padding: "14px 16px", border: "1px solid var(--gline)", background: "var(--glass2)",
                    }}>
                        {[["From", from, setFrom, false], ["To", to, setTo, false], ["Via (optional)", via, setVia, true]]
                            .map(([label, val, set, blank]) => (
                                <label key={label} style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                                    <span style={EYE}>{label}</span>
                                    <select value={val} onChange={(e) => set(e.target.value)} style={{
                                        height: 30, padding: "0 6px", border: "1px solid var(--gline2)",
                                        background: "var(--glass2)", color: "var(--txt)", font: "inherit",
                                        borderRadius: 0, minWidth: 150,
                                    }}>
                                        {blank && <option value="">anywhere</option>}
                                        {isoOptions.map((o) => <option key={o.iso} value={o.iso}>{o.name}</option>)}
                                    </select>
                                </label>
                            ))}
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <span style={EYE}>Steps may be</span>
                            <div style={{ display: "flex", border: "1px solid var(--gline2)" }}>
                                {Object.entries(FAMILY).map(([k, f]) => {
                                    const on = fams.includes(k)
                                    return (
                                        <button key={k} title={f.reads} onClick={() => setFams(
                                            on ? fams.filter((x) => x !== k) : [...fams, k])} style={{
                                            height: 30, padding: "0 10px", border: 0,
                                            background: on ? ON : "transparent",
                                            color: on ? "var(--txt)" : "var(--txt3)",
                                            font: "inherit", fontSize: 12, cursor: "pointer",
                                        }}>{f.label}</button>
                                    )
                                })}
                            </div>
                        </div>
                        <Btn onClick={askRoute} primary icon="#g-path" style={{ marginLeft: "auto" }}>Trace the route</Btn>
                    </div>

                    {/* THE QUESTION, BIG. It is the thing the screen is for,
                        so it is set at the size of a headline and not as a
                        caption over a diagram. */}
                    <h1 style={{
                        margin: 0, fontWeight: 600, fontSize: 34, lineHeight: 1.1,
                        letterSpacing: "-.015em", textWrap: "balance", maxWidth: 900,
                    }}>{q1}{q2}</h1>

                    {!route && (
                        <p style={{ margin: 0, fontSize: 14, color: "var(--txt3)", maxWidth: 760, textWrap: "pretty" }}>
                            Pick two countries and trace the route. The answer is built from
                            {" "}{(rel?.total_relations ?? 0).toLocaleString()} relations distilled from reported
                            events — who was described as doing what with whom. It can show you that a
                            path exists; it can never show you that anything travelled along it.
                        </p>
                    )}

                    {route && !r && (
                        <div style={{ padding: "16px 18px", border: "1px solid var(--gline)", background: "var(--glass2)" }}>
                            <b style={{ fontWeight: 600, fontSize: 15 }}>No chain connects them.</b>
                            <p style={{ margin: "6px 0 0", color: "var(--txt3)", fontSize: 13, textWrap: "pretty" }}>
                                Within {route.fams.join(" and ")} relations, nothing in the record links
                                {" "}{nameOfIso(route.from)} to {nameOfIso(route.to)}
                                {route.via ? ` through ${nameOfIso(route.via)}` : ""}. That is an absence
                                of reporting, not an absence of a route.
                            </p>
                        </div>
                    )}

                    {r && (
                        <>
                            <p style={{
                                margin: 0, fontSize: 15, lineHeight: 1.6, color: "var(--txt2)",
                                maxWidth: 820, textWrap: "pretty",
                            }}>{routeStatement(r, nameOfIso)}</p>

                            <div style={{ display: "flex", gap: 0, border: "1px solid var(--gline)" }}>
                                {[[`${r.hops}`, "steps"],
                                  [pct(r.weakest), "weakest step"],
                                  [pct(r.combined), "whole chain"]].map(([v, k], i) => (
                                    <div key={k} style={{
                                        display: "flex", flexDirection: "column", gap: 2, padding: "14px 18px",
                                        borderRight: i < 2 ? "1px solid var(--gline)" : 0, minWidth: 130,
                                    }}>
                                        <span style={{
                                            fontFamily: "var(--mz-font-mono)", fontSize: 24, fontWeight: 500,
                                            color: k === "whole chain" && r.combined < 0.25 ? "var(--amber)" : "var(--txt)",
                                        }}>{v}</span>
                                        <span style={{ fontSize: 12, color: "var(--txt3)" }}>{k}</span>
                                    </div>
                                ))}
                            </div>

                            {/* the chain, step by step, with its evidence */}
                            <div style={{ display: "flex", flexDirection: "column", border: "1px solid var(--gline)", background: "var(--glass2)" }}>
                                {r.steps.map((s, i) => {
                                    const f = FAMILY[s.edge.family] || FAMILY.diplomatic
                                    const c = s.edge.family === "material" ? "var(--acchi)"
                                        : s.edge.family === "hostile" ? "var(--red)" : "var(--txt3)"
                                    return (
                                        <div key={i} style={{
                                            display: "grid", gridTemplateColumns: "30px minmax(0,1fr) auto",
                                            gap: "4px 14px", alignItems: "center", padding: "14px 16px",
                                            borderBottom: i < r.steps.length - 1 ? "1px solid var(--gline)" : 0,
                                        }}>
                                            <span style={{ ...EYE, fontSize: 11 }}>{String(i + 1).padStart(2, "0")}</span>
                                            <span style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
                                                <b style={{ fontWeight: 600, fontSize: 16 }}>{nameOfIso(s.from)}</b>
                                                <span style={{
                                                    fontFamily: "var(--mz-font-mono)", fontSize: 11, color: c,
                                                    padding: "2px 7px", border: `1px solid ${c}`,
                                                }}>{(s.edge.relation || "").replace(/_/g, " ")}</span>
                                                <b style={{ fontWeight: 600, fontSize: 16 }}>{nameOfIso(s.to)}</b>
                                            </span>
                                            <span style={{
                                                fontFamily: "var(--mz-font-mono)", fontSize: 11, color: "var(--txt3)",
                                                whiteSpace: "nowrap",
                                            }}>{pct(stepConfidence(s.edge))}</span>
                                            <span />
                                            <span style={{ fontSize: 12, color: "var(--txt3)", textWrap: "pretty" }}>
                                                {f.reads} · {s.edge.events} reported {s.edge.events === 1 ? "event" : "events"}
                                                {s.edge.last_seen ? `, last ${s.edge.last_seen}` : ""}
                                            </span>
                                            <span style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                                                {safeArray(s.edge.examples).slice(0, 2).map((ex, j) => (
                                                    <a key={j} href={ex.url} target="_blank" rel="noreferrer" style={{
                                                        fontSize: 11, color: "var(--acchi)", whiteSpace: "nowrap",
                                                    }}>source {j + 1} ↗</a>
                                                ))}
                                            </span>
                                        </div>
                                    )
                                })}
                            </div>
                        </>
                    )}

                    {/* what the engine already flagged, unprompted */}
                    <section style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                            <b style={{ fontWeight: 600, fontSize: 15 }}>Pathways already flagged</b>
                            <span style={{ fontSize: 12, color: "var(--txt3)" }}>
                                Found by the engine without being asked, from {(chains?.events_considered ?? 0).toLocaleString()} events.
                            </span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(330px,1fr))", gap: 8 }}>
                            {safeArray(chains?.chains).slice(0, 12).map((c, i) => (
                                <button key={i} onClick={() => {
                                    setFrom(c.origin); setTo(c.destination); setVia(c.via || "")
                                    const rr = findRoute(safeArray(rel?.edges), c.origin, c.destination,
                                        { families: fams, via: c.via || null })
                                    setAsked({ r: rr, from: c.origin, to: c.destination, via: c.via || "", fams })
                                }} style={{
                                    display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px",
                                    border: "1px solid var(--gline)", background: "var(--glass2)",
                                    color: "var(--txt)", font: "inherit", textAlign: "left",
                                    cursor: "pointer", borderRadius: 0,
                                }}>
                                    <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                        <b style={{ fontWeight: 600 }}>{nameOfIso(c.origin)}</b>
                                        <span style={{ color: "var(--txt4)" }}>→</span>
                                        <b style={{ fontWeight: 600, color: "var(--txt3)" }}>{nameOfIso(c.via)}</b>
                                        <span style={{ color: "var(--txt4)" }}>→</span>
                                        <b style={{ fontWeight: 600 }}>{nameOfIso(c.destination)}</b>
                                        <span style={{
                                            marginLeft: "auto", fontFamily: "var(--mz-font-mono)",
                                            fontSize: 10, color: "var(--txt4)",
                                        }}>{pct(c.confidence)}</span>
                                    </span>
                                    <span style={{ fontSize: 12, lineHeight: 1.5, color: "var(--txt3)", textWrap: "pretty" }}>
                                        {c.statement}
                                    </span>
                                </button>
                            ))}
                        </div>
                        {chains && !safeArray(chains.chains).length && (
                            <div style={{ padding: 14, border: "1px solid var(--gline)", color: "var(--txt3)", fontSize: 13 }}>
                                {chains.note || "No pathway met the evidence threshold in this window."}
                            </div>
                        )}
                    </section>
                </div>
            </div>
        )
    }

    /* ── Semantics · the rulebook, from the real graph ────────────── */
    const semView = () => {
        const counts = stats?.nodes_by_type || {}
        /* Relation rules describe the WHOLE graph where the server reports
           it, and what has been walked where it does not — stated either
           way, because a rule table that silently describes a corner of the
           graph is worse than one that admits its scope. */
        const serverRels = stats?.edges_by_relation || null
        const kinds = {}
        links.forEach((l) => {
            const k = l.relation || "related"
            kinds[k] = kinds[k] || { n: 0, inf: 0, conf: [] }
            kinds[k].n += 1
            if ((l.conf ?? 1) < 0.75) kinds[k].inf += 1
            kinds[k].conf.push(l.conf ?? 0)
        })
        if (serverRels) {
            for (const [k, n] of Object.entries(serverRels)) {
                kinds[k] = kinds[k] || { n: 0, inf: 0, conf: [] }
                kinds[k].n = n
            }
        }
        const rules = Object.entries(kinds).sort((a, b) => b[1].n - a[1].n)
        const inferredN = links.filter((l) => (l.conf ?? 1) < 0.75).length
        return (
            <div style={{
                flex: 1, minHeight: 0, overflow: "auto", padding: "22px 24px 40px",
                display: "flex", flexDirection: "column", gap: 26,
            }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 820 }}>
                    <h1 style={{ margin: 0, fontWeight: 600, fontSize: 22, letterSpacing: "-.01em" }}>Semantics</h1>
                    <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: "var(--txt2)", textWrap: "pretty" }}>
                        The rules behind Constellation: which entity types exist, which links between them
                        are allowed, how much evidence each link needs, and which links Parallax may infer
                        on its own. This reads the live graph, so it describes what the rules have actually
                        produced rather than what they were meant to produce.
                    </p>
                </div>

                <div style={{
                    display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
                    gap: 0, border: "1px solid var(--gline)",
                }}>
                    {[[(stats?.nodes ?? 0).toLocaleString(), "entities in the graph", "var(--txt)"],
                      [(stats?.edges ?? 0).toLocaleString(), "links between them", "var(--txt)"],
                      [`${Math.round((inferredN / Math.max(1, links.length)) * 100)}%`, "inferred, not asserted", "var(--amber)"],
                      [claims.length.toLocaleString(), "claims awaiting review", "var(--acchi)"]]
                        .map(([v, k, c], i) => (
                            <div key={k} style={{
                                display: "flex", flexDirection: "column", gap: 2, padding: "14px 16px",
                                borderRight: i < 3 ? "1px solid var(--gline)" : 0,
                            }}>
                                <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 22, fontWeight: 500, color: c }}>{v}</span>
                                <span style={{ fontSize: 12, color: "var(--txt3)" }}>{k}</span>
                            </div>
                        ))}
                </div>

                <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                        <b style={{ fontWeight: 600, fontSize: 15 }}>Entity types</b>
                        <span style={{ fontSize: 12, color: "var(--txt3)" }}>
                            Who-side types sit left of a trace, where and what to the right.
                        </span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))", gap: 8 }}>
                        {Object.entries(TYPE).map(([k, t]) => (
                            <div key={k} style={{
                                display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px",
                                border: "1px solid var(--gline)", background: "var(--glass2)",
                            }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <I href={t.icon} size={16} color="var(--txt2)" />
                                    <b style={{ fontWeight: 600 }}>{t.label}</b>
                                    <span style={{
                                        marginLeft: "auto", ...EYE, fontSize: 9.5, letterSpacing: ".08em",
                                        border: "1px solid var(--gline2)", padding: "1px 6px",
                                    }}>{t.side}</span>
                                    <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, color: "var(--txt4)" }}>
                                        {counts[k] ?? nodes.filter((n) => n.type === k).length}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                        <b style={{ fontWeight: 600, fontSize: 15 }}>Relation rules</b>
                        <span style={{ fontSize: 12, color: "var(--txt3)" }}>
                            Every relation the graph currently uses, with how far it is trusted.
                        </span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", border: "1px solid var(--gline)", background: "var(--glass2)" }}>
                        <div style={{
                            display: "grid", gridTemplateColumns: "minmax(0,1.4fr) 110px 110px 90px",
                            gap: 12, padding: "8px 14px", borderBottom: "1px solid var(--gline)",
                            fontSize: 11, color: "var(--txt3)",
                        }}>
                            <span>Relation</span><span>Mean confidence</span><span>Inferred</span><span style={{ textAlign: "right" }}>In use</span>
                        </div>
                        {rules.map(([k, v]) => {
                            const mean = v.conf.reduce((a, b) => a + b, 0) / Math.max(1, v.conf.length)
                            const infPct = Math.round((v.inf / v.n) * 100)
                            return (
                                <div key={k} style={{
                                    display: "grid", gridTemplateColumns: "minmax(0,1.4fr) 110px 110px 90px",
                                    gap: 12, alignItems: "center", padding: "9px 14px",
                                    borderBottom: "1px solid var(--gline)", fontSize: 12.5,
                                }}>
                                    <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 11.5, color: "var(--acchi)" }}>
                                        {k.replace(/_/g, " ")}
                                    </span>
                                    <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 12 }}>{pct(mean)}</span>
                                    <span style={{
                                        fontFamily: "var(--mz-font-mono)", fontSize: 12,
                                        color: infPct === 100 ? "var(--amber)" : "var(--txt3)",
                                    }}>{infPct}%</span>
                                    <span style={{
                                        textAlign: "right", fontFamily: "var(--mz-font-mono)",
                                        fontSize: 11, color: "var(--txt3)",
                                    }}>{v.n}</span>
                                </div>
                            )
                        })}
                    </div>
                    <p style={{ margin: 0, fontSize: 12, color: "var(--txt3)", maxWidth: 820, textWrap: "pretty" }}>
                        {inferredN === links.length
                            ? "Every link you have opened is below 0.75 confidence — treat the structure as a proposal."
                            : `${inferredN} of the ${links.length} links you have opened are below 0.75 confidence `
                              + "and are drawn dashed. Counts above are the whole graph, as the server reports it."}
                    </p>
                </section>
            </div>
        )
    }

    /* ── Map · the real locator, at full size ────────────────────────
       This was a hand-rolled equirectangular projection drawn straight
       into an SVG — a flat lon/lat scaling with no coastline, no place
       names and no sense of where anything was. It was a scatter plot
       wearing a map's name.

       Minimap.jsx is the locator the rest of the app already uses, and it
       answers the only question this view has ("where is this, and what is
       near it") with real coastlines and labels. It is the same component
       at a different size: it takes its viewBox width as a prop now, so
       the projection matches the box instead of being stretched to fit. */
    const mapView = () => {
        /* Signals always have coordinates; graph entities often do not, so
           the locator shows both and says which is which. */
        const placed = [...nodes.filter((n) => n.lat != null && n.lon != null), ...signals]
        const f = byId.get(focus)
        const focused = f && f.lat != null && f.lon != null ? f : placed[0]
        const ctx = placed
            .filter((n) => n.id !== focused?.id)
            .map((n) => ({
                lat: n.lat, lon: n.lon, id: n.id,
                severity: (n.risk ?? 0) >= 70 ? "critical" : (n.risk ?? 0) >= 45 ? "high" : "low",
                ts: Date.now(),
            }))
        return (
            <div ref={mapBox} style={{ position: "relative", flex: 1, minHeight: 0, background: "transparent" }}>
                {focused ? (
                    <Minimap
                        focus={{ lat: focused.lat, lon: focused.lon }}
                        context={ctx}
                        label={focused.label}
                        framing="theatre"
                        width={mapSize.w}
                        height={mapSize.h}
                        title={focused.label}
                        subtitle={`${placed.length} of ${nodes.length} entities have a location`}
                    />
                ) : (
                    <div style={{ padding: 20, color: "var(--txt3)" }}>
                        Nothing in this graph has a location yet.
                    </div>
                )}
                <div style={{
                    position: "absolute", left: 12, bottom: 12, display: "flex", flexWrap: "wrap", gap: 10,
                    maxWidth: "70%", padding: "8px 14px", background: "var(--glass)",
                    border: "1px solid var(--gline2)", borderRadius: 14, fontSize: 11, color: "var(--txt3)",
                    backdropFilter: "blur(22px) saturate(1.15)", WebkitBackdropFilter: "blur(22px) saturate(1.15)",
                    pointerEvents: "none",
                }}>
                    <span>Entities without a location — people, owners, lists — stay in Trace.</span>
                </div>
            </div>
        )
    }

    /* ══ chrome ══════════════════════════════════════════════════════ */
    if (err) return <div style={{ padding: 20, color: "var(--txt3)" }}>Constellation is unavailable ({err}).</div>
    /* Wait on the SIGNALS, not on a whole-graph fetch — there is no
       whole-graph fetch any more. The trace fills in as you walk. */
    if (!sigMeta) return <Loading size={22} inline label="Reading the surface" style={{ padding: 20 }} />

    const f = byId.get(focus)

    return (
        <section data-screen-label="Constellation" style={MODE_SURFACE}>
            <header data-screen-label="Top bar" style={{
                flex: "none", height: 48, display: "flex", alignItems: "center", gap: 10,
                minWidth: 0, padding: "0 12px 0 14px", background: "var(--bar)",
                backdropFilter: "blur(22px) saturate(1.15)", WebkitBackdropFilter: "blur(22px) saturate(1.15)",
                borderBottom: "1px solid var(--gline)", zIndex: 30,
            }}>
                <button onClick={() => setPanL((v) => !v)} title="Signals panel" style={{
                    width: 30, height: 30, flex: "none", display: "flex", alignItems: "center",
                    justifyContent: "center", border: "1px solid var(--gline2)",
                    background: L ? ON : "transparent", color: "var(--txt2)", cursor: "pointer", borderRadius: 0,
                }}><I href="#g-inbox" /></button>
                <b style={{ fontWeight: 600, fontSize: 15, whiteSpace: "nowrap" }}>Constellation</b>
                {theater && <span style={{ fontSize: 12, color: "var(--txt3)", whiteSpace: "nowrap" }}>· {theater}</span>}
                <nav style={{ display: "flex", border: "1px solid var(--gline2)", flex: "none" }}>
                    {VIEWS.map(([k, v, icon]) => (
                        <button key={v} onClick={() => setView(v)} style={{
                            display: "flex", alignItems: "center", gap: 7, height: 30, padding: "0 12px",
                            border: 0, background: view === v ? ON : "transparent",
                            color: view === v ? "var(--txt)" : "var(--txt3)",
                            fontSize: 13, font: "inherit", cursor: "pointer", whiteSpace: "nowrap",
                        }}><I href={icon} />{k}</button>
                    ))}
                </nav>
                <span title={corpusMeta} style={{
                    display: narrow, fontFamily: "var(--mz-font-mono)", fontSize: 10,
                    letterSpacing: ".08em", color: "var(--txt4)", whiteSpace: "nowrap",
                    flex: "0 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis",
                }}>{corpusMeta}</span>
                <div style={{ flex: 1, minWidth: 0 }} />
                {(view === "trace" || view === "map") && (
                    <div style={{ display: "flex", gap: 6 }}>
                        <Btn icon="#g-path"
                            active={pathPick || !!path}
                            onClick={() => { if (path) { setPath(null); setPathPick(false) } else setPathPick((v) => !v) }}>
                            <span style={{ display: narrow }}>
                                {path ? "Exit path" : pathPick ? "Pick target…" : "Find path"}
                            </span>
                        </Btn>
                        <Btn icon="#g-camera" primary onClick={() => setToast("Figure added to your brief")}>
                            <span style={{ display: narrow }}>Capture to brief</span>
                        </Btn>
                    </div>
                )}
                <button onClick={() => setPanR((v) => !v)} title="Inspector" style={{
                    width: 30, height: 30, flex: "none", display: "flex", alignItems: "center",
                    justifyContent: "center", border: "1px solid var(--gline2)",
                    background: R ? ON : "transparent", color: "var(--txt2)", cursor: "pointer", borderRadius: 0,
                }}><I href="#g-schema" /></button>
            </header>

            <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: gridCols }}>
                {L && (
                    <aside data-screen-label="Signals" style={{
                        display: "flex", flexDirection: "column", minHeight: 0,
                        borderRight: "1px solid var(--gline)", background: "var(--glass2)",
                    }}>
                        <div style={{
                            padding: "12px 12px 10px", borderBottom: "1px solid var(--gline)",
                            display: "flex", flexDirection: "column", gap: 8, flex: "none",
                        }}>
                            <label style={{ position: "relative", display: "block" }}>
                                <I href="#g-search" size={14} color="var(--txt4)"
                                    style={{ position: "absolute", left: 10, top: 10 }} />
                                <input value={q} onChange={(e) => setQ(e.target.value)}
                                    placeholder="Find any entity, ID or signal" style={{
                                        width: "100%", height: 34, padding: "0 10px 0 32px",
                                        border: "1px solid var(--gline2)", background: "var(--canvas)",
                                        color: "var(--txt)", fontSize: 13, outline: "none", borderRadius: 0,
                                    }} />
                            </label>
                            {results.length > 0 && (
                                <div style={{
                                    display: "flex", flexDirection: "column", border: "1px solid var(--gline2)",
                                    background: "var(--glass2)", maxHeight: 260, overflow: "auto",
                                }}>
                                    {results.map((n) => (
                                        <button key={n.id} onClick={() => { goTo(n.id, n.label); setQ("") }} style={{
                                            display: "grid", gridTemplateColumns: "16px minmax(0,1fr)",
                                            gap: 8, alignItems: "center", padding: "7px 10px", border: 0,
                                            borderBottom: "1px solid var(--gline)", background: "transparent",
                                            color: "var(--txt)", font: "inherit", textAlign: "left", cursor: "pointer",
                                        }}>
                                            <I href={typ(n.type).icon} size={14} color="var(--txt3)" />
                                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                {n.label}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                            {/* LIVE SIGNALS, NOT GRAPH STUBS.
                                This listed the summary graph's 40 "event"
                                nodes, which share nine labels between them
                                — the same sentence over and over. These are
                                today's surface, in their own words, each
                                one able to start a trace at the country it
                                happened in. */}
                            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 12px 6px" }}>
                                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--txt2)" }}>Signals</span>
                                <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, color: "var(--txt4)" }}>
                                    {signals.length} live
                                </span>
                                <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--txt4)" }}>start a trace</span>
                            </div>
                            {sigMeta?.unplaced > 0 && (
                                <div style={{ padding: "0 12px 8px", fontSize: 11, color: "var(--txt4)", textWrap: "pretty" }}>
                                    {sigMeta.unplaced} of {sigMeta.total} could not be placed on a country and
                                    will not appear in a trace.
                                </div>
                            )}
                            {signals.map((g) => {
                                const c = g.severity === "critical" ? "var(--red)"
                                    : g.severity === "significant" ? "var(--amber)" : "var(--steel)"
                                return (
                                    <button key={g.id} title={g.countryId ? `Trace from ${g.place}` : "No country for this signal"}
                                        onClick={() => { if (g.countryId) goTo(g.countryId, g.place) }} style={{
                                            display: "grid", gridTemplateColumns: "8px minmax(0,1fr)",
                                            gap: "2px 10px", alignItems: "center", width: "100%", padding: "9px 12px",
                                            border: 0, borderTop: "1px solid var(--gline)",
                                            background: g.countryId === focus ? ON : "transparent",
                                            color: "var(--txt)", font: "inherit", textAlign: "left",
                                            cursor: g.countryId ? "pointer" : "default",
                                            opacity: g.countryId ? 1 : 0.55,
                                        }}>
                                        <i style={{ width: 8, height: 8, background: c }} />
                                        <span style={{
                                            fontWeight: 600, overflow: "hidden",
                                            textOverflow: "ellipsis", whiteSpace: "nowrap",
                                        }}>{g.label}</span>
                                        <span />
                                        <span style={{
                                            fontSize: 11.5, color: "var(--txt3)", overflow: "hidden",
                                            textOverflow: "ellipsis", whiteSpace: "nowrap",
                                        }}>{[g.place, g.source].filter(Boolean).join(" · ")}</span>
                                    </button>
                                )
                            })}

                            <div style={{
                                display: "flex", alignItems: "center", gap: 8, padding: "16px 12px 6px",
                                borderTop: "1px solid var(--gline)",
                            }}>
                                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--txt2)" }}>To review</span>
                                <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, color: "var(--txt4)" }}>
                                    {claims.length}
                                </span>
                            </div>
                            {!pend.length && (
                                <div style={{ padding: "6px 12px 12px", fontSize: 12, color: "var(--txt3)" }}>
                                    Nothing is waiting on a decision.
                                </div>
                            )}
                            {/* CLAIMS, WITH THEIR EVIDENCE. This read
                                /api/graph/review, which is entity
                                RESOLUTION — "these two records are the same
                                vessel". The ontology's own claim store is
                                the thing the spec means by review: an
                                asserted relationship, the source behind it,
                                and a decision to make. It has had the right
                                columns and real rows for a while and no UI. */}
                            {pend.map((r, i) => (
                                <div key={r.claim_id || i} style={{
                                    display: "grid", gridTemplateColumns: "minmax(0,1fr) auto",
                                    gap: "4px 8px", alignItems: "center", padding: "8px 12px",
                                    borderTop: "1px solid var(--gline)",
                                }}>
                                    <span style={{ minWidth: 0, fontSize: 12, lineHeight: 1.4 }}>
                                        <b style={{ fontWeight: 600 }}>{r.subject}</b>{" "}
                                        <span style={{ color: "var(--txt3)" }}>
                                            {(r.relationship || "relates to").replace(/_/g, " ")}
                                        </span>{" "}
                                        <b style={{ fontWeight: 600 }}>{r.object}</b>
                                    </span>
                                    <span style={{ display: "flex", gap: 4 }}>
                                        <button onClick={() => setToast("Confirmed — the claim stands")} title="Confirm" style={{
                                            width: 26, height: 26, border: "1px solid var(--gline2)",
                                            background: "transparent", color: "var(--green)", cursor: "pointer", borderRadius: 0,
                                        }}>✓</button>
                                        <button onClick={() => setToast("Rejected — the claim is withdrawn")} title="Reject" style={{
                                            width: 26, height: 26, border: "1px solid var(--gline2)",
                                            background: "transparent", color: "var(--red)", cursor: "pointer", borderRadius: 0,
                                        }}>✕</button>
                                    </span>
                                    <span style={{
                                        gridColumn: "1 / 3", fontFamily: "var(--mz-font-mono)",
                                        fontSize: 10, color: "var(--txt4)", overflow: "hidden",
                                        textOverflow: "ellipsis", whiteSpace: "nowrap",
                                    }} title={r.because?.detail || ""}>
                                        {r.confidence || "inferred"}
                                        {r.because?.title ? ` · ${r.because.title}` : ""}
                                        {r.because?.detail ? ` · ${r.because.detail}` : ""}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </aside>
                )}

                <main style={{ position: "relative", minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
                    {view !== "sem" && (
                        <>
                            <EdgeHandle side="left" open={L} label="the signals panel"
                                onClick={() => setPanL((v) => !v)} />
                            <EdgeHandle side="right" open={R} label="the inspector"
                                onClick={() => setPanR((v) => !v)} />
                        </>
                    )}
                    {view === "trace" && traceView()}
                    {view === "path" && pathwaysView()}
                    {view === "map" && mapView()}
                    {view === "sem" && semView()}

                    {/* ▣ Time — the spec's bar, under the trace and the map. */}
                    {(view === "trace" || view === "map") && (
                        <div data-screen-label="Time" style={{
                            flex: "none", display: "grid",
                            gridTemplateColumns: "auto auto minmax(120px,1fr) auto",
                            gap: 14, alignItems: "center", height: 58,
                            padding: "0 16px", borderTop: "1px solid var(--gline)",
                        }}>
                            <button onClick={() => setPlaying((v) => !v)}
                                title={playing ? "Pause" : "Replay the last 30 days"} style={{
                                    width: 32, height: 32, display: "flex", alignItems: "center",
                                    justifyContent: "center", border: "1px solid var(--gline2)",
                                    background: "transparent", color: "var(--txt)",
                                    cursor: "pointer", borderRadius: 0,
                                }}><I href={playing ? "#g-pause" : "#g-play"} size={14} /></button>

                            <div style={{ display: "flex", flexDirection: "column", minWidth: 96 }}>
                                <b style={{ fontWeight: 600, fontSize: 13 }}>
                                    {day === 0 ? "Now" : new Date(asOfMs).toISOString().slice(0, 10)}
                                </b>
                                <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, color: "var(--txt4)" }}>
                                    {day === 0 ? "live" : `${day} ${day === 1 ? "day" : "days"} ago`}
                                </span>
                            </div>

                            <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 2 }}>
                                <div style={{ position: "relative", height: 16 }}>
                                    {ticks.map((tk) => (
                                        <i key={tk.d} title={`${tk.n} ${tk.n === 1 ? "signal" : "signals"}`}
                                            style={{
                                                position: "absolute", bottom: 0,
                                                left: `${((30 - tk.d) / 30) * 100}%`,
                                                width: 2, height: tk.h,
                                                background: tk.d === day ? "var(--acchi)" : "var(--gline2)",
                                            }} />
                                    ))}
                                </div>
                                <input type="range" min={0} max={30} value={30 - day}
                                    onChange={(e) => { setPlaying(false); setDay(30 - Number(e.target.value)) }}
                                    style={{ width: "100%", margin: 0, accentColor: "var(--acchi)" }} />
                                <div style={{
                                    display: "flex", justifyContent: "space-between",
                                    fontFamily: "var(--mz-font-mono)", fontSize: 9.5, color: "var(--txt4)",
                                }}>
                                    <span>30 days ago</span><span style={{ display: narrow }}>15 days ago</span><span>today</span>
                                </div>
                            </div>

                            <span style={{
                                display: narrow, fontSize: 11.5, color: "var(--txt3)", whiteSpace: "nowrap",
                            }}>
                                {focusSignals.length} of {signals.filter((x) => x.countryId === focus).length} signals here
                                {day ? " as of then" : ""}
                            </span>
                        </div>
                    )}
                </main>

                {R && (
                    <aside data-screen-label="Inspector" style={{
                        display: "flex", flexDirection: "column", minHeight: 0,
                        borderLeft: "1px solid var(--gline)", background: "var(--glass2)", overflow: "auto",
                    }}>
                        {f ? (
                            <>
                                <div style={{
                                    flex: "none", display: "flex", flexDirection: "column", gap: 6,
                                    padding: "16px 16px 12px", borderBottom: "1px solid var(--gline)",
                                }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        <I href={typ(f.type).icon} color="var(--txt2)" />
                                        <span style={{ ...EYE, letterSpacing: ".1em" }}>{typ(f.type).label}</span>
                                        <span style={{
                                            marginLeft: "auto", fontFamily: "var(--mz-font-mono)",
                                            fontSize: 10, color: "var(--txt4)",
                                        }}>{f.id.slice(0, 18)}</span>
                                    </div>
                                    <b style={{ fontWeight: 600, fontSize: 18, lineHeight: 1.25 }}>{f.label}</b>
                                    <span style={{ fontSize: 12.5, color: "var(--txt3)" }}>
                                        {nbrs.length} {nbrs.length === 1 ? "link" : "links"} · risk {f.risk ?? "—"}
                                        {f.country ? ` · ${f.country}` : ""}
                                    </span>
                                    <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                                        <Btn icon="#g-pin" active={pins.includes(f.id)}
                                            onClick={() => setPins((p) => p.includes(f.id) ? p.filter((x) => x !== f.id) : [...p, f.id])}>
                                            {pins.includes(f.id) ? "Pinned" : "Pin"}
                                        </Btn>
                                        <Btn icon="#g-path" onClick={() => { setPath(null); setPathPick(true); setView("trace") }}>Path</Btn>
                                    </div>
                                </div>
                                <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                                    <span style={EYE}>Links</span>
                                    {nbrs.map((x, i) => {
                                        const n = byId.get(x.other)
                                        return (
                                            <button key={i} onClick={() => goTo(x.other)} style={{
                                                display: "grid", gridTemplateColumns: "minmax(0,1fr) auto",
                                                gap: "2px 8px", padding: "8px 0", border: 0,
                                                borderBottom: "1px solid var(--gline)", background: "transparent",
                                                color: "var(--txt)", font: "inherit", textAlign: "left", cursor: "pointer",
                                            }}>
                                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                    {n.label}
                                                </span>
                                                <span style={{
                                                    fontFamily: "var(--mz-font-mono)", fontSize: 10,
                                                    color: (x.l.conf ?? 1) < 0.75 ? "var(--amber)" : "var(--txt3)",
                                                }}>{pct(x.l.conf ?? 0)}</span>
                                                <span style={{ gridColumn: "1 / 3", fontSize: 11, color: "var(--txt3)" }}>
                                                    {x.out ? "→ " : "← "}{(x.l.relation || "linked").replace(/_/g, " ")}
                                                    {x.l.method ? ` · ${x.l.method}` : ""}
                                                </span>
                                            </button>
                                        )
                                    })}
                                </div>
                            </>
                        ) : (
                            <div style={{ padding: 16, color: "var(--txt3)", fontSize: 13 }}>
                                Pick an entity to inspect it.
                            </div>
                        )}
                    </aside>
                )}
            </div>

            {toast && (
                <div style={{
                    position: "absolute", left: "50%", bottom: 24, transform: "translateX(-50%)",
                    padding: "9px 16px", background: "var(--glass)", border: "1px solid var(--gline2)",
                    boxShadow: "var(--gshadow)", borderRadius: 999, fontSize: 12.5, color: "var(--txt)",
                    backdropFilter: "blur(22px) saturate(1.15)", WebkitBackdropFilter: "blur(22px) saturate(1.15)",
                    zIndex: 60, whiteSpace: "nowrap",
                }}>{toast}</div>
            )}
        </section>
    )
}
