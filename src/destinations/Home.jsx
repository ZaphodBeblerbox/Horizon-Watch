/**
 * Home.jsx — PARALLAX v6, Part B ▣ Home, transliterated.
 *
 * THE STRUCTURE IS THE SPEC'S, NOT AN INTERPRETATION OF IT. Header, then
 * a full-width Daily brief, then Suggested, then What changed + Modes,
 * then theaters / assets / Constellation / Recent. Every grid template,
 * padding and type size below is quoted from Part B; where this file adds
 * anything it is data, never layout.
 *
 * THE BRIEF ANSWERS FOUR QUESTIONS IN THREE COLUMNS. What happened
 * overnight, what today may bring, and how last night's forecast actually
 * did — that third column is the one almost no intelligence product ships,
 * and it is the only one that makes the other two worth believing. A
 * forecast nobody scores is a horoscope.
 *
 * WHAT IS REAL AND WHAT IS NOT, stated rather than implied. Overnight is
 * our own /api/surface. Today may bring is /api/forecast/boards. The
 * record column reads the board's `record`, which is presently empty
 * because nothing in the backend resolves forecasts yet — so it says so
 * instead of drawing ticks it cannot justify. Theaters and assets are the
 * spec's first-run defaults until those models land.
 */
import { EXPOSURE } from "./Assets.jsx"
import Dots from "../ui/Dots.jsx"
import { useEffect, useMemo, useRef, useState } from "react"
import API_BASE from "../apiBase.js"
import { getCurrentUser, subscribeAuth } from "../state/authStore.js"
import { greetingFor } from "../data/greetings.js"
import Avatar from "../ui/Avatar.jsx"
import { MODE_SURFACE, MODE_BODY } from "../plx6/modeWindow.js"
import { criticalWhere, forYouLead, leading, leadSentence, placeOf, theaterLines } from "./homeLead.js"
import { countriesInView, partition, watched } from "../state/interests.js"
import { places as loadPlaces } from "../voice/gazetteer.js"
import { getSettings, subscribeSettings } from "../state/settingsStore.js"
import Minimap from "../components/Minimap.jsx"
import TelegramMedia from "../components/TelegramMedia.jsx"
import { THEATER_SCOPE } from "../data/theaterScope.js"
import { whenLabel } from "../utils/formatTime.js"

/** The part of the day and how the brief speaks of it (turns at 05, 12, 18). */
export function slotOf(now) {
    const h = now.getHours()
    const d = new Date(now)
    const at = (hh) => { const x = new Date(d); x.setHours(hh, 0, 0, 0); return x.getTime() }
    if (h >= 5 && h < 12) return { key: `${d.toDateString()}:m`, part: "morning", since: at(5) - 11 * 3600_000,
        happened: "What happened overnight", ahead: "What today may bring", record: "How yesterday's forecast did" }
    if (h >= 12 && h < 18) return { key: `${d.toDateString()}:a`, part: "afternoon", since: at(5),
        happened: "What happened this morning", ahead: "What this afternoon may bring", record: "How this morning's forecast did" }
    const base = h < 5 ? new Date(d.getTime() - 86400_000) : d
    return { key: `${base.toDateString()}:n`, part: "night", since: at(12) - (h < 5 ? 86400_000 : 0),
        happened: "What happened this afternoon", ahead: "What may follow tonight", record: "How this afternoon's forecast did" }
}

/** A value chosen once per key (a part of the day) and kept until the key
 * turns — refreshed three times a day rather than on every poll. It waits
 * for a value that is ready (`ready`) before it settles. */
function useFrozen(key, value, ready) {
    const ref = useRef({ key: null, value: [] })
    if (ref.current.key !== key || !ready(ref.current.value)) {
        if (ready(value)) ref.current = { key, value }
        else if (ref.current.key !== key) ref.current = { key: null, value }
    }
    return ref.current.key === key ? ref.current.value : value
}

/* A null resolution overwrites a default; .catch never fires on one. */
const safeArray = (v) => (Array.isArray(v) ? v : [])

/** Part C `RES` — the four marks a scored forecast can carry. */
const RES = {
    hit:  ["✓", "var(--green)", "Right"],
    miss: ["✕", "var(--red)", "Wrong"],
    part: ["◐", "var(--amber)", "Partly"],
    open: ["·", "var(--txt4)", "Open"],
}

const SEV_DOT = {
    critical: "var(--red)", high: "var(--amber)",
    moderate: "var(--steel)", low: "var(--txt4)",
}

const MODE_ICON = {
    home: "#g-home", map: "#g-globe", graph: "#g-onto", inbox: "#g-inbox",
    briefings: "#g-report", analytics: "#g-orb", assets: "#g-asset",
    fusion: "#g-fusion", work: "#g-work", imagery: "#g-sat",
}
const MODE_NAME = {
    map: "Map", graph: "Constellation", inbox: "Inbox", briefings: "Reports",
    analytics: "Insight", imagery: "Overwatch", assets: "Assets",
    work: "My work", fusion: "Crucible",
}
const MODE_KBD = { map: "M", graph: "G", inbox: "I", briefings: "D" }

const Icon = ({ href, size = 16, color = null }) => (
    <svg width={size} height={size} style={color ? { color } : null} aria-hidden><use href={href} /></svg>
)

/* ── small shared pieces, each exactly as Part B draws it ──────────── */

function CardHead({ title, meta, children }) {
    return (
        <div style={{
            display: "flex", alignItems: "center", gap: 10, minHeight: 38,
            padding: "0 14px", borderBottom: "1px solid var(--gline)",
        }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--txt2)" }}>{title}</span>
            {meta != null && (
                <span style={{
                    marginLeft: children ? 0 : "auto",
                    fontFamily: "var(--mz-font-mono)", fontSize: 10, color: "var(--txt4)",
                }}>{meta}</span>
            )}
            {children}
        </div>
    )
}

const Card = ({ children, tour = null, style = null }) => (
    <div data-tour={tour} style={{
        display: "flex", flexDirection: "column", overflow: "hidden",
        border: "1px solid var(--gline)", borderRadius: 0, minWidth: 0,
        ...(style || {}),
    }}>{children}</div>
)

const rowBtn = {
    width: "100%", border: 0, background: "transparent", color: "var(--txt)",
    font: "inherit", textAlign: "left", cursor: "pointer",
}

const EXPO_RANK = { high: 3, elevated: 2, low: 1, quiet: 0, unknown: -1 }

export default function Home({ onOpenModule = () => {}, onOpenSearch = () => {}, theaters: userTheaters = [] }) {
    const [user, setUser] = useState(() => getCurrentUser())
    // The asset register, most exposed first (destinations/Assets.jsx).
    const [myAssets, setMyAssets] = useState(null)
    useEffect(() => {
        fetch(`${API_BASE}/api/my-assets`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : { assets: [] })).then((d) => setMyAssets(d.assets || [])).catch(() => setMyAssets([]))
    }, [])
    const [surface, setSurface] = useState([])
    const [boards, setBoards] = useState([])
    const [onto, setOnto] = useState(null)
    const [detail, setDetail] = useState([])   // top boards, resolved
    const [record, setRecord] = useState(null) // the model's own scorecard

    useEffect(() => subscribeAuth(setUser), [])

    /* HOME IS LIVE. The surface (critical signals, Telegram footage) is
       re-read every minute so the lead, Newest and "From the ground" show
       what is happening now; a failed poll keeps what is on screen. */
    useEffect(() => {
        const load = () => fetch(`${API_BASE}/api/surface`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (d) setSurface(safeArray(d?.items ?? d)) })
            .catch(() => {})
        // every 30 s: Home leads with what is urgent for this user right now
        const t = setInterval(load, 30_000)
        return () => clearInterval(t)
    }, [])

    /* THE USER'S ASSET ALERTS (asset_watch.py): signals within an asset's
       radius that can reach that kind of asset — personal, rebuilt by the
       server every few minutes, read here every 30 s. */
    const [assetCards, setAssetCards] = useState([])
    useEffect(() => {
        let live = true
        const load = () => fetch(`${API_BASE}/api/notifications?limit=40`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                if (!live || !d) return
                const items = safeArray(d?.items ?? d?.notifications ?? d)
                setAssetCards(items.filter((n) => n.kind === "asset"))
            })
            .catch(() => {})
        load()
        const t = setInterval(load, 30_000)
        return () => { live = false; clearInterval(t) }
    }, [])
    // The clock the page reads: the greeting (morning / afternoon / evening
    // brief) and every "x min ago" move on by themselves.
    const [, setTick] = useState(0)
    useEffect(() => {
        const t = setInterval(() => setTick((n) => n + 1), 60_000)
        return () => clearInterval(t)
    }, [])
    const dayPart = (() => { const h = new Date().getHours(); return h < 12 ? "morning" : h < 18 ? "afternoon" : "evening" })()

    useEffect(() => {
        const opts = { credentials: "include" }
        fetch(`${API_BASE}/api/surface`, opts)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => setSurface(safeArray(d?.items ?? d)))
            .catch(() => setSurface([]))
        fetch(`${API_BASE}/api/forecast/boards`, opts)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                const list = safeArray(d?.boards ?? d)
                setBoards(list)
                /* The board LIST carries no probability — it is in each
                   board's own detail, under `scenarios`. Three requests,
                   because the brief shows three lines and guessing is not
                   an option. */
                return Promise.all(list.slice(0, 3).map((b) =>
                    fetch(`${API_BASE}/api/forecast/boards/${b.id}`, opts)
                        .then((r) => (r.ok ? r.json() : null))
                        .catch(() => null)))
            })
            .then((ds) => {
                const got = safeArray(ds).filter(Boolean)
                setDetail(got)
                if (got[0]?.record) setRecord(got[0].record)
            })
            .catch(() => setBoards([]))
        fetch(`${API_BASE}/api/ontology/diagram`, opts)
            .then((r) => (r.ok ? r.json() : null))
            .then(setOnto)
            .catch(() => setOnto(null))
    }, [])

    /* THE GREETING IS LOCAL, AND IT ROTATES.
       Three hardcoded strings on a `hour < 12 / < 18` split meant the same
       sentence every morning — which stops being read after a week, and
       takes the line underneath it (the actual state of the watch) with
       it. greetings.js holds five local-time buckets with several openers
       each; the seed is fixed once per mount, so it is stable while you
       are looking at it and different next time you open Home. */
    const firstName = (user?.display_name || user?.name || user?.email || "").split(/[\s@.]/)[0]
    const seed = useRef(Math.floor(Math.random() * 997)).current
    const { lead: greeting, sub: sinceMeta, kicker } = useMemo(
        // dayPart in the deps: the brief turns over morning, afternoon, evening.
        () => greetingFor(firstName, { seed }), [firstName, seed, dayPart])
    const initials = ((firstName[0] || "G").toUpperCase()
        + (user?.display_name?.split(" ")[1]?.[0] || "U").toUpperCase())
    const clock = new Date().toISOString().slice(11, 16) + "Z"

    /* WHAT IS FOR THIS USER (state/interests.js): their theaters' countries
       plus whatever they added in Settings. Decided here, at read time; the
       shared surface ranking is untouched. */
    const [countryPlaces, setCountryPlaces] = useState([])
    useEffect(() => { loadPlaces().then((ps) => setCountryPlaces(ps.filter((p) => p.kind === "country"))).catch(() => {}) }, [])
    const [interests, setInterests] = useState(() => getSettings()?.interests || null)
    useEffect(() => subscribeSettings((st) => setInterests(st?.interests || null)), [])
    const w = useMemo(() => watched(interests || {}, userTheaters, countryPlaces, myAssets || []), [interests, userTheaters, countryPlaces, myAssets])
    const split = useMemo(() => partition(surface, w), [surface, w])

    /* MOST URGENT FOR YOU. What this user's theaters and assets make
       theirs (the owner, 2026-10-07: Home is built on the user's interests —
       their theaters and their assets): signals near their assets first,
       then the most severe signals in their theaters' countries and their
       chosen interests, newest first within a severity. Nothing from
       elsewhere: with no theaters or assets it says how to get a list. */
    const urgent = useMemo(() => {
        const SEV = { critical: 0, high: 1, elevated: 1, moderate: 2, medium: 2, low: 3 }
        const fromAssets = assetCards.map((n) => ({
            key: n.id, title: n.title, sev: n.sev, when: n.created_at, why: n.reason,
            assetId: n.asset_id, lat: n.lat, lon: n.lon, kind: "asset",
        }))
        const fromTheaters = split.mine.map((m) => ({
            key: `s:${m.id ?? m.headline}`, title: m.title || m.headline, sev: m.severity_tier,
            when: m.published_at, why: m.location || m.place || "", item: m, kind: "signal",
        }))
        const seen = new Set()
        return [...fromAssets, ...fromTheaters]
            .filter((x) => x.title && !seen.has(x.title) && seen.add(x.title))
            .sort((a, b) => (a.kind === "asset" ? 0 : 1) - (b.kind === "asset" ? 0 : 1)
                || (SEV[a.sev] ?? 9) - (SEV[b.sev] ?? 9)
                || String(b.when || "").localeCompare(String(a.when || "")))
            .slice(0, 6)
    }, [assetCards, split])
    const openUrgent = (u) => {
        if (u.assetId) {
            window.__plxAssetSel = u.assetId
            window.dispatchEvent(new CustomEvent("akili:navigate", { detail: { destination: "assets" } }))
            setTimeout(() => window.dispatchEvent(new CustomEvent("akili:open-asset", { detail: { id: u.assetId } })), 200)
            return
        }
        const it = u.item || {}
        if (it.lat != null) window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: it.lat, lon: it.lon, altitude: 250000 } }))
        window.dispatchEvent(new CustomEvent("akili:open-inspector", { detail: { entityType: it.source_type || "signal", entityId: it.id, data: it } }))
    }
    const hasOwn = (userTheaters || []).length > 0 || (myAssets || []).length > 0 || split.hasInterests

    /* THREE TIMES A DAY. The brief and the footage turn over at the start of
       the morning (05:00), the afternoon (12:00) and the night (18:00), in
       the user's own time — what happened since the last turn, what the
       next part of the day may bring (the owner, 2026-10-07). The urgent
       list above them refreshes every 30 s; these hold still for a part of
       the day, so they can be read rather than chased. */
    const slot = useMemo(() => slotOf(new Date()), [dayPart, Math.floor(Date.now() / 600_000)]) // eslint-disable-line react-hooks/exhaustive-deps
    const iso2Name = useMemo(() => new Map(countryPlaces.filter((p) => p.iso2).map((p) => [String(p.iso2).toLowerCase(), p.name])), [countryPlaces])

    // Telegram's own feed (the pool holds news): the last 48 hours of posts.
    const [tgPosts, setTgPosts] = useState([])
    useEffect(() => {
        let live = true
        const load = () => fetch(`${API_BASE}/api/telegram/posts?hours=48`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null)).then((d) => { if (live && d) setTgPosts(safeArray(d.posts)) }).catch(() => {})
        load()
        const t = setInterval(load, 10 * 60_000)
        return () => { live = false; clearInterval(t) }
    }, [])

    /* THE THREE MOST BREAKING POINTS, ON VIDEO. Footage from the last two
       days, yours first (near your assets, in your theaters and interests),
       then the hardest events, then the newest — one per place, so three
       videos are three stories. Chosen once per part of the day. */
    const groundPick = useMemo(() => {
        const HARD = { strike: 0, attack: 0, explosion: 0, clash: 1, interception: 1, unrest: 2 }
        const SEVR = { critical: 0, significant: 1, high: 1, elevated: 2, moderate: 2, low: 3 }
        const vids = tgPosts.filter((x) => x.media === "video" && Number.isFinite(+x.lat))
            .map((x) => ({ ...x, location_country: iso2Name.get(String(x.country_code || "").toLowerCase()) || x.location_country }))
        const mine = new Set(partition(vids, w).mine.map((m) => m.id))
        const ranked = vids.sort((a, b) => (mine.has(b.id) - mine.has(a.id))
            || ((a.graphic ? 1 : 0) - (b.graphic ? 1 : 0))
            || ((SEVR[a.severity_tier] ?? 4) - (SEVR[b.severity_tier] ?? 4))
            || ((HARD[a.event_type] ?? 3) - (HARD[b.event_type] ?? 3))
            || String(b.posted_at || "").localeCompare(String(a.posted_at || "")))
        // one per place: a story within 30 km of one already chosen is the
        // same place told twice ("Obolon, Kyiv" and "Kyiv, Ukraine")
        const kmTo = (a, b) => {
            const r = Math.PI / 180
            const h = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lon - a.lon) * r / 2) ** 2
            return 12742 * Math.asin(Math.sqrt(h))
        }
        const out = []
        for (const v of ranked) {
            const at = { lat: +v.lat, lon: +v.lon }
            if (out.some((o) => kmTo(at, { lat: +o.lat, lon: +o.lon }) < 30)) continue
            out.push({ ...v, _mine: mine.has(v.id) })
            if (out.length === 3) break
        }
        return out
    }, [tgPosts, w, iso2Name])
    const knowsYou = myAssets !== null && countryPlaces.length > 0
    const groundVideos = useFrozen(`ground:${slot.key}`, groundPick, (a) => knowsYou && a.length > 0 && a.length >= Math.min(3, groundPick.length))

    /* Overnight — our own surface, newest first. Deliberately NOT sorted on
       relevance_score: that field is a lookup on severity_tier (main.py
       ~8635), so ranking by it would just restate the dot colour. */
    const overnightNow = useMemo(() => {
        const rank = { critical: 0, high: 1, moderate: 2, low: 3 }
        const seen = new Set()
        const unique = surface.filter((s) => {
            const k = (s.title || s.headline || "").trim().toLowerCase()
            if (!k || seen.has(k)) return false
            seen.add(k); return true
        })
        // Yours first, then severity, then newest.
        const mineIds = new Set(split.mine.map((m) => m.id ?? m.headline))
        return [...unique]
            .sort((a, b) => (mineIds.has(b.id ?? b.headline) - mineIds.has(a.id ?? a.headline))
                || (rank[a.severity_tier] ?? 9) - (rank[b.severity_tier] ?? 9)
                || String(b.published_at || "").localeCompare(String(a.published_at || "")))
            .filter((x) => !slot.since || !x.published_at || Date.parse(x.published_at) >= slot.since - 6 * 3600_000)
            .slice(0, 4)
    }, [surface, split, slot])
    const overnight = useFrozen(`happened:${slot.key}`, overnightNow, (a) => knowsYou && a.length > 0 && a.length >= Math.min(4, overnightNow.length))

    /* Top scenario per board, with its own base rate kept alongside.
       A FORECAST WITHOUT ITS BASE RATE IS NOT A FORECAST. The model's
       target is "escalation against this country's own recent rate", so
       0.501 against a base of 0.5185 is a forecast of slightly LESS than
       usual — printing "50%" on its own would read as a coin flip on
       whether violence happens at all, which is not what it says. */
    const ahead = useMemo(() => detail.map((d) => {
        const sc = safeArray(d?.scenarios)[0]
        if (!sc) return null
        return {
            label: sc.label || d.question, p: sc.p, base: sc.base,
            window: sc.window || d.horizon, asOf: d.as_of_month,
        }
    }).filter(Boolean), [detail])

    /* ── THE DAY'S OUTLOOK ────────────────────────────────────────────
       The block above this used to be the whole of "Today may bring":
       category-level probabilities against their own base rates —
       "Escalation in non-state conflict, 90%, above its base rate of
       33%". True, and unusable. It names no actor, no place and no
       object, it is scoped to a quarter, and nothing in it can ever be
       shown to have been wrong.

       What replaces it is one sentence per thing, each naming who may
       act and where, each resting on signals from this console that it
       has to quote, and each carrying a criterion and a date so it can
       later be marked. The base rates are still computed and still
       available in Insight — they are context, not a forecast. */
    const [outlook, setOutlook] = useState(null)
    useEffect(() => {
        let live = true
        const load = (first) => fetch(`${API_BASE}/api/enrich/outlook`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (live && d) setOutlook(d) })
            .catch(() => { if (live && first) setOutlook({ ok: false }) })
        load(true)
        // The backend rebuilds the outlook every 20 minutes; read it as often.
        const t = setInterval(() => load(false), 20 * 60_000)
        return () => { live = false; clearInterval(t) }
    }, [])

    /* WHAT IS AHEAD, YOURS FIRST. A forecast or an announcement that names
       one of your countries leads; the rest follow. Held for the part of
       the day like the rest of the brief. */
    const outlookMine = useMemo(() => {
        const items = safeArray(outlook?.outlook)
        const names = [...(w?.countries?.keys?.() || [])].map((c) => String(c).toLowerCase())
        const isMine = (o) => names.some((c) => `${o.place || ""} ${o.statement || ""}`.toLowerCase().includes(c))
        return [...items].sort((a, b) => isMine(b) - isMine(a))
    }, [outlook, w])
    const outlookHeld = useFrozen(`ahead:${slot.key}`, outlookMine, (a) => knowsYou && a.length > 0)

    /* ANNOUNCED. Gatherings and actions announced on Telegram for the next
       week (telegram_ingest.upcoming) — a demonstration called for tomorrow
       at République is something today may bring, by the organisers' own
       word rather than by a model's probability, so it carries no percent. */
    const announced = useMemo(() => {
        const until = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)
        const list = surface.filter((x) => x.source_type === "telegram_announcement" && x.starts_at && x.starts_at.slice(0, 10) <= until)
        const mine = new Set(partition(list, w).mine.map((m) => m.id))
        return list
            .sort((a, b) => (mine.has(b.id) - mine.has(a.id)) || String(a.starts_at).localeCompare(String(b.starts_at)))
            .slice(0, 4)
    }, [surface, w])

    const critical = surface.filter((s) => s.severity_tier === "critical").length
    const stats = [
        [String(critical), "Critical signals", "var(--red)"],
        [String(surface.length), "Signals on the surface", "var(--txt)"],
        [String(boards.length), "Forecast boards", "var(--txt)"],
        [onto ? String((onto.nodes || []).length) : "—", "Entities linked", "var(--txt)"],
    ]

    /* The lead names the signal that leads the list and where the rest
       are; homeLead.js says how, and keeps the all-critical guard. */
    const lead = useMemo(() => (split.hasInterests ? forYouLead(split.mine, split.elsewhere) : leadSentence(surface)),
        [split, surface])

    /* The minimap in Suggested: the leading signal as the subject, every
       other located signal as context, at world span. Measured, because the
       shared Minimap stretches to its box unless it is told the width. */
    const mapBox = useRef(null)
    const [mapW, setMapW] = useState(340)
    useEffect(() => {
        const el = mapBox.current
        if (!el || typeof ResizeObserver === "undefined") return undefined
        const ro = new ResizeObserver(([e]) => setMapW(Math.round(e.contentRect.width) || 340))
        ro.observe(el)
        return () => ro.disconnect()
    }, [])
    const located = useMemo(() => surface.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon)), [surface])
    const subject = useMemo(() => leading(located)[0] || null, [located])
    const mapContext = useMemo(() => located.filter((s) => s !== subject).map((s, i) => ({
        id: s.id ?? i, lat: s.lat, lon: s.lon, severity: s.severity_tier,
        ts: Date.parse(s.published_at || "") || undefined, title: s.headline || s.title,
    })), [located, subject])

    const columns = [
        {
            k: slot.happened, score: "",
            items: overnight.map((s) => ({
                c: SEV_DOT[s.severity_tier] || "var(--txt4)",
                t: s.title || s.headline || "Untitled signal",
                sub: [s.source || s.source_type, whenLabel(s.published_at)].filter(Boolean).join(" · "),
                go: () => onOpenModule("inbox"),
            })),
        },
        {
            k: slot.ahead,
            score: outlookHeld.length
                ? `${outlookHeld.length} from ${outlook?.count ?? "—"} signals`
                : (outlook && outlook.ok === false ? "unavailable" : ""),
            items: [...announced.map((a) => ({
                c: "var(--amber)",
                t: `${a.what ? a.what[0].toUpperCase() + a.what.slice(1) : "Gathering"} · ${String(a.place || "").split(",").slice(0, 2).join(",")}`,
                sub: [a.when_label, a.cause, `announced on ${a.channel_title || a.channel}`].filter(Boolean).join(" · "),
                go: () => {
                    onOpenModule("map")
                    window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: a.lat, lon: a.lon, altitude: 30000 } }))
                    window.dispatchEvent(new CustomEvent("akili:open-inspector", { detail: { entityType: "telegram", entityId: a.id, data: a } }))
                },
            })), ...(outlookHeld.length
                ? outlookHeld.map((o) => ({
                    p: o.probability,
                    // Who and where, in front, because that is what makes it
                    // a forecast rather than a category.
                    t: [o.place, o.statement].filter(Boolean).join(" · "),
                    sub: [o.because, o.resolves_by ? `by ${o.resolves_by}` : null]
                        .filter(Boolean).join(" · "),
                    go: () => onOpenModule("forecast"),
                }))
                // Only if the outlook could not be produced. Showing the
                // base rates as a fallback is honest; showing them as the
                // answer was the defect.
                : ahead.map((b) => {
                    const p = Math.round((b.p ?? 0) * 100)
                    const base = Math.round((b.base ?? 0) * 100)
                    const dir = p > base ? "above" : p < base ? "below" : "level with"
                    return {
                        p, t: b.label,
                        sub: `${b.window} · ${dir} its own base rate of ${base}% · category rate, not a forecast`,
                        go: () => onOpenModule("forecast"),
                    }
                }))],
        },
        {
            k: slot.record,
            // The honest score. Nothing in the backend resolves a forecast
            // yet — `record: {n: 0}` on every board — so this reports that
            // rather than drawing marks it cannot defend.
            // The model keeps its own scorecard and is blunt about it;
            // quoting it is better than paraphrasing it.
            score: record ? (record.n ? `${record.n} resolved` : "none resolved") : "",
            items: [{
                r: record?.n ? "hit" : "open",
                t: record?.n
                    ? `Brier ${record.brier} over ${record.n} resolved forecasts`
                    : "Nothing has resolved yet",
                sub: record?.calibration
                    || "This model has no record yet.",
                go: () => onOpenModule("forecast"),
            }],
        },
    ]

    const changes = overnight.map((s) => ({
        t: (s.published_at || "").slice(11, 16) || "—",
        c: SEV_DOT[s.severity_tier] || "var(--txt4)",
        title: s.title || s.headline || "Signal",
        why: s.summary || s.why || s.source || "",
        mode: "Inbox", icon: "#g-inbox", go: () => onOpenModule("inbox"),
    }))

    const modes = [
        ["map", 5, `${surface.length}`, "signals on the surface"],
        ["analytics", 4, `${boards.length}`, "forecast boards ready"],
        ["inbox", 4, `${critical}`, "critical, unread"],
        /* `links`, not `edges`. The graph endpoint has always returned
           {nodes, links}; this read a key it never sends, so Constellation
           reported 160 entities and 0 links while 272 sat in the payload.
           `edges` is kept as a fallback in case another producer uses it. */
        ["graph", 3, onto ? `${safeArray(onto.links ?? onto.edges).length}` : "—", "links in the graph"],
        ["briefings", 3, "—", "briefs, decks and documents"],
        ["imagery", 3, "—", "passes and detections"],
        ["assets", 2, "—", "nothing registered yet"],
        ["fusion", 3, "—", "clusters under the rule"],
        ["work", 2, "—", "assigned to you"],
    ]

    /* Counted from the surface, per theater's own countries. These were
       three hardcoded sentences, one claiming a Hormuz transit baseline
       nothing in the system can measure. */
    const LEVEL_DOT = { critical: "var(--red)", active: "var(--steel)", quiet: "var(--txt4)" }
    // The user's own theaters, each scoped to the countries its view frames;
    // the seeded scopes only until the real rows have loaded.
    const theaters = useMemo(() => {
        const scopes = userTheaters.length && countryPlaces.length
            ? Object.fromEntries(userTheaters.map((t) => [t.id, { label: t.name, countries: countriesInView(t.view, countryPlaces) }])
                .filter(([, v]) => v.countries.length))
            : THEATER_SCOPE
        return theaterLines(surface, scopes).map((t) => [t.name, t.level, LEVEL_DOT[t.level], t.line])
    }, [surface, userTheaters, countryPlaces])

    const ontoTypes = useMemo(() => {
        const nodes = safeArray(onto?.nodes)
        const by = {}
        nodes.forEach((n) => { const k = n.type || n.kind || "entity"; by[k] = (by[k] || 0) + 1 })
        const rows = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 7)
        const mx = Math.max(1, ...rows.map((r) => r[1]))
        return rows.map(([name, n]) => ({ name, n, w: Math.round((n / mx) * 100) + "%" }))
    }, [onto])

    return (
        <section data-screen-label="Home" style={MODE_SURFACE}>
            <div data-tour-scroll="1" style={MODE_BODY}>
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

                    {/* ── header ───────────────────────────────────────── */}
                    <header style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                        <Avatar size={48} />
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 280px", minWidth: 0 }}>
                            <h1 style={{
                                margin: 0, fontWeight: 600, fontSize: 28, lineHeight: 1.15,
                                letterSpacing: "-.01em", textWrap: "balance",
                            }}>{greeting}</h1>
                            <span style={{ fontSize: 13, color: "var(--txt3)" }}>{sinceMeta}</span>
                        </div>
                        <button onClick={onOpenSearch} style={{
                            display: "flex", alignItems: "center", gap: 10, height: 30,
                            padding: "0 6px 0 10px", border: "1px solid var(--gline2)",
                            background: "var(--glass2)", color: "var(--txt3)", font: "inherit",
                            cursor: "pointer", borderRadius: 0, whiteSpace: "nowrap",
                        }}>
                            Search
                            <span style={{
                                fontFamily: "var(--mz-font-mono)", fontSize: 10, padding: "1px 5px",
                                border: "1px solid var(--gline2)", borderRadius: 0,
                            }}>⌘K</span>
                        </button>
                    </header>

                    {/* ── Most urgent for you ───────────────────────────── */}
                    <div data-screen-label="Most urgent" style={{
                        border: "1px solid var(--gline)", background: "var(--glass2)", padding: "14px 18px",
                    }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
                            <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--txt4)" }}>Most urgent for you</span>
                            <span style={{ fontSize: 11.5, color: "var(--txt4)" }}>your theaters and assets · live, every 30 s</span>
                        </div>
                        {!hasOwn ? (
                            <div style={{ fontSize: 13.5, color: "var(--txt2)", lineHeight: 1.5 }}>
                                Nothing is yours yet. Create a theater (the + in the strip above) or register an asset under Assets,
                                and the signals that concern them appear here first.
                            </div>
                        ) : urgent.length === 0 ? (
                            <div style={{ fontSize: 13.5, color: "var(--txt3)" }}>Nothing urgent in your theaters or near your assets right now.</div>
                        ) : (
                            <div style={{ display: "flex", flexDirection: "column" }}>
                                {urgent.map((u) => (
                                    <button key={u.key} onClick={() => openUrgent(u)} style={{
                                        display: "grid", gridTemplateColumns: "10px 1fr auto", gap: 10, alignItems: "baseline", textAlign: "left",
                                        padding: "8px 0", border: 0, borderTop: "1px solid var(--gline)", background: "transparent",
                                        color: "var(--txt)", font: "inherit", cursor: "pointer", minWidth: 0,
                                    }}>
                                        <span style={{ width: 8, height: 8, borderRadius: 4, alignSelf: "center",
                                            background: u.sev === "critical" ? "var(--red)" : (u.sev === "high" || u.sev === "elevated") ? "var(--amber)" : "var(--txt4)" }} />
                                        <span style={{ minWidth: 0 }}>
                                            <span style={{ fontSize: 14, fontWeight: 550, display: "block", overflowWrap: "anywhere" }}>{u.title}</span>
                                            {u.why && <span style={{ fontSize: 12, color: "var(--txt3)", display: "block", overflowWrap: "anywhere" }}>{u.why}</span>}
                                        </span>
                                        <span style={{ fontSize: 11.5, color: "var(--txt4)", whiteSpace: "nowrap" }}>{u.when ? whenLabel(u.when) : ""}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* ── From the ground: three stories on video ─────────── */}
                    {groundVideos.length > 0 && (
                        <div data-screen-label="From the ground" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                                <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--txt4)" }}>From the ground</span>
                                <span style={{ fontSize: 11.5, color: "var(--txt4)" }}>the {groundVideos.length === 1 ? "most breaking story" : `${groundVideos.length} most breaking stories`} {split.hasInterests ? "for you" : "worldwide"} · renewed {slot.part === "night" ? "tonight" : `this ${slot.part}`}</span>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))", gap: 12 }}>
                                {groundVideos.map((v) => (
                                    <div key={v.id} style={{ display: "flex", flexDirection: "column", border: "1px solid var(--gline)", background: "var(--glass2)", minWidth: 0 }}>
                                        <TelegramMedia post={v} maxHeight="260px" radius="0" />
                                        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 12px 12px", minWidth: 0 }}>
                                            <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase",
                                                           color: v.severity_tier === "critical" ? "var(--red)" : "var(--txt3)" }}>
                                                {whenLabel(v.posted_at || v.published_at)} · <bdi>{v.channel_title || v.source || v.channel}</bdi>{v._mine ? " · yours" : ""}
                                            </span>
                                            <span style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.3, overflowWrap: "anywhere" }}>{v.headline}</span>
                                            <span style={{ fontSize: 12, color: "var(--txt3)", overflowWrap: "anywhere" }}>{String(v.place || v.geocoded_as || "").split(",").slice(0, 2).join(",")}</span>
                                            <button onClick={() => {
                                                onOpenModule("map")
                                                window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: v.lat, lon: v.lon, altitude: 60000 } }))
                                                window.dispatchEvent(new CustomEvent("akili:open-inspector", { detail: { entityType: "telegram", entityId: v.id, data: v } }))
                                            }} style={{ alignSelf: "flex-start", height: 28, padding: "0 12px", border: 0, background: "var(--acc)", color: "var(--mz-cream)",
                                                        font: "inherit", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Show on the map</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* ── Daily brief + Suggested ───────────────────────── */}
                    <div style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,380px),1fr))",
                        gap: 16, alignItems: "stretch",
                    }}>
                        <div data-tour="brief" data-screen-label="Daily brief" style={{
                            display: "flex", flexDirection: "column", gap: 16, padding: 20,
                            border: "1px solid var(--gline)", background: "var(--glass2)",
                            minWidth: 0,
                            /* ALL TRACKS BUT ONE, so the Suggested card
                               stands beside the brief instead of alone on
                               a row with three empty columns next to it.
                               Part B spans the brief 1/-1, but the same
                               markup gives Suggested `margin-top:auto` on
                               its button row inside a grid set to
                               `align-items: stretch` — both of which only
                               do anything when it has a tall sibling. At
                               1/-1 it never has one, and the row reads as
                               a layout fault. */
                            gridColumn: "1 / -2",
                        }}>
                            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--txt2)" }}>{kicker}</span>
                                <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, color: "var(--txt4)" }}>
                                    {clock} · Parallax watch
                                </span>
                            </div>
                            <p style={{
                                margin: 0, fontSize: 19, lineHeight: 1.45, color: "var(--txt)",
                                textWrap: "pretty", maxWidth: "68ch",
                            }}>{lead}</p>
                            {/* What the lead is relative to, and where to change it. */}
                            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", fontSize: 12, color: "var(--txt3)", marginTop: -6 }}>
                                <span>{split.hasInterests
                                    ? `Watching ${[...new Set([...userTheaters.map((t) => t.name), ...(interests?.regions || []), ...(interests?.countries || [])])].slice(0, 5).join(", ")}${(interests?.topics || []).length ? ` · topics: ${interests.topics.join(", ")}` : ""}`
                                    : "Tell Parallax what you watch, and this leads with your areas instead of everything."}</span>
                                <button onClick={() => { window.__plxSettingsSection = "interests"; window.dispatchEvent(new CustomEvent("akili:open-settings")) }}
                                        style={{ border: 0, background: "none", padding: 0, color: "var(--acchi)", cursor: "pointer", font: "inherit" }}>
                                    {split.hasInterests ? "Change" : "Choose what you watch →"}
                                </button>
                            </div>

                            <div style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,260px),1fr))",
                                gap: 0, borderTop: "1px solid var(--gline)",
                            }}>
                                {columns.map((col, ci) => (
                                    <div key={col.k} style={{
                                        display: "flex", flexDirection: "column", minWidth: 0,
                                        padding: "14px 16px 4px 0",
                                        /* A rule BETWEEN columns, not after
                                           the last one — a divider with
                                           nothing on its far side reads as
                                           a column that failed to load. */
                                        marginRight: ci === columns.length - 1 ? 0 : 16,
                                        borderRight: ci === columns.length - 1
                                            ? "none" : "1px solid var(--gline)",
                                    }}>
                                        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
                                            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--txt2)" }}>{col.k}</span>
                                            <span style={{
                                                marginLeft: "auto", fontFamily: "var(--mz-font-mono)",
                                                fontSize: 11, color: "var(--acchi)",
                                            }}>{col.score}</span>
                                        </div>
                                        {col.items.length === 0 && (
                                            <span style={{ fontSize: 12, color: "var(--txt4)", padding: "8px 0" }}>
                                                Nothing here yet.
                                            </span>
                                        )}
                                        {col.items.map((it, i) => {
                                            const r = it.r && RES[it.r]
                                            const mc = r ? r[1]
                                                : it.p != null ? (it.p >= 50 ? "var(--red)" : it.p >= 35 ? "var(--amber)" : "var(--txt3)")
                                                : it.c
                                            const mark = r ? r[0] : it.p != null ? `${it.p}%` : ""
                                            return (
                                                <button key={i} onClick={it.go} style={{
                                                    ...rowBtn, display: "grid",
                                                    gridTemplateColumns: "34px minmax(0,1fr)",
                                                    gap: "1px 10px", alignItems: "start", padding: "8px 0",
                                                    borderBottom: "1px solid var(--gline)",
                                                }}>
                                                    <span style={{
                                                        gridRow: "span 2", display: "flex", alignItems: "center",
                                                        justifyContent: "center", height: 20,
                                                        fontFamily: "var(--mz-font-mono)", fontSize: 11, color: mc,
                                                    }}>
                                                        {!r && it.p == null
                                                            ? <i style={{ width: 8, height: 8, background: mc }} />
                                                            : mark}
                                                    </span>
                                                    <span style={{ fontSize: 14, lineHeight: 1.35, textWrap: "pretty" }}>{it.t}</span>
                                                    <span style={{ fontSize: 12, color: "var(--txt3)" }}><Dots text={it.sub} /></span>
                                                </button>
                                            )
                                        })}
                                    </div>
                                ))}
                            </div>

                            <div style={{ display: "flex", flexWrap: "wrap", gap: "18px 28px" }}>
                                {stats.map(([v, k, c]) => (
                                    <div key={k} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                        <span style={{
                                            fontFamily: "var(--mz-font-mono)", fontSize: 22,
                                            fontWeight: 500, color: c,
                                        }}>{v}</span>
                                        <span style={{ fontSize: 11, color: "var(--txt3)" }}>{k}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Suggested — the one card with an accent border, because
                            it is the only one making a recommendation. */}
                        <div style={{
                            display: "flex", flexDirection: "column", gap: 12, padding: 18,
                            border: "1px solid var(--acchi)", borderRadius: 0, minWidth: 0,
                        }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--acchi)" }}>Suggested</span>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                <span style={{
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    width: 36, height: 36, flex: "none",
                                    border: "1px solid var(--gline2)", color: "var(--acchi)",
                                }}><Icon href="#g-globe" size={18} /></span>
                                <b style={{ fontWeight: 600, fontSize: 18 }}>Map</b>
                                <span style={{
                                    marginLeft: "auto", fontFamily: "var(--mz-font-mono)",
                                    fontSize: 12, color: "var(--red)",
                                }}>{critical} critical</span>
                            </div>
                            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--txt2)", textWrap: "pretty" }}>
                                {criticalWhere(surface)}
                            </p>
                            <div ref={mapBox} role="button" tabIndex={0} title="Open the map"
                                onClick={() => onOpenModule("map")}
                                onKeyDown={(e) => { if (e.key === "Enter") onOpenModule("map") }}
                                style={{ cursor: "pointer", minWidth: 0 }}>
                                <Minimap
                                    focus={subject ? { lat: subject.lat, lon: subject.lon } : null}
                                    context={mapContext}
                                    span={170}
                                    width={mapW}
                                    height={230}
                                    label={subject ? String(placeOf(subject) || "").split(",")[0].slice(0, 22) : ""}
                                    title="Today's signals"
                                    subtitle={`${located.length} located`}
                                />
                            </div>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: "auto" }}>
                                <button onClick={() => onOpenModule("map")} style={{
                                    height: 32, padding: "0 14px", border: 0, background: "var(--acc)",
                                    color: "var(--mz-cream)", font: "inherit", fontWeight: 600,
                                    cursor: "pointer", borderRadius: 0,
                                }}>Open Map</button>
                                <button onClick={() => onOpenModule("analytics")} style={{
                                    height: 32, padding: "0 12px", border: "1px solid var(--gline2)",
                                    background: "transparent", color: "var(--txt)", font: "inherit",
                                    cursor: "pointer", borderRadius: 0,
                                }}>See the forecast</button>
                            </div>
                        </div>
                    </div>

                    {/* ── What changed + Modes ──────────────────────────── */}
                    <div style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,380px),1fr))",
                        gap: 16, alignItems: "start",
                    }}>
                        <Card>
                            <CardHead title="What changed" meta={String(changes.length)} />
                            {changes.map((ch, i) => (
                                <button key={i} onClick={ch.go} style={{
                                    ...rowBtn, display: "grid",
                                    gridTemplateColumns: "52px 8px minmax(0,1fr) auto",
                                    gap: "3px 10px", alignItems: "center", padding: "10px 14px",
                                    borderBottom: "1px solid var(--gline)",
                                }}>
                                    <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, color: "var(--txt4)" }}>{ch.t}</span>
                                    <i style={{ width: 8, height: 8, borderRadius: 0, background: ch.c }} />
                                    <span style={{
                                        fontSize: 13, fontWeight: 600, overflow: "hidden",
                                        textOverflow: "ellipsis", whiteSpace: "nowrap",
                                    }}>{ch.title}</span>
                                    <span style={{
                                        display: "flex", alignItems: "center", gap: 5, height: 20,
                                        padding: "0 7px", border: "1px solid var(--gline2)",
                                        fontSize: 11, color: "var(--txt2)", whiteSpace: "nowrap",
                                    }}><Icon href={ch.icon} size={11} />{ch.mode}</span>
                                    <span /><span />
                                    <span style={{
                                        gridColumn: "3 / 5", fontSize: 12, color: "var(--txt3)",
                                        textWrap: "pretty", overflow: "hidden",
                                        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                                    }}>{ch.why}</span>
                                </button>
                            ))}
                            {changes.length === 0 && (
                                <div style={{ padding: 14, fontSize: 12, color: "var(--txt3)" }}>
                                    Nothing has changed since you were last here.
                                </div>
                            )}
                        </Card>

                        <Card>
                            <CardHead title="Modes" meta="Sorted by relevance" />
                            {modes.map(([k, sc, delta, changed], i) => (
                                <button key={k} onClick={() => onOpenModule(k)} style={{
                                    ...rowBtn, display: "grid",
                                    gridTemplateColumns: "18px 22px 110px minmax(0,1fr) 40px 44px",
                                    gap: 10, alignItems: "center", padding: "9px 14px",
                                    borderBottom: "1px solid var(--gline)", opacity: sc <= 1 ? 0.6 : 1,
                                }}>
                                    <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, color: "var(--txt4)" }}>
                                        {String(i + 1).padStart(2, "0")}
                                    </span>
                                    <Icon href={MODE_ICON[k]} size={16} color="var(--txt2)" />
                                    <span style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
                                        <b style={{ fontWeight: 600, fontSize: 13, whiteSpace: "nowrap" }}>{MODE_NAME[k]}</b>
                                        <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, color: "var(--txt4)" }}>
                                            {MODE_KBD[k] || ""}
                                        </span>
                                    </span>
                                    <span title={changed} style={{
                                        fontSize: 12, color: "var(--txt3)", overflow: "hidden",
                                        textOverflow: "ellipsis", whiteSpace: "nowrap",
                                    }}>{changed}</span>
                                    <span style={{
                                        fontFamily: "var(--mz-font-mono)", fontSize: 11, textAlign: "right",
                                        color: sc >= 5 ? "var(--red)" : sc >= 4 ? "var(--amber)" : "var(--txt3)",
                                    }}>{delta}</span>
                                    <span title={`Relevance ${sc}/5`} style={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
                                        {[1, 2, 3, 4, 5].map((n) => (
                                            <i key={n} style={{
                                                width: 6, height: 10,
                                                background: n <= sc ? "var(--acchi)" : "var(--gline2)",
                                            }} />
                                        ))}
                                    </span>
                                </button>
                            ))}
                        </Card>
                    </div>

                    {/* ── theaters · assets · Constellation · Recent ────── */}
                    <div style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,300px),1fr))",
                        gap: 16, alignItems: "start",
                    }}>
                        <Card tour="theaters">
                            <CardHead title="Your theaters" meta="3">
                                <button onClick={() => onOpenModule("map")} style={{
                                    marginLeft: "auto", height: 26, padding: "0 8px", border: 0,
                                    background: "transparent", color: "var(--acchi)", font: "inherit",
                                    fontSize: 12, cursor: "pointer",
                                }}>+ Add theater</button>
                            </CardHead>
                            {theaters.map(([name, level, dot, lead2]) => (
                                <div key={name} style={{
                                    display: "grid", gridTemplateColumns: "minmax(0,1fr) 40px",
                                    borderBottom: "1px solid var(--gline)",
                                }}>
                                    <button onClick={() => onOpenModule("map")} style={{
                                        ...rowBtn, display: "grid",
                                        gridTemplateColumns: "8px minmax(0,1fr) auto",
                                        gap: "3px 10px", alignItems: "center",
                                        padding: "10px 6px 10px 14px", minWidth: 0,
                                    }}>
                                        <i style={{ width: 8, height: 8, background: dot }} />
                                        <b style={{
                                            fontWeight: 600, fontSize: 13, overflow: "hidden",
                                            textOverflow: "ellipsis", whiteSpace: "nowrap",
                                        }}>{name}</b>
                                        <span style={{
                                            fontFamily: "var(--mz-font-mono)", fontSize: 10,
                                            letterSpacing: ".1em", textTransform: "uppercase", color: dot,
                                        }}>{level}</span>
                                        <span />
                                        <span style={{ gridColumn: "2 / 4", fontSize: 12, color: "var(--txt3)", textWrap: "pretty" }}>{lead2}</span>
                                    </button>
                                    <button title="Theater settings" onClick={() => onOpenModule("map")} style={{
                                        display: "flex", alignItems: "center", justifyContent: "center",
                                        border: 0, borderLeft: "1px solid var(--gline)",
                                        background: "transparent", color: "var(--txt3)", cursor: "pointer",
                                    }}><Icon href="#g-tune" size={15} /></button>
                                </div>
                            ))}
                        </Card>

                        <Card tour="assets">
                            <CardHead title="Your assets" meta={myAssets ? String(myAssets.length) : "…"}>
                                <button onClick={() => { window.__plxAddAsset = true; onOpenModule("assets") }} style={{
                                    marginLeft: "auto", height: 26, padding: "0 8px", border: 0,
                                    background: "transparent", color: "var(--acchi)", font: "inherit",
                                    fontSize: 12, cursor: "pointer",
                                }}>+ Add asset</button>
                            </CardHead>
                            {myAssets?.length ? (
                                <div style={{ display: "flex", flexDirection: "column" }}>
                                    {[...myAssets].sort((x, y) => EXPO_RANK[y.exposure] - EXPO_RANK[x.exposure]).slice(0, 5).map((a) => (
                                        <button key={a.id} onClick={() => onOpenModule("assets")} style={{
                                            display: "grid", gridTemplateColumns: "10px minmax(0,1fr)", gap: 10, alignItems: "baseline",
                                            padding: "9px 14px", border: 0, borderTop: "1px solid var(--gline)", background: "transparent",
                                            color: "var(--txt)", font: "inherit", textAlign: "left", cursor: "pointer",
                                        }}>
                                            <i style={{ width: 8, height: 8, borderRadius: "50%", background: (EXPOSURE[a.exposure] || EXPOSURE.unknown).color, display: "inline-block" }} />
                                            <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                                                <span style={{ fontSize: 13 }}>{a.name} <span style={{ color: "var(--txt3)", fontSize: 12 }}>· {a.kind_label}</span></span>
                                                <span style={{ fontSize: 12, color: "var(--txt3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                    {a.top ? a.top.title : (EXPOSURE[a.exposure] || EXPOSURE.unknown).label}
                                                </span>
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div style={{ padding: 14, fontSize: 12, lineHeight: 1.5, color: "var(--txt3)", textWrap: "pretty" }}>
                                    {myAssets ? "Nothing registered yet. Add a vessel, an aircraft, a site or a team and Parallax will rank what happens near it and say how it affects you." : "Reading the register…"}
                                    {myAssets && (
                                        <div style={{ marginTop: 10 }}>
                                            <button onClick={() => { window.__plxAddAsset = true; onOpenModule("assets") }} style={{
                                                height: 28, padding: "0 12px", border: "1px solid var(--gline2)",
                                                background: "transparent", color: "var(--txt)", font: "inherit",
                                                cursor: "pointer", borderRadius: 4,
                                            }}>Add an asset →</button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </Card>

                        <Card>
                            <CardHead
                                title="Constellation"
                                meta={onto ? `${safeArray(onto.nodes).length} entities · ${safeArray(onto.links ?? onto.edges).length} links` : "—"}
                            />
                            {ontoTypes.map((ot) => (
                                <button key={ot.name} onClick={() => onOpenModule("graph")} style={{
                                    ...rowBtn, display: "grid",
                                    gridTemplateColumns: "16px 96px minmax(0,1fr) 28px",
                                    alignItems: "center", gap: 10, padding: "7px 14px",
                                }}>
                                    <Icon href="#g-onto" size={14} color="var(--txt3)" />
                                    <span style={{ fontSize: 12 }}>{ot.name}</span>
                                    <span style={{ height: 4, background: "var(--hov)", overflow: "hidden" }}>
                                        <i style={{ display: "block", height: "100%", width: ot.w, background: "var(--acchi)", opacity: 0.7 }} />
                                    </span>
                                    <span style={{
                                        fontFamily: "var(--mz-font-mono)", fontSize: 10,
                                        color: "var(--txt3)", textAlign: "right",
                                    }}>{ot.n}</span>
                                </button>
                            ))}
                            {ontoTypes.length === 0 && (
                                <div style={{ padding: 14, fontSize: 12, color: "var(--txt3)" }}>
                                    The graph has not reported yet.
                                </div>
                            )}
                            <button onClick={() => onOpenModule("graph")} style={{
                                ...rowBtn, display: "flex", alignItems: "center", height: 34,
                                padding: "0 14px", borderTop: "1px solid var(--gline)",
                                color: "var(--acchi)", fontSize: 12,
                            }}>Open in Constellation</button>
                        </Card>

                        <Card>
                            <CardHead title="Recent" meta={null} />
                            {[["map", "Situation", "Map"], ["analytics", "Forecast", "Insight"],
                              ["briefings", "Reports", "Briefing studio"], ["graph", "Ontology", "Constellation"]]
                                .map(([k, name, kind]) => (
                                <button key={k} onClick={() => onOpenModule(k)} style={{
                                    ...rowBtn, display: "grid",
                                    gridTemplateColumns: "16px minmax(0,1fr) auto",
                                    gap: 10, alignItems: "center", padding: "7px 14px",
                                }}>
                                    <Icon href={MODE_ICON[k]} size={13} color="var(--txt3)" />
                                    <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                                        <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                                        <span style={{ fontSize: 11, color: "var(--txt4)" }}>{kind}</span>
                                    </span>
                                    <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, color: "var(--txt4)" }}>{clock}</span>
                                </button>
                            ))}
                        </Card>
                    </div>
                </div>
            </div>
        </section>
    )
}
