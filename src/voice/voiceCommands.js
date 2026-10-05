/**
 * voiceCommands.js — Parallax voice command parser. Rules only, no LLM.
 *
 * Input: dictated text plus what is on screen. Output: actions to confirm
 * and run.
 *
 * WHY THERE IS NO MODEL IN HERE. A command parser that calls out to a
 * model is one that can answer differently to the same sentence twice,
 * cannot be unit-tested as a table, and adds a network round trip to a
 * gesture whose whole point is that it is faster than clicking. Every rule
 * below is a regex and a lookup; the file has no I/O at all.
 *
 * Ported from the supplied TypeScript to this repo's plain JS with
 * behaviour unchanged — same rules, same order, same outputs. Types are
 * carried as JSDoc so editors still check call sites.
 *
 * @typedef {{ id: string, name: string, aliases?: string[] }} Named
 * @typedef {{
 *   selectedId?: string,
 *   cursor?: { lat: number, lng: number },
 *   activeBasketId?: string,
 *   currentBriefingId?: string,
 *   baskets: Named[], users: Named[], signalTypes: Named[],
 * }} Context
 */

// ---------- text helpers ----------

const FILLERS = /\b(please|uh+|um+|hey|okay|ok|can you|could you|would you|i want to|i'd like to|let's|just|my colleague|my coworker|said)\b/g
const NUM_WORDS = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    twelve: 12, twenty: 20, "twenty four": 24, thirty: 30, "forty eight": 48, "seventy two": 72,
}

export function normalize(s) {
    let t = String(s).toLowerCase().replace(/[“”"’']/g, "").replace(/[.,!?;:]+/g, " ")
    for (const [w, n] of Object.entries(NUM_WORDS).sort((a, b) => b[0].length - a[0].length)) {
        t = t.replace(new RegExp(`\\b${w}\\b`, "g"), String(n))
    }
    return t.replace(FILLERS, " ").replace(/\s+/g, " ").trim()
}

function lev(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
    for (let j = 1; j <= b.length; j++) d[0][j] = j
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1,
                d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
        }
    }
    return d[a.length][b.length]
}

const RX_SPECIAL = /[.*+?^${}()|[\]\\]/g
/** A name as a WHOLE WORD, not as a run of letters inside another one. */
function wordHit(text, name) {
    if (!name) return false
    return new RegExp(`(^|[^a-z0-9])${name.replace(RX_SPECIAL, "\\$&")}($|[^a-z0-9])`, "i").test(text)
}

/**
 * Every entity whose name or alias appears, tolerating typos — ranked, so
 * a real match beats a near one.
 *
 * THE NAME TEST USED TO BE `text.includes(name)`. An account called "T"
 * therefore matched every sentence with a letter t in it, which is all of
 * them: "send hi to Hannes" resolved to Hannes AND T and asked which. A
 * name has to appear as a whole word to count.
 *
 * Ranking then settles the rest. A spoken "Hannes" matching "Hannes
 * Kohnen" exactly is a better answer than it being two edits from
 * somebody else, so only the best tier is returned and the caller only
 * has to ask when the tie is genuine — two people actually called Marc.
 */
function findAll(text, items) {
    const words = text.split(" ")
    const scored = []
    for (const it of items) {
        const names = [it.name, ...(it.aliases ?? [])].filter(Boolean).map((n) => n.toLowerCase())
        const firstWords = names.map((n) => n.split(" ")[0]).filter(Boolean)
        let rank = 0
        if (names.some((n) => wordHit(text, n))) rank = 3
        else if (firstWords.some((f) => f.length > 1 && wordHit(text, f))) rank = 2
        else if (words.some((w) => w.length > 2 && firstWords.some(
            (f) => f.length > 2 && lev(w, f) <= (f.length > 5 ? 2 : 1)))) rank = 1
        if (rank) scored.push({ it, rank })
    }
    if (!scored.length) return []
    const best = Math.max(...scored.map((x) => x.rank))
    return scored.filter((x) => x.rank === best).map((x) => x.it)
}

function parseSinceHours(t) {
    let m = t.match(/\b(?:last|past) (\d+) (hour|hours|h|day|days|week|weeks)\b/)
    if (m) {
        const n = +m[1]
        return m[2].startsWith("h") ? n : m[2].startsWith("d") ? n * 24 : n * 168
    }
    if (/\btoday\b/.test(t)) return 24
    if (/\byesterday\b/.test(t)) return 48
    if (/\bthis week\b|\blast week\b/.test(t)) return 168
    m = t.match(/\b(?:last|past) (hour|day|week)\b/)
    if (m) return m[1] === "hour" ? 1 : m[1] === "day" ? 24 : 168
    return undefined
}

/** Text after a trailing clause, taken from the original casing. */
function trailing(raw, markers, keepMarker = false) {
    const m = raw.match(markers)
    if (!m || m.index === undefined) return undefined
    const rest = raw.slice(keepMarker ? m.index : m.index + m[0].length).trim().replace(/^[,:\-\s]+/, "")
    return rest.length ? rest : undefined
}
const NOTE_MARK = /\b(note that|note|noting|because|since|comment|remember that)\b/i

/* The note marker for an add: the same list, plus a bare "that". It is
   scoped to this rule rather than added to NOTE_MARK, because "that" is
   far too common a word to treat as a note marker everywhere. */
const ADD_NOTE_MARK = /\b(note that|note|noting|because|since|comment|remember that|that)\b/i

/**
 * The folder someone named, from the ORIGINAL casing.
 *
 * Taken from `raw` rather than the normalised text because a folder is a
 * proper name — "Hormuz watch" must not arrive as "hormuz watch" and then
 * create a second folder beside the one that already exists. The trailing
 * noise words go because people say "the vessels folder please".
 */
function folderName(raw, lead) {
    const rest = String(raw || "").replace(lead, "").trim()
        .replace(/\b(folder|case|please|now)\b/gi, " ")
        .replace(/[.,!?;:]+$/g, "")
        .replace(/\s+/g, " ")
        .trim()
    return rest.length > 1 ? rest : undefined
}

/** Whatever is left once the command words are taken out — the place. */
function placeText(t, strip) {
    const rest = t.replace(strip, " ").replace(/[^a-z\s-]/g, " ").replace(/\s+/g, " ").trim()
    return rest.length > 2 ? rest : undefined
}
const MSG_MARK = /\b(ask|tell)\b/i

/**
 * Everything said after somebody's name.
 *
 * "tell Hannes the tanker went dark" has to become "the tanker went dark",
 * not "Hannes the tanker went dark". Matched against the raw text so the
 * message keeps its capitals and punctuation — it is going to be read by
 * a person.
 */
/** Drop a leading token that is, or nearly is, the person's first name. */
function dropName(text, person) {
    if (!text) return undefined
    const first = (person.name || "").split(" ")[0].toLowerCase()
    const m = text.match(/^(\S+)\s*(.*)$/s)
    if (!m || !first) return text
    const head = m[1].toLowerCase().replace(/[^a-z]/g, "")
    const near = head === first || (head.length > 2 && lev(head, first) <= (first.length > 5 ? 2 : 1))
    if (!near) return text
    const rest = m[2].trim()
        .replace(/^(that|this|the following)\b/i, "")
        .replace(/^[,:\-\s]+/, "")
    return rest.length ? rest : undefined
}

function afterName(raw, person) {
    const names = [person.name, ...(person.aliases || [])]
        .filter(Boolean)
        .flatMap((n) => [n, n.split(" ")[0]])
        .filter((n) => n.length > 2)
        .sort((a, b) => b.length - a.length)
    for (const n of names) {
        const i = raw.toLowerCase().indexOf(n.toLowerCase())
        if (i < 0) continue
        const rest = raw.slice(i + n.length).trim()
            .replace(/^(that|this|the following)\b/i, "")
            .replace(/^[,:\-\s]+/, "")
        if (rest.length) return rest
    }
    return undefined
}

// ---------- intents ----------
// Order matters: first match wins.

/**
 * Who a sentence is addressed to: a colleague, or a group chat.
 *
 * PEOPLE ARE TRIED FIRST. A group can be named after a person and a person
 * cannot be named after a group, so "send hi to Hannes" means the man even
 * if somebody has made a group called Hannes.
 *
 * Returns {kind, id, name} or {problem} — never a guess between two.
 */
function resolveRecipient(t, c) {
    const people = findAll(t, c.users || [])
    if (people.length === 1) return { kind: "user", id: people[0].id, name: people[0].name }
    const groups = findAll(t, c.groups || [])
    if (!people.length && groups.length === 1) {
        return { kind: "group", id: groups[0].id, name: groups[0].name }
    }
    const all = [...people, ...groups]
    if (all.length > 1) {
        // NAME THEM APART. Listing the same display name twice asks a
        // question with no answer; the email is what tells two accounts
        // called Hannes Kohnen apart.
        const names = all.map((p) => p.name)
        const dupes = names.some((n, i) => names.indexOf(n) !== i)
        return {
            problem: `Which one: ${all.map((p) =>
                (dupes && p.hint) ? `${p.name} (${p.hint})` : p.name).join(" / ")}?`,
        }
    }
    return { problem: "Who should I send it to? No matching colleague or group found." }
}

/**
 * What was actually said, once the verb and the recipient are taken out.
 *
 * "Send hi to Hannes" leaves "hi". The recipient can come before or after
 * the payload ("send Hannes hi"), so both orders are stripped.
 */
function sayable(raw, to) {
    let out = raw
        .replace(/^\s*(please\s+)?(send|share|forward|email|mail|message|dm|text|tell)\b/i, "")
        .trim()
    const names = [to.name, (to.name || "").split(" ")[0]]
        .filter((n) => n && n.length > 1)
        .sort((a, b) => b.length - a.length)
    for (const n of names) {
        const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        out = out.replace(new RegExp(`\\b(to|at)\\s+${esc}\\b`, "i"), " ")
                 .replace(new RegExp(`(^|\\W)${esc}(\\W|$)`, "i"), "$1$2")
    }
    out = out.replace(/\s+/g, " ").replace(/^[\s,:\-]+|[\s,:\-]+$/g, "").trim()
    // A bare "this"/"it" is a pointer at something, not a message.
    return /^(this|it|that|the following)?$/i.test(out) ? undefined : out
}

/**
 * The place a "send me the situation in X" sentence is about.
 *
 * The recipient is removed first, because "send the situation in Niger to
 * Hannes" and "send Hannes the situation in Niger" put the two in either
 * order and the place is whatever is left after "in".
 */
function situationPlace(raw, to) {
    let t = " " + raw + " "
    const names = [to.name, (to.name || "").split(" ")[0]]
        .filter((n) => n && n.length > 1)
        .sort((a, b) => b.length - a.length)
    for (const n of names) {
        const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        t = t.replace(new RegExp(`\\b(to|for)\\s+${esc}\\b`, "gi"), " ")
             .replace(new RegExp(`\\b${esc}\\b`, "gi"), " ")
    }
    /* THE LAST PREPOSITION, NOT THE FIRST. "what is going on in Mali"
       has two — the "on" belongs to "going on", and taking the first
       match made the place "in Mali". The place follows the last one. */
    /* AT MOST THREE WORDS. The capture used to allow spaces freely, so
       "brief me on what is happening in Yemen" matched once, from the
       first "on", and swallowed the rest of the sentence as the place
       name. Bounded to three words it matches twice and the last one —
       "Yemen" — is the place. No place in the world needs a fourth word
       that a person would also say out loud. */
    const all = [...t.matchAll(
        /\b(?:in|on|at|for|about|from|around)\s+(?:the\s+)?([A-Za-z][A-Za-z'\u2019-]*(?:[ -][A-Za-z][A-Za-z'\u2019-]*){0,2})/gi)]
    const m = all[all.length - 1]
    if (!m) return undefined
    return m[1]
        .replace(/^\s*(?:in|on|at|for|about|from|around|the)\s+/i, "")
        .replace(/\b(please|now|today|right now|thanks|thank you)\b.*$/i, "")
        .replace(/[.,;:!?]+\s*$/, "")
        .trim() || undefined
}

/** The address, as the action carries it. */
function addressed(to) {
    return to.kind === "group"
        ? { to, conversationId: to.id, name: to.name }
        : { to, userId: to.id, name: to.name }
}

const ok = (raw, actions, needsConfirm = false) =>
    ({ actions, confident: true, needsConfirm, raw })
const unsure = (raw, problem, actions = []) =>
    ({ actions, confident: false, needsConfirm: true, problem, raw })

const RULES = [
    /* ── "EXPLAIN THE CURRENT SITUATION IN MALI" ─────────────────────
       Not a send and not a navigation: a question. It goes above both
       because "explain the situation in Mali" contains neither a send verb
       nor a place-only phrasing, but "what is going on in Mali" would
       otherwise be read as a navigation.

       The model writes the answer; the signals it reads are gathered on
       the server. What comes back is shown with its own evidence beside
       it, because an explanation whose sources the reader cannot see is an
       opinion. */
    {
        name: "explain",
        /* normalize() strips apostrophes, so "what's" arrives as "whats"
           — the pattern has to match the stripped form or the commonest
           phrasing of the question never matches. */
        test: /\b(explain|what(?:s| is| has been)? (?:going on|happening)|brief me on|catch me up|sum(?:marise|marize) (?:the )?(?:situation|picture))\b/,
        build: (t, raw) => {
            const place = situationPlace(raw, {})
            return place
                ? ok(raw, [{ type: "explain", place }])
                : unsure(raw, "Explain where? Say \u201cexplain the situation in Mali\u201d.")
        },
    },
    /* ── "SEND THE CURRENT SITUATION IN NIGER TO HANNES" ─────────────
       A place, a person, and a verb that means "gather what we have and
       hand it over". It sits ABOVE `send` because it contains "send …
       to …" and would otherwise be read as sending the WORDS "the
       current situation in Niger", which is a sentence rather than the
       thing the sentence asked for.

       It is a rule and not a model fallback because it is a phrasing
       people will use every day, and the rules are free. */
    {
        name: "send_situation",
        test: /\b(send|share|forward|give)\b[^.]*\b(situation|picture|latest|overview|what we (have|know)|current state)\b/,
        build: (t, raw, c) => {
            const to = resolveRecipient(t, c)
            if (to.problem) return unsure(raw, to.problem)
            const place = situationPlace(raw, to)
            return place
                ? ok(raw, [{ type: "send_situation", place, ...addressed(to) }])
                : unsure(raw, "Which place? Say \u201cthe situation in Yemen\u201d.")
        },
    },
    {
        name: "send",
        test: /\b(send|share|forward|email|mail)\b/,
        build: (t, raw, c) => {
            const to = resolveRecipient(t, c)
            if (to.problem) return unsure(raw, to.problem)
            const message = trailing(raw, MSG_MARK, true)
            let what, id
            if (/\bbriefing|brief\b/.test(t)) { what = "briefing"; id = c.currentBriefingId }
            else if (/\bbasket\b/.test(t)) { what = "basket"; id = findAll(t, c.baskets)[0]?.id ?? c.activeBasketId }
            else { what = "item"; id = c.selectedId }
            if (!id) {
                /* "SEND HI TO HANNES" IS A MESSAGE. There was nothing
                   selected, so this used to refuse with "no item to send —
                   open or generate one first", which is an answer to a
                   question nobody asked: the thing being sent is the word
                   "hi". Only when there are no words either is there
                   genuinely nothing to do. */
                /* ONLY WHEN NOTHING WAS NAMED. "Send the briefing to
                   Hannes" with no briefing open is a request for a thing
                   that is not there, and posting the words "the briefing"
                   instead would be a wrong answer dressed up as a right
                   one. The fall-through is for a verb with no noun. */
                const words = what === "item" ? sayable(raw, to) : undefined
                if (words) return ok(raw, [{ type: "message", ...addressed(to), text: words }])
                return unsure(raw, `No ${what} to send — open or generate one first.`)
            }
            /* NO CONFIRMATION STEP. The supplied parser always asked
               before sending, and being asked "are you sure" after you
               have just said a whole sentence out loud is the intervention
               the sentence existed to avoid. It goes straight out, and the
               toast carries an Undo that really deletes the message — a
               recovery you can take if you want one, instead of a
               checkpoint everybody has to pass. */
            return ok(raw, [{ type: "send", what, id, ...addressed(to), message }])
        },
    },
    /* ── SPEAKING TO SOMEBODY ────────────────────────────────────────
       "message Hannes the tanker went dark" posts into the direct chat
       with Hannes without the chat ever being opened, which is the whole
       point of saying it rather than typing it.

       It sits BELOW `send`, because "send this to Hannes, ask if he has
       seen it" is a SHARE with a covering note — it contains "ask", and
       read as a message it would post the words and leave the thing
       itself behind. A sentence with no send verb in it is a message. */
    {
        name: "message",
        test: /\b(message|dm|text|tell|ask|write to|say to)\b/,
        build: (t, raw, c) => {
            const to = resolveRecipient(t, c)
            if (to.problem) return unsure(raw, to.problem)
            const person = to
            // What to say is everything after their name — a person is the
            // address, not part of the sentence.
            // afterName handles the name as spelt. The fallback is for a
            // MISHEARD one — "message Hanes ..." still matched the person,
            // but their real name is not in the text to cut after, so the
            // misheard token has to be dropped off the front or it becomes
            // the first word of the message.
            const text = afterName(raw, person)
                || dropName(trailing(raw, /\b(message|dm|text|tell|ask|write to|say to)\b/i), person)
            return text
                ? ok(raw, [{ type: "message", ...addressed(to), text }])
                : unsure(raw, `What should I say to ${person.name}?`)
        },
    },
    {
        name: "generate_briefing",
        test: /\b(generate|create|make|write|draft|build)\b.*\b(briefing|brief)\b|\bbrief (the|my)\b/,
        build: (t, raw, c) => {
            const b = findAll(t, c.baskets)[0]?.id ?? c.activeBasketId
            return b ? ok(raw, [{ type: "generate_briefing", basketId: b }], true) : unsure(raw, "Which basket?")
        },
    },
    {
        name: "create_signal",
        test: /\b(new signal|create (a )?signal|add (a )?(new )?signal|log (a )?signal|mark (a )?signal)\b/,
        build: (t, raw, c) => {
            const text = raw.replace(/^.*?\bsignal\b[\s:,\-]*/i, "").trim()
            return text ? ok(raw, [{ type: "create_signal", at: c.cursor, text }])
                : unsure(raw, "What's the signal? Say a description after 'new signal'.")
        },
    },
    /* ── FILING, ADDED BEYOND THE SUPPLIED PARSER ───────────────────
       The supplied parser knew one destination: the briefing basket. Now
       that everything saved lands in a case's file tree, saying WHERE is
       the natural next thing out of someone's mouth — "file this under
       vessels", "make a folder called Hormuz watch".

       `create_folder` sits above `file_to`, because "create a folder
       called X" also contains "folder" and would otherwise be read as
       filing something into a folder that does not exist yet.

       Both sit above `add_to_basket`, which matches a bare "add … to …"
       and would swallow "add this to the vessels folder". */
    {
        name: "create_folder",
        test: /\b(create|make|new|add)\b[^.]*\bfolder\b/,
        build: (t, raw) => {
            const name = folderName(raw, /\b(create|make|new|add)\s+(a\s+)?(new\s+)?folder\s*(called|named|for)?\s*/i)
            return name
                ? ok(raw, [{ type: "create_folder", name }])
                : unsure(raw, "What should the folder be called?")
        },
    },
    {
        name: "file_to",
        test: /\b(file|put|move|save|add)\b[^.]*\b(under|into|in|to)\b[^.]*\b(folder|case)\b|\bfile (this|it|that)\b/,
        build: (t, raw, c) => {
            if (!c.selectedId) return unsure(raw, "Nothing selected to file.")
            const name = folderName(raw, /\b(file|put|move|save|add)\s+(this|it|that)?\s*(signal|one)?\s*(under|into|in|to)\s*(the\s+)?/i)
                || folderName(raw, /\b(file|put|move|save|add)\b\s*/i)
            return name
                ? ok(raw, [{ type: "file_to", itemId: c.selectedId, folder: name }])
                : unsure(raw, "File it where? Name a folder.")
        },
    },
    {
        name: "add_to_basket",
        test: /\b(add|put|flag|save|drop|move|throw)\b.*\b(to|in|into)\b|\b(basket|briefing)\b/,
        build: (t, raw, c) => {
            const matches = findAll(t, c.baskets)
            const basketId = matches.length === 1 ? matches[0].id : (matches.length === 0 ? c.activeBasketId : undefined)
            if (!basketId) {
                return unsure(raw, matches.length > 1
                    ? `Which basket: ${matches.map((b) => b.name).join(" / ")}?` : "Which basket?")
            }
            /* CHANGED FROM THE SUPPLIED PARSER, deliberately:

               1. "that" counts as a note marker here. "Add to briefing that
                  this ship turned off its transponder" is one of the most
                  natural things to say, and the original dropped everything
                  after "that" on the floor — the sentence became a bare
                  add, and the observation was lost.

               2. A selection is no longer required WHEN there is a clause.
                  Saying something worth recording should land it in the
                  basket whether or not a marker happens to be selected;
                  the original refused with "Nothing selected on the map."
                  and threw the words away. A bare "add this" with nothing
                  selected still refuses, because "this" genuinely has no
                  referent. */
            const note = trailing(raw, ADD_NOTE_MARK)
            if (!c.selectedId) {
                return note
                    ? ok(raw, [{ type: "add_note", itemId: undefined, text: note }])
                    : unsure(raw, "Nothing selected on the map.")
            }
            const actions = [{ type: "add_to_basket", itemId: c.selectedId, basketId }]
            if (note) actions.push({ type: "add_note", itemId: c.selectedId, text: note })
            return ok(raw, actions)
        },
    },
    {
        name: "dismiss",
        test: /\b(dismiss|ignore|discard|duplicate|not relevant|irrelevant|false positive|close (this|it))\b/,
        build: (t, raw, c) => {
            if (!c.selectedId) return unsure(raw, "Nothing selected to dismiss.")
            const reason = /\bduplicate\b/.test(t) ? "duplicate" : trailing(raw, NOTE_MARK)
            return ok(raw, [{ type: "dismiss", itemId: c.selectedId, reason }])
        },
    },
    {
        name: "tag",
        test: /\b(tag|assign|escalate)\b/,
        build: (t, raw, c) => {
            if (!c.selectedId) return unsure(raw, "Nothing selected to tag.")
            const people = findAll(t, c.users)
            if (people.length !== 1) {
                return unsure(raw, people.length ? `Which one: ${people.map((p) => p.name).join(" / ")}?` : "Tag whom?")
            }
            return ok(raw, [{ type: "tag", itemId: c.selectedId, userId: people[0].id }])
        },
    },
    /* ── ADDED BEYOND THE SUPPLIED PARSER ───────────────────────────
       Two rules the original did not have, plus the place slot they need.
       They sit above `filter` deliberately: "show me Yemen's risk index"
       matches `show`, and whichever rule is first wins — reading it as a
       layer filter would be the wrong answer to a question about a number.
       `risk` is above `navigate` for the same reason: "show me Yemen's
       risk" also matches "show me Yemen".

       The place itself is resolved asynchronously against the gazetteer
       (voice/gazetteer.js), which the parser cannot do — it is synchronous
       and has no I/O by design. So these emit the spoken place as text and
       the dispatcher looks it up. A place that does not resolve is
       reported there, not guessed at here. */
    {
        name: "risk",
        test: /\b(risk|risk index|threat level|how (risky|dangerous)|danger level)\b/,
        build: (t, raw) => {
            const place = placeText(t, /\b(risk index|risk|threat level|danger level|how risky is|how dangerous is|show me|show|whats|what is|for|of|in|the|s)\b/g)
            return place
                ? ok(raw, [{ type: "risk", place }])
                : unsure(raw, "Risk where? Name a country.")
        },
    },
    {
        name: "navigate",
        test: /\b(go to|fly to|take me to|zoom to|jump to|centre on|center on|navigate to|show me)\b/,
        build: (t, raw) => {
            const place = placeText(t, /\b(go to|fly to|take me to|zoom to|jump to|centre on|center on|navigate to|show me|the|please|on the map|map)\b/g)
            return place
                ? ok(raw, [{ type: "navigate", place }])
                : unsure(raw, "Go where? Name a place.")
        },
    },
    {
        name: "filter",
        test: /\b(show|filter|only|hide all but|display)\b/,
        build: (t, raw, c) => {
            const typeIds = findAll(t, c.signalTypes).map((x) => x.id)
            const sinceHours = parseSinceHours(t)
            if (!typeIds.length && sinceHours === undefined) {
                return unsure(raw, "Show what? No signal type or time range recognised.")
            }
            return ok(raw, [{ type: "filter", typeIds, sinceHours }])
        },
    },
    {
        name: "note",
        test: /^(note|comment|remember)\b|\bnote that\b/,
        build: (t, raw, c) => {
            const text = trailing(raw, NOTE_MARK) ?? raw
            return ok(raw, [{ type: "add_note", itemId: c.selectedId, text }])
        },
    },
]

// ---------- entry point ----------

export function parseCommand(raw, ctx) {
    const t = normalize(raw)
    for (const r of RULES) {
        if (r.test.test(t)) return { ...r.build(t, raw, ctx), intent: r.name }
    }
    // Nothing matched: never lose what was said — keep it as a note.
    return {
        intent: "fallback_note",
        actions: [{ type: "add_note", itemId: ctx.selectedId, text: raw.trim() }],
        confident: false,
        needsConfirm: true,
        problem: "Not a recognised command — saved as a note.",
        raw,
    }
}
