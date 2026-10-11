/**
 * A photograph of this aircraft or this ship, with its credit.
 *
 * Desktop inspector and phone TrackSheet share it. The picture comes from
 * GET /api/photos/aircraft (planespotters.net, by ICAO24 / registration) or
 * GET /api/photos/vessel (Wikimedia Commons, by IMO) — backend/services/
 * track_photos.py. Both sources' terms make the credit a condition of use,
 * so a photo is never shown without its photographer and source link.
 *
 * Nothing is drawn when there is no photograph: no placeholder, no broken
 * image. A 16:9 skeleton holds the place only while the lookup or the
 * picture itself is loading.
 */
import { useEffect, useState } from "react"
import API_BASE from "../apiBase.js"

const memo = new Map()   // query → answer, for the life of the page

export function photoQuery(kind, t = {}) {
    if (kind === "aircraft") {
        const hex = String(t.icao || t.hex || t.icao24 || "").replace(/^adsb-/i, "").trim()
        const reg = String(t.registration || t.r || t.reg || "").trim()
        if (!/^[0-9a-f]{6}$/i.test(hex) && !reg) return null
        return `aircraft?${new URLSearchParams({ ...(hex ? { hex } : {}), ...(reg ? { reg } : {}) })}`
    }
    if (kind === "vessel" || kind === "ship") {
        const mmsi = String(t.mmsi || "").trim()
        const imo = String(t.imo || "").replace(/\D/g, "")
        if (!mmsi && !imo) return null
        return `vessel?${new URLSearchParams({ ...(mmsi ? { mmsi } : {}), ...(imo ? { imo } : {}) })}`
    }
    return null
}

/** { photo, pending } — photo is null when there is none. */
export function useTrackPhoto(kind, t) {
    const q = photoQuery(kind, t)
    const [state, setState] = useState(() => ({ q, photo: memo.get(q) ?? null, pending: !!q && !memo.has(q) }))
    useEffect(() => {
        if (!q) { setState({ q, photo: null, pending: false }); return undefined }
        if (memo.has(q)) { setState({ q, photo: memo.get(q), pending: false }); return undefined }
        let live = true
        setState({ q, photo: null, pending: true })
        fetch(`${API_BASE}/api/photos/${q}`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                const photo = d?.available && d.thumbnail_url ? d : null
                // A source that did not answer is not "no photo": ask again next time.
                if (d && (d.available || !/did not answer|rate-limited/.test(d.reason || ""))) memo.set(q, photo)
                if (live) setState({ q, photo, pending: false })
            })
            .catch(() => { if (live) setState({ q, photo: null, pending: false }) })
        return () => { live = false }
    }, [q])
    return state.q === q ? state : { q, photo: null, pending: !!q }
}

const frame = {
    position: "relative", width: "100%", aspectRatio: "16 / 9", overflow: "hidden",
    borderRadius: 10, background: "var(--bg-2, rgba(127,127,127,.12))",
}

function Skeleton() {
    return (
        <div style={frame} data-testid="track-photo-skeleton" aria-label="Loading photograph">
            <style>{`@keyframes tp-shimmer { 0% { background-position: -200% 0 } 100% { background-position: 200% 0 } }`}</style>
            <div style={{
                position: "absolute", inset: 0,
                background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,.08) 50%, transparent 100%)",
                backgroundSize: "200% 100%", animation: "tp-shimmer 1.4s linear infinite",
            }} />
        </div>
    )
}

/** The credit line, as both sources require: who took it, where it lives. */
export function PhotoCredit({ photo, style }) {
    if (!photo) return null
    const link = { color: "inherit", textDecoration: "underline", textDecorationColor: "rgba(127,127,127,.5)" }
    return (
        <div data-testid="track-photo-credit" style={{
            fontFamily: "var(--font, inherit)", fontSize: 11, lineHeight: 1.4,
            color: "var(--text-dim, var(--txt-3, #8a8f98))", marginTop: 5, ...style,
        }}>
            Photo: {photo.photographer || "unknown"}
            {" / "}
            {photo.link_url
                ? <a href={photo.link_url} target="_blank" rel="noopener noreferrer" style={link}>{photo.source}</a>
                : photo.source}
            {photo.licence && photo.source !== "planespotters.net" && (
                <> · {photo.licence_url
                    ? <a href={photo.licence_url} target="_blank" rel="noopener noreferrer" style={link}>{photo.licence}</a>
                    : photo.licence}</>
            )}
        </div>
    )
}

/** The picture itself, given an answer from the photo endpoint. */
export function TrackPhotoView({ photo, pending = false, alt = "", style }) {
    const [loaded, setLoaded] = useState(false)
    const [failed, setFailed] = useState(false)
    const src = photo?.thumbnail_url || null
    useEffect(() => { setLoaded(false); setFailed(false) }, [src])
    if (failed) return null
    if (!src) return pending ? <div style={style}><Skeleton /></div> : null
    return (
        <div style={style} data-testid="track-photo">
            <div style={frame}>
                {!loaded && <div style={{ position: "absolute", inset: 0 }}><Skeleton /></div>}
                {/* Hotlinked as planespotters requires; never re-hosted. In a
                    fixed frame and never display:none, so lazy loading fires. */}
                <img src={src} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer-when-downgrade"
                     onLoad={() => setLoaded(true)} onError={() => setFailed(true)}
                     style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover",
                              opacity: loaded ? 1 : 0, transition: "opacity 160ms ease" }} />
            </div>
            <PhotoCredit photo={photo} />
        </div>
    )
}

/** Fetch and show: `kind` is "aircraft" or "vessel", `track` the live record. */
export default function TrackPhoto({ kind, track, alt, style }) {
    const { photo, pending } = useTrackPhoto(kind, track)
    return <TrackPhotoView photo={photo} pending={pending} alt={alt} style={style} />
}
