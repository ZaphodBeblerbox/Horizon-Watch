/**
 * smoothMotion.js — aircraft and vessels that move like aircraft and vessels.
 *
 * Reports arrive every few seconds (ADS-B, polled every 10 s) or minutes
 * (AIS), and a marker drawn at the last report jumps each time one lands.
 * Dead reckoning between reports fixed the stillness but not the jump: each
 * new report reset the reckoning, and since reports arrive late the marker
 * snapped BACKWARDS onto it every refresh — the "refreshes every couple of
 * seconds" the owner saw (2026-10-07). After 30 s without a report it also
 * snapped back to the last fix.
 *
 * What this does instead, per contact:
 *
 *   predict  continue from the latest report along its track at its speed —
 *            we know where it is heading; we do not need a fix every second
 *            to draw it plausibly. Coasting is capped (an aircraft for two
 *            minutes, a ship for ten), after which it holds where the
 *            reckoning reached rather than jumping back to the old fix.
 *   blend    when a new report disagrees with where we were drawing it,
 *            the difference is carried as an offset that fades out over a
 *            few seconds. The marker eases onto the reported track; it
 *            never jumps, and never runs backwards.
 *   heading  turns are blended the same way, by the short way round.
 *
 * A report far from the drawn position (a gap, a data error) is taken as is:
 * blending across kilometres would draw a flight that never happened.
 */

const KT_TO_MS = 0.514444
const EARTH_R = 6371000

export const AIRCRAFT = { minSpeedKt: 30, maxCoastS: 120, blendMs: 4000, snapM: 8000 }
export const VESSEL = { minSpeedKt: 0.8, maxCoastS: 600, blendMs: 6000, snapM: 1500 }

/** Signed smallest difference a - b in degrees, in (-180, 180]. */
export function angleDiff(a, b) {
    let d = (((a - b) % 360) + 540) % 360 - 180
    if (d === -180) d = 180
    return d
}

/** Great-circle move from (lat, lon) by distance d metres on bearing deg. */
export function move(lat, lon, bearingDeg, d) {
    const r = d / EARTH_R
    const th = (bearingDeg * Math.PI) / 180
    const p1 = (lat * Math.PI) / 180, l1 = (lon * Math.PI) / 180
    const sinP2 = Math.sin(p1) * Math.cos(r) + Math.cos(p1) * Math.sin(r) * Math.cos(th)
    const p2 = Math.asin(Math.max(-1, Math.min(1, sinP2)))
    const l2 = l1 + Math.atan2(Math.sin(th) * Math.sin(r) * Math.cos(p1), Math.cos(r) - Math.sin(p1) * sinP2)
    return { lat: (p2 * 180) / Math.PI, lon: (((l2 * 180) / Math.PI + 540) % 360) - 180 }
}

function metres(a, b) {
    const r = Math.PI / 180
    const h = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lon - a.lon) * r / 2) ** 2
    return 2 * EARTH_R * Math.asin(Math.sqrt(h))
}

/** Where the report puts it at `now`: along its track, coasting capped. */
export function predict(base, now, cfg) {
    const moving = Number.isFinite(base.gs) && base.gs >= cfg.minSpeedKt && Number.isFinite(base.track)
    if (!moving) return { lat: base.lat, lon: base.lon, alt: base.alt, track: base.track }
    const dt = Math.max(0, Math.min(cfg.maxCoastS, (now - base.ts) / 1000))
    const p = move(base.lat, base.lon, base.track, base.gs * KT_TO_MS * dt)
    return { lat: p.lat, lon: p.lon, alt: base.alt, track: base.track }
}

const ease = (k) => k * k * (3 - 2 * k)

/** The motion the layers are drawing now, so a trail can end where its
 *  contact is drawn rather than at its last stored point. */
export const live = { aircraft: null, vessels: null }

/** The drawn position of a contact, or null. kind: "aircraft" | "vessels". */
export function liveAt(kind, id, now = Date.now()) {
    const m = live[kind]
    return m ? m.get(String(id), now) : null
}

export function createMotion(cfg = AIRCRAFT) {
    const st = new Map()

    const sample = (s, now) => {
        const p = predict(s.base, now, cfg)
        const o = s.off
        if (!o) return p
        const k = 1 - Math.min(1, (now - o.t0) / cfg.blendMs)
        if (k <= 0) { s.off = null; return p }
        const e = ease(k)
        return {
            lat: p.lat + o.dlat * e,
            lon: p.lon + o.dlon * e,
            alt: (p.alt ?? 0) + o.dalt * e,
            track: Number.isFinite(p.track) ? (p.track + o.dtrack * e + 360) % 360 : p.track,
        }
    }

    return {
        /** A report: {lat, lon, alt?, track, gs (knots), ts? (ms of the fix)}. */
        update(id, rep, now = Date.now()) {
            if (!Number.isFinite(rep.lat) || !Number.isFinite(rep.lon)) return
            const base = { lat: rep.lat, lon: rep.lon, alt: Number.isFinite(rep.alt) ? rep.alt : 0,
                           track: Number.isFinite(rep.track) ? rep.track : NaN, gs: Number(rep.gs) || 0,
                           ts: Number.isFinite(rep.ts) ? Math.min(rep.ts, now) : now }
            const prev = st.get(id)
            if (prev && prev.base.ts === base.ts && prev.base.lat === base.lat && prev.base.lon === base.lon) return  // same report again
            let off = null
            if (prev) {
                const cur = sample(prev, now)
                const next = predict(base, now, cfg)
                if (metres(cur, next) < cfg.snapM) {
                    off = {
                        dlat: cur.lat - next.lat,
                        dlon: angleDiff(cur.lon, next.lon),
                        dalt: (cur.alt ?? 0) - (next.alt ?? 0),
                        dtrack: Number.isFinite(cur.track) && Number.isFinite(next.track) ? angleDiff(cur.track, next.track) : 0,
                        t0: now,
                    }
                }
            }
            st.set(id, { base, off })
        },
        /** Where to draw it now, or null if never reported. */
        get(id, now = Date.now()) {
            const s = st.get(id)
            return s ? sample(s, now) : null
        },
        has: (id) => st.has(id),
        /** Forget contacts no longer reported. */
        prune(liveIds) { for (const k of st.keys()) if (!liveIds.has(k)) st.delete(k) },
        size: () => st.size,
    }
}
