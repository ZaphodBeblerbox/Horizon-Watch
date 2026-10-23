/**
 * WritePostButton.jsx — "Write a post" on a signal's card: the desktop
 * Inspector (registered as an inspector extension, so the card itself is
 * untouched) and the phone's sheet (MPeek's actions row). It opens the chat
 * with the item and its draft. It also remembers the open item, so typing
 * "write a post about this" in the chat works while the card is open.
 */
import { useEffect } from "react"
import { writePostAbout } from "./assistantStore.js"
import { postItemFrom, setOpenItem } from "./postDraft.js"

export default function WritePostButton({ item, record, className = "", phone = false }) {
    const it = item || record
    const ok = !!postItemFrom(it)?.title
    useEffect(() => {
        if (!ok) return undefined
        setOpenItem(it)
        return () => setOpenItem(null)
    }, [it, ok])
    if (!ok) return null
    return (
        <button className={className || (phone ? "m2-btn ghost" : "btn sm")} data-testid="write-post"
                style={phone ? undefined : { marginTop: 10 }}
                onClick={(e) => { e.stopPropagation(); writePostAbout(it) }}>
            Write a post
        </button>
    )
}

/** The Inspector extension: shown only on an item that has a title. */
export function WritePostExtension({ record }) {
    return record ? <WritePostButton record={record} /> : null
}
