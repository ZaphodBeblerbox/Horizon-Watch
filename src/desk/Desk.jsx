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
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
    listPosts, createPost, deletePost, toggleAck, whoAcked, listReplies,
    postedTheaters, uploadDeskFile, deskFileUrl,
} from "../lib/deskApi.js"
import { getCurrentUser } from "../state/authStore.js"
import { getActiveTheater, URGENCY } from "../state/filing.js"
import { useSaved, savedLabel, savedMeta } from "../state/savedForBriefing.js"
import { SAVED_READ } from "../state/signalPicker.js"
import PersonCard, { Face } from "../chat/PersonCard.jsx"
import { toast } from "../ui/toast.js"
import Loading from "../ui/Loading.jsx"
import { MODE_SURFACE } from "../plx6/modeWindow.js"

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
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" })
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

    // BOOLEAN, NOT A COUNT. `urg.size` is 0 when nothing is selected, and
    // {0 && <x/>} renders the zero — a stray "0" sat beside the urgency
    // chips on every unfiltered view.
    const filtered = !!theater || urg.size > 0

    return (
        <div style={MODE_SURFACE} data-testid="view-root-desk">
            <div style={{
                display: "flex", alignItems: "center", gap: 12, height: 44, flexShrink: 0,
                padding: "0 16px", borderBottom: "1px solid var(--gline)",
            }}>
                <b style={{ font: "600 13px var(--font)", color: "var(--txt)" }}>Desk</b>
                <span style={EYE}>what the desk has seen</span>
                <div style={{ flex: 1 }} />
                <button style={BTN} onClick={load}>Refresh</button>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                <div style={{ maxWidth: 760, margin: "0 auto", padding: "18px 20px 60px" }}>
                    <Composer onPublish={publish} />

                    <div style={{ display: "flex", flexDirection: "column", gap: 6, margin: "20px 0 14px" }}>
                        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
                            <span style={{ ...EYE, marginRight: 4 }}>Theater</span>
                            {theaters.map((t) => (
                                <Chip key={t.name} on={theater === t.name} count={t.count}
                                      onClick={() => setTheater(theater === t.name ? null : t.name)}>
                                    {t.name}
                                </Chip>
                            ))}
                            {!theaters.length && (
                                <span style={{ font: "400 11px var(--font)", color: "var(--txt-3)" }}>
                                    nothing posted to a theater yet
                                </span>
                            )}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
                            <span style={{ ...EYE, marginRight: 4 }}>Urgency</span>
                            {URGENCY.map((u) => (
                                <Chip key={u} on={urg.has(u)} tint={SEV[u]} onClick={() => toggleUrg(u)}>{u}</Chip>
                            ))}
                            {filtered && (
                                <button onClick={() => { setTheater(null); setUrg(new Set()) }} style={{
                                    marginLeft: "auto", border: 0, background: "transparent",
                                    color: "var(--txt-3)", font: "400 11px var(--font)", cursor: "pointer",
                                }}>show everything</button>
                            )}
                        </div>
                    </div>

                    {posts === null && <Loading size={20} inline label="Reading the desk" />}

                    {posts !== null && !posts.length && (
                        <p style={{ font: "400 12.5px/1.75 var(--font)", color: "var(--txt-3)", textWrap: "pretty" }}>
                            {filtered
                                ? "Nothing posted matches that filter."
                                : "Nothing on the desk yet. Publish what you have seen — it goes to everyone, and it can carry the signal it is about."}
                        </p>
                    )}

                    {(posts || []).map((p) => (
                        <Post
                            key={p.id} post={p} meId={me?.id} busy={busy === p.id}
                            canDelete={p.author_user_id === me?.id || me?.is_super_admin}
                            onAck={() => ack(p)} onDelete={() => remove(p)}
                            onPerson={setCard}
                        />
                    ))}
                </div>
            </div>

            {card && (
                <PersonCard person={card} isMe={card.id === me?.id} onClose={() => setCard(null)} />
            )}
        </div>
    )
}

/* ── writing one ─────────────────────────────────────────────────────── */

function Composer({ onPublish }) {
    const [body, setBody] = useState("")
    const [urgency, setUrgency] = useState("routine")
    const [theater, setTheater] = useState(() => getActiveTheater() || "")
    const [signal, setSignal] = useState(null)
    const [file, setFile] = useState(null)
    const [picking, setPicking] = useState(false)
    const [busy, setBusy] = useState(false)
    const fileRef = useRef(null)

    const go = async () => {
        if (!body.trim() && !signal && !file) return
        setBusy(true)
        try {
            await onPublish({
                body: body.trim(),
                theater: theater.trim() || null,
                urgency,
                attachment: signal || file || null,
            })
            setBody(""); setSignal(null); setFile(null)
        } catch (e) {
            toast(e.message || "That did not publish", { icon: "i-alert" })
        } finally { setBusy(false) }
    }

    return (
        <div style={{
            border: "1px solid var(--gline)", background: "var(--glass2)", padding: 12,
            display: "flex", flexDirection: "column", gap: 10,
        }}>
            <textarea
                value={body} onChange={(e) => setBody(e.target.value)}
                placeholder="What have you seen? This goes to everyone on the desk."
                rows={3}
                onKeyDown={(e) => {
                    // ⌘/Ctrl+Enter publishes. Plain Enter is a new line —
                    // an observation is a paragraph, not a chat line.
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go() }
                }}
                style={{
                    resize: "vertical", minHeight: 62, padding: "9px 11px",
                    background: "var(--glass2)", border: "1px solid var(--gline)",
                    color: "var(--txt)", font: "400 13.5px/1.6 var(--font)",
                    outline: "none", borderRadius: 0,
                }}
            />

            {signal && (
                <AttachedSignal signal={signal} onRemove={() => setSignal(null)} />
            )}
            {file && (
                <div style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
                    border: "1px solid var(--gline)", font: "400 11.5px var(--font)", color: "var(--txt-2)",
                }}>
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {file.name}
                    </span>
                    <button onClick={() => setFile(null)} style={{ ...BTN, height: 20, border: 0 }}>✕</button>
                </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <input
                    value={theater} onChange={(e) => setTheater(e.target.value)}
                    placeholder="Theater"
                    style={{
                        width: 150, height: 24, padding: "0 8px", background: "transparent",
                        border: "1px solid var(--gline)", color: "var(--txt-2)",
                        font: "400 11.5px var(--font)", outline: "none", borderRadius: 0,
                    }}
                />
                {URGENCY.map((u) => (
                    <Chip key={u} on={urgency === u} tint={SEV[u]} onClick={() => setUrgency(u)}>{u}</Chip>
                ))}
                <button style={BTN} onClick={() => setPicking(true)} disabled={!!signal}>Attach a signal</button>
                <button style={BTN} onClick={() => fileRef.current?.click()} disabled={!!file}>Attach a file</button>
                <input
                    ref={fileRef} type="file" style={{ display: "none" }}
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.tif,.tiff,.csv,.txt,.json,.geojson"
                    onChange={async (e) => {
                        const f = e.target.files?.[0]; e.target.value = ""
                        if (!f) return
                        try { setFile(await uploadDeskFile(f)) }
                        catch (err) { toast(err.message || "Could not attach that", { icon: "i-alert" }) }
                    }}
                />
                <div style={{ flex: 1 }} />
                <button style={PRIMARY} disabled={busy || (!body.trim() && !signal && !file)} onClick={go}>
                    {busy ? "Publishing…" : "Publish"}
                </button>
            </div>

            {picking && (
                <SignalPicker
                    onPick={(s) => { setSignal(s); setPicking(false) }}
                    onClose={() => setPicking(false)}
                />
            )}
        </div>
    )
}

/**
 * Choosing a signal to publish with.
 *
 * It reads what you have already SAVED, rather than the whole corpus:
 * publishing an observation about something is a thing you do after you
 * have noticed it, and noticing it is what saving means here.
 */
function SignalPicker({ onPick, onClose }) {
    const saved = useSaved()
    const [q, setQ] = useState("")
    const items = useMemo(() => {
        const text = q.trim().toLowerCase()
        return saved
            .filter((s) => s.kind !== "note")
            .filter((s) => !text || SAVED_READ.text(s).toLowerCase().includes(text))
    }, [saved, q])

    return (
        <div onClick={onClose} style={{
            position: "fixed", inset: 0, zIndex: 9000, display: "grid", placeItems: "center",
            background: "rgba(10,14,31,.5)", padding: 20,
        }}>
            <div onClick={(e) => e.stopPropagation()} data-testid="desk-signal-picker" style={{
                width: 460, maxWidth: "100%", maxHeight: "80vh", display: "flex", flexDirection: "column",
                background: "var(--glass)", backdropFilter: "blur(22px) saturate(1.15)",
                WebkitBackdropFilter: "blur(22px) saturate(1.15)",
                border: "1px solid var(--gline2)", boxShadow: "var(--gshadow)",
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: "1px solid var(--gline)" }}>
                    <b style={{ flex: 1, font: "600 13px var(--font)", color: "var(--txt)" }}>Publish a signal with it</b>
                    <button onClick={onClose} style={{ ...BTN, border: 0, padding: "0 6px" }}>✕</button>
                </div>
                <div style={{ padding: "10px 14px" }}>
                    <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search what you have saved"
                           style={{
                               width: "100%", height: 28, padding: "0 9px", background: "var(--glass2)",
                               border: "1px solid var(--gline)", color: "var(--txt)",
                               font: "400 12.5px var(--font)", outline: "none", borderRadius: 0,
                           }} />
                </div>
                <div style={{ flex: 1, minHeight: 0, overflow: "auto", borderTop: "1px solid var(--gline)" }}>
                    {!items.length && (
                        <p style={{ padding: 14, font: "400 12px/1.65 var(--font)", color: "var(--txt-3)" }}>
                            {q.trim() ? "Nothing saved matches that."
                                : "You have not saved anything yet. Use + briefing on a map card, an object view or an inbox message."}
                        </p>
                    )}
                    {items.map((s) => (
                        <div key={s.id} onClick={() => onPick({
                            kind: "signal", id: s.id, headline: savedLabel(s), meta: savedMeta(s) || null,
                            lat: s.lat ?? null, lon: s.lon ?? null,
                            urgency: SAVED_READ.urgency(s), sector: SAVED_READ.sector(s),
                        })} style={{
                            display: "flex", alignItems: "center", gap: 9, padding: "9px 14px",
                            borderBottom: "1px solid var(--gline)", cursor: "pointer",
                        }}>
                            <i style={{ width: 7, height: 7, flexShrink: 0, background: SEV[SAVED_READ.urgency(s)] || "var(--steel)" }} />
                            <div style={{ minWidth: 0 }}>
                                <div style={{ font: "500 12.5px var(--font)", color: "var(--txt)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {savedLabel(s)}
                                </div>
                                <div style={{ font: "400 10.5px var(--mono)", color: "var(--txt-3)" }}>
                                    {SAVED_READ.sector(s)}{savedMeta(s) ? ` · ${savedMeta(s)}` : ""}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}

function AttachedSignal({ signal, onRemove = null }) {
    return (
        <div style={{
            display: "flex", alignItems: "center", gap: 9, padding: "8px 11px",
            border: "1px solid var(--gline)", background: "var(--glass2)",
        }}>
            <i style={{ width: 7, height: 7, flexShrink: 0, background: SEV[signal.urgency] || "var(--steel)" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                    font: "500 12.5px var(--font)", color: "var(--txt)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{signal.headline}</div>
                <div style={{ font: "400 10.5px var(--mono)", color: "var(--txt-3)" }}>
                    {[signal.sector, signal.meta].filter(Boolean).join(" · ")}
                </div>
            </div>
            {signal.lat != null && (
                <button onClick={() => window.dispatchEvent(new CustomEvent("akili:fly-to", {
                    detail: { lat: signal.lat, lon: signal.lon },
                }))} style={{
                    ...BTN, height: 22, border: 0, color: "var(--acc-hi)", flexShrink: 0,
                }}>on the map →</button>
            )}
            {onRemove && <button onClick={onRemove} style={{ ...BTN, height: 20, border: 0 }}>✕</button>}
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
        <article style={{
            border: "1px solid var(--gline)", marginBottom: 10, padding: 13,
            background: "var(--glass2)",
        }}>
            <div style={{ display: "flex", gap: 10 }}>
                <Face person={post.author} size={34} onClick={() => post.author && onPerson(post.author)} />
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap" }}>
                        <b onClick={() => post.author && onPerson(post.author)} style={{
                            font: "600 12.5px var(--font)", color: "var(--txt)", cursor: "pointer",
                        }}>{post.author?.name || "Someone"}</b>
                        {post.author?.title && (
                            <span style={{ font: "400 11px var(--font)", color: "var(--txt-3)" }}>{post.author.title}</span>
                        )}
                        <span style={{ font: "400 10.5px var(--mono)", color: "var(--txt-3)" }}>{when(post.created_at)}</span>
                        <div style={{ flex: 1 }} />
                        {post.theater && (
                            <span style={{ ...EYE, fontSize: 9.5 }}>{post.theater}</span>
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
                                    margin: "6px 0 0", font: "400 13.5px/1.65 var(--font)", color: "var(--txt)",
                                    whiteSpace: "pre-wrap", textWrap: "pretty",
                                }}>{post.body}</p>
                            )}

                            {att?.kind === "signal" && (
                                <div style={{ marginTop: 9 }}><AttachedSignal signal={att} /></div>
                            )}
                            {att?.kind === "file" && (
                                (att.mime || "").startsWith("image/")
                                    ? <a href={deskFileUrl(post.id)} download={att.name} style={{ display: "block", marginTop: 9 }}>
                                        <img src={deskFileUrl(post.id)} alt={att.name} style={{
                                            display: "block", maxWidth: "100%", maxHeight: 360,
                                            objectFit: "contain", border: "1px solid var(--gline)",
                                        }} />
                                      </a>
                                    : <a href={deskFileUrl(post.id)} download={att.name} style={{
                                        display: "inline-block", marginTop: 9, padding: "7px 10px",
                                        border: "1px solid var(--gline)", color: "var(--txt)",
                                        font: "400 12px var(--font)", textDecoration: "none",
                                      }}>{att.name} · download</a>
                            )}

                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 11 }}>
                                <button onClick={onAck} disabled={busy} style={{
                                    ...BTN, height: 24,
                                    border: `1px solid ${post.acked ? "var(--acc-line)" : "var(--gline2)"}`,
                                    background: post.acked ? "var(--acc-dim)" : "transparent",
                                    color: post.acked ? "var(--txt)" : "var(--txt-2)",
                                }}>
                                    {post.acked ? "Picked up" : "Pick up"}{post.acks ? ` · ${post.acks}` : ""}
                                </button>
                                {post.acks > 0 && (
                                    <button onClick={async () => {
                                        // WHO, not just how many. "Three people
                                        // have seen this" is half an answer.
                                        try { setAckers(await whoAcked(post.id)) } catch { /* ignore */ }
                                    }} style={{ ...BTN, height: 24, border: 0, color: "var(--txt-3)" }}>who</button>
                                )}
                                <button onClick={openReplies} style={{ ...BTN, height: 24, border: 0 }}>
                                    {post.replies ? `${post.replies} ${post.replies === 1 ? "reply" : "replies"}` : "Reply"}
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
                                    <span style={EYE}>Picked up by</span>
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
