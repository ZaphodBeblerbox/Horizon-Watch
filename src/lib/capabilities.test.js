import { describe, it, expect, beforeEach, vi } from "vitest"
import { ACCESS_ROLES, ACCESS_ROLE_IDS, roleHasCapability, roleLabel, capabilityLabel } from "./capabilities.js"

describe("capabilities — the real five-role model", () => {
    it("defines exactly the five real roles from §7.3", () => {
        expect(ACCESS_ROLE_IDS.sort()).toEqual(
            ["analyst", "imagery_analyst", "regional_lead", "security_lead", "senior_analyst"].sort()
        )
    })

    it("security_lead has every capability including admin", () => {
        expect(roleHasCapability("security_lead", "admin")).toBe(true)
        expect(roleHasCapability("security_lead", "approve")).toBe(true)
        expect(roleHasCapability("security_lead", "issue")).toBe(true)
    })

    it("analyst has only brief — the narrowest real role", () => {
        expect(ACCESS_ROLES.analyst.capabilities).toEqual(["brief"])
        expect(roleHasCapability("analyst", "review")).toBe(false)
        expect(roleHasCapability("analyst", "issue")).toBe(false)
    })

    it("senior_analyst can review but not issue or admin", () => {
        expect(roleHasCapability("senior_analyst", "review")).toBe(true)
        expect(roleHasCapability("senior_analyst", "issue")).toBe(false)
        expect(roleHasCapability("senior_analyst", "admin")).toBe(false)
    })

    it("an unknown role has no capabilities (fails closed, not open)", () => {
        expect(roleHasCapability("nonexistent_role", "brief")).toBe(false)
    })

    it("roleLabel/capabilityLabel produce real human-readable text, not raw ids", () => {
        expect(roleLabel("senior_analyst")).toBe("Senior analyst")
        expect(capabilityLabel("issue")).toBe("issue/publish reports")
    })
})

describe("can() / requireCapability() — read the live profile, refuse with a real toast", () => {
    // This test suite runs with vitest's "node" environment (no jsdom), so
    // there is no real `localStorage` global — mock loadProfile() directly
    // instead (profile.js's own loadProfile() already wraps a real
    // localStorage read in a try/catch, so this exercises the exact same
    // contract can() relies on: "whatever loadProfile() returns").
    beforeEach(() => {
        vi.resetModules()
    })

    it("can() reflects whatever accessRole is currently saved in the profile", async () => {
        vi.doMock("../constants/profile.js", () => ({ loadProfile: () => ({ accessRole: "security_lead" }) }))
        const { can } = await import("./capabilities.js")
        expect(can("admin")).toBe(true)
        expect(can("confirm")).toBe(false)
    })

    it("can() falls back to the default role when no profile or an invalid accessRole is stored", async () => {
        vi.doMock("../constants/profile.js", () => ({ loadProfile: () => null }))
        const { can } = await import("./capabilities.js")
        expect(can("brief")).toBe(true)   // default role (analyst) can brief
        expect(can("issue")).toBe(false)  // but not issue

        vi.resetModules()
        vi.doMock("../constants/profile.js", () => ({ loadProfile: () => ({ accessRole: "not-a-real-role" }) }))
        const { can: can2 } = await import("./capabilities.js")
        expect(can2("issue")).toBe(false)
    })

    it("requireCapability() returns true and does not toast when the current role has the capability", async () => {
        vi.doMock("../constants/profile.js", () => ({ loadProfile: () => ({ accessRole: "imagery_analyst" }) }))
        const toastSpy = vi.fn()
        vi.doMock("../ui/toast.js", () => ({ toast: toastSpy }))
        const { requireCapability } = await import("./capabilities.js")
        expect(requireCapability("confirm")).toBe(true)
        expect(toastSpy).not.toHaveBeenCalled()
    })

    it("requireCapability() returns false and shows a real explanatory toast when the current role lacks the capability", async () => {
        vi.doMock("../constants/profile.js", () => ({ loadProfile: () => ({ accessRole: "analyst" }) }))
        const toastSpy = vi.fn()
        vi.doMock("../ui/toast.js", () => ({ toast: toastSpy }))
        const { requireCapability } = await import("./capabilities.js")
        expect(requireCapability("issue")).toBe(false)
        expect(toastSpy).toHaveBeenCalledTimes(1)
        const [message, opts] = toastSpy.mock.calls[0]
        expect(message).toMatch(/Analyst cannot issue\/publish reports/)
        expect(opts.icon).toBe("i-eye-off")
    })
})
