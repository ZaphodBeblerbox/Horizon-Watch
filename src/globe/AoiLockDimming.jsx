import { useEffect, useRef } from "react"

/**
 * AoiLockDimming — real "lock this AOI" visual attenuation (full UI rebuild
 * spec section 10, actually built in the UI correction pass Part 3.2):
 * "Locking an AOI visually attenuates everything outside it by roughly
 * 20-35% (darken/desaturate), while the AOI area itself stays at normal
 * brightness. Unlocking reverses this immediately."
 *
 * Cesium has no native "everything except this rectangle" primitive, so
 * this uses the standard real technique: 4 rectangle entities framing the
 * AOI's bounds (north/south/east/west of it), covering the rest of the
 * visible world with a semi-transparent black fill. The AOI's own bounds are
 * never touched by any of the 4 strips, so it stays at normal brightness.
 *
 * Reusable on any real Cesium viewer instance — pass the live `viewer` and
 * real `bounds` ({north, south, east, west} degrees); renders nothing (and
 * cleans up its entities) whenever `active` is false or bounds are missing.
 */
export default function AoiLockDimming({ viewer, bounds, active = false, alpha = 0.28 }) {
    const entitiesRef = useRef([])

    useEffect(() => {
        if (!viewer || viewer.isDestroyed?.()) return
        // Always clear previous strips first — real bounds/active changes
        // must never leave a stale dimmed frame behind.
        entitiesRef.current.forEach(e => { try { viewer.entities.remove(e) } catch (_err) {} })
        entitiesRef.current = []

        if (!active || !bounds) return

        let cancelled = false
        import("cesium").then(({ Rectangle, Color, HeightReference }) => {
            if (cancelled || viewer.isDestroyed?.()) return
            const { north, south, east, west } = bounds
            const fill = Color.BLACK.withAlpha(Math.max(0, Math.min(1, alpha)))
            const strips = [
                // North of the AOI
                { west: -180, south: north, east: 180, north: 90 },
                // South of the AOI
                { west: -180, south: -90, east: 180, north: south },
                // West of the AOI, within its own latitude band
                { west: -180, south, east: west, north },
                // East of the AOI, within its own latitude band
                { west: east, south, east: 180, north },
            ]
            entitiesRef.current = strips.map(s =>
                viewer.entities.add({
                    rectangle: {
                        coordinates: Rectangle.fromDegrees(s.west, s.south, s.east, s.north),
                        material: fill,
                        heightReference: HeightReference.CLAMP_TO_GROUND,
                    },
                })
            )
        })

        return () => {
            cancelled = true
            entitiesRef.current.forEach(e => { try { viewer.entities.remove(e) } catch (_err) {} })
            entitiesRef.current = []
        }
    }, [viewer, active, alpha, bounds?.north, bounds?.south, bounds?.east, bounds?.west])

    return null
}
