import { describe, it, expect } from "vitest"
import { parseCommand } from "./voiceCommands.js"

/** The context the spec's acceptance table is written against. */
const ctx = {
    selectedId: "sig_4821",
    cursor: { lat: 43.3, lng: 5.37 },
    activeBasketId: "b_daily",
    currentBriefingId: "br_77",
    baskets: [{ id: "b_thu", name: "Thursday Brief" }, { id: "b_daily", name: "Daily" }],
    users: [{ id: "u_hannes", name: "Hannes Weber" }, { id: "u_lea", name: "Lea Martin" }],
    signalTypes: [
        { id: "maritime", name: "Maritime", aliases: ["ships", "naval"] },
        { id: "cyber", name: "Cyber" },
    ],
}

describe("voice command parser — the acceptance table", () => {
    it("add to a named basket, with the trailing clause kept as a note", () => {
        const r = parseCommand("Add this to Thursday, note it's the third one near the port this week.", ctx)
        expect(r.intent).toBe("add_to_basket")
        expect(r.actions[0]).toEqual({ type: "add_to_basket", itemId: "sig_4821", basketId: "b_thu" })
        expect(r.actions[1]).toEqual({
            type: "add_note", itemId: "sig_4821",
            text: "it's the third one near the port this week.",
        })
        expect(r.confident).toBe(true)
    })

    /* SENDING NO LONGER ASKS FIRST. The supplied parser confirmed every
       send. Being asked "are you sure" straight after saying a whole
       sentence out loud is exactly the intervention saying it was meant to
       avoid, so it goes immediately and the toast carries a real Undo that
       deletes the message. The recovery is offered; the checkpoint is not
       imposed. */
    it("sends a briefing to a colleague, without stopping to ask", () => {
        const r = parseCommand("Please send said briefing to my colleague Hannes.", ctx)
        expect(r.intent).toBe("send")
        expect(r.actions[0]).toMatchObject({ type: "send", what: "briefing", id: "br_77", userId: "u_hannes" })
        expect(r.needsConfirm).toBe(false)
    })

    it("sends the selected item, tolerates a misheard name, and keeps the message", () => {
        const r = parseCommand("Send this to Hanes, ask if he's seen it.", ctx)
        expect(r.intent).toBe("send")
        expect(r.actions[0]).toMatchObject({ type: "send", what: "item", id: "sig_4821", userId: "u_hannes" })
        expect(r.actions[0].message).toBe("ask if he's seen it.")
        expect(r.needsConfirm).toBe(false)
        // Who it went to, so the toast can say so rather than just "Sent".
        expect(r.actions[0].name).toMatch(/Hannes/)
    })

    // An ambiguous or missing recipient still stops — that is not a
    // confirmation step, it is the parser not knowing who you meant.
    it("still stops when it does not know who", () => {
        expect(parseCommand("send this to someone", ctx).confident).toBe(false)
    })

    it("dismiss with a reason", () => {
        const r = parseCommand("Dismiss, duplicate of yesterday's.", ctx)
        expect(r.intent).toBe("dismiss")
        expect(r.actions[0]).toEqual({ type: "dismiss", itemId: "sig_4821", reason: "duplicate" })
    })

    it("filter by type and a spoken time range", () => {
        const r = parseCommand("Show only maritime signals in the last forty eight hours.", ctx)
        expect(r.intent).toBe("filter")
        expect(r.actions[0]).toEqual({ type: "filter", typeIds: ["maritime"], sinceHours: 48 })
    })

    it("create a signal at the cursor", () => {
        const r = parseCommand("New signal: convoy moving north on the A7, medium confidence.", ctx)
        expect(r.intent).toBe("create_signal")
        expect(r.actions[0]).toEqual({
            type: "create_signal", at: { lat: 43.3, lng: 5.37 },
            text: "convoy moving north on the A7, medium confidence.",
        })
    })

    it("tag a colleague", () => {
        const r = parseCommand("Tag for Lea.", ctx)
        expect(r.intent).toBe("tag")
        expect(r.actions[0]).toEqual({ type: "tag", itemId: "sig_4821", userId: "u_lea" })
    })

    it("generate a briefing from a named basket, with a confirm", () => {
        const r = parseCommand("Generate the briefing for the Thursday basket.", ctx)
        expect(r.intent).toBe("generate_briefing")
        expect(r.actions[0]).toEqual({ type: "generate_briefing", basketId: "b_thu" })
        expect(r.needsConfirm).toBe(true)
    })

    it("a bare note keeps only what follows the marker", () => {
        const r = parseCommand("Note that the vessel turned off its transponder at 14:00.", ctx)
        expect(r.intent).toBe("note")
        expect(r.actions[0]).toEqual({
            type: "add_note", itemId: "sig_4821",
            text: "the vessel turned off its transponder at 14:00.",
        })
    })

    it("falls back to the active basket when none is named", () => {
        const r = parseCommand("Put it in the basket.", ctx)
        expect(r.intent).toBe("add_to_basket")
        expect(r.actions[0]).toEqual({ type: "add_to_basket", itemId: "sig_4821", basketId: "b_daily" })
    })

    it("never loses what was said", () => {
        const r = parseCommand("Hmm what else happened around here last month?", ctx)
        expect(r.intent).toBe("fallback_note")
        expect(r.actions[0].type).toBe("add_note")
        expect(r.confident).toBe(false)
    })
})

describe("it refuses rather than guesses", () => {
    it("nothing selected", () => {
        const r = parseCommand("add this to Thursday", { ...ctx, selectedId: undefined })
        expect(r.confident).toBe(false)
        expect(r.problem).toBe("Nothing selected on the map.")
        expect(r.actions).toEqual([])
    })

    it("two colleagues share a first name", () => {
        const two = { ...ctx, users: [{ id: "u_1", name: "Hannes Weber" }, { id: "u_2", name: "Hannes Koch" }] }
        const r = parseCommand("send this to Hannes", two)
        expect(r.confident).toBe(false)
        expect(r.problem).toContain("Hannes Weber")
        expect(r.problem).toContain("Hannes Koch")
    })

    it("no briefing to send", () => {
        const r = parseCommand("send the briefing to Hannes", { ...ctx, currentBriefingId: undefined })
        expect(r.confident).toBe(false)
        expect(r.actions).toEqual([])
    })
})

describe("navigation and risk, added beyond the supplied parser", () => {
    const base = {
        baskets: [{ id: "b", name: "briefing basket", aliases: ["basket", "briefing"] }],
        users: [], signalTypes: [{ id: "maritime", name: "Maritime", aliases: ["ships"] }],
        activeBasketId: "b",
    }

    it.each([
        ["go to Yemen", "yemen"],
        ["fly to Yemen", "yemen"],
        ["take me to the Strait of Hormuz", "strait of hormuz"],
        ["zoom to Aden", "aden"],
    ])("%s is navigation", (phrase, place) => {
        const r = parseCommand(phrase, base)
        expect(r.intent).toBe("navigate")
        expect(r.actions[0]).toEqual({ type: "navigate", place })
    })

    it.each([
        "show me Yemen's risk index",
        "how risky is Syria",
        "what is the threat level in Sudan",
    ])("%s asks for risk, not a filter", (phrase) => {
        const r = parseCommand(phrase, base)
        expect(r.intent).toBe("risk")
        expect(r.actions[0].type).toBe("risk")
    })

    it("a genuine layer filter still wins over navigation", () => {
        // "show maritime" matches `show me`-ish wording; filter must not be
        // shadowed by the new rules.
        const r = parseCommand("show only maritime signals in the last 24 hours", base)
        expect(r.intent).toBe("filter")
        expect(r.actions[0]).toEqual({ type: "filter", typeIds: ["maritime"], sinceHours: 24 })
    })
})

describe("adding an observation to the briefing", () => {
    const base = {
        baskets: [{ id: "b", name: "briefing basket", aliases: ["basket", "briefing"] }],
        users: [], signalTypes: [], activeBasketId: "b",
    }

    it("keeps the clause after 'that' and attaches it to the selection", () => {
        const r = parseCommand("add to briefing that this ship turned off its transponder",
            { ...base, selectedId: "sig_1" })
        expect(r.intent).toBe("add_to_basket")
        expect(r.actions[0]).toEqual({ type: "add_to_basket", itemId: "sig_1", basketId: "b" })
        expect(r.actions[1]).toEqual({
            type: "add_note", itemId: "sig_1", text: "this ship turned off its transponder",
        })
    })

    it("still records the observation when nothing is selected", () => {
        const r = parseCommand("add to briefing that this ship turned off its transponder", base)
        expect(r.confident).toBe(true)
        expect(r.actions).toEqual([
            { type: "add_note", itemId: undefined, text: "this ship turned off its transponder" },
        ])
    })

    it("but a bare 'add this' with nothing selected still refuses", () => {
        const r = parseCommand("add this to the briefing", base)
        expect(r.confident).toBe(false)
        expect(r.problem).toBe("Nothing selected on the map.")
    })
})

describe("filing by voice", () => {
    const base = {
        selectedId: "sig_1", activeBasketId: "b",
        baskets: [{ id: "b", name: "briefing basket", aliases: ["basket", "briefing"] }],
        users: [], signalTypes: [{ id: "maritime", name: "Maritime", aliases: ["ships"] }],
    }

    it.each([
        ["create a folder called Hormuz watch", "Hormuz watch"],
        ["make a new folder for dark vessels", "dark vessels"],
    ])("%s creates a folder", (phrase, name) => {
        const r = parseCommand(phrase, base)
        expect(r.intent).toBe("create_folder")
        expect(r.actions[0]).toEqual({ type: "create_folder", name })
    })

    it("keeps the folder's original casing — it is a proper name", () => {
        // Lower-casing it creates a SECOND folder beside the one that
        // already exists, which is the failure that makes a tree useless.
        const r = parseCommand("create a folder called Hormuz Watch", base)
        expect(r.actions[0].name).toBe("Hormuz Watch")
    })

    it.each([
        ["file this under vessels", "vessels"],
        ["put this signal in the Hormuz watch folder", "Hormuz watch"],
        ["move this to the imagery folder", "imagery"],
    ])("%s files into a folder", (phrase, folder) => {
        const r = parseCommand(phrase, base)
        expect(r.intent).toBe("file_to")
        expect(r.actions[0]).toEqual({ type: "file_to", itemId: "sig_1", folder })
    })

    it("refuses to file with nothing selected", () => {
        const r = parseCommand("file this under vessels", { ...base, selectedId: undefined })
        expect(r.confident).toBe(false)
        expect(r.problem).toBe("Nothing selected to file.")
    })

    it("does not shadow the rules it sits above", () => {
        // create_folder and file_to are ordered above add_to_basket, which
        // matches a bare "add … to …". Both directions must still work.
        expect(parseCommand("add this to the briefing", base).intent).toBe("add_to_basket")
        expect(parseCommand("add to briefing that the ship went dark", base).intent).toBe("add_to_basket")
        expect(parseCommand("note that the vessel went dark", base).intent).toBe("note")
        expect(parseCommand("show maritime last 24 hours", base).intent).toBe("filter")
    })
})

/* ── speaking to a colleague ─────────────────────────────────────────
   The user's own words: "send this to hannes or send: speak message to
   hannes, and the system does so without the user ever having to open
   the chat". Both forms have to parse, and they have to stay apart:
   one carries a thing, the other carries words. */
describe("messaging a colleague by voice", () => {
    const ctx = {
        users: [
            { id: "u1", name: "Hannes Kohnen" },
            { id: "u2", name: "Jakob Hentschel" },
        ],
        selectedId: "sig-1",
    }

    it("sends a message without an item", () => {
        const r = parseCommand("message Hannes the tanker went dark at 0340Z", ctx)
        expect(r.intent).toBe("message")
        expect(r.actions[0]).toMatchObject({ type: "message", userId: "u1" })
        expect(r.actions[0].text).toBe("the tanker went dark at 0340Z")
        // Straight out, like a send. See the note above.
        expect(r.needsConfirm).toBe(false)
    })

    it("takes 'tell' and 'dm' too, and drops the filler after the name", () => {
        expect(parseCommand("tell Jakob that I am on the Hormuz desk today", ctx).actions[0])
            .toMatchObject({ type: "message", userId: "u2", text: "I am on the Hormuz desk today" })
        expect(parseCommand("dm Hannes can you take the 0600 pass", ctx).actions[0].text)
            .toBe("can you take the 0600 pass")
    })

    // The name is the address, not part of the sentence.
    it("never leaves the name inside the message", () => {
        const r = parseCommand("message Hannes Hannes please look at this", ctx)
        expect(r.actions[0].text).not.toMatch(/^Hannes Hannes/)
    })

    // "send this to X, ask ..." is a SHARE with a covering note. Read as a
    // message it would post the words and leave the signal behind.
    it("keeps a share a share even when it contains 'ask'", () => {
        const r = parseCommand("send this to Hannes, ask if he's seen it", ctx)
        expect(r.intent).toBe("send")
        expect(r.actions[0]).toMatchObject({ type: "send", userId: "u1", what: "item" })
    })

    it("asks who, rather than guessing", () => {
        const r = parseCommand("message the tanker went dark", ctx)
        expect(r.confident).toBe(false)
        expect(r.problem).toMatch(/who/i)
    })

    it("asks what to say when only a name was given", () => {
        const r = parseCommand("message Hannes", ctx)
        expect(r.confident).toBe(false)
        expect(r.problem).toMatch(/what should i say/i)
    })

    it("refuses an ambiguous name instead of picking one", () => {
        const two = { ...ctx, users: [{ id: "a", name: "Marc Lunau" }, { id: "b", name: "Marc Keller" }] }
        const r = parseCommand("message Marc the pass is at 0612", two)
        expect(r.confident).toBe(false)
        expect(r.problem).toMatch(/which one/i)
    })
})

describe("a misheard name still addresses the right person", () => {
    const ctx = { users: [{ id: "u1", name: "Hannes Kohnen" }], selectedId: "sig-1" }

    it("matches the colleague and does not put the misheard token in the message", () => {
        const r = parseCommand("message Hanes the pass is at 0612Z", ctx)
        expect(r.actions[0]).toMatchObject({ type: "message", userId: "u1" })
        expect(r.actions[0].text).toBe("the pass is at 0612Z")
    })
})

/* ── addressing ──────────────────────────────────────────────────────
   Two defects this covers. A one-letter account name was tested with
   `text.includes(name)`, so an account called "T" matched every sentence
   containing a letter t — "send hi to Hannes" came back "Which one:
   Hannes Kohnen / T?". And a group chat could not be addressed at all. */
describe("who a sentence is addressed to", () => {
    const ctx = {
        users: [
            { id: "u1", name: "Hannes Kohnen", aliases: ["Hannes"] },
            { id: "u2", name: "T" },
        ],
        groups: [{ id: "g1", name: "Trifecta" }],
        selectedId: "sig-1",
    }

    it("does not let a one-letter name match every sentence", () => {
        const r = parseCommand("send hi to Hannes", ctx)
        expect(r.confident).toBe(true)
        expect(r.actions[0]).toMatchObject({ userId: "u1" })
    })

    it("still finds a short name when it is actually said", () => {
        const r = parseCommand("message T the pass is at 0612", ctx)
        expect(r.actions[0]).toMatchObject({ type: "message", userId: "u2" })
    })

    it("sends to a group by its name", () => {
        const r = parseCommand("send hi to Trifecta", ctx)
        expect(r.confident).toBe(true)
        expect(r.actions[0]).toMatchObject({ conversationId: "g1", name: "Trifecta" })
        expect(r.actions[0].userId).toBeUndefined()
    })

    it("messages a group too", () => {
        const r = parseCommand("tell Trifecta the 0612 pass is cancelled", ctx)
        expect(r.actions[0]).toMatchObject({ type: "message", conversationId: "g1" })
        expect(r.actions[0].text).toBe("the 0612 pass is cancelled")
    })

    // A group can be named after a person; a person cannot be named after
    // a group, so the person wins.
    it("prefers the person when both could match", () => {
        const both = { ...ctx, groups: [{ id: "g9", name: "Hannes" }] }
        expect(parseCommand("message Hannes hello", both).actions[0]).toMatchObject({ userId: "u1" })
    })

    it("still asks when two people really do share a name", () => {
        const twoMarcs = {
            users: [{ id: "a", name: "Marc Lunau", aliases: ["Marc"] },
                    { id: "b", name: "Marc Keller", aliases: ["Marc"] }],
            groups: [], selectedId: "sig-1",
        }
        const r = parseCommand("message Marc the pass is at 0612", twoMarcs)
        expect(r.confident).toBe(false)
        expect(r.problem).toMatch(/which one/i)
    })
})

/* ── "send hi to Hannes" ─────────────────────────────────────────────
   This refused with "No item to send — open or generate one first",
   which answers a question nobody asked: the thing being sent is the
   word "hi". */
describe("sending words rather than a thing", () => {
    const ctx = {
        users: [{ id: "u1", name: "Hannes Kohnen", aliases: ["Hannes"] }],
        groups: [{ id: "g1", name: "Trifecta" }],
        baskets: [],
    }

    it("sends the words when nothing is selected", () => {
        const r = parseCommand("send hi to Hannes", ctx)
        expect(r.confident).toBe(true)
        expect(r.actions[0]).toMatchObject({ type: "message", userId: "u1", text: "hi" })
    })

    it("works for a group, and in the other word order", () => {
        expect(parseCommand("send hi to Trifecta", ctx).actions[0])
            .toMatchObject({ type: "message", conversationId: "g1", text: "hi" })
        expect(parseCommand("send Hannes the pass is at 0612", ctx).actions[0].text)
            .toBe("the pass is at 0612")
    })

    // "this" points at something; it is not a message.
    it("still refuses when the words are only a pointer", () => {
        const r = parseCommand("send this to Hannes", ctx)
        expect(r.confident).toBe(false)
        expect(r.problem).toMatch(/no item to send/i)
    })

    // A named thing that is not there is a wrong request, not a message.
    it("still refuses a briefing that does not exist", () => {
        const r = parseCommand("send the briefing to Hannes", ctx)
        expect(r.confident).toBe(false)
        expect(r.actions).toEqual([])
    })

    it("names two same-named accounts apart when it has to ask", () => {
        const dupes = {
            users: [{ id: "a", name: "Hannes Kohnen", hint: "hannes@trifecta.com", aliases: ["Hannes"] },
                    { id: "b", name: "Hannes Kohnen", hint: "hk@other.com", aliases: ["Hannes"] }],
            groups: [], baskets: [],
        }
        const r = parseCommand("message Hannes hello", dupes)
        expect(r.confident).toBe(false)
        expect(r.problem).toContain("hannes@trifecta.com")
        expect(r.problem).toContain("hk@other.com")
    })
})

/* ── "send the current situation in Niger to Hannes" ─────────────────
   A place, a person, and a verb meaning "gather what we have and hand it
   over". Read as an ordinary send it posts the WORDS "the current
   situation in Niger", which is a sentence rather than the thing asked
   for. */
describe("sending a place's picture", () => {
    const ctx = {
        users: [{ id: "u1", name: "Hannes Kohnen", aliases: ["Hannes"] }],
        groups: [{ id: "g1", name: "Trifecta" }],
        baskets: [],
    }

    it("takes the place and the person out of one sentence", () => {
        const r = parseCommand("send the current situation in Niger to Hannes", ctx)
        expect(r.intent).toBe("send_situation")
        expect(r.actions[0]).toMatchObject({ type: "send_situation", place: "Niger", userId: "u1" })
    })

    it("works in the other word order", () => {
        expect(parseCommand("send Hannes the latest on Yemen", ctx).actions[0])
            .toMatchObject({ type: "send_situation", place: "Yemen", userId: "u1" })
    })

    it("sends a place's picture to a group", () => {
        expect(parseCommand("share the situation in the Red Sea with Trifecta", ctx).actions[0])
            .toMatchObject({ type: "send_situation", conversationId: "g1" })
    })

    // The ACTION is what matters, not which rule matched: "send hi to
    // Hannes" is caught by the `send` rule and falls through to a message,
    // which is the right outcome by a different route.
    it("does not swallow an ordinary message", () => {
        expect(parseCommand("send hi to Hannes", ctx).actions[0])
            .toMatchObject({ type: "message", text: "hi" })
        expect(parseCommand("tell Hannes the pass is at 0612", ctx).actions[0])
            .toMatchObject({ type: "message", text: "the pass is at 0612" })
    })

    it("asks which place rather than guessing one", () => {
        const r = parseCommand("send the current situation to Hannes", ctx)
        expect(r.confident).toBe(false)
        expect(r.problem).toMatch(/which place/i)
    })

    it("strips the politeness off the end of the place", () => {
        expect(parseCommand("send the situation in Yemen to Hannes please", ctx).actions[0].place)
            .toBe("Yemen")
    })
})

/* ── "explain the current situation in Mali" ─────────────────────────
   A question, not a send and not a navigation. It has to beat the
   navigation rule, which would otherwise read "what is going on in Mali"
   as an instruction to fly there. */
describe("explaining a place", () => {
    const ctx = {
        users: [{ id: "u1", name: "Hannes Kohnen", aliases: ["Hannes"] }],
        groups: [], baskets: [],
        signalTypes: [{ id: "maritime", name: "Maritime", aliases: ["ships"] }],
    }

    it("takes the place out of the question", () => {
        const r = parseCommand("explain the current situation in Mali", ctx)
        expect(r.intent).toBe("explain")
        expect(r.actions[0]).toMatchObject({ type: "explain", place: "Mali" })
    })

    it("understands the other ways of asking", () => {
        for (const q of ["what is going on in Mali",
                         "what's happening in the Red Sea",
                         "brief me on Yemen",
                         "summarise the situation in Hormuz"]) {
            const r = parseCommand(q, ctx)
            expect(r.intent, q).toBe("explain")
            expect(r.actions[0].place, q).toBeTruthy()
        }
    })

    // It is a question about a place, so flying there instead would answer
    // a different one.
    it("is not read as a navigation", () => {
        expect(parseCommand("what is going on in Mali", ctx).actions[0].type).not.toBe("navigate")
    })

    // And a plain "go to Mali" must still be a navigation.
    it("does not swallow an ordinary navigation", () => {
        expect(parseCommand("fly to Mali", ctx).actions[0]).toMatchObject({ type: "navigate" })
        expect(parseCommand("take me to Hormuz", ctx).actions[0]).toMatchObject({ type: "navigate" })
    })

    it("asks where rather than explaining nothing", () => {
        const r = parseCommand("explain the current situation", ctx)
        expect(r.confident).toBe(false)
        expect(r.problem).toMatch(/explain where/i)
    })
})

/* Two bugs the phrasing table above found, both in how a place is taken
   out of a sentence. */
describe("taking a place out of a question", () => {
    const ctx = { users: [], groups: [], baskets: [], signalTypes: [] }

    // "going ON in Mali" has two prepositions and the first belongs to the
    // verb. Taking the first match made the place "in Mali".
    it("uses the last preposition, not the first", () => {
        expect(parseCommand("what is going on in Mali", ctx).actions[0].place).toBe("Mali")
        expect(parseCommand("brief me on what is happening in Yemen", ctx).actions[0].place).toBe("Yemen")
    })

    // normalize() strips apostrophes, so a pattern written with one never
    // matches the commonest phrasing there is.
    it("matches the apostrophe form, which arrives stripped", () => {
        expect(parseCommand("what's happening in the Red Sea", ctx).intent).toBe("explain")
        expect(parseCommand("whats going on in Hormuz", ctx).intent).toBe("explain")
    })

    it("never leaves a preposition or an article in the place", () => {
        for (const q of ["explain the situation in the Red Sea",
                         "what is happening around Hormuz",
                         "brief me on the situation in Mali"]) {
            const place = parseCommand(q, ctx).actions[0]?.place || ""
            expect(place, q).not.toMatch(/^(in|on|at|for|about|from|around|the)\b/i)
        }
    })
})
