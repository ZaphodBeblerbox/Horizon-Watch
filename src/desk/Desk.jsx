/**
 * Desk.jsx — what the desk has seen.
 *
 * Observations published to everyone, newest first, narrowed by theater
 * and by urgency. NOT a follower feed: in a team that works the same
 * handful of theaters everybody would follow everybody, so the graph
 * filters nothing and adds a step. The two filters that do narrow a watch
 * usefully are already the two fields every signal in this product
 * carries.
 *
 * A post can carry the signal it is about, so "tanker went dark" comes
 * with the thing itself and the map can fly to it — otherwise the feed is
 * a second place to write down what is already in the case tree, which is
 * the failure mode of every internal feed ever built.
 *
 * One level of replies. The useful thing about an observation is the
 * second person saying "I have the ADS-B for that window"; the fourth
 * nested reply is a conversation, and there is a chat for that.
 */
import GeneralFeed from "../general/GeneralFeed.jsx"
import { attachmentFor } from "../mobile/screens/common.jsx"
import { useCallback, useEffect, useRef, useState } from "react"
import {
    listPosts, createPost, deletePost, toggleAck, whoAcked, listReplies,
    postedTheaters, uploadDeskFile, deskFileUrl,
} from "../lib/deskApi.js"
import { getCurrentUser } from "../state/authStore.js"
import { getActiveTheater, URGENCY } from "../state/filing.js"
import PersonCard, { Face } from "../chat/PersonCard.jsx"
import { toast } from "../ui/toast.js"
import { chatPeople } from "../lib/chatApi.js"
import Loading from "../ui/Loading.jsx"
import { MODE_SURFACE } from "../plx6/modeWindow.js"
import { fmtWhen } from "../utils/formatTime.js"
import { Attachment, SignalPicker as SignalPicker2, BriefingPicker, TelegramPicker, AssetPicker, PlacePick } from "./deskAttachments.jsx"

const EYE = {
    font: "500 10px var(--mono)", letterSpacing: ".14em",
    textTransform: "uppercase", color: "var(--txt-3)",
}
const BTN = {
    height: 26, padding: "0 10px", border: "1px solid var(--gline2)",
    background: "transparent", color: "var(--txt-2)",
    font: "400 11.5px var(--font)", cursor: "pointer", borderRadius: 0,
}
const PRIMARY = {
    ...BTN, border: "1px solid var(--acc-line)", background: "var(--acc-dim)",
    color: "var(--txt)", fontWeight: 600,
}
const SEV = {
    critical: "var(--red)", significant: "var(--amber)",
    high: "var(--amber)", elevated: "var(--acc-hi)", routine: "var(--steel)",
}

function when(iso) {
    if (!iso) return ""
    const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`)
    if (Number.isNaN(+d)) return ""
    const s = Math.max(0, (Date.now() - d) / 1000)
    if (s < 60) return "just now"
    if (s < 3600) return `${Math.round(s / 60)}m`
    if (s < 86400) return `${Math.round(s / 3600)}h`
    if (s < 604800) return `${Math.round(s / 86400)}d`
    return fmtWhen(d, { precision: "day" })
}

function Chip({ on, children, onClick, tint, count }) {
    return (
        <button type="button" onClick={onClick} style={{
            display: "inline-flex", alignItems: "center", gap: 5, height: 22,
            padding: "0 8px", cursor: "pointer", borderRadius: 0, whiteSpace: "nowrap",
            border: `1px solid ${on ? "var(--acc-line)" : "var(--gline)"}`,
            background: on ? "var(--acc-dim)" : "transparent",
            color: on ? "var(--txt)" : "var(--txt-3)", font: "400 11px var(--font)",
        }}>
            {tint && <i style={{ width: 6, height: 6, background: tint, flexShrink: 0 }} />}
            {children}
            {count != null && <span style={{ font: "400 9.5px var(--mono)", color: "var(--txt-3)" }}>{count}</span>}
        </button>
    )
}

export default function Desk() {
    const me = getCurrentUser()
    const [posts, setPosts] = useState(null)
    const [theaters, setTheaters] = useState([])
    const [theater, setTheater] = useState(null)
    const [urg, setUrg] = useState(() => new Set())
    const [card, setCard] = useState(null)
    const [busy, setBusy] = useState(null)

    const load = useCallback(async () => {
        try {
            const d = await listPosts({ theater, urgency: [...urg] })
            setPosts(d.posts || [])
        } catch (e) {
            setPosts([])
            toast(e.message || "Could not load the desk", { icon: "i-alert" })
        }
    }, [theater, urg])

    useEffect(() => { load() }, [load])

    /* The theater chips are refreshed when the NUMBER of posts changes, not
       whenever `posts` does. The poll replaces the array every thirty
       seconds whether or not anything arrived, and a dependency on the
       array's identity therefore fetched the chip counts forever on a
       quiet desk. */
    const postCount = posts?.length ?? -1
    useEffect(() => {
        postedTheaters().then(setTheaters).catch(() => setTheaters([]))
    }, [postCount])

    // A desk is read while other people are writing to it. Slower than the
    // chat's poll because nobody expects a feed to be live to the second,
    // and it stops dead when the tab is hidden.
    useEffect(() => {
        const t = setInterval(() => { if (!document.hidden) load() }, 30000)
        return () => clearInterval(t)
    }, [load])

    const publish = async (body) => {
        const p = await createPost(body)
        setPosts((cur) => [p, ...(cur || [])])
    }

    const ack = async (p) => {
        setBusy(p.id)
        try {
            const next = await toggleAck(p.id)
            setPosts((cur) => (cur || []).map((x) => (x.id === p.id ? { ...x, ...next } : x)))
        } catch (e) { toast(e.message || "That did not work", { icon: "i-alert" }) }
        finally { setBusy(null) }
    }

    const remove = async (p) => {
        if (!confirm("Delete this post? Everyone who has read it will see that it was deleted.")) return
        try {
            const next = await deletePost(p.id)
            setPosts((cur) => (cur || []).map((x) => (x.id === p.id ? { ...x, ...next } : x)))
        } catch (e) { toast(e.message || "Could not delete it", { icon: "i-alert" }) }
    }

    const toggleUrg = (u) => setUrg((p) => {
        const n = new Set(p); n.has(u) ? n.delete(u) : n.add(u); return n
    })

    // "Share to the desk" from the reader, the inspector or an asset's page:
    // the desk opens with the thing already in the composer.
    const [prefill, setPrefill] = useState(() => window.__plxDeskShare || null)
    useEffect(() => {
        const h = (e) => { setPrefill(e.detail || null) }
        window.addEventListener("akili:share-to-desk", h)
        return () => window.removeEventListener("akili:share-to-desk", h)
    }, [])

    // TEAM OR GENERAL (owner, 2026-10-10): the team's posts, or what is
    // generally happening — signals, verified events, Telegram — as a timeline.
    const [view, setView] = useState(() => (window.__plxDeskView === "general" ? "general" : "team"))
    const [carries, setCarries] = useState(null)       // filter by what a post carries
    const [author, setAuthor] = useState(null)         // filter by who wrote it
    const shown = (posts || []).filter((p) =>
        (!carries || (carries === "text" ? !p.attachment : p.attachment?.kind === carries)) &&
        (!author || p.author_user_id === author))

    // BOOLEAN, NOT A COUNT. `urg.size` is 0 when nothing is selected, and
    // {0 && <x/>} renders the zero — a stray "0" sat beside the urgency
    // chips on every unfiltered view.
    const filtered = !!theater || urg.size > 0 || !!carries || !!author

    // The right column: who is writing, and what the desk has confirmed most.
    const week = Date.now() - 7 * 864e5
    const people = Object.values((posts || []).reduce((m, p) => {
        if (!p.author || p.deleted) return m
        const k = p.author_user_id
        m[k] = m[k] || { person: p.author, id: k, n: 0, last: p.created_at }
        m[k].n += 1
        return m
    }, {})).sort((x, y) => y.n - x.n).slice(0, 8)
    const top = (posts || []).filter((p) => !p.deleted && p.acks > 0 && new Date(p.created_at).getTime() > week)
        .sort((x, y) => y.acks - x.acks).slice(0, 5)
    const CARRIES = [["text", "Words only"], ["signal", "Signals"], ["briefing", "Briefings"], ["telegram", "Footage"], ["file", "Images & files"], ["place", "Places"], ["asset", "Our assets"]]
    const SIDE = { display: "flex", flexDirection: "column", gap: 18, padding: "18px 16px 40px", minWidth: 0, overflow: "auto" }
    const OPT = (on) => ({
        display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "7px 10px", borderRadius: 8,
        border: 0, background: on ? "var(--accdim)" : "transparent", color: on ? "var(--txt)" : "var(--txt2)", font: "inherit", fontSize: 13.5, cursor: "pointer",
    })

    return (
        <div style={MODE_SURFACE} data-testid="view-root-desk">
            <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(200px, 260px) minmax(0, 1fr) minmax(260px, 340px)" }}>
                {/* LEFT: what to show */}
                <aside style={{ ...SIDE, borderRight: "1px solid var(--gline)" }}>
                    <div>
                        <div style={{ fontSize: 22, fontWeight: 600 }}>Desk</div>
                        <div style={{ fontSize: 12.5, color: "var(--txt3)", marginTop: 2 }}>{view === "general" ? "what is generally happening" : "what the team has seen"}</div>
                    </div>
                    <div role="tablist" data-testid="desk-views" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", padding: 3, borderRadius: 12, background: "rgba(255,255,255,.05)" }}>
                        {[["team", "Team"], ["general", "General"]].map(([k, l]) => (
                            <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)}
                                    style={{ height: 32, border: 0, borderRadius: 9, cursor: "pointer", font: "inherit", fontSize: 13.5, fontWeight: 600,
                                             background: view === k ? "var(--acc, #3d7bf0)" : "transparent", color: view === k ? "#fff" : "var(--txt2)",
                                             transition: "background .2s ease, color .2s ease" }}>{l}</button>
                        ))}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ ...EYE, marginBottom: 6 }}>Carrying</span>
                        <button style={OPT(!carries)} onClick={() => setCarries(null)}>Everything</button>
                        {CARRIES.map(([k, l]) => <button key={k} style={OPT(carries === k)} onClick={() => setCarries(carries === k ? null : k)}>{l}</button>)}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <span style={EYE}>Urgency</span>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {URGENCY.map((u) => <Chip key={u} on={urg.has(u)} tint={SEV[u]} onClick={() => toggleUrg(u)}>{u}</Chip>)}
                        </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <span style={EYE}>Theater</span>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {theaters.map((t) => (
                                <Chip key={t.name} on={theater === t.name} count={t.count} onClick={() => setTheater(theater === t.name ? null : t.name)}>{t.name}</Chip>
                            ))}
                            {!theaters.length && <span style={{ fontSize: 12, color: "var(--txt3)" }}>nothing posted to a theater yet</span>}
                        </div>
                    </div>
                    {filtered && (
                        <button onClick={() => { setTheater(null); setUrg(new Set()); setCarries(null); setAuthor(null) }} style={{ ...BTN, alignSelf: "flex-start" }}>Show everything</button>
                    )}
                </aside>

                {/* MIDDLE: the feed */}
                <main style={{ minWidth: 0, overflow: "auto" }}>
                    {view === "general" ? (
                        <div key="general" style={{ maxWidth: 680, margin: "0 auto", padding: "14px 20px 60px", animation: "plx-fade-in .25s ease" }}>
                            <GeneralFeed
                                onMap={(it) => {
                                    window.dispatchEvent(new CustomEvent("akili:navigate", { detail: { destination: "situation" } }))
                                    setTimeout(() => window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: +it.lat, lon: +it.lon, altitude: 250_000 } })), 300)
                                }}
                                onShare={(it) => { setPrefill({ attachment: attachmentFor(it), body: "" }); setView("team") }} />
                        </div>
                    ) : (
                    <div key="team" style={{ maxWidth: 760, margin: "0 auto", padding: "18px 20px 60px", animation: "plx-fade-in .25s ease" }}>
                        <Composer onPublish={publish} prefill={prefill} onPrefillUsed={() => { setPrefill(null); window.__plxDeskShare = null }} />
                        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "18px 0 0" }}>
                            <span style={EYE}>{filtered ? `${shown.length} matching` : "Latest"}</span>
                            <div style={{ flex: 1 }} />
                            <button style={{ ...BTN, border: 0 }} onClick={load}>Refresh</button>
                        </div>

                        {posts === null && <Loading size={20} inline label="Reading the desk" />}

                        {posts !== null && !shown.length && (
                            <p style={{ font: "400 13.5px/1.75 var(--font)", color: "var(--txt3)", textWrap: "pretty" }}>
                                {filtered
                                    ? "Nothing posted matches that filter."
                                    : "Nothing on the desk yet. Post what you have seen — a signal, footage, a briefing, a place — and the team can comment and confirm it."}
                            </p>
                        )}

                        {shown.map((p) => (
                            <Post
                                key={p.id} post={p} meId={me?.id} busy={busy === p.id}
                                canDelete={p.author_user_id === me?.id || me?.is_super_admin}
                                onAck={() => ack(p)} onDelete={() => remove(p)}
                                onPerson={setCard}
                            />
                        ))}
                    </div>
                    )}
                </main>

                {/* RIGHT: who, and what was confirmed */}
                <aside style={{ ...SIDE, borderLeft: "1px solid var(--gline)" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <span style={{ ...EYE, marginBottom: 6 }}>On the desk</span>
                        {!people.length && <span style={{ fontSize: 12.5, color: "var(--txt3)" }}>Nobody has posted yet.</span>}
                        {people.map((x) => (
                            <button key={x.id} style={OPT(author === x.id)} onClick={() => setAuthor(author === x.id ? null : x.id)} title="Show only their posts">
                                <Face person={x.person} size={30} />
                                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                                    <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.person.name || x.person.email}</span>
                                    <span style={{ fontSize: 11.5, color: "var(--txt3)" }}>{x.n} {x.n === 1 ? "post" : "posts"} · last {fmtWhen(x.last)}</span>
                                </span>
                            </button>
                        ))}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <span style={EYE}>Most confirmed this week</span>
                        {!top.length && <span style={{ fontSize: 12.5, color: "var(--txt3)", lineHeight: 1.5 }}>Nothing confirmed yet. The ✓ under a post says “seen, and in hand”.</span>}
                        {top.map((p) => (
                            <button key={p.id} onClick={() => document.getElementById(`desk-post-${p.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
                                style={{ display: "flex", gap: 10, alignItems: "flex-start", textAlign: "left", border: "1px solid var(--gline)", background: "var(--glass2)", borderRadius: 10, padding: "9px 11px", color: "var(--txt)", font: "inherit", cursor: "pointer" }}>
                                <span style={{ color: "#4CAF7A", fontFamily: "var(--mz-font-mono)", fontSize: 12.5, whiteSpace: "nowrap" }}>✓ {p.acks}</span>
                                <span style={{ fontSize: 13, lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                                    {p.body || p.attachment?.headline || p.attachment?.title || p.attachment?.name || "—"}
                                </span>
                            </button>
                        ))}
                    </div>
                </aside>
            </div>

            {card && (
                <PersonCard person={card} isMe={card.id === me?.id} onClose={() => setCard(null)} />
            )}
        </div>
    )
}

/* ── who reads it ────────────────────────────────────────────────────── */

/** "Trifecta Technologies" / "Everyone on Parallax" / "Ana, Ben and 2 more". */
export function audienceLabel(a, myCompany) {
    if (!a || a.kind === "everyone") return "Everyone on Parallax"
    if (a.kind === "company") return a.company || myCompany || "Your company"
    const names = a.people || []
    if (!names.length) return "Named people"
    return names.length <= 2 ? names.join(" and ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`
}

function AudiencePicker({ me, audience, setAudience, shared, setShared }) {
    const [people, setPeople] = useState(null)
    const [q, setQ] = useState("")
    useEffect(() => {
        if (audience !== "people" || people) return
        chatPeople().then((d) => setPeople(Array.isArray(d) ? d : [])).catch(() => setPeople([]))
    }, [audience, people])
    const chosen = (people || []).filter((p) => shared.includes(p.id))
    const hits = q.trim()
        ? (people || []).filter((p) => !shared.includes(p.id) && `${p.name} ${p.email} ${p.company || ""}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6)
        : []
    const pill = { height: 30, background: "transparent", border: "1px solid var(--gline2)", color: "var(--txt2)", font: "inherit", fontSize: 12.5, borderRadius: 15, padding: "0 8px" }
    return (
        <>
            <select value={audience} onChange={(e) => setAudience(e.target.value)} title="Who reads this post" style={pill}>
                {me?.company && <option value="company">{me.company}</option>}
                <option value="everyone">Everyone on Parallax</option>
                <option value="people">Named people…</option>
            </select>
            {audience === "people" && (
                <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                    {chosen.map((p) => (
                        <span key={p.id} style={{ ...pill, display: "inline-flex", alignItems: "center", gap: 6, padding: "0 6px 0 10px", color: "var(--txt)" }}>
                            {p.name}
                            <button onClick={() => setShared(shared.filter((x) => x !== p.id))} title={`Remove ${p.name}`}
                                    style={{ border: 0, background: "none", color: "var(--txt-3)", cursor: "pointer", padding: 0 }}>✕</button>
                        </span>
                    ))}
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={people === null ? "Loading people…" : "Add a person"}
                           style={{ ...pill, width: 140, padding: "0 10px", outline: "none" }} />
                    {hits.length > 0 && (
                        <div style={{ position: "absolute", top: 34, left: 0, zIndex: 20, minWidth: 240, background: "var(--glass)", backdropFilter: "blur(22px) saturate(1.15)", WebkitBackdropFilter: "blur(22px) saturate(1.15)", border: "1px solid var(--gline2)", boxShadow: "var(--gshadow)" }}>
                            {hits.map((p) => (
                                <button key={p.id} onClick={() => { setShared([...shared, p.id]); setQ("") }}
                                        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 10px", border: 0, background: "none", color: "var(--txt)", cursor: "pointer", textAlign: "left", font: "inherit", fontSize: 12.5 }}>
                                    <Face person={p} size={22} />
                                    <span style={{ flex: 1, minWidth: 0 }}>{p.name}<span style={{ color: "var(--txt-3)" }}>{p.company ? ` · ${p.company}` : ""}</span></span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </>
    )
}

/* ── writing one ─────────────────────────────────────────────────────── */

function Composer({ onPublish, prefill = null, onPrefillUsed = () => {} }) {
    const me = getCurrentUser()
    const [body, setBody] = useState("")
    const [urgency, setUrgency] = useState("routine")
    const [theater, setTheater] = useState(() => getActiveTheater() || "")
    const [att, setAtt] = useState(null)              // one thing the post carries
    // Who reads it: the company by default; an account without one has to
    // choose, so it starts on everyone and says so.
    const [audience, setAudience] = useState(() => (me?.company ? "company" : "everyone"))
    const [shared, setShared] = useState([])
    const [picking, setPicking] = useState(null)      // which picker is open
    const [busy, setBusy] = useState(false)
    const fileRef = useRef(null)
    const boxRef = useRef(null)

    // "Share to the desk" from anywhere lands here with the thing attached.
    useEffect(() => {
        if (!prefill) return
        setAtt(prefill.attachment || null)
        if (prefill.body) setBody(prefill.body)
        onPrefillUsed()
        setTimeout(() => boxRef.current?.focus(), 50)
    }, [prefill]) // eslint-disable-line react-hooks/exhaustive-deps

    const go = async () => {
        if (!body.trim() && !att) return
        setBusy(true)
        try {
            if (audience === "people" && !shared.length) throw new Error("Add at least one person to share it with")
            await onPublish({ body: body.trim(), theater: theater.trim() || null, urgency, attachment: att || null,
                              audience, shared_with: audience === "people" ? shared : undefined })
            setBody(""); setAtt(null)
        } catch (e) {
            toast(e.message || "That did not publish", { icon: "i-alert" })
        } finally { setBusy(false) }
    }
    const pickBtn = (k, label) => (
        <button key={k} onClick={() => (k === "file" ? fileRef.current?.click() : setPicking(k))} disabled={!!att}
            style={{ ...BTN, height: 30, borderRadius: 15, padding: "0 12px", opacity: att ? 0.45 : 1 }}>{label}</button>
    )

    return (
        <div style={{ border: "1px solid var(--gline)", background: "var(--glass2)", padding: 14, borderRadius: 12, display: "flex", gap: 12 }}>
            <Face person={me} size={40} />
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                <textarea
                    ref={boxRef} value={body} onChange={(e) => setBody(e.target.value)}
                    placeholder={`What did you see? It goes to ${audience === "company" ? `${me?.company} only` : audience === "everyone" ? "everyone on Parallax" : "the people you name"}.`}
                    rows={2}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go() } }}
                    style={{ resize: "vertical", minHeight: 52, padding: "4px 0", background: "transparent", border: 0, color: "var(--txt)", font: "400 16px/1.55 var(--font)", outline: "none" }}
                />
                {att && (
                    <div style={{ position: "relative" }}>
                        <Attachment att={att} compact />
                        <button onClick={() => setAtt(null)} title="Remove" style={{ position: "absolute", right: 8, top: 8, width: 26, height: 26, borderRadius: 13, border: 0, background: "rgba(0,0,0,.6)", color: "#fff", cursor: "pointer" }}>✕</button>
                    </div>
                )}
                <div data-desk-attach style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", borderTop: "1px solid var(--gline)", paddingTop: 10 }}>
                    {pickBtn("signal", "Signal")}{pickBtn("briefing", "Briefing")}{pickBtn("telegram", "Footage")}
                    {pickBtn("file", "Image or file")}{pickBtn("place", "Place")}{pickBtn("asset", "Asset")}
                </div>
                <div data-desk-compose-row style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input ref={fileRef} type="file" style={{ display: "none" }} accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.tif,.tiff,.csv,.txt,.json,.geojson"
                        onChange={async (e) => {
                            const f = e.target.files?.[0]; e.target.value = ""
                            if (!f) return
                            try { setAtt(await uploadDeskFile(f)) } catch (err) { toast(err.message || "Could not attach that", { icon: "i-alert" }) }
                        }} />
                    <select value={urgency} onChange={(e) => setUrgency(e.target.value)} style={{ height: 30, background: "transparent", border: "1px solid var(--gline2)", color: SEV[urgency] || "var(--txt2)", font: "inherit", fontSize: 12.5, borderRadius: 15, padding: "0 8px" }}>
                        {URGENCY.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                    <AudiencePicker me={me} audience={audience} setAudience={setAudience} shared={shared} setShared={setShared} />
                    <input value={theater} onChange={(e) => setTheater(e.target.value)} placeholder="Theater"
                        style={{ width: 160, height: 30, padding: "0 10px", background: "transparent", border: "1px solid var(--gline2)", color: "var(--txt2)", font: "inherit", fontSize: 12.5, outline: "none", borderRadius: 15 }} />
                    <div style={{ flex: 1 }} />
                    <button style={{ ...PRIMARY, height: 32, borderRadius: 16, padding: "0 18px" }} disabled={busy || (!body.trim() && !att)} onClick={go}>{busy ? "Posting…" : "Post"}</button>
                </div>
            </div>
            {picking === "signal" && <SignalPicker2 onPick={(a) => { setAtt(a); setPicking(null) }} onClose={() => setPicking(null)} />}
            {picking === "briefing" && <BriefingPicker onPick={(a) => { setAtt(a); setPicking(null) }} onClose={() => setPicking(null)} />}
            {picking === "telegram" && <TelegramPicker onPick={(a) => { setAtt(a); setPicking(null) }} onClose={() => setPicking(null)} />}
            {picking === "asset" && <AssetPicker onPick={(a) => { setAtt(a); setPicking(null) }} onClose={() => setPicking(null)} />}
            {picking === "place" && <PlacePick onPick={(a) => { setAtt(a); setPicking(null) }} onClose={() => setPicking(null)} />}
        </div>
    )
}


/* ── one post ────────────────────────────────────────────────────────── */

function Post({ post, meId, busy, canDelete, onAck, onDelete, onPerson }) {
    const [replies, setReplies] = useState(null)
    const [open, setOpen] = useState(false)
    const [draft, setDraft] = useState("")
    const [ackers, setAckers] = useState(null)

    const openReplies = async () => {
        setOpen(!open)
        if (!open && replies === null) {
            try { setReplies((await listReplies(post.id)).replies || []) }
            catch { setReplies([]) }
        }
    }

    const reply = async () => {
        const text = draft.trim()
        if (!text) return
        setDraft("")
        try {
            const r = await createPost({ body: text, parent_id: post.id })
            setReplies((p) => [...(p || []), r])
        } catch (e) { setDraft(text); toast(e.message || "That did not post", { icon: "i-alert" }) }
    }

    const att = post.attachment

    return (
        <article id={`desk-post-${post.id}`} style={{
            borderBottom: "1px solid var(--gline)", padding: "16px 4px 12px",
        }}>
            <div style={{ display: "flex", gap: 10 }}>
                <Face person={post.author} size={42} onClick={() => post.author && onPerson(post.author)} />
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap" }}>
                        <b onClick={() => post.author && onPerson(post.author)} style={{
                            font: "600 14px var(--font)", color: "var(--txt)", cursor: "pointer",
                        }}>{post.author?.name || "Someone"}</b>
                        {post.author?.title && (
                            <span style={{ font: "400 11px var(--font)", color: "var(--txt-3)" }}>{post.author.title}</span>
                        )}
                        <span style={{ font: "400 10.5px var(--mono)", color: "var(--txt-3)" }}>{when(post.created_at)}</span>
                        <div style={{ flex: 1 }} />
                        {post.theater && (
                            <span style={{ ...EYE, fontSize: 9.5 }}>{post.theater}</span>
                        )}
                        {post.audience && (
                            <span title={post.audience.kind === "people" ? `Shared with ${(post.audience.people || []).join(", ")}` : `Who reads this: ${audienceLabel(post.audience)}`}
                                  style={{ ...EYE, fontSize: 9.5, color: post.audience.kind === "everyone" ? "var(--txt-3)" : "var(--txt-2)" }}>
                                {post.audience.kind === "company" ? audienceLabel(post.audience) : post.audience.kind === "people" ? audienceLabel(post.audience) : "Everyone"}
                            </span>
                        )}
                        {post.urgency && post.urgency !== "routine" && (
                            <span style={{
                                font: "500 9.5px var(--mono)", letterSpacing: ".1em", textTransform: "uppercase",
                                color: SEV[post.urgency] || "var(--txt-3)",
                            }}>{post.urgency}</span>
                        )}
                    </div>

                    {post.deleted ? (
                        <p style={{ margin: "6px 0 0", font: "italic 400 13px var(--font)", color: "var(--txt-3)" }}>
                            This post was deleted.
                        </p>
                    ) : (
                        <>
                            {post.body && (
                                <p style={{
                                    margin: "4px 0 0", font: "400 15px/1.6 var(--font)", color: "var(--txt)",
                                    whiteSpace: "pre-wrap", textWrap: "pretty",
                                }}>{post.body}</p>
                            )}

                            {att && <div style={{ marginTop: 10 }}><Attachment att={att} postId={post.id} /></div>}

                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 11 }}>
                                <button onClick={openReplies} title="Comment" style={{ ...BTN, height: 30, border: 0, borderRadius: 15, display: "inline-flex", alignItems: "center", gap: 6 }}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 5h16v11H9l-5 4z" /></svg>
                                    {post.replies || ""}
                                </button>
                                {/* THE CHECK MARK: "I have seen this and it is in hand". */}
                                <button onClick={onAck} disabled={busy} title={post.acked ? "You confirmed this — click to take it back" : "Confirm: seen, and in hand"} style={{
                                    ...BTN, height: 30, borderRadius: 15, display: "inline-flex", alignItems: "center", gap: 6,
                                    border: `1px solid ${post.acked ? "#4CAF7A" : "transparent"}`,
                                    background: post.acked ? "rgba(76,175,122,.16)" : "transparent",
                                    color: post.acked ? "#4CAF7A" : "var(--txt2)",
                                }}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M4 12.5l5 5L20 6.5" /></svg>
                                    {post.acks || ""}
                                </button>
                                {post.acks > 0 && (
                                    <button onClick={async () => {
                                        // WHO, not just how many. "Three people
                                        // have seen this" is half an answer.
                                        try { setAckers(await whoAcked(post.id)) } catch { /* ignore */ }
                                    }} style={{ ...BTN, height: 24, border: 0, color: "var(--txt-3)" }}>who confirmed</button>
                                )}
                                <button onClick={() => {
                                    navigator.clipboard?.writeText(`${location.origin}/#desk=${post.id}`).then(() => toast("Link copied", { icon: "i-check" })).catch(() => {})
                                }} title="Copy a link to this post" style={{ ...BTN, height: 30, border: 0, borderRadius: 15 }}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M10 14a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 10a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1" /></svg>
                                </button>
                                <div style={{ flex: 1 }} />
                                {canDelete && (
                                    <button onClick={onDelete} style={{ ...BTN, height: 24, border: 0, color: "var(--txt-3)" }}>
                                        Delete
                                    </button>
                                )}
                            </div>

                            {ackers && (
                                <div style={{
                                    marginTop: 7, padding: "6px 9px", border: "1px solid var(--gline)",
                                    font: "400 11px var(--font)", color: "var(--txt-2)",
                                    display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap",
                                }}>
                                    <span style={EYE}>Confirmed by</span>
                                    {ackers.map((a) => (
                                        <span key={a.id} onClick={() => onPerson(a)} style={{ cursor: "pointer" }}>{a.name}</span>
                                    ))}
                                    <button onClick={() => setAckers(null)} style={{ ...BTN, height: 18, border: 0, marginLeft: "auto" }}>✕</button>
                                </div>
                            )}
                        </>
                    )}

                    {open && (
                        <div style={{ marginTop: 11, borderTop: "1px solid var(--gline)", paddingTop: 10 }}>
                            {replies === null && <Loading size={16} inline label="Loading" />}
                            {(replies || []).map((r) => (
                                <div key={r.id} style={{ display: "flex", gap: 8, marginBottom: 9 }}>
                                    <Face person={r.author} size={24} onClick={() => r.author && onPerson(r.author)} />
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                                            <b style={{ font: "600 11.5px var(--font)", color: "var(--txt)" }}>
                                                {r.author?.name || "Someone"}
                                            </b>
                                            <span style={{ font: "400 10px var(--mono)", color: "var(--txt-3)" }}>{when(r.created_at)}</span>
                                        </div>
                                        <p style={{
                                            margin: "2px 0 0", font: "400 12.5px/1.6 var(--font)",
                                            color: r.deleted ? "var(--txt-3)" : "var(--txt-2)",
                                            whiteSpace: "pre-wrap",
                                        }}>{r.deleted ? "deleted" : r.body}</p>
                                    </div>
                                </div>
                            ))}
                            <div style={{ display: "flex", gap: 7 }}>
                                <input
                                    value={draft} onChange={(e) => setDraft(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); reply() } }}
                                    placeholder="Add what you have"
                                    style={{
                                        flex: 1, height: 28, padding: "0 9px", background: "var(--glass2)",
                                        border: "1px solid var(--gline)", color: "var(--txt)",
                                        font: "400 12.5px var(--font)", outline: "none", borderRadius: 0,
                                    }}
                                />
                                <button style={{ ...PRIMARY, height: 28 }} onClick={reply} disabled={!draft.trim()}>Reply</button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </article>
    )
}
