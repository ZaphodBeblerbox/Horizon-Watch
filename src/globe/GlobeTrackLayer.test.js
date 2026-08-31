import { describe, it, expect } from "vitest"
import { groupByKey, MAX_POINTS } from "./GlobeTrackLayer.jsx"

describe("groupByKey — real position-history grouping for AIS/ADS-B track rendering", () => {
    it("groups positions by the given key field, dropping rows with no key or no lat/lon", () => {
        const positions = [
            { mmsi: "111", lat: 1, lon: 1, timestamp: "2026-01-01T00:00:00" },
            { mmsi: "111", lat: 2, lon: 2, timestamp: "2026-01-01T01:00:00" },
            { mmsi: "222", lat: 3, lon: 3, timestamp: "2026-01-01T00:00:00" },
            { mmsi: null,  lat: 4, lon: 4, timestamp: "2026-01-01T00:00:00" },
            { mmsi: "333", lat: null, lon: 5, timestamp: "2026-01-01T00:00:00" },
        ]
        const groups = groupByKey(positions, "mmsi")
        expect([...groups.keys()].sort()).toEqual(["111", "222"])
        expect(groups.get("111")).toHaveLength(2)
        expect(groups.get("222")).toHaveLength(1)
    })

    it("sorts each group's points chronologically regardless of input order (a real track must be drawn in time order, not fetch order)", () => {
        const positions = [
            { mmsi: "111", lat: 2, lon: 2, timestamp: "2026-01-01T02:00:00" },
            { mmsi: "111", lat: 1, lon: 1, timestamp: "2026-01-01T01:00:00" },
            { mmsi: "111", lat: 3, lon: 3, timestamp: "2026-01-01T03:00:00" },
        ]
        const track = groupByKey(positions, "mmsi").get("111")
        expect(track.map(p => p.lat)).toEqual([1, 2, 3])
    })

    it("caps each group at MAX_POINTS, keeping the most recent points (not the earliest)", () => {
        const positions = Array.from({ length: MAX_POINTS + 10 }, (_, i) => ({
            mmsi: "111", lat: i, lon: i,
            timestamp: new Date(2026, 0, 1, 0, i).toISOString(),
        }))
        const track = groupByKey(positions, "mmsi").get("111")
        expect(track).toHaveLength(MAX_POINTS)
        // Oldest points (lat 0..9) were dropped; the most recent MAX_POINTS remain.
        expect(track[0].lat).toBe(10)
        expect(track[track.length - 1].lat).toBe(MAX_POINTS + 9)
    })

    it("groups aircraft history by icao24 independently of vessel mmsi grouping", () => {
        const positions = [
            { icao24: "abc123", lat: 10, lon: 10, timestamp: "2026-01-01T00:00:00" },
            { icao24: "abc123", lat: 11, lon: 11, timestamp: "2026-01-01T00:05:00" },
        ]
        const groups = groupByKey(positions, "icao24")
        expect(groups.get("abc123")).toHaveLength(2)
    })

    it("returns an empty map for no positions, never throws", () => {
        expect(groupByKey([], "mmsi").size).toBe(0)
        expect(groupByKey(undefined ?? [], "mmsi").size).toBe(0)
    })
})
