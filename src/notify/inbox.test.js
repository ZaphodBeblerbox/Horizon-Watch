// @vitest-environment jsdom
// Messages and the desk on both surfaces (owner, 2026-10-19): the unread
// badges, the notification that is held back while you are looking at that
// conversation, and a click that opens the conversation or the desk post.
import { afterEach, describe, expect, it } from "vitest"
import {
    addablePeople, badgeText, grew, isOnScreen, requestOpenChat, requestOpenDeskPost,
    setViewingChat, setViewingDesk, takeOpenChat, takeOpenDeskPost,
} from "./inbox.js"
import { parseOpenParams, presentationFor, routeFor } from "./openSignal.js"
import { __resetNotifications, getNotifications, interrupts, pushNotification } from "../state/notificationStore.js"

afterEach(() => { setViewingChat(null); setViewingDesk(false); takeOpenChat(); takeOpenDeskPost(); __resetNotifications() })

describe("unread badges", () => {
    it("says when something new arrived, not when something was read", () => {
        expect(grew({ messages: 1, desk: 0 }, { messages: 2, desk: 0 })).toBe(true)
        expect(grew({ messages: 2, desk: 3 }, { messages: 2, desk: 4 })).toBe(true)
        expect(grew({ messages: 2, desk: 3 }, { messages: 0, desk: 3 })).toBe(false)
        expect(grew(null, { messages: 0, desk: 0 })).toBe(false)
    })
    it("reads as a number, 99+, or nothing", () => {
        expect(badgeText(0)).toBe("")
        expect(badgeText(undefined)).toBe("")
        expect(badgeText(7)).toBe("7")
        expect(badgeText(150)).toBe("99+")
    })
})

describe("what is on screen is not also a notification", () => {
    const msg = { kind: "message", conversationId: "c1", sev: "moderate", ts: Date.now() }
    it("holds back a message for the conversation you are reading, not for another", () => {
        expect(interrupts(msg)).toBe(true)
        setViewingChat("c1")
        expect(isOnScreen(msg)).toBe(true)
        expect(interrupts(msg)).toBe(false)
        expect(interrupts({ ...msg, conversationId: "c2" })).toBe(true)
    })
    it("holds back a desk post while the desk is on screen", () => {
        const post = { kind: "desk", postId: "p1", sev: "moderate", ts: Date.now() }
        expect(interrupts(post)).toBe(true)
        setViewingDesk(true)
        expect(interrupts(post)).toBe(false)
    })
    it("keeps where it opens on the tray's item", () => {
        pushNotification({ id: "msg:1", kind: "message", title: "Ana: hi", conversationId: "c1", ts: Date.now() })
        const it = getNotifications().items[0]
        expect(it.kind).toBe("message")
        expect(it.conversationId).toBe("c1")
        expect(interrupts(it)).toBe(true)
    })
})

describe("a click opens the conversation or the desk post", () => {
    it("routes a message to its conversation and a desk card to its post", () => {
        expect(routeFor({ id: "msg:9", kind: "message", conversation_id: "c1" })).toMatchObject({ action: "chat", conversationId: "c1" })
        expect(routeFor({ id: "desk:p1", kind: "desk", post_id: "p1" })).toMatchObject({ action: "desk", postId: "p1" })
        expect(presentationFor(routeFor({ kind: "message", conversationId: "c1" }), "phone").map).toBe(false)
        // a post_id on anything else (a Telegram post) is not a desk card
        expect(routeFor({ id: "tg1", kind: "telegram", post_id: "x", lat: 1, lon: 2 }).action).toBe("signal")
    })
    it("opens from a push clicked with the app closed", () => {
        expect(routeFor(parseOpenParams("?chat=c1&h=Ana"))).toMatchObject({ action: "chat", conversationId: "c1" })
        expect(routeFor(parseOpenParams("?deskpost=p1"))).toMatchObject({ action: "desk", postId: "p1" })
    })
    it("waits for the screen that takes it", () => {
        requestOpenChat("c1")
        expect(takeOpenChat()).toBe("c1")
        expect(takeOpenChat()).toBe(null)
        requestOpenDeskPost("p1")
        expect(takeOpenDeskPost()).toEqual({ id: "p1" })
        requestOpenDeskPost(null)
        expect(takeOpenDeskPost()).toEqual({ id: null })
        expect(takeOpenDeskPost()).toBe(null)
    })
})

describe("choosing people to add", () => {
    const people = [
        { id: "a", name: "Ana Ruiz", company: "Trifecta" },
        { id: "b", name: "Ben Okafor", email: "ben@acme.test", company: "Acme" },
        { id: "c", name: "Cem", title: "Analyst" },
    ]
    it("leaves out who is already in and finds by name, email or company", () => {
        expect(addablePeople(people, ["a"]).map((p) => p.id)).toEqual(["b", "c"])
        expect(addablePeople(people, [], "acme").map((p) => p.id)).toEqual(["b"])
        expect(addablePeople(people, [], "analyst").map((p) => p.id)).toEqual(["c"])
        expect(addablePeople(null, [])).toEqual([])
    })
})
