/**
 * Avatar.jsx — the signed-in user's face, wherever it appears.
 *
 * There were two of these drawn by hand — the rail's account button and
 * Home's header — and neither read the picture, so uploading one in
 * Settings changed nothing anywhere. The rail's was worse: app.jsx never
 * passed it initials either, so it showed the literal default "GU" to
 * every user.
 *
 * It subscribes to the auth store itself rather than taking props. A
 * picture that has to be threaded through four components is a picture
 * that will be missing from the fifth. A caller that is drawing SOMEBODY
 * ELSE — the roster, a chat message — passes `user` and gets that person
 * instead.
 */
import { useEffect, useState } from "react"
import { getCurrentUser, subscribeAuth } from "../state/authStore.js"

/** Deterministic initials, from whatever the account actually has. */
export function initialsFor(user) {
    if (!user) return "?"
    if (user.initials) return String(user.initials).slice(0, 3).toUpperCase()
    const name = (user.display_name || user.name || "").trim()
    if (name) {
        const parts = name.split(/\s+/)
        return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || name[0].toUpperCase()
    }
    const email = user.email || ""
    return (email[0] || "?").toUpperCase()
}

/**
 * @param user  whose face to draw. Omitted, it is the signed-in user and
 *              it follows them — which is the common case and why this
 *              subscribes rather than taking props. The roster and the
 *              chat draw OTHER people, so they pass one.
 */
export default function Avatar({ size = 28, style = null, title = null, user: given = null }) {
    const [me, setMe] = useState(() => getCurrentUser())
    useEffect(() => subscribeAuth(setMe), [])
    const user = given || me

    const initials = initialsFor(user)
    const box = {
        position: "relative", width: size, height: size, flex: "none",
        borderRadius: "50%", overflow: "hidden",
        border: "1px solid var(--gline2)", background: "var(--hov)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "var(--mz-font-body)",
        // Initials have to scale with the circle or a 96px avatar shows
        // 12px letters floating in the middle of it.
        fontSize: Math.max(10, Math.round(size * 0.38)),
        color: "var(--txt2)", ...style,
    }

    return (
        <span style={box} title={title || user?.name || user?.email || "Account"}>
            {user?.avatar
                /* Pinned, not height:100%: this box centres its content, and
                   a percentage height against a centred item does not
                   resolve — a portrait then keeps its own aspect and spills
                   out of the circle. */
                ? <img src={user.avatar} alt="" style={{
                    position: "absolute", inset: 0,
                    width: "100%", height: "100%", objectFit: "cover", display: "block",
                    objectPosition: user.avatar_pos || "50% 50%",
                  }} />
                : initials}
        </span>
    )
}
