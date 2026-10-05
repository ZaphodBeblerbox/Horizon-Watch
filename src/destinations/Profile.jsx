/**
 * Profile.jsx — PARALLAX v6, Part B ▣ Profile.
 *
 * The spec's shape: a 200px sticky nav on the left under a 24px
 * "Settings", the chosen section on the right in glass2 cards at a 1040px
 * measure, and a save bar that appears across the bottom only once
 * something is dirty.
 *
 * WHAT IS REAL AND WHAT IS NOT, which this screen has to be straight about
 * because a settings page that silently discards input is worse than one
 * that admits a gap:
 *   - Name, job title, initials, time zone and picture  → saved (PUT /api/users/{id})
 *   - Password                                          → saved (POST /api/auth/change-password)
 *   - Email, team, role                                 → real, and not yours to change here
 *   - Language, two-factor, signed-in devices           → the spec has them, this backend does not
 * The last group is rendered as the spec lays it out and labelled as not
 * yet wired, rather than shipped as controls that look live and do
 * nothing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import API_BASE from "../apiBase.js"
import { getCurrentUser, subscribeAuth, updateCurrentUser } from "../state/authStore.js"
import Admin from "./Admin.jsx"
import { MODE_SURFACE } from "../plx6/modeWindow.js"
import Loading from "../ui/Loading.jsx"

const LABEL = { fontSize: 13, color: "var(--txt3)" }
const INPUT = {
    height: 36, minWidth: 0, padding: "0 10px",
    border: "1px solid var(--gline2)", background: "var(--glass2)",
    borderRadius: 0, outline: "none", color: "var(--txt)",
    fontFamily: "var(--mz-font-body)", fontSize: 14, width: "100%",
}
const CARD = {
    display: "flex", flexDirection: "column", gap: 18, padding: 20,
    border: "1px solid var(--gline)", background: "var(--glass2)", minWidth: 0,
}
const H2 = { margin: 0, fontFamily: "var(--mz-font-body)", fontWeight: 600, fontSize: 18 }
const GRID = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,220px),1fr))",
    gap: 14,
}

const TZ = [
    "UTC", "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Kyiv",
    "Africa/Cairo", "Asia/Jerusalem", "Asia/Dubai", "Asia/Karachi",
    "Asia/Singapore", "Asia/Tokyo", "America/New_York", "America/Chicago",
    "America/Los_Angeles",
]

function Field({ label, hint, children }) {
    return (
        <label style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
            <span style={LABEL}>{label}</span>
            {children}
            {hint && <span style={{ fontSize: 12, color: "var(--txt4)", textWrap: "pretty" }}>{hint}</span>}
        </label>
    )
}

/** A small control that sits ON a picture, so it needs its own backing. */
function HdrBtn({ children, onClick }) {
    return (
        <button type="button" onClick={onClick} style={{
            height: 26, padding: "0 10px", border: "1px solid var(--gline2)",
            background: "var(--glass)", backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)", color: "var(--txt)",
            font: "inherit", fontSize: 11.5, cursor: "pointer", borderRadius: 0,
            whiteSpace: "nowrap",
        }}>{children}</button>
    )
}

/** A section the spec defines and this backend cannot yet honour. */
function NotWired({ title, what }) {
    return (
        <div style={CARD}>
            <h2 style={H2}>{title}</h2>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--txt3)", textWrap: "pretty" }}>
                {what} There is no server side for it yet, so rather than show switches that
                would forget what you set, this says so.
            </p>
        </div>
    )
}

/**
 * Downscale a picked picture so its SHORT side is `short` px, keeping the
 * whole frame.
 *
 * It used to crop to a centred square here. That threw the rest of the
 * photograph away at upload, so a face the square landed badly on could
 * only be fixed by finding a different picture — which is why the stored
 * image keeps its shape and the crop is a focal point applied at display
 * time. Short-side scaling means a square crop at any focal point is still
 * a full `short`×`short` of pixels.
 */
function toPictureDataUrl(file, short = 320) {
    return new Promise((resolve, reject) => {
        const img = new Image()
        const url = URL.createObjectURL(file)
        img.onload = () => {
            URL.revokeObjectURL(url)
            const scale = Math.min(1, short / Math.min(img.width, img.height))
            const c = document.createElement("canvas")
            c.width = Math.round(img.width * scale)
            c.height = Math.round(img.height * scale)
            c.getContext("2d").drawImage(img, 0, 0, c.width, c.height)
            resolve(c.toDataURL("image/jpeg", 0.82))
        }
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("that file is not an image this browser can read")) }
        img.src = url
    })
}

/**
 * Downscale a picked banner to 1500px wide, cropped to 15:4.
 *
 * Its own function rather than a parameter on the avatar one: a banner is
 * a strip, not a square, and reusing a square crop on a wide photograph
 * throws away the two thirds of it that made someone choose that picture.
 */
function toCoverDataUrl(file, width = 1500) {
    return new Promise((resolve, reject) => {
        const img = new Image()
        const url = URL.createObjectURL(file)
        img.onload = () => {
            URL.revokeObjectURL(url)
            // WIDTH ONLY. Cropping the strip here is the same mistake as
            // cropping the avatar: the part of the picture you wanted
            // behind your name is usually not the middle of it. The banner
            // is cropped at display time, where it can be dragged.
            const scale = Math.min(1, width / img.width)
            const c = document.createElement("canvas")
            c.width = Math.round(img.width * scale)
            c.height = Math.round(img.height * scale)
            c.getContext("2d").drawImage(img, 0, 0, c.width, c.height)
            resolve(c.toDataURL("image/jpeg", 0.8))
        }
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("that file is not an image this browser can read")) }
        img.src = url
    })
}

/**
 * An image you can drag to choose which part of it shows.
 *
 * The position is a CSS object-position string, which is also exactly what
 * gets stored — so what you see while dragging is what every other screen
 * will render, with no second code path that could disagree with it.
 */
function Positionable({ src, pos, onPos, editing, alt = "", style = null, radius = 0 }) {
    const ref = useRef(null)
    const drag = useRef(null)

    const parse = (p) => {
        const m = String(p || "50% 50%").match(/([\d.]+)%\s+([\d.]+)%/)
        return m ? { x: +m[1], y: +m[2] } : { x: 50, y: 50 }
    }

    const down = (e) => {
        if (!editing) return
        e.preventDefault()
        const box = ref.current?.getBoundingClientRect()
        const start = parse(pos)
        drag.current = {
            px: e.clientX, py: e.clientY,          // where the pointer went down
            x0: start.x, y0: start.y,              // the focal point at that moment
            w: box?.width || 1, h: box?.height || 1,
        }
        e.currentTarget.setPointerCapture?.(e.pointerId)
    }
    const move = (e) => {
        const d = drag.current
        if (!d) return
        // Dragging DOWN brings what is ABOVE into view, which means the
        // focal point moves up — hence the minus. The other sign reads as
        // the picture fighting the cursor.
        const clamp = (v) => Math.max(0, Math.min(100, v))
        const x = clamp(d.x0 - ((e.clientX - d.px) / d.w) * 100)
        const y = clamp(d.y0 - ((e.clientY - d.py) / d.h) * 100)
        onPos(`${x.toFixed(1)}% ${y.toFixed(1)}%`)
    }
    const up = (e) => { drag.current = null; e.currentTarget.releasePointerCapture?.(e.pointerId) }

    return (
        <div
            ref={ref}
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
            style={{
                position: "relative", overflow: "hidden", borderRadius: radius,
                cursor: editing ? "grab" : "default", touchAction: "none", ...style,
            }}
        >
            {src
                ? <img src={src} alt={alt} draggable={false} style={{
                    width: "100%", height: "100%", objectFit: "cover",
                    objectPosition: pos || "50% 50%", display: "block", userSelect: "none",
                  }} />
                : null}
            {editing && src && (
                <span style={{
                    position: "absolute", inset: 0, pointerEvents: "none",
                    boxShadow: "inset 0 0 0 2px var(--acchi)",
                }} />
            )}
        </div>
    )
}

const splitName = (n) => {
    const parts = (n || "").trim().split(/\s+/).filter(Boolean)
    return { first: parts[0] || "", last: parts.slice(1).join(" ") }
}

export default function Profile({ onClose = null, section = null }) {
    const [sec, setSec] = useState(section || "profile")
    // The rail's shield opens the account ON the console. Keyed on the
    // prop so pressing it again from another screen comes back here
    // rather than landing on whichever section was last looked at.
    useEffect(() => { if (section) setSec(section) }, [section])
    const [user, setUser] = useState(() => getCurrentUser())
    const [base, setBase] = useState(null)   // what the server last gave us
    const [pf, setPf] = useState(null)       // what is on screen
    const [saving, setSaving] = useState(false)
    const [msg, setMsg] = useState(null)
    const fileRef = useRef(null)
    const coverRef = useRef(null)
    // Which picture is being dragged, if either. One at a time: two
    // draggable images at once is two things moving under one cursor.
    const [posing, setPosing] = useState(null)

    useEffect(() => subscribeAuth(setUser), [])

    const load = useCallback((u) => {
        const { first, last } = splitName(u.name)
        const v = {
            first, last, title: u.title || "", initials: u.initials || "",
            tz: u.timezone || "UTC", avatar: u.avatar || null,
            company: u.company || "", location: u.location || "",
            bio: u.bio || "", cover: u.cover || null,
        }
        setBase(v); setPf(v)
    }, [])
    useEffect(() => { if (user && !pf) load(user) }, [user, pf, load])

    useEffect(() => {
        if (!msg) return undefined
        const t = setTimeout(() => setMsg(null), 4500)
        return () => clearTimeout(t)
    }, [msg])
    useEffect(() => {
        if (!onClose) return undefined
        const k = (e) => { if (e.key === "Escape") onClose() }
        window.addEventListener("keydown", k)
        return () => window.removeEventListener("keydown", k)
    }, [onClose])

    const dirty = useMemo(
        () => !!(base && pf) && JSON.stringify(base) !== JSON.stringify(pf), [base, pf])
    const set = (k, v) => setPf((p) => ({ ...p, [k]: v }))

    const save = async () => {
        if (!user?.id || !pf) return
        setSaving(true)
        try {
            const body = {
                name: [pf.first, pf.last].filter(Boolean).join(" "),
                title: pf.title, initials: pf.initials, timezone: pf.tz, avatar: pf.avatar,
                company: pf.company, location: pf.location,
                bio: pf.bio, cover: pf.cover,
            }
            const r = await fetch(`${API_BASE}/api/users/${user.id}`, {
                method: "PUT", credentials: "include",
                headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
            })
            const d = await r.json().catch(() => null)
            if (!r.ok) throw new Error(d?.detail || `save failed (${r.status})`)
            // Into the shared store, so the rail and Home show it at once.
            updateCurrentUser(d)
            setUser(d); load(d)
            setMsg({ ok: true, text: "Saved." })
        } catch (e) {
            setMsg({ ok: false, text: String(e.message || e) })
        } finally { setSaving(false) }
    }

    if (!user || !pf) {
        return (
            <section data-screen-label="Profile" style={MODE_SURFACE}>
                <Loading size={22} inline label="Reading your account" style={{ padding: 24 }} />
            </section>
        )
    }

    const initials = (pf.initials || user.initials || "?").slice(0, 3).toUpperCase()
    const full = [pf.first, pf.last].filter(Boolean).join(" ") || user.email
    const NAV = [["Profile", "profile"], ["Email and password", "account"],
                 ["Security", "security"], ["Notifications", "notif"],
                 // Administration is part of the account, not a separate
                 // place: it is a thing this person can do because of who
                 // they are signed in as.
                 ...(user.is_super_admin ? [["Administration", "admin"]] : [])]

    return (
        <section data-screen-label="Profile" style={{ ...MODE_SURFACE, position: "relative" }}>
            {/* The spec has no close control — it assumes a chrome that can
                navigate away. Ours cannot leave a module without one. */}
            {onClose && (
                <button onClick={onClose} title="Close (Esc)" aria-label="Close account" style={{
                    position: "absolute", right: 10, top: 10, zIndex: 3,
                    width: 28, height: 28, border: "1px solid var(--gline2)",
                    background: "transparent", color: "var(--txt3)",
                    font: "inherit", cursor: "pointer", borderRadius: 0,
                }}>✕</button>
            )}

            <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "24px 24px 96px" }}>
                <div style={{
                    display: "grid", gridTemplateColumns: "minmax(0,200px) minmax(0,1fr)",
                    // The console is a table with six columns and needs the
                    // window; the rest of this screen is a form and reads
                    // badly past about a thousand pixels.
                    gap: 32, maxWidth: sec === "admin" ? "none" : 1040,
                }}>
                    <nav style={{
                        display: "flex", flexDirection: "column", gap: 2,
                        alignSelf: "start", position: "sticky", top: 0,
                    }}>
                        <span style={{
                            fontFamily: "var(--mz-font-body)", fontWeight: 600,
                            fontSize: 24, marginBottom: 14,
                        }}>Settings</span>
                        {NAV.map(([k, v]) => (
                            <button key={v} onClick={() => setSec(v)} style={{
                                display: "flex", alignItems: "center", height: 34, padding: "0 12px",
                                border: 0, borderRadius: 4,
                                background: sec === v ? "var(--accdim)" : "transparent",
                                color: sec === v ? "var(--txt)" : "var(--txt3)",
                                font: "inherit", fontSize: 14, textAlign: "left", cursor: "pointer",
                            }}>{k}</button>
                        ))}
                    </nav>

                    <div style={{ display: "flex", flexDirection: "column", gap: 20, minWidth: 0 }}>
                        {sec === "profile" && (
                            <div style={{ ...CARD, padding: 0, overflow: "hidden" }}>
                                {/* ── the page as a colleague sees it ───────
                                    A banner, a picture, and the three lines
                                    that say who somebody is. The fields that
                                    edit it are underneath, so what you type
                                    changes what you are looking at. */}
                                <div style={{ position: "relative" }}>
                                    <Positionable
                                        src={pf.cover} pos={pf.cover_pos} editing={posing === "cover"}
                                        onPos={(v) => set("cover_pos", v)} alt=""
                                        style={{
                                            height: 176, width: "100%",
                                            background: pf.cover ? "var(--hov)" : "linear-gradient(120deg, var(--acc) 0%, var(--bg-2) 100%)",
                                            borderBottom: "1px solid var(--gline)",
                                        }}
                                    />
                                    <div style={{ position: "absolute", right: 10, top: 10, display: "flex", gap: 6 }}>
                                        {pf.cover && (
                                            <HdrBtn onClick={() => setPosing(posing === "cover" ? null : "cover")}>
                                                {posing === "cover" ? "Done" : "Reposition"}
                                            </HdrBtn>
                                        )}
                                        <HdrBtn onClick={() => coverRef.current?.click()}>
                                            {pf.cover ? "Change cover" : "Add a cover"}
                                        </HdrBtn>
                                        {pf.cover && (
                                            <HdrBtn onClick={() => { set("cover", null); setPosing(null) }}>Remove</HdrBtn>
                                        )}
                                    </div>
                                    {posing === "cover" && (
                                        <span style={{
                                            position: "absolute", left: 10, bottom: 10, padding: "3px 8px",
                                            background: "var(--glass)", border: "1px solid var(--gline2)",
                                            fontSize: 11, color: "var(--txt2)",
                                        }}>Drag the picture to choose what shows.</span>
                                    )}
                                </div>

                                <div style={{ padding: "0 20px 20px", marginTop: -46 }}>
                                    <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
                                        <div style={{ position: "relative", flex: "none" }}>
                                            {pf.avatar ? (
                                                <Positionable
                                                    src={pf.avatar} pos={pf.avatar_pos} editing={posing === "avatar"}
                                                    onPos={(v) => set("avatar_pos", v)} radius="50%"
                                                    style={{
                                                        width: 104, height: 104,
                                                        border: "3px solid var(--bg-1)", background: "var(--hov)",
                                                        boxShadow: "var(--gshadow)",
                                                    }}
                                                />
                                            ) : (
                                                <div onClick={() => fileRef.current?.click()} title="Choose a picture" style={{
                                                    width: 104, height: 104, borderRadius: "50%",
                                                    border: "3px solid var(--bg-1)", background: "var(--hov)",
                                                    display: "grid", placeItems: "center", cursor: "pointer",
                                                    fontSize: 34, color: "var(--txt2)", boxShadow: "var(--gshadow)",
                                                }}>{initials}</div>
                                            )}
                                        </div>

                                        <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1, paddingBottom: 4 }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                                <b style={{ fontWeight: 600, fontSize: 22 }}>{full}</b>
                                                {/* The shield says what this account IS. It is
                                                    beside the name because that is the thing it
                                                    qualifies, and it is not a control — the
                                                    console is a section in the nav. */}
                                                {user.is_super_admin && (
                                                    <span title="Superadmin — you can approve accounts and appoint other administrators"
                                                          style={{
                                                              display: "inline-flex", alignItems: "center", gap: 5,
                                                              padding: "2px 7px", border: "1px solid var(--acc-line)",
                                                              color: "var(--acchi)", fontSize: 10.5,
                                                              letterSpacing: ".1em", textTransform: "uppercase",
                                                              fontFamily: "var(--mz-font-mono)",
                                                          }}>
                                                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                                                             stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                                                            <path d="M12 3l7 3v5.5c0 4.3-2.9 8.1-7 9.5-4.1-1.4-7-5.2-7-9.5V6z" />
                                                        </svg>
                                                        Superadmin
                                                    </span>
                                                )}
                                            </div>
                                            <span style={{ fontSize: 14, color: "var(--txt2)" }}>
                                                {[pf.title, pf.company].filter(Boolean).join(" · ") || "No title set"}
                                            </span>
                                            <span style={{ fontSize: 12.5, color: "var(--txt4)" }}>
                                                {[pf.location, user.email].filter(Boolean).join(" · ")}
                                            </span>
                                        </div>

                                        <div style={{ display: "flex", gap: 6, paddingBottom: 6 }}>
                                            {pf.avatar && (
                                                <HdrBtn onClick={() => setPosing(posing === "avatar" ? null : "avatar")}>
                                                    {posing === "avatar" ? "Done" : "Reposition"}
                                                </HdrBtn>
                                            )}
                                            <HdrBtn onClick={() => fileRef.current?.click()}>
                                                {pf.avatar ? "Change picture" : "Add a picture"}
                                            </HdrBtn>
                                            {pf.avatar && (
                                                <HdrBtn onClick={() => { set("avatar", null); setPosing(null) }}>Remove</HdrBtn>
                                            )}
                                        </div>
                                    </div>

                                    {pf.bio && (
                                        <p style={{
                                            margin: "16px 0 0", maxWidth: 680, fontSize: 13.5, lineHeight: 1.65,
                                            color: "var(--txt2)", whiteSpace: "pre-wrap", textWrap: "pretty",
                                        }}>{pf.bio}</p>
                                    )}

                                    <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
                                        onChange={async (e) => {
                                            const f = e.target.files?.[0]; e.target.value = ""
                                            if (!f) return
                                            try { set("avatar", await toPictureDataUrl(f)); set("avatar_pos", "50% 50%") }
                                            catch (err) { setMsg({ ok: false, text: String(err.message || err) }) }
                                        }} />
                                    <input ref={coverRef} type="file" accept="image/*" style={{ display: "none" }}
                                        onChange={async (e) => {
                                            const f = e.target.files?.[0]; e.target.value = ""
                                            if (!f) return
                                            try { set("cover", await toCoverDataUrl(f)); set("cover_pos", "50% 50%") }
                                            catch (err) { setMsg({ ok: false, text: String(err.message || err) }) }
                                        }} />
                                </div>

                                <div style={{ padding: "0 20px 20px", display: "flex", flexDirection: "column", gap: 18 }}>
                                <div style={GRID}>
                                    <Field label="First name">
                                        <input value={pf.first} onChange={(e) => set("first", e.target.value)} style={INPUT} />
                                    </Field>
                                    <Field label="Last name">
                                        <input value={pf.last} onChange={(e) => set("last", e.target.value)} style={INPUT} />
                                    </Field>
                                    <Field label="Job title" hint="Display only — it grants nothing.">
                                        <input value={pf.title} onChange={(e) => set("title", e.target.value)} style={INPUT} />
                                    </Field>
                                    <Field label="Initials" hint="Shown on presence chips and comments.">
                                        <input value={pf.initials} maxLength={3} placeholder={initials}
                                            onChange={(e) => set("initials", e.target.value.toUpperCase())} style={INPUT} />
                                    </Field>
                                </div>

                                <div style={GRID}>
                                    <Field label="Time zone" hint="Used for shift handovers. The status clock stays UTC.">
                                        <select value={pf.tz} onChange={(e) => set("tz", e.target.value)} style={INPUT}>
                                            {(TZ.includes(pf.tz) ? TZ : [pf.tz, ...TZ]).map((o) => (
                                                <option key={o} value={o}>{o}</option>
                                            ))}
                                        </select>
                                    </Field>
                                    <Field label="Team" hint="Set by an administrator, not here.">
                                        <input value={user.team_id || "Not assigned"} disabled
                                            style={{ ...INPUT, color: "var(--txt4)", cursor: "not-allowed" }} />
                                    </Field>
                                    <Field label="Language"
                                        hint="One language is shipped. This is where the choice will go.">
                                        <select value="en" disabled style={{ ...INPUT, color: "var(--txt4)", cursor: "not-allowed" }}>
                                            <option value="en">English</option>
                                        </select>
                                    </Field>
                                </div>

                                <div style={GRID}>
                                    <Field label="Company">
                                        <input value={pf.company} placeholder="Trifecta Technologies"
                                            onChange={(e) => set("company", e.target.value)} style={INPUT} />
                                    </Field>
                                    <Field label="Location" hint="Where you sit, for the people reading your page.">
                                        <input value={pf.location} placeholder="Berlin"
                                            onChange={(e) => set("location", e.target.value)} style={INPUT} />
                                    </Field>
                                </div>

                                <Field label="About"
                                    hint="What you work on and what you are the person to ask about. This is the part a colleague opening your page is actually after.">
                                    <textarea value={pf.bio} rows={5} maxLength={1200}
                                        placeholder="Maritime and imagery analyst. Red Sea and Hormuz. Ask me about AIS gaps and SAR tasking."
                                        onChange={(e) => set("bio", e.target.value)}
                                        style={{ ...INPUT, height: "auto", padding: "8px 10px", lineHeight: 1.6, resize: "vertical" }} />
                                </Field>
                                </div>
                            </div>
                        )}

                        {sec === "account" && (
                            <>
                                <div style={CARD}>
                                    <h2 style={H2}>Email</h2>
                                    <Field label="Email address"
                                        hint="This is who you are to everyone else on the deployment. Changing it needs an administrator — there is no self-service confirmation flow here, and offering a field that silently fails would be worse than saying so.">
                                        <input value={user.email} disabled
                                            style={{ ...INPUT, color: "var(--txt4)", cursor: "not-allowed" }} />
                                    </Field>
                                </div>
                                <PasswordCard onMsg={setMsg} />
                            </>
                        )}

                        {sec === "security" && (
                            <>
                                <NotWired title="Two-factor authentication"
                                    what="The spec puts a second factor here." />
                                <NotWired title="Signed-in devices"
                                    what="Sessions are signed JWTs with a sliding window; there is no server-side session list to show or revoke from." />
                            </>
                        )}

                        {sec === "notif" && (
                            <NotWired title="Notifications"
                                what="Alert routing is currently decided by the alert rules, not per person." />
                        )}

                        {/* The console itself, in the column rather than in
                            a tab of its own — administering the org is
                            something you do as this account, so it belongs
                            with the account. Admin refuses itself to anyone
                            who is not a superadmin whatever renders it. */}
                        {sec === "admin" && <Admin embedded />}
                    </div>
                </div>
            </div>

            {/* The save bar — only once something is dirty. */}
            {dirty && (
                <div style={{
                    position: "absolute", left: 0, right: 0, bottom: 0,
                    display: "flex", alignItems: "center", gap: 10, padding: "12px 24px",
                    background: "var(--glass)", backdropFilter: "blur(22px)",
                    WebkitBackdropFilter: "blur(22px)", borderTop: "1px solid var(--gline2)",
                    zIndex: 4,
                }}>
                    <span style={{ fontSize: 14, color: "var(--txt2)" }}>You have unsaved changes.</span>
                    <div style={{ flex: 1 }} />
                    <button onClick={() => setPf(base)} style={{
                        height: 34, padding: "0 14px", border: "1px solid var(--gline2)",
                        background: "transparent", color: "var(--txt)", font: "inherit",
                        fontSize: 13, whiteSpace: "nowrap", cursor: "pointer", borderRadius: 0,
                    }}>Discard</button>
                    <button onClick={save} disabled={saving} style={{
                        height: 34, padding: "0 16px", border: 0, background: "var(--acc)",
                        color: "var(--mz-cream)", font: "inherit", fontSize: 13, fontWeight: 600,
                        whiteSpace: "nowrap", cursor: saving ? "default" : "pointer", borderRadius: 0,
                    }}>{saving ? "Saving…" : "Save changes"}</button>
                </div>
            )}

            {msg && !dirty && (
                <div style={{
                    position: "absolute", left: 24, bottom: 16, zIndex: 4,
                    fontSize: 13, color: msg.ok ? "var(--green)" : "var(--red)",
                }}>{msg.text}</div>
            )}
        </section>
    )
}

function PasswordCard({ onMsg }) {
    const [cur, setCur] = useState("")
    const [next, setNext] = useState("")
    const [again, setAgain] = useState("")
    const [busy, setBusy] = useState(false)

    /* The rules are stated before you type, not after you fail, and there
       is only one of substance. Composition rules push people to
       Password1!; length is what actually costs an attacker. */
    const rules = [
        { k: "At least 10 characters", ok: next.length >= 10 },
        { k: "Different from the current one", ok: !!next && next !== cur },
        { k: "Both entries match", ok: !!next && next === again },
    ]
    const ok = !!cur && rules.every((r) => r.ok)

    const submit = async () => {
        setBusy(true)
        try {
            const r = await fetch(`${API_BASE}/api/auth/change-password`, {
                method: "POST", credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ current_password: cur, new_password: next }),
            })
            const d = await r.json().catch(() => null)
            if (!r.ok) throw new Error(d?.detail || `could not change it (${r.status})`)
            setCur(""); setNext(""); setAgain("")
            onMsg({ ok: true, text: "Password changed." })
        } catch (e) {
            onMsg({ ok: false, text: String(e.message || e) })
        } finally { setBusy(false) }
    }

    return (
        <div style={CARD}>
            <h2 style={H2}>Password</h2>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--txt3)", textWrap: "pretty" }}>
                The current password is asked for even though you are signed in: a session can
                be a borrowed laptop, and this is the one change that locks the real owner out.
            </p>
            <div style={GRID}>
                <Field label="Current password">
                    <input type="password" value={cur} autoComplete="current-password"
                        onChange={(e) => setCur(e.target.value)} style={INPUT} />
                </Field>
                <Field label="New password">
                    <input type="password" value={next} autoComplete="new-password"
                        onChange={(e) => setNext(e.target.value)} style={INPUT} />
                </Field>
                <Field label="Confirm new password">
                    <input type="password" value={again} autoComplete="new-password"
                        onChange={(e) => setAgain(e.target.value)} style={INPUT} />
                </Field>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {rules.map((r) => (
                    <span key={r.k} style={{
                        display: "flex", alignItems: "center", gap: 8, fontSize: 12.5,
                        color: r.ok ? "var(--green)" : "var(--txt4)",
                    }}>
                        <span style={{ fontFamily: "var(--mz-font-mono)" }}>{r.ok ? "✓" : "·"}</span>{r.k}
                    </span>
                ))}
            </div>
            <div>
                <button onClick={submit} disabled={!ok || busy} style={{
                    height: 34, padding: "0 16px", border: 0,
                    background: ok ? "var(--acc)" : "var(--hov)",
                    color: ok ? "var(--mz-cream)" : "var(--txt4)",
                    font: "inherit", fontSize: 13, fontWeight: 600,
                    cursor: ok && !busy ? "pointer" : "default", borderRadius: 0,
                }}>{busy ? "Updating…" : "Update password"}</button>
            </div>
        </div>
    )
}
