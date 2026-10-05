/**
 * PersonCard.jsx — somebody's page, as a sheet over whatever you were doing.
 *
 * Opened from a chat: tap a name or a picture and you get the person, not
 * a tooltip with their email in it. The same fields their own profile page
 * shows — banner, picture, name, title, company, where they are, and what
 * they actually work on — because a colleague's page has one purpose and
 * it should not look different depending on which screen you reached it
 * from.
 *
 * It reads from whatever the caller already has. Chat messages carry their
 * sender's display fields for exactly this reason; opening a card must not
 * be a round trip.
 */
import { useEffect } from "react"

const EYE = {
    font: "500 10px var(--mono)", letterSpacing: ".14em",
    textTransform: "uppercase", color: "var(--txt-3)",
}

export default function PersonCard({ person, onClose, onMessage = null, isMe = false }) {
    useEffect(() => {
        const k = (e) => { if (e.key === "Escape") onClose() }
        window.addEventListener("keydown", k)
        return () => window.removeEventListener("keydown", k)
    }, [onClose])

    if (!person) return null
    const line = [person.title, person.company].filter(Boolean).join(" · ")

    return (
        <div
            onClick={onClose}
            style={{
                position: "fixed", inset: 0, zIndex: 9000, display: "grid", placeItems: "center",
                background: "rgba(10,14,31,.5)", padding: 20,
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                data-testid="person-card"
                style={{
                    width: 420, maxWidth: "100%", maxHeight: "100%", overflow: "auto",
                    background: "var(--glass)", backdropFilter: "blur(22px) saturate(1.15)",
                    WebkitBackdropFilter: "blur(22px) saturate(1.15)",
                    border: "1px solid var(--gline2)", boxShadow: "var(--gshadow)",
                }}
            >
                <div style={{
                    position: "relative", height: 132,
                    background: person.cover ? "var(--hov)" : "linear-gradient(120deg, var(--acc) 0%, var(--bg-2) 100%)",
                    borderBottom: "1px solid var(--gline)",
                }}>
                    {person.cover && (
                        <img src={person.cover} alt="" style={{
                            width: "100%", height: "100%", objectFit: "cover",
                            objectPosition: person.cover_pos || "50% 50%", display: "block",
                        }} />
                    )}
                    <button onClick={onClose} aria-label="Close" style={{
                        position: "absolute", right: 8, top: 8, width: 26, height: 26,
                        border: "1px solid var(--gline2)", background: "var(--glass)",
                        color: "var(--txt-2)", font: "inherit", cursor: "pointer", borderRadius: 0,
                    }}>✕</button>
                </div>

                <div style={{ padding: "0 18px 18px", marginTop: -34 }}>
                    <Face person={person} size={76} ring />
                    <div style={{ marginTop: 10 }}>
                        <b style={{ font: "600 17px var(--font)", color: "var(--txt)" }}>
                            {person.name || person.email}
                        </b>
                        {isMe && <span style={{ marginLeft: 7, font: "400 11px var(--mono)", color: "var(--txt-3)" }}>you</span>}
                    </div>
                    {line && <div style={{ font: "400 13px var(--font)", color: "var(--txt-2)", marginTop: 2 }}>{line}</div>}
                    <div style={{ font: "400 11.5px var(--mono)", color: "var(--txt-3)", marginTop: 3 }}>
                        {[person.location, person.email].filter(Boolean).join(" · ")}
                    </div>

                    {person.bio
                        ? <p style={{
                            margin: "14px 0 0", font: "400 13px/1.65 var(--font)", color: "var(--txt-2)",
                            whiteSpace: "pre-wrap", textWrap: "pretty",
                          }}>{person.bio}</p>
                        : <p style={{ margin: "14px 0 0", font: "400 12.5px var(--font)", color: "var(--txt-3)" }}>
                            {(person.name || "They").split(" ")[0]} has not written anything about themselves yet.
                          </p>}

                    {onMessage && !isMe && (
                        <button onClick={() => onMessage(person)} style={{
                            marginTop: 16, height: 30, padding: "0 14px",
                            border: "1px solid var(--acc-line)", background: "var(--acc-dim)",
                            color: "var(--txt)", font: "600 12px var(--font)",
                            cursor: "pointer", borderRadius: 0,
                        }}>Message {(person.name || "").split(" ")[0] || "them"}</button>
                    )}
                </div>
            </div>
        </div>
    )
}

/**
 * Somebody's picture, at any size.
 *
 * It honours avatar_pos, so a face the circle landed badly on looks the
 * same here as it does on their own page — a second crop rule would make
 * the two disagree.
 */
export function Face({ person, size = 32, ring = false, onClick = null, title = null }) {
    const style = {
        position: "relative",
        width: size, height: size, flex: "none", borderRadius: "50%", overflow: "hidden",
        background: person?.color ? `${person.color}22` : "var(--hov)",
        border: ring ? "3px solid var(--bg-1)" : "1px solid var(--gline2)",
        display: "grid", placeItems: "center",
        font: `500 ${Math.max(9, Math.round(size * 0.38))}px var(--font)`,
        color: "var(--txt-2)", cursor: onClick ? "pointer" : "default",
        boxShadow: ring ? "var(--gshadow)" : undefined,
    }
    return (
        <div style={style} onClick={onClick} title={title || person?.name || ""}>
            {person?.avatar
                /* ABSOLUTE, NOT height:100%. The circle centres its content
                   with place-items, which stops a percentage height
                   resolving — so a 200x400 portrait came out 70x140 inside
                   a 76px circle, spilling over the top and the bottom.
                   Pinning it to the box makes object-fit do the cropping,
                   which is the whole point of having a focal point. */
                ? <img src={person.avatar} alt="" draggable={false} style={{
                    position: "absolute", inset: 0,
                    width: "100%", height: "100%", objectFit: "cover",
                    objectPosition: person.avatar_pos || "50% 50%", display: "block",
                  }} />
                : (person?.initials || (person?.name || "?")[0] || "?").toUpperCase()}
        </div>
    )
}

export { EYE as CARD_EYE }
