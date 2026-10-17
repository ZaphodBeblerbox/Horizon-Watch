/**
 * common.jsx — pieces every phone screen shares: severity colours, the
 * "when" label, and the sheet a signal opens into (what it is, its
 * footage or the X posts it cites, show it on the map, share it to the desk).
 */
import StrikeSourceMedia from "../../inspector/StrikeSourceMedia.jsx"
import { ShowTrackButton } from "../../location/TrackPanel.jsx"
import { openRoutePanel } from "../../routes/store.js"
import SourceLink from "../../components/SourceLink.jsx"
import { useEffect, useRef, useState } from "react"
import { attachDrag, flingMs, swallowClickAfterDrag } from "../gesture.js"
import { createPortal } from "react-dom"
import TelegramMedia from "../../components/TelegramMedia.jsx"
import XPost, { xPostId } from "../../components/XPost.jsx"
import { createPost } from "../../lib/deskApi.js"
import { whenLabel } from "../../utils/formatTime.js"
import { VesselThreatBlock } from "./MVesselThreat.jsx"
import { isVesselThreatAlert } from "../../globe/vesselThreat.js"
import FindingPreview from "../../components/FindingPreview.jsx"
import { findingZoneOf, isFindingAlert, showFindings } from "../../lib/findings.js"
import PlaceModel from "../../assets/PlaceModel.jsx"
import CountryFlag from "../../components/CountryFlag.jsx"
import { factionCountry } from "../../globe/frontlineClaims.js"

// Severity is an ICON's colour (a diamond, a dot), never a word's: the phone's
// text is monochrome (m2.css v4), so these are fixed values, not the theme's.
export const SEV = { critical: "#ff5a4f", significant: "#f5a623", high: "#f5a623",
    elevated: "#f5a623", moderate: "#8fb4e8", medium: "#8fb4e8", low: "#6f7888" }
export const sevColor = (s) => SEV[String(s || "").toLowerCase()] || "#6f7888"
export const when = (ts) => (ts ? whenLabel(ts) : "")
/** A feed's time: "2 d", "14 min" — the relative part only. */
export const ago = (ts) => {
    const full = when(ts)
    const rel = full.split(" · ").pop() || full
    return rel.replace(/ ago$/, "")
}

export function Icon({ id, size = 20 }) {
    return <svg width={size} height={size} aria-hidden focusable="false"><use href={`#${id}`} /></svg>
}

/** A bottom sheet: slides up when it opens and back down before it closes.
 *  Rendered at the top of the phone app (the .m2 root), above the map and
 *  the tab bar — a sheet opened from the map used to sit inside the map's
 *  layer, under the tab bar, and could not be scrolled to its end. */
export function Sheet({ onClose, children, half = false }) {
    const [closing, setClosing] = useState(false)
    const [full, setFull] = useState(false)
    const el = useRef(null)
    const fullRef = useRef(full)
    fullRef.current = full
    const closeRef = useRef(onClose)
    closeRef.current = onClose
    const close = () => { if (closing) return; setClosing(true); setTimeout(() => onClose?.(), 210) }
    const host = (typeof document !== "undefined" && document.querySelector(".m2")) || (typeof document !== "undefined" ? document.body : null)
    // THE SHEET FOLLOWS THE FINGER (../gesture.js): dragged by its grip, or
    // anywhere while its content is at the top. Down past a third of its
    // height, or flicked, it is thrown away at the speed of the flick; else
    // it springs back. A half sheet (a notification on the map) goes to full.
    useEffect(() => {
        const node = el.current
        if (!node) return undefined
        let fromGrip = false
        const off = attachDrag(node, {
            start: (t) => {
                if (t.closest?.("input, textarea, select, video, [data-nodrag]")) return false
                fromGrip = !!t.closest?.(".m2-grip")
                return true
            },
            move: ({ dy, axis }) => {
                if (axis !== "y") return false
                if (!fromGrip && (node.scrollTop > 0 || dy < 0)) return false     // the content's own scroll
                node.classList.add("dragging")
                node.style.transform = `translateY(${dy > 0 ? dy : dy * 0.25}px)`
                node.__dragged = true
                return true
            },
            end: ({ dy, vy, moved }) => {
                node.classList.remove("dragging")
                if (!moved) return
                const h = node.getBoundingClientRect().height
                const back = () => {
                    node.style.transition = "transform .34s cubic-bezier(.22,1,.36,1)"
                    node.style.transform = ""
                    setTimeout(() => { node.style.transition = "" }, 360)
                }
                if (half && !fullRef.current && (dy < -30 || vy < -0.5)) { back(); setFull(true); return }
                if (dy > h / 3 || vy > 0.6) {
                    if (half && fullRef.current && dy < h / 2 && vy < 1.2) { back(); setFull(false); return }
                    const ms = flingMs(h - dy, vy)
                    node.style.transition = `transform ${ms}ms cubic-bezier(.2,.7,.3,1)`
                    node.style.transform = `translateY(${h + 40}px)`
                    setTimeout(() => closeRef.current?.(), ms)
                    return
                }
                back()
            },
        })
        const offClick = swallowClickAfterDrag(node)
        return () => { off(); offClick() }
    }, [half])
    const sheet = <>
        {!half && <div className={`m2-sheet-back${closing ? " closing" : ""}`} onClick={close} />}
        <div ref={el} className={`m2-sheet${half ? " half" : ""}${half && full ? " full" : ""}${closing ? " closing" : ""}`} role="dialog" data-sheet={half ? (full ? "full" : "half") : "modal"}>
            <div className="m2-grip" role="button" aria-label={half ? (full ? "Drag down to see the map" : "Drag up for the full details") : "Close"}
                 onClick={() => (half ? setFull((f) => !f) : close())} />
            {half && <button className="m2-iconbtn" aria-label="Close" data-testid="sheet-close" onClick={close}
                             style={{ position: "absolute", right: 8, top: 6, width: 32, height: 32, fontSize: 18, lineHeight: 1 }}>×</button>}
            {children}
        </div>
    </>
    return host ? createPortal(sheet, host) : sheet
}

/** What a signal is, in the form the desk takes. */
export function attachmentFor(s) {
    if (s.channel && s.msg_id) {
        return { kind: "telegram", id: s.id, channel: s.channel, msg_id: s.msg_id, channel_title: s.channel_title, headline: s.headline || s.title,
            place: s.place || null, lat: s.lat ?? null, lon: s.lon ?? null, media: s.media, thumb_url: s.thumb_url, posted_at: s.posted_at || null, graphic: !!s.graphic }
    }
    return { kind: "signal", id: String(s.id ?? s.headline), headline: s.headline || s.title || "Signal", lat: s.lat ?? null, lon: s.lon ?? null,
        meta: [s.location || s.place, s.source || s.source_type].filter(Boolean).join(" · ") || null,
        urgency: String(s.severity_tier || s.severity || s.sev || "routine").toLowerCase() }
}

const URLS = /https?:\/\/[^\s,]+/g

export function SignalSheet({ s, onClose, onShowOnMap, half = false }) {
    const [note, setNote] = useState("")
    const [shared, setShared] = useState(null)
    if (!s) return null
    const title = s.headline || s.title || "Signal"
    const finding = isFindingAlert(s) ? findingZoneOf(s) : null
    const where = String(s.place || s.location || s.geocoded_as || "").split(",").slice(0, 3).join(",")
    const xs = [...new Set(String(s.original_source || s.url || "").match(URLS) || [])].filter(xPostId).slice(0, 2)
    const share = async () => {
        try { await createPost({ body: note, attachment: attachmentFor(s), urgency: ["critical", "high", "elevated", "routine"].includes(String(s.severity_tier || "").toLowerCase()) ? String(s.severity_tier).toLowerCase() : undefined }); setShared("Posted to the desk.") }
        catch (e) { setShared(e.message || "Could not post") }
    }
    return (
        <Sheet onClose={onClose} half={half}>
            <div className="m2-eyebrow" style={{ paddingRight: half ? 36 : 0, display: "flex", alignItems: "center", gap: 7 }}>
                {(s.severity_tier || s.sev) && <i className="m2-sev" style={{ background: sevColor(s.severity_tier || s.sev), width: 7, height: 7, transform: "rotate(45deg)", display: "inline-block", flex: "none" }} />}
                {[s.severity_tier || s.sev, when(s.posted_at || s.published_at || s.created_at || s.when), s.channel_title || s.source].filter(Boolean).join(" · ")}
            </div>
            {(s.kind === "troop_movement" || s.kind === "frontline_claim") && factionCountry(s) && (
                <div style={{ marginTop: 6 }}><CountryFlag iso2={factionCountry(s).iso2} name={factionCountry(s).name} size={22} /></div>
            )}
            <h2 style={{ margin: "6px 0 4px", fontSize: 19, lineHeight: 1.3 }}>{title}</h2>
            {where && <div className="m2-sub" style={{ marginBottom: 10 }}>{where}</div>}
            {/* AN ENDANGERED PLACE: its model turning slowly (never on the map; three.js loads only here) */}
            {s.kind === "endangered_place" && <div style={{ marginBottom: 12 }}><PlaceModel key={s.id} place={s} height={210} /></div>}
            {(s.media === "video" || s.thumb_url) && s.channel && <div style={{ margin: "0 -14px 10px" }}><TelegramMedia post={s} maxHeight="46vh" radius="0" /></div>}
            {s.kind === "strike_event"
                ? <div style={{ marginBottom: 10 }}><StrikeSourceMedia event={s} /></div>
                : xs.map((u) => <XPost key={u} url={u} />)}
            {(s.summary_en || s.context || s.summary || s.why || s.detail) && (
                <p style={{ fontSize: 14, lineHeight: 1.5, color: "var(--txt2, #c3c7cf)", margin: "0 0 12px" }}>{s.summary_en || s.context || s.summary || s.why || s.detail}</p>
            )}
            {isVesselThreatAlert(s, s.id) && <VesselThreatBlock s={s} onShowOnMap={onShowOnMap} onClose={onClose} />}
            {/* AN IMAGERY FINDING: the cut-out with its box, and the map with the boxes */}
            {finding && <FindingPreview key={`${s.id}:${finding}`} alert={s} compact
                onShowOnMap={(x) => { showFindings({ ...x, title, fit: true }); window.dispatchEvent(new CustomEvent("m2:go", { detail: "map" })); onClose() }} />}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                {!finding && !half && Number.isFinite(+s.lat) && Number.isFinite(+s.lon) && <button className="m2-btn" onClick={() => { onShowOnMap?.(s); onClose() }}>Show on the map</button>}
                {s.url && !xs.length && <SourceLink className="m2-btn ghost" url={s.url} style={{ display: "inline-flex", alignItems: "center", textDecoration: "none", color: "inherit" }}>Original</SourceLink>}
            </div>
            {/* A PERSON OR AN ASSET: where they have been, and the safest way out from there */}
            {(s.user_id || /^OA-/.test(String(s.id || ""))) && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                    <ShowTrackButton className="m2-btn ghost" onShown={() => { window.dispatchEvent(new CustomEvent("m2:go", { detail: "map" })); onClose() }}
                        target={s.user_id && !/^OA-/.test(String(s.id || "")) ? { kind: "person", id: s.user_id, name: s.name || s.title }
                                                                            : { kind: "asset", id: s.id, name: s.name || s.title, userId: s.identifiers?.user_id }} />
                    {/^OA-/.test(String(s.id || "")) && <button className="m2-btn ghost" data-testid="sheet-safe-route"
                        onClick={() => { openRoutePanel({ request: { from: { asset_id: s.id }, to: null, purpose: "exit" } }); onClose() }}>Safest route</button>}
                </div>
            )}
            <div className="m2-eyebrow" style={{ marginBottom: 6 }}>Share to the desk</div>
            <textarea className="m2-input" rows={2} placeholder="What should the team know?" value={note} onChange={(e) => setNote(e.target.value)} />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                <button className="m2-btn ghost" onClick={share}>Post</button>
                {shared && <span className="m2-sub">{shared}</span>}
            </div>
        </Sheet>
    )
}

export function Row({ s, title, sub, when: w, color, onClick }) {
    return (
        <button className="m2-row" onClick={onClick}>
            <span className="m2-dot" style={{ background: color || sevColor(s?.severity_tier || s?.sev) }} />
            <span style={{ minWidth: 0 }}>
                <span className="m2-t">{title}</span>
                {sub && <span className="m2-sub">{sub}</span>}
            </span>
            <span className="m2-when">{w || ""}</span>
        </button>
    )
}
