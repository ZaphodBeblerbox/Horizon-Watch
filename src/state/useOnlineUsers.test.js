import { describe, it, expect } from "vitest"
import { othersOnline } from "./useOnlineUsers.js"

describe("othersOnline", () => {
    it("lists everyone present except me, by name", () => {
        const users = [{ id: "me", name: "Marc" }, { id: "2", name: "Kofi" }, { id: "3", name: "Ana" }]
        expect(othersOnline(users, "me").map((u) => u.name)).toEqual(["Ana", "Kofi"])
    })

    it("is empty for nothing or junk", () => {
        expect(othersOnline(null, "me")).toEqual([])
        expect(othersOnline([{ name: "no id" }], "me")).toEqual([])
    })
})
