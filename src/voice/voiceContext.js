/**
 * voiceContext.js — what is on screen, in the shape the parser wants.
 *
 * WHAT PARALLAX ACTUALLY HAS, which decides what a command can mean:
 *
 *  - ONE BASKET, NOT SEVERAL. state/briefingBasket.js is a single Map with
 *    no basket identity — there is no "Thursday Brief" to add to. So the
 *    basket list is one entry, and "add this to Thursday" resolves to it
 *    rather than failing. If named baskets land later, this is the only
 *    file that has to learn about them.
 *  - Signal types are the map's own layer groups (maritime / air / news /
 *    imagery / zones), with spoken aliases, so "show ships" means
 *    something.
 *  - Colleagues come from the real roster, GET /api/users. A recipient is
 *    only ever someone in it — never a name the parser heard and guessed
 *    an address for.
 */
import API_BASE from "../apiBase.js"
import { getCurrentUser } from "../state/authStore.js"
import { getCursor } from "../globe/mapReadout.js"

/** The single basket this app has. */
export const DEFAULT_BASKET = {
    id: "briefing",
    name: "briefing basket",
    aliases: ["basket", "briefing", "brief", "thursday", "daily", "the basket"],
}

/** The map's layer groups, as things you can say. */
export const SIGNAL_TYPES = [
    { id: "maritime", name: "Maritime", aliases: ["ships", "vessels", "naval", "sea", "shipping"] },
    { id: "air", name: "Air", aliases: ["aircraft", "planes", "flights", "aviation"] },
    { id: "news", name: "News", aliases: ["events", "reports", "open source", "osint"] },
    { id: "imagery", name: "Imagery", aliases: ["satellite", "sat", "detections", "overwatch"] },
    { id: "zones", name: "Zones", aliases: ["areas", "eez", "watch areas"] },
]

let _users = []
let _usersAt = 0
const USERS_TTL = 5 * 60_000

/** The roster, cached — a dictation must not wait on a round trip. */
export async function primeUsers() {
    if (Date.now() - _usersAt < USERS_TTL && _users.length) return _users
    try {
        const r = await fetch(`${API_BASE}/api/users`, { credentials: "include" })
        const rows = r.ok ? await r.json() : []
        _users = (Array.isArray(rows) ? rows : []).map((u) => {
            const name = u.name || u.email || u.id
            const first = String(name).trim().split(/\s+/)[0]
            // The first name as an alias: nobody dictates a full name.
            // The email tags along so an ambiguity can be ASKED. Two
            // accounts really can share a display name, and "Which one:
            // Hannes Kohnen / Hannes Kohnen?" is a question nobody can answer.
            return {
                id: u.id, name, hint: u.email && u.email !== name ? u.email : null,
                aliases: first && first !== name ? [first] : [],
            }
        })
        _usersAt = Date.now()
    } catch { /* offline — an empty roster makes `send` ask, which is right */ }
    return _users
}

let _groups = []
let _groupsAt = 0

/**
 * The group chats this person is in, cached beside the roster.
 *
 * "Send hi to Trifecta" has to reach the group called Trifecta, and a
 * group is not on the roster — so without this the parser can only ever
 * address one person at a time, which is half of what a chat is for.
 */
export async function primeGroups() {
    if (Date.now() - _groupsAt < USERS_TTL && _groups.length) return _groups
    try {
        const r = await fetch(`${API_BASE}/api/chat/conversations`, { credentials: "include" })
        const rows = r.ok ? await r.json() : []
        _groups = (Array.isArray(rows) ? rows : [])
            .filter((c) => c.kind === "group" && c.title)
            // Same reason as the roster's email: two groups can share a
            // title, and "Which one: Trifecta / Trifecta?" cannot be
            // answered. Who is in it is what tells them apart.
            .map((c) => ({
                id: c.id, name: c.title, aliases: [],
                hint: (c.members || []).map((m) => (m.name || "").split(" ")[0])
                    .filter(Boolean).slice(0, 3).join(", ") || `${c.member_count} people`,
            }))
        _groupsAt = Date.now()
    } catch { /* offline — no groups is the same as having none */ }
    return _groups
}

/** Whatever the map last told us was selected or hovered. */
let _selected = null
export function setVoiceSelection(sel) { _selected = sel || null }
export function getVoiceSelection() { return _selected }

/** The last briefing generated or opened this session. */
let _briefing = null
export function setVoiceBriefing(id) { _briefing = id || null }

/** The page the console has open (app.jsx tells us), so "zoom in" on
 *  Home can be read as "on the map". */
let _page = null
export function setVoicePage(p) { _page = p || null }

export function buildVoiceContext() {
    const cur = getCursor?.() || null
    return {
        selectedId: _selected?.id || undefined,
        cursor: cur && Number.isFinite(cur.lat) ? { lat: cur.lat, lng: cur.lon ?? cur.lng } : undefined,
        activeBasketId: DEFAULT_BASKET.id,
        page: _page || undefined,
        currentBriefingId: _briefing || undefined,
        baskets: [DEFAULT_BASKET],
        users: _users,
        groups: _groups,
        signalTypes: SIGNAL_TYPES,
        // Carried for the dispatcher, ignored by the parser.
        _selection: _selected,
        _me: getCurrentUser(),
    }
}
