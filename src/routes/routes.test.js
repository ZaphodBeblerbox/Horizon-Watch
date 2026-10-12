import { describe, it, expect, beforeEach, vi } from "vitest"
import { viewState, STATE_TEXT, summary, exposureLabel, hazardLine, ringStyle, fromLabel, toLabel, toLocalInput, fromLocalInput } from "./view.js"
import { registerMode, registerModeModule, listModes, getMode, listProviders, defaultAvoid, registerProvider } from "./registry.js"
import { openRoutePanel, closeRoutePanel, updateRequest, getRoutePanel, subscribeRoutePanel, publishPlan } from "./store.js"
import { registerRouteContext, requestFor, openContext, openFromNotification } from "./contexts.js"
import { routeFor, parseOpenParams } from "../notify/openSignal.js"

const plan = (over = {}) => ({ status: "ok", origin: { lat: 48.865, lon: 2.36 }, hazards: [{ id: "h1" }],
                               safest: { key: "a", distance_m: 2140, duration_s: 1620, duration_label: "27 min" }, ...over })

describe("the panel's states", () => {
    it("loading, then ok", () => {
        expect(viewState({ loading: true })).toBe("loading")
        expect(viewState({ plan: plan() })).toBe("ok")
    })
    it("an error with no plan; no danger near: clear", () => {
        expect(viewState({ error: "HTTP 502" })).toBe("error")
        expect(viewState({ plan: plan({ hazards: [] }) })).toBe("clear")
    })
    it("every route through a danger, or no router answered", () => {
        expect(viewState({ plan: plan({ status: "no_safe_route" }) })).toBe("no_safe_route")
        expect(viewState({ plan: plan({ status: "no_route" }) })).toBe("no_route")
    })
    it("a re-check that finds it unsafe; re-routed is ok again", () => {
        expect(viewState({ plan: plan(), check: { safe: false } })).toBe("unsafe")
        expect(viewState({ plan: plan({ rerouted: true }), check: { safe: false } })).toBe("ok")
        expect(viewState({ plan: plan(), rerouting: true })).toBe("rerouting")
        for (const k of ["loading", "ok", "unsafe", "rerouting", "no_safe_route", "clear", "error", "no_route"]) expect(STATE_TEXT[k]).toBeTruthy()
    })
})

describe("words", () => {
    it("summaries, exposure, hazards", () => {
        expect(summary(plan().safest)).toBe("2.1 km · 27 min")
        expect(exposureLabel(0)).toBe("no exposure")
        expect(exposureLabel(6.1)).toBe("high exposure (6.1)")
        const now = Date.parse("2026-10-12T15:00:00Z")
        expect(hazardLine({ label: "kettle", place: "Place de la République, Paris", at: "2026-10-12T14:48:00Z" }, now)).toBe("kettle · Place de la République · 12 min ago")
        expect(hazardLine({ label: "announced march", place: "Bastille", starts_utc: "2026-10-12T15:30:00Z" }, now)).toBe("announced march · Bastille · starts in 30 min")
        expect(ringStyle({ weight: 1 }).fillOpacity).toBeGreaterThan(ringStyle({ weight: 0.1 }).fillOpacity)
    })
    it("from and to", () => {
        expect(fromLabel({ from: { me: true } })).toBe("You — this device")
        expect(fromLabel({ from: { asset_id: "OA-1" } }, { subject: { name: "Anna" } })).toBe("Anna")
        expect(toLabel({ to: null })).toBe("Nearest safe point (automatic)")
        expect(toLabel({ to: { lat: 1, lon: 2, name: "Depot" } })).toBe("Depot")
    })
    it("the departure field round-trips", () => {
        const iso = "2026-10-17T07:00:00.000Z"
        expect(fromLocalInput(toLocalInput(iso))).toBe(iso)
        expect(fromLocalInput("")).toBe(null)
    })
})

describe("the registries", () => {
    it("foot, car and truck, in order; every provider avoided by default", () => {
        expect(listModes().slice(0, 3).map((m) => m.name)).toEqual(["foot", "car", "truck"])
        expect(listProviders().map((p) => p.name)).toEqual(expect.arrayContaining(["unrest", "endangered_calls", "violence", "strikes", "roadblocks"]))
        expect(defaultAvoid("truck")).toContain("roadblocks")
    })
    it("another planner registers its own mode and provider", () => {
        registerProvider("piracy", { label: "Piracy" })
        registerMode("sea", { label: "By sea", order: 60, defaultAvoid: ["piracy"] })
        expect(getMode("sea").label).toBe("By sea")
        expect(defaultAvoid("sea")).toEqual(["piracy"])
        expect(getMode("nonsense").name).toBe("foot")
    })
    it("a mode module with its own panel component", () => {
        const C = () => null
        registerModeModule({ key: "air", label: "Flights", order: 70, Component: C })
        expect(getMode("air")).toMatchObject({ name: "air", label: "Flights", Component: C })
        expect(listModes().map((m) => m.name)).toContain("air")
    })
})

describe("the panel store and its triggers", () => {
    beforeEach(() => closeRoutePanel())
    it("opens with a request, changes it, publishes the plan for the map", () => {
        const fn = vi.fn()
        const off = subscribeRoutePanel(fn)
        openRoutePanel({ request: { from: { asset_id: "OA-1" } } })
        expect(getRoutePanel()).toMatchObject({ open: true, request: { from: { asset_id: "OA-1" }, mode: "foot", purpose: "exit", to: null } })
        const seq = getRoutePanel().seq
        updateRequest({ mode: "truck" })
        expect(getRoutePanel().request.mode).toBe("truck")
        expect(getRoutePanel().seq).toBe(seq + 1)                  // a new request: planned again
        publishPlan(plan())
        expect(getRoutePanel().plan.safest.key).toBe("a")
        off()
        expect(fn).toHaveBeenCalledTimes(3)
    })
    it("context cards become requests: exit from the asset, access to the site by truck", () => {
        expect(requestFor({ kind: "exit" }, { assetId: "OA-1" })).toMatchObject({ from: { asset_id: "OA-1" }, to: null, purpose: "exit" })
        expect(requestFor({ kind: "access", depart_at: "2026-10-17T07:00:00Z" }, { assetId: "OA-2" }))
            .toMatchObject({ to: { asset_id: "OA-2" }, mode: "truck", purpose: "access", depart_at: "2026-10-17T07:00:00Z" })
        expect(requestFor({ kind: "unknown" }, {})).toBe(null)
        registerRouteContext("medevac", { title: "Medevac", request: () => ({ mode: "car", purpose: "medevac" }) })
        expect(openContext({ kind: "medevac" }, {})).toBe(true)
        expect(getRoutePanel()).toMatchObject({ open: true, title: "Medevac", request: { purpose: "medevac" } })
    })
    it("a Leave now notification opens the panel on that exit — on its saved plan when it carries one", () => {
        openFromNotification({ assetId: "OA-1", routePlanId: "RP-1" })
        expect(getRoutePanel()).toMatchObject({ open: true, planId: "RP-1", request: { from: { asset_id: "OA-1" }, purpose: "exit" } })
        expect(routeFor({ id: "exit:anna:tgs-1", alert_type: "Leave now", asset_id: "OA-1", route_plan_id: "RP-1" })).toMatchObject({ action: "exit", routePlanId: "RP-1" })
        expect(routeFor({ id: "exit:anna:tgs-1", kind: "exit" }).action).toBe("exit")
        expect(routeFor({ id: "x", asset_id: "OA-1" }).action).toBe("asset")
        const cold = parseOpenParams("?signal=exit%3Aanna%3Atgs-1&asset=OA-1&type=Leave%20now&plan=RP-1")
        expect(routeFor(cold)).toMatchObject({ action: "exit", assetId: "OA-1", routePlanId: "RP-1" })
    })
})
