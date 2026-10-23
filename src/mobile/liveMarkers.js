/**
 * liveMarkers.js — markers on the phone map that follow live positions:
 * the blue dot, the team (location/positionStream.js) and every asset a
 * phone moves. Each marker is kept between updates and GLIDES to its new
 * position (location/glide.js) instead of being removed and redrawn where
 * the next fix is — the rest of the map is redrawn wholesale, which is
 * right for signals and wrong for someone walking down a street.
 *
 * Each live marker may carry a freshness line ("live · 3 s ago"), an
 * element marked data-fresh in its icon; refresh() rewrites only that text,
 * once a second, without touching the marker.
 *
 * It draws nothing of its own: every icon it carries is the caller's, built by lib/mapIcons.js (dotIcon for you
 * and the team, pinIcon for an asset), so a moving marker looks exactly like a still one.
 */
import { createGlide } from "../location/glide.js"

export function createLiveMarkers(L, group, { glideFactory = createGlide } = {}) {
    const items = new Map()            // key -> {marker, glide, iconSig, at, onClick}

    function sync(list) {
        const keep = new Set()
        for (const it of list) {
            if (!Number.isFinite(+it.lat) || !Number.isFinite(+it.lon)) continue
            keep.add(it.key)
            let e = items.get(it.key)
            if (!e) {
                const marker = L.marker([+it.lat, +it.lon], { icon: it.icon, keyboard: false, zIndexOffset: it.z || 0, interactive: !!it.onClick })
                const entry = { marker, iconSig: it.iconSig, at: it.at, onClick: it.onClick }
                if (it.onClick) marker.on("click", () => entry.onClick?.())
                marker.addTo(group)
                entry.glide = glideFactory({ onFrame: (p) => { marker.setLatLng([p.lat, p.lon]); it.onMove?.(p) } })
                entry.glide.set({ lat: +it.lat, lon: +it.lon })
                items.set(it.key, entry)
                e = entry
            } else {
                if (it.iconSig !== e.iconSig) { e.marker.setIcon(it.icon); e.iconSig = it.iconSig }
                const t = e.glide.target()
                if (!t || t.lat !== +it.lat || t.lon !== +it.lon) e.glide.set({ lat: +it.lat, lon: +it.lon }, it.gapMs)
            }
            e.at = it.at
            e.onClick = it.onClick
        }
        for (const [k, e] of items) {
            if (keep.has(k)) continue
            e.glide.stop()
            e.marker.remove()
            items.delete(k)
        }
    }

    /** Rewrite each marker's freshness line: text(entry) -> string. */
    function refresh(text) {
        for (const e of items.values()) {
            const el = e.marker.getElement?.()?.querySelector?.("[data-fresh]")
            if (!el) continue
            const t = text(e)
            if (t != null && el.textContent !== t) el.textContent = t
        }
    }

    return {
        sync,
        refresh,
        get: (k) => items.get(k) || null,
        keys: () => [...items.keys()],
        clear() { sync([]) },
    }
}
